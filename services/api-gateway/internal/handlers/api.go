package handlers

import (
	"net/http"
	"strconv"
	"time"

	"yagami/api-gateway/internal/store"
)

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	if err := h.Store.Ping(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unhealthy", "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "healthy"})
}

func (h *Handler) ListEvents(w http.ResponseWriter, r *http.Request) {
	q := store.EventQuery{
		Type:      r.URL.Query().Get("type"),
		ChannelID: r.URL.Query().Get("channel_id"),
		Search:    r.URL.Query().Get("q"),
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
	events, err := h.Store.ListEvents(r.Context(), q)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if events == nil {
		events = []store.Event{}
	}
	writeJSON(w, http.StatusOK, events)
}

func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	st, err := h.Store.GetStats(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *Handler) Timeseries(w http.ResponseWriter, r *http.Request) {
	metric := r.URL.Query().Get("metric")
	if metric == "" {
		metric = "like"
	}
	days := 30
	if v := r.URL.Query().Get("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			days = n
		}
	}
	pts, err := h.Store.Timeseries(r.Context(), metric, days)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if pts == nil {
		pts = []store.TimeseriesPoint{}
	}
	writeJSON(w, http.StatusOK, pts)
}

func (h *Handler) ListDownloads(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	d, err := h.Store.ListDownloads(r.Context(), status, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if d == nil {
		d = []store.Download{}
	}
	writeJSON(w, http.StatusOK, d)
}

func (h *Handler) RetryDownload(w http.ResponseWriter, r *http.Request) {
	videoID := r.PathValue("videoId")
	if videoID == "" {
		writeError(w, http.StatusBadRequest, "missing videoId")
		return
	}
	url := "https://www.youtube.com/watch?v=" + videoID
	payload := []byte(`{"video_id":"` + videoID + `","title":"` + videoID + `","url":"` + url + `"}`)
	if err := h.NC.Publish("download.request", payload); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"queued": true, "video_id": videoID})
}

func (h *Handler) Heartbeats(w http.ResponseWriter, r *http.Request) {
	hb, err := h.Store.ListHeartbeats(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if hb == nil {
		hb = []store.Heartbeat{}
	}
	writeJSON(w, http.StatusOK, hb)
}
