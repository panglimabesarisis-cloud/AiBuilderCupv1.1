/**
 * Server-side Firestore access for RiskCart.
 * - Jika env FIREBASE_SERVICE_ACCOUNT di-set (JSON atau base64 JSON) -> pakai Firebase Admin SDK
 *   (bypass security rules, wajib untuk rules ketat).
 * - Jika tidak -> fallback ke client SDK (hanya jalan bila rules masih terbuka).
 */
import { initializeApp as initAdminApp, cert, getApps as getAdminApps, type App as AdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, type Firestore as AdminFirestore } from 'firebase-admin/firestore';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import {
  doc as cDoc,
  getDoc as cGetDoc,
  getDocs as cGetDocs,
  setDoc as cSetDoc,
  addDoc as cAddDoc,
  collection as cCollection,
  type Firestore as ClientFirestore,
} from 'firebase/firestore';

export interface SnapLike {
  exists(): boolean;
  data(): any;
}
export interface ServerStore {
  mode: 'admin-sdk' | 'client-sdk';
  get(path: string): Promise<SnapLike>;
  set(path: string, data: any, opts?: { merge?: boolean }): Promise<void>;
  add(collectionPath: string, data: any): Promise<void>;
  list(collectionPath: string): Promise<(SnapLike & { id: string })[]>;
}

let adminApp: AdminApp | null = null;

function loadServiceAccount(): any | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw.trim()) return null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const json = JSON.parse(text);
    if (json.private_key) json.private_key = String(json.private_key).replace(/\\n/g, '\n');
    return json;
  } catch (e) {
    console.error('[serverStore] FIREBASE_SERVICE_ACCOUNT tidak valid:', e);
    return null;
  }
}

export function getAdminApp(): AdminApp | null {
  if (adminApp) return adminApp;
  const sa = loadServiceAccount();
  if (!sa) return null;
  try {
    adminApp =
      getAdminApps().find((a) => a.name === 'riskcart-admin') ||
      initAdminApp({ credential: cert(sa), projectId: sa.project_id }, 'riskcart-admin');
  } catch (e) {
    console.error('[serverStore] Gagal inisialisasi Admin SDK:', e);
    adminApp = null;
  }
  return adminApp;
}

export function getAdminAuthOrNull() {
  const app = getAdminApp();
  return app ? getAdminAuth(app) : null;
}

export function createServerStore(clientDb: ClientFirestore, databaseId?: string): ServerStore {
  const app = getAdminApp();
  if (app) {
    const adb: AdminFirestore = databaseId ? getAdminFirestore(app, databaseId) : getAdminFirestore(app);
    return {
      mode: 'admin-sdk',
      async get(path) {
        const s = await adb.doc(path).get();
        return { exists: () => s.exists, data: () => s.data() };
      },
      async set(path, data, opts) {
        await adb.doc(path).set(data, { merge: !!opts?.merge });
      },
      async add(col, data) {
        await adb.collection(col).add(data);
      },
      async list(col) {
        const qs = await adb.collection(col).get();
        return qs.docs.map((d) => ({ id: d.id, exists: () => true, data: () => d.data() }));
      },
    };
  }
  console.warn('[serverStore] FIREBASE_SERVICE_ACCOUNT belum di-set: memakai client SDK (gagal jika rules ketat).');
  return {
    mode: 'client-sdk',
    async get(path) {
      const s = await cGetDoc(cDoc(clientDb, path));
      return { exists: () => s.exists(), data: () => s.data() };
    },
    async set(path, data, opts) {
      await cSetDoc(cDoc(clientDb, path), data, { merge: !!opts?.merge });
    },
    async add(col, data) {
      await cAddDoc(cCollection(clientDb, col), data);
    },
    async list(col) {
      const qs = await cGetDocs(cCollection(clientDb, col));
      return qs.docs.map((d) => ({ id: d.id, exists: () => true, data: () => d.data() }));
    },
  };
}
