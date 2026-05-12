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
      <div className="page-container grid min-h-screen items-center gap-12 py-12 lg:grid-cols-[minmax(0,1.1fr)_420px]">
        <div className="max-w-4xl">
          <div className="flex items-center gap-3">
            <Logo className="h-4 w-4" />
            <div className="font-display text-[28px] leading-none tracking-[-0.04em]">Yagami</div>
          </div>
          <div className="mono-eyebrow mt-10">Operator access</div>
          <h1 className="editorial-display mt-4 text-[clamp(4rem,10vw,7rem)]">Structure steadies the stream.</h1>
          <p className="mt-6 max-w-xl text-[18px] leading-[1.5] text-ash">
            Sign in to manage the activity archive, delivery lanes, and runtime ledger.
          </p>
        </div>

        <form onSubmit={submit} className="surface-light space-y-5 p-8 sm:p-10">
          <div>
            <div className="mono-eyebrow text-muted">Sign in</div>
            <div className="mt-3 text-[32px] leading-[1.05] tracking-[-0.02em] text-ink">Open the control surface.</div>
            <div className="mt-2 text-[15px] leading-[1.5] text-muted">
              Use the admin account you created during initial setup.
            </div>
          </div>
          <Field label="Username">
            <input className="input-light" value={u} onChange={(e) => setU(e.target.value)} autoFocus />
          </Field>
          <Field label="Password">
            <input className="input-light" type="password" value={p} onChange={(e) => setP(e.target.value)} />
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
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{label}</div>
      {children}
    </label>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return <span className={cn("inline-block h-3 w-3 rounded-full bg-accent", className)} />;
}
