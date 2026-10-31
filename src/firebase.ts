import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, Auth } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  setLogLevel,
  Firestore,
} from 'firebase/firestore';
import { isDemoModeActive, setDemoModeActive, resetDemoSandbox } from './utils/firestoreSandbox';

const optionalConfigModules =
  typeof import.meta !== 'undefined' && typeof (import.meta as any).glob === 'function'
    ? (import.meta as any).glob('../firebase-applet-config.json', { eager: true })
    : {};
const rawConfigMod: any = Object.values(optionalConfigModules)[0] || {};
const appletConfig: Record<string, any> = rawConfigMod?.default || rawConfigMod || {};

export { isDemoModeActive, setDemoModeActive, resetDemoSandbox };

// Global Quota Exhausted / Offline Mode tracker
let firestoreQuotaExhausted = false;
export function isFirestoreQuotaExhausted(): boolean {
  return firestoreQuotaExhausted;
}
export function markFirestoreQuotaExhausted(exhausted = true): void {
  const prev = firestoreQuotaExhausted;
  firestoreQuotaExhausted = exhausted;
  if (typeof window !== 'undefined' && exhausted && !prev) {
    try {
      sessionStorage.setItem('riskcart_firestore_quota_exhausted', 'true');
    } catch {}
    window.dispatchEvent(new CustomEvent('riskcart:firestore-quota-exhausted'));
  }
}

/** Ambil session token server (hasil login / verifikasi PIN owner/staff atau OTP pelanggan). */
export function getServerToken(): string {
  try {
    if (typeof window === 'undefined') return '';
    return (
      window.sessionStorage?.getItem('riskcart_server_token') ||
      window.localStorage?.getItem('riskcart_server_token') ||
      ''
    );
  } catch {
    return '';
  }
}

export function setServerToken(token: string): void {
  const clean = String(token || '').trim();
  if (!clean || typeof window === 'undefined') return;
  try {
    window.sessionStorage?.setItem('riskcart_server_token', clean);
  } catch {}
  try {
    window.localStorage?.setItem('riskcart_server_token', clean);
  } catch {}
}

export function clearServerToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage?.removeItem('riskcart_server_token');
  } catch {}
  try {
    window.localStorage?.removeItem('riskcart_server_token');
  } catch {}
}

/**
 * Tukar session token server -> Firebase custom token lalu login Firebase Auth,
 * supaya security rules (request.auth != null) mengizinkan baca/tulis Firestore.
 */
export async function ensureFirebaseSession(directCustomToken?: string): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !auth) return false;
    if (directCustomToken) {
      await signInWithCustomToken(auth, directCustomToken);
      return true;
    }
    if (auth.currentUser && !auth.currentUser.isAnonymous) return true;
    const serverToken = getServerToken();
    if (serverToken) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 3500) : null;
      const res = await fetch('/api/auth/firebase-custom-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serverToken}`,
        },
        body: '{}',
        signal: controller?.signal,
      }).finally(() => {
        if (timer) clearTimeout(timer);
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.customToken) {
        await signInWithCustomToken(auth, json.customToken);
        return true;
      }
    }
    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
        return true;
      } catch {
        // Ignore if anonymous auth is not enabled
      }
    }
    return Boolean(auth.currentUser);
  } catch {
    return false;
  }
}

const viteEnv: Record<string, string | undefined> =
  (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};
const nodeEnv: Record<string, string | undefined> =
  (typeof process !== 'undefined' && process.env) || {};

const readEnv = (viteKey: string, fallbackKey?: string): string => {
  const fromVite = viteEnv[viteKey];
  if (fromVite && String(fromVite).trim()) return String(fromVite).trim();
  const fromNodeVite = nodeEnv[viteKey];
  if (fromNodeVite && String(fromNodeVite).trim()) return String(fromNodeVite).trim();
  if (fallbackKey) {
    const fromFallback = viteEnv[fallbackKey] || nodeEnv[fallbackKey];
    if (fromFallback && String(fromFallback).trim()) return String(fromFallback).trim();
  }
  return '';
};

export const normalizeFirestoreDbId = (rawDbId?: string): string => {
  return String(rawDbId || '').trim();
};

const resolvedApiKey =
  readEnv('VITE_FIREBASE_API_KEY', 'FIREBASE_API_KEY') ||
  appletConfig.apiKey ||
  '';

export const firebaseConfig = {
  ...appletConfig,
  apiKey: resolvedApiKey,
  authDomain:
    readEnv('VITE_FIREBASE_AUTH_DOMAIN', 'FIREBASE_AUTH_DOMAIN') ||
    appletConfig.authDomain ||
    '',
  projectId:
    readEnv('VITE_FIREBASE_PROJECT_ID', 'FIREBASE_PROJECT_ID') ||
    appletConfig.projectId ||
    '',
  storageBucket:
    readEnv('VITE_FIREBASE_STORAGE_BUCKET', 'FIREBASE_STORAGE_BUCKET') ||
    appletConfig.storageBucket ||
    '',
  messagingSenderId:
    readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_MESSAGING_SENDER_ID') ||
    appletConfig.messagingSenderId ||
    '',
  appId:
    readEnv('VITE_FIREBASE_APP_ID', 'FIREBASE_APP_ID') ||
    appletConfig.appId ||
    '',
  measurementId:
    readEnv('VITE_FIREBASE_MEASUREMENT_ID', 'FIREBASE_MEASUREMENT_ID') ||
    appletConfig.measurementId ||
    '',
  firestoreDatabaseId: normalizeFirestoreDbId(
    readEnv('VITE_FIREBASE_DATABASE_ID', 'FIREBASE_DATABASE_ID') ||
      appletConfig.firestoreDatabaseId
  ),
  oAuthClientId:
    readEnv('VITE_FIREBASE_OAUTH_CLIENT_ID', 'FIREBASE_OAUTH_CLIENT_ID') ||
    (appletConfig as any).oAuthClientId ||
    '',
  recaptchaSiteKey:
    readEnv('VITE_FIREBASE_RECAPTCHA_SITE_KEY', 'FIREBASE_RECAPTCHA_SITE_KEY') ||
    (appletConfig as any).recaptchaSiteKey ||
    '',
};

// Initialize Firebase App safely with try/catch so it never causes a white screen crash
let appInstance: FirebaseApp;
try {
  appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
} catch (e) {
  try {
    appInstance = initializeApp(firebaseConfig, 'riskcart_app');
  } catch {
    appInstance = getApps()[0] || ({} as FirebaseApp);
  }
}
export const app = appInstance;

// Silence internal gRPC stream recycling and idle disconnect warnings from @firebase/logger
try {
  setLogLevel('silent');
} catch {
  // Safe fallback if logger not available in environment
}

// Initialize Firestore with persistentLocalCache({ tabManager: persistentMultipleTabManager() })
const targetDbId = normalizeFirestoreDbId(
  firebaseConfig.firestoreDatabaseId || appletConfig.firestoreDatabaseId
);
let dbInstance: Firestore;
try {
  dbInstance = initializeFirestore(
    app,
    {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    },
    targetDbId
  );
} catch {
  try {
    dbInstance = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    try {
      dbInstance = initializeFirestore(
        app,
        {
          localCache: memoryLocalCache(),
        },
        targetDbId
      );
    } catch {
      try {
        dbInstance = getFirestore(app, targetDbId);
      } catch {
        try {
          dbInstance = getFirestore(app);
        } catch {
          dbInstance = {} as Firestore;
        }
      }
    }
  }
}
export const db = dbInstance;

let authInstance: Auth;
try {
  authInstance = getAuth(app);
} catch {
  authInstance = {} as Auth;
}
export const auth = authInstance;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errMsg = error instanceof Error ? error.message : String(error);
  const isQuotaError = (error as any)?.code === 'resource-exhausted';

  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo:
        auth?.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };

  if (isQuotaError) {
    markFirestoreQuotaExhausted(true);
    console.warn('Firestore Quota Exhausted (100% Local Cache Mode Active): ', JSON.stringify(errInfo));
    return;
  }

  console.warn('Firestore Notice: ', JSON.stringify(errInfo));
}

// Startup connection & auth session check (zero extra server document read to save Firestore quota)
export async function testConnection(): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  try {
    void ensureFirebaseSession();
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('riskcart_conn_verified', 'true');
    }
    return true;
  } catch {
    return false;
  }
}

if (typeof window !== 'undefined') {
  testConnection().catch(() => {});
}

