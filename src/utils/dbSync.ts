import {
  doc,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  collection,
  type DocumentReference,
  type CollectionReference,
  type SetOptions,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ACTIVE_STORE_ID } from '../config/store';

export interface PendingSyncOperation {
  id: string;
  op: 'set' | 'delete';
  collectionPath: string;
  docId: string;
  data?: any;
  merge?: boolean;
  timestamp: string;
  retryCount: number;
}

const PENDING_SYNC_QUEUE_KEY = 'riskcart_pending_sync_queue_v1';

const NUMERIC_FIELD_KEYS = new Set([
  'x',
  'y',
  'rotation',
  'seats',
  'visitorPax',
  'visitorCount',
  'price',
  'unitPrice',
  'buyPrice',
  'costPrice',
  'costPerUnit',
  'costPerSubUnit',
  'costPerCarton',
  'sellPrice',
  'posPrice',
  'pwaPrice',
  'pricePerUnit',
  'pricePerCarton',
  'totalOrder',
  'totalRevenue',
  'totalAmount',
  'total',
  'subtotal',
  'totalCost',
  'totalModal',
  'totalProfit',
  'keuntungan',
  'downpayment',
  'paidAmount',
  'remainingDebt',
  'durasi',
  'durasiDineIn',
  'qty',
  'quantity',
  'quantityOrdered',
  'stock',
  'stockInUnits',
  'stockInSubUnits',
  'minStock',
  'minStockAlert',
  'itemsPerCarton',
  'piecesPerCarton',
  'isiPerDus',
  'weightMl',
  'beratPerItem',
  'totalBeratKg',
  'wastagePercent',
  'qtyPerUnit',
  'amount',
]);

const STRING_EMPTY_FALLBACK_KEYS = new Set([
  'visitorName',
  'notes',
  'note',
  'description',
  'seatedAt',
  'email',
  'phone',
  'nomorHandphone',
  'address',
  'batchCode',
  'productionDate',
  'expiryDate',
  'receivedDate',
  'imageUrl',
  'barcode',
  'brand',
  'category',
  'supplierId',
  'supplierName',
]);

function isFirestoreSentinel(val: any): boolean {
  if (!val || typeof val !== 'object') return false;
  if (typeof val._methodName === 'string') return true;
  if (typeof val.toDate === 'function' && typeof val.seconds === 'number') return true;
  return false;
}

function isDomOrReactNode(val: any): boolean {
  if (!val || typeof val !== 'object') return false;
  if (typeof Element !== 'undefined' && val instanceof Element) return true;
  if (typeof Node !== 'undefined' && val instanceof Node) return true;
  if (val.$$typeof) return true;
  return false;
}

/**
 * Global helper to sanitize any object/array before writing to Firestore or Backend Database.
 * - Replaces `undefined` with `null` (or `""` for text fields)
 * - Replaces `NaN`, `Infinity`, `-Infinity` with `0`
 * - Coerces known numeric fields (x, y, rotation, price, durasi, etc.) into finite Numbers
 * - Strips functions, symbols, and DOM/React nodes
 */
export function sanitizeForDatabase<T>(input: T, parentKey?: string): T {
  if (input === undefined) {
    if (parentKey && NUMERIC_FIELD_KEYS.has(parentKey)) return 0 as unknown as T;
    if (parentKey && STRING_EMPTY_FALLBACK_KEYS.has(parentKey)) return '' as unknown as T;
    return null as unknown as T;
  }

  if (input === null) {
    if (parentKey && NUMERIC_FIELD_KEYS.has(parentKey)) return 0 as unknown as T;
    if (parentKey && STRING_EMPTY_FALLBACK_KEYS.has(parentKey)) return '' as unknown as T;
    return null as unknown as T;
  }

  if (typeof input === 'number') {
    return (Number.isFinite(input) ? input : 0) as unknown as T;
  }

  if (typeof input === 'string') {
    if (parentKey && NUMERIC_FIELD_KEYS.has(parentKey)) {
      const parsed = Number(input);
      return (Number.isFinite(parsed) ? parsed : 0) as unknown as T;
    }
    return input as unknown as T;
  }

  if (typeof input === 'boolean') {
    return input;
  }

  if (typeof input === 'function' || typeof input === 'symbol') {
    return null as unknown as T;
  }

  if (input instanceof Date) {
    return (Number.isNaN(input.getTime())
      ? new Date().toISOString()
      : input.toISOString()) as unknown as T;
  }

  if (isFirestoreSentinel(input)) {
    return input;
  }

  if (isDomOrReactNode(input)) {
    return null as unknown as T;
  }

  if (Array.isArray(input)) {
    const cleanArr = input
      .filter((item) => typeof item !== 'function' && typeof item !== 'symbol' && !isDomOrReactNode(item))
      .map((item) => sanitizeForDatabase(item));
    return cleanArr as unknown as T;
  }

  if (typeof input === 'object') {
    const out: Record<string, any> = {};
    for (const [key, rawVal] of Object.entries(input as Record<string, any>)) {
      if (!key || key.startsWith('__')) continue;
      if (typeof rawVal === 'function' || typeof rawVal === 'symbol' || isDomOrReactNode(rawVal)) {
        continue;
      }
      if (rawVal === undefined) {
        if (NUMERIC_FIELD_KEYS.has(key)) {
          out[key] = 0;
        } else if (STRING_EMPTY_FALLBACK_KEYS.has(key)) {
          out[key] = '';
        } else {
          out[key] = null;
        }
        continue;
      }
      out[key] = sanitizeForDatabase(rawVal, key);
    }
    return out as T;
  }

  return input;
}

export function getPendingSyncQueue(): PendingSyncOperation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PENDING_SYNC_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePendingSyncQueue(queue: PendingSyncOperation[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PENDING_SYNC_QUEUE_KEY, JSON.stringify(queue.slice(-500)));
  } catch {}
}

export function enqueuePendingSync(op: Omit<PendingSyncOperation, 'id' | 'timestamp' | 'retryCount'>): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getPendingSyncQueue();
    const key = `${op.op}:${op.collectionPath}/${op.docId}`;
    const filtered = current.filter((item) => `${item.op}:${item.collectionPath}/${item.docId}` !== key);
    filtered.push({
      ...op,
      data: op.data !== undefined ? sanitizeForDatabase(op.data) : undefined,
      id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      retryCount: 0,
    });
    savePendingSyncQueue(filtered);
  } catch {}
}

async function mirrorWriteToBackendServer(
  op: 'set' | 'delete',
  collectionPath: string,
  docId: string,
  data?: any,
  merge = true
): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return false;
  try {
    const token =
      window.sessionStorage?.getItem('riskcart_server_token') ||
      window.localStorage?.getItem('riskcart_server_token') ||
      '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch('/api/db/sync', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        op,
        collectionPath,
        docId,
        data: data !== undefined ? sanitizeForDatabase(data) : undefined,
        merge,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Writes a document to Firestore (and mirrors to backend `/api/db/sync`) with full payload sanitization,
 * transparent error logging, and automatic recovery queue fallback if offline.
 */
export async function syncDocToDatabase(
  collectionPath: string,
  docId: string,
  rawData: any,
  options: SetOptions = { merge: true }
): Promise<boolean> {
  const cleanId = String(docId || '').trim().replace(/^\/+|\/+$/g, '');
  const cleanCol = String(collectionPath || '').trim().replace(/^\/+|\/+$/g, '');
  if (!cleanCol || !cleanId) return false;

  const cleanPayload = sanitizeForDatabase(rawData);
  let clientSuccess = false;
  let serverSuccess = false;

  try {
    const segments = cleanCol.split('/').filter(Boolean);
    const docRef = doc(db, segments[0], ...segments.slice(1), cleanId);
    await setDoc(docRef, cleanPayload, options);
    clientSuccess = true;
  } catch (err: any) {
    console.error('[DB Sync Rejected - Client Firestore]', {
      collectionPath: cleanCol,
      docId: cleanId,
      code: err?.code || 'unknown',
      message: err?.message || String(err),
    });
  }

  try {
    serverSuccess = await mirrorWriteToBackendServer('set', cleanCol, cleanId, cleanPayload, true);
  } catch {}

  if (!clientSuccess && !serverSuccess) {
    enqueuePendingSync({
      op: 'set',
      collectionPath: cleanCol,
      docId: cleanId,
      data: cleanPayload,
      merge: true,
    });
    return false;
  }

  return true;
}

export async function deleteDocFromDatabase(
  collectionPath: string,
  docId: string
): Promise<boolean> {
  const cleanId = String(docId || '').trim().replace(/^\/+|\/+$/g, '');
  const cleanCol = String(collectionPath || '').trim().replace(/^\/+|\/+$/g, '');
  if (!cleanCol || !cleanId) return false;

  let clientSuccess = false;
  let serverSuccess = false;

  try {
    const segments = cleanCol.split('/').filter(Boolean);
    const docRef = doc(db, segments[0], ...segments.slice(1), cleanId);
    await deleteDoc(docRef);
    clientSuccess = true;
  } catch (err: any) {
    console.error('[DB Delete Rejected - Client Firestore]', {
      collectionPath: cleanCol,
      docId: cleanId,
      code: err?.code || 'unknown',
      message: err?.message || String(err),
    });
  }

  try {
    serverSuccess = await mirrorWriteToBackendServer('delete', cleanCol, cleanId);
  } catch {}

  if (!clientSuccess && !serverSuccess) {
    enqueuePendingSync({
      op: 'delete',
      collectionPath: cleanCol,
      docId: cleanId,
    });
    return false;
  }

  return true;
}

/**
 * Drop-in safe wrappers for Firestore `setDoc`, `updateDoc`, and `addDoc` that always sanitize payloads first.
 */
export async function safeSetDoc(
  docRef: DocumentReference<any>,
  data: any,
  options: SetOptions = { merge: true }
): Promise<void> {
  const sanitized = sanitizeForDatabase(data);
  const pathSegments = docRef.path.split('/').filter(Boolean);
  const docId = pathSegments[pathSegments.length - 1] || '';
  const collectionPath = pathSegments.slice(0, -1).join('/');

  try {
    await setDoc(docRef, sanitized, options);
    void mirrorWriteToBackendServer('set', collectionPath, docId, sanitized, true);
  } catch (err: any) {
    console.error('[safeSetDoc Error]', {
      path: docRef.path,
      code: err?.code || 'unknown',
      message: err?.message || String(err),
    });
    const okServer = await mirrorWriteToBackendServer('set', collectionPath, docId, sanitized, true);
    if (!okServer && collectionPath && docId) {
      enqueuePendingSync({
        op: 'set',
        collectionPath,
        docId,
        data: sanitized,
        merge: true,
      });
    }
  }
}

export async function safeUpdateDoc(docRef: DocumentReference<any>, data: any): Promise<void> {
  await safeSetDoc(docRef, data, { merge: true });
}

export async function safeAddDoc(colRef: CollectionReference<any>, data: any): Promise<void> {
  const sanitized = sanitizeForDatabase(data);
  try {
    await addDoc(colRef, sanitized);
  } catch (err: any) {
    console.error('[safeAddDoc Error]', {
      path: colRef.path,
      code: err?.code || 'unknown',
      message: err?.message || String(err),
    });
    const fallbackId = String(sanitized?.id || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    await syncDocToDatabase(colRef.path, fallbackId, { ...sanitized, id: fallbackId });
  }
}

let isFlushingQueue = false;

/**
 * Flushes any queued operations in `riskcart_pending_sync_queue_v1` to Firestore & backend server.
 */
export async function flushPendingSyncQueue(): Promise<{ flushed: number; remaining: number }> {
  if (typeof window === 'undefined' || isFlushingQueue) {
    return { flushed: 0, remaining: getPendingSyncQueue().length };
  }
  const queue = getPendingSyncQueue();
  if (queue.length === 0) return { flushed: 0, remaining: 0 };

  isFlushingQueue = true;
  let flushed = 0;
  const remainingQueue: PendingSyncOperation[] = [];

  try {
    for (const item of queue) {
      let ok = false;
      try {
        const segments = item.collectionPath.split('/').filter(Boolean);
        const docRef = doc(db, segments[0], ...segments.slice(1), item.docId);
        if (item.op === 'set') {
          const clean = sanitizeForDatabase(item.data || {});
          await setDoc(docRef, clean, { merge: item.merge !== false });
          void mirrorWriteToBackendServer('set', item.collectionPath, item.docId, clean, true);
          ok = true;
        } else if (item.op === 'delete') {
          await deleteDoc(docRef);
          void mirrorWriteToBackendServer('delete', item.collectionPath, item.docId);
          ok = true;
        }
      } catch {
        const serverOk = await mirrorWriteToBackendServer(
          item.op,
          item.collectionPath,
          item.docId,
          item.data,
          item.merge !== false
        );
        ok = serverOk;
      }

      if (ok) {
        flushed++;
      } else if (item.retryCount < 15) {
        remainingQueue.push({ ...item, retryCount: item.retryCount + 1 });
      }
    }
    savePendingSyncQueue(remainingQueue);
  } finally {
    isFlushingQueue = false;
  }

  return { flushed, remaining: remainingQueue.length };
}

let isResyncingLocalCaches = false;

/**
 * Automatically pushes any local data in `localStorage` across all modules
 * (Tables, Reservations, Dine-In History, Table Areas, Raw Materials, Suppliers, POs, PRs)
 * to Firestore and the backend server so nothing stays local-only.
 */
export async function autoResyncLocalCachesToServer(): Promise<void> {
  if (typeof window === 'undefined' || isResyncingLocalCaches) return;
  isResyncingLocalCaches = true;

  try {
    await flushPendingSyncQueue();

    const localCollectionMappings: Array<{
      storageKey: string;
      collections: string[];
      deletedStorageKey?: string;
    }> = [
      {
        storageKey: 'riskcart_restaurant_tables_v1',
        collections: [
          'restaurant_tables',
          'tables',
          ...(ACTIVE_STORE_ID ? [`stores/${ACTIVE_STORE_ID}/restaurant_tables`] : []),
        ],
        deletedStorageKey: 'riskcart_deleted_table_ids_v1',
      },
      {
        storageKey: 'riskcart_table_reservations_v1',
        collections: [
          'table_reservations',
          'reservations',
          ...(ACTIVE_STORE_ID ? [`stores/${ACTIVE_STORE_ID}/table_reservations`] : []),
        ],
        deletedStorageKey: 'riskcart_deleted_reservation_ids_v1',
      },
      {
        storageKey: 'riskcart_table_dinein_history_v1',
        collections: [
          'table_dinein_history',
          ...(ACTIVE_STORE_ID ? [`stores/${ACTIVE_STORE_ID}/table_dinein_history`] : []),
        ],
        deletedStorageKey: 'riskcart_deleted_dinein_ids_v1',
      },
      {
        storageKey: 'riskcart_raw_materials_v2',
        collections: [
          'raw_materials',
          ...(ACTIVE_STORE_ID ? [`stores/${ACTIVE_STORE_ID}/raw_materials`] : []),
        ],
        deletedStorageKey: 'riskcart_deleted_raw_materials_v1',
      },
      {
        storageKey: 'riskcart_rm_suppliers_v2',
        collections: ['raw_material_suppliers', 'suppliers'],
        deletedStorageKey: 'riskcart_deleted_rm_suppliers_v1',
      },
      {
        storageKey: 'riskcart_rm_pos_v2',
        collections: ['raw_material_purchase_orders'],
      },
      {
        storageKey: 'riskcart_rm_prs_v2',
        collections: ['raw_material_purchase_requests'],
      },
    ];

    for (const mapping of localCollectionMappings) {
      try {
        const raw = localStorage.getItem(mapping.storageKey);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) continue;

        let deletedIds = new Set<string>();
        if (mapping.deletedStorageKey) {
          const rawDel = localStorage.getItem(mapping.deletedStorageKey);
          if (rawDel) {
            const parsedDel = JSON.parse(rawDel);
            if (Array.isArray(parsedDel)) {
              deletedIds = new Set(parsedDel.map(String));
            }
          }
        }

        for (const item of parsed) {
          if (!item || !item.id || deletedIds.has(String(item.id))) continue;
          const cleanItem = sanitizeForDatabase(item);
          for (const colPath of mapping.collections) {
            await syncDocToDatabase(colPath, String(item.id), cleanItem);
          }
        }
      } catch {}
    }

    // Also sync table_areas_config if present
    try {
      const rawAreas = localStorage.getItem('riskcart_table_areas_v1');
      if (rawAreas) {
        const areas = JSON.parse(rawAreas);
        if (Array.isArray(areas) && areas.length > 0) {
          const payload = sanitizeForDatabase({
            id: 'table_areas_config',
            areas: areas.map((a) => String(a).trim()).filter(Boolean),
            updatedAt: new Date().toISOString(),
          });
          await syncDocToDatabase('settings', 'table_areas_config', payload);
          if (ACTIVE_STORE_ID) {
            await syncDocToDatabase(
              `stores/${ACTIVE_STORE_ID}/settings`,
              'table_areas_config',
              payload
            );
          }
        }
      }
    } catch {}
  } finally {
    isResyncingLocalCaches = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void autoResyncLocalCachesToServer();
  });
}
