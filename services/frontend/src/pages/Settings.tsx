import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, EyeOff, ExternalLink, RefreshCw, Save } from "lucide-react";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { Header } from "./Dashboard";
import { cn } from "../lib/utils";
import { toast } from "../components/Toast";
import { SettingsForm } from "../components/SettingsForm";
import {
  REQUIRED_STATUS_KEYS,
  SETTINGS_SECTIONS,
  isSystemReady,
  sectionFields,
  settingLabel,
  type Setting,
  type SettingsStatus,
} from "../lib/settings";

export function SettingsPage() {
  const [reveal, setReveal] = useState(false);
  const [active, setActive] = useState(SETTINGS_SECTIONS[0].id);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const qc = useQueryClient();

  const settings = useQuery({
    queryKey: ["settings", reveal],
    queryFn: () => apiGet<Setting[]>(`settings${reveal ? "?reveal=1" : ""}`),
  });

  const status = useQuery({
    queryKey: ["settings-status"],
    queryFn: () => apiGet<SettingsStatus>("settings/status"),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ok = params.get("oauth_ok");
    const err = params.get("oauth_error");
    if (!ok && !err) return;

    if (ok) {
      toast("success", "Google authorization completed. The refresh token was saved.");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["settings-status"] });
      setActive("google");
    }
    if (err) {
      toast("error", `Google authorization failed: ${err}`);
      setActive("google");
    }
    window.history.replaceState(null, "", "/settings");
  }, [qc]);

  const save = useMutation({
    mutationFn: (payload: Record<string, string>) => apiPut<{ updated: number }>("settings", payload),
    onSuccess: (result) => {
      setDraft({});
      setFieldErrors({});
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["settings-status"] });
      toast("success", `Saved ${result.updated} setting${result.updated === 1 ? "" : "s"}. Services are reloading.`);
    },
    onError: (error: any) => {
      if (error?.fields && Object.keys(error.fields).length > 0) {
        setFieldErrors(error.fields);
        toast("error", "Some values were rejected. Check the highlighted fields.");
        return;
      }
      toast("error", error?.message || "Failed to save settings");
    },
  });

  const oauth = useMutation({
    mutationFn: () => apiPost<{ auth_url: string }>("oauth/google/start"),
    onSuccess: (result) => window.open(result.auth_url, "_self"),
    onError: (error: any) => toast("error", error?.message || "Could not start Google authorization"),
  });

  const activeSection = SETTINGS_SECTIONS.find((section) => section.id === active) || SETTINGS_SECTIONS[0];
  const visibleSettings = useMemo(
    () => sectionFields(activeSection, settings.data || []),
    [activeSection, settings.data],
  );
  const activeDraft = useMemo(() => {
    const keys = new Set(activeSection.keys);
    return Object.fromEntries(Object.entries(draft).filter(([key]) => keys.has(key)));
  }, [activeSection.keys, draft]);
  const dirtyCount = Object.keys(activeDraft).length;
  const ready = isSystemReady(status.data);

  return (
    <div>
      <Header
        title="Settings"
        subtitle="Manage integrations by purpose. Required setup fields are first; advanced and operational controls stay editable after onboarding."
        right={
          <button onClick={() => setReveal((value) => !value)} className="text-xs flex items-center gap-2 text-muted hover:text-text">
            {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
            {reveal ? "hide secrets" : "reveal secrets"}
          </button>
        }
      />

      <section className="mb-6 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <div className="bg-panel/60 border border-border rounded-xl p-4">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", ready ? "bg-ok" : "bg-warn")} />
            <div className="text-sm font-medium">{ready ? "Setup complete" : "Setup needs attention"}</div>
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {readinessItems(status.data).map((item) => (
              <div key={item.label} className="border border-border rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-xs text-muted">{item.label}</span>
                <span className={cn("h-2 w-2 rounded-full flex-shrink-0", item.ok ? "bg-ok" : "bg-err")} />
              </div>
            ))}
          </div>
        </div>
        <div className="bg-panel/60 border border-border rounded-xl p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Required checks</div>
          <div className="text-3xl font-semibold mt-2 tabular-nums">{completedCount(status.data)}/{REQUIRED_STATUS_KEYS.length}</div>
          <div className="text-xs text-muted mt-1">Dashboard access depends on these checks.</div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        <aside className="space-y-2">
          {SETTINGS_SECTIONS.map((section) => {
            const selected = section.id === activeSection.id;
            return (
              <button
                key={section.id}
                onClick={() => setActive(section.id)}
                className={cn(
                  "w-full text-left border rounded-lg px-4 py-3 transition",
                  selected ? "bg-panel border-accent2/60" : "bg-panel/40 border-border hover:border-border/80",
                )}
              >
                <div className="flex items-center gap-2">
                  {section.setup && <CheckCircle2 size={14} className={readyForSection(section.id, status.data) ? "text-ok" : "text-muted"} />}
                  <span className="text-sm font-medium">{section.title}</span>
                </div>
                <div className="text-xs text-muted mt-1 leading-relaxed">{section.summary}</div>
              </button>
            );
          })}
        </aside>

        <section className="bg-panel/60 border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{activeSection.title}</h2>
              <p className="text-sm text-muted mt-1">{activeSection.summary}</p>
            </div>
            {activeSection.id === "google" && (
              <button
                disabled={oauth.isPending || dirtyCount > 0}
                onClick={() => oauth.mutate()}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
                title={dirtyCount > 0 ? "Save Google credentials before authorizing" : "Re-authorize Google"}
              >
                <RefreshCw size={14} />
                {oauth.isPending ? "Opening Google..." : "Re-authorize Google"}
                <ExternalLink size={14} />
              </button>
            )}
          </div>

          {settings.isLoading ? (
            <div className="p-8 text-sm text-muted">Loading settings...</div>
          ) : (
            <SettingsForm
              settings={visibleSettings}
              draft={draft}
              errors={fieldErrors}
              reveal={reveal}
              onChange={(key, value) => {
                setDraft((previous) => ({ ...previous, [key]: value }));
                if (fieldErrors[key]) {
                  setFieldErrors((previous) => {
                    const next = { ...previous };
                    delete next[key];
                    return next;
                  });
                }
              }}
            />
          )}

          <div className="sticky bottom-0 border-t border-border bg-panel/95 backdrop-blur px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-muted">
              {dirtyCount > 0 ? `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"} in ${activeSection.title}.` : "Only changed fields are written."}
            </div>
            <button
              disabled={!dirtyCount || save.isPending}
              onClick={() => save.mutate(activeDraft)}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition",
                dirtyCount ? "bg-accent text-white shadow-glow" : "bg-bg border border-border text-muted",
              )}
            >
              <Save size={14} />
              {save.isPending ? "Saving..." : `Save ${dirtyCount || ""} change${dirtyCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function readinessItems(status?: SettingsStatus) {
  return [
    { label: "Google credentials", ok: !!status?.google_oauth_configured },
    { label: "Google authorized", ok: !!status?.google_oauth_authorized },
    { label: settingLabel("telegram.bot_token"), ok: !!status?.telegram_bot_configured },
    { label: settingLabel("telegram.chat_likes"), ok: !!status?.telegram_chat_likes_set },
    { label: settingLabel("telegram.chat_history"), ok: !!status?.telegram_chat_history_set },
    { label: settingLabel("telegram.chat_subs"), ok: !!status?.telegram_chat_subs_set },
    { label: settingLabel("telegram.admin_user_id"), ok: !!status?.telegram_admin_set },
    { label: settingLabel("youtube.cookies"), ok: !!status?.youtube_cookies_set },
    { label: "Downloader cookie file", ok: !!status?.youtube_cookies_file_ready },
  ];
}

function completedCount(status?: SettingsStatus): number {
  return REQUIRED_STATUS_KEYS.filter((key) => status?.[key]).length;
}

function readyForSection(sectionId: string, status?: SettingsStatus): boolean {
  if (sectionId === "google") return !!status?.google_oauth_configured && !!status?.google_oauth_authorized;
  if (sectionId === "telegram") {
    return !!status?.telegram_bot_configured
      && !!status?.telegram_chat_likes_set
      && !!status?.telegram_chat_history_set
      && !!status?.telegram_chat_subs_set
      && !!status?.telegram_admin_set;
  }
  if (sectionId === "youtube-history") return !!status?.youtube_cookies_set && !!status?.youtube_cookies_file_ready;
  return false;
}
