import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./lib/api";
import { Login } from "./pages/Login";
import { Setup } from "./pages/Setup";
import { Shell } from "./components/Shell";
import { Dashboard } from "./pages/Dashboard";
import { SettingsPage } from "./pages/Settings";
import { LogsPage } from "./pages/Logs";
import { DownloadsPage } from "./pages/Downloads";
import { EventsPage } from "./pages/Events";
import { ToastHost } from "./components/Toast";
import { Onboarding } from "./pages/Onboarding";
import { isSystemReady, type SettingsStatus } from "./lib/settings";

export type Page = "dashboard" | "events" | "downloads" | "logs" | "settings";

interface User { id: string; username: string }
interface SetupStatus { setup_complete: boolean; version: string }

export function App() {
  const [page, setPage] = useState<Page>(() => pageFromLocation());
  const [authVersion, setAuthVersion] = useState(0);

  useEffect(() => {
    const onUnauth = () => setAuthVersion((v) => v + 1);
    window.addEventListener("yagami:unauthorized", onUnauth);
    return () => window.removeEventListener("yagami:unauthorized", onUnauth);
  }, []);

  useEffect(() => {
    const onPop = () => setPage(pageFromLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: Page) => {
    setPage(next);
    const path = pathForPage(next);
    if (window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }
  }, []);

  const status = useQuery({
    queryKey: ["status"],
    queryFn: () => apiGet<SetupStatus>("setup/status"),
  });

  const me = useQuery({
    queryKey: ["me", authVersion],
    queryFn: async () => {
      try { return await apiGet<User>("auth/me"); } catch { return null; }
    },
    enabled: !!status.data?.setup_complete,
  });

  const setupReadiness = useQuery({
    queryKey: ["settings-status"],
    queryFn: () => apiGet<SettingsStatus>("settings/status"),
    enabled: !!me.data,
    refetchInterval: 10_000,
  });

  if (status.isLoading) return <FullSpinner />;
  if (!status.data?.setup_complete) return <Setup onDone={() => { status.refetch(); me.refetch(); }} />;
  if (me.isLoading) return <FullSpinner />;
  if (!me.data) return <Login onLogin={() => me.refetch()} />;
  if (setupReadiness.isLoading) return <FullSpinner />;
  if (!isSystemReady(setupReadiness.data)) {
    return (
      <>
        <Onboarding onDone={() => setupReadiness.refetch()} />
        <ToastHost />
      </>
    );
  }

  return (
    <>
      <Shell user={me.data} page={page} onPage={navigate} onLogout={() => setAuthVersion((v) => v + 1)}>
        {page === "dashboard" && <Dashboard />}
        {page === "events" && <EventsPage />}
        {page === "downloads" && <DownloadsPage />}
        {page === "logs" && <LogsPage />}
        {page === "settings" && <SettingsPage />}
      </Shell>
      <ToastHost />
    </>
  );
}

function pageFromLocation(): Page {
  const first = window.location.pathname.split("/").filter(Boolean)[0];
  if (first === "events" || first === "downloads" || first === "logs" || first === "settings") {
    return first;
  }
  return "dashboard";
}

function pathForPage(page: Page): string {
  return page === "dashboard" ? "/" : `/${page}`;
}

function FullSpinner() {
  return (
    <div className="grid h-screen w-screen place-items-center bg-bg text-text">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 rounded-full bg-accent animate-pulse" />
        <span className="mono-eyebrow text-ash">Preparing the control surface</span>
      </div>
    </div>
  );
}
