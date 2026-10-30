import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  limit,
  where,
} from 'firebase/firestore';
import { db, isFirestoreQuotaExhausted, markFirestoreQuotaExhausted } from '../firebase';
import { ACTIVE_STORE_ID } from '../config/store';
import { readLocalCache, writeLocalCache } from './useFirestoreList';
import { enqueuePendingSync } from '../utils/dbSync';

const STORE_ID = ACTIVE_STORE_ID || 'store_001';

/**
 * 1) useCollection: Real-time listener and CRUD actions on primary Firestore `db` with Cache-First, where('storeId','==',STORE_ID) & limit(50).
 */
export function useCollection<T extends { id: string }>(
  name: string,
  _seed: T[] = []
): {
  items: T[];
  loading: boolean;
  error: Error | null;
  add: (item: Partial<T> & Record<string, any>) => Promise<string>;
  update: (id: string, patch: Partial<T> & Record<string, any>) => Promise<void>;
  remove: (id: string) => Promise<void>;
} {
  const cleanName = name.replace(/^stores\/[^/]+\//, '');
  const [items, setItems] = useState<T[]>(() => readLocalCache<T>(cleanName, _seed));
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const seedRef = useRef<T[]>(_seed);
  seedRef.current = _seed;

  useEffect(() => {
    let isMounted = true;

    if (isFirestoreQuotaExhausted()) {
      setItems((prev) => (prev.length > 0 ? prev : readLocalCache<T>(cleanName, seedRef.current)));
      setLoading(false);
      return () => {
        isMounted = false;
      };
    }

    const colRef = collection(db, cleanName);
    const q =
      cleanName === 'stores'
        ? query(colRef, limit(50))
        : query(colRef, where('storeId', '==', STORE_ID), limit(50));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!isMounted) return;
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as T[];

        if (list.length > 0) {
          setItems(list);
          writeLocalCache(cleanName, list);
          setLoading(false);
          setError(null);
          return;
        }

        const cached = readLocalCache<T>(cleanName, seedRef.current);
        setItems(cached);
        setLoading(false);
        setError(null);
      },
      (err: any) => {
        if (!isMounted) return;
        if (err?.code === 'resource-exhausted') {
          markFirestoreQuotaExhausted(true);
        }
        if (errCode.includes('resource-exhausted') || String(err?.message || '').toLowerCase().includes('quota')) {
          markFirestoreQuotaExhausted(true);
        }
        setItems((prev) => (prev.length > 0 ? prev : readLocalCache<T>(cleanName, seedRef.current)));
        setError(null);
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [cleanName]);

  const add = useCallback(
    async (item: Partial<T> & Record<string, any>): Promise<string> => {
      const colRef = collection(db, cleanName);
      const docRef = item.id ? doc(colRef, String(item.id)) : doc(colRef);
      const nowISO = new Date().toISOString();
      const newItem = {
        ...item,
        id: docRef.id,
        storeId: item.storeId || STORE_ID,
        createdAt: item.createdAt || nowISO,
        updatedAt: nowISO,
      } as unknown as T;

      setItems((prev) => {
        const next = [newItem, ...prev.filter((p) => p.id !== docRef.id)];
        writeLocalCache(cleanName, next);
        return next;
      });

      if (isFirestoreQuotaExhausted()) {
        enqueuePendingSync({
          op: 'set',
          collectionPath: cleanName,
          docId: docRef.id,
          data: newItem,
          merge: true,
        });
        return docRef.id;
      }

      try {
        await setDoc(docRef, newItem, { merge: true });
        setError(null);
        return docRef.id;
      } catch (err: any) {
        if (String(err?.code || '').toLowerCase().includes('resource-exhausted')) {
          markFirestoreQuotaExhausted(true);
        }
        enqueuePendingSync({
          op: 'set',
          collectionPath: cleanName,
          docId: docRef.id,
          data: newItem,
          merge: true,
        });
        return docRef.id;
      }
    },
    [cleanName]
  );

  const update = useCallback(
    async (id: string, patch: Partial<T> & Record<string, any>): Promise<void> => {
      const docRef = doc(db, cleanName, id);
      const nowISO = new Date().toISOString();
      const updateData = {
        ...patch,
        storeId: patch.storeId || STORE_ID,
        updatedAt: nowISO,
      };

      setItems((prev) => {
        const next = prev.map((item) => (item.id === id ? ({ ...item, ...updateData } as T) : item));
        writeLocalCache(cleanName, next);
        return next;
      });

      if (isFirestoreQuotaExhausted()) {
        enqueuePendingSync({
          op: 'set',
          collectionPath: cleanName,
          docId: id,
          data: updateData,
          merge: true,
        });
        return;
      }

      try {
        await setDoc(docRef, updateData, { merge: true });
        setError(null);
      } catch (err: any) {
        if (String(err?.code || '').toLowerCase().includes('resource-exhausted')) {
          markFirestoreQuotaExhausted(true);
        }
        enqueuePendingSync({
          op: 'set',
          collectionPath: cleanName,
          docId: id,
          data: updateData,
          merge: true,
        });
      }
    },
    [cleanName]
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      setItems((prev) => {
        const next = prev.filter((item) => item.id !== id);
        writeLocalCache(cleanName, next);
        return next;
      });

      if (isFirestoreQuotaExhausted()) {
        enqueuePendingSync({
          op: 'delete',
          collectionPath: cleanName,
          docId: id,
        });
        return;
      }

      try {
        await deleteDoc(doc(db, cleanName, id));
        setError(null);
      } catch (err: any) {
        if (String(err?.code || '').toLowerCase().includes('resource-exhausted')) {
          markFirestoreQuotaExhausted(true);
        }
        enqueuePendingSync({
          op: 'delete',
          collectionPath: cleanName,
          docId: id,
        });
      }
    },
    [cleanName]
  );

  return { items, loading, error, add, update, remove };
}

function resolveDocRef(path: string) {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 2) {
    return doc(db, parts[0], parts[1]);
  }
  if (parts.length === 4) {
    return doc(db, parts[0], parts[1], parts[2], parts[3]);
  }
  return doc(db, path);
}

/**
 * 2) useSettingsDoc: Generic hook for single settings/config document on primary Firestore `db`.
 */
export function useSettingsDoc<T extends Record<string, any>>(
  path: string,
  defaults: T
): {
  value: T;
  save: (patch: Partial<T> & Record<string, any>) => Promise<void>;
  loading: boolean;
  error: Error | null;
} {
  const defaultsRef = useRef<T>(defaults);
  defaultsRef.current = defaults;

  const cacheKey = `riskcart_doc_${path.replace(/\//g, '_')}`;

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(cacheKey) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return { ...defaults, ...parsed };
        }
      }
    } catch {}
    return defaults;
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (isFirestoreQuotaExhausted()) {
      setLoading(false);
      return () => {
        isMounted = false;
      };
    }

    const docRef = resolveDocRef(path);
    const isPosSettingsPath = path.endsWith('/settings/pos') || path === 'settings/pos';
    let unsubFallback = () => {};

    const unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        if (!isMounted) return;
        if (snap.exists()) {
          const data = snap.data() as Partial<T>;
          const next = { ...defaultsRef.current, ...data };
          setValue(next);
          try {
            window.localStorage.setItem(cacheKey, JSON.stringify(next));
          } catch {}
          setLoading(false);
          setError(null);
        } else if (isPosSettingsPath && !isFirestoreQuotaExhausted()) {
          const fallbackRef =
            path === 'settings/pos'
              ? doc(db, 'stores', STORE_ID, 'settings', 'pos')
              : doc(db, 'settings', 'pos');
          unsubFallback = onSnapshot(
            fallbackRef,
            (fallbackSnap) => {
              if (!isMounted) return;
              if (fallbackSnap.exists()) {
                const fData = fallbackSnap.data() as Partial<T>;
                const next = { ...defaultsRef.current, ...fData };
                setValue(next);
                try {
                  window.localStorage.setItem(cacheKey, JSON.stringify(next));
                } catch {}
              }
              setLoading(false);
            },
            () => {
              if (isMounted) setLoading(false);
            }
          );
        } else {
          setLoading(false);
          setError(null);
        }
      },
      (err: any) => {
        if (!isMounted) return;
        if (String(err?.code || '').toLowerCase().includes('resource-exhausted')) {
          markFirestoreQuotaExhausted(true);
        }
        setError(null);
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
      unsubFallback();
    };
  }, [path, cacheKey]);

  const save = useCallback(
    async (patch: Partial<T> & Record<string, any>): Promise<void> => {
      const nowISO = new Date().toISOString();
      const docRef = resolveDocRef(path);
      const isPosSettingsPath = path.endsWith('/settings/pos') || path === 'settings/pos';
      const updateData = {
        ...patch,
        updatedAt: nowISO,
      };

      setValue((prev) => {
        const next = { ...prev, ...patch, updatedAt: nowISO };
        try {
          window.localStorage.setItem(cacheKey, JSON.stringify(next));
        } catch {}
        return next;
      });

      if (isFirestoreQuotaExhausted()) {
        return;
      }

      try {
        await setDoc(docRef, updateData, { merge: true });
        if (isPosSettingsPath) {
          const mirrorRef =
            path === 'settings/pos'
              ? doc(db, 'stores', STORE_ID, 'settings', 'pos')
              : doc(db, 'settings', 'pos');
          await setDoc(mirrorRef, updateData, { merge: true });
        }
        setError(null);
      } catch (err: any) {
        if (String(err?.code || '').toLowerCase().includes('resource-exhausted')) {
          markFirestoreQuotaExhausted(true);
        }
      }
    },
    [path, cacheKey]
  );

  return { value, save, loading, error };
}

