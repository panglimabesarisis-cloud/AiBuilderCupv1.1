import { getServerToken, ensureFirebaseSession } from '../firebase';

export { getServerToken, ensureFirebaseSession };

export function apiFetch(url: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => {
        headers[k] = v;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) {
        headers[k] = v;
      }
    } else {
      Object.assign(headers, init.headers);
    }
  }
  headers.Authorization = `Bearer ${getServerToken()}`;
  return fetch(url, {
    ...init,
    headers,
  });
}
