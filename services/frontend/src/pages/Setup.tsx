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
    <div className="min-h-screen bg-bg text-text">
      <div className="page-container grid min-h-screen items-center gap-12 py-12 lg:grid-cols-[minmax(0,1.1fr)_460px]">
        <div className="max-w-4xl">
          <div className="flex items-center gap-3">
            <Logo className="h-4 w-4" />
            <div className="font-display text-[28px] leading-none tracking-[-0.04em]">Yagami</div>
          </div>
          <div className="mono-eyebrow mt-10">First operator handoff</div>
          <h1 className="editorial-display mt-4 text-[clamp(3.75rem,9vw,6.75rem)]">Create the admin desk.</h1>
          <p className="mt-6 max-w-xl text-[18px] leading-[1.5] text-ash">
            This is a one-time account setup. After sign-in, Yagami will guide Google, Telegram,
            and watch-history access before the dashboard opens.
          </p>
        </div>

        <form onSubmit={submit} className="surface-light space-y-5 p-8 sm:p-10">
          <div className="surface-paper p-4 text-[15px] leading-[1.5] text-slateSoft">
            Credentials are stored in the database, not on disk. Once this account exists, all
            future access flows through the normal sign-in screen.
          </div>
          <Field label="Admin username">
            <input className="input-light" value={u} onChange={(e) => setU(e.target.value)} />
          </Field>
          <Field label="Password (min 8 chars)">
            <input className="input-light" type="password" value={p} onChange={(e) => setP(e.target.value)} />
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
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{label}</div>
      {children}
    </label>
  );
}
