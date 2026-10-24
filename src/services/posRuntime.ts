/**
 * RiskCart POS runtime helpers: pengaturan POS global (cache realtime), audit log asli,
 * verifikasi PIN otorisasi, format tanggal sesuai zona waktu, generator SKU.
 */
import { addDoc, collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { getServerToken } from './firebaseSession';

// ---------------------------------------------------------------------------
// Cache pengaturan POS (stores/store_001/settings/pos) untuk modul non-React / fallback
// ---------------------------------------------------------------------------
let posSettingsCache: Record<string, any> = {};
let started = false;
const listeners = new Set<(s: Record<string, any>) => void>();

export function startPosSettingsSync() {
  if (started) return;
  started = true;
  try {
    const raw = localStorage.getItem('riskcart_pos_settings_cache');
    if (raw) posSettingsCache = JSON.parse(raw) || {};
  } catch {}
  try {
    onSnapshot(
      doc(db, 'stores', 'store_001', 'settings', 'pos'),
      (snap) => {
        if (!snap.exists()) return;
        posSettingsCache = { ...posSettingsCache, ...snap.data() };
        try {
          localStorage.setItem('riskcart_pos_settings_cache', JSON.stringify(posSettingsCache));
        } catch {}
        listeners.forEach((fn) => fn(posSettingsCache));
      },
      () => {}
    );
  } catch {}
}

export function getPosSettings(): Record<string, any> {
  startPosSettingsSync();
  return posSettingsCache;
}

export function onPosSettings(fn: (s: Record<string, any>) => void) {
  startPosSettingsSync();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Ambang stok minimum default (Global Setup) — dipakai bila produk tidak punya minStock sendiri. */
export function getDefaultMinStock(): number {
  const v = Number(getPosSettings().lowStockDefaultAlert);
  return Number.isFinite(v) && v >= 0 ? v : 10;
}

/** Zona waktu IANA dari Global Setup, mis. "Asia/Jakarta (WIB)" -> "Asia/Jakarta". */
export function getSystemTimeZone(): string {
  const raw = String(getPosSettings().systemTimezone || 'Asia/Jakarta');
  return raw.split(' ')[0] || 'Asia/Jakarta';
}

export function formatDateTimeTz(value: string | number | Date | undefined, tz = getSystemTimeZone()): string {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const label = tz === 'Asia/Makassar' ? 'WITA' : tz === 'Asia/Jayapura' ? 'WIT' : 'WIB';
  return `${d.toLocaleString('id-ID', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} ${label}`;
}

/** Tanggal (YYYY-MM-DD) di zona waktu toko — untuk aturan "struk hari sebelumnya". */
export function dayKeyTz(value: string | number | Date, tz = getSystemTimeZone()): string {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: tz });
}

/** Generator SKU dari format Global Setup. Token: {RAND4} {RAND6} {YY} {MM} {YYMM} {SEQ} */
export function generateSku(format?: string): string {
  const f = String(format || getPosSettings().skuPrefixFormat || 'RC-{RAND4}');
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const rand = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
  return f
    .replace(/\{RAND4\}/g, rand(4))
    .replace(/\{RAND6\}/g, rand(6))
    .replace(/\{YYMM\}/g, yy + mm)
    .replace(/\{YY\}/g, yy)
    .replace(/\{MM\}/g, mm)
    .replace(/\{SEQ\}/g, String(Date.now()).slice(-5));
}

// ---------------------------------------------------------------------------
// Audit log asli (IP & identitas dari server)
// ---------------------------------------------------------------------------
let cachedIp: string | null = null;
export async function getClientIp(): Promise<string> {
  if (cachedIp) return cachedIp;
  try {
    const r = await fetch('/api/whoami');
    const j = await r.json();
    cachedIp = String(j?.ip || '');
  } catch {
    cachedIp = '';
  }
  return cachedIp;
}

export function currentActorName(): string {
  try {
    const c = JSON.parse(localStorage.getItem('riskcart_active_cashier') || 'null');
    if (c?.name) return `${c.name}${c.role ? ` (${c.role})` : ''}`;
  } catch {}
  return '';
}

export async function logAudit(entry: {
  action: string;
  target: string;
  user?: string;
  userRole?: string;
  type?: string;
  meta?: Record<string, any>;
}) {
  const token = getServerToken();
  const body = { ...entry, user: entry.user || currentActorName() || undefined };
  try {
    const r = await fetch('/api/audit-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (r.ok) return;
  } catch {}
  // Fallback: tulis langsung (IP tetap diambil dari server /api/whoami)
  try {
    const nowIso = new Date().toISOString();
    await addDoc(collection(db, 'audit_logs'), {
      ...body,
      ip: await getClientIp(),
      userAgent: navigator.userAgent.slice(0, 200),
      verified: false,
      storeId: 'store_001',
      createdAt: nowIso,
      timestamp: nowIso,
    });
  } catch {}
}

// ---------------------------------------------------------------------------
// Otorisasi PIN (Owner / Supervisor / Manager)
// ---------------------------------------------------------------------------
export async function verifyApproverPin(pin: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const r = await fetch('/api/settings/pin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'approver', pin: String(pin || '').trim() }),
    });
    const j = await r.json().catch(() => ({}));
    return { valid: Boolean(j?.valid), error: j?.error };
  } catch (e: any) {
    return { valid: false, error: e?.message || 'Server tidak dapat dihubungi' };
  }
}
