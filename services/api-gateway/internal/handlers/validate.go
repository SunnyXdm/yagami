package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// validateSettings runs cheap, deterministic checks and one live network probe
// (Telegram bot token via getMe). Returns a map of key → error string.
// An empty map means all clean.
func validateSettings(ctx context.Context, kv map[string]string) map[string]string {
	errs := map[string]string{}

	mustInt := func(k string, min, max int64) {
		v := strings.TrimSpace(kv[k])
		if v == "" {
			return
		}
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			errs[k] = "must be an integer"
			return
		}
		if n < min || (max > 0 && n > max) {
			errs[k] = fmt.Sprintf("must be between %d and %d", min, max)
		}
	}

	for k, v := range kv {
		switch k {
		case "telegram.api_id":
			mustInt(k, 1, 0)
		case "telegram.chat_likes", "telegram.chat_history",
			"telegram.chat_subs", "telegram.admin_user_id":
			vv := strings.TrimSpace(v)
			if vv == "" {
				continue
			}
			if _, err := strconv.ParseInt(vv, 10, 64); err != nil {
				errs[k] = "must be a numeric chat ID (e.g. -1001234567890)"
			}
		case "telegram.api_hash":
			vv := strings.TrimSpace(v)
			if vv != "" && len(vv) < 16 {
				errs[k] = "looks too short — copy the full api_hash from my.telegram.org"
			}
		case "telegram.bot_token":
			vv := strings.TrimSpace(v)
			if vv == "" {
				continue
			}
			if !strings.Contains(vv, ":") {
				errs[k] = "bot token must look like 1234567:AA…"
				continue
			}
			if msg := probeBotToken(ctx, vv); msg != "" {
				errs[k] = msg
			}
		case "google.client_id":
			vv := strings.TrimSpace(v)
			if vv != "" && !strings.HasSuffix(vv, ".apps.googleusercontent.com") {
				errs[k] = "must end in .apps.googleusercontent.com"
			}
		case "google.client_secret":
			vv := strings.TrimSpace(v)
			if vv != "" && len(vv) < 16 {
				errs[k] = "looks too short — copy the full client secret"
			}
		case "youtube.cookies":
			vv := strings.TrimSpace(v)
			if vv == "" {
				continue
			}
			if !strings.Contains(vv, "youtube.com") {
				errs[k] = "doesn't contain youtube.com — paste your Netscape cookies.txt"
			}
		case "poll.interval_likes", "poll.interval_history", "poll.interval_subs":
			mustInt(k, 30, 86400)
		case "downloader.max_concurrent":
			mustInt(k, 1, 16)
		case "downloader.max_filesize_gb":
			mustInt(k, 1, 50)
		}
	}
	return errs
}

// probeBotToken calls the Telegram getMe endpoint. Returns "" on success,
// otherwise a human-readable error.
func probeBotToken(ctx context.Context, token string) string {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	url := "https://api.telegram.org/bot" + token + "/getMe"
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "could not reach Telegram: " + err.Error()
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	var parsed struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	_ = json.Unmarshal(body, &parsed)
	if !parsed.OK {
		if parsed.Description != "" {
			return "Telegram rejected the token: " + parsed.Description
		}
		return "Telegram rejected the token (HTTP " + strconv.Itoa(resp.StatusCode) + ")"
	}
	return ""
}
