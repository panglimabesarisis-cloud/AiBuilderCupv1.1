import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ACTIVE_STORE_ID } from '../config/store';

export type RealtimeSyncTopic =
  | 'orders_updated'
  | 'kitchen_updated'
  | 'tables_updated'
  | 'reservations_updated'
  | 'products_updated'
  | 'transactions_updated'
  | 'finance_updated'
  | 'ai_updated';

export interface RealtimeSyncMessage<T = any> {
  topic: RealtimeSyncTopic;
  payload: T;
  timestamp: number;
  senderTabId: string;
}

const CHANNEL_NAME = 'riskcart_realtime_sync_v1';
const STORAGE_BROADCAST_KEY = 'riskcart_realtime_sync_last_event_v1';
const TAB_ID = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

let broadcastChannel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
  }
} catch {
  broadcastChannel = null;
}

/**
 * Publishes a real-time event across all open browser tabs and within the current tab.
 */
export function publishRealtimeEvent<T = any>(topic: RealtimeSyncTopic, payload: T): void {
  if (typeof window === 'undefined') return;
  const message: RealtimeSyncMessage<T> = {
    topic,
    payload,
    timestamp: Date.now(),
    senderTabId: TAB_ID,
  };

  try {
    broadcastChannel?.postMessage(message);
  } catch {
    // Fallback to localStorage event if BroadcastChannel is unavailable
  }

  try {
    localStorage.setItem(STORAGE_BROADCAST_KEY, JSON.stringify(message));
  } catch {
    // Ignore storage quota warnings
  }

  setTimeout(() => {
    try {
      window.dispatchEvent(new CustomEvent(`riskcart_sync_${topic}`, { detail: message }));
      window.dispatchEvent(new CustomEvent('riskcart_sync_any', { detail: message }));
    } catch {
      // Ignore custom event errors
    }
  }, 0);
}

/**
 * Subscribes to a real-time sync topic from both the current tab and other browser tabs.
 */
export function subscribeRealtimeEvent<T = any>(
  topic: RealtimeSyncTopic | 'any',
  handler: (payload: T, message: RealtimeSyncMessage<T>) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const onChannelMessage = (ev: MessageEvent) => {
    const msg = ev.data as RealtimeSyncMessage<T>;
    if (!msg || !msg.topic) return;
    if (topic === 'any' || msg.topic === topic) {
      handler(msg.payload, msg);
    }
  };

  const onStorageEvent = (ev: StorageEvent) => {
    if (ev.key !== STORAGE_BROADCAST_KEY || !ev.newValue) return;
    try {
      const msg = JSON.parse(ev.newValue) as RealtimeSyncMessage<T>;
      if (!msg || !msg.topic || msg.senderTabId === TAB_ID) return;
      if (topic === 'any' || msg.topic === topic) {
        handler(msg.payload, msg);
      }
    } catch {
      // Ignore parse errors
    }
  };

  const customEventName = topic === 'any' ? 'riskcart_sync_any' : `riskcart_sync_${topic}`;
  const onCustomEvent = (ev: Event) => {
    const customEv = ev as CustomEvent<RealtimeSyncMessage<T>>;
    if (!customEv.detail) return;
    handler(customEv.detail.payload, customEv.detail);
  };

  broadcastChannel?.addEventListener('message', onChannelMessage);
  window.addEventListener('storage', onStorageEvent);
  window.addEventListener(customEventName, onCustomEvent);

  return () => {
    broadcastChannel?.removeEventListener('message', onChannelMessage);
    window.removeEventListener('storage', onStorageEvent);
    window.removeEventListener(customEventName, onCustomEvent);
  };
}

/**
 * When a Dine-In / Waiter / Table order is paid in full at Cashier POS or Orders Module,
 * automatically mark the Kitchen Order as Completed and reset the Table in Denah Meja to Available ('Kosong/Siap').
 */
export async function completeTableAndKitchenOrderOnPayment(params: {
  orderId?: string;
  tableId?: string;
  tableNumber?: string;
  customerName?: string;
  waiterName?: string;
  totalAmount?: number;
  paymentMethod?: string;
  items?: Array<{ name: string; qty: number; price: number; notes?: string }>;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const {
    orderId,
    tableId,
    tableNumber,
    customerName,
    waiterName,
    totalAmount = 0,
    paymentMethod = 'Tunai',
    items = [],
  } = params;

  const writes: Promise<any>[] = [];

  // 1. Mark Kitchen Order as Completed in Firestore & localStorage
  if (orderId) {
    const kitchenUpdates = {
      stage: 'Completed',
      kitchenStage: 'Completed',
      status: 'Completed',
      paymentStatus: 'paid',
      completedAt: nowIso,
      updatedAt: nowIso,
    };
    writes.push(
      updateDoc(doc(db, 'kitchen_orders', orderId), kitchenUpdates).catch(() => {}),
      updateDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'kitchen_orders', orderId), kitchenUpdates).catch(() => {}),
      updateDoc(doc(db, 'orders', orderId), {
        status: 'Terkirim',
        fulfillmentStatus: 'Terkirim',
        kitchenStage: 'Completed',
        paymentStatus: 'paid',
        paidAmount: totalAmount,
        remainingDebt: 0,
        paidAt: nowIso,
        updatedAt: nowIso,
      }).catch(() => {}),
      updateDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'orders', orderId), {
        status: 'Terkirim',
        fulfillmentStatus: 'Terkirim',
        kitchenStage: 'Completed',
        paymentStatus: 'paid',
        paidAmount: totalAmount,
        remainingDebt: 0,
        paidAt: nowIso,
        updatedAt: nowIso,
      }).catch(() => {})
    );

    try {
      const rawK = localStorage.getItem('riskcart_kitchen_orders_v1');
      if (rawK) {
        const parsedK = JSON.parse(rawK);
        if (Array.isArray(parsedK)) {
          const nextK = parsedK.map((ko: any) =>
            ko.id === orderId || ko.orderNumber === orderId
              ? { ...ko, ...kitchenUpdates }
              : ko
          );
          localStorage.setItem('riskcart_kitchen_orders_v1', JSON.stringify(nextK));
        }
      }
    } catch {
      // Ignore storage error
    }
    publishRealtimeEvent('kitchen_updated', { orderId, stage: 'Completed' });
  }

  // 2. Reset Table Status in restaurant_tables to 'available' (Kosong/Siap) and log to table_dinein_history
  let resolvedTableId = tableId || '';
  let resolvedTableNumber = tableNumber || '';

  try {
    const rawTables = localStorage.getItem('riskcart_restaurant_tables_v1');
    if (rawTables) {
      const parsedTables = JSON.parse(rawTables);
      if (Array.isArray(parsedTables)) {
        const matchedTable = parsedTables.find(
          (t: any) =>
            (resolvedTableId && t.id === resolvedTableId) ||
            (resolvedTableNumber &&
              (String(t.tableNumber || '').toLowerCase() === String(resolvedTableNumber).toLowerCase() ||
                String(t.number || '').toLowerCase() === String(resolvedTableNumber).toLowerCase())) ||
            (orderId && t.activeOrderId === orderId)
        );
        if (matchedTable) {
          resolvedTableId = matchedTable.id;
          resolvedTableNumber = matchedTable.tableNumber || matchedTable.number || resolvedTableNumber;
        }
        if (resolvedTableId) {
          const updatedTables = parsedTables.map((t: any) =>
            t.id === resolvedTableId
              ? {
                  ...t,
                  status: 'available',
                  visitorName: '',
                  customerName: '',
                  visitorPhone: '',
                  paxVisited: 0,
                  orders: [],
                  totalOrder: 0,
                  totalBill: 0,
                  activeOrderId: '',
                  orderNotes: '',
                  updatedAt: nowIso,
                }
              : t
          );
          localStorage.setItem('riskcart_restaurant_tables_v1', JSON.stringify(updatedTables));
        }
      }
    }
  } catch {
    // Ignore storage error
  }

  if (resolvedTableId) {
    const tableResetPayload = {
      status: 'available',
      visitorName: '',
      customerName: '',
      visitorPhone: '',
      paxVisited: 0,
      orders: [],
      totalOrder: 0,
      totalBill: 0,
      activeOrderId: '',
      orderNotes: '',
      updatedAt: nowIso,
    };
    writes.push(
      setDoc(doc(db, 'restaurant_tables', resolvedTableId), tableResetPayload, { merge: true }).catch(() => {}),
      setDoc(
        doc(db, 'stores', ACTIVE_STORE_ID, 'restaurant_tables', resolvedTableId),
        tableResetPayload,
        { merge: true }
      ).catch(() => {})
    );

    const histId = `DINE-PAID-${Date.now()}`;
    const histRecord = {
      id: histId,
      storeId: ACTIVE_STORE_ID,
      type: 'dine-in',
      date: nowIso.slice(0, 10),
      timeIn: new Date(Date.now() - 35 * 60000).toTimeString().slice(0, 5),
      timeOut: new Date().toTimeString().slice(0, 5),
      durationMinutes: 35,
      tableId: resolvedTableId,
      tableNumber: resolvedTableNumber || resolvedTableId,
      area: 'Indoor Utama',
      customerName: customerName || `Tamu Meja ${resolvedTableNumber || resolvedTableId}`,
      customerPhone: '-',
      pax: 2,
      waiterName: waiterName || 'Waiter POS',
      orders: items,
      totalSpent: totalAmount,
      paymentMethod,
      status: 'completed',
      notes: `Lunas di Kasir POS (${paymentMethod})`,
      createdAt: nowIso,
    };
    writes.push(
      setDoc(doc(db, 'table_dinein_history', histId), histRecord, { merge: true }).catch(() => {}),
      setDoc(
        doc(db, 'stores', ACTIVE_STORE_ID, 'table_dinein_history', histId),
        histRecord,
        { merge: true }
      ).catch(() => {})
    );

    try {
      const rawHist = localStorage.getItem('riskcart_table_dinein_history_v1');
      const parsedHist = rawHist ? JSON.parse(rawHist) : [];
      if (Array.isArray(parsedHist)) {
        localStorage.setItem(
          'riskcart_table_dinein_history_v1',
          JSON.stringify([histRecord, ...parsedHist].slice(0, 200))
        );
      }
    } catch {
      // Ignore storage error
    }

    publishRealtimeEvent('tables_updated', {
      tableId: resolvedTableId,
      status: 'available',
    });
  }

  publishRealtimeEvent('orders_updated', { orderId, status: 'Terkirim', paymentStatus: 'paid' });
  await Promise.all(writes);
}
