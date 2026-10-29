import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getServerToken } from '../services/firebaseSession';

let cachedClientInfo: { ip: string; userAgent: string } | null = null;

/**
 * Mengambil IP publik/lokal asli dan User-Agent client dari backend /api/client-info
 * dengan fallback ke /api/whoami dan api.ipify.org
 */
export async function getRealClientIp(): Promise<{ ip: string; userAgent: string }> {
  if (cachedClientInfo && cachedClientInfo.ip && cachedClientInfo.ip !== 'Unknown IP') {
    return cachedClientInfo;
  }

  try {
    const res = await fetch('/api/client-info');
    if (res.ok) {
      const data = await res.json();
      if (data?.ip) {
        cachedClientInfo = {
          ip: String(data.ip),
          userAgent: String(data.userAgent || navigator.userAgent),
        };
        return cachedClientInfo;
      }
    }
  } catch {
    // ignore and try fallback
  }

  try {
    const res = await fetch('/api/whoami');
    if (res.ok) {
      const data = await res.json();
      if (data?.ip) {
        cachedClientInfo = {
          ip: String(data.ip),
          userAgent: String(data.userAgent || navigator.userAgent),
        };
        return cachedClientInfo;
      }
    }
  } catch {
    // ignore and try ipify fallback
  }

  try {
    const extRes = await fetch('https://api.ipify.org?format=json');
    if (extRes.ok) {
      const extData = await extRes.json();
      if (extData?.ip) {
        cachedClientInfo = {
          ip: String(extData.ip),
          userAgent: navigator.userAgent,
        };
        return cachedClientInfo;
      }
    }
  } catch {
    // ignore
  }

  return {
    ip: '127.0.0.1',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Browser Client',
  };
}

export interface AuditPayload {
  action: string;
  module: string;
  details: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  overrideUser?: {
    name?: string;
    email?: string;
    role?: string;
  };
}

/**
 * Resolves the currently active user from Firebase Auth and active POS/Dashboard session storage
 */
export function resolveActiveAuditUser(overrideUser?: {
  name?: string;
  email?: string;
  role?: string;
}): { userName: string; userEmail: string; userRole: string } {
  const currentUser = auth?.currentUser;

  let storedStaff: any = {};
  try {
    const rawActivePos = localStorage.getItem('active_pos_staff');
    const rawActiveCashier = localStorage.getItem('riskcart_active_cashier');
    const rawAuthSession = localStorage.getItem('riskcart_auth_session');
    if (rawActivePos) {
      storedStaff = JSON.parse(rawActivePos) || {};
    } else if (rawActiveCashier) {
      storedStaff = JSON.parse(rawActiveCashier) || {};
    } else if (rawAuthSession) {
      storedStaff = JSON.parse(rawAuthSession) || {};
    }
  } catch {
    storedStaff = {};
  }

  const userName =
    overrideUser?.name ||
    storedStaff?.name ||
    storedStaff?.displayName ||
    currentUser?.displayName ||
    (currentUser?.email ? currentUser.email.split('@')[0] : '') ||
    'Owner / Staff Aktif';

  const userEmail =
    overrideUser?.email ||
    storedStaff?.email ||
    currentUser?.email ||
    storedStaff?.uid ||
    currentUser?.uid ||
    'staff@riskcart.id';

  const userRole =
    overrideUser?.role ||
    storedStaff?.role ||
    localStorage.getItem('riskcart_active_role') ||
    'Owner / Admin';

  return { userName, userEmail, userRole };
}

/**
 * Mencatat aktivitas secara real-time ke koleksi Firestore `audit_logs`
 * lengkap dengan nama user asli, email, role, dan alamat IP asli.
 */
export async function logRealAudit(payload: AuditPayload): Promise<void> {
  try {
    const clientInfo = await getRealClientIp();
    const { userName, userEmail, userRole } = resolveActiveAuditUser(payload.overrideUser);
    const nowIso = new Date().toISOString();
    const formattedUser = `${userName}${userRole ? ` (${userRole})` : ''}`;

    const docData = {
      action: payload.action,
      type: payload.action,
      module: payload.module,
      details: payload.details,
      target: payload.details,
      severity: payload.severity || 'INFO',
      userName,
      user: formattedUser,
      staffName: userName,
      userEmail,
      userRole,
      ip: clientInfo.ip,
      userAgent: clientInfo.userAgent.slice(0, 250),
      verified: Boolean(getServerToken() || auth?.currentUser),
      storeId: 'store_001',
      timestamp: serverTimestamp(),
      createdAt: nowIso,
    };

    await addDoc(collection(db, 'audit_logs'), docData);
  } catch (err) {
    console.error('[AuditLogger] Gagal mencatat audit log:', err);
  }
}

/**
 * Helper singkat recordAuditLog(action, module, details, severity?)
 */
export async function recordAuditLog(
  action: string,
  module: string,
  details: string,
  severity: 'INFO' | 'WARNING' | 'CRITICAL' = 'INFO'
): Promise<void> {
  return logRealAudit({ action, module, details, severity });
}
