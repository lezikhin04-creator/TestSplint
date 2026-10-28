import type { SessionResponse } from '@splint/shared';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message);
    this.name = 'ApiError';
  }
}

let session: SessionResponse | null = null;
export function setApiSession(value: SessionResponse | null): SessionResponse | null {
  // Consent/preferences return the same session without reissuing its short-lived
  // bearer. Keep that credential in memory only while the session is unchanged.
  if (value && session && value.user.id === session.user.id && value.csrfToken === session.csrfToken && !value.accessToken && session.accessToken) {
    value = { ...value, accessToken: session.accessToken };
  }
  session = value;
  return session;
}

export function requestHeaders(method = 'GET', key?: string): Headers {
  const headers = new Headers();
  if (session?.accessToken) headers.set('Authorization', `Bearer ${session.accessToken}`);
  if (!['GET', 'HEAD'].includes(method)) {
    headers.set('Content-Type', 'application/json');
    if (session?.csrfToken) headers.set('X-CSRF-Token', session.csrfToken);
    headers.set('Idempotency-Key', key ?? crypto.randomUUID());
  }
  return headers;
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; key?: string; signal?: AbortSignal } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method, credentials: 'include', headers: requestHeaders(method, options.key),
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK_ERROR', 'Не удалось связаться со Splint. Проверьте подключение и попробуйте снова.');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error?: { code?: string; message?: string } }).error : undefined;
    throw new ApiError(detail?.code ?? 'REQUEST_FAILED', detail?.message ?? 'Не получилось выполнить действие. Попробуйте еще раз.', response.status);
  }
  return payload as T;
}

export async function downloadResult(runId: string, title: string) {
  const response = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/export`, {
    credentials: 'include', headers: requestHeaders(),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? 'Не удалось сохранить изображение. Попробуйте снова.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `splint-${title.replace(/[^\p{L}\p{N}_-]/gu, '-').slice(0, 64)}.png`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function bootstrapRequestId(initData: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(initData));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const key = `splint.bootstrap.${hash}`;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const stored = JSON.parse(raw) as { id?: string; at?: number };
      if (typeof stored.id === 'string' && typeof stored.at === 'number' && Date.now() - stored.at < 300_000) return stored.id;
    }
  } catch { /* The server remains authoritative if browser storage is unavailable. */ }
  const id = crypto.randomUUID();
  try { sessionStorage.setItem(key, JSON.stringify({ id, at: Date.now() })); } catch { /* No raw initData or credentials are persisted. */ }
  return id;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Что-то пошло не так. Попробуйте снова.';
}
