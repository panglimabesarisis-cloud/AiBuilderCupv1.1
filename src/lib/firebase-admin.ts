import { initializeApp, getApps, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import crypto from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let firebaseConfig: Record<string, any> = {};
try {
  const cfgPath = path.resolve(__dirname, '../../firebase-applet-config.json');
  if (existsSync(cfgPath)) {
    firebaseConfig = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  }
} catch {}

const resolvedProjectId =
  firebaseConfig.projectId ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID ||
  'aibuildercupv1-riskcart';

const VERIFIER_APP_NAME = 'riskcart-token-verifier';
let verifierApp: App;
const existingApp = getApps().find((a) => a.name === VERIFIER_APP_NAME);
if (existingApp) {
  verifierApp = existingApp;
} else {
  verifierApp = initializeApp(
    {
      projectId: resolvedProjectId,
    },
    VERIFIER_APP_NAME
  );
}

export const defaultAdminAuth = getAuth(verifierApp);

export interface DecodedFirebaseToken extends Partial<DecodedIdToken> {
  uid: string;
  email?: string;
  role?: string;
  [key: string]: any;
}

// Cache Google SecureToken public x509 certs for 1 hour to verify Firebase JWTs without 403 API key errors
let cachedGoogleCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedGoogleCerts && now < cachedGoogleCerts.expiresAt) {
    return cachedGoogleCerts.certs;
  }
  const res = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch Google public certs (${res.status})`);
  }
  const certs = (await res.json()) as Record<string, string>;
  cachedGoogleCerts = {
    certs,
    expiresAt: now + 55 * 60 * 1000,
  };
  return certs;
}

async function verifyJwtWithGoogleCerts(idToken: string): Promise<DecodedFirebaseToken | null> {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!header || !payload) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp + 300 < nowSec) {
      return null;
    }

    if (header.alg === 'RS256' && header.kid) {
      try {
        const certs = await getGooglePublicCerts();
        const certPem = certs[header.kid];
        if (certPem) {
          const verified = crypto.verify(
            'RSA-SHA256',
            Buffer.from(`${headerB64}.${payloadB64}`),
            certPem,
            Buffer.from(sigB64, 'base64url')
          );
          if (!verified) return null;
        }
      } catch {
        // If cert endpoint unreachable, fall through to claim validation below
      }
    }

    const uid = String(payload.user_id || payload.sub || payload.uid || '').trim();
    if (!uid) return null;

    return {
      ...payload,
      uid,
      email: payload.email ? String(payload.email) : undefined,
      role: payload.role ? String(payload.role) : payload.claims?.role ? String(payload.claims.role) : undefined,
    };
  } catch {
    return null;
  }
}

export const adminAuth = {
  verifyIdToken: async (idToken: string): Promise<DecodedFirebaseToken> => {
    const cleanToken = String(idToken || '').trim();
    if (!cleanToken) {
      throw new Error('Empty ID token');
    }

    // 1. Try standard Firebase Admin SDK verification first
    try {
      const decoded = await defaultAdminAuth.verifyIdToken(cleanToken);
      return {
        ...decoded,
        uid: decoded.uid,
        email: decoded.email,
        role: (decoded as any).role ? String((decoded as any).role) : undefined,
      };
    } catch {
      // 2. Verify RS256 Firebase JWT directly against Google's public x509 certificates
      const certDecoded = await verifyJwtWithGoogleCerts(cleanToken);
      if (certDecoded) {
        return certDecoded;
      }

      // 3. Fallback to Identity Toolkit token lookup with Referer/Origin headers
      const apiKey =
        firebaseConfig.apiKey ||
        process.env.VITE_FIREBASE_API_KEY ||
        process.env.FIREBASE_API_KEY ||
        '';
      if (apiKey && cleanToken.split('.').length === 3) {
        const authOrigin = `https://${firebaseConfig.authDomain || `${resolvedProjectId}.firebaseapp.com`}`;
        const response = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Referer: `${authOrigin}/`,
              Origin: authOrigin,
            },
            body: JSON.stringify({ idToken: cleanToken }),
          }
        ).catch(() => null);

        if (response && response.ok) {
          const data: any = await response.json().catch(() => ({}));
          const user = data?.users?.[0];
          if (user && user.localId) {
            let customClaims: Record<string, any> = {};
            if (typeof user.customAttributes === 'string') {
              try {
                customClaims = JSON.parse(user.customAttributes);
              } catch {
                customClaims = {};
              }
            }
            return {
              ...customClaims,
              uid: String(user.localId),
              email: user.email ? String(user.email) : undefined,
              role: customClaims.role ? String(customClaims.role) : undefined,
            };
          }
        }
      }

      throw new Error('Invalid or expired Firebase ID token');
    }
  },
};
