import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, EyeOff, ExternalLink, RefreshCw, Save } from "lucide-react";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { Card, Header } from "./Dashboard";
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
    <div className="space-y-8">
      <Header
        eyebrow="Settings"
        title="Settings"
        right={
          <button onClick={() => setReveal((value) => !value)} className="button-secondary-dark gap-2">
            {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
            {reveal ? "hide secrets" : "reveal secrets"}
          </button>
        }
      />

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card title="Setup readiness" tone="surface" hint={ready ? "Healthy" : "Needs attention"}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {readinessItems(status.data).map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-2 rounded-[8px] border border-border bg-card px-3 py-3">
                <span className="text-[13px] leading-[1.5] text-body">{item.label}</span>
                <span className={cn("h-2 w-2 rounded-full flex-shrink-0", item.ok ? "bg-accentGreen" : "bg-accentRed")} />
              </div>
            ))}
          </div>
        </Card>

        <Card title="Required checks" tone="elevated" hint="Access gate">
          <div className="text-[56px] font-semibold leading-none tracking-[-0.03em] text-text tabular-nums">
            {completedCount(status.data)}/{REQUIRED_STATUS_KEYS.length}
          </div>
          <div className="mt-3 text-[15px] leading-[1.6] text-body">Dashboard access depends on these checks.</div>
          <div className="mt-4 inline-flex items-center gap-2 rounded-[8px] border border-border bg-card px-3 py-2 text-[13px] text-body">
            <span className={cn("h-2 w-2 rounded-full", ready ? "bg-accentGreen" : "bg-accentYellow")} />
            {ready ? "System ready" : "Finish the remaining required setup"}
          </div>
        </Card>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_1fr]">
        <aside className="space-y-2">
          {SETTINGS_SECTIONS.map((section) => {
            const selected = section.id === activeSection.id;
            return (
              <button
                key={section.id}
                onClick={() => setActive(section.id)}
                className={cn(
                  "w-full rounded-[10px] border px-4 py-4 text-left transition",
                  selected ? "border-white/12 bg-elevated text-text" : "border-border bg-panel text-body hover:bg-elevated hover:text-text",
                )}
              >
                <div className="flex items-center gap-2">
                  {section.setup && <CheckCircle2 size={14} className={readyForSection(section.id, status.data) ? "text-accentGreen" : "text-muted"} />}
                  <span className="text-[16px] leading-[1.4]">{section.title}</span>
                </div>
                <div className="mt-2 text-[13px] leading-[1.5] text-muted">{section.summary}</div>
              </button>
            );
          })}
        </aside>

        <section className="command-card overflow-hidden">
          <div className="border-b border-border px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-medium text-muted">Section</div>
              <h2 className="mt-2 text-[28px] font-semibold leading-[1.15] text-text">{activeSection.title}</h2>
              <p className="mt-2 text-[15px] leading-[1.6] text-body">{activeSection.summary}</p>
            </div>
            {activeSection.id === "google" && (
              <button
                disabled={oauth.isPending || dirtyCount > 0}
                onClick={() => oauth.mutate()}
                className="button-brand gap-2"
                title={dirtyCount > 0 ? "Save Google credentials before authorizing" : "Re-authorize Google"}
              >
                <RefreshCw size={14} />
                {oauth.isPending ? "Opening Google..." : "Re-authorize Google"}
                <ExternalLink size={14} />
              </button>
            )}
          </div>

          {settings.isLoading ? (
            <div className="p-8 text-[15px] text-body">Loading settings...</div>
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

          <div className="sticky bottom-0 border-t border-border bg-bg/95 px-6 py-5 backdrop-blur flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-[13px] text-body">
              {dirtyCount > 0 ? `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"} in ${activeSection.title}.` : "Only changed fields are written."}
            </div>
            <button
              disabled={!dirtyCount || save.isPending}
              onClick={() => save.mutate(activeDraft)}
              className={cn(dirtyCount ? "button-primary-light gap-2" : "button-secondary-light gap-2")}
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
