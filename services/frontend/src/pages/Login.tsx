import { useState } from "react";
import { apiPost } from "../lib/api";
import { cn } from "../lib/utils";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try { await apiPost("auth/login", { username: u, password: p }); onLogin(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="page-container grid min-h-screen items-center gap-10 py-12 lg:grid-cols-[minmax(0,1.15fr)_420px]">
        <div className="hero-stripe-band rounded-[16px] p-px">
          <div className="command-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[12px] text-muted">
              <span className="h-2 w-2 rounded-full bg-white/55" />
              <span className="h-2 w-2 rounded-full bg-white/35" />
              <span className="h-2 w-2 rounded-full bg-white/15" />
              <span className="ml-3 font-medium text-body">Operator access</span>
              <div className="ml-auto flex items-center gap-2">
                <span className="keycap">⌘</span>
                <span className="keycap">K</span>
              </div>
            </div>

            <div className="px-6 py-6">
              <div className="flex items-center gap-3">
                <Logo className="h-10 w-10" />
                <div>
                  <div className="text-[14px] text-body">Yagami</div>
                  <div className="text-[24px] font-semibold leading-none text-text">Built like a command palette.</div>
                </div>
              </div>

              <h1 className="mt-8 max-w-2xl text-[40px] font-semibold leading-[1.1] text-text lg:text-[56px]">
                The live surface for watches, downloads, logs, and delivery.
              </h1>
              <p className="mt-4 max-w-xl text-[18px] leading-[1.6] text-body">
                Sign in to open the queue, inspect recent activity, and control every integration from one dark control surface.
              </p>

              <div className="mt-8 rounded-[16px] border border-border bg-panel p-4">
                <div className="rounded-[8px] border border-border bg-elevated px-4 py-3 text-[14px] text-body">
                  Search commands, queues, settings, and activity
                </div>
                <div className="mt-4 space-y-2">
                  {[
                    "Inspect live downloads",
                    "Open recent activity",
                    "Review service logs",
                  ].map((item, index) => (
                    <div key={item} className={cn(
                      "flex items-center justify-between rounded-[8px] border border-border px-4 py-3 text-[14px]",
                      index === 0 ? "bg-card text-text" : "bg-transparent text-body"
                    )}>
                      <span>{item}</span>
                      <div className="flex items-center gap-2">
                        <span className="keycap">↵</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="surface-dark space-y-5 p-8 sm:p-10">
          <div>
            <div className="text-[13px] font-medium text-muted">Sign in</div>
            <div className="mt-3 text-[28px] font-semibold leading-[1.15] text-text">Open the control surface.</div>
            <div className="mt-2 text-[15px] leading-[1.6] text-body">
              Use the admin account you created during initial setup.
            </div>
          </div>
          <Field label="Username">
            <input className="input-dark" value={u} onChange={(e) => setU(e.target.value)} autoFocus />
          </Field>
          <Field label="Password">
            <input className="input-dark" type="password" value={p} onChange={(e) => setP(e.target.value)} />
          </Field>
          {err && <div className="text-sm text-err">{err}</div>}
          <button disabled={busy} className="button-primary-light w-full">
            {busy ? "Signing in..." : "Sign in"}
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

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={cn("relative inline-grid place-items-center overflow-hidden rounded-[8px] border border-border bg-panel", className)}>
      <span className="absolute inset-[18%] rounded-[5px] border border-white/12" />
      <span className="absolute left-[22%] right-[22%] top-[34%] h-[2px] rounded-full bg-white/80" />
      <span className="absolute left-[22%] top-[58%] h-[2px] w-[24%] rounded-full bg-white/65" />
      <span className="absolute right-[22%] top-[58%] h-[2px] w-[18%] rounded-full bg-white/35" />
    </span>
  );
}
