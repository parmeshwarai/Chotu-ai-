import { auth } from './firebase';

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const user = auth.currentUser;
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (user) {
    const token = await user.getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed with status ${res.status}`) as Error & {
      status?: number;
      code?: string;
      requiresPaidKey?: boolean;
    };
    err.status = res.status;
    err.code = data?.code;
    err.requiresPaidKey = Boolean(data?.requiresPaidKey);
    throw err;
  }
  return data as T;
}
