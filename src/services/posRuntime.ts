/**
 * RiskCart POS runtime helpers: pengaturan POS global (cache realtime), audit log asli,
 * verifikasi PIN otorisasi, format tanggal sesuai zona waktu, generator SKU.
 */
import { addDoc, collection, doc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { getServerToken } from './firebaseSession';
import { getRealClientIp, resolveActiveAuditUser } from '../utils/auditLogger';

// ---------------------------------------------------------------------------
// Cache pengaturan POS (stores/store_001/settings/pos + settings/pos + settings/global + settings/store)
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
// Audit log asli (IP & identitas dari server /api/client-info + sesi user aktif)
// ---------------------------------------------------------------------------
export async function getClientIp(): Promise<string> {
  const info = await getRealClientIp();
  return info.ip;
}

export function currentActorName(): string {
  const resolved = resolveActiveAuditUser();
  return `${resolved.userName}${resolved.userRole ? ` (${resolved.userRole})` : ''}`;
}

export async function logAudit(entry: {
  action: string;
  target: string;
  module?: string;
  details?: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  user?: string;
  userRole?: string;
  type?: string;
  meta?: Record<string, any>;
}) {
  const token = getServerToken();
  const activeUser = resolveActiveAuditUser(
    entry.user || entry.userRole
      ? { name: entry.user, role: entry.userRole }
      : undefined
  );
  const clientInfo = await getRealClientIp();
  const detailsText = entry.details || entry.target || '';
  const moduleName = entry.module || entry.type || 'POS / Store Settings';
  const body = {
    ...entry,
    module: moduleName,
    details: detailsText,
    target: detailsText,
    severity: entry.severity || 'INFO',
    userName: activeUser.userName,
    user: entry.user || `${activeUser.userName} (${activeUser.userRole})`,
    userEmail: activeUser.userEmail,
    userRole: entry.userRole || activeUser.userRole,
    ip: clientInfo.ip,
    userAgent: clientInfo.userAgent,
  };
  try {
    const r = await fetch('/api/audit-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (r.ok) return;
  } catch {}
  // Fallback: tulis langsung ke Firestore audit_logs dengan IP asli
  try {
    const nowIso = new Date().toISOString();
    await addDoc(collection(db, 'audit_logs'), {
      ...body,
      ip: clientInfo.ip,
      userAgent: clientInfo.userAgent.slice(0, 200),
      verified: Boolean(token),
      storeId: 'store_001',
      createdAt: nowIso,
      timestamp: serverTimestamp(),
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
