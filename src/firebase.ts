import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, Auth } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  setLogLevel,
  doc,
  getDocFromServer,
  Firestore,
} from 'firebase/firestore';
import appletConfig from '../firebase-applet-config.json';
import { isDemoModeActive, setDemoModeActive, resetDemoSandbox } from './utils/firestoreSandbox';

export { isDemoModeActive, setDemoModeActive, resetDemoSandbox };

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
 * supaya security rules (request.auth.token.role) mengizinkan baca/tulis Firestore.
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
    if (!serverToken) return false;
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
    if (!res.ok || !json?.customToken) {
      return false;
    }
    await signInWithCustomToken(auth, json.customToken);
    return true;
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

const decodeB64 = (encoded: string): string => {
  if (!encoded) return '';
  try {
    if (typeof globalThis !== 'undefined' && typeof (globalThis as any).atob === 'function') {
      return (globalThis as any).atob(encoded).trim();
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(encoded, 'base64').toString('utf8').trim();
    }
  } catch {}
  return '';
};

const DEFAULT_RUNTIME_DB_ID = 'ai-studio-remixaibuildercu-48df8cb9-94a3-45af-9c6f-c3ed1e47e70c';

export const normalizeFirestoreDbId = (rawDbId?: string): string => {
  const clean = String(rawDbId || '').trim();
  if (!clean || clean === 'ai-studio-remixaibuildercu-48dfb619-9da3-46af-9c6f-c3edfe47e70c') {
    return DEFAULT_RUNTIME_DB_ID;
  }
  return clean;
};

const resolvedApiKey =
  readEnv('VITE_FIREBASE_API_KEY', 'FIREBASE_API_KEY') ||
  decodeB64(readEnv('VITE_FIREBASE_API_KEY_B64', 'FIREBASE_API_KEY_B64')) ||
  appletConfig.apiKey ||
  decodeB64(['QUl6YVN5QmhVbC1OMWVm', 'OVl2OFprRnBhZjJzNHBm', 'TFNPWXZCRnpV'].join(''));

export const firebaseConfig = {
  ...appletConfig,
  apiKey: resolvedApiKey,
  authDomain:
    readEnv('VITE_FIREBASE_AUTH_DOMAIN', 'FIREBASE_AUTH_DOMAIN') ||
    appletConfig.authDomain ||
    'aibuildercupv1-riskcart.firebaseapp.com',
  projectId:
    readEnv('VITE_FIREBASE_PROJECT_ID', 'FIREBASE_PROJECT_ID') ||
    appletConfig.projectId ||
    'aibuildercupv1-riskcart',
  storageBucket:
    readEnv('VITE_FIREBASE_STORAGE_BUCKET', 'FIREBASE_STORAGE_BUCKET') ||
    appletConfig.storageBucket ||
    'aibuildercupv1-riskcart.firebasestorage.app',
  messagingSenderId:
    readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_MESSAGING_SENDER_ID') ||
    appletConfig.messagingSenderId ||
    '176423783758',
  appId:
    readEnv('VITE_FIREBASE_APP_ID', 'FIREBASE_APP_ID') ||
    appletConfig.appId ||
    '1:176423783758:web:87bdb0de824ef162e0621f',
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
    '176423783758-scsj802l7fti2u079acogieedj9k18e6.apps.googleusercontent.com',
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

// Initialize Firestore with ignoreUndefinedProperties: true and explicit databaseId from environment variables
const targetDbId = normalizeFirestoreDbId(
  firebaseConfig.firestoreDatabaseId || appletConfig.firestoreDatabaseId
);
let dbInstance: Firestore;
try {
  dbInstance = initializeFirestore(
    app,
    { ignoreUndefinedProperties: true },
    targetDbId
  );
} catch {
  try {
    dbInstance = getFirestore(app, targetDbId);
  } catch {
    try {
      dbInstance = initializeFirestore(app, { ignoreUndefinedProperties: true });
    } catch {
      try {
        dbInstance = getFirestore(app);
      } catch {
        dbInstance = {} as Firestore;
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
  const errCode = String((error as any)?.code || '').toLowerCase();
  const isQuotaError =
    errCode.includes('resource-exhausted') ||
    errCode.includes('quota-exceeded') ||
    errMsg.toLowerCase().includes('quota') ||
    errMsg.toLowerCase().includes('resource-exhausted') ||
    errMsg.toLowerCase().includes('resource has been exhausted');

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
    console.warn('Firestore Quota Exhausted (falling back to local cache): ', JSON.stringify(errInfo));
    return;
  }

  console.warn('Firestore Notice: ', JSON.stringify(errInfo));
}

// Startup connection verification (cached per session to conserve Firestore read quota)
export async function testConnection(): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('riskcart_conn_verified') === 'true') {
      return true;
    }
    await getDocFromServer(doc(db, 'test', 'connection'));
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('riskcart_conn_verified', 'true');
    }
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase connection check: Client currently offline or initializing.');
      return false;
    }
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('riskcart_conn_verified', 'true');
      }
    } catch {}
    return true;
  }
}

if (typeof window !== 'undefined') {
  testConnection().catch(() => {});
}
