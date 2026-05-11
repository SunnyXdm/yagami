import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  Save,
} from "lucide-react";
import { apiGet, apiPost, apiPut } from "../lib/api";
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
import { Logo } from "./Login";

const SETUP_SECTIONS = SETTINGS_SECTIONS.filter((section) => section.setup);

export function Onboarding({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const settings = useQuery({
    queryKey: ["settings", "onboarding"],
    queryFn: () => apiGet<Setting[]>("settings"),
  });

  const status = useQuery({
    queryKey: ["settings-status"],
    queryFn: () => apiGet<SettingsStatus>("settings/status"),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ok = params.get("oauth_ok");
    const err = params.get("oauth_error");
    if (!ok && !err) return;

    if (ok) {
      toast("success", "Google authorization completed. Continue setup from here.");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["settings-status"] });
      setStep(1);
    }
    if (err) {
      toast("error", `Google authorization failed: ${err}`);
      setStep(0);
    }
    window.history.replaceState(null, "", "/setup");
  }, [qc]);

  const save = useMutation({
    mutationFn: (payload: Record<string, string>) => apiPut<{ updated: number }>("settings", payload),
    onSuccess: (result) => {
      setDraft({});
      setFieldErrors({});
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["settings-status"] });
      toast("success", `Saved ${result.updated} setting${result.updated === 1 ? "" : "s"}.`);
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

  const current = SETUP_SECTIONS[step];
  const currentFields = useMemo(
    () => sectionFields(current, settings.data || []),
    [current, settings.data],
  );
  const currentDraft = useMemo(() => {
    const keys = new Set(current.keys);
    return Object.fromEntries(Object.entries(draft).filter(([key]) => keys.has(key)));
  }, [current.keys, draft]);
  const dirtyCount = Object.keys(currentDraft).length;
  const ready = isSystemReady(status.data);

  if (settings.isLoading || status.isLoading) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <Loader2 className="text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 lg:py-8">
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-7">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <div className="text-xl font-semibold tracking-tight">Finish Yagami setup</div>
              <div className="text-sm text-muted">Complete the required integrations before opening the dashboard.</div>
            </div>
          </div>
          <ReadinessPill ready={ready} completed={completedCount(status.data)} total={REQUIRED_STATUS_KEYS.length} />
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] gap-5">
          <aside className="space-y-2">
            {SETUP_SECTIONS.map((section, index) => {
              const active = index === step;
              const complete = sectionComplete(section.id, status.data);
              return (
                <button
                  key={section.id}
                  onClick={() => setStep(index)}
                  className={cn(
                    "w-full text-left border rounded-lg px-4 py-3 transition",
                    active ? "bg-panel border-accent2/60" : "bg-panel/40 border-border hover:border-border/80",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", complete ? "bg-ok" : "bg-warn")} />
                    <span className="text-sm font-medium">{section.title}</span>
                  </div>
                  <div className="text-xs text-muted mt-1 leading-relaxed">{section.summary}</div>
                </button>
              );
            })}
          </aside>

          <main className="bg-panel/60 border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-sm uppercase tracking-wide text-muted">Step {step + 1} of {SETUP_SECTIONS.length}</div>
                <h1 className="text-2xl font-semibold tracking-tight mt-1">{current.title}</h1>
                <p className="text-sm text-muted mt-1">{current.summary}</p>
              </div>
              {current.id === "google" && (
                <button
                  type="button"
                  disabled={oauth.isPending || save.isPending || dirtyCount > 0}
                  onClick={() => oauth.mutate()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
                  title={dirtyCount > 0 ? "Save Google credentials before authorizing" : "Authorize Google"}
                >
                  <KeyRound size={15} />
                  {oauth.isPending ? "Opening Google..." : "Authorize Google"}
                  <ExternalLink size={14} />
                </button>
              )}
            </div>

            <SettingsForm
              settings={currentFields}
              draft={draft}
              errors={fieldErrors}
              onChange={(key, value) => {
                setDraft((prev) => ({ ...prev, [key]: value }));
                if (fieldErrors[key]) {
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                  });
                }
              }}
            />

            <div className="px-5 py-4 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-muted">
                {dirtyCount > 0 ? `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"} in this step.` : stepHint(current.id, status.data)}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={step === 0}
                  onClick={() => setStep((value) => Math.max(0, value - 1))}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm disabled:opacity-40"
                >
                  <ArrowLeft size={15} /> Back
                </button>
                <button
                  type="button"
                  disabled={dirtyCount === 0 || save.isPending}
                  onClick={() => save.mutate(currentDraft)}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-40"
                >
                  <Save size={15} /> {save.isPending ? "Saving..." : "Save step"}
                </button>
                {step < SETUP_SECTIONS.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setStep((value) => Math.min(SETUP_SECTIONS.length - 1, value + 1))}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                  >
                    Next <ArrowRight size={15} />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!ready || dirtyCount > 0}
                    onClick={onDone}
                    className="inline-flex items-center gap-2 rounded-lg bg-ok px-3 py-2 text-sm text-white disabled:opacity-40"
                  >
                    <CheckCircle2 size={15} /> Open dashboard
                  </button>
                )}
              </div>
            </div>
          </main>
        </div>

        {!ready && (
          <section className="mt-5 bg-panel/40 border border-border rounded-xl p-5">
            <div className="text-sm font-medium mb-3">Still needed</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {missingLabels(status.data).map((label) => (
                <div key={label} className="text-xs text-muted border border-border rounded-lg px-3 py-2">{label}</div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ReadinessPill({ ready, completed, total }: { ready: boolean; completed: number; total: number }) {
  return (
    <div className={cn(
      "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
      ready ? "border-ok/40 bg-ok/10 text-ok" : "border-warn/40 bg-warn/10 text-warn",
    )}>
      <span className={cn("h-2 w-2 rounded-full", ready ? "bg-ok" : "bg-warn")} />
      {ready ? "Ready" : `${completed}/${total} required checks complete`}
    </div>
  );
}

function completedCount(status?: SettingsStatus): number {
  return REQUIRED_STATUS_KEYS.filter((key) => status?.[key]).length;
}

function missingLabels(status?: SettingsStatus): string[] {
  const labels: Record<string, string> = {
    google_oauth_configured: "Google client ID and secret",
    google_oauth_authorized: "Google browser authorization",
    telegram_bot_configured: settingLabel("telegram.bot_token"),
    telegram_chat_likes_set: settingLabel("telegram.chat_likes"),
    telegram_chat_history_set: settingLabel("telegram.chat_history"),
    telegram_chat_subs_set: settingLabel("telegram.chat_subs"),
    telegram_admin_set: settingLabel("telegram.admin_user_id"),
    youtube_cookies_set: settingLabel("youtube.cookies"),
  };
  return REQUIRED_STATUS_KEYS.filter((key) => !status?.[key]).map((key) => labels[key] || key);
}

function sectionComplete(sectionId: string, status?: SettingsStatus): boolean {
  if (sectionId === "google") {
    return !!status?.google_oauth_configured && !!status?.google_oauth_authorized;
  }
  if (sectionId === "telegram") {
    return !!status?.telegram_bot_configured
      && !!status?.telegram_chat_likes_set
      && !!status?.telegram_chat_history_set
      && !!status?.telegram_chat_subs_set
      && !!status?.telegram_admin_set;
  }
  if (sectionId === "youtube-history") {
    return !!status?.youtube_cookies_set;
  }
  return false;
}

function stepHint(sectionId: string, status?: SettingsStatus): string {
  if (sectionId === "google") {
    if (!status?.google_oauth_configured) return "Save the Google client ID and secret, then authorize Google.";
    if (!status?.google_oauth_authorized) return "Credentials are saved. Authorize Google to create the refresh token.";
    return "Google is configured and authorized.";
  }
  if (sectionId === "telegram") return "Add the bot token and every destination chat ID.";
  if (sectionId === "youtube-history") return "Paste cookies from a logged-in browser session.";
  return "";
}
