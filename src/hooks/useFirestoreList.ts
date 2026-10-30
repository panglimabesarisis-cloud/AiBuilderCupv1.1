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
  limit,
  where,
  QueryConstraint,
} from 'firebase/firestore';
import { db, isFirestoreQuotaExhausted, markFirestoreQuotaExhausted } from '../firebase';
import { isDatabaseWipeInProgress } from '../services/dataSeeder';
import { ACTIVE_STORE_ID } from '../config/store';
import { enqueuePendingSync } from '../utils/dbSync';

const STORE_ID = ACTIVE_STORE_ID || 'store_001';

const LIMITED_HISTORY_COLLECTIONS = new Set([
  'transactions',
  'orders',
  'shifts',
  'cash_logs',
  'cash_flows',
  'audit_logs',
  'stock_logs',
  'brangkas_toko_logs',
  'purchase_orders',
  'pos_cart_cancellations',
  'staff_deliveries',
  'doku_settlements',
  'payment_webhooks',
]);

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
  const normCol = normalizeCollectionKey(collectionName);
  const deletedSet = getDeletedFsIds(normCol);
  try {
    if (typeof window === 'undefined') {
      return defaultData.filter((x: any) => !deletedSet.has(String(x?.id || '')));
    }
    const candidateKeys = [
      `riskcart_fs_${collectionName}`,
      `riskcart_cache_${collectionName}`,
      `riskcart_fs_${normCol}`,
      `riskcart_cache_${normCol}`,
    ];
    for (const k of candidateKeys) {
      const raw = window.localStorage.getItem(k);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleaned = parsed.filter(
            (x) => !isMockOrDummyItem(x) && !deletedSet.has(String(x?.id || ''))
          );
          if (cleaned.length > 0) return cleaned as T[];
        }
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
    const normCol = normalizeCollectionKey(collectionName);
    window.localStorage.setItem(`riskcart_fs_${collectionName}`, JSON.stringify(items));
    window.localStorage.setItem(`riskcart_cache_${collectionName}`, JSON.stringify(items));
    if (normCol && normCol !== collectionName) {
      window.localStorage.setItem(`riskcart_fs_${normCol}`, JSON.stringify(items));
      window.localStorage.setItem(`riskcart_cache_${normCol}`, JSON.stringify(items));
    }
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
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const initialDataRef = useRef(initialData);
  initialDataRef.current = initialData;

  useEffect(() => {
    let isMounted = true;
    const normCol = normalizeCollectionKey(collectionName);

    const handleCleanSlate = () => {
      if (!isMounted || !isDatabaseWipeInProgress()) return;
      setData([]);
    };

    const handleCacheUpdated = (e: Event) => {
      if (!isMounted) return;
      const customEvent = e as CustomEvent<{ collectionName: string; items: T[] }>;
      const eventCol = normalizeCollectionKey(customEvent.detail?.collectionName || '');
      if (
        (customEvent.detail?.collectionName === collectionName || eventCol === normCol) &&
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

    // If Firestore quota is already known to be exhausted, operate 100% from local cache
    if (isFirestoreQuotaExhausted()) {
      setData((prev) =>
        prev.length > 0 ? prev : readLocalCache(collectionName, initialDataRef.current)
      );
      setLoading(false);
      return () => {
        isMounted = false;
        window.removeEventListener('riskcart_clean_slate_wiped', handleCleanSlate);
        window.removeEventListener('riskcart_fs_cache_updated', handleCacheUpdated);
      };
    }

    const colRef = collection(db, collectionName);
    const effectiveConstraints =
      constraints.length > 0
        ? constraints
        : collectionName === 'stores'
        ? [limit(50)]
        : [where('storeId', '==', STORE_ID), limit(50)];
    const q = query(colRef, ...effectiveConstraints);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
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
          setError(null);
          return;
        }

        const cached = readLocalCache(collectionName, initialDataRef.current);
        setData(cached);
        setLoading(false);
        setError(null);
      },
      (err: any) => {
        if (!isMounted) return;
        if (err?.code === 'resource-exhausted') {
          markFirestoreQuotaExhausted(true);
        }
        setError(null);
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
    };
  }, [collectionName]);

  const addItem = useCallback(
    async (item: Omit<T, 'id'> & { id?: string }): Promise<string | null> => {
      const nowIso = new Date().toISOString();
      const explicitId = (item as any)?.id ? String((item as any).id).trim() : '';
      const fallbackId =
        explicitId || `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      removeDeletedFsId(collectionName, fallbackId);

      const payload = {
        ...item,
        id: fallbackId,
        createdAt: (item as any)?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      // Cache-First: Immediately update state & localStorage so UI is 100% responsive offline
      const optimisticItem = payload as unknown as T;
      setData((prev) => {
        const next = [optimisticItem, ...prev.filter((p) => p.id !== fallbackId)];
        writeLocalCache(collectionName, next);
        return next;
      });

      if (isFirestoreQuotaExhausted()) {
        enqueuePendingSync({
          op: 'set',
          collectionPath: collectionName,
          docId: fallbackId,
          data: payload,
          merge: true,
        });
        return fallbackId;
      }

      try {
        await setDoc(doc(db, collectionName, fallbackId), payload as any, { merge: true });
        return fallbackId;
      } catch (err: any) {
        const errCode = String(err?.code || '').toLowerCase();
        if (errCode.includes('resource-exhausted') || String(err?.message || '').toLowerCase().includes('quota')) {
          markFirestoreQuotaExhausted(true);
        }
        enqueuePendingSync({
          op: 'set',
          collectionPath: collectionName,
          docId: fallbackId,
          data: payload,
          merge: true,
        });
        return fallbackId;
      }
    },
    [collectionName]
  );

  const updateItem = useCallback(
    async (id: string, updates: Partial<T>): Promise<boolean> => {
      const nowIso = new Date().toISOString();
      const patchPayload = {
        ...updates,
        updatedAt: nowIso,
      };
      setData((prev) => {
        const next = prev.map((item) =>
          item.id === id ? ({ ...item, ...patchPayload } as T) : item
        );
        writeLocalCache(collectionName, next);
        return next;
      });

      if (isFirestoreQuotaExhausted()) {
        enqueuePendingSync({
          op: 'set',
          collectionPath: collectionName,
          docId: id,
          data: patchPayload,
          merge: true,
        });
        return true;
      }

      try {
        await setDoc(doc(db, collectionName, id), patchPayload as any, { merge: true });
        return true;
      } catch (err: any) {
        const errCode = String(err?.code || '').toLowerCase();
        if (errCode.includes('resource-exhausted') || String(err?.message || '').toLowerCase().includes('quota')) {
          markFirestoreQuotaExhausted(true);
        }
        enqueuePendingSync({
          op: 'set',
          collectionPath: collectionName,
          docId: id,
          data: patchPayload,
          merge: true,
        });
        return true;
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
