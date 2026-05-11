package handlers

import (
	"net/http"
	"strings"
)

// ListSettings returns all settings, masking secret values for non-admins.
func (h *Handler) ListSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := h.Store.ListSettings(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Mask secrets in the wire response — UI requests `?reveal=1` to see them.
	if r.URL.Query().Get("reveal") != "1" {
		for i := range settings {
			if settings[i].IsSecret && settings[i].Value != "" {
				settings[i].Value = "••••••"
			}
		}
	}
	writeJSON(w, http.StatusOK, settings)
}

type updateSettingsReq map[string]string

// UpdateSettings validates each changed key, then atomically writes them all.
// Only keys present in the body are touched; everything else stays as-is.
func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req updateSettingsReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad json")
		return
	}
	if len(req) == 0 {
		writeError(w, http.StatusBadRequest, "empty body")
		return
	}
	if errs := validateSettings(r.Context(), req); len(errs) > 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":  "validation failed",
			"fields": errs,
		})
		return
	}
	if err := h.Store.SetSettings(r.Context(), req); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Notify all services to reload their config
	_ = h.NC.Publish("system.config_changed", []byte(`{"keys":[]}`))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "updated": len(req)})
}

// SettingsStatus returns a per-feature readiness summary used by the UI's
// onboarding/settings checklist.
func (h *Handler) SettingsStatus(w http.ResponseWriter, r *http.Request) {
	s, err := h.Store.ListSettings(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	m := map[string]string{}
	for _, x := range s {
		m[x.Key] = x.Value
	}
	non := func(k string) bool { return m[k] != "" }
	authStatus := strings.TrimSpace(m["google.auth_status"])
	oauthHealthy := non("google.refresh_token") &&
		authStatus != "invalid_grant" &&
		!strings.HasPrefix(authStatus, "error_")
	status := map[string]bool{
		"google_oauth_configured":   non("google.client_id") && non("google.client_secret"),
		"google_oauth_authorized":   oauthHealthy,
		"telegram_bot_configured":   non("telegram.bot_token"),
		"telegram_user_configured":  non("telegram.api_id") && non("telegram.api_hash") && non("telegram.session_string"),
		"telegram_chat_likes_set":   non("telegram.chat_likes"),
		"telegram_chat_history_set": non("telegram.chat_history"),
		"telegram_chat_subs_set":    non("telegram.chat_subs"),
		"telegram_admin_set":        non("telegram.admin_user_id"),
		"youtube_cookies_set":       non("youtube.cookies"),
	}
	writeJSON(w, http.StatusOK, status)
}
