import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let firebaseConfig: { apiKey?: string; projectId?: string } = {};
try {
  const raw = readFileSync(
    path.resolve(__dirname, '../../firebase-applet-config.json'),
    'utf-8'
  );
  firebaseConfig = JSON.parse(raw);
} catch (e) {
  console.warn('Could not load firebase-applet-config.json:', e);
}

export interface DecodedFirebaseToken {
  uid: string;
  email?: string;
  role?: string;
  [key: string]: any;
}

export const adminAuth = {
  verifyIdToken: async (idToken: string): Promise<DecodedFirebaseToken> => {
    if (!idToken) {
      throw new Error('Empty ID token');
    }
    const apiKey = process.env.FIREBASE_API_KEY || firebaseConfig.apiKey;
    if (!apiKey) {
      throw new Error('Firebase API key not configured for token verification');
    }

    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!response.ok) {
      throw new Error(`Invalid Firebase ID token (status ${response.status})`);
    }

    const data: any = await response.json();
    const user = data?.users?.[0];
    if (!user || !user.localId) {
      throw new Error('Firebase user not found for token');
    }

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
  },
};
