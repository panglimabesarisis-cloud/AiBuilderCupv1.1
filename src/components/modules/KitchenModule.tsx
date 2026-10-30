import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Clock,
  Utensils,
  Flame,
  CheckCircle2,
  ChefHat,
  User,
  ShoppingBag,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Bell,
  Sparkles,
  LayoutGrid,
  Columns,
  Check,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { ACTIVE_STORE_ID } from '../../config/store';
import { fmtMoney, CurrencyMode } from '../../utils/money';
import { useLanguage } from '../../context/LanguageContext';
import { useAppNavigation } from '../../router';
import { publishRealtimeEvent, subscribeRealtimeEvent } from '../../utils/realtimeSyncBus';
import {
  useStaffDivisionsAndRoles,
  getRoleBadgeThemeClasses,
  ACTIVE_KITCHEN_PIC_LS_KEY,
} from '../../services/staffDivisionService';
import { Shield, Users } from 'lucide-react';

export type KitchenPipelineStage =
  | 'New Order'
  | 'Preparing'
  | 'Cooking'
  | 'Ready for Pick Up'
  | 'Completed';

export const KITCHEN_PIPELINE_STAGES: {
  id: KitchenPipelineStage;
  label: string;
  subtitle: string;
  badgeBg: string;
  borderAccent: string;
  headerBg: string;
  nextActionLabel?: string;
}[] = [
  {
    id: 'New Order',
    label: 'New Order',
    subtitle: 'Pesanan Baru Masuk',
    badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    borderAccent: 'border-amber-500/45',
    headerBg: 'from-amber-500/20 via-[#17120a] to-[#0d0b07]',
    nextActionLabel: 'Terima & Preparing →',
  },
  {
    id: 'Preparing',
    label: 'Preparing',
    subtitle: 'Persiapan Bahan & Racikan',
    badgeBg: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    borderAccent: 'border-sky-500/45',
    headerBg: 'from-sky-500/20 via-[#0c141d] to-[#090c10]',
    nextActionLabel: 'Mulai Cooking →',
  },
  {
    id: 'Cooking',
    label: 'Cooking',
    subtitle: 'Sedang Dimasak di Dapur',
    badgeBg: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    borderAccent: 'border-orange-500/45',
    headerBg: 'from-orange-500/20 via-[#1a1008] to-[#0d0906]',
    nextActionLabel: 'Ready for Pick Up →',
  },
  {
    id: 'Ready for Pick Up',
    label: 'Ready for Pick Up',
    subtitle: 'Siap Diantar Waiter ke Meja',
    badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    borderAccent: 'border-emerald-500/45',
    headerBg: 'from-emerald-500/20 via-[#091912] to-[#070d0a]',
    nextActionLabel: 'Selesai Diantar (Completed) ✓',
  },
  {
    id: 'Completed',
    label: 'Completed',
    subtitle: 'Pesanan Selesai Disajikan',
    badgeBg: 'bg-zinc-700/40 text-zinc-300 border-zinc-600/40',
    borderAccent: 'border-zinc-700/60',
    headerBg: 'from-zinc-800/50 via-[#121212] to-[#0a0a0a]',
  },
];

export interface KitchenOrderItem {
  id: string;
  name: string;
  qty: number;
  price?: number;
  note?: string;
  checked?: boolean;
}

export interface KitchenOrderCardDoc {
  id: string;
  orderNumber: string;
  tableId: string;
  tableNumber: string;
  customerName: string;
  items: KitchenOrderItem[];
  totalAmount: number;
  stage: KitchenPipelineStage;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  waiterName?: string;
  waiterRole?: string;
  waiterDivision?: string;
  orderNotes?: string;
  notes?: string;
  processedByStaff?: string;
  processedByRole?: string;
  processedByStation?: string;
  expediterName?: string;
}

export const LOCAL_STORAGE_KITCHEN_ORDERS_KEY = 'riskcart_kitchen_orders_v1';
export const DELETED_KITCHEN_ORDERS_LS_KEY = 'riskcart_deleted_kitchen_orders_v1';
const KITCHEN_DUMMY_PURGE_KEY = 'riskcart_purge_dummy_kitchen_v2';

const BUILTIN_DUMMY_KITCHEN_IDS = new Set([
  'ORD-WTR-SAMPLE-01',
  'ORD-WTR-SAMPLE-02',
  'ORD-WTR-SAMPLE-03',
  'ORD-WTR-101',
  'ORD-WTR-102',
  'ORD-WTR-103',
]);

function getDeletedKitchenOrderIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_KITCHEN_ORDERS_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.map(String));
    }
  } catch {}
  return new Set();
}

function addDeletedKitchenOrderIds(ids: string[]): void {
  try {
    const set = getDeletedKitchenOrderIds();
    ids.forEach((id) => {
      if (id) set.add(String(id));
    });
    localStorage.setItem(DELETED_KITCHEN_ORDERS_LS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

function isDummyKitchenOrder(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const id = String(raw.id || '').trim();
  const orderNo = String(raw.orderNumber || '').trim();
  if (BUILTIN_DUMMY_KITCHEN_IDS.has(id) || BUILTIN_DUMMY_KITCHEN_IDS.has(orderNo)) return true;
  if (/^ORD-WTR-SAMPLE-/i.test(id) || /^ORD-WTR-SAMPLE-/i.test(orderNo)) return true;
  const cust = String(raw.customerName || '').trim();
  if (
    /Hendra\s+Wijaya/i.test(cust) ||
    /Clarissa\s+Putri/i.test(cust) ||
    /Komunitas\s+Kopi\s+Nusantara/i.test(cust)
  ) {
    return true;
  }
  return false;
}

const createInitialKitchenSampleOrders = (): KitchenOrderCardDoc[] => {
  return [];
};

function normalizeKitchenStage(rawStage: any, rawStatus?: any): KitchenPipelineStage {
  const s = String(rawStage || '').trim();
  if (
    s === 'New Order' ||
    s === 'Preparing' ||
    s === 'Cooking' ||
    s === 'Ready for Pick Up' ||
    s === 'Completed'
  ) {
    return s;
  }
  const lower = String(rawStage || rawStatus || '').toLowerCase().trim();
  if (lower === 'preparing' || lower === 'verified' || lower === 'persiapan') {
    return 'Preparing';
  }
  if (lower === 'cooking' || lower === 'packing' || lower === 'processing' || lower === 'dimasak') {
    return 'Cooking';
  }
  if (lower === 'ready' || lower === 'ready for pick up' || lower === 'ready_for_pickup' || lower === 'siap') {
    return 'Ready for Pick Up';
  }
  if (lower === 'completed' || lower === 'delivered' || lower === 'done' || lower === 'selesai') {
    return 'Completed';
  }
  return 'New Order';
}

function mapRawOrderToKitchenCard(raw: any): KitchenOrderCardDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || raw.orderNumber || '').trim();
  if (!id) return null;

  // Extract table number from explicit field or customerName like "Bpk. Hendra (M-01)" or "Meja M-01"
  let tableNumber = String(raw.tableNumber || '').trim();
  let customerName = String(raw.customerName || 'Tamu Dine-In').trim();

  if (!tableNumber) {
    const matchParen = customerName.match(/\((M-\d+|Meja\s*[\w-]+)\)/i);
    if (matchParen) {
      tableNumber = matchParen[1].replace(/^Meja\s+/i, '').toUpperCase();
    } else {
      const matchPrefix = customerName.match(/^Meja\s+(M-\d+|\w+)/i);
      if (matchPrefix) {
        tableNumber = matchPrefix[1].toUpperCase();
      }
    }
  }
  if (!tableNumber) {
    tableNumber = 'M-01';
  }

  // Clean redundant "(M-01)" from customerName if desired, or keep readable
  const cleanCustomer =
    customerName.replace(/\s*\(M-\d+\)\s*$/i, '').trim() || `Pengunjung ${tableNumber}`;

  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items: KitchenOrderItem[] = rawItems.map((it: any, idx: number) => {
    const itemNote = String(it.note ?? it.notes ?? '').trim();
    return {
      id: String(it.id || it.productId || `item_${idx}`),
      name: String(it.name || it.productName || 'Menu POS'),
      qty: Math.max(1, Number(it.qty ?? it.quantityOrdered ?? it.quantity ?? 1)),
      price: Number(it.price ?? it.unitPrice ?? 0),
      note: itemNote || undefined,
      checked: Boolean(it.checked),
    };
  });

  const cleanOrderNotes = String(raw.orderNotes ?? '').trim();

  return {
    id,
    orderNumber: String(raw.orderNumber || id),
    tableId: String(raw.tableId || 'tbl_01'),
    tableNumber,
    customerName: cleanCustomer,
    items,
    totalAmount: Number(raw.totalAmount ?? raw.total ?? 0),
    stage: normalizeKitchenStage(raw.kitchenStage ?? raw.stage, raw.fulfillmentStatus ?? raw.status),
    createdAt: String(raw.createdAt || raw.timestamp || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || raw.createdAt || new Date().toISOString()),
    completedAt: raw.completedAt ? String(raw.completedAt) : undefined,
    waiterName: String(raw.waiterName || raw.cashierName || 'Waiter POS'),
    waiterRole: raw.waiterRole ? String(raw.waiterRole) : undefined,
    waiterDivision: raw.waiterDivision ? String(raw.waiterDivision) : undefined,
    orderNotes: cleanOrderNotes || undefined,
    notes: raw.notes ? String(raw.notes) : undefined,
    processedByStaff: raw.processedByStaff ? String(raw.processedByStaff) : undefined,
    processedByRole: raw.processedByRole ? String(raw.processedByRole) : undefined,
    processedByStation: raw.processedByStation ? String(raw.processedByStation) : undefined,
    expediterName: raw.expediterName ? String(raw.expediterName) : undefined,
  };
}

function formatOrderTimer(createdAtIso: string, completedAtIso: string | undefined, nowMs: number) {
  const startMs = Date.parse(createdAtIso);
  if (Number.isNaN(startMs)) {
    return {
      formatted: '00:00',
      clockTime: '-',
      elapsedMinutes: 0,
      urgency: 'normal' as 'normal' | 'warning' | 'critical',
    };
  }
  const endMs = completedAtIso ? Date.parse(completedAtIso) || nowMs : nowMs;
  const diffSec = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const hrs = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;

  const formatted =
    hrs > 0
      ? `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const totalMinutes = Math.floor(diffSec / 60);
  const urgency: 'normal' | 'warning' | 'critical' =
    totalMinutes >= 20 ? 'critical' : totalMinutes >= 10 ? 'warning' : 'normal';

  const clockTime = new Date(startMs).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return {
    formatted,
    clockTime,
    elapsedMinutes: totalMinutes,
    urgency,
  };
}

export const KitchenModule: React.FC = () => {
  const { currencyMode: rawCurr } = useLanguage();
  const currencyMode = (rawCurr as CurrencyMode) || 'IDR';
  const { navigateToPath } = useAppNavigation();

  const [kitchenOrders, setKitchenOrders] = useState<KitchenOrderCardDoc[]>(() => {
    try {
      const deletedSet = getDeletedKitchenOrderIds();
      const cached = localStorage.getItem(LOCAL_STORAGE_KITCHEN_ORDERS_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          const mapped = parsed
            .filter((item) => !isDummyKitchenOrder(item))
            .map((item) => mapRawOrderToKitchenCard(item))
            .filter(
              (item): item is KitchenOrderCardDoc =>
                Boolean(item) && !deletedSet.has(item!.id) && !isDummyKitchenOrder(item)
            );
          localStorage.setItem(LOCAL_STORAGE_KITCHEN_ORDERS_KEY, JSON.stringify(mapped));
          return mapped;
        }
      }
    } catch {}
    return [];
  });

  const [activeFilterStage, setActiveFilterStage] = useState<'ALL' | KitchenPipelineStage>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [draggingOrderId, setDraggingOrderId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<KitchenPipelineStage | null>(null);

  // Staff Division & Role Integration for Kitchen Team On-Duty
  const { kitchenStaffOnDuty, roster } = useStaffDivisionsAndRoles();
  const kitchenTeamList = useMemo(() => {
    if (kitchenStaffOnDuty.length > 0) return kitchenStaffOnDuty;
    return roster.filter(
      (s) =>
        s.status !== 'inactive' &&
        (s.divisionId === 'div_kitchen' ||
          String(s.divisionName || '').toLowerCase().includes('kitchen') ||
          String(s.divisionName || '').toLowerCase().includes('dapur'))
    );
  }, [kitchenStaffOnDuty, roster]);

  const [selectedKitchenPicId, setSelectedKitchenPicId] = useState<string>(() => {
    try {
      return localStorage.getItem(ACTIVE_KITCHEN_PIC_LS_KEY) || '';
    } catch {
      return '';
    }
  });

  const activeKitchenPic = useMemo(() => {
    if (selectedKitchenPicId) {
      const found = kitchenTeamList.find((s) => s.id === selectedKitchenPicId);
      if (found) return found;
    }
    const expediter = kitchenTeamList.find((s) =>
      String(s.role || '').toLowerCase().includes('expediter')
    );
    if (expediter) return expediter;
    const execChef = kitchenTeamList.find((s) =>
      String(s.role || '').toLowerCase().includes('executive chef')
    );
    return execChef || kitchenTeamList[0] || null;
  }, [kitchenTeamList, selectedKitchenPicId]);

  const activeExpediterStaff = useMemo(() => {
    return (
      kitchenTeamList.find((s) => String(s.role || '').toLowerCase().includes('expediter')) ||
      activeKitchenPic
    );
  }, [kitchenTeamList, activeKitchenPic]);

  const handleSelectKitchenPic = (staffId: string) => {
    setSelectedKitchenPicId(staffId);
    try {
      localStorage.setItem(ACTIVE_KITCHEN_PIC_LS_KEY, staffId);
    } catch {}
  };

  // Live 1-second timer tick for accurate kitchen stopwatch on every card
  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Save kitchen orders list to localStorage
  const saveToLocalCache = useCallback((list: KitchenOrderCardDoc[]) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KITCHEN_ORDERS_KEY, JSON.stringify(list));
    } catch {}
  }, []);

  // Persist single kitchen order to Firestore (`kitchen_orders`, `stores/{id}/kitchen_orders`, and sync stage to `orders`, `transactions`, and `restaurant_tables`)
  const persistKitchenOrderDoc = useCallback(async (cardDoc: KitchenOrderCardDoc) => {
    try {
      const nowIso = new Date().toISOString();
      const clean = JSON.parse(
        JSON.stringify({
          ...cardDoc,
          kitchenStage: cardDoc.stage,
          updatedAt: nowIso,
        })
      );

      const mappedOrderStatus =
        cardDoc.stage === 'Preparing' || cardDoc.stage === 'Cooking'
          ? 'Sedang Mengemas'
          : cardDoc.stage === 'Ready for Pick Up'
          ? 'Dikirim'
          : cardDoc.stage === 'Completed'
          ? 'Terkirim'
          : 'New';

      const orderStageSync = {
        kitchenStage: cardDoc.stage,
        fulfillmentStatus: mappedOrderStatus,
        status: mappedOrderStatus,
        ...(cardDoc.processedByStaff ? { processedByStaff: cardDoc.processedByStaff } : {}),
        ...(cardDoc.processedByRole ? { processedByRole: cardDoc.processedByRole } : {}),
        ...(cardDoc.processedByStation ? { processedByStation: cardDoc.processedByStation } : {}),
        ...(cardDoc.expediterName ? { expediterName: cardDoc.expediterName } : {}),
        updatedAt: nowIso,
      };

      const writes: Promise<any>[] = [
        setDoc(doc(db, 'kitchen_orders', cardDoc.id), clean, { merge: true }).catch(() => {}),
        ACTIVE_STORE_ID
          ? setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'kitchen_orders', cardDoc.id), clean, {
              merge: true,
            }).catch(() => {})
          : Promise.resolve(),
        setDoc(doc(db, 'orders', cardDoc.id), orderStageSync, { merge: true }).catch(() => {}),
        ACTIVE_STORE_ID
          ? setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'orders', cardDoc.id), orderStageSync, {
              merge: true,
            }).catch(() => {})
          : Promise.resolve(),
        setDoc(doc(db, 'transactions', cardDoc.id), orderStageSync, { merge: true }).catch(() => {}),
      ];

      if (cardDoc.tableId) {
        const tableSync = {
          kitchenStage: cardDoc.stage,
          ...(cardDoc.stage === 'Ready for Pick Up' ? { status: 'billing' } : {}),
          updatedAt: nowIso,
        };
        writes.push(
          setDoc(doc(db, 'restaurant_tables', cardDoc.tableId), tableSync, { merge: true }).catch(() => {}),
          ACTIVE_STORE_ID
            ? setDoc(
                doc(db, 'stores', ACTIVE_STORE_ID, 'restaurant_tables', cardDoc.tableId),
                tableSync,
                { merge: true }
              ).catch(() => {})
            : Promise.resolve()
        );

        try {
          const rawTables = localStorage.getItem('riskcart_restaurant_tables_v1');
          if (rawTables) {
            const parsedTables = JSON.parse(rawTables);
            if (Array.isArray(parsedTables)) {
              const nextTables = parsedTables.map((t: any) =>
                t.id === cardDoc.tableId || t.number === cardDoc.tableNumber
                  ? { ...t, ...tableSync }
                  : t
              );
              localStorage.setItem('riskcart_restaurant_tables_v1', JSON.stringify(nextTables));
            }
          }
        } catch {}

        publishRealtimeEvent('tables_updated', {
          tableId: cardDoc.tableId,
          tableNumber: cardDoc.tableNumber,
          kitchenStage: cardDoc.stage,
        });
      }

      publishRealtimeEvent('orders_updated', {
        orderId: cardDoc.id,
        ...orderStageSync,
      });
      publishRealtimeEvent('kitchen_updated', {
        orderId: cardDoc.id,
        stage: cardDoc.stage,
      });

      await Promise.all(writes);
    } catch (e) {
      console.warn('Persist kitchen_orders warning:', e);
    }
  }, []);

  // Real-time Firestore listeners (`kitchen_orders` + `stores/{ACTIVE_STORE_ID}/orders` + `orders`)
  useEffect(() => {
    // One-time automatic purge of legacy dummy kitchen tickets from Firestore & localStorage
    const purgeDummyKitchenOrders = async () => {
      try {
        if (localStorage.getItem(KITCHEN_DUMMY_PURGE_KEY) === 'done') return;
        localStorage.setItem(KITCHEN_DUMMY_PURGE_KEY, 'done');
        addDeletedKitchenOrderIds(Array.from(BUILTIN_DUMMY_KITCHEN_IDS));

        const snapRoot = await getDocs(collection(db, 'kitchen_orders')).catch(() => null);
        if (snapRoot && !snapRoot.empty) {
          for (const d of snapRoot.docs) {
            if (isDummyKitchenOrder({ id: d.id, ...(d.data() as any) })) {
              addDeletedKitchenOrderIds([d.id]);
              await deleteDoc(doc(db, 'kitchen_orders', d.id)).catch(() => {});
            }
          }
        }
        if (ACTIVE_STORE_ID) {
          const snapStore = await getDocs(
            collection(db, 'stores', ACTIVE_STORE_ID, 'kitchen_orders')
          ).catch(() => null);
          if (snapStore && !snapStore.empty) {
            for (const d of snapStore.docs) {
              if (isDummyKitchenOrder({ id: d.id, ...(d.data() as any) })) {
                addDeletedKitchenOrderIds([d.id]);
                await deleteDoc(
                  doc(db, 'stores', ACTIVE_STORE_ID, 'kitchen_orders', d.id)
                ).catch(() => {});
              }
            }
          }
        }
      } catch {}
    };
    void purgeDummyKitchenOrders();

    const mergeIncomingOrders = (incoming: KitchenOrderCardDoc[]) => {
      const deletedSet = getDeletedKitchenOrderIds();
      const validIncoming = incoming.filter(
        (inc) => inc && !deletedSet.has(inc.id) && !isDummyKitchenOrder(inc)
      );
      if (validIncoming.length === 0) return;
      setKitchenOrders((prev) => {
        const map = new Map<string, KitchenOrderCardDoc>();
        prev
          .filter((o) => !deletedSet.has(o.id) && !isDummyKitchenOrder(o))
          .forEach((o) => map.set(o.id, o));
        validIncoming.forEach((inc) => {
          const existing = map.get(inc.id);
          if (!existing) {
            map.set(inc.id, inc);
          } else {
            const existingTime = Date.parse(existing.updatedAt || '') || 0;
            const incTime = Date.parse(inc.updatedAt || '') || 0;
            map.set(inc.id, incTime >= existingTime ? { ...existing, ...inc } : existing);
          }
        });
        const merged = Array.from(map.values()).sort(
          (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
        );
        saveToLocalCache(merged);
        return merged;
      });
    };

    const unsubKitchenRoot = onSnapshot(
      collection(db, 'kitchen_orders'),
      (snap) => {
        const deletedSet = getDeletedKitchenOrderIds();
        if (!snap.empty) {
          const docs = snap.docs
            .map((d) => {
              const raw = { id: d.id, ...(d.data() as any) };
              if (isDummyKitchenOrder(raw)) {
                void deleteDoc(doc(db, 'kitchen_orders', d.id)).catch(() => {});
                return null;
              }
              return mapRawOrderToKitchenCard(raw);
            })
            .filter(
              (d): d is KitchenOrderCardDoc => Boolean(d) && !deletedSet.has(d!.id)
            );
          mergeIncomingOrders(docs);
        }
      },
      () => {}
    );

    const unsubStoreOrders = onSnapshot(
      collection(db, 'stores', ACTIVE_STORE_ID, 'orders'),
      (snap) => {
        const deletedSet = getDeletedKitchenOrderIds();
        if (!snap.empty) {
          const waiterOrTableOrders = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as any) }))
            .filter(
              (raw) =>
                !isDummyKitchenOrder(raw) &&
                !deletedSet.has(String(raw.id || '')) &&
                (Boolean(raw.tableNumber) ||
                  Boolean(raw.tableId) ||
                  String(raw.id || '').startsWith('ORD-WTR-') ||
                  String(raw.paymentMethod || '').toLowerCase().includes('waiter') ||
                  String(raw.paymentMethod || '').toLowerCase().includes('dine-in'))
            )
            .map((raw) => mapRawOrderToKitchenCard(raw))
            .filter(Boolean) as KitchenOrderCardDoc[];
          mergeIncomingOrders(waiterOrTableOrders);
        }
      },
      () => {}
    );

    const unsubRealtimeKitchen = subscribeRealtimeEvent('kitchen_updated', (payload: any) => {
      if (payload?.newKitchenOrder) {
        const mapped = mapRawOrderToKitchenCard(payload.newKitchenOrder);
        if (mapped && !isDummyKitchenOrder(mapped)) mergeIncomingOrders([mapped]);
      } else if (payload?.deletedOrderId) {
        setKitchenOrders((prev) => {
          const next = prev.filter((o) => o.id !== payload.deletedOrderId);
          saveToLocalCache(next);
          return next;
        });
      } else if (payload?.orderId && payload?.stage) {
        setKitchenOrders((prev) =>
          prev.map((o) =>
            o.id === payload.orderId || o.orderNumber === payload.orderId
              ? { ...o, stage: payload.stage, updatedAt: new Date().toISOString() }
              : o
          )
        );
      }
    });

    const onStorageSync = (ev: StorageEvent) => {
      if (ev.key === LOCAL_STORAGE_KITCHEN_ORDERS_KEY && ev.newValue !== null) {
        try {
          const deletedSet = getDeletedKitchenOrderIds();
          const parsed = JSON.parse(ev.newValue);
          if (Array.isArray(parsed)) {
            const docs = parsed
              .filter((raw) => !isDummyKitchenOrder(raw))
              .map((raw) => mapRawOrderToKitchenCard(raw))
              .filter(
                (d): d is KitchenOrderCardDoc => Boolean(d) && !deletedSet.has(d!.id)
              );
            setKitchenOrders(docs);
          }
        } catch {}
      }
    };
    window.addEventListener('storage', onStorageSync);

    return () => {
      unsubKitchenRoot();
      unsubStoreOrders();
      unsubRealtimeKitchen();
      window.removeEventListener('storage', onStorageSync);
    };
  }, [saveToLocalCache]);

  const handleDeleteKitchenOrder = useCallback(
    async (orderId: string) => {
      if (!orderId) return;
      addDeletedKitchenOrderIds([orderId]);
      setKitchenOrders((prev) => {
        const next = prev.filter((o) => o.id !== orderId);
        saveToLocalCache(next);
        return next;
      });
      await Promise.all([
        deleteDoc(doc(db, 'kitchen_orders', orderId)).catch(() => {}),
        ACTIVE_STORE_ID
          ? deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'kitchen_orders', orderId)).catch(
              () => {}
            )
          : Promise.resolve(),
      ]);
      publishRealtimeEvent('kitchen_updated', { deletedOrderId: orderId });
    },
    [saveToLocalCache]
  );

  const handleClearAllKitchenOrders = useCallback(async () => {
    const idsToDelete = kitchenOrders.map((o) => o.id);
    addDeletedKitchenOrderIds([...idsToDelete, ...Array.from(BUILTIN_DUMMY_KITCHEN_IDS)]);
    setKitchenOrders([]);
    saveToLocalCache([]);
    await Promise.all(
      idsToDelete.flatMap((id) => [
        deleteDoc(doc(db, 'kitchen_orders', id)).catch(() => {}),
        ACTIVE_STORE_ID
          ? deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'kitchen_orders', id)).catch(() => {})
          : Promise.resolve(),
      ])
    );
  }, [kitchenOrders, saveToLocalCache]);

  // Update a card's pipeline stage and record active Kitchen Staff / Expediter
  const handleMoveStage = (orderId: string, nextStage: KitchenPipelineStage) => {
    const nowIso = new Date().toISOString();
    let updatedDoc: KitchenOrderCardDoc | null = null;
    const nextList = kitchenOrders.map((ord) => {
      if (ord.id !== orderId) return ord;
      const updated: KitchenOrderCardDoc = {
        ...ord,
        stage: nextStage,
        updatedAt: nowIso,
        completedAt: nextStage === 'Completed' ? nowIso : undefined,
        processedByStaff: activeKitchenPic?.name || ord.processedByStaff || 'Chef Dapur',
        processedByRole: activeKitchenPic?.role || ord.processedByRole || 'Executive Chef',
        processedByStation: activeKitchenPic?.station || ord.processedByStation || 'Main Kitchen',
        expediterName:
          nextStage === 'Ready for Pick Up' || nextStage === 'Completed'
            ? activeExpediterStaff?.name || activeKitchenPic?.name || ord.expediterName
            : ord.expediterName,
      };
      updatedDoc = updated;
      return updated;
    });
    setKitchenOrders(nextList);
    saveToLocalCache(nextList);
    if (updatedDoc) {
      void persistKitchenOrderDoc(updatedDoc);
    }
  };

  // Toggle individual menu item check inside a card
  const handleToggleItemCheck = (orderId: string, itemId: string) => {
    const nowIso = new Date().toISOString();
    let updatedDoc: KitchenOrderCardDoc | null = null;
    const nextList = kitchenOrders.map((ord) => {
      if (ord.id !== orderId) return ord;
      const updatedItems = ord.items.map((it) =>
        it.id === itemId ? { ...it, checked: !it.checked } : it
      );
      const updated: KitchenOrderCardDoc = {
        ...ord,
        items: updatedItems,
        updatedAt: nowIso,
        processedByStaff: activeKitchenPic?.name || ord.processedByStaff || 'Chef Dapur',
        processedByRole: activeKitchenPic?.role || ord.processedByRole || 'Executive Chef',
        processedByStation: activeKitchenPic?.station || ord.processedByStation || 'Main Kitchen',
      };
      updatedDoc = updated;
      return updated;
    });
    setKitchenOrders(nextList);
    saveToLocalCache(nextList);
    if (updatedDoc) {
      void persistKitchenOrderDoc(updatedDoc);
    }
  };

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return kitchenOrders.filter((ord) => {
      if (activeFilterStage !== 'ALL' && ord.stage !== activeFilterStage) return false;
      if (!q) return true;
      const matchTable = ord.tableNumber.toLowerCase().includes(q);
      const matchCustomer = ord.customerName.toLowerCase().includes(q);
      const matchOrderNo = ord.orderNumber.toLowerCase().includes(q);
      const matchItem = ord.items.some((i) => i.name.toLowerCase().includes(q));
      return matchTable || matchCustomer || matchOrderNo || matchItem;
    });
  }, [kitchenOrders, activeFilterStage, searchQuery]);

  const stageCounts = useMemo(() => {
    const counts: Record<KitchenPipelineStage, number> = {
      'New Order': 0,
      Preparing: 0,
      Cooking: 0,
      'Ready for Pick Up': 0,
      Completed: 0,
    };
    kitchenOrders.forEach((o) => {
      counts[o.stage] = (counts[o.stage] || 0) + 1;
    });
    return counts;
  }, [kitchenOrders]);

  const stagesToRender = useMemo(() => {
    if (activeFilterStage === 'ALL') return KITCHEN_PIPELINE_STAGES;
    return KITCHEN_PIPELINE_STAGES.filter((s) => s.id === activeFilterStage);
  }, [activeFilterStage]);

  return (
    <div className="space-y-5 pb-10">
      {/* Top Kitchen Header Bar (No Sidebar, Clean Full-Width Workspace) */}
      <div className="p-5 rounded-2xl bg-[#110f0a] border border-amber-500/40 shadow-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-400 shadow">
              <ChefHat className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-amber-50 tracking-tight">
                  Kitchen Display System (/kitchen)
                </h1>
                <span className="px-2.5 py-0.5 rounded-lg text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  LIVE PIPELINE DAPUR
                </span>
              </div>
              <p className="text-xs text-amber-100/70 mt-0.5">
                Alur Pipeline Dapur Real-Time: <strong>New Order</strong> → <strong>Preparing</strong> →{' '}
                <strong>Cooking</strong> → <strong>Ready for Pick Up</strong> → <strong>Completed</strong>
              </p>
            </div>
          </div>
        </div>

        {/* Right Controls: Search & Quick Navigation to /waiters and /dashboard/orders/new */}
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari No. Meja / Pemesan / Menu..."
            className="px-3.5 py-2 rounded-xl bg-[#090805] border border-amber-500/35 focus:border-amber-400 text-xs text-white placeholder-zinc-500 focus:outline-none w-56"
          />

          {kitchenOrders.length > 0 && (
            <button
              type="button"
              onClick={handleClearAllKitchenOrders}
              className="px-3.5 py-2 rounded-xl bg-rose-950/70 hover:bg-rose-600 hover:text-white text-rose-200 border border-rose-500/40 text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5"
              title="Kosongkan semua tiket pesanan dapur dari tampilan & database"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Kosongkan Tiket ({kitchenOrders.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => navigateToPath('/waiters')}
            className="px-3.5 py-2 rounded-xl bg-[#18130a] hover:bg-amber-500 hover:text-black text-amber-200 border border-amber-500/40 text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5"
          >
            <Utensils className="w-3.5 h-3.5" />
            <span>Halaman Waiters (/waiters)</span>
          </button>

          <button
            type="button"
            onClick={() => navigateToPath('/dashboard/orders/new')}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 text-black text-xs font-black transition cursor-pointer flex items-center gap-1.5 shadow-md"
          >
            <ShoppingBag className="w-3.5 h-3.5 text-black" />
            <span>Antrean Orders (/dashboard/orders/new)</span>
          </button>
        </div>
      </div>

      {/* Active Kitchen Division Team On-Duty Roster & PIC / Expediter Selector */}
      <div className="p-4 rounded-2xl bg-[#110f0a] border border-amber-500/35 shadow-xl space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xs sm:text-sm font-black text-amber-50 uppercase tracking-wider">
                  Tim Divisi Kitchen (Dapur) Bertugas — Shift Aktif ({kitchenTeamList.length} Personil)
                </h2>
                {activeKitchenPic && (
                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    PIC Aktif: {activeKitchenPic.name} ({activeKitchenPic.role})
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-400">
                Klik kartu personil dapur di bawah untuk memilih PIC / Expediter yang memproses tiket pesanan saat ini.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-[#090805] border border-amber-500/30 rounded-xl px-2.5 py-1.5">
              <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-[11px] font-bold text-zinc-400">PIC Proses / Expediter:</span>
              <select
                value={activeKitchenPic?.id || ''}
                onChange={(e) => handleSelectKitchenPic(e.target.value)}
                className="bg-transparent text-xs font-black text-amber-300 focus:outline-none cursor-pointer"
              >
                {kitchenTeamList.map((stf) => (
                  <option key={stf.id} value={stf.id} className="bg-zinc-950 text-white">
                    {stf.name} — [{stf.role}] ({stf.station || 'Dapur'})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => navigateToPath('/dashboard/shift/divisi-role')}
              className="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/35 text-[11px] font-bold transition cursor-pointer flex items-center gap-1.5"
            >
              <ChefHat className="w-3.5 h-3.5" />
              <span>Kelola Divisi & Role Staff</span>
            </button>
          </div>
        </div>

        {/* Horizontal Cards of Kitchen Team Members with Role Color Badges */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
          {kitchenTeamList.map((member) => {
            const isSelectedPic = activeKitchenPic?.id === member.id;
            const roleBadgeClass = getRoleBadgeThemeClasses(member.role, true);
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => handleSelectKitchenPic(member.id)}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between gap-1.5 ${
                  isSelectedPic
                    ? 'bg-amber-500/15 border-amber-400 ring-1 ring-amber-400/50 shadow-md'
                    : 'bg-[#090805] hover:bg-zinc-900/90 border-zinc-800/90'
                }`}
              >
                <div className="flex items-start justify-between gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold border truncate max-w-full ${roleBadgeClass}`}
                    title={member.role}
                  >
                    {member.role}
                  </span>
                  {member.onDutyShift && (
                    <span
                      className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 mt-1"
                      title="On-Duty Shift Aktif"
                    />
                  )}
                </div>
                <div>
                  <div className="text-xs font-black text-white truncate">{member.name}</div>
                  <div className="text-[10px] text-zinc-400 font-mono truncate">
                    {member.station || 'Stasiun Dapur'} • {member.shiftTime || 'Shift Pagi'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pipeline Stage Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-[#110f0a] border border-amber-500/30">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveFilterStage('ALL')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
              activeFilterStage === 'ALL'
                ? 'bg-amber-500 text-black shadow-md'
                : 'bg-[#090805] text-amber-100/80 hover:text-white border border-amber-500/25'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Semua Pipeline ({kitchenOrders.length})</span>
          </button>

          {KITCHEN_PIPELINE_STAGES.map((st) => {
            const active = activeFilterStage === st.id;
            const count = stageCounts[st.id] || 0;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => setActiveFilterStage(st.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
                  active
                    ? 'bg-amber-500 text-black shadow-md'
                    : 'bg-[#090805] text-amber-100/80 hover:text-white border border-amber-500/25'
                }`}
              >
                <span>{st.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-black ${
                    active ? 'bg-black/20 text-black' : 'bg-amber-500/15 text-amber-300'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" /> &lt; 10 mnt
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> 10–20 mnt
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> &gt; 20 mnt (Urgent)
          </span>
        </div>
      </div>

      {/* 5-Column Pipeline Board: New Order | Preparing | Cooking | Ready for Pick Up | Completed */}
      <div
        className={`grid grid-cols-1 ${
          activeFilterStage === 'ALL' ? 'lg:grid-cols-5' : 'lg:grid-cols-1 max-w-4xl mx-auto'
        } gap-4 items-start`}
      >
        {stagesToRender.map((stageMeta, stageIdx) => {
          const stageCards = filteredOrders.filter((o) => o.stage === stageMeta.id);
          const isDropTarget = dragOverStage === stageMeta.id;

          return (
            <div
              key={stageMeta.id}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverStage(stageMeta.id);
              }}
              onDragLeave={() => setDragOverStage(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverStage(null);
                if (draggingOrderId) {
                  handleMoveStage(draggingOrderId, stageMeta.id);
                  setDraggingOrderId(null);
                }
              }}
              className={`rounded-2xl bg-[#110f0a] border-2 transition-all flex flex-col min-h-[580px] shadow-2xl ${
                isDropTarget
                  ? 'border-amber-400 ring-2 ring-amber-400/30 bg-[#17130b]'
                  : stageMeta.borderAccent
              }`}
            >
              {/* Pipeline Column Header */}
              <div
                className={`p-3.5 rounded-t-2xl bg-gradient-to-r ${stageMeta.headerBg} border-b border-amber-500/25 flex items-center justify-between gap-2`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-white tracking-tight">
                      {stageMeta.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400">{stageMeta.subtitle}</p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-xl text-xs font-mono font-black border ${stageMeta.badgeBg}`}
                >
                  {stageCards.length}
                </span>
              </div>

              {/* Cards Container inside Column */}
              <div className="p-3 space-y-3.5 flex-1">
                {stageCards.length === 0 ? (
                  <div className="h-48 rounded-xl border border-dashed border-zinc-800/90 flex flex-col items-center justify-center text-center p-4 text-zinc-500 text-xs">
                    <Utensils className="w-6 h-6 mb-1.5 opacity-40" />
                    <span>Belum ada pesanan di tahap {stageMeta.label}</span>
                  </div>
                ) : (
                  stageCards.map((card) => {
                    const timer = formatOrderTimer(card.createdAt, card.completedAt, nowTick);
                    const allStageList = KITCHEN_PIPELINE_STAGES.map((s) => s.id);
                    const currentIdx = allStageList.indexOf(card.stage);
                    const prevStage = currentIdx > 0 ? allStageList[currentIdx - 1] : null;
                    const nextStage =
                      currentIdx < allStageList.length - 1 ? allStageList[currentIdx + 1] : null;

                    const timerBadgeClass =
                      card.stage === 'Completed'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                        : timer.urgency === 'critical'
                        ? 'bg-rose-500/25 text-rose-300 border-rose-500/60 animate-pulse'
                        : timer.urgency === 'warning'
                        ? 'bg-amber-500/25 text-amber-300 border-amber-500/50'
                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';

                    return (
                      <div
                        key={card.id}
                        draggable
                        onDragStart={() => setDraggingOrderId(card.id)}
                        onDragEnd={() => {
                          setDraggingOrderId(null);
                          setDragOverStage(null);
                        }}
                        className="rounded-2xl bg-[#090805] border border-amber-500/35 hover:border-amber-400/70 p-3.5 space-y-3 shadow-lg transition cursor-grab active:cursor-grabbing"
                      >
                        {/* 1. Card Top Row: Nomor Meja + Timer Waktu */}
                        <div className="flex items-start justify-between gap-2 border-b border-zinc-800/90 pb-2.5">
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-1 rounded-xl bg-amber-500 text-black font-mono font-black text-xs sm:text-sm shadow">
                              Meja {card.tableNumber}
                            </span>
                            <div>
                              <div className="text-[10px] font-mono text-zinc-400">
                                #{card.orderNumber.slice(-8)}
                              </div>
                              <div className="text-[10px] text-amber-300/80 font-mono">
                                Masuk: {timer.clockTime}
                              </div>
                            </div>
                          </div>

                          {/* Live Stopwatch Timer */}
                          <div
                            className={`px-2.5 py-1 rounded-xl border font-mono text-xs font-black flex items-center gap-1.5 shrink-0 tabular-nums ${timerBadgeClass}`}
                            title="Timer Waktu Pesanan"
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>{timer.formatted}</span>
                          </div>
                        </div>

                        {/* 2. Nama Pemesan / Pengunjung */}
                        <div className="px-2.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800/90 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <User className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-bold">
                                Pemesan
                              </div>
                              <div className="text-xs font-black text-white truncate">
                                {card.customerName}
                              </div>
                            </div>
                          </div>
                          <span className="text-[11px] font-mono font-bold text-amber-300 shrink-0">
                            {card.items.reduce((s, i) => s + i.qty, 0)} Item
                          </span>
                        </div>

                        {/* 2a. Info Waiter Pengirim & PIC Kitchen / Expediter */}
                        <div className="px-2.5 py-1.5 rounded-xl bg-zinc-950/90 border border-zinc-800/80 flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
                          <div className="flex items-center gap-1.5 text-zinc-300 truncate">
                            <span className="text-zinc-500 font-semibold">Waiter:</span>
                            <span className="font-bold text-teal-300 truncate">
                              {card.waiterName || 'Waiter POS'}
                            </span>
                            {card.waiterRole && (
                              <span className="px-1.5 py-0.2 rounded bg-teal-500/15 border border-teal-500/30 text-teal-300 font-mono text-[9px]">
                                {card.waiterRole}
                              </span>
                            )}
                          </div>
                          {card.processedByStaff ? (
                            <div className="flex items-center gap-1 truncate">
                              <span className="text-zinc-500">PIC:</span>
                              <span
                                className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${getRoleBadgeThemeClasses(
                                  card.processedByRole || 'Executive Chef',
                                  true
                                )}`}
                              >
                                {card.processedByStaff} ({card.processedByRole || 'Chef'})
                              </span>
                            </div>
                          ) : (
                            <span className="text-[9px] font-mono text-zinc-500">
                              Siap diproses: {activeKitchenPic?.name || 'Tim Kitchen'}
                            </span>
                          )}
                        </div>

                        {/* 2b. Catatan Order Umum Meja (jika ada) */}
                        {(card.orderNotes ||
                          (card.notes &&
                            !card.notes.startsWith('Pesanan Waiter — Meja'))) && (
                          <div className="rc-notes-preview px-2.5 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-[11px] text-amber-200 font-semibold leading-snug">
                            📝 <span className="font-black text-amber-300">Catatan Meja:</span>{' '}
                            &ldquo;{card.orderNotes || card.notes}&rdquo;
                          </div>
                        )}

                        {/* 3. Daftar Pesanan Menu */}
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-mono uppercase tracking-wider text-amber-300/90 font-bold flex items-center justify-between">
                            <span>Daftar Pesanan</span>
                            <span className="text-zinc-500">Klik item = selesai</span>
                          </div>

                          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                            {card.items.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => handleToggleItemCheck(card.id, item.id)}
                                className={`w-full p-2 rounded-xl border text-left transition flex flex-col gap-1 cursor-pointer ${
                                  item.checked
                                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200 line-through opacity-80'
                                    : 'bg-zinc-950 hover:bg-zinc-900 border-zinc-800 text-white'
                                }`}
                              >
                                <div className="w-full flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span
                                      className={`w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-mono font-black shrink-0 ${
                                        item.checked
                                          ? 'bg-emerald-500 text-black'
                                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                      }`}
                                    >
                                      {item.checked ? <Check className="w-3 h-3" /> : `${item.qty}x`}
                                    </span>
                                    <span className="text-xs font-bold truncate">{item.name}</span>
                                  </div>
                                  <span className="text-[11px] font-mono font-bold text-amber-300 shrink-0">
                                    ×{item.qty}
                                  </span>
                                </div>
                                {item.note && (
                                  <div className="rc-notes-preview ml-7 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-[10px] font-semibold text-amber-300">
                                    📝 &ldquo;{item.note}&rdquo;
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Total & Stage Progression Action Buttons */}
                        <div className="pt-2 border-t border-zinc-800/90 space-y-2">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-zinc-400">Total Pesanan</span>
                            <span className="font-mono font-black text-amber-300">
                              {fmtMoney(card.totalAmount, currencyMode)}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {prevStage && (
                              <button
                                type="button"
                                onClick={() => handleMoveStage(card.id, prevStage)}
                                className="px-2.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 text-xs font-bold transition cursor-pointer"
                                title={`Kembali ke ${prevStage}`}
                              >
                                <ArrowLeft className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {nextStage ? (
                              <button
                                type="button"
                                onClick={() => handleMoveStage(card.id, nextStage)}
                                className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 text-black font-black text-xs flex items-center justify-center gap-1.5 shadow cursor-pointer transition"
                              >
                                <span>{stageMeta.nextActionLabel || `Ke ${nextStage} →`}</span>
                              </button>
                            ) : (
                              <div className="flex-1 py-1.5 px-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-bold text-xs flex items-center justify-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Selesai Disajikan</span>
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => handleDeleteKitchenOrder(card.id)}
                              className="px-2.5 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-bold transition cursor-pointer"
                              title="Hapus Tiket Pesanan Ini"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
