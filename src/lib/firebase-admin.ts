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
  '';

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

export const adminAuth = {
  verifyIdToken: async (idToken: string): Promise<DecodedFirebaseToken> => {
    const d = await defaultAdminAuth.verifyIdToken(String(idToken || '').trim());
    return { ...d, uid: d.uid, email: d.email, role: (d as any).role ? String((d as any).role) : undefined };
  },
};
