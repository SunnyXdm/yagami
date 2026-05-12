import { useState } from "react";
import { apiPost } from "../lib/api";
import { Logo } from "./Login";
import { cn } from "../lib/utils";

export function Setup({ onDone }: { onDone: () => void }) {
  const [u, setU] = useState("admin");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try { await apiPost("setup", { username: u, password: p }); onDone(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="page-container grid min-h-screen items-center gap-10 py-12 lg:grid-cols-[minmax(0,1.15fr)_460px]">
        <div className="hero-stripe-band rounded-[16px] p-px">
          <div className="command-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[12px] text-muted">
              <span className="h-2 w-2 rounded-full bg-white/55" />
              <span className="h-2 w-2 rounded-full bg-white/35" />
              <span className="h-2 w-2 rounded-full bg-white/15" />
              <span className="ml-3 font-medium text-body">Initial setup</span>
              <div className="ml-auto flex items-center gap-2">
                <span className="keycap">⌘</span>
                <span className="keycap">N</span>
              </div>
            </div>

            <div className="px-6 py-6">
              <div className="flex items-center gap-3">
                <Logo className="h-10 w-10" />
                <div>
                  <div className="text-[14px] text-body">Yagami</div>
                  <div className="text-[24px] font-semibold leading-none text-text">Create the first operator account.</div>
                </div>
              </div>

              <h1 className="mt-8 max-w-2xl text-[40px] font-semibold leading-[1.1] text-text lg:text-[54px]">
                Start with the account that unlocks the rest of the control surface.
              </h1>
              <p className="mt-4 max-w-xl text-[18px] leading-[1.6] text-body">
                After sign-in, Yagami will guide Google, Telegram, and watch-history access before opening the full dashboard.
              </p>

              <div className="mt-8 rounded-[16px] border border-border bg-panel p-4">
                <div className="space-y-2">
                  {[
                    "Create admin account",
                    "Authorize Google",
                    "Connect Telegram destinations",
                    "Sync watch history cookies",
                  ].map((item, index) => (
                    <div
                      key={item}
                      className={cn(
                        "flex items-center justify-between rounded-[8px] border border-border px-4 py-3 text-[14px]",
                        index === 0 ? "bg-card text-text" : "bg-transparent text-body",
                      )}
                    >
                      <span>{item}</span>
                      <span className="keycap">↵</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="surface-dark space-y-5 p-8 sm:p-10">
          <div className="rounded-[10px] border border-border bg-card p-4 text-[15px] leading-[1.6] text-body">
            Credentials are stored in the database, not on disk. Once this account exists, all
            future access flows through the normal sign-in screen.
          </div>
          <Field label="Admin username">
            <input className="input-dark" value={u} onChange={(e) => setU(e.target.value)} />
          </Field>
          <Field label="Password (min 8 chars)">
            <input className="input-dark" type="password" value={p} onChange={(e) => setP(e.target.value)} />
          </Field>
          {err && <div className="text-sm text-err">{err}</div>}
          <button disabled={busy} className="button-primary-light w-full">
            {busy ? "Creating..." : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-2 text-[13px] font-medium text-muted">{label}</div>
      {children}
    </label>
  );
}
