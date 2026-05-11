/** Tiny fetch wrapper. Cookies are httpOnly so credentials: include is mandatory. */
export async function api<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(path.startsWith("/") ? path : `/api/${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    ...init,
  });
  if (res.status === 401 && !path.includes("auth/me")) {
    window.dispatchEvent(new CustomEvent("yagami:unauthorized"));
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    let fields: Record<string, string> | undefined;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
      if (body?.fields && typeof body.fields === "object") fields = body.fields;
    } catch {}
    const err = new Error(msg) as Error & { fields?: Record<string, string>; status?: number };
    err.fields = fields;
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const apiGet = <T,>(p: string) => api<T>(p);
export const apiPost = <T,>(p: string, body?: unknown) =>
  api<T>(p, { method: "POST", body: body ? JSON.stringify(body) : undefined });
export const apiPut = <T,>(p: string, body?: unknown) =>
  api<T>(p, { method: "PUT", body: body ? JSON.stringify(body) : undefined });
