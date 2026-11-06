import { beginProcessing } from './processing.js';

/**
 * Every request shows the processing scanner while it's in flight, unless it's a quiet one: a background poll
 * (unread counts, a board refresh) passes { quiet: true } so the page doesn't light up on its own every minute.
 */
async function request(method, url, body, { quiet = false } = {}) {
  const isForm = body instanceof FormData;
  const end = quiet ? null : beginProcessing();
  try {
    const res = await fetch(`/api${url}`, {
      method,
      credentials: 'include',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    end?.();
  }
}

export const api = {
  get: (url, opts) => request('GET', url, undefined, opts),
  post: (url, body, opts) => request('POST', url, body, opts),
  put: (url, body, opts) => request('PUT', url, body, opts),
  del: (url, opts) => request('DELETE', url, undefined, opts),
};
