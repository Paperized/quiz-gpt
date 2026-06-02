// ─── API ─────────────────────────────────────────────────────────────────────

const runtimePublicUrl = window.__APP_CONFIG__?.publicUrl?.trim();
export const apiBase = runtimePublicUrl ? runtimePublicUrl.replace(/\/$/, '') : '';

export async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, init);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? `Request failed: ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
