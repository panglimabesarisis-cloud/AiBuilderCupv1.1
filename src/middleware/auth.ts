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
  return (
    process.env.OTP_HMAC_SECRET ||
    process.env.PIN_SALT ||
    process.env.GEMINI_API_KEY ||
    'riskcart-server-session-hmac-v1'
  );
}

export function createSignedSessionToken(payload: {
  uid: string;
  role: string;
  email?: string;
  expiresInMs?: number;
}): string {
  const exp = Date.now() + (payload.expiresInMs || 12 * 60 * 60 * 1000);
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
  const expectedSig = crypto
    .createHmac('sha256', getSessionSigningSecret())
    .update(body)
    .digest('base64url');
  if (
    sig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (!parsed || typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
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

  // 1. Check signed server session token (issued after server PIN or OTP verification)
  const signedSession = verifySignedSessionToken(token);
  if (signedSession) {
    req.user = signedSession as any;
    return next();
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
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
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

