import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { adminAuth, type DecodedFirebaseToken } from '../lib/firebase-admin.ts';

export interface AuthRequest extends Request {
  user?: DecodedFirebaseToken & {
    uid: string;
    role?: string;
    email?: string;
  };
}

function getSessionSigningSecret(): string {
  const s = String(process.env.OTP_HMAC_SECRET || '').trim();
  if (s.length < 32) throw new Error('OTP_HMAC_SECRET wajib diisi minimal 32 karakter');
  return s;
}

const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function createSignedSessionToken(payload: {
  uid: string;
  role: string;
  email?: string;
  expiresInMs?: number;
}): string {
  const exp = Date.now() + (payload.expiresInMs || DEFAULT_SESSION_TTL_MS);
  const body = Buffer.from(
    JSON.stringify({
      uid: payload.uid,
      role: String(payload.role || '').toLowerCase(),
      email: payload.email || '',
      exp,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSigningSecret())
    .update(body)
    .digest('base64url');
  return `rcs.${body}.${sig}`;
}

export function verifySignedSessionToken(token: string): { uid: string; role: string; email?: string } | null {
  if (!token || !token.startsWith('rcs.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1] || !parts[2]) return null;
  const [, body, sig] = parts;
  const expected = crypto.createHmac('sha256', getSessionSigningSecret()).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (!p || !p.uid || typeof p.exp !== 'number' || Date.now() > p.exp) return null;
    return { uid: String(p.uid), role: String(p.role || '').toLowerCase(), email: p.email ? String(p.email) : undefined };
  } catch { return null; }
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ status: 'error', error: 'Unauthorized: Missing Bearer token' });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ status: 'error', error: 'Unauthorized: Empty Bearer token' });
  }

  // 1. Check signed server session token (issued after server login, PIN, or OTP verification)
  if (token.startsWith('rcs.')) {
    const signedSession = verifySignedSessionToken(token);
    if (signedSession) {
      req.user = signedSession as any;
      return next();
    }
    return res.status(401).json({ status: 'error', error: 'Unauthorized: Expired or invalid session token' });
  }

  // 2. Verify Firebase ID Token via Firebase Admin Auth
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    const claimRole = String((decodedToken as any).role || '').trim().toLowerCase();
    if (decodedToken.firebase?.sign_in_provider === 'anonymous' || !claimRole) {
      return res.status(401).json({ status: 'error', error: 'Unauthorized: Anonymous or missing role claim' });
    }
    req.user = {
      ...decodedToken,
      uid: decodedToken.uid,
      role: claimRole,
    };
    return next();
  } catch {
    return res.status(401).json({ status: 'error', error: 'Unauthorized: Invalid or expired token' });
  }
};

export const requireRole = (allowedRoles: string[]) => {
  const normalizedAllowed = allowedRoles.map((r) => r.toLowerCase());
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const userRole = String(req.user?.role || '').toLowerCase();
    if (!userRole) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized: Role not verified' });
    }
    if (normalizedAllowed.includes(userRole) || userRole === 'owner' || userRole === 'super_admin') {
      return next();
    }
    return res.status(403).json({
      status: 'error',
      message: 'Akses ditolak: Role tidak memiliki izin untuk aksi ini.',
    });
  };
};
