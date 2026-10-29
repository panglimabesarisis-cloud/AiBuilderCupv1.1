import React, { useState, useEffect, useMemo } from 'react';
import {
  ShoppingBag,
  Truck,
  CheckCircle2,
  Clock,
  RotateCcw,
  XCircle,
  Package,
  Search,
  Filter,
  RefreshCw,
  Printer,
  Share2,
  Phone,
  MessageCircle,
  ChevronRight,
  User,
  MapPin,
  Calendar,
  DollarSign,
  TrendingUp,
  AlertCircle,
  Plus,
  ArrowRight,
  ExternalLink,
  X,
  CreditCard,
  FileSpreadsheet,
  Check,
  Send,
  Boxes,
  Layers,
  Sparkles,
  Eye,
  Edit2,
  Trash2,
  MoreVertical,
  ChevronDown,
  Wallet,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { reconcileCompletedTransaction } from '../../services/stockSyncService';
import { isLegacyMockOrderOrTx, isDatabaseWipeInProgress } from '../../services/dataSeeder';
import { Order, OrderItem, OrderStatus, OrderChannel, OrderPaymentRecord } from '../../types';
import { useAppNavigation, AppLink } from '../../router';
import { openTransactionDetailModal } from '../common/GlobalModals';
import { ACTIVE_STORE_ID } from '../../config/store';
import { useAppData } from '../../context/AppDataContext';
import {
  publishRealtimeEvent,
  subscribeRealtimeEvent,
  completeTableAndKitchenOrderOnPayment,
} from '../../utils/realtimeSyncBus';

const STORE_ID = ACTIVE_STORE_ID;

interface StaffCourier {
  id: string;
  name: string;
  role: string;
  phone: string;
  outlet?: string;
  shift?: string;
  status?: string;
}

const DEFAULT_COURIERS: StaffCourier[] = [];

interface OrdersModuleProps {
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

export type CanonicalOrderStage =
  | 'new'
  | 'packing'
  | 'shipped'
  | 'delivered'
  | 'returned'
  | 'cancelled';

export const PIPELINE_STAGES: Array<{
  key: 'new' | 'packing' | 'shipped' | 'delivered';
  firestoreStatus: OrderStatus;
  stepLabel: string;
  pillLabel: string;
  shortLabel: string;
  num: number;
}> = [
  {
    key: 'new',
    firestoreStatus: 'New',
    stepLabel: '1. New',
    pillLabel: '1. NEW',
    shortLabel: 'New',
    num: 1,
  },
  {
    key: 'packing',
    firestoreStatus: 'Sedang Mengemas',
    stepLabel: '2. Sedang Mengemas',
    pillLabel: '2. SEDANG MENGEMAS',
    shortLabel: 'Sedang Mengemas',
    num: 2,
  },
  {
    key: 'shipped',
    firestoreStatus: 'Dikirim',
    stepLabel: '3. Dikirim',
    pillLabel: '3. DIKIRIM',
    shortLabel: 'Dikirim',
    num: 3,
  },
  {
    key: 'delivered',
    firestoreStatus: 'Terkirim',
    stepLabel: '4. Terkirim',
    pillLabel: '4. TERKIRIM',
    shortLabel: 'Terkirim',
    num: 4,
  },
];

export function getCanonicalOrderStage(
  statusRaw?: string,
  fulfillmentRaw?: string
): CanonicalOrderStage {
  const s = String(statusRaw || '').trim().toLowerCase();
  const f = String(fulfillmentRaw || '').trim().toLowerCase();

  if (
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'void' ||
    s === 'rejected' ||
    s === 'batal'
  ) {
    return 'cancelled';
  }
  if (s === 'returned' || s === 'retur' || s === 'refunded') {
    return 'returned';
  }

  const matchFourStage = (
    val: string
  ): 'new' | 'packing' | 'shipped' | 'delivered' | null => {
    if (!val) return null;
    if (
      val === 'new' ||
      val === '1. new' ||
      val === 'baru' ||
      val === 'pending' ||
      val === 'pending_approval' ||
      val === 'menunggu' ||
      val === 'antrean'
    ) {
      return 'new';
    }
    if (
      val === 'packing' ||
      val === 'sedang mengemas' ||
      val === '2. sedang mengemas' ||
      val === 'mengemas' ||
      val === 'dikemas' ||
      val === 'processing' ||
      val === 'diproses'
    ) {
      return 'packing';
    }
    if (
      val === 'shipped' ||
      val === 'dikirim' ||
      val === '3. dikirim' ||
      val === 'on_delivery' ||
      val === 'dalam pengiriman'
    ) {
      return 'shipped';
    }
    if (
      val === 'delivered' ||
      val === 'terkirim' ||
      val === '4. terkirim' ||
      val === 'selesai'
    ) {
      return 'delivered';
    }
    return null;
  };

  if (s === 'completed') {
    const fromF = matchFourStage(f);
    if (fromF) return fromF;
    return 'delivered';
  }

  const fromS = matchFourStage(s);
  if (fromS) return fromS;

  const fromF = matchFourStage(f);
  if (fromF) return fromF;

  if (s === 'completed' || f === 'completed') {
    return 'delivered';
  }

  return 'new';
}

export function getNextPipelineStage(currentStage: CanonicalOrderStage): {
  key: 'new' | 'packing' | 'shipped' | 'delivered';
  firestoreStatus: OrderStatus;
  stepLabel: string;
  pillLabel: string;
  shortLabel: string;
  num: number;
} | null {
  if (currentStage === 'new') return PIPELINE_STAGES[1];
  if (currentStage === 'packing') return PIPELINE_STAGES[2];
  if (currentStage === 'shipped') return PIPELINE_STAGES[3];
  return null;
}

import { useLanguage } from '../../context/LanguageContext';
import { useAccessControl } from '../../context/AccessControlContext';

export const OrdersModule: React.FC<OrdersModuleProps> = ({
  onNavigateTab,
}) => {
  const { formatCurrency } = useLanguage();
  const { shouldHideHppAndMargin } = useAccessControl();
  const hideHpp = shouldHideHppAndMargin();
  const { customers, currencyMode, exchangeRate } = useAppData();
  const { route, navigateToPath } = useAppNavigation();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const activeStatusTab = route.orderSubTab || 'all';
  const setActiveStatusTab = (nextStatus: string) => {
    navigateToPath(nextStatus === 'all' ? '/orders' : `/orders/${nextStatus}`);
  };
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [availableCouriers, setAvailableCouriers] = useState<StaffCourier[]>([]);

  // Action Dropdown Menu state for table rows
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  // Payment / Settlement Modal state
  const [paymentModalOrder, setPaymentModalOrder] = useState<Order | null>(null);
  const [paymentMode, setPaymentMode] = useState<'full' | 'partial'>('full');
  const [paymentAmountInput, setPaymentAmountInput] = useState<number>(0);
  const [paymentMethodInput, setPaymentMethodInput] = useState<string>('Tunai');
  const [paymentNoteInput, setPaymentNoteInput] = useState<string>('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState<boolean>(false);

  // Close Action Dropdown when clicking outside
  useEffect(() => {
    const handleGlobalClick = () => setOpenActionMenuId(null);
    if (openActionMenuId) {
      window.addEventListener('click', handleGlobalClick);
    }
    return () => window.removeEventListener('click', handleGlobalClick);
  }, [openActionMenuId]);

  // Staff Assignment in Drawer
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [isAssigningStaff, setIsAssigningStaff] = useState<boolean>(false);
  const [assignSuccessMessage, setAssignSuccessMessage] = useState<string | null>(null);

  // Thermal Receipt Modal
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState<boolean>(false);

  // Create Manual Order Modal
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState<boolean>(route.orderAction === 'tambah');
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  // Sync URL direct navigation for /orders/tambah and /orders/:id
  useEffect(() => {
    setIsNewOrderModalOpen(route.orderAction === 'tambah');
    if (route.orderAction === 'detail' && route.orderId && orders.length > 0) {
      const target = route.orderId.toLowerCase();
      const matched = orders.find(
        (o) => o.id.toLowerCase() === target || o.orderNumber.toLowerCase() === target
      );
      if (matched) {
        setSelectedOrder(matched);
        setSelectedStaffId(matched.deliveryStaffId || '');
        setIsDrawerOpen(true);
      }
    } else if (route.orderAction !== 'detail') {
      setIsDrawerOpen(false);
    }
  }, [route.orderAction, route.orderId, orders]);
  const [newOrderForm, setNewOrderForm] = useState({
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    channel: 'visitor' as OrderChannel,
    paymentMethod: 'Cash (Tunai)',
    itemName: '',
    itemSku: '',
    packageType: 'carton' as 'carton' | 'unit',
    qty: 1,
    costPrice: 0,
    sellingPrice: 0,
    notes: '',
  });

  // Real-time Firestore synchronization for stores/store_001/orders, root orders, and POS transactions
  useEffect(() => {
    let unsubStoreOrders: () => void = () => {};
    let unsubRootOrders: () => void = () => {};
    let unsubPosTransactions: () => void = () => {};

    let storeOrdersMap = new Map<string, Order>();
    let rootOrdersMap = new Map<string, Order>();
    let posTxOrdersMap = new Map<string, Order>();

    const handleCleanSlate = () => {
      storeOrdersMap = new Map<string, Order>();
      rootOrdersMap = new Map<string, Order>();
      posTxOrdersMap = new Map<string, Order>();
      setOrders([]);
      setSelectedOrder(null);
      setLoading(false);
    };
    window.addEventListener('riskcart_clean_slate_wiped', handleCleanSlate);

    const normalizeIso = (val: any): string => {
      if (!val) return new Date().toISOString();
      if (typeof val === 'string') return val;
      if (typeof val?.toDate === 'function') {
        try {
          return val.toDate().toISOString();
        } catch {
          return new Date().toISOString();
        }
      }
      if (typeof val?.seconds === 'number') {
        return new Date(val.seconds * 1000).toISOString();
      }
      return String(val);
    };

    const publishMergedOrders = () => {
      const merged = new Map<string, Order>();
      const seenKeys = new Set<string>();

      const mergeTwoOrders = (existing: Order, incoming: Order): Order => {
        const tExist = new Date(existing.updatedAt || existing.createdAt || 0).getTime() || 0;
        const tInc = new Date(incoming.updatedAt || incoming.createdAt || 0).getTime() || 0;
        if (tInc >= tExist) {
          return { ...existing, ...incoming };
        }
        return { ...incoming, ...existing };
      };

      const upsertMerged = (k: string, v: Order) => {
        const anyV = v as any;
        const syncKey = String(anyV.canonicalSyncKey || '').trim();
        const linkedOrderId = String(anyV.orderId || '').trim();
        const linkedTxId = String(anyV.transactionId || '').trim();

        if (linkedOrderId && merged.has(linkedOrderId) && linkedOrderId !== k) {
          merged.set(linkedOrderId, {
            ...mergeTwoOrders(merged.get(linkedOrderId)!, v),
            id: linkedOrderId,
          });
          return;
        }
        if (linkedTxId && merged.has(linkedTxId) && linkedTxId !== k) {
          merged.set(linkedTxId, {
            ...mergeTwoOrders(merged.get(linkedTxId)!, v),
            id: linkedTxId,
          });
          return;
        }
        if (syncKey && seenKeys.has(syncKey) && !merged.has(k)) {
          return;
        }
        if (syncKey) seenKeys.add(syncKey);
        if (merged.has(k)) {
          merged.set(k, mergeTwoOrders(merged.get(k)!, v));
        } else {
          merged.set(k, v);
        }
      };

      // Authoritative store orders first, then root orders, then POS transactions
      storeOrdersMap.forEach((v, k) => upsertMerged(k, v));
      rootOrdersMap.forEach((v, k) => upsertMerged(k, v));
      posTxOrdersMap.forEach((v, k) => {
        if (!merged.has(k)) upsertMerged(k, v);
      });

      const list = Array.from(merged.values()).sort((a, b) => {
        const tA = new Date(a.createdAt || 0).getTime() || 0;
        const tB = new Date(b.createdAt || 0).getTime() || 0;
        return tB - tA;
      });

      setOrders(list);
      setLoading(false);

      if (selectedOrder) {
        const updatedActive = list.find((o) => o.id === selectedOrder.id);
        if (updatedActive) {
          setSelectedOrder(updatedActive);
        }
      }
    };

    try {
      const storeOrdersRef = collection(db, 'stores', STORE_ID, 'orders');
      unsubStoreOrders = onSnapshot(
        storeOrdersRef,
        (snapshot) => {
          if (isDatabaseWipeInProgress()) {
            snapshot.docs.forEach((d) => void deleteDoc(d.ref).catch(() => {}));
            storeOrdersMap = new Map<string, Order>();
            setOrders([]);
            setLoading(false);
            return;
          }
          const next = new Map<string, Order>();
          snapshot.docs.forEach((d) => {
            const raw = d.data() as any;
            if (isLegacyMockOrderOrTx(raw, d.id)) return;
            next.set(d.id, {
              ...raw,
              id: d.id,
              createdAt: normalizeIso(raw.createdAt),
              updatedAt: normalizeIso(raw.updatedAt || raw.createdAt),
            } as Order);
          });
          storeOrdersMap = next;
          publishMergedOrders();
        },
        (err) => {
          console.warn('Store orders onSnapshot error:', err);
          setLoading(false);
        }
      );

      const rootOrdersRef = collection(db, 'orders');
      unsubRootOrders = onSnapshot(
        rootOrdersRef,
        (snapshot) => {
          if (isDatabaseWipeInProgress()) {
            snapshot.docs.forEach((d) => void deleteDoc(d.ref).catch(() => {}));
            rootOrdersMap = new Map<string, Order>();
            setOrders([]);
            return;
          }
          const next = new Map<string, Order>();
          snapshot.docs.forEach((d) => {
            const raw = d.data() as any;
            if (isLegacyMockOrderOrTx(raw, d.id)) return;
            next.set(d.id, {
              ...raw,
              id: d.id,
              createdAt: normalizeIso(raw.createdAt),
              updatedAt: normalizeIso(raw.updatedAt || raw.createdAt),
            } as Order);
          });
          rootOrdersMap = next;
          publishMergedOrders();
        },
        (err) => {
          console.warn('Root orders onSnapshot error:', err);
        }
      );

      const posTxRef = collection(db, 'transactions');
      unsubPosTransactions = onSnapshot(
        posTxRef,
        (snapshot) => {
          if (isDatabaseWipeInProgress()) {
            snapshot.docs.forEach((d) => void deleteDoc(d.ref).catch(() => {}));
            posTxOrdersMap = new Map<string, Order>();
            setOrders([]);
            return;
          }
          const next = new Map<string, Order>();
          snapshot.docs.forEach((d) => {
            const tx = d.data() as any;
            if (isLegacyMockOrderOrTx(tx, d.id)) return;
            const createdIso = normalizeIso(tx.createdAt || tx.timestamp);
            const items: OrderItem[] = Array.isArray(tx.items)
              ? tx.items.map((item: any) => {
                  const qty = Number(item.quantity ?? item.qty ?? 1);
                  const sellingPrice = Number(item.unitPrice ?? item.sellingPrice ?? item.price ?? 0);
                  const costPrice = Number(item.costPerUnit ?? item.costPrice ?? 0);
                  const subtotal = Number(item.totalPrice ?? item.subtotal ?? sellingPrice * qty);
                  return {
                    productId: item.productId || 'PRD-POS',
                    name: item.productName || item.name || 'Item POS',
                    sku: item.sku || item.productId || 'POS-SKU',
                    packageType: item.unitType === 'carton' || item.packageType === 'carton' ? 'carton' : 'unit',
                    qty,
                    costPrice,
                    sellingPrice,
                    subtotal,
                    profit: subtotal - costPrice * qty,
                  };
                })
              : [];
            const totalAmount = Number(tx.totalAmount ?? tx.total ?? 0);
            const totalCost = Number(
              tx.totalCost ?? items.reduce((s, i) => s + i.costPrice * i.qty, 0)
            );
            const totalProfit = Number(tx.totalProfit ?? totalAmount - totalCost);
            const rawPm = String(tx.paymentMethod || '').toLowerCase();
            const isDebtOrCod =
              rawPm === 'hutang' ||
              rawPm === 'debt' ||
              rawPm.includes('kasbon') ||
              rawPm.includes('tempo') ||
              rawPm === 'cod';
            const rawPs = String(
              tx.paymentStatus || (isDebtOrCod ? 'unpaid' : 'paid')
            ).toLowerCase();
            const paidAmount =
              rawPs === 'paid' || rawPs === 'lunas' || rawPs === 'completed'
                ? totalAmount
                : Math.min(totalAmount, Math.max(0, Number(tx.paidAmount ?? 0)));
            const remainingDebt =
              rawPs === 'paid' || rawPs === 'lunas' || rawPs === 'completed'
                ? 0
                : Number(
                    tx.remainingDebt !== undefined
                      ? tx.remainingDebt
                      : Math.max(0, totalAmount - paidAmount)
                  );
            const normalizedPaymentStatus: Order['paymentStatus'] =
              remainingDebt <= 0 && totalAmount > 0 && (rawPs === 'paid' || rawPs === 'lunas' || rawPs === 'completed' || paidAmount >= totalAmount)
                ? 'paid'
                : paidAmount > 0 && remainingDebt > 0
                ? 'partial'
                : rawPs === 'partial' || rawPs === 'dp'
                ? 'partial'
                : rawPs === 'unpaid' || rawPs === 'hutang' || rawPs === 'cod_pending' || rawPs === 'pending' || isDebtOrCod
                ? 'unpaid'
                : 'paid';

            next.set(d.id, {
              id: d.id,
              storeId: tx.storeId || tx.outletId || STORE_ID,
              orderNumber: tx.orderNumber || tx.receiptNumber || `POS-${d.id.slice(-6).toUpperCase()}`,
              customerId: tx.customerId || null,
              customerName: tx.customerName || 'Walk-in Customer',
              customerPhone: tx.customerPhone || '-',
              customerAddress: tx.customerAddress || 'Pembelian Langsung di Kasir (POS)',
              channel: (tx.channel as OrderChannel) || 'pos',
              itemsCount: items.reduce((s, i) => s + i.qty, 0) || 1,
              items,
              totalCost,
              totalAmount,
              totalProfit,
              status: (() => {
                const stStage = getCanonicalOrderStage(tx.status, tx.fulfillmentStatus);
                if (stStage === 'cancelled') return 'cancelled';
                if (stStage === 'returned') return 'returned';
                if (stStage === 'new') return 'New';
                if (stStage === 'packing') return 'Sedang Mengemas';
                if (stStage === 'shipped') return 'Dikirim';
                if (rawPm === 'cod' && normalizedPaymentStatus !== 'paid' && !tx.fulfillmentStatus) {
                  return 'Dikirim';
                }
                return 'Terkirim';
              })(),
              paymentMethod:
                tx.paymentMethodLabel ||
                (rawPm === 'cash' || rawPm === 'tunai'
                  ? 'Tunai'
                  : rawPm === 'qris'
                  ? 'QRIS'
                  : rawPm === 'card' || rawPm === 'debit'
                  ? 'EDC / Card'
                  : rawPm === 'hutang' || rawPm === 'debt' || rawPm.includes('kasbon') || rawPm.includes('tempo')
                  ? 'Hutang'
                  : rawPm === 'cod'
                  ? 'COD'
                  : tx.paymentMethod || 'Tunai'),
              paymentStatus: normalizedPaymentStatus,
              paidAmount,
              remainingDebt,
              dueDate: tx.dueDate || null,
              paidAt: tx.paidAt || null,
              paymentHistory: Array.isArray(tx.paymentHistory) ? tx.paymentHistory : [],
              deliveryStaffId: tx.deliveryStaffId || null,
              deliveryStaffName: tx.deliveryStaffName || null,
              deliveryStaffRole: tx.deliveryStaffRole || null,
              deliveryStaffPhone: tx.deliveryStaffPhone || null,
              deliveryCommission: Number(tx.deliveryCommission ?? 0),
              assignedAt: tx.assignedAt || null,
              notes: tx.notes || `Transaksi Kasir POS (${tx.cashierName || 'Kasir'})`,
              createdAt: createdIso,
              updatedAt: normalizeIso(tx.updatedAt || createdIso),
            });
          });
          posTxOrdersMap = next;
          publishMergedOrders();
        },
        (err) => {
          console.warn('POS transactions fallback listener error in OrdersModule:', err);
        }
      );
    } catch (e) {
      console.warn('Orders setup exception:', e);
      setOrders([]);
      setLoading(false);
    }

    const unsubRealtimeOrders = subscribeRealtimeEvent('orders_updated', (payload: any) => {
      if (!payload) return;
      if (payload.newOrder && payload.newOrder.id) {
        storeOrdersMap.set(payload.newOrder.id, payload.newOrder as Order);
        publishMergedOrders();
      } else if (payload.orderId) {
        const existing =
          storeOrdersMap.get(payload.orderId) ||
          rootOrdersMap.get(payload.orderId) ||
          posTxOrdersMap.get(payload.orderId);
        if (existing) {
          storeOrdersMap.set(payload.orderId, { ...existing, ...payload } as Order);
          publishMergedOrders();
        }
      }
    });

    return () => {
      window.removeEventListener('riskcart_clean_slate_wiped', handleCleanSlate);
      unsubStoreOrders();
      unsubRootOrders();
      unsubPosTransactions();
      unsubRealtimeOrders();
    };
  }, [selectedOrder?.id]);

  // Query Delivery Staff from both root `staff` and `stores/{STORE_ID}/staff` collections in real-time
  useEffect(() => {
    let unsubStoreStaff: () => void = () => {};
    let unsubRootStaff: () => void = () => {};
    let storeMap = new Map<string, StaffCourier>();
    let rootMap = new Map<string, StaffCourier>();

    const publishCouriers = () => {
      const merged = new Map<string, StaffCourier>();
      rootMap.forEach((v, k) => merged.set(k, v));
      storeMap.forEach((v, k) => merged.set(k, { ...(merged.get(k) || {}), ...v }));
      const list = Array.from(merged.values())
        .filter((s) => (s.status || 'active') !== 'inactive')
        .sort((a, b) => {
          const isAShipper = /shipper|kurir|pengirim|delivery|driver/i.test(a.role || '');
          const isBShipper = /shipper|kurir|pengirim|delivery|driver/i.test(b.role || '');
          if (isAShipper && !isBShipper) return -1;
          if (!isAShipper && isBShipper) return 1;
          return (a.name || '').localeCompare(b.name || '');
        });
      setAvailableCouriers(list);
    };

    try {
      unsubRootStaff = onSnapshot(
        collection(db, 'staff'),
        (snap) => {
          const next = new Map<string, StaffCourier>();
          snap.docs.forEach((d) => {
            const raw = d.data();
            next.set(d.id, {
              id: d.id,
              name: raw.name || 'Staff',
              role: raw.role || raw.position || 'Shipper',
              phone: raw.phone || '-',
              outlet: raw.outlet || '',
              shift: raw.shift || '',
              status: raw.status || 'active',
            });
          });
          rootMap = next;
          publishCouriers();
        },
        () => {}
      );

      unsubStoreStaff = onSnapshot(
        collection(db, 'stores', STORE_ID, 'staff'),
        (snap) => {
          const next = new Map<string, StaffCourier>();
          snap.docs.forEach((d) => {
            const raw = d.data();
            next.set(d.id, {
              id: d.id,
              name: raw.name || 'Staff',
              role: raw.role || raw.position || 'Shipper',
              phone: raw.phone || '-',
              outlet: raw.outlet || '',
              shift: raw.shift || '',
              status: raw.status || 'active',
            });
          });
          storeMap = next;
          publishCouriers();
        },
        () => {}
      );
    } catch {
      setAvailableCouriers([]);
    }

    return () => {
      unsubStoreStaff();
      unsubRootStaff();
    };
  }, []);

  // Sync selectedStaffId when selectedOrder changes
  useEffect(() => {
    if (selectedOrder) {
      setSelectedStaffId(selectedOrder.deliveryStaffId || '');
      setAssignSuccessMessage(null);
    }
  }, [selectedOrder?.id]);

  // Currency Formatter (reactive to global IDR <-> USD switcher & live exchange rate)
  const formatMoney = (val: number) => {
    return formatCurrency(val);
  };

  // Relative Time Formatter (Wharf style: 18 min ago, 2 h ago, 1 d ago)
  const formatRelativeTime = (isoString?: string) => {
    if (!isoString) return 'Just now';
    const diffMs = Date.now() - new Date(isoString).getTime();
    if (diffMs < 0) return 'Just now';
    const minutes = Math.floor(diffMs / (1000 * 60));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} d ago`;
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  // Full date formatter for drawer header
  const formatFullDateTime = (isoString?: string) => {
    if (!isoString) return '-';
    const d = new Date(isoString);
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Status Tab Counts (compatible with both canonical keys and 4-stage Indonesian labels)
  const counts = useMemo(() => {
    let newCount = 0;
    let packingCount = 0;
    let shippedCount = 0;
    let deliveredCount = 0;
    let returnedCount = 0;
    orders.forEach((o) => {
      const st = getCanonicalOrderStage(o.status, (o as any).fulfillmentStatus);
      if (st === 'new') newCount++;
      else if (st === 'packing') packingCount++;
      else if (st === 'shipped') shippedCount++;
      else if (st === 'delivered') deliveredCount++;
      else if (st === 'returned') returnedCount++;
    });
    return {
      all: orders.length,
      new: newCount,
      packing: packingCount,
      shipped: shippedCount,
      delivered: deliveredCount,
      returned: returnedCount,
    };
  }, [orders]);

  // Deterministic Payment Info helper (supports Lunas, Hutang Belum Lunas, and Hutang Bayar Sebagian/DP)
  const getOrderPaymentDetails = (order: Order) => {
    const totalAmount = Number(order.totalAmount || 0);
    const rawStatus = String(order.paymentStatus || '').toLowerCase();
    const rawMethod = String(order.paymentMethod || '').toLowerCase();
    const isInherentlyUnpaidMethod =
      rawMethod.includes('hutang') ||
      rawMethod.includes('debt') ||
      rawMethod.includes('kasbon') ||
      rawMethod.includes('tempo') ||
      rawMethod === 'cod';

    const rawPaid = Number(order.paidAmount ?? 0);
    const hasExplicitRemaining = order.remainingDebt !== undefined && order.remainingDebt !== null;
    const rawRemaining = hasExplicitRemaining
      ? Number(order.remainingDebt)
      : Math.max(0, totalAmount - rawPaid);

    let normalizedStatus: 'paid' | 'partial' | 'unpaid' = 'paid';
    if (
      rawStatus === 'paid' ||
      rawStatus === 'lunas' ||
      rawStatus === 'completed' ||
      (totalAmount > 0 && rawPaid >= totalAmount && rawRemaining <= 0)
    ) {
      normalizedStatus = 'paid';
    } else if (
      rawStatus === 'partial' ||
      rawStatus === 'dp' ||
      (rawPaid > 0 && rawPaid < totalAmount)
    ) {
      normalizedStatus = 'partial';
    } else if (
      rawStatus === 'unpaid' ||
      rawStatus === 'hutang' ||
      rawStatus === 'cod_pending' ||
      rawStatus === 'pending' ||
      isInherentlyUnpaidMethod
    ) {
      normalizedStatus = 'unpaid';
    }

    const paidAmount =
      normalizedStatus === 'paid'
        ? totalAmount
        : Math.min(totalAmount, Math.max(0, rawPaid));
    const remainingDebt =
      normalizedStatus === 'paid'
        ? 0
        : Math.max(0, hasExplicitRemaining ? rawRemaining : totalAmount - paidAmount);

    if (normalizedStatus !== 'paid' && remainingDebt <= 0 && totalAmount > 0) {
      normalizedStatus = 'paid';
    } else if (normalizedStatus === 'unpaid' && paidAmount > 0 && remainingDebt > 0) {
      normalizedStatus = 'partial';
    }

    return {
      status: normalizedStatus,
      isPaid: normalizedStatus === 'paid',
      isPartial: normalizedStatus === 'partial',
      isUnpaid: normalizedStatus === 'unpaid',
      label: normalizedStatus === 'paid' ? 'Lunas' : 'Hutang',
      subLabel:
        normalizedStatus === 'paid'
          ? 'Lunas'
          : normalizedStatus === 'partial'
          ? 'Bayar Sebagian'
          : 'Belum Lunas',
      paidAmount,
      remainingDebt,
      totalAmount,
    };
  };

  // Filtered orders list
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // 1. Status Filter (compatible with 'new'/'New', 'packing'/'Sedang Mengemas', 'shipped'/'Dikirim', 'delivered'/'Terkirim')
      if (
        activeStatusTab !== 'all' &&
        getCanonicalOrderStage(order.status, (order as any).fulfillmentStatus) !== activeStatusTab
      ) {
        return false;
      }

      // 2. Channel Filter
      if (channelFilter !== 'all' && order.channel !== channelFilter) {
        return false;
      }

      // 3. Payment Filter
      if (paymentFilter !== 'all') {
        const payInfo = getOrderPaymentDetails(order);
        if (paymentFilter === 'paid' && !payInfo.isPaid) return false;
        if (paymentFilter === 'hutang_all' && payInfo.isPaid) return false;
        if (paymentFilter === 'unpaid' && !payInfo.isUnpaid) return false;
        if (paymentFilter === 'partial' && !payInfo.isPartial) return false;
      }

      // 4. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const payInfo = getOrderPaymentDetails(order);
        const matchId = (order.orderNumber || order.id).toLowerCase().includes(q);
        const matchCust = (order.customerName || '').toLowerCase().includes(q);
        const matchPhone = (order.customerPhone || '').toLowerCase().includes(q);
        const matchAddress = (order.customerAddress || '').toLowerCase().includes(q);
        const matchStaff = (order.deliveryStaffName || '').toLowerCase().includes(q);
        const matchPayment =
          payInfo.label.toLowerCase().includes(q) ||
          payInfo.subLabel.toLowerCase().includes(q) ||
          (order.paymentMethod || '').toLowerCase().includes(q);
        const matchItem = order.items?.some(
          (i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
        );
        return (
          matchId ||
          matchCust ||
          matchPhone ||
          matchAddress ||
          matchStaff ||
          matchPayment ||
          matchItem
        );
      }

      return true;
    });
  }, [orders, activeStatusTab, channelFilter, paymentFilter, searchQuery]);

  // Status Badge Pill Renderer
  const renderStatusBadge = (status: OrderStatus, fulfillmentRaw?: string) => {
    const canonical = getCanonicalOrderStage(status, fulfillmentRaw);
    switch (canonical) {
      case 'new':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            1. New
          </span>
        );
      case 'packing':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-orange-500/15 text-orange-400 border border-orange-500/30">
            <Package className="w-3 h-3" />
            2. Sedang Mengemas
          </span>
        );
      case 'shipped':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
            <Truck className="w-3 h-3" />
            3. Dikirim
          </span>
        );
      case 'delivered':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" />
            4. Terkirim
          </span>
        );
      case 'returned':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <RotateCcw className="w-3 h-3" />
            Returned
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-500/15 text-slate-400 border border-slate-500/30">
            <XCircle className="w-3 h-3" />
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-400">
            {status}
          </span>
        );
    }
  };

  // Channel Badge Renderer
  const renderChannelBadge = (channel: OrderChannel) => {
    switch (channel) {
      case 'pos':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30">
            POS Kasir
          </span>
        );
      case 'visitor':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30">
            Visitor
          </span>
        );
      case 'pwa':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            PWA
          </span>
        );
      case 'website':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-sky-500/15 text-sky-300 border border-sky-500/30">
            Website
          </span>
        );
      default:
        return <span className="text-xs text-slate-400">{channel}</span>;
    }
  };

  // Open Drawer Handler
  const handleOpenOrder = (order: Order) => {
    setSelectedOrder(order);
    setSelectedStaffId(order.deliveryStaffId || '');
    openTransactionDetailModal(order, 'SALE');
  };

  // Update Status in Firestore (with automatic COD Cash Inflow settlement when marked 'Terkirim' / 'delivered')
  const handleUpdateOrderStatus = async (
    newStatus: OrderStatus,
    forceMarkPaid: boolean = false,
    explicitTargetOrder?: Order
  ) => {
    const targetOrder = explicitTargetOrder || selectedOrder;
    if (!targetOrder) return;
    try {
      const nowIso = new Date().toISOString();
      const targetStage = getCanonicalOrderStage(newStatus, newStatus);
      const isDeliveredStage = targetStage === 'delivered';
      const isCodOrder = String(targetOrder.paymentMethod || '').toUpperCase().includes('COD');
      const wasUnpaid = targetOrder.paymentStatus !== 'paid';
      const shouldSettlePaymentNow =
        forceMarkPaid || (isDeliveredStage && isCodOrder && wasUnpaid);

      const nextPaymentStatus = shouldSettlePaymentNow
        ? 'paid'
        : targetOrder.paymentStatus;

      const orderDocRef = doc(db, 'stores', STORE_ID, 'orders', targetOrder.id);
      const rootOrderRef = doc(db, 'orders', targetOrder.id);
      const updates: Partial<Order> & Record<string, any> = {
        status: newStatus,
        fulfillmentStatus: newStatus,
        paymentStatus: nextPaymentStatus,
        ...(shouldSettlePaymentNow
          ? {
              paidAmount: targetOrder.totalAmount || 0,
              remainingDebt: 0,
              paidAt: nowIso,
            }
          : {}),
        updatedAt: nowIso,
      };

      // Optimistic local state update for 0ms UI response in table, tab counters, and drawer
      setOrders((prev) =>
        prev.map((o) => (o.id === targetOrder.id ? ({ ...o, ...updates } as Order) : o))
      );
      if (selectedOrder?.id === targetOrder.id) {
        setSelectedOrder((prev) => (prev ? ({ ...prev, ...updates } as Order) : null));
      }

      const txUpdates = {
        status: newStatus,
        fulfillmentStatus: newStatus,
        paymentStatus: nextPaymentStatus,
        ...(shouldSettlePaymentNow
          ? {
              paidAmount: targetOrder.totalAmount || 0,
              remainingDebt: 0,
              paidAt: nowIso,
            }
          : {}),
        updatedAt: nowIso,
      };

      const writes: Promise<any>[] = [
        updateDoc(rootOrderRef, {
          status: newStatus,
          fulfillmentStatus: newStatus,
          paymentStatus: nextPaymentStatus,
          ...(shouldSettlePaymentNow
            ? {
                paidAmount: targetOrder.totalAmount || 0,
                remainingDebt: 0,
                paidAt: nowIso,
              }
            : {}),
          updatedAt: nowIso,
        }).catch(() =>
          setDoc(rootOrderRef, { ...targetOrder, ...updates }, { merge: true }).catch(() => {})
        ),
        setDoc(orderDocRef, { ...targetOrder, ...updates }, { merge: true }).catch(() => {}),
        updateDoc(doc(db, 'transactions', targetOrder.id), txUpdates).catch(() =>
          setDoc(doc(db, 'transactions', targetOrder.id), txUpdates, { merge: true }).catch(
            () => {}
          )
        ),
        setDoc(doc(db, 'stores', STORE_ID, 'transactions', targetOrder.id), txUpdates, {
          merge: true,
        }).catch(() => {}),
      ];

      // If COD or unpaid order is now settled as PAID, record cash inflow into Shift Kasir, LaporanKas, and Finance
      if (shouldSettlePaymentNow && (targetOrder.totalAmount || 0) > 0) {
        const settleAmt = Number(targetOrder.totalAmount || 0);
        const courierLabel = targetOrder.deliveryStaffName
          ? ` (Kurir: ${targetOrder.deliveryStaffName})`
          : '';
        const noteStr = `Setoran Pelunasan Order ${targetOrder.paymentMethod || 'COD'} #${
          targetOrder.orderNumber || targetOrder.id
        } - ${targetOrder.customerName}${courierLabel}`;
        const formattedDate = new Date(nowIso).toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });

        writes.push(
          setDoc(
            doc(db, 'cash_flows', `CF-COD-${targetOrder.id}`),
            {
              id: `CF-COD-${targetOrder.id}`,
              storeId: STORE_ID,
              transactionId: targetOrder.id,
              type: 'in',
              category: `Pelunasan ${targetOrder.paymentMethod || 'COD'}`,
              paymentMethod: 'cash',
              amount: settleAmt,
              totalCost: Number(targetOrder.totalCost || 0),
              totalProfit: Number(targetOrder.totalProfit || 0),
              customerName: targetOrder.customerName,
              cashierName: targetOrder.deliveryStaffName || 'Kasir POS',
              note: noteStr,
              date: nowIso,
              createdAt: nowIso,
            },
            { merge: true }
          ),
          setDoc(
            doc(db, 'cash_logs', `CF-COD-${targetOrder.id}`),
            {
              id: `CF-COD-${targetOrder.id}`,
              type: 'in',
              category: `Setoran ${targetOrder.paymentMethod || 'COD'}`,
              amount: settleAmt,
              source: targetOrder.customerName,
              cashierName: targetOrder.deliveryStaffName || 'Kasir POS',
              note: noteStr,
              date: formattedDate,
              createdAt: nowIso,
            },
            { merge: true }
          ),
          setDoc(
            doc(db, 'incomes', `INC-COD-${targetOrder.id}`),
            {
              id: `INC-COD-${targetOrder.id}`,
              date: formattedDate,
              createdAt: nowIso,
              category: `Setoran Pesanan ${targetOrder.paymentMethod || 'COD'}`,
              source: targetOrder.customerName,
              method: `Tunai / ${targetOrder.paymentMethod || 'COD'}`,
              amount: settleAmt,
              isReceivableSettlement: !isCodOrder,
              note: noteStr,
            },
            { merge: true }
          ),
          setDoc(
            doc(db, 'pos_incomes', `INC-COD-${targetOrder.id}`),
            {
              id: `INC-COD-${targetOrder.id}`,
              date: formattedDate,
              createdAt: nowIso,
              category: `Setoran Pesanan ${targetOrder.paymentMethod || 'COD'}`,
              source: targetOrder.customerName,
              method: `Tunai / ${targetOrder.paymentMethod || 'COD'}`,
              amount: settleAmt,
              isReceivableSettlement: !isCodOrder,
              note: noteStr,
            },
            { merge: true }
          )
        );
      }

      await Promise.all(writes);

      publishRealtimeEvent('orders_updated', {
        orderId: targetOrder.id,
        ...updates,
      });

      if (isDeliveredStage) {
        const anyTarget = targetOrder as any;
        if (
          anyTarget.tableId ||
          anyTarget.tableNumber ||
          String(targetOrder.id || '').startsWith('ORD-WTR-')
        ) {
          void completeTableAndKitchenOrderOnPayment({
            orderId: targetOrder.id,
            tableId: anyTarget.tableId,
            tableNumber: anyTarget.tableNumber,
            customerName: targetOrder.customerName,
            totalAmount: targetOrder.totalAmount,
            paymentMethod: targetOrder.paymentMethod,
          });
        }
        await reconcileCompletedTransaction(
          targetOrder.id,
          { ...targetOrder, ...updates },
          'stores/store_001/orders'
        );
      }
    } catch (err) {
      console.error('Error updating order status in Firestore:', err);
    }
  };

  // Advance order to the next pipeline stage (1. New -> 2. Sedang Mengemas -> 3. Dikirim -> 4. Terkirim)
  const handleAdvanceOrderProcess = async (targetOrder?: Order) => {
    const ord = targetOrder || selectedOrder;
    if (!ord) return;
    const currentStage = getCanonicalOrderStage(ord.status, (ord as any).fulfillmentStatus);
    const nextStageObj = getNextPipelineStage(currentStage);
    if (!nextStageObj) return;
    await handleUpdateOrderStatus(nextStageObj.firestoreStatus, false, ord);
  };

  // Assign Delivery Staff in Firestore (synced across orders & transactions)
  const handleAssignDeliveryStaff = async () => {
    if (!selectedOrder || !selectedStaffId) return;

    const courier = availableCouriers.find((c) => c.id === selectedStaffId);
    if (!courier) return;

    setIsAssigningStaff(true);
    try {
      const nowIso = new Date().toISOString();
      const updates = {
        deliveryStaffId: courier.id,
        deliveryStaffName: courier.name,
        deliveryStaffRole: courier.role,
        deliveryStaffPhone: courier.phone,
        assignedAt: nowIso,
        updatedAt: nowIso,
      };

      await Promise.all([
        setDoc(doc(db, 'stores', STORE_ID, 'orders', selectedOrder.id), updates, { merge: true }),
        setDoc(doc(db, 'orders', selectedOrder.id), updates, { merge: true }),
        setDoc(doc(db, 'transactions', selectedOrder.id), updates, { merge: true }).catch(() => {}),
        setDoc(doc(db, 'stores', STORE_ID, 'transactions', selectedOrder.id), updates, { merge: true }).catch(() => {}),
      ]);

      setSelectedOrder((prev) => (prev ? { ...prev, ...updates } : null));
      setAssignSuccessMessage(`Pengirim ${courier.name} (${courier.role}) berhasil ditugaskan!`);
      setTimeout(() => setAssignSuccessMessage(null), 3500);
    } catch (err) {
      console.error('Error assigning staff in Firestore:', err);
    } finally {
      setIsAssigningStaff(false);
    }
  };

  // Create Manual Order
  const handleCreateNewOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrderForm.customerName.trim()) return;

    const autoId = `ORD-NL-${Math.floor(1000 + Math.random() * 9000)}`;
    const cost = Number(newOrderForm.costPrice) * Number(newOrderForm.qty);
    const amount = Number(newOrderForm.sellingPrice) * Number(newOrderForm.qty);
    const profit = amount - cost;
    const isUnpaidMethod = /hutang|debt|kasbon|tempo|cod/i.test(newOrderForm.paymentMethod);
    const initialPaymentStatus: Order['paymentStatus'] = isUnpaidMethod ? 'unpaid' : 'paid';
    const initialPaidAmount = isUnpaidMethod ? 0 : amount;
    const initialRemainingDebt = isUnpaidMethod ? amount : 0;
    const nowIso = new Date().toISOString();

    const newOrder: Order = {
      id: autoId,
      storeId: STORE_ID,
      orderNumber: autoId.replace('ORD-', ''),
      customerName: newOrderForm.customerName.trim(),
      customerPhone: newOrderForm.customerPhone.trim() || '-',
      customerAddress: newOrderForm.customerAddress.trim() || '-',
      channel: newOrderForm.channel,
      itemsCount: Number(newOrderForm.qty),
      items: [
        {
          productId: 'PRD-CUSTOM',
          name: newOrderForm.itemName,
          sku: newOrderForm.itemSku || 'SKU-CUST',
          packageType: newOrderForm.packageType,
          qty: Number(newOrderForm.qty),
          costPrice: Number(newOrderForm.costPrice),
          sellingPrice: Number(newOrderForm.sellingPrice),
          subtotal: amount,
          profit: profit,
        },
      ],
      totalCost: cost,
      totalAmount: amount,
      totalProfit: profit,
      status: 'new',
      paymentMethod: newOrderForm.paymentMethod,
      paymentStatus: initialPaymentStatus,
      paidAmount: initialPaidAmount,
      remainingDebt: initialRemainingDebt,
      paymentHistory: !isUnpaidMethod
        ? [
            {
              id: `PAY-INIT-${autoId}`,
              date: nowIso,
              amount,
              method: newOrderForm.paymentMethod,
              note: 'Pembayaran awal pembuatan pesanan',
              recordedBy: 'Admin / Kasir POS',
            },
          ]
        : [],
      deliveryStaffId: null,
      deliveryStaffName: null,
      deliveryStaffPhone: null,
      assignedAt: null,
      notes: newOrderForm.notes.trim() || 'Direct manual order entry',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    try {
      const ordersColRef = collection(db, 'stores', STORE_ID, 'orders');
      await Promise.all([
        setDoc(doc(ordersColRef, newOrder.id), newOrder),
        setDoc(doc(db, 'orders', newOrder.id), newOrder),
      ]);
      setIsNewOrderModalOpen(false);
      handleOpenOrder(newOrder);
    } catch (err) {
      console.error('Error creating new order:', err);
    }
  };

  // Open Payment / Settlement Modal for any order
  const handleOpenPaymentModal = (order: Order, defaultMode?: 'full' | 'partial') => {
    const payInfo = getOrderPaymentDetails(order);
    setPaymentModalOrder(order);
    const mode = defaultMode || (payInfo.remainingDebt > 0 ? 'full' : 'full');
    setPaymentMode(mode);
    setPaymentAmountInput(payInfo.remainingDebt > 0 ? payInfo.remainingDebt : payInfo.totalAmount);
    setPaymentMethodInput(
      order.paymentMethod && !/hutang|debt|kasbon/i.test(order.paymentMethod)
        ? order.paymentMethod
        : 'Tunai'
    );
    setPaymentNoteInput('');
  };

  // Submit Full or Partial Payment Settlement & Sync Across Entire Firestore Ecosystem
  const handleSubmitOrderPayment = async (
    targetOrder: Order,
    payNowAmount: number,
    methodUsed: string,
    noteText?: string
  ) => {
    const payInfo = getOrderPaymentDetails(targetOrder);
    const cleanPayAmount = Math.max(0, Math.min(payInfo.remainingDebt, Number(payNowAmount || 0)));
    if (cleanPayAmount <= 0 && payInfo.remainingDebt > 0) return;

    setIsSubmittingPayment(true);
    try {
      const nowIso = new Date().toISOString();
      const formattedDate = new Date(nowIso).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

      const nextPaidAmount = Math.min(payInfo.totalAmount, payInfo.paidAmount + cleanPayAmount);
      const nextRemainingDebt = Math.max(0, payInfo.totalAmount - nextPaidAmount);
      const nextPaymentStatus: 'paid' | 'partial' | 'unpaid' =
        nextRemainingDebt <= 0 ? 'paid' : nextPaidAmount > 0 ? 'partial' : 'unpaid';

      const paymentRecordId = `PAY-${targetOrder.id}-${Date.now().toString().slice(-5)}`;
      const newRecord: OrderPaymentRecord = {
        id: paymentRecordId,
        date: nowIso,
        amount: cleanPayAmount,
        method: methodUsed || 'Tunai',
        note:
          noteText?.trim() ||
          (nextPaymentStatus === 'paid'
            ? `Pelunasan Penuh Order #${targetOrder.orderNumber}`
            : `Cicilan / Bayar Sebagian Order #${targetOrder.orderNumber}`),
        recordedBy: targetOrder.deliveryStaffName || 'Admin / Kasir POS',
      };

      const updatedHistory: OrderPaymentRecord[] = [
        ...(Array.isArray(targetOrder.paymentHistory) ? targetOrder.paymentHistory : []),
        ...(cleanPayAmount > 0 ? [newRecord] : []),
      ];

      const isCodOrder = String(targetOrder.paymentMethod || '').toUpperCase().includes('COD');
      const nextOrderStatus: OrderStatus =
        nextPaymentStatus === 'paid' && isCodOrder && targetOrder.status === 'shipped'
          ? 'delivered'
          : targetOrder.status;

      const orderUpdates: Partial<Order> & Record<string, any> = {
        paymentStatus: nextPaymentStatus,
        paidAmount: nextPaidAmount,
        remainingDebt: nextRemainingDebt,
        paymentHistory: updatedHistory,
        ...(nextPaymentStatus === 'paid' ? { paidAt: nowIso } : {}),
        status: nextOrderStatus,
        fulfillmentStatus: nextOrderStatus === 'delivered' ? 'completed' : nextOrderStatus,
        updatedAt: nowIso,
      };

      const writes: Promise<any>[] = [
        setDoc(
          doc(db, 'stores', STORE_ID, 'orders', targetOrder.id),
          { ...targetOrder, ...orderUpdates },
          { merge: true }
        ),
        setDoc(
          doc(db, 'orders', targetOrder.id),
          { ...targetOrder, ...orderUpdates },
          { merge: true }
        ),
        setDoc(
          doc(db, 'transactions', targetOrder.id),
          {
            paymentStatus: nextPaymentStatus,
            paidAmount: nextPaidAmount,
            remainingDebt: nextRemainingDebt,
            paymentHistory: updatedHistory,
            ...(nextPaymentStatus === 'paid' ? { paidAt: nowIso } : {}),
            fulfillmentStatus: nextOrderStatus === 'delivered' ? 'completed' : nextOrderStatus,
            updatedAt: nowIso,
          },
          { merge: true }
        ).catch(() => {}),
        setDoc(
          doc(db, 'stores', STORE_ID, 'transactions', targetOrder.id),
          {
            paymentStatus: nextPaymentStatus,
            paidAmount: nextPaidAmount,
            remainingDebt: nextRemainingDebt,
            paymentHistory: updatedHistory,
            ...(nextPaymentStatus === 'paid' ? { paidAt: nowIso } : {}),
            fulfillmentStatus: nextOrderStatus === 'delivered' ? 'completed' : nextOrderStatus,
            updatedAt: nowIso,
          },
          { merge: true }
        ).catch(() => {}),
      ];

      // Sync customer debt reduction in `customers` collection if customer matches
      if (cleanPayAmount > 0) {
        const matchedCustomer = customers.find(
          (c: any) =>
            (targetOrder.customerId && c.id === targetOrder.customerId) ||
            (c.name || '').toLowerCase() === (targetOrder.customerName || '').toLowerCase() ||
            (targetOrder.customerPhone &&
              targetOrder.customerPhone !== '-' &&
              c.phone === targetOrder.customerPhone)
        );
        if (matchedCustomer && matchedCustomer.id) {
          const prevCustDebt = Number(matchedCustomer.debtAmount || 0);
          const nextCustDebt = Math.max(0, prevCustDebt - cleanPayAmount);
          writes.push(
            setDoc(
              doc(db, 'customers', matchedCustomer.id),
              {
                debtAmount: nextCustDebt,
                updatedAt: nowIso,
              },
              { merge: true }
            ).catch(() => {})
          );
        }

        // Write Cash Inflow to ShiftModule (`cash_flows`), LaporanKas (`cash_logs`), and POSTransactions (`incomes` & `pos_incomes`)
        const isCashMethod = /tunai|cash|cod/i.test(methodUsed);
        const categoryLabel =
          nextPaymentStatus === 'paid'
            ? `Pelunasan Order #${targetOrder.orderNumber}`
            : `Cicilan / DP Order #${targetOrder.orderNumber}`;
        const fullNote =
          newRecord.note +
          (nextRemainingDebt > 0
            ? ` (Sisa Hutang: Rp ${nextRemainingDebt.toLocaleString('id-ID')})`
            : ' (LUNAS)');

        writes.push(
          setDoc(
            doc(db, 'cash_flows', `CF-${paymentRecordId}`),
            {
              id: `CF-${paymentRecordId}`,
              storeId: STORE_ID,
              transactionId: targetOrder.id,
              type: 'in',
              category: categoryLabel,
              paymentMethod: isCashMethod ? 'cash' : methodUsed.toLowerCase(),
              amount: cleanPayAmount,
              totalCost: Number(targetOrder.totalCost || 0),
              totalProfit: Number(targetOrder.totalProfit || 0),
              customerName: targetOrder.customerName,
              cashierName: targetOrder.deliveryStaffName || 'Kasir POS',
              note: fullNote,
              date: nowIso,
              createdAt: nowIso,
            },
            { merge: true }
          ),
          setDoc(
            doc(db, 'cash_logs', `CF-${paymentRecordId}`),
            {
              id: `CF-${paymentRecordId}`,
              type: 'in',
              category: categoryLabel,
              amount: cleanPayAmount,
              source: targetOrder.customerName,
              cashierName: targetOrder.deliveryStaffName || 'Kasir POS',
              note: fullNote,
              date: formattedDate,
              createdAt: nowIso,
            },
            { merge: true }
          ),
          setDoc(
            doc(db, 'incomes', `INC-${paymentRecordId}`),
            {
              id: `INC-${paymentRecordId}`,
              date: formattedDate,
              createdAt: nowIso,
              category: categoryLabel,
              source: targetOrder.customerName,
              method: methodUsed || 'Tunai',
              amount: cleanPayAmount,
              isReceivableSettlement: true,
              note: fullNote,
            },
            { merge: true }
          ),
          setDoc(
            doc(db, 'pos_incomes', `INC-${paymentRecordId}`),
            {
              id: `INC-${paymentRecordId}`,
              date: formattedDate,
              createdAt: nowIso,
              category: categoryLabel,
              source: targetOrder.customerName,
              method: methodUsed || 'Tunai',
              amount: cleanPayAmount,
              isReceivableSettlement: true,
              note: fullNote,
            },
            { merge: true }
          )
        );
      }

      await Promise.all(writes);

      publishRealtimeEvent('orders_updated', {
        orderId: targetOrder.id,
        ...orderUpdates,
      });

      if (nextPaymentStatus === 'paid') {
        const anyTarget = targetOrder as any;
        if (
          anyTarget.tableId ||
          anyTarget.tableNumber ||
          String(targetOrder.id || '').startsWith('ORD-WTR-')
        ) {
          void completeTableAndKitchenOrderOnPayment({
            orderId: targetOrder.id,
            tableId: anyTarget.tableId,
            tableNumber: anyTarget.tableNumber,
            customerName: targetOrder.customerName,
            totalAmount: targetOrder.totalAmount,
            paymentMethod: methodUsed || targetOrder.paymentMethod,
          });
        }
      }

      if (selectedOrder?.id === targetOrder.id) {
        setSelectedOrder((prev) => (prev ? { ...prev, ...orderUpdates } : null));
      }
      setPaymentModalOrder(null);
    } catch (err) {
      console.error('Error recording order payment in Firestore:', err);
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  // Delete Order across all synchronized Firestore collections
  const handleDeleteOrder = async (order: Order) => {
    try {
      await Promise.all([
        deleteDoc(doc(db, 'stores', STORE_ID, 'orders', order.id)).catch(() => {}),
        deleteDoc(doc(db, 'orders', order.id)).catch(() => {}),
        deleteDoc(doc(db, 'transactions', order.id)).catch(() => {}),
        deleteDoc(doc(db, 'stores', STORE_ID, 'transactions', order.id)).catch(() => {}),
      ]);
      if (selectedOrder?.id === order.id) {
        setIsDrawerOpen(false);
        setSelectedOrder(null);
      }
      if (paymentModalOrder?.id === order.id) {
        setPaymentModalOrder(null);
      }
    } catch (err) {
      console.warn('Delete order error:', err);
    }
  };

  const handleSaveEditOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;
    try {
      const nowIso = new Date().toISOString();
      const totalAmount = Number(editingOrder.totalAmount || 0);
      const totalCost = Number(editingOrder.totalCost || 0);
      const totalProfit = totalAmount - totalCost;

      const rawStatus = String(editingOrder.paymentStatus || 'paid').toLowerCase();
      let nextPaidAmount = Number(editingOrder.paidAmount ?? (rawStatus === 'paid' ? totalAmount : 0));
      if (rawStatus === 'paid') {
        nextPaidAmount = totalAmount;
      } else if (rawStatus === 'unpaid') {
        nextPaidAmount = 0;
      } else if (rawStatus === 'partial') {
        if (nextPaidAmount <= 0 || nextPaidAmount >= totalAmount) {
          nextPaidAmount = Math.round(totalAmount * 0.5);
        }
      }
      const nextRemainingDebt = Math.max(0, totalAmount - nextPaidAmount);
      const normalizedPaymentStatus: Order['paymentStatus'] =
        nextRemainingDebt <= 0 ? 'paid' : nextPaidAmount > 0 ? 'partial' : 'unpaid';

      const updates: Partial<Order> & Record<string, any> = {
        customerName: editingOrder.customerName,
        customerPhone: editingOrder.customerPhone,
        customerAddress: editingOrder.customerAddress,
        channel: editingOrder.channel,
        paymentMethod: editingOrder.paymentMethod,
        paymentStatus: normalizedPaymentStatus,
        paidAmount: nextPaidAmount,
        remainingDebt: nextRemainingDebt,
        status: editingOrder.status,
        fulfillmentStatus: editingOrder.status === 'delivered' ? 'completed' : editingOrder.status,
        totalCost,
        totalAmount,
        totalProfit,
        notes: editingOrder.notes,
        updatedAt: nowIso,
      };

      await Promise.all([
        setDoc(doc(db, 'stores', STORE_ID, 'orders', editingOrder.id), updates, { merge: true }),
        setDoc(doc(db, 'orders', editingOrder.id), updates, { merge: true }),
        setDoc(doc(db, 'transactions', editingOrder.id), updates, { merge: true }).catch(() => {}),
        setDoc(doc(db, 'stores', STORE_ID, 'transactions', editingOrder.id), updates, { merge: true }).catch(() => {}),
      ]);

      if (selectedOrder?.id === editingOrder.id) {
        setSelectedOrder((prev) => (prev ? { ...prev, ...updates } : null));
      }
      setEditingOrder(null);
    } catch (err) {
      console.error('Error updating order:', err);
    }
  };

  // WhatsApp Share Message
  const getWhatsAppShareUrl = (order: Order) => {
    const cleanPhone = (order.customerPhone || '').replace(/[^0-9]/g, '');
    const phoneToUse = cleanPhone.startsWith('0')
      ? `62${cleanPhone.slice(1)}`
      : cleanPhone.startsWith('62')
      ? cleanPhone
      : `62${cleanPhone}`;

    const itemsText = order.items
      ?.map(
        (i, idx) =>
          `${idx + 1}. ${i.name} (${i.packageType}) x${i.qty} = ${formatMoney(i.subtotal)}`
      )
      .join('%0A');

    const courierText = order.deliveryStaffName
      ? `%0A*Delivery Courier:* ${order.deliveryStaffName} (${order.deliveryStaffPhone || '-'})`
      : '';

    const text = `*RISKCART POS - ORDER CONFIRMATION*%0A%0A*Order ID:* ${order.orderNumber}%0A*Status:* ${order.status.toUpperCase()}%0A*Customer:* ${order.customerName}%0A*Address:* ${order.customerAddress || '-'}${courierText}%0A%0A*Items:*%0A${itemsText}%0A%0A*Total Amount:* ${formatMoney(
      order.totalAmount
    )}%0A*Payment Method:* ${order.paymentMethod}%0A%0AThank you for ordering with RiskCart!`;

    return `https://wa.me/${phoneToUse}?text=${text}`;
  };

  return (
    <div className="w-full space-y-6 pb-20">
      {/* 1. TOP HEADER & BREADCRUMB (RiskCart Dark Navy Theme) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 p-5 rounded-2xl backdrop-blur-sm shadow-xl">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">
            <ShoppingBag className="w-4 h-4" />
            <span>Fulfillment Operations &bull; Wharf Engine</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
            Orders
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 font-medium">
              {filteredOrders.length} {filteredOrders.length === 1 ? 'order' : 'orders'}
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Omnichannel order pipeline with click-to-fulfill drawer, courier tracking, and live gross profit margins.
          </p>
        </div>

        {/* Header Quick Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => window.location.reload()}
            className="px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
            title="Refresh order directory"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <AppLink
            to="/orders/tambah"
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-blue-600/30 border border-blue-400/40 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ Create Order</span>
          </AppLink>
        </div>
      </div>

      {/* 2. WHARF STATUS TABS & FILTER BAR */}
      <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-2xl space-y-4 backdrop-blur-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Status Tabs (Top-Left Pill Buttons) */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 custom-scrollbar">
            {[
              { id: 'all', label: 'All', count: counts.all, color: 'blue' },
              { id: 'new', label: 'New', count: counts.new, color: 'amber' },
              { id: 'packing', label: 'Packing', count: counts.packing, color: 'orange' },
              { id: 'shipped', label: 'Shipped', count: counts.shipped, color: 'blue' },
              { id: 'delivered', label: 'Delivered', count: counts.delivered, color: 'emerald' },
              { id: 'returned', label: 'Returned', count: counts.returned, color: 'rose' },
            ].map((tab) => {
              const isActive = activeStatusTab === tab.id;
              return (
                <AppLink
                  key={tab.id}
                  to={tab.id === 'all' ? '/orders' : `/orders/${tab.id}`}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-2 cursor-pointer ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                      : 'bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-750'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      isActive
                        ? 'bg-white/25 text-white'
                        : 'bg-slate-700/80 text-slate-300'
                    }`}
                  >
                    {tab.count}
                  </span>
                </AppLink>
              );
            })}
          </div>

          {/* Right Filters: Channel Dropdown, Payment Dropdown & Real-time Search */}
          <div className="flex flex-col sm:flex-row items-center gap-2.5">
            {/* Payment Status Filter */}
            <div className="w-full sm:w-auto relative min-w-[145px]">
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer appearance-none pr-8"
              >
                <option value="all">Semua Payment</option>
                <option value="paid">Lunas</option>
                <option value="hutang_all">Hutang (Semua)</option>
                <option value="unpaid">Hutang • Belum Lunas</option>
                <option value="partial">Hutang • Bayar Sebagian</option>
              </select>
              <div className="absolute right-2.5 top-2.5 pointer-events-none text-slate-400">
                <CreditCard className="w-3.5 h-3.5" />
              </div>
            </div>

            {/* Channel Filter */}
            <div className="w-full sm:w-auto relative min-w-[150px]">
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer appearance-none pr-8"
              >
                <option value="all">All channels</option>
                <option value="pos">POS Terminal (Kasir)</option>
                <option value="visitor">Visitor (Walk-in POS)</option>
                <option value="pwa">PWA (Mobile App)</option>
                <option value="website">Website (E-Catalog)</option>
              </select>
              <div className="absolute right-2.5 top-2.5 pointer-events-none text-slate-400">
                <Filter className="w-3.5 h-3.5" />
              </div>
            </div>

            {/* Search Input */}
            <div className="w-full sm:w-72 relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search order ID, customer, phone..."
                className="w-full bg-slate-950/90 border border-slate-800 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. ORDERS TABLE (Wharf Dashboard Layout) */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-visible shadow-2xl backdrop-blur-sm">
        {loading ? (
          <div className="py-20 text-center space-y-3">
            <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mx-auto" />
            <p className="text-sm text-slate-400">Loading orders from Firestore...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="py-20 text-center space-y-3 px-4">
            <div className="w-16 h-16 rounded-full bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
              <ShoppingBag className="w-8 h-8 text-slate-500" />
            </div>
            <h3 className="text-base font-semibold text-white">No orders found</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              {searchQuery || channelFilter !== 'all' || paymentFilter !== 'all' || activeStatusTab !== 'all'
                ? 'Try adjusting your search query or switching active status, payment, and channel filters.'
                : 'There are no customer orders in this store yet. Click "+ Create Order" to place your first order.'}
            </p>
            {(searchQuery || channelFilter !== 'all' || paymentFilter !== 'all' || activeStatusTab !== 'all') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setChannelFilter('all');
                  setPaymentFilter('all');
                  setActiveStatusTab('all');
                }}
                className="px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 text-xs font-medium hover:bg-blue-600/30 transition cursor-pointer"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto min-h-[340px]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800 select-none">
                  <th className="py-3.5 px-4 font-semibold">Order ID</th>
                  <th className="py-3.5 px-4 font-semibold">Customer</th>
                  <th className="py-3.5 px-3 font-semibold">Channel</th>
                  <th className="py-3.5 px-3 font-semibold">Delivery Staff</th>
                  <th className="py-3.5 px-3 font-semibold text-center">Items</th>
                  <th className="py-3.5 px-3 font-semibold">Placed</th>
                  <th className="py-3.5 px-3 font-semibold text-right">Total Modal</th>
                  <th className="py-3.5 px-3 font-semibold text-right">Total Jual</th>
                  <th className="py-3.5 px-3 font-semibold text-center">Payment</th>
                  <th className="py-3.5 px-3 font-semibold text-right">Total Untung</th>
                  <th className="py-3.5 px-4 font-semibold text-center">Status</th>
                  <th className="py-3.5 px-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredOrders.map((order) => {
                  const initials = order.customerName
                    ? order.customerName
                        .split(' ')
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()
                    : 'CU';
                  const payInfo = getOrderPaymentDetails(order);
                  const isMenuOpen = openActionMenuId === order.id;

                  return (
                    <tr
                      key={order.id}
                      onClick={() => handleOpenOrder(order)}
                      className="group hover:bg-slate-800/60 transition cursor-pointer"
                    >
                      {/* 1. Order ID */}
                      <td className="py-3.5 px-4 font-mono font-bold text-blue-400 group-hover:text-blue-300">
                        {order.orderNumber}
                      </td>

                      {/* 2. Customer (Initials + Name & City) */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5 min-w-[180px]">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0 shadow-sm">
                            {initials}
                          </div>
                          <div className="truncate">
                            <div className="font-semibold text-white truncate group-hover:text-blue-200">
                              {order.customerName}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate max-w-[200px]">
                              {order.customerAddress || order.customerPhone || '-'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 3. Channel */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {renderChannelBadge(order.channel)}
                      </td>

                      {/* 4. Delivery Staff (Staff Pengirim) */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {order.deliveryStaffName ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-slate-800 text-slate-200 border border-slate-700/80 shadow-sm">
                            <User className="w-3 h-3 text-blue-400 shrink-0" />
                            <span className="truncate max-w-[120px] font-semibold text-white">
                              {order.deliveryStaffName}
                            </span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-slate-500 border border-dashed border-slate-750">
                            Unassigned
                          </div>
                        )}
                      </td>

                      {/* 5. Items Count */}
                      <td className="py-3.5 px-3 text-center whitespace-nowrap">
                        <span className="text-slate-300 font-medium">
                          {order.itemsCount || order.items?.length || 1}
                        </span>{' '}
                        <span className="text-slate-500 text-[10px]">items</span>
                      </td>

                      {/* 6. Placed (Relative Time) */}
                      <td className="py-3.5 px-3 whitespace-nowrap text-slate-400 text-[11px]">
                        {formatRelativeTime(order.createdAt)}
                      </td>

                      {/* 7. Total Modal (Cost / HPP) */}
                      <td className="py-3.5 px-3 text-right font-mono text-slate-400 whitespace-nowrap">
                        {formatMoney(order.totalCost || 0)}
                      </td>

                      {/* 8. Total Jual (Gross Revenue) */}
                      <td className="py-3.5 px-3 text-right font-mono font-semibold text-white whitespace-nowrap">
                        {formatMoney(order.totalAmount || 0)}
                      </td>

                      {/* 9. Payment (Right next to Total Jual: Lunas / Hutang with remaining debt) */}
                      <td
                        className="py-3.5 px-3 text-center whitespace-nowrap"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenPaymentModal(order);
                        }}
                      >
                        {payInfo.isPaid ? (
                          <div className="inline-flex flex-col items-center">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm hover:bg-emerald-500/25 transition">
                              <CheckCircle2 className="w-3 h-3 shrink-0" />
                              <span>Lunas</span>
                            </span>
                            <span className="text-[10px] text-slate-400 mt-0.5 font-medium">
                              {order.paymentMethod || 'Tunai'}
                            </span>
                          </div>
                        ) : payInfo.isPartial ? (
                          <div
                            className="inline-flex flex-col items-center"
                            title="Klik untuk catat cicilan atau pelunasan sisa hutang"
                          >
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/40 shadow-sm hover:bg-amber-500/25 transition">
                              <Clock className="w-3 h-3 shrink-0 text-amber-400" />
                              <span>Hutang</span>
                            </span>
                            <span className="text-[10px] font-mono text-amber-300 font-semibold mt-0.5">
                              Sisa: {formatMoney(payInfo.remainingDebt)}
                            </span>
                            <span className="text-[9px] font-mono text-emerald-400/90">
                              DP: {formatMoney(payInfo.paidAmount)}
                            </span>
                          </div>
                        ) : (
                          <div
                            className="inline-flex flex-col items-center"
                            title="Klik untuk catat pembayaran / pelunasan hutang"
                          >
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 shadow-sm hover:bg-rose-500/25 transition">
                              <AlertCircle className="w-3 h-3 shrink-0 text-rose-400" />
                              <span>Hutang</span>
                            </span>
                            <span className="text-[10px] font-mono text-rose-300 font-semibold mt-0.5">
                              Sisa: {formatMoney(payInfo.remainingDebt)}
                            </span>
                            <span className="text-[9px] text-slate-400">
                              {order.paymentMethod || 'Belum Lunas'}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* 10. Total Untung (Net Margin Highlight) */}
                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
                        {hideHpp ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-zinc-900 text-amber-400 border border-amber-500/30">
                            🔒 Rahasia
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            <TrendingUp className="w-3 h-3 shrink-0" />
                            +{formatMoney(order.totalProfit || 0)}
                          </span>
                        )}
                      </td>

                      {/* 11. Status */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        {renderStatusBadge(order.status, (order as any).fulfillmentStatus)}
                      </td>

                      {/* 12. Quick Proses Button + Action Dropdown Menu */}
                      <td
                        className="py-3.5 px-3 text-right relative whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center justify-end gap-1.5 relative">
                          {(() => {
                            const rowStage = getCanonicalOrderStage(
                              order.status,
                              (order as any).fulfillmentStatus
                            );
                            const nextRowStage = getNextPipelineStage(rowStage);
                            if (nextRowStage) {
                              return (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleAdvanceOrderProcess(order);
                                  }}
                                  className="px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 text-black font-black text-[11px] inline-flex items-center gap-1 border border-amber-300/60 shadow-[0_0_12px_rgba(245,158,11,0.3)] transition cursor-pointer"
                                  title={`Proses pesanan ke tahap berikutnya: ${nextRowStage.stepLabel}`}
                                >
                                  <span>Proses</span>
                                  <ArrowRight className="w-3 h-3 text-black shrink-0" />
                                </button>
                              );
                            }
                            return null;
                          })()}

                          <div className="inline-block text-left relative">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenActionMenuId(isMenuOpen ? null : order.id);
                              }}
                              className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer ${
                                isMenuOpen
                                  ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-600/30'
                                  : 'bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-700/80'
                              }`}
                              title="Menu Aksi Pesanan"
                            >
                              <span>Action</span>
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>

                            {isMenuOpen && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 mt-1.5 w-60 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl z-50 py-1.5 divide-y divide-slate-800 text-left animate-in fade-in zoom-in-95 duration-150"
                              >
                                <div className="px-3 py-1.5 bg-slate-950/60">
                                  <div className="text-[10px] font-mono font-bold text-blue-400">
                                    #{order.orderNumber}
                                  </div>
                                  <div className="text-[11px] font-semibold text-white truncate">
                                    {order.customerName}
                                  </div>
                                </div>

                                <div className="py-1">
                                  {(() => {
                                    const rowStage = getCanonicalOrderStage(
                                      order.status,
                                      (order as any).fulfillmentStatus
                                    );
                                    const nextRowStage = getNextPipelineStage(rowStage);
                                    if (!nextRowStage) return null;
                                    return (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionMenuId(null);
                                          void handleAdvanceOrderProcess(order);
                                        }}
                                        className="w-full px-3 py-2 text-xs text-amber-300 hover:bg-amber-500/20 hover:text-amber-200 flex items-center gap-2.5 cursor-pointer transition font-bold"
                                      >
                                        <ArrowRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                        <span>Proses &rarr; {nextRowStage.shortLabel}</span>
                                      </button>
                                    );
                                  })()}

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      handleOpenOrder(order);
                                    }}
                                    className="w-full px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 cursor-pointer transition"
                                  >
                                    <Eye className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                    <span>Lihat Detail &amp; Fulfillment</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      handleOpenPaymentModal(order);
                                    }}
                                    className="w-full px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 cursor-pointer transition"
                                  >
                                    <Wallet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                    <span>
                                      {payInfo.isPaid
                                        ? 'Detail & Riwayat Pembayaran'
                                        : 'Bayar / Pelunasan Hutang'}
                                    </span>
                                  </button>

                                  {!payInfo.isPaid && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionMenuId(null);
                                        handleSubmitOrderPayment(
                                          order,
                                          payInfo.remainingDebt,
                                          order.paymentMethod &&
                                            !/hutang|debt|kasbon/i.test(order.paymentMethod)
                                            ? order.paymentMethod
                                            : 'Tunai',
                                          `Pelunasan Cepat Order #${order.orderNumber}`
                                        );
                                      }}
                                      className="w-full px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-950/50 hover:text-emerald-200 flex items-center gap-2.5 cursor-pointer transition font-semibold"
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                      <span>Tandai Lunas Cepat</span>
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      setEditingOrder({
                                        ...order,
                                        paidAmount: payInfo.paidAmount,
                                        remainingDebt: payInfo.remainingDebt,
                                        paymentStatus: payInfo.status,
                                      });
                                    }}
                                    className="w-full px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 cursor-pointer transition"
                                  >
                                    <Edit2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                    <span>Edit Data Pesanan</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      setSelectedOrder(order);
                                      setIsReceiptModalOpen(true);
                                    }}
                                    className="w-full px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 cursor-pointer transition"
                                  >
                                    <Printer className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                    <span>Print Struk / Surat Jalan</span>
                                  </button>

                                  <a
                                    href={getWhatsAppShareUrl(order)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => setOpenActionMenuId(null)}
                                    className="w-full px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 cursor-pointer transition"
                                  >
                                    <MessageCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                    <span>Kirim WhatsApp Pelanggan</span>
                                  </a>
                                </div>

                                <div className="py-1">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      setOpenActionMenuId(null);
                                      await handleDeleteOrder(order);
                                    }}
                                    className="w-full px-3 py-2 text-xs text-rose-400 hover:bg-rose-950/60 hover:text-rose-300 flex items-center gap-2.5 cursor-pointer transition font-semibold"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                                    <span>Hapus Pesanan</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* 4. ORDER DETAIL & FULFILLMENT SLIDE-OVER DRAWER / MODAL         */}
      {/* ============================================================== */}
      {isDrawerOpen && selectedOrder && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-black/70 backdrop-blur-sm transition-opacity">
          <div
            className="w-full max-w-2xl bg-slate-950 border-l border-slate-800 h-full flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="p-5 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <span className="text-xl font-bold font-mono text-white tracking-wide">
                    {selectedOrder.orderNumber}
                  </span>
                  {renderStatusBadge(selectedOrder.status)}
                  {renderChannelBadge(selectedOrder.channel)}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-500" />
                    {formatFullDateTime(selectedOrder.createdAt)}
                  </span>
                  <span>&bull;</span>
                  <span>Placed {formatRelativeTime(selectedOrder.createdAt)}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsReceiptModalOpen(true)}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition cursor-pointer"
                  title="Print Packing Slip / Thermal Struk"
                >
                  <Printer className="w-4 h-4" />
                </button>
                <a
                  href={getWhatsAppShareUrl(selectedOrder)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 text-xs font-medium transition cursor-pointer"
                  title="Share invoice via WhatsApp"
                >
                  <Share2 className="w-4 h-4" />
                </a>
                <button
                  onClick={() => {
                    setIsDrawerOpen(false);
                    navigateToPath('/orders');
                  }}
                  className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                  title="Close drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Drawer Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
              {/* SECTION A: FULFILLMENT PROGRESS STEPPER & QUICK ACTION BUTTONS */}
              {(() => {
                const activeCanonicalStage = getCanonicalOrderStage(
                  selectedOrder.status,
                  (selectedOrder as any).fulfillmentStatus
                );
                const stepWeights: Record<string, number> = {
                  new: 1,
                  packing: 2,
                  shipped: 3,
                  delivered: 4,
                  returned: -1,
                  cancelled: -1,
                };
                const currentWeight = stepWeights[activeCanonicalStage] || 1;
                const nextStageObj = getNextPipelineStage(activeCanonicalStage);

                return (
                  <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Truck className="w-4 h-4 text-blue-400" />
                        <span>Fulfillment Pipeline</span>
                      </h3>
                      <span className="text-[11px] font-medium text-slate-400">
                        Step{' '}
                        {activeCanonicalStage === 'new'
                          ? '1'
                          : activeCanonicalStage === 'packing'
                          ? '2'
                          : activeCanonicalStage === 'shipped'
                          ? '3'
                          : activeCanonicalStage === 'delivered'
                          ? '4'
                          : 'Special'}{' '}
                        of 4
                      </span>
                    </div>

                    {/* Progress Stepper Line: 1. New -> 2. Sedang Mengemas -> 3. Dikirim -> 4. Terkirim */}
                    <div className="grid grid-cols-4 gap-2 relative pt-1">
                      {PIPELINE_STAGES.map((step) => {
                        const isDone = currentWeight > step.num;
                        const isCurrent = activeCanonicalStage === step.key;

                        return (
                          <div
                            key={step.key}
                            onClick={() => void handleUpdateOrderStatus(step.firestoreStatus)}
                            className="flex flex-col items-center text-center space-y-1 cursor-pointer group"
                            title={`Ubah status ke ${step.stepLabel}`}
                          >
                            <div
                              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition ${
                                isDone
                                  ? 'bg-emerald-500 text-white'
                                  : isCurrent
                                  ? 'bg-blue-600 text-white ring-4 ring-blue-500/20 shadow-md shadow-blue-500/40'
                                  : 'bg-slate-800 text-slate-500 group-hover:border group-hover:border-amber-500/40'
                              }`}
                            >
                              {isDone ? <Check className="w-3.5 h-3.5" /> : step.num}
                            </div>
                            <span
                              className={`text-[11px] font-semibold leading-tight ${
                                isCurrent
                                  ? 'text-blue-400'
                                  : isDone
                                  ? 'text-emerald-400'
                                  : 'text-slate-500'
                              }`}
                            >
                              {step.stepLabel}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Horizontal Divider directly below the 4 pipeline circles */}
                    <hr className="border-amber-500/20 my-3" />

                    {/* Real-Time Status Control: 4 Direct Status Pills + Primary 'Proses' Button */}
                    <div className="space-y-2.5">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                        {PIPELINE_STAGES.map((step) => {
                          const isActive = activeCanonicalStage === step.key;
                          return (
                            <button
                              key={step.key}
                              type="button"
                              onClick={() => void handleUpdateOrderStatus(step.firestoreStatus)}
                              className={`py-2 px-2 rounded-xl text-[10px] font-black tracking-wide transition cursor-pointer border text-center ${
                                isActive
                                  ? 'bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] text-black border-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.45)]'
                                  : 'bg-[#110f0a] hover:bg-amber-500/15 text-amber-200/80 hover:text-amber-100 border-amber-500/35'
                              }`}
                            >
                              {step.pillLabel}
                            </button>
                          );
                        })}
                      </div>

                      {/* Primary Action: Proses -> [Next Stage] & Secondary Return/Cancel */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {nextStageObj ? (
                          <button
                            type="button"
                            onClick={() => void handleAdvanceOrderProcess(selectedOrder)}
                            className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 text-black text-xs font-black flex items-center justify-center gap-2 border border-amber-300/70 shadow-[0_0_16px_rgba(245,158,11,0.35)] transition cursor-pointer"
                          >
                            <span>Proses &rarr; {nextStageObj.shortLabel}</span>
                            <ArrowRight className="w-4 h-4 text-black shrink-0" />
                          </button>
                        ) : activeCanonicalStage === 'delivered' ? (
                          <div className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center justify-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            <span>4. Terkirim (Pesanan Selesai)</span>
                          </div>
                        ) : null}

                        {activeCanonicalStage !== 'returned' &&
                          activeCanonicalStage !== 'cancelled' && (
                            <button
                              type="button"
                              onClick={() => void handleUpdateOrderStatus('returned')}
                              className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-rose-950/50 hover:text-rose-300 text-slate-400 text-xs font-medium border border-slate-700 transition cursor-pointer flex items-center gap-1.5"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Return</span>
                            </button>
                          )}

                        {activeCanonicalStage === 'new' && (
                          <button
                            type="button"
                            onClick={() => void handleUpdateOrderStatus('cancelled')}
                            className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-rose-950/50 hover:text-rose-300 text-slate-400 text-xs font-medium border border-slate-700 transition cursor-pointer flex items-center gap-1.5"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Cancel</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* SECTION B: FULFILLMENT & COURIER ASSIGNMENT (Penugasan Pengirim) */}
              <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl space-y-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <User className="w-4 h-4 text-blue-400" />
                    <span>Fulfillment &amp; Courier Assignment</span>
                  </h3>
                  {selectedOrder.deliveryStaffName && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-semibold border border-blue-500/30">
                      Dispatched
                    </span>
                  )}
                </div>

                {/* Assigned Courier Display Banner if already assigned */}
                {selectedOrder.deliveryStaffName && (
                  <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center font-bold text-xs">
                        {selectedOrder.deliveryStaffName[0]}
                      </div>
                      <div>
                        <div className="font-semibold text-white text-xs">
                          {selectedOrder.deliveryStaffName}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-2">
                          <Phone className="w-3 h-3 text-slate-500" />
                          <span>{selectedOrder.deliveryStaffPhone || '-'}</span>
                          {selectedOrder.assignedAt && (
                            <>
                              <span>&bull;</span>
                              <span>Assigned {formatRelativeTime(selectedOrder.assignedAt)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {selectedOrder.deliveryStaffPhone && (
                      <a
                        href={`https://wa.me/${selectedOrder.deliveryStaffPhone.replace(/[^0-9]/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 text-[11px] font-semibold flex items-center gap-1.5 transition"
                      >
                        <MessageCircle className="w-3 h-3" />
                        <span>Chat Courier</span>
                      </a>
                    )}
                  </div>
                )}

                {/* Assign / Re-assign Dropdown */}
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold text-slate-400 block">
                    {selectedOrder.deliveryStaffName ? 'Re-assign Courier / Staff' : 'Select Delivery Staff (Staff Pengirim)'}
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedStaffId}
                      onChange={(e) => setSelectedStaffId(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer"
                    >
                      <option value="">-- Choose Courier / Delivery Staff --</option>
                      {availableCouriers.map((staff) => (
                        <option key={staff.id} value={staff.id}>
                          {staff.name} &bull; {staff.role} ({staff.phone})
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={handleAssignDeliveryStaff}
                      disabled={isAssigningStaff || !selectedStaffId}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-xs transition cursor-pointer flex items-center gap-1.5 shrink-0"
                    >
                      {isAssigningStaff ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>Assign Staff</span>
                    </button>
                  </div>

                  {availableCouriers.length === 0 && (
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
                      <span>Belum ada staff pengirim terdaftar.</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (onNavigateTab) onNavigateTab('staff');
                          else navigateToPath('/dashboard/staff');
                        }}
                        className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white font-medium text-[11px] transition"
                      >
                        + Tambah Staff
                      </button>
                    </div>
                  )}

                  {assignSuccessMessage && (
                    <div className="text-[11px] text-emerald-400 flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 p-2 rounded-lg">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{assignSuccessMessage}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* SECTION C: CUSTOMER & DELIVERY ADDRESS CARD */}
              <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl space-y-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <User className="w-4 h-4 text-blue-400" />
                  <span>Customer &amp; Shipping Details</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-850">
                    <span className="text-[10px] uppercase text-slate-500 font-semibold block">Customer Name</span>
                    <span className="text-white font-semibold text-sm">{selectedOrder.customerName}</span>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-850 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase text-slate-500 font-semibold block">Phone / WhatsApp</span>
                      <span className="text-white font-mono">{selectedOrder.customerPhone || '-'}</span>
                    </div>
                    {selectedOrder.customerPhone && (
                      <a
                        href={getWhatsAppShareUrl(selectedOrder)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30"
                        title="Direct WhatsApp message"
                      >
                        <MessageCircle className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-950 border border-slate-850 space-y-1 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-400 font-semibold text-[11px]">
                    <MapPin className="w-3.5 h-3.5 text-rose-400" />
                    <span>Destination Shipping Address:</span>
                  </div>
                  <p className="text-slate-200 pl-5">{selectedOrder.customerAddress || 'Walk-in Store Pickup'}</p>
                </div>

                {((selectedOrder as any).orderNotes || selectedOrder.notes) && (
                  <div className="rc-notes-preview p-3 rounded-lg bg-amber-500/10 border border-amber-500/35 text-xs space-y-1">
                    <span className="text-[10px] uppercase text-amber-400 font-bold block">
                      Catatan Pesanan / Request Khusus:
                    </span>
                    {(selectedOrder as any).orderNotes && (
                      <p className="text-amber-200 font-semibold">
                        📝 Catatan Umum: &ldquo;{(selectedOrder as any).orderNotes}&rdquo;
                      </p>
                    )}
                    {selectedOrder.notes && (
                      <p className="text-slate-300 mt-0.5">{selectedOrder.notes}</p>
                    )}
                  </div>
                )}
              </div>

              {/* SECTION D: ORDER ITEMS TABLE */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Boxes className="w-4 h-4 text-blue-400" />
                    <span>Order Items Breakdown</span>
                  </h3>
                  <span className="text-xs font-semibold text-slate-400">
                    {selectedOrder.items?.length || 1} line item(s)
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                        <th className="py-2.5 px-3">Item / SKU</th>
                        <th className="py-2.5 px-2 text-center">Package</th>
                        <th className="py-2.5 px-2 text-center">Qty</th>
                        <th className="py-2.5 px-3 text-right">Modal (Cost)</th>
                        <th className="py-2.5 px-3 text-right">Price (Jual)</th>
                        <th className="py-2.5 px-3 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {selectedOrder.items?.map((item, idx) => {
                        const itemNote = String(
                          (item as any).notes ?? (item as any).note ?? ''
                        ).trim();
                        return (
                          <tr key={idx} className="hover:bg-slate-800/40">
                            <td className="py-3 px-3 space-y-1">
                              <div className="font-semibold text-white">{item.name}</div>
                              <div className="text-[10px] font-mono text-slate-400">{item.sku}</div>
                              {itemNote && (
                                <div className="rc-notes-preview inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-[10px] font-semibold text-amber-300">
                                  📝 &ldquo;{itemNote}&rdquo;
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-2 text-center">
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 capitalize">
                                {item.packageType}
                              </span>
                            </td>
                            <td className="py-3 px-2 text-center font-bold text-white">
                              {item.qty}
                            </td>
                            <td className="py-3 px-3 text-right font-mono text-slate-400">
                              {formatMoney(item.costPrice)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono text-slate-300">
                              {formatMoney(item.sellingPrice)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-bold text-white">
                              {formatMoney(item.subtotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SECTION E: FINANCIAL & PAYMENT SUMMARY CARD */}
              {(() => {
                const drawerPayInfo = getOrderPaymentDetails(selectedOrder);
                return (
                  <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <DollarSign className="w-4 h-4 text-emerald-400" />
                        <span>Financial, Payment &amp; Margin Summary</span>
                      </h3>
                      <button
                        type="button"
                        onClick={() => handleOpenPaymentModal(selectedOrder)}
                        className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <Wallet className="w-3.5 h-3.5" />
                        <span>
                          {drawerPayInfo.isPaid ? 'Riwayat Pembayaran' : 'Catat Pembayaran / Cicilan'}
                        </span>
                      </button>
                    </div>

                    <div className="space-y-2 text-xs divide-y divide-slate-800">
                      <div className="flex justify-between text-slate-400 pt-1">
                        <span>Total Cost / Modal (HPP):</span>
                        <span className="font-mono">{formatMoney(selectedOrder.totalCost || 0)}</span>
                      </div>
                      <div className="flex justify-between text-slate-300 pt-2 font-medium">
                        <span>Total Selling Price (Total Jual):</span>
                        <span className="font-mono text-white text-sm font-bold">
                          {formatMoney(selectedOrder.totalAmount || 0)}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-300 pt-2">
                        <span>Sudah Dibayar (Paid / DP):</span>
                        <span className="font-mono text-emerald-400 font-bold">
                          {formatMoney(drawerPayInfo.paidAmount)}
                        </span>
                      </div>
                      {drawerPayInfo.remainingDebt > 0 && (
                        <div className="flex justify-between text-rose-300 pt-2 font-semibold">
                          <span>Sisa Hutang (Belum Dibayar):</span>
                          <span className="font-mono text-rose-400 font-bold">
                            {formatMoney(drawerPayInfo.remainingDebt)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-center text-emerald-400 pt-2 font-semibold">
                        <span className="flex items-center gap-1">
                          <TrendingUp className="w-4 h-4" />
                          Net Profit (Total Untung Bersih):
                        </span>
                        <span className="font-mono text-base font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                          +{formatMoney(selectedOrder.totalProfit || 0)}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-xs">
                      <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-850">
                        <span className="text-[10px] text-slate-500 uppercase block font-semibold">
                          Payment Method
                        </span>
                        <span className="text-white font-bold">
                          {selectedOrder.paymentMethod || 'Tunai'}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-850 flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[10px] text-slate-500 uppercase block font-semibold">
                            Payment Status
                          </span>
                          <span
                            className={`font-bold uppercase text-[11px] ${
                              drawerPayInfo.isPaid
                                ? 'text-emerald-400'
                                : drawerPayInfo.isPartial
                                ? 'text-amber-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {drawerPayInfo.isPaid
                              ? 'LUNAS (PAID)'
                              : drawerPayInfo.isPartial
                              ? 'HUTANG (BAYAR SEBAGIAN)'
                              : 'HUTANG (BELUM LUNAS)'}
                          </span>
                        </div>
                        {!drawerPayInfo.isPaid && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleOpenPaymentModal(selectedOrder, 'partial')}
                              className="px-2 py-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-[10px] font-bold transition cursor-pointer"
                            >
                              Cicil / DP
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenPaymentModal(selectedOrder, 'full')}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition cursor-pointer"
                              title="Pelunasan Tagihan & Catat Kas Masuk"
                            >
                              Lunasi
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Payment History inside Drawer if available */}
                    {Array.isArray(selectedOrder.paymentHistory) &&
                      selectedOrder.paymentHistory.length > 0 && (
                        <div className="pt-2 border-t border-slate-800 space-y-1.5">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">
                            Riwayat Pembayaran ({selectedOrder.paymentHistory.length})
                          </span>
                          <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                            {selectedOrder.paymentHistory.map((ph) => (
                              <div
                                key={ph.id}
                                className="flex items-center justify-between text-[11px] bg-slate-950/90 border border-slate-800/80 px-2.5 py-1.5 rounded-lg"
                              >
                                <div>
                                  <div className="font-semibold text-slate-200">
                                    {ph.method} &bull;{' '}
                                    <span className="text-slate-400 font-normal">
                                      {formatFullDateTime(ph.date)}
                                    </span>
                                  </div>
                                  {ph.note && (
                                    <div className="text-[10px] text-slate-500 truncate max-w-[260px]">
                                      {ph.note}
                                    </div>
                                  )}
                                </div>
                                <span className="font-mono font-bold text-emerald-400">
                                  +{formatMoney(ph.amount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                  </div>
                );
              })()}
            </div>

            {/* Drawer Footer Actions */}
            <div className="p-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between gap-3">
              <button
                onClick={() => setIsReceiptModalOpen(true)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs flex items-center justify-center gap-2 border border-slate-700 transition cursor-pointer"
              >
                <Printer className="w-4 h-4 text-blue-400" />
                <span>Print Packing Slip</span>
              </button>

              <a
                href={getWhatsAppShareUrl(selectedOrder)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>Share WhatsApp</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 5. THERMAL RECEIPT / PACKING SLIP MODAL                        */}
      {/* ============================================================== */}
      {isReceiptModalOpen && selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-white text-zinc-900 rounded-2xl max-w-sm w-full p-6 shadow-2xl relative font-mono text-xs">
            <button
              onClick={() => setIsReceiptModalOpen(false)}
              className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-900"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Receipt Header */}
            <div className="text-center space-y-1 pb-4 border-b border-dashed border-zinc-400">
              <h2 className="text-base font-bold tracking-tight">RISKCART OFFICIAL STORE</h2>
              <p className="text-[10px] text-zinc-600">POS &amp; Omnichannel Grocery Wholesaler</p>
              <p className="text-[10px] text-zinc-600">Jl. Boulevard Raya Blok QF1 No. 12</p>
              <p className="text-[10px] font-bold mt-2">PACKING &amp; DISPATCH SLIP</p>
            </div>

            {/* Receipt Meta */}
            <div className="py-3 border-b border-dashed border-zinc-400 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span>ORDER:</span>
                <span className="font-bold">{selectedOrder.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>DATE:</span>
                <span>{formatFullDateTime(selectedOrder.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span>CHANNEL:</span>
                <span className="uppercase">{selectedOrder.channel}</span>
              </div>
              <div className="flex justify-between">
                <span>CUSTOMER:</span>
                <span className="font-bold">{selectedOrder.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span>PHONE:</span>
                <span>{selectedOrder.customerPhone || '-'}</span>
              </div>
              {selectedOrder.deliveryStaffName && (
                <div className="flex justify-between text-blue-700 font-bold">
                  <span>COURIER:</span>
                  <span>{selectedOrder.deliveryStaffName}</span>
                </div>
              )}
            </div>

            {/* Itemized List */}
            <div className="py-3 border-b border-dashed border-zinc-400 space-y-2">
              {selectedOrder.items?.map((item, idx) => (
                <div key={idx} className="space-y-0.5 text-[11px]">
                  <div className="font-bold">{item.name}</div>
                  <div className="flex justify-between text-zinc-600">
                    <span>
                      {item.qty} x {formatMoney(item.sellingPrice)} ({item.packageType})
                    </span>
                    <span className="font-bold text-zinc-900">{formatMoney(item.subtotal)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="py-3 border-b border-dashed border-zinc-400 space-y-1 font-bold text-[11px]">
              <div className="flex justify-between">
                <span>SUBTOTAL:</span>
                <span>{formatMoney(selectedOrder.totalAmount)}</span>
              </div>
              <div className="flex justify-between text-sm pt-1">
                <span>TOTAL JUAL:</span>
                <span>{formatMoney(selectedOrder.totalAmount)}</span>
              </div>
              <div className="flex justify-between text-zinc-600 font-normal">
                <span>PAYMENT:</span>
                <span>{selectedOrder.paymentMethod} (PAID)</span>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-4 text-center space-y-3">
              <p className="text-[10px] text-zinc-500">
                Barang yang sudah diterima harap diperiksa di depan kurir toko. Terima kasih!
              </p>
              <button
                onClick={() => window.print()}
                className="w-full py-2 rounded-xl bg-zinc-900 hover:bg-black text-white font-sans font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Print Thermal Slip</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 6. CREATE MANUAL ORDER MODAL                                   */}
      {/* ============================================================== */}
      {isNewOrderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Plus className="w-5 h-5 text-blue-400" />
                  <span>Create New Order</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Direct omnichannel manual order entry with instant margin calculations.
                </p>
              </div>
              <button
                onClick={() => {
                  setIsNewOrderModalOpen(false);
                  navigateToPath('/orders');
                }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNewOrder} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">
                    Customer Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newOrderForm.customerName}
                    onChange={(e) =>
                      setNewOrderForm({ ...newOrderForm, customerName: e.target.value })
                    }
                    placeholder="e.g. Toko Berkah / Ibu Ani"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-slate-300 font-semibold block mb-1">
                    WhatsApp Phone Number
                  </label>
                  <input
                    type="text"
                    value={newOrderForm.customerPhone}
                    onChange={(e) =>
                      setNewOrderForm({ ...newOrderForm, customerPhone: e.target.value })
                    }
                    placeholder="e.g. +62 812-3456-7890"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Channel</label>
                  <select
                    value={newOrderForm.channel}
                    onChange={(e) =>
                      setNewOrderForm({
                        ...newOrderForm,
                        channel: e.target.value as OrderChannel,
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="visitor">Visitor (Walk-in Cashier POS)</option>
                    <option value="pwa">PWA (Mobile Web App)</option>
                    <option value="website">Website (Online Catalog)</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-300 font-semibold block mb-1">
                    Payment Method
                  </label>
                  <select
                    value={newOrderForm.paymentMethod}
                    onChange={(e) =>
                      setNewOrderForm({ ...newOrderForm, paymentMethod: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="Tunai">Tunai</option>
                    <option value="Hutang">Hutang (Piutang Pelanggan)</option>
                    <option value="COD">COD (Bayar di Tempat)</option>
                    <option value="QRIS">QRIS</option>
                    <option value="Bank Transfer (BCA)">Bank Transfer (BCA)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Delivery Destination Address
                </label>
                <textarea
                  rows={2}
                  value={newOrderForm.customerAddress}
                  onChange={(e) =>
                    setNewOrderForm({ ...newOrderForm, customerAddress: e.target.value })
                  }
                  placeholder="Jl. Raya No. ..., Kecamatan, Kota"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Product Item Line */}
              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-850 space-y-3">
                <span className="text-[11px] font-bold text-blue-400 uppercase tracking-wider block">
                  Product Item Line
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 block mb-1">Product Name</label>
                    <input
                      type="text"
                      required
                      value={newOrderForm.itemName}
                      onChange={(e) =>
                        setNewOrderForm({ ...newOrderForm, itemName: e.target.value })
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Package Type</label>
                    <select
                      value={newOrderForm.packageType}
                      onChange={(e) =>
                        setNewOrderForm({
                          ...newOrderForm,
                          packageType: e.target.value as 'carton' | 'unit',
                        })
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white"
                    >
                      <option value="carton">Carton / Dus</option>
                      <option value="unit">Unit / Eceran</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-slate-400 block mb-1">Quantity</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={newOrderForm.qty}
                      onChange={(e) =>
                        setNewOrderForm({ ...newOrderForm, qty: Number(e.target.value) })
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Modal / HPP (Rp)</label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={newOrderForm.costPrice}
                      onChange={(e) =>
                        setNewOrderForm({
                          ...newOrderForm,
                          costPrice: Number(e.target.value),
                        })
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Harga Jual (Rp)</label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={newOrderForm.sellingPrice}
                      onChange={(e) =>
                        setNewOrderForm({
                          ...newOrderForm,
                          sellingPrice: Number(e.target.value),
                        })
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono"
                    />
                  </div>
                </div>

                {/* Live Margin Calculation */}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800 font-semibold">
                  <span className="text-slate-400">Estimated Untung Bersih:</span>
                  <span className="text-emerald-400 font-mono">
                    +
                    {formatMoney(
                      (newOrderForm.sellingPrice - newOrderForm.costPrice) *
                        newOrderForm.qty
                    )}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Notes / Courier Instructions
                </label>
                <input
                  type="text"
                  value={newOrderForm.notes}
                  onChange={(e) =>
                    setNewOrderForm({ ...newOrderForm, notes: e.target.value })
                  }
                  placeholder="e.g. Tolong diantar sebelum jam 15:00"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsNewOrderModalOpen(false);
                    navigateToPath('/orders');
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-600/30 flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Save Order to Firestore</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 7. EDIT ORDER DATA MODAL                                       */}
      {/* ============================================================== */}
      {editingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Edit2 className="w-4 h-4 text-amber-400" />
                  <span>Edit Data Pesanan ({editingOrder.orderNumber})</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Perbarui informasi pelanggan, status pembayaran, dan nilai pesanan di Firestore
                </p>
              </div>
              <button
                onClick={() => setEditingOrder(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditOrder} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Nama Pelanggan *</label>
                  <input
                    type="text"
                    required
                    value={editingOrder.customerName}
                    onChange={(e) => setEditingOrder({ ...editingOrder, customerName: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">No. Telepon / WA</label>
                  <input
                    type="text"
                    value={editingOrder.customerPhone || ''}
                    onChange={(e) => setEditingOrder({ ...editingOrder, customerPhone: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">Alamat Pengiriman</label>
                <input
                  type="text"
                  value={editingOrder.customerAddress || ''}
                  onChange={(e) => setEditingOrder({ ...editingOrder, customerAddress: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Status Pesanan</label>
                  <select
                    value={editingOrder.status}
                    onChange={(e) => setEditingOrder({ ...editingOrder, status: e.target.value as OrderStatus })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="new">New</option>
                    <option value="packing">Packing</option>
                    <option value="shipped">Shipped</option>
                    <option value="delivered">Delivered</option>
                    <option value="returned">Returned</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Channel</label>
                  <select
                    value={editingOrder.channel}
                    onChange={(e) => setEditingOrder({ ...editingOrder, channel: e.target.value as OrderChannel })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="pos">POS Kasir</option>
                    <option value="visitor">Visitor</option>
                    <option value="pwa">PWA</option>
                    <option value="website">Website</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Metode Bayar</label>
                  <select
                    value={editingOrder.paymentMethod || 'Tunai'}
                    onChange={(e) => setEditingOrder({ ...editingOrder, paymentMethod: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="Tunai">Tunai</option>
                    <option value="Hutang">Hutang</option>
                    <option value="COD">COD</option>
                    <option value="QRIS">QRIS</option>
                    <option value="Bank Transfer (BCA)">Bank Transfer (BCA)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Status Payment</label>
                  <select
                    value={editingOrder.paymentStatus || 'paid'}
                    onChange={(e) => {
                      const nextSt = e.target.value as Order['paymentStatus'];
                      const tot = Number(editingOrder.totalAmount || 0);
                      setEditingOrder({
                        ...editingOrder,
                        paymentStatus: nextSt,
                        paidAmount:
                          nextSt === 'paid'
                            ? tot
                            : nextSt === 'unpaid'
                            ? 0
                            : Number(editingOrder.paidAmount || Math.round(tot * 0.5)),
                      });
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="paid">Lunas (Paid)</option>
                    <option value="partial">Hutang - Bayar Sebagian (DP)</option>
                    <option value="unpaid">Hutang - Belum Lunas (Unpaid)</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-300 font-semibold block mb-1">
                    Sudah Dibayar / DP (Rp)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={editingOrder.totalAmount || 0}
                    value={
                      editingOrder.paymentStatus === 'paid'
                        ? editingOrder.totalAmount || 0
                        : editingOrder.paymentStatus === 'unpaid'
                        ? 0
                        : editingOrder.paidAmount || 0
                    }
                    onChange={(e) => {
                      const paidVal = Number(e.target.value || 0);
                      const tot = Number(editingOrder.totalAmount || 0);
                      setEditingOrder({
                        ...editingOrder,
                        paidAmount: paidVal,
                        remainingDebt: Math.max(0, tot - paidVal),
                        paymentStatus:
                          paidVal >= tot ? 'paid' : paidVal > 0 ? 'partial' : 'unpaid',
                      });
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Total Modal / HPP (Rp)</label>
                  <input
                    type="number"
                    value={editingOrder.totalCost || 0}
                    onChange={(e) => setEditingOrder({ ...editingOrder, totalCost: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Total Jual (Rp)</label>
                  <input
                    type="number"
                    value={editingOrder.totalAmount || 0}
                    onChange={(e) => setEditingOrder({ ...editingOrder, totalAmount: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">Catatan</label>
                <input
                  type="text"
                  value={editingOrder.notes || ''}
                  onChange={(e) => setEditingOrder({ ...editingOrder, notes: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingOrder(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold cursor-pointer"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 8. PAYMENT & RECEIVABLE SETTLEMENT MODAL (LUNAS / CICILAN DP)   */}
      {/* ============================================================== */}
      {paymentModalOrder &&
        (() => {
          const modalPayInfo = getOrderPaymentDetails(paymentModalOrder);
          const cleanInputAmount = Math.max(
            0,
            Math.min(modalPayInfo.remainingDebt, Number(paymentAmountInput || 0))
          );
          const projectedRemaining = Math.max(0, modalPayInfo.remainingDebt - cleanInputAmount);

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 my-8 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <Wallet className="w-5 h-5 text-emerald-400" />
                      <h3 className="text-base font-bold text-white">
                        Pembayaran &amp; Pelunasan Pesanan
                      </h3>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Order <span className="font-mono text-blue-400 font-bold">#{paymentModalOrder.orderNumber}</span> &bull;{' '}
                      <span className="text-white font-semibold">{paymentModalOrder.customerName}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPaymentModalOrder(null)}
                    className="text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Bill Summary Cards */}
                <div className="grid grid-cols-3 gap-2.5 text-xs">
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                      Total Jual
                    </span>
                    <span className="font-mono font-bold text-white text-sm mt-0.5 block">
                      {formatMoney(modalPayInfo.totalAmount)}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30">
                    <span className="text-[10px] text-emerald-300 uppercase font-semibold block">
                      Sudah Dibayar
                    </span>
                    <span className="font-mono font-bold text-emerald-400 text-sm mt-0.5 block">
                      {formatMoney(modalPayInfo.paidAmount)}
                    </span>
                  </div>
                  <div
                    className={`p-3 rounded-xl border ${
                      modalPayInfo.remainingDebt > 0
                        ? 'bg-rose-950/30 border-rose-500/30'
                        : 'bg-slate-950 border-slate-800'
                    }`}
                  >
                    <span className="text-[10px] text-rose-300 uppercase font-semibold block">
                      Sisa Hutang
                    </span>
                    <span
                      className={`font-mono font-bold text-sm mt-0.5 block ${
                        modalPayInfo.remainingDebt > 0 ? 'text-rose-400' : 'text-slate-400'
                      }`}
                    >
                      {formatMoney(modalPayInfo.remainingDebt)}
                    </span>
                  </div>
                </div>

                {modalPayInfo.isPaid ? (
                  <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-center space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                    <div className="text-sm font-bold text-white">
                      Pesanan Ini Sudah Lunas (PAID)
                    </div>
                    <p className="text-xs text-slate-300">
                      Seluruh tagihan sebesar{' '}
                      <span className="font-mono font-bold text-emerald-300">
                        {formatMoney(modalPayInfo.totalAmount)}
                      </span>{' '}
                      telah terbayar lunas dan tercatat di buku kas.
                    </p>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSubmitOrderPayment(
                        paymentModalOrder,
                        paymentMode === 'full' ? modalPayInfo.remainingDebt : cleanInputAmount,
                        paymentMethodInput,
                        paymentNoteInput
                      );
                    }}
                    className="space-y-4 text-xs"
                  >
                    {/* Payment Mode Toggle: Pelunasan Penuh vs Bayar Sebagian (Cicilan/DP) */}
                    <div>
                      <label className="text-slate-300 font-semibold block mb-1.5">
                        Pilih Jenis Pembayaran
                      </label>
                      <div className="grid grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentMode('full');
                            setPaymentAmountInput(modalPayInfo.remainingDebt);
                          }}
                          className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                            paymentMode === 'full'
                              ? 'bg-emerald-600/20 border-emerald-500 text-white shadow-md'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          <div className="font-bold flex items-center justify-between">
                            <span>Pelunasan Penuh</span>
                            <CheckCircle2
                              className={`w-4 h-4 ${
                                paymentMode === 'full' ? 'text-emerald-400' : 'text-slate-600'
                              }`}
                            />
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Bayar seluruh sisa ({formatMoney(modalPayInfo.remainingDebt)}) &rarr;{' '}
                            <span className="text-emerald-400 font-semibold">Lunas</span>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setPaymentMode('partial');
                            setPaymentAmountInput(Math.round(modalPayInfo.remainingDebt * 0.5));
                          }}
                          className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                            paymentMode === 'partial'
                              ? 'bg-amber-600/20 border-amber-500 text-white shadow-md'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          <div className="font-bold flex items-center justify-between">
                            <span>Bayar Sebagian / DP</span>
                            <Clock
                              className={`w-4 h-4 ${
                                paymentMode === 'partial' ? 'text-amber-400' : 'text-slate-600'
                              }`}
                            />
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Cicil sebagian tagihan &rarr;{' '}
                            <span className="text-amber-300 font-semibold">Hutang (Sisa)</span>
                          </div>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-slate-300 font-semibold block mb-1">
                          Nominal Pembayaran (Rp) *
                        </label>
                        <input
                          type="number"
                          min="1"
                          max={modalPayInfo.remainingDebt}
                          required
                          disabled={paymentMode === 'full'}
                          value={
                            paymentMode === 'full'
                              ? modalPayInfo.remainingDebt
                              : paymentAmountInput
                          }
                          onChange={(e) => setPaymentAmountInput(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono font-bold focus:outline-none focus:border-blue-500 disabled:opacity-75"
                        />
                        {currencyMode === 'USD' && (
                          <span className="text-[10px] text-blue-400 font-mono block mt-1">
                            &asymp;{' '}
                            {formatMoney(
                              paymentMode === 'full'
                                ? modalPayInfo.remainingDebt
                                : cleanInputAmount
                            )}{' '}
                            (Kurs Rp {exchangeRate.toLocaleString('id-ID')})
                          </span>
                        )}
                      </div>

                      <div>
                        <label className="text-slate-300 font-semibold block mb-1">
                          Metode Pembayaran
                        </label>
                        <select
                          value={paymentMethodInput}
                          onChange={(e) => setPaymentMethodInput(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                        >
                          <option value="Tunai">Tunai (Masuk Laci Kasir)</option>
                          <option value="COD">Setoran Tunai Kurir (COD)</option>
                          <option value="Transfer Bank (BCA)">Transfer Bank (BCA)</option>
                          <option value="QRIS">QRIS</option>
                          <option value="EDC / Debit">EDC / Kartu Debit</option>
                        </select>
                      </div>
                    </div>

                    {/* Projected Remaining Debt Preview */}
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          Status Setelah Pembayaran Ini:
                        </span>
                        <span
                          className={`font-bold text-xs ${
                            projectedRemaining <= 0 ? 'text-emerald-400' : 'text-amber-300'
                          }`}
                        >
                          {projectedRemaining <= 0
                            ? 'LUNAS (Sisa Hutang Rp 0)'
                            : `HUTANG • Bayar Sebagian (Sisa: ${formatMoney(projectedRemaining)})`}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-emerald-400 text-sm">
                        +
                        {formatMoney(
                          paymentMode === 'full' ? modalPayInfo.remainingDebt : cleanInputAmount
                        )}
                      </span>
                    </div>

                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">
                        Catatan Pembayaran (Opsional)
                      </label>
                      <input
                        type="text"
                        value={paymentNoteInput}
                        onChange={(e) => setPaymentNoteInput(e.target.value)}
                        placeholder="Contoh: Diterima tunai oleh kasir / setoran kurir..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => setPaymentModalOrder(null)}
                        className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        disabled={isSubmittingPayment}
                        className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold shadow-lg shadow-emerald-600/30 flex items-center gap-1.5 cursor-pointer"
                      >
                        {isSubmittingPayment ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                        <span>
                          {paymentMode === 'full' || projectedRemaining <= 0
                            ? 'Konfirmasi Lunas & Catat Kas'
                            : 'Simpan Pembayaran Sebagian'}
                        </span>
                      </button>
                    </div>
                  </form>
                )}

                {/* Payment History List inside Modal */}
                {Array.isArray(paymentModalOrder.paymentHistory) &&
                  paymentModalOrder.paymentHistory.length > 0 && (
                    <div className="pt-3 border-t border-slate-800 space-y-2">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">
                        Riwayat Pembayaran Tercatat ({paymentModalOrder.paymentHistory.length})
                      </span>
                      <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                        {paymentModalOrder.paymentHistory.map((ph) => (
                          <div
                            key={ph.id}
                            className="flex items-center justify-between text-xs bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl"
                          >
                            <div>
                              <div className="font-semibold text-white">
                                {ph.method}{' '}
                                <span className="text-[10px] text-slate-400 font-normal">
                                  &bull; {formatFullDateTime(ph.date)}
                                </span>
                              </div>
                              {ph.note && (
                                <div className="text-[11px] text-slate-400">{ph.note}</div>
                              )}
                            </div>
                            <span className="font-mono font-bold text-emerald-400">
                              +{formatMoney(ph.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            </div>
          );
        })()}
    </div>
  );
};
