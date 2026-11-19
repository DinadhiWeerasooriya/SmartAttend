import { getOrCreateDeviceId } from './device';

const TOKEN_STORAGE_KEY = 'smartattend_auth_token';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export async function apiFetch<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  headers.set('X-Device-Id', getOrCreateDeviceId());

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || 'Unexpected server response' };
  }

  if (!res.ok) {
    const err = new Error(data?.reason || data?.error || `Request failed (${res.status})`) as Error & {
      status?: number;
      payload?: any;
    };
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  return data as T;
}

export async function downloadCsvReport(url: string, fallbackFilename: string) {
  const token = getAuthToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error('Failed to download attendance report.');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fallbackFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function formatDateTime(iso: string): { date: string; time: string; full: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { date: iso, time: '', full: iso };
  }
  const date = d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return { date, time, full: `${date} · ${time}` };
}
