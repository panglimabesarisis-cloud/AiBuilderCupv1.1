function stripBase64(val: any): any {
  if (typeof val === 'string') {
    return val.startsWith('data:') ? '' : val;
  }
  if (Array.isArray(val)) {
    return val.map(stripBase64);
  }
  if (val && typeof val === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (typeof v === 'string' && v.startsWith('data:')) {
        continue;
      }
      out[k] = stripBase64(v);
    }
    return out;
  }
  return val;
}

export function safeSetCache(key: string, list: any[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const safeList = (Array.isArray(list) ? list : []).slice(0, 200).map(stripBase64);
  const serialized = JSON.stringify(safeList);
  try {
    window.localStorage.setItem(key, serialized);
  } catch {
    try {
      window.localStorage.removeItem(key);
      window.localStorage.setItem(key, serialized);
    } catch {
      // Ignore secondary quota failure
    }
  }
}
