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

function normalizeCollectionKey(collectionName: string): string {
  return String(collectionName || '')
    .trim()
    .replace(/^stores\/[^/]+\//, '');
}

export function getDeletedFsIds(collectionName: string): Set<string> {
  try {
    if (typeof window === 'undefined') return new Set();
    const key = `riskcart_deleted_fs_${normalizeCollectionKey(collectionName)}_v1`;
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.map(String));
    }
  } catch {}
  return new Set();
}

export function addDeletedFsId(collectionName: string, id: string): void {
  try {
    if (typeof window === 'undefined' || !id) return;
    const normCol = normalizeCollectionKey(collectionName);
    const key = `riskcart_deleted_fs_${normCol}_v1`;
    const set = getDeletedFsIds(normCol);
    set.add(String(id));
    window.localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {}
}

export function removeDeletedFsId(collectionName: string, id: string): void {
  try {
    if (typeof window === 'undefined' || !id) return;
    const normCol = normalizeCollectionKey(collectionName);
    const key = `riskcart_deleted_fs_${normCol}_v1`;
    const set = getDeletedFsIds(normCol);
    if (set.has(String(id))) {
      set.delete(String(id));
      window.localStorage.setItem(key, JSON.stringify(Array.from(set)));
    }
  } catch {}
}

function isMockOrDummyItem(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  if (item.isDemo === true || item.isMock === true || item.isDummy === true) return true;
  const idStr = String(item.id || item.transactionId || item.orderId || '').trim();
  if (/^(demo_|mock_|dummy_|TRX-DEMO|ORD-DEMO|PO-DEMO|ORD-WTR-SAMPLE)/i.test(idStr)) return true;
  const custName = String(item.customerName || item.visitorName || '').trim();
  if (/^(Bpk\.|Mr\.)\s*Hendra\s+Wijaya$/i.test(custName)) return true;
  return false;
}

export function readLocalCache<T>(collectionName: string, defaultData: T[] = []): T[] {
  const deletedSet = getDeletedFsIds(collectionName);
  try {
    if (typeof window === 'undefined') {
      return defaultData.filter((x: any) => !deletedSet.has(String(x?.id || '')));
    }
    const raw = window.localStorage.getItem(`riskcart_fs_${collectionName}`);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(
          (x) => !isMockOrDummyItem(x) && !deletedSet.has(String(x?.id || ''))
        );
        return cleaned as T[];
      }
    }
    const rawAlt = window.localStorage.getItem(`riskcart_cache_${collectionName}`);
    if (rawAlt !== null) {
      const parsedAlt = JSON.parse(rawAlt);
      if (Array.isArray(parsedAlt)) {
        const cleanedAlt = parsedAlt.filter(
          (x) => !isMockOrDummyItem(x) && !deletedSet.has(String(x?.id || ''))
        );
        return cleanedAlt as T[];
      }
    }
  } catch (e) {
    // Ignore parse errors
  }
  return defaultData.filter(
    (x: any) => !isMockOrDummyItem(x) && !deletedSet.has(String(x?.id || ''))
  );
}

export const getLocalCacheList = readLocalCache;

export function writeLocalCache<T>(collectionName: string, items: T[]): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(`riskcart_fs_${collectionName}`, JSON.stringify(items));
    window.localStorage.setItem(`riskcart_cache_${collectionName}`, JSON.stringify(items));
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
  const [data, setData] = useState<T[]>(() => readLocalCache(collectionName, initialData));
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const initialDataRef = useRef(initialData);
  initialDataRef.current = initialData;

  useEffect(() => {
    let isMounted = true;
    let unsubStoreFallback: (() => void) | null = null;

    const handleCleanSlate = () => {
      if (!isMounted || !isDatabaseWipeInProgress()) return;
      setData([]);
    };

    const handleCacheUpdated = (e: Event) => {
      if (!isMounted) return;
      const customEvent = e as CustomEvent<{ collectionName: string; items: T[] }>;
      if (
        customEvent.detail?.collectionName === collectionName &&
        Array.isArray(customEvent.detail.items)
      ) {
        const deletedSet = getDeletedFsIds(collectionName);
        setData(
          customEvent.detail.items.filter(
            (item) => !isMockOrDummyItem(item) && !deletedSet.has(String(item?.id || ''))
          )
        );
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
        const deletedSet = getDeletedFsIds(collectionName);

        const items = snapshot.docs
          .map((d) => ({
            id: d.id,
            ...normalizeSnapshotData(d.data()),
          }))
          .filter(
            (item) => !isMockOrDummyItem(item) && !deletedSet.has(String(item.id || ''))
          ) as T[];

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
              const currentDeleted = getDeletedFsIds(collectionName);
              const storeItems = storeSnap.docs
                .map((d) => ({
                  id: d.id,
                  ...normalizeSnapshotData(d.data()),
                }))
                .filter(
                  (item) =>
                    !isMockOrDummyItem(item) && !currentDeleted.has(String(item.id || ''))
                ) as T[];
              if (storeItems.length > 0) {
                setData(storeItems);
                writeLocalCache(collectionName, storeItems);
                setLoading(false);

                if (!unsubStoreFallback) {
                  unsubStoreFallback = onSnapshot(
                    storeColRef,
                    (subSnap) => {
                      if (!isMounted) return;
                      const latestDeleted = getDeletedFsIds(collectionName);
                      const subItems = subSnap.docs
                        .map((d) => ({
                          id: d.id,
                          ...normalizeSnapshotData(d.data()),
                        }))
                        .filter(
                          (item) =>
                            !isMockOrDummyItem(item) &&
                            !latestDeleted.has(String(item.id || ''))
                        ) as T[];
                      setData(subItems);
                      writeLocalCache(collectionName, subItems);
                    },
                    () => {}
                  );
                }
                return;
              }
            }
          } catch {}
        }

        // Both root and store-scoped Firestore collections are genuinely empty:
        // If localStorage already has an explicit empty array saved by the user, keep it [].
        const hasExplicitLocal =
          typeof window !== 'undefined' &&
          window.localStorage.getItem(`riskcart_fs_${collectionName}`) !== null;
        const emptyFallback = hasExplicitLocal
          ? ([] as T[])
          : initialDataRef.current.filter(
              (item) => !isMockOrDummyItem(item) && !deletedSet.has(String(item.id || ''))
            );
        setData(emptyFallback);
        writeLocalCache(collectionName, emptyFallback);
        setLoading(false);
      },
      (err: any) => {
        if (!isMounted) return;
        const msg = String(err?.message || err || '');
        setError(msg);
        const deletedSet = getDeletedFsIds(collectionName);
        setData((prev) =>
          prev.length > 0
            ? prev.filter((item) => !deletedSet.has(String(item.id || '')))
            : readLocalCache(collectionName, initialDataRef.current)
        );
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
      if (explicitId) {
        removeDeletedFsId(collectionName, explicitId);
      }
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
        removeDeletedFsId(collectionName, finalId);
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
        removeDeletedFsId(collectionName, fallbackId);
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
      if (!id) return false;
      addDeletedFsId(collectionName, id);
      const normCol = normalizeCollectionKey(collectionName);

      setData((prev) => {
        const next = prev.filter((item) => item.id !== id);
        writeLocalCache(collectionName, next);
        if (normCol !== collectionName) {
          writeLocalCache(normCol, next);
        }
        return next;
      });

      try {
        const deletes: Promise<any>[] = [
          deleteDoc(doc(db, collectionName, id)).catch(() => {}),
        ];
        if (collectionName !== 'stores' && !collectionName.startsWith('stores/')) {
          deletes.push(
            deleteDoc(doc(db, 'stores', STORE_ID, collectionName, id)).catch(() => {})
          );
        } else if (collectionName.startsWith('stores/') && normCol) {
          deletes.push(deleteDoc(doc(db, normCol, id)).catch(() => {}));
        }
        await Promise.all(deletes);
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
