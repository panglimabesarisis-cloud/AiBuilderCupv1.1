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
  deleteDoc as cDeleteDoc,
  collection as cCollection,
  type Firestore as ClientFirestore,
} from 'firebase/firestore';

export interface SnapLike {
  exists(): boolean;
  data(): any;
}
export type SnapListResult = (SnapLike & { id: string })[] & {
  docs: (SnapLike & { id: string })[];
};
export interface ServerStore {
  mode: 'admin-sdk' | 'client-sdk';
  get(path: string): Promise<SnapLike>;
  getDoc(path: string): Promise<SnapLike>;
  set(path: string, data: any, opts?: { merge?: boolean }): Promise<void>;
  setDoc(path: string, data: any, opts?: { merge?: boolean }): Promise<void>;
  add(collectionPath: string, data: any): Promise<void>;
  addDoc(collectionPath: string, data: any): Promise<void>;
  list(collectionPath: string): Promise<SnapListResult>;
  listDocs(collectionPath: string): Promise<SnapListResult>;
  delete(path: string): Promise<void>;
  deleteDoc(path: string): Promise<void>;
  clearCache(): void;
  clearCollection(
    collectionPath: string,
    shouldPreserve?: (id: string, data: any) => boolean
  ): Promise<number>;
}

let adminApp: AdminApp | null = null;
const memoryCache = new Map<string, any>();

function withDocsProperty(items: (SnapLike & { id: string })[]): SnapListResult {
  const arr = items as SnapListResult;
  Object.defineProperty(arr, 'docs', {
    value: items,
    enumerable: false,
    configurable: true,
  });
  return arr;
}

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
    const store: ServerStore = {
      mode: 'admin-sdk',
      async get(path) {
        const s = await adb.doc(path).get();
        if (s.exists) memoryCache.set(path, s.data());
        return { exists: () => s.exists, data: () => s.data() };
      },
      getDoc(path) {
        return store.get(path);
      },
      async set(path, data, opts) {
        const prev = memoryCache.get(path) || {};
        memoryCache.set(path, opts?.merge ? { ...prev, ...data } : { ...data });
        await adb.doc(path).set(data, { merge: !!opts?.merge });
      },
      setDoc(path, data, opts) {
        return store.set(path, data, opts);
      },
      async add(col, data) {
        await adb.collection(col).add(data);
      },
      addDoc(col, data) {
        return store.add(col, data);
      },
      async list(col) {
        const qs = await adb.collection(col).get();
        return withDocsProperty(qs.docs.map((d) => ({ id: d.id, exists: () => true, data: () => d.data() })));
      },
      listDocs(col) {
        return store.list(col);
      },
      async delete(path) {
        memoryCache.delete(path);
        await adb.doc(path).delete();
      },
      deleteDoc(path) {
        return store.delete(path);
      },
      clearCache() {
        memoryCache.clear();
      },
      async clearCollection(col, shouldPreserve) {
        let deleted = 0;
        try {
          const qs = await adb.collection(col).get();
          if (qs.empty) return 0;
          await Promise.all(
            qs.docs.map(async (d) => {
              const data = d.data();
              if (shouldPreserve && shouldPreserve(d.id, data)) return;
              try {
                memoryCache.delete(`${col}/${d.id}`);
                await d.ref.delete();
                deleted++;
              } catch {}
            })
          );
        } catch {}
        return deleted;
      },
    };
    return store;
  }
  console.warn('[serverStore] FIREBASE_SERVICE_ACCOUNT belum di-set: memakai client SDK (gagal jika rules ketat).');
  const store: ServerStore = {
    mode: 'client-sdk',
    async get(path) {
      try {
        const s = await cGetDoc(cDoc(clientDb, path));
        if (s.exists()) {
          const d = s.data();
          memoryCache.set(path, d);
          return { exists: () => true, data: () => d };
        }
      } catch {}
      const cached = memoryCache.get(path);
      return { exists: () => cached !== undefined, data: () => cached };
    },
    getDoc(path) {
      return store.get(path);
    },
    async set(path, data, opts) {
      const prev = memoryCache.get(path) || {};
      memoryCache.set(path, opts?.merge ? { ...prev, ...data } : { ...data });
      await cSetDoc(cDoc(clientDb, path), data, { merge: !!opts?.merge });
    },
    setDoc(path, data, opts) {
      return store.set(path, data, opts);
    },
    async add(col, data) {
      await cAddDoc(cCollection(clientDb, col), data);
    },
    addDoc(col, data) {
      return store.add(col, data);
    },
    async list(col) {
      const qs = await cGetDocs(cCollection(clientDb, col));
      return withDocsProperty(qs.docs.map((d) => ({ id: d.id, exists: () => true, data: () => d.data() })));
    },
    listDocs(col) {
      return store.list(col);
    },
    async delete(path) {
      memoryCache.delete(path);
      await cDeleteDoc(cDoc(clientDb, path));
    },
    deleteDoc(path) {
      return store.delete(path);
    },
    clearCache() {
      memoryCache.clear();
    },
    async clearCollection(col, shouldPreserve) {
      let deleted = 0;
      try {
        const qs = await cGetDocs(cCollection(clientDb, col));
        if (qs.empty) return 0;
        await Promise.all(
          qs.docs.map(async (d) => {
            const data = d.data();
            if (shouldPreserve && shouldPreserve(d.id, data)) return;
            try {
              memoryCache.delete(`${col}/${d.id}`);
              await cDeleteDoc(d.ref);
              deleted++;
            } catch {}
          })
        );
      } catch {}
      return deleted;
    },
  };
  return store;
}

