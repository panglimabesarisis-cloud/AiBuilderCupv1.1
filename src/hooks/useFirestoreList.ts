import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  QueryConstraint,
} from 'firebase/firestore';
import { db } from '../firebase';
import { isDatabaseWipeInProgress } from '../services/dataSeeder';
import { ACTIVE_STORE_ID } from '../config/store';

const STORE_ID = ACTIVE_STORE_ID || 'store_001';

export function readLocalCache<T>(collectionName: string, defaultData: T[] = []): T[] {
  try {
    if (typeof window === 'undefined') return defaultData;
    const raw = window.localStorage.getItem(`riskcart_fs_${collectionName}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as T[];
      }
    }
    const rawAlt = window.localStorage.getItem(`riskcart_cache_${collectionName}`);
    if (rawAlt) {
      const parsedAlt = JSON.parse(rawAlt);
      if (Array.isArray(parsedAlt) && parsedAlt.length > 0) {
        return parsedAlt as T[];
      }
    }
  } catch (e) {
    // Ignore parse errors
  }
  return defaultData;
}

export const getLocalCacheList = readLocalCache;

export function writeLocalCache<T>(collectionName: string, items: T[]): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(`riskcart_fs_${collectionName}`, JSON.stringify(items));
    window.dispatchEvent(
      new CustomEvent('riskcart_fs_cache_updated', {
        detail: { collectionName, items },
      })
    );
  } catch (e) {
    // Ignore storage quota errors
  }
}

export const setLocalCacheList = writeLocalCache;

function normalizeSnapshotData(raw: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...raw };
  for (const key of ['createdAt', 'updatedAt', 'timestamp', 'date']) {
    const val = out[key];
    if (val && typeof val?.toDate === 'function') {
      try {
        out[key] = val.toDate().toISOString();
      } catch {}
    } else if (val && typeof val?.seconds === 'number') {
      out[key] = new Date(val.seconds * 1000).toISOString();
    }
  }
  return out;
}

export function useFirestoreList<T extends { id?: string }>(
  collectionName: string,
  initialData: T[] = [],
  constraints: QueryConstraint[] = []
) {
  const [data, setData] = useState<T[]>(() => readLocalCache<T>(collectionName, initialData));
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const initialDataRef = useRef(initialData);
  initialDataRef.current = initialData;

  useEffect(() => {
    let isMounted = true;
    let unsubStoreFallback: (() => void) | null = null;

    const handleCleanSlate = () => {
      if (!isMounted || !isDatabaseWipeInProgress()) return;
      const fallback = initialDataRef.current.length > 0 ? initialDataRef.current : [];
      setData(fallback);
    };

    const handleCacheUpdated = (e: Event) => {
      if (!isMounted) return;
      const customEvent = e as CustomEvent<{ collectionName: string; items: T[] }>;
      if (
        customEvent.detail?.collectionName === collectionName &&
        Array.isArray(customEvent.detail.items)
      ) {
        setData(customEvent.detail.items);
      }
    };

    window.addEventListener('riskcart_clean_slate_wiped', handleCleanSlate);
    window.addEventListener('riskcart_fs_cache_updated', handleCacheUpdated);

    const colRef = collection(db, collectionName);
    const q = constraints.length > 0 ? query(colRef, ...constraints) : colRef;

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        if (!isMounted) return;

        const items = snapshot.docs.map((d) => ({
          id: d.id,
          ...normalizeSnapshotData(d.data()),
        })) as T[];

        if (items.length > 0) {
          setData(items);
          writeLocalCache(collectionName, items);
          setLoading(false);
          return;
        }

        // If root collection is empty and collectionName !== 'stores', check stores/store_001/${collectionName}
        if (collectionName !== 'stores' && !collectionName.startsWith('stores/')) {
          try {
            const storeColRef = collection(db, 'stores', STORE_ID, collectionName);
            const storeSnap = await getDocs(storeColRef);
            if (!isMounted) return;

            if (!storeSnap.empty) {
              const storeItems = storeSnap.docs.map((d) => ({
                id: d.id,
                ...normalizeSnapshotData(d.data()),
              })) as T[];
              setData(storeItems);
              writeLocalCache(collectionName, storeItems);
              setLoading(false);

              if (!unsubStoreFallback) {
                unsubStoreFallback = onSnapshot(
                  storeColRef,
                  (subSnap) => {
                    if (!isMounted) return;
                    const subItems = subSnap.docs.map((d) => ({
                      id: d.id,
                      ...normalizeSnapshotData(d.data()),
                    })) as T[];
                    if (subItems.length > 0) {
                      setData(subItems);
                      writeLocalCache(collectionName, subItems);
                    }
                  },
                  () => {}
                );
              }
              return;
            }
          } catch {}
        }

        // Fallback to localStorage cache or initialData if both Firestore collections are empty
        const cached = readLocalCache<T>(collectionName, initialDataRef.current);
        setData(cached);
        setLoading(false);
      },
      (err: any) => {
        if (!isMounted) return;
        const msg = String(err?.message || err || '');
        setError(msg);
        const cached = readLocalCache<T>(collectionName, initialDataRef.current);
        setData((prev) => (prev.length > 0 ? prev : cached));
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      window.removeEventListener('riskcart_clean_slate_wiped', handleCleanSlate);
      window.removeEventListener('riskcart_fs_cache_updated', handleCacheUpdated);
      unsubscribe();
      if (unsubStoreFallback) {
        unsubStoreFallback();
      }
    };
  }, [collectionName]);

  const addItem = useCallback(
    async (item: Omit<T, 'id'> & { id?: string }): Promise<string | null> => {
      const nowIso = new Date().toISOString();
      const explicitId = (item as any)?.id ? String((item as any).id).trim() : '';
      const payload = {
        ...item,
        createdAt: (item as any)?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      try {
        const colRef = collection(db, collectionName);
        let finalId = explicitId;
        if (explicitId) {
          await setDoc(doc(db, collectionName, explicitId), payload as any, { merge: true });
        } else {
          const docRef = await addDoc(colRef, payload as any);
          finalId = docRef.id;
        }
        const newItem = { ...payload, id: finalId } as unknown as T;
        setData((prev) => {
          const next = [newItem, ...prev.filter((p) => p.id !== finalId)];
          writeLocalCache(collectionName, next);
          return next;
        });
        return finalId;
      } catch (err: any) {
        const fallbackId =
          explicitId || `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const newItem = { ...payload, id: fallbackId } as unknown as T;
        setData((prev) => {
          const next = [newItem, ...prev.filter((p) => p.id !== fallbackId)];
          writeLocalCache(collectionName, next);
          return next;
        });
        console.warn(
          `[useFirestoreList] Added locally due to write error on ${collectionName}:`,
          err
        );
        return fallbackId;
      }
    },
    [collectionName]
  );

  const updateItem = useCallback(
    async (id: string, updates: Partial<T>): Promise<boolean> => {
      const nowIso = new Date().toISOString();
      setData((prev) => {
        const next = prev.map((item) =>
          item.id === id ? ({ ...item, ...updates, updatedAt: nowIso } as T) : item
        );
        writeLocalCache(collectionName, next);
        return next;
      });

      try {
        const docRef = doc(db, collectionName, id);
        await updateDoc(docRef, {
          ...updates,
          updatedAt: nowIso,
        } as any);
        return true;
      } catch {
        try {
          await setDoc(
            doc(db, collectionName, id),
            {
              ...updates,
              updatedAt: nowIso,
            } as any,
            { merge: true }
          );
          return true;
        } catch (err: any) {
          console.warn(
            `[useFirestoreList] Updated locally due to write error on ${collectionName}/${id}:`,
            err
          );
          return true;
        }
      }
    },
    [collectionName]
  );

  const deleteItem = useCallback(
    async (id: string): Promise<boolean> => {
      setData((prev) => {
        const next = prev.filter((item) => item.id !== id);
        writeLocalCache(collectionName, next);
        return next;
      });

      try {
        await deleteDoc(doc(db, collectionName, id));
        return true;
      } catch (err: any) {
        console.warn(
          `[useFirestoreList] Deleted locally due to write error on ${collectionName}/${id}:`,
          err
        );
        return true;
      }
    },
    [collectionName]
  );

  return {
    data,
    setData,
    loading,
    error,
    addItem,
    updateItem,
    deleteItem,
  };
}
