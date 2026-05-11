package handlers

import (
	"net/http"
	"strconv"
	"time"

	"yagami/api-gateway/internal/store"
)

func (h *Handler) ListLogs(w http.ResponseWriter, r *http.Request) {
	q := store.LogQuery{
		Service: r.URL.Query().Get("service"),
		Level:   r.URL.Query().Get("level"),
		Search:  r.URL.Query().Get("q"),
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			q.Limit = n
		}
	}
	if v := r.URL.Query().Get("after_id"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			q.AfterID = n
		}
	}
	if v := r.URL.Query().Get("since"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			q.Since = &t
		}
	}
	if v := r.URL.Query().Get("until"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			q.Until = &t
		}
	}
	logs, err := h.Store.ListLogs(r.Context(), q)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if logs == nil {
		logs = []store.LogEntry{}
	}
	writeJSON(w, http.StatusOK, logs)
}

func (h *Handler) LogServices(w http.ResponseWriter, r *http.Request) {
	svcs, err := h.Store.DistinctLogServices(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if svcs == nil {
		svcs = []string{}
	}
	writeJSON(w, http.StatusOK, svcs)
}
