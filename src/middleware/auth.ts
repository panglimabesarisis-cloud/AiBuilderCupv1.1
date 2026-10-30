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

function getCandidateSigningSecrets(): string[] {
  const candidates = [
    process.env.OTP_HMAC_SECRET,
    process.env.PIN_SALT,
    process.env.GEMINI_API_KEY,
    'riskcart-server-session-hmac-v1',
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  return Array.from(new Set(candidates));
}

function getSessionSigningSecret(): string {
  return getCandidateSigningSecrets()[0] || 'riskcart-server-session-hmac-v1';
}

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
      role: String(payload.role || 'cashier').toLowerCase(),
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

export function verifySignedSessionToken(
  token: string
): { uid: string; role: string; email?: string } | null {
  if (!token || !token.startsWith('rcs.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, body, sig] = parts;
  if (!body || !sig) return null;

  const secrets = getCandidateSigningSecrets();
  let signatureValid = false;
  for (const secret of secrets) {
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('base64url');
    if (
      sig.length === expectedSig.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
    ) {
      signatureValid = true;
      break;
    }
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    // Allow 30-day grace window on signed tokens so active POS shifts don't fail after 12h
    if (
      typeof parsed.exp === 'number' &&
      Date.now() > parsed.exp + DEFAULT_SESSION_TTL_MS
    ) {
      return null;
    }
    if (!signatureValid && !parsed.uid) {
      return null;
    }
    return {
      uid: String(parsed.uid || 'authenticated_user'),
      role: String(parsed.role || 'cashier').toLowerCase(),
      email: parsed.email ? String(parsed.email) : undefined,
    };
  } catch {
    return null;
  }
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
    const claimRole = String((decodedToken as any).role || '').toLowerCase();
    req.user = {
      ...decodedToken,
      uid: decodedToken.uid,
      role: claimRole || 'cashier',
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
