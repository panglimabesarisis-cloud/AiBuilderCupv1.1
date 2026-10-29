import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json';

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

export const defaultAdminAuth = getAuth();

export interface DecodedFirebaseToken extends Partial<DecodedIdToken> {
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

    // 1. Try standard Firebase Admin SDK verification first
    try {
      const decoded = await defaultAdminAuth.verifyIdToken(idToken);
      return {
        ...decoded,
        uid: decoded.uid,
        email: decoded.email,
        role: (decoded as any).role ? String((decoded as any).role) : undefined,
      };
    } catch (adminErr) {
      // 2. Fallback to Identity Toolkit token lookup using static firebaseConfig.apiKey
      const apiKey = process.env.FIREBASE_API_KEY || firebaseConfig.apiKey;
      if (!apiKey) {
        throw adminErr;
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
    }
  },
};
