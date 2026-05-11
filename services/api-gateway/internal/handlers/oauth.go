package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// In-memory CSRF state for OAuth handshake. Single user → fine.
var (
	oauthStateMu sync.Mutex
	oauthStates  = map[string]time.Time{}
)

func newOAuthState() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	s := hex.EncodeToString(b)
	oauthStateMu.Lock()
	oauthStates[s] = time.Now().Add(10 * time.Minute)
	oauthStateMu.Unlock()
	return s
}

func consumeOAuthState(s string) bool {
	oauthStateMu.Lock()
	defer oauthStateMu.Unlock()
	exp, ok := oauthStates[s]
	if !ok || time.Now().After(exp) {
		return false
	}
	delete(oauthStates, s)
	return true
}

const googleAuthURL = "https://accounts.google.com/o/oauth2/v2/auth"
const googleTokenURL = "https://oauth2.googleapis.com/token"
const googleScope = "https://www.googleapis.com/auth/youtube.readonly"
const googleRedirectURL = "http://localhost:8787/api/oauth/google/callback"

// OAuthStart returns the URL the user should be redirected to.
func (h *Handler) OAuthStart(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.Store.GetSettings(r.Context(), "google.client_id", "google.client_secret")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if cfg["google.client_id"] == "" || cfg["google.client_secret"] == "" {
		writeError(w, http.StatusBadRequest, "set google.client_id and google.client_secret first")
		return
	}
	state := newOAuthState()
	q := url.Values{}
	q.Set("client_id", cfg["google.client_id"])
	q.Set("redirect_uri", googleRedirectURL)
	q.Set("response_type", "code")
	q.Set("scope", googleScope)
	q.Set("access_type", "offline")
	q.Set("prompt", "consent")
	q.Set("state", state)
	writeJSON(w, http.StatusOK, map[string]string{
		"auth_url":     googleAuthURL + "?" + q.Encode(),
		"redirect_uri": googleRedirectURL,
	})
}

func (h *Handler) OAuthCallback(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	errParam := r.URL.Query().Get("error")
	if errParam != "" {
		http.Redirect(w, r, "/settings?oauth_error="+url.QueryEscape(errParam), http.StatusFound)
		return
	}
	if !consumeOAuthState(state) {
		http.Redirect(w, r, "/settings?oauth_error=invalid_state", http.StatusFound)
		return
	}
	cfg, err := h.Store.GetSettings(r.Context(), "google.client_id", "google.client_secret")
	if err != nil {
		http.Redirect(w, r, "/settings?oauth_error=server", http.StatusFound)
		return
	}
	tokens, err := exchangeGoogleCode(cfg["google.client_id"], cfg["google.client_secret"],
		code, googleRedirectURL)
	if err != nil {
		http.Redirect(w, r, "/settings?oauth_error="+url.QueryEscape(err.Error()), http.StatusFound)
		return
	}

	// Persist refresh + access token in DB
	expiresAt := time.Now().Add(time.Duration(tokens.ExpiresIn) * time.Second)
	if _, err := h.Store.Pool().Exec(r.Context(), `
	    INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at, scopes)
	    VALUES ('google', $1, $2, $3, $4)
	    ON CONFLICT (provider) DO UPDATE SET
	        access_token=EXCLUDED.access_token,
	        refresh_token=EXCLUDED.refresh_token,
	        expires_at=EXCLUDED.expires_at,
	        scopes=EXCLUDED.scopes,
	        updated_at=NOW()`,
		tokens.AccessToken, tokens.RefreshToken, expiresAt, googleScope); err != nil {
		http.Redirect(w, r, "/settings?oauth_error=db", http.StatusFound)
		return
	}
	if err := h.Store.ResetOAuthYouTubeState(r.Context()); err != nil {
		http.Redirect(w, r, "/settings?oauth_error=db", http.StatusFound)
		return
	}
	_ = h.Store.SetSetting(r.Context(), "google.refresh_token", tokens.RefreshToken)
	_ = h.NC.Publish("system.config_changed", []byte(`{"keys":["google.refresh_token"]}`))
	http.Redirect(w, r, "/settings?oauth_ok=1", http.StatusFound)
}

type googleTokenResp struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Error        string `json:"error"`
	ErrorDesc    string `json:"error_description"`
}

func exchangeGoogleCode(id, secret, code, redirect string) (*googleTokenResp, error) {
	body := url.Values{}
	body.Set("code", code)
	body.Set("client_id", id)
	body.Set("client_secret", secret)
	body.Set("redirect_uri", redirect)
	body.Set("grant_type", "authorization_code")
	req, _ := http.NewRequest("POST", googleTokenURL, strings.NewReader(body.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var tr googleTokenResp
	_ = json.Unmarshal(raw, &tr)
	if tr.AccessToken == "" {
		if tr.Error != "" {
			return nil, errMsg(tr.Error + ": " + tr.ErrorDesc)
		}
		return nil, errMsg("oauth: " + string(raw))
	}
	return &tr, nil
}

type errMsg string

func (e errMsg) Error() string { return string(e) }
