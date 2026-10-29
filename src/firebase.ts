import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, Auth } from 'firebase/auth';
import { getFirestore, setLogLevel, doc, getDocFromServer, Firestore } from 'firebase/firestore';
import appletConfig from '../firebase-applet-config.json';
import { isDemoModeActive, setDemoModeActive, resetDemoSandbox } from './utils/firestoreSandbox';

export { isDemoModeActive, setDemoModeActive, resetDemoSandbox };

/** Ambil session token server (hasil verifikasi PIN owner/staff atau OTP pelanggan). */
export function getServerToken(): string {
  try {
    return typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem('riskcart_server_token') || ''
      : '';
  } catch {
    return '';
  }
}

/**
 * Tukar session token server -> Firebase custom token lalu login Firebase Auth,
 * supaya security rules (request.auth.token.role) mengizinkan baca/tulis Firestore.
 */
export async function ensureFirebaseSession(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !auth) return false;
    if (auth.currentUser && !auth.currentUser.isAnonymous) return true;
    const serverToken = getServerToken();
    if (!serverToken) return false;
    const res = await fetch('/api/auth/firebase-custom-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serverToken}`,
      },
      body: '{}',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.customToken) {
      console.warn('[firebaseSession] gagal mendapat custom token:', json?.error || res.status);
      return false;
    }
    await signInWithCustomToken(auth, json.customToken);
    return true;
  } catch (e) {
    console.warn('[firebaseSession] signIn gagal:', e);
    return false;
  }
}

const viteEnv: Record<string, string | undefined> =
  (typeof import.meta !== 'undefined' && (import.meta as any).env) ||
  (typeof process !== 'undefined' ? process.env : {}) ||
  {};

export const firebaseConfig = {
  ...appletConfig,
  apiKey: viteEnv.VITE_FIREBASE_API_KEY || appletConfig.apiKey,
  authDomain: viteEnv.VITE_FIREBASE_AUTH_DOMAIN || appletConfig.authDomain,
  projectId: viteEnv.VITE_FIREBASE_PROJECT_ID || appletConfig.projectId,
  storageBucket: viteEnv.VITE_FIREBASE_STORAGE_BUCKET || appletConfig.storageBucket,
  messagingSenderId:
    viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || appletConfig.messagingSenderId,
  appId: viteEnv.VITE_FIREBASE_APP_ID || appletConfig.appId,
  measurementId: viteEnv.VITE_FIREBASE_MEASUREMENT_ID || appletConfig.measurementId || '',
  firestoreDatabaseId:
    viteEnv.VITE_FIREBASE_DATABASE_ID || appletConfig.firestoreDatabaseId,
};

// Initialize Firebase App safely with try/catch so it never causes a white screen crash
let appInstance: FirebaseApp;
try {
  appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
} catch (e) {
  try {
    appInstance = initializeApp(appletConfig, 'riskcart_app');
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

// Initialize Firestore and Auth safely with try/catch and explicit databaseId from firebase-applet-config.json
let dbInstance: Firestore;
try {
  dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId || appletConfig.firestoreDatabaseId);
} catch {
  try {
    dbInstance = getFirestore(app);
  } catch {
    dbInstance = {} as Firestore;
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
