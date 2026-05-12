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
      <div className="min-h-screen grid place-items-center px-4 bg-bg text-text">
        <Loader2 className="text-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="page-container py-8 md:py-10 lg:py-12">
        <div className="hero-stripe-band mb-8 rounded-[16px] p-px">
          <header className="command-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[12px] text-muted">
              <span className="h-2 w-2 rounded-full bg-white/55" />
              <span className="h-2 w-2 rounded-full bg-white/35" />
              <span className="h-2 w-2 rounded-full bg-white/15" />
              <span className="ml-3 font-medium text-body">Required setup</span>
              <div className="ml-auto flex items-center gap-2">
                <span className="keycap">⌘</span>
                <span className="keycap">↵</span>
              </div>
            </div>

            <div className="grid gap-8 px-6 py-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
              <div>
                <div className="flex items-center gap-3">
                  <Logo className="h-10 w-10" />
                  <div>
                    <div className="text-[14px] text-body">Yagami</div>
                    <div className="text-[24px] font-semibold leading-none text-text">Finish the operator handoff.</div>
                  </div>
                </div>
                <h1 className="mt-8 max-w-4xl text-[clamp(2.5rem,5vw,4rem)] font-semibold leading-[1.1] text-text">
                  Connect the required integrations before opening the dashboard.
                </h1>
                <p className="mt-4 max-w-2xl text-[18px] leading-[1.6] text-body">
                  The setup flow keeps the same command-surface language as the rest of the app: dark-only chrome, hairline borders, and one primary action at a time.
                </p>
              </div>
              <ReadinessPill ready={ready} completed={completedCount(status.data)} total={REQUIRED_STATUS_KEYS.length} />
            </div>
          </header>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_1fr]">
          <aside className="space-y-2">
            {SETUP_SECTIONS.map((section, index) => {
              const active = index === step;
              const complete = sectionComplete(section.id, status.data);
              return (
                <button
                  key={section.id}
                  onClick={() => setStep(index)}
                  className={cn(
                    "w-full rounded-[10px] border px-4 py-4 text-left transition",
                    active ? "border-white/12 bg-elevated text-text" : "border-border bg-panel text-body hover:bg-elevated hover:text-text",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", complete ? "bg-accentGreen" : "bg-accentYellow")} />
                    <span className="text-[16px] leading-[1.4]">{section.title}</span>
                  </div>
                  <div className="mt-2 text-[13px] leading-[1.5] text-muted">{section.summary}</div>
                </button>
              );
            })}
          </aside>

          <main className="command-card overflow-hidden">
            <div className="border-b border-border px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-medium text-muted">Step {step + 1} of {SETUP_SECTIONS.length}</div>
                <h1 className="mt-2 text-[28px] font-semibold leading-[1.15] text-text">{current.title}</h1>
                <p className="mt-2 text-[15px] leading-[1.6] text-body">{current.summary}</p>
              </div>
              {current.id === "google" && (
                <button
                  type="button"
                  disabled={oauth.isPending || save.isPending || dirtyCount > 0}
                  onClick={() => oauth.mutate()}
                  className="button-brand gap-2"
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

            <div className="border-t border-border px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-[13px] text-body">
                {dirtyCount > 0 ? `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"} in this step.` : stepHint(current.id, status.data)}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={step === 0}
                  onClick={() => setStep((value) => Math.max(0, value - 1))}
                  className="button-secondary-light gap-2"
                >
                  <ArrowLeft size={15} /> Back
                </button>
                <button
                  type="button"
                  disabled={dirtyCount === 0 || save.isPending}
                  onClick={() => save.mutate(currentDraft)}
                  className={cn(dirtyCount === 0 ? "button-secondary-light gap-2" : "button-primary-light gap-2")}
                >
                  <Save size={15} /> {save.isPending ? "Saving..." : "Save step"}
                </button>
                {step < SETUP_SECTIONS.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setStep((value) => Math.min(SETUP_SECTIONS.length - 1, value + 1))}
                    className="button-secondary-light gap-2"
                  >
                    Next <ArrowRight size={15} />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!ready || dirtyCount > 0}
                    onClick={onDone}
                    className={cn(!ready || dirtyCount > 0 ? "button-secondary-light gap-2" : "button-primary-light gap-2")}
                  >
                    <CheckCircle2 size={15} /> Open dashboard
                  </button>
                )}
              </div>
            </div>
          </main>
        </div>

        {!ready && (
          <section className="surface-dark mt-6 p-6">
            <div className="text-[14px] font-medium text-text">Still needed</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {missingLabels(status.data).map((label) => (
                <div key={label} className="rounded-[8px] border border-border bg-card px-3 py-3 text-[13px] text-body">{label}</div>
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
      "inline-flex items-center gap-3 rounded-[10px] border bg-panel px-4 py-3",
      ready ? "border-white/12 text-text" : "border-border text-text",
    )}>
      <span className={cn("h-2 w-2 rounded-full", ready ? "bg-accentGreen" : "bg-accentYellow")} />
      <span className="text-[13px] text-body">{ready ? "Ready" : `${completed}/${total} required checks complete`}</span>
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
    youtube_cookies_file_ready: "Downloader cookie file",
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
    return !!status?.youtube_cookies_set && !!status?.youtube_cookies_file_ready;
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
  if (sectionId === "youtube-history") {
    if (!status?.youtube_cookies_set) return "Paste cookies from a logged-in browser session.";
    if (!status?.youtube_cookies_file_ready) return "Cookies are saved. Wait a few seconds for the downloader to sync its shared cookies file.";
    return "Cookies are saved and synced to the downloader.";
  }
  return "";
}
