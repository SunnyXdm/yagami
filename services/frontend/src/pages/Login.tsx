import { useState } from "react";
import { apiPost } from "../lib/api";

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
    <div className="h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <Logo />
          <div>
            <div className="font-display text-3xl leading-none tracking-tight">Yagami</div>
            <div className="text-xs text-muted">Sign in to continue</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 bg-panel/60 backdrop-blur border border-border rounded-2xl p-6 shadow-2xl">
          <Field label="Username">
            <input className={inputCls} value={u} onChange={(e) => setU(e.target.value)} autoFocus />
          </Field>
          <Field label="Password">
            <input className={inputCls} type="password" value={p} onChange={(e) => setP(e.target.value)} />
          </Field>
          {err && <div className="text-err text-sm">{err}</div>}
          <button disabled={busy} className={btnPrimary}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-lg bg-bg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent2/60";
const btnPrimary = "w-full rounded-lg bg-accent text-white text-sm font-medium py-2 hover:bg-accent/90 disabled:opacity-50 transition";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-muted mb-1.5">{label}</div>
      {children}
    </label>
  );
}

export function Logo() {
  return (
    <div className="grid h-11 w-11 place-items-center rounded-[16px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,106,66,.95),rgba(84,146,255,.88))] font-display text-xl text-white shadow-glow">
      Y
    </div>
  );
}
