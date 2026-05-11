package handlers

import (
	"context"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"yagami/api-gateway/internal/store"
)

type ctxKey int

const userCtxKey ctxKey = 1

// loginLimiter is a tiny in-process rate limiter: max 5 failed attempts per
// IP per minute. Successful logins reset the counter.
var loginLimiter = struct {
	sync.Mutex
	hits map[string][]time.Time
}{hits: map[string][]time.Time{}}

func clientIP(r *http.Request) string {
	if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
		if i := strings.IndexByte(xf, ','); i > 0 {
			return strings.TrimSpace(xf[:i])
		}
		return strings.TrimSpace(xf)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func loginAllowed(ip string) bool {
	loginLimiter.Lock()
	defer loginLimiter.Unlock()
	now := time.Now()
	cutoff := now.Add(-time.Minute)
	kept := loginLimiter.hits[ip][:0]
	for _, t := range loginLimiter.hits[ip] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= 5 {
		loginLimiter.hits[ip] = kept
		return false
	}
	kept = append(kept, now)
	loginLimiter.hits[ip] = kept
	return true
}

func loginReset(ip string) {
	loginLimiter.Lock()
	defer loginLimiter.Unlock()
	delete(loginLimiter.hits, ip)
}

func UserFromCtx(ctx context.Context) *store.User {
	v, _ := ctx.Value(userCtxKey).(*store.User)
	return v
}

func sessionToken(r *http.Request) string {
	if c, err := r.Cookie("yagami_session"); err == nil && c.Value != "" {
		return c.Value
	}
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}

// Auth wraps a handler and rejects unauthenticated requests.
func (h *Handler) Auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := sessionToken(r)
		if tok == "" {
			writeError(w, http.StatusUnauthorized, "auth required")
			return
		}
		u, err := h.Store.UserBySession(r.Context(), tok)
		if err != nil || u == nil {
			writeError(w, http.StatusUnauthorized, "invalid session")
			return
		}
		ctx := context.WithValue(r.Context(), userCtxKey, u)
		next(w, r.WithContext(ctx))
	}
}

// Setup is the bootstrap endpoint: if no users exist, allow creating the
// first one; otherwise behave like a login. It also returns a session.
type setupReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (h *Handler) Setup(w http.ResponseWriter, r *http.Request) {
	var req setupReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad json")
		return
	}
	if len(req.Username) < 3 || len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "username≥3, password≥8")
		return
	}
	n, err := h.Store.UserCount(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if n > 0 {
		writeError(w, http.StatusForbidden, "setup already complete")
		return
	}
	u, err := h.Store.CreateUser(r.Context(), req.Username, req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.issueSession(w, r, u)
}

func (h *Handler) Status(w http.ResponseWriter, r *http.Request) {
	n, err := h.Store.UserCount(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"setup_complete": n > 0,
		"version":        "1.0.0",
	})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !loginAllowed(ip) {
		writeError(w, http.StatusTooManyRequests, "too many attempts, try again in a minute")
		return
	}
	var req setupReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad json")
		return
	}
	u, err := h.Store.AuthenticateUser(r.Context(), req.Username, req.Password)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	loginReset(ip)
	h.issueSession(w, r, u)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	tok := sessionToken(r)
	if tok != "" {
		_ = h.Store.DeleteSession(r.Context(), tok)
	}
	secure := r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	http.SetCookie(w, &http.Cookie{
		Name: "yagami_session", Value: "", Path: "/",
		MaxAge: -1, HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	u := UserFromCtx(r.Context())
	writeJSON(w, http.StatusOK, u)
}

func (h *Handler) issueSession(w http.ResponseWriter, r *http.Request, u *store.User) {
	sess, err := h.Store.CreateSession(r.Context(), u.ID, r.UserAgent(), r.RemoteAddr, 30*24*time.Hour)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Mark cookie Secure when the request reached us over HTTPS (directly or
	// via a trusted reverse proxy that set X-Forwarded-Proto).
	secure := r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	http.SetCookie(w, &http.Cookie{
		Name:     "yagami_session",
		Value:    sess.Token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  sess.ExpiresAt,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"user":  u,
		"token": sess.Token,
	})
}
