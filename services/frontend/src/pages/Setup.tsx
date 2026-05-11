import { useState } from "react";
import { apiPost } from "../lib/api";
import { Logo } from "./Login";

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
    <div className="h-screen grid place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <Logo />
          <div>
            <div className="text-xl font-semibold tracking-tight">Welcome to Yagami</div>
            <div className="text-xs text-muted">Create your admin account to begin</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 bg-panel/60 backdrop-blur border border-border rounded-2xl p-6 shadow-2xl">
          <div className="text-sm text-muted leading-relaxed">
            This is a one-time account setup. After sign-in, Yagami will walk you through Google, Telegram, and YouTube cookies before the dashboard opens. Credentials are stored in the database, never on disk.
          </div>
          <Field label="Admin username">
            <input className={inputCls} value={u} onChange={(e) => setU(e.target.value)} />
          </Field>
          <Field label="Password (min 8 chars)">
            <input className={inputCls} type="password" value={p} onChange={(e) => setP(e.target.value)} />
          </Field>
          {err && <div className="text-err text-sm">{err}</div>}
          <button disabled={busy} className={btnPrimary}>
            {busy ? "Creating…" : "Create account"}
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
