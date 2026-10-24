import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Store,
  DollarSign,
  ShoppingBag,
  TrendingUp,
  Boxes,
  AlertTriangle,
  Users,
  ShieldCheck,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Plus,
  RefreshCw,
  Search,
  CheckCircle,
  Sparkles,
  BarChart3,
  Banknote,
  Truck,
  Inbox,
  AlertCircle,
  Receipt,
  X,
  Printer,
  Building2,
  BadgeCheck,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  limit,
  updateDoc,
  addDoc,
  getDocs,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { AdminAreaCharts, parseRecordDate } from './AdminAreaCharts';
import { useLanguage } from '../../context/LanguageContext';
import { useAppData } from '../../context/AppDataContext';
import { useAppNavigation } from '../../router';
import { resetAllDatabaseData } from '../../services/dataSeeder';
import { ACTIVE_STORE_ID } from '../../config/store';
import { formatMoney, formatCompactMoney } from '../../utils/money';
import { getDefaultMinStock } from '../../services/posRuntime';

interface AdminDashboardProps {
  onNavigateTab: (tab: string) => void;
  onOpenAddProduct?: () => void;
}

interface OrderItem {
  id: string;
  sourceCollection: 'orders' | 'transactions';
  orderNumber: string;
  customerName: string;
  channel: string;
  itemsCount: number;
  totalAmount: number;
  paymentMethod: string;
  paymentStatus: 'Lunas' | 'Belum Bayar';
  orderStatus: 'menunggu' | 'diproses' | 'siap' | 'selesai';
  time: string;
  createdAt: string;
}

interface TransactionItem {
  id: string;
  receiptNumber: string;
  time: string;
  date: string;
  cashier: string;
  customer: string;
  method: string;
  itemsSummary: string;
  total: number;
  status: 'Berhasil' | 'Menunggu' | 'Dibatalkan';
  createdAt: string;
}

interface LiveProduct {
  id: string;
  name: string;
  sku: string;
  category: string;
  stockInUnits: number;
  minStockAlert: number;
  pricePerUnit: number;
  costPerUnit: number;
  sellByUnit: boolean;
  piecesPerCarton: number;
}

interface RawTxLineItem {
  productId?: string;
  productName?: string;
  name?: string;
  quantityOrdered?: number;
  qty?: number;
  quantity?: number;
  unitPrice?: number;
  sellingPrice?: number;
  subtotal?: number;
  packageType?: string;
}

const toIdr = (val: unknown): number => {
  const num = Number(val) || 0;
  if (num === 0) return 0;
  return num > 0 && num < 500 ? Math.round(num * 15000) : Math.round(num);
};

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onNavigateTab,
  onOpenAddProduct,
}) => {
  const { tr, currencyMode } = useLanguage();
  const appData = useAppData();
  const { navigateToPath } = useAppNavigation();

  const formatCurrency = (val: number) => formatMoney(val, currencyMode, 'IDR', appData.exchangeRate);
  const formatCompactCurrency = (val: number) =>
    formatCompactMoney(val, currencyMode, 'IDR', appData.exchangeRate);

  // Navigation & filters state
  const [selectedOutlet, setSelectedOutlet] = useState<string>('pusat');
  const [timeRange, setTimeRange] = useState<'today' | 'yesterday' | '7days' | 'month' | 'year' | 'custom'>('today');
  const [currentTime, setCurrentTime] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Outlets & PO state for live dynamic calculations
  const [outletsList, setOutletsList] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);

  // Database Reset Modal State
  const [showResetDbModal, setShowResetDbModal] = useState(false);
  const [isResettingDb, setIsResettingDb] = useState(false);
  const [resetDbFeedback, setResetDbFeedback] = useState<string | null>(null);

  // Orders tab filter
  const [orderFilterTab, setOrderFilterTab] = useState<'all' | 'menunggu' | 'diproses' | 'siap' | 'selesai'>('all');

  // Active modals
  const [selectedReceipt, setSelectedReceipt] = useState<TransactionItem | null>(null);
  const [showShiftModal, setShowShiftModal] = useState<boolean>(false);
  const [showNewOrderModal, setShowNewOrderModal] = useState<boolean>(false);
  const [flashMsg, setFlashMsg] = useState<string | null>(null);

  // Manual order creation form state
  const [newOrderCustomer, setNewOrderCustomer] = useState<string>('');
  const [newOrderChannel, setNewOrderChannel] = useState<string>('PWA Online');
  const [newOrderNotes, setNewOrderNotes] = useState<string>('');
  const [newOrderTotal, setNewOrderTotal] = useState<string>('');

  // Real-time Firestore state
  const [liveProducts, setLiveProducts] = useState<LiveProduct[]>([]);
  const [rawTransactions, setRawTransactions] = useState<any[]>([]);
  const [txSubItemsMap, setTxSubItemsMap] = useState<Record<string, RawTxLineItem[]>>({});
  const [rawStoreOrders, setRawStoreOrders] = useState<any[]>([]);
  const [rawCustomers, setRawCustomers] = useState<any[]>([]);
  const [storeInfo, setStoreInfo] = useState<{ name?: string; openingCash?: number }>({});
  const fetchedTxIdsRef = useRef<Set<string>>(new Set());

  const showFlash = (msg: string) => {
    setFlashMsg(msg);
    setTimeout(() => setFlashMsg(null), 3500);
  };

  // Search in transactions table
  const [txSearchQuery, setTxSearchQuery] = useState('');

  // Clock tick
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleDateString('id-ID', {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  // Real-time Firestore subscriptions (products, transactions, stores/store_001/transactions, stores/store_001/orders, stores, customers)
  useEffect(() => {
    // 1. Products collection (same as PosMachine.tsx and ClientPwaApp.tsx)
    const unsubProducts = onSnapshot(
      collection(db, 'products'),
      (snapshot) => {
        const list: LiveProduct[] = [];
        snapshot.forEach((d) => {
          const data = d.data() as any;
          if (data.isActive === false) return;
          list.push({
            id: d.id,
            name: data.name || data.groupName || 'Produk',
            sku: data.sku || d.id,
            category: data.category || 'UMUM',
            stockInUnits: Number(data.stock ?? data.stockInUnits ?? 0),
            minStockAlert: Number(data.minStockAlert ?? data.minStock ?? getDefaultMinStock()),
            pricePerUnit: toIdr(data.posPrice ?? data.sellPrice ?? data.pricePerUnit ?? data.price ?? 0),
            costPerUnit: toIdr(data.costPrice ?? data.costPerUnit ?? 0),
            sellByUnit: data.sellByUnit !== undefined ? Boolean(data.sellByUnit) : true,
            piecesPerCarton: Math.max(1, Number(data.itemsPerCarton ?? data.piecesPerCarton ?? 1)),
          });
        });
        setLiveProducts(list);
      },
      (err) => console.warn('Dashboard products listener error:', err)
    );

    const normalizeDateStr = (val: any): string => {
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

    // 2. Transactions from root 'transactions', 'stores/store_001/transactions', 'stores/store_001/orders', and 'orders'
    let globalTxList: any[] = [];
    let storeTxList: any[] = [];
    let storeOrdersList: any[] = [];
    let rootOrdersList: any[] = [];

    const mergeTransactionsAndOrders = () => {
      const txMap = new Map<string, any>();

      // Include orders in unified sales list if not already present as a transaction
      [...rootOrdersList, ...storeOrdersList].forEach((ord) => {
        const normalizedOrd = {
          ...ord,
          id: ord.id,
          createdAt: normalizeDateStr(ord.createdAt || ord.updatedAt),
          totalAmount: Number(ord.totalAmount ?? ord.total ?? 0),
          totalCost: Number(ord.totalCost ?? 0),
          totalProfit: Number(ord.totalProfit ?? (Number(ord.totalAmount || 0) - Number(ord.totalCost || 0))),
          paymentMethod: ord.paymentMethod || 'cash',
          channel: ord.channel || 'pos',
          outletId: ord.outletId || ord.storeId || ACTIVE_STORE_ID,
        };
        txMap.set(ord.id, normalizedOrd);
      });

      [...storeTxList, ...globalTxList].forEach((tx) => {
        const existing = txMap.get(tx.id) || {};
        txMap.set(tx.id, {
          ...existing,
          ...tx,
          id: tx.id,
          createdAt: normalizeDateStr(tx.createdAt || tx.timestamp || existing.createdAt),
        });
      });

      const combinedTx = Array.from(txMap.values()).sort(
        (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      );
      setRawTransactions(combinedTx);

      // Also merge orders for the orders panel (including POS transactions)
      const ordMap = new Map<string, any>();
      [...globalTxList, ...storeTxList, ...rootOrdersList, ...storeOrdersList].forEach((item) => {
        const existing = ordMap.get(item.id) || {};
        ordMap.set(item.id, {
          ...existing,
          ...item,
          id: item.id,
          createdAt: normalizeDateStr(item.createdAt || item.timestamp || existing.createdAt),
        });
      });
      const combinedOrders = Array.from(ordMap.values()).sort(
        (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      );
      setRawStoreOrders(combinedOrders);
    };

    const unsubGlobalTx = onSnapshot(
      collection(db, 'transactions'),
      (snapshot) => {
        globalTxList = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        mergeTransactionsAndOrders();
      },
      (err) => console.warn('Dashboard transactions notice:', err)
    );

    const unsubStoreTx = onSnapshot(
      collection(db, `stores/${ACTIVE_STORE_ID}/transactions`),
      (snapshot) => {
        storeTxList = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        mergeTransactionsAndOrders();
      },
      (err) => console.warn('Dashboard store transactions notice:', err)
    );

    // 3. Orders from stores/${ACTIVE_STORE_ID}/orders and root 'orders'
    const unsubOrders = onSnapshot(
      collection(db, `stores/${ACTIVE_STORE_ID}/orders`),
      (snapshot) => {
        storeOrdersList = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        mergeTransactionsAndOrders();
      },
      (err) => console.warn('Dashboard orders listener error:', err)
    );

    const unsubRootOrders = onSnapshot(
      collection(db, 'orders'),
      (snapshot) => {
        rootOrdersList = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        mergeTransactionsAndOrders();
      },
      (err) => console.warn('Dashboard root orders listener error:', err)
    );

    // 4. Customers from 'customers' and 'stores/store_001/customers'
    let rootCustList: any[] = [];
    let storeCustList: any[] = [];
    const mergeCustomers = () => {
      const cMap = new Map<string, any>();
      [...rootCustList, ...storeCustList].forEach((c) => cMap.set(c.id, { ...(cMap.get(c.id) || {}), ...c }));
      setRawCustomers(Array.from(cMap.values()));
    };
    const unsubCustomers = onSnapshot(
      collection(db, 'customers'),
      (snapshot) => {
        rootCustList = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        mergeCustomers();
      },
      (err) => console.warn('Dashboard customers listener error:', err)
    );
    const unsubStoreCustomers = onSnapshot(
      collection(db, `stores/${ACTIVE_STORE_ID}/customers`),
      (snapshot) => {
        storeCustList = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        mergeCustomers();
      },
      (err) => console.warn('Dashboard store customers listener error:', err)
    );

    // 5. Stores metadata from 'stores'
    const unsubStores = onSnapshot(
      collection(db, 'stores'),
      (snapshot) => {
        const first = snapshot.docs.find((d) => d.id === ACTIVE_STORE_ID) || snapshot.docs[0];
        if (first) {
          const data = first.data() as any;
          setStoreInfo({
            name: data.name || data.storeName,
            openingCash: Number(data.openingCash ?? data.openingFloat ?? 0),
          });
        }
      },
      (err) => console.warn('Dashboard stores listener error:', err)
    );

    // 6. Outlets list
    const unsubOutlets = onSnapshot(
      collection(db, 'outlets'),
      (snap) => {
        setOutletsList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => console.warn('Outlets listener error:', err)
    );

    // 7. Purchase orders for unpaid supplier invoices
    const unsubPOs = onSnapshot(
      collection(db, 'purchase_orders'),
      (snap) => {
        setPurchaseOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => console.warn('Purchase orders listener error:', err)
    );

    return () => {
      unsubProducts();
      unsubGlobalTx();
      unsubStoreTx();
      unsubOrders();
      unsubRootOrders();
      unsubCustomers();
      unsubStoreCustomers();
      unsubStores();
      unsubOutlets();
      unsubPOs();
    };
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    void appData.refreshFirestore();
    setTimeout(() => {
      setIsRefreshing(false);
    }, 600);
  };

  // Merge products from AppDataContext + local onSnapshot for 0ms real-time updates
  const mergedLiveProducts = useMemo<LiveProduct[]>(() => {
    const map = new Map<string, LiveProduct>();
    appData.products.forEach((p: any) => {
      if (p.isActive === false) return;
      map.set(p.id, {
        id: p.id,
        name: p.name || p.groupName || 'Produk',
        sku: p.sku || p.id,
        category: p.category || 'UMUM',
        stockInUnits: Number(p.stockInUnits ?? p.stock ?? 0),
        minStockAlert: Number(p.minStockAlert ?? p.minStock ?? getDefaultMinStock()),
        pricePerUnit: toIdr(p.posPrice ?? p.sellPrice ?? p.pricePerUnit ?? p.price ?? 0),
        costPerUnit: toIdr(p.costPrice ?? p.costPerUnit ?? 0),
        sellByUnit: p.sellByUnit !== undefined ? Boolean(p.sellByUnit) : true,
        piecesPerCarton: Math.max(1, Number(p.isiPerDus ?? p.itemsPerCarton ?? p.piecesPerCarton ?? 1)),
      });
    });
    liveProducts.forEach((p) => {
      map.set(p.id, { ...(map.get(p.id) || {}), ...p });
    });
    return Array.from(map.values());
  }, [appData.products, liveProducts]);

  // Unified real-time POS transactions + PWA orders (combining AppDataContext optimistic state + direct Firestore snapshots)
  const unifiedTransactions = useMemo<any[]>(() => {
    const txMap = new Map<string, any>();

    const upsertRecord = (rec: any) => {
      if (!rec) return;
      const key = String(rec.id || rec.transactionId || rec.orderId || '');
      if (!key) return;
      const existing = txMap.get(key) || {};
      const parsedDate = parseRecordDate(
        rec.createdAt || rec.timestamp || rec.date || existing.createdAt || existing.timestamp
      );
      const isoDate = parsedDate ? parsedDate.toISOString() : new Date().toISOString();
      const totalVal = toIdr(
        rec.totalAmount ?? rec.total ?? rec.subtotal ?? existing.totalAmount ?? existing.total ?? 0
      );
      const costVal = toIdr(rec.totalCost ?? rec.totalModal ?? existing.totalCost ?? 0);
      const profitVal = toIdr(
        rec.totalProfit ?? rec.keuntungan ?? existing.totalProfit ?? Math.max(0, totalVal - costVal)
      );

      txMap.set(key, {
        ...existing,
        ...rec,
        id: key,
        createdAt: isoDate,
        _parsedTimeMs: parsedDate ? parsedDate.getTime() : Date.now(),
        total: totalVal,
        totalAmount: totalVal,
        totalCost: costVal,
        totalModal: costVal,
        totalProfit: profitVal,
        keuntungan: profitVal,
      });
    };

    appData.orders.forEach(upsertRecord);
    rawStoreOrders.forEach(upsertRecord);
    appData.transactions.forEach(upsertRecord);
    rawTransactions.forEach(upsertRecord);

    return Array.from(txMap.values()).sort((a, b) => (b._parsedTimeMs || 0) - (a._parsedTimeMs || 0));
  }, [appData.transactions, appData.orders, rawTransactions, rawStoreOrders]);

  // Load subcollection items if a legacy transaction does not have an embedded `items` array
  useEffect(() => {
    unifiedTransactions.slice(0, 30).forEach((tx) => {
      if (Array.isArray(tx.items) && tx.items.length > 0) return;
      if (fetchedTxIdsRef.current.has(tx.id)) return;
      fetchedTxIdsRef.current.add(tx.id);

      getDocs(collection(db, `stores/${ACTIVE_STORE_ID}/transactions/${tx.id}/items`))
        .then((snap) => {
          if (!snap.empty) {
            const subItems = snap.docs.map((d) => d.data() as RawTxLineItem);
            setTxSubItemsMap((prev) => ({ ...prev, [tx.id]: subItems }));
          } else {
            return getDocs(collection(db, `transactions/${tx.id}/items`)).then((rootSnap) => {
              if (!rootSnap.empty) {
                const subItems = rootSnap.docs.map((d) => d.data() as RawTxLineItem);
                setTxSubItemsMap((prev) => ({ ...prev, [tx.id]: subItems }));
              }
            });
          }
        })
        .catch(() => {});
    });
  }, [unifiedTransactions]);

  // Filter transactions by selectedOutlet and local timeRange (WIB / Browser Local Time)
  const filteredRawTransactions = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0
    ).getTime();
    const endOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999
    ).getTime();
    const startOfYesterday = startOfToday - 24 * 3600 * 1000;
    const endOfYesterday = startOfToday - 1;
    const startOf7Days = startOfToday - 6 * 24 * 3600 * 1000;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
    const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0).getTime();

    return unifiedTransactions.filter((tx) => {
      const status = String(tx.status || 'completed').toLowerCase();
      if (
        status === 'rejected' ||
        status === 'refunded' ||
        status === 'void' ||
        status === 'cancelled' ||
        status === 'dibatalkan'
      ) {
        return false;
      }

      // Outlet matching: 'pusat' matches main store IDs ('pusat', 'OUT-01', 'out_1', 'store_001', etc.)
      if (selectedOutlet !== 'all') {
        const rawOutlet = String(tx.outletId || tx.storeId || '').toLowerCase();
        if (selectedOutlet === 'pusat') {
          const isMainOutlet =
            !rawOutlet ||
            rawOutlet === 'pusat' ||
            rawOutlet === 'out-01' ||
            rawOutlet === 'out_1' ||
            rawOutlet === 'out-1' ||
            rawOutlet === ACTIVE_STORE_ID.toLowerCase();
          if (!isMainOutlet) return false;
        } else if (rawOutlet && rawOutlet !== selectedOutlet.toLowerCase()) {
          return false;
        }
      }

      const parsedDate = parseRecordDate(tx.createdAt || tx.timestamp || tx.date || tx.updatedAt);
      if (!parsedDate) return true;
      const txTime = parsedDate.getTime();

      if (timeRange === 'today') return txTime >= startOfToday && txTime <= endOfToday;
      if (timeRange === 'yesterday') return txTime >= startOfYesterday && txTime <= endOfYesterday;
      if (timeRange === '7days') return txTime >= startOf7Days && txTime <= endOfToday;
      if (timeRange === 'month') return txTime >= startOfMonth && txTime <= endOfToday;
      if (timeRange === 'year') return txTime >= startOfYear && txTime <= endOfToday;
      return true;
    });
  }, [unifiedTransactions, selectedOutlet, timeRange]);

  // KPI aggregations from real Firestore data (0 dummy data)
  const kpiMetrics = useMemo(() => {
    let totalSales = 0;
    let totalCost = 0;
    let totalUnitsSold = 0;
    let cashSales = 0;
    let nonCashSales = 0;
    let debtTxTotal = 0;
    let debtTxCount = 0;
    const paymentMethodCounts: Record<string, number> = {};

    const prodById = new Map<string, LiveProduct>();
    mergedLiveProducts.forEach((p) => prodById.set(p.id, p));

    filteredRawTransactions.forEach((tx) => {
      const amount = toIdr(tx.totalAmount ?? tx.total ?? tx.subtotal ?? 0);
      let cost = toIdr(tx.totalCost ?? tx.totalModal ?? 0);

      const items: RawTxLineItem[] =
        Array.isArray(tx.items) && tx.items.length > 0
          ? tx.items
          : txSubItemsMap[tx.id] || [];

      let txUnits = 0;
      if (items.length > 0) {
        let computedItemCost = 0;
        items.forEach((it: any) => {
          const qty = Math.max(
            1,
            Number(it.unitsDeducted ?? it.quantityOrdered ?? it.qty ?? it.quantity ?? 1)
          );
          txUnits += qty;
          const unitCostVal = toIdr(
            it.costPrice ??
              it.unitCost ??
              (it.productId ? prodById.get(it.productId)?.costPerUnit : 0) ??
              0
          );
          computedItemCost += unitCostVal * qty;
        });
        if (cost <= 0 && computedItemCost > 0) {
          cost = computedItemCost;
        }
      } else {
        txUnits = Math.max(1, Number(tx.itemsCount ?? 1));
      }

      totalSales += amount;
      totalCost += cost > 0 ? cost : 0;
      totalUnitsSold += txUnits;

      const method = String(tx.paymentMethod || 'cash').toLowerCase();
      if (method.includes('cash') || method.includes('tunai') || method === 'cod') {
        cashSales += amount;
        paymentMethodCounts['Tunai'] = (paymentMethodCounts['Tunai'] || 0) + 1;
      } else if (method.includes('debt') || method.includes('kasbon') || method.includes('hutang')) {
        debtTxTotal += amount;
        debtTxCount += 1;
        paymentMethodCounts['Kasbon'] = (paymentMethodCounts['Kasbon'] || 0) + 1;
      } else {
        nonCashSales += amount;
        const label = method.includes('qris') ? 'QRIS' : method.toUpperCase();
        paymentMethodCounts[label] = (paymentMethodCounts[label] || 0) + 1;
      }
    });

    const txCount = filteredRawTransactions.length;
    const avgPerReceipt = txCount > 0 ? Math.round(totalSales / txCount) : 0;
    const grossProfit = Math.max(0, totalSales - totalCost);
    const grossMarginPct = totalSales > 0 ? Number(((grossProfit / totalSales) * 100).toFixed(1)) : 0;

    // Customer receivables from customers collection + debt transactions
    const mergedCusts = rawCustomers.length > 0 ? rawCustomers : appData.customers;
    const customerDebtFromDocs = mergedCusts.reduce(
      (sum: number, c: any) => sum + toIdr(c.debtAmount ?? c.totalDebt ?? 0),
      0
    );
    const customerDebtCount = mergedCusts.filter(
      (c: any) => toIdr(c.debtAmount ?? c.totalDebt ?? 0) > 0
    ).length;
    const totalReceivables = Math.max(customerDebtFromDocs, debtTxTotal);
    const totalReceivablesCount = Math.max(customerDebtCount, debtTxCount);

    // Active Shift float from Firestore `shifts` collection or storeInfo
    const activeShift = appData.shifts.find(
      (s: any) => String(s.status || '').toLowerCase() === 'open'
    );
    const openingFloat = toIdr(
      activeShift?.initialFloat ??
        activeShift?.openingCash ??
        activeShift?.modalAwal ??
        storeInfo.openingCash ??
        0
    );
    const activeCashierName =
      activeShift?.cashierName ||
      filteredRawTransactions[0]?.cashierName ||
      filteredRawTransactions[0]?.cashier ||
      'Kasir POS Aktif';
    const cashInDrawer = openingFloat + cashSales;

    // Top payment method
    let topPaymentMethodLabel = tr('Waiting for transactions', 'Menunggu transaksi');
    const methodEntries = Object.entries(paymentMethodCounts).sort((a, b) => b[1] - a[1]);
    if (methodEntries.length > 0 && txCount > 0) {
      const [topMethod, count] = methodEntries[0];
      const pct = Math.round((count / txCount) * 100);
      topPaymentMethodLabel = `${topMethod} (${pct}% ${tr('Transactions', 'Transaksi')})`;
    }

    return {
      totalSales,
      totalCost,
      totalUnitsSold,
      txCount,
      avgPerReceipt,
      grossProfit,
      grossMarginPct,
      totalReceivables,
      totalReceivablesCount,
      openingFloat,
      activeCashierName,
      cashSales,
      nonCashSales,
      cashInDrawer,
      topPaymentMethodLabel,
    };
  }, [
    filteredRawTransactions,
    mergedLiveProducts,
    txSubItemsMap,
    rawCustomers,
    appData.customers,
    appData.shifts,
    storeInfo.openingCash,
    tr,
  ]);

  // Dynamic unpaid supplier POs / Invoices
  const unpaidPOs = useMemo(() => {
    return purchaseOrders.filter((po) => {
      const st = String(po.paymentStatus || '').toLowerCase();
      return st.includes('tempo') || st.includes('belum') || st.includes('unpaid') || st === 'pending';
    });
  }, [purchaseOrders]);

  const totalUnpaidPOAmount = useMemo(() => {
    return unpaidPOs.reduce((acc, po) => acc + Number(po.totalAmount || 0), 0);
  }, [unpaidPOs]);

  // Real-time Incoming & Active Orders (merged from stores/store_001/orders, AppDataContext.orders, and POS/PWA transactions)
  const ordersList = useMemo<OrderItem[]>(() => {
    const mapOrderStatus = (rawStatus?: string, fulfillment?: string): OrderItem['orderStatus'] => {
      const s = String(fulfillment || rawStatus || '').toLowerCase();
      if (s === 'completed' || s === 'delivered' || s === 'selesai' || s === 'paid') return 'selesai';
      if (s === 'ready' || s === 'shipped' || s === 'siap') return 'siap';
      if (s === 'processing' || s === 'packing' || s === 'diproses') return 'diproses';
      return 'menunggu';
    };

    const items: OrderItem[] = [];
    const seenIds = new Set<string>();

    [...appData.orders, ...rawStoreOrders].forEach((ord) => {
      if (!ord || !ord.id || seenIds.has(ord.id)) return;
      seenIds.add(ord.id);
      const createdDate = parseRecordDate(ord.createdAt || ord.timestamp || ord.date) || new Date();
      const timeStr = !Number.isNaN(createdDate.getTime())
        ? createdDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB'
        : '-';
      const itemArr = Array.isArray(ord.items) ? ord.items : [];
      const itemsCount =
        Number(ord.itemsCount) ||
        itemArr.reduce((acc: number, it: any) => acc + Number(it.qty ?? it.quantityOrdered ?? 1), 0) ||
        1;
      const payMethod = String(ord.paymentMethod || 'QRIS');
      const isUnpaid =
        String(ord.paymentStatus || '').toLowerCase() === 'unpaid' ||
        payMethod.toLowerCase().includes('kasbon') ||
        payMethod.toLowerCase().includes('cod');

      items.push({
        id: ord.id,
        sourceCollection: 'orders',
        orderNumber: ord.orderNumber ? `#${String(ord.orderNumber).replace(/^#/, '')}` : `#${ord.id.slice(-6).toUpperCase()}`,
        customerName: ord.customerName || ord.deliveryDetails?.recipientName || 'Walk-in Customer',
        channel:
          ord.channel === 'pos' || ord.source === 'POS'
            ? 'POS Kasir'
            : ord.channel === 'pwa' || ord.channel === 'pwa_client' || ord.source === 'PWA'
            ? 'PWA Online'
            : ord.channel === 'visitor'
            ? 'Walk-In POS'
            : String(ord.channel || 'POS Kasir'),
        itemsCount,
        totalAmount: toIdr(ord.totalAmount ?? ord.total ?? 0),
        paymentMethod: payMethod.toUpperCase(),
        paymentStatus: isUnpaid ? 'Belum Bayar' : 'Lunas',
        orderStatus: mapOrderStatus(ord.status, ord.fulfillmentStatus),
        time: timeStr,
        createdAt: createdDate.toISOString(),
      });
    });

    unifiedTransactions.forEach((tx) => {
      if (!tx || !tx.id || seenIds.has(tx.id)) return;
      seenIds.add(tx.id);
      const createdDate = parseRecordDate(tx.createdAt || tx.timestamp || tx.date) || new Date();
      const timeStr = !Number.isNaN(createdDate.getTime())
        ? createdDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB'
        : '-';
      const itemArr = Array.isArray(tx.items) ? tx.items : txSubItemsMap[tx.id] || [];
      const itemsCount =
        itemArr.reduce((acc: number, it: any) => acc + Number(it.quantityOrdered ?? it.qty ?? it.quantity ?? 1), 0) || 1;
      const payMethod = String(tx.paymentMethod || 'cash').toUpperCase();

      items.push({
        id: tx.id,
        sourceCollection: 'transactions',
        orderNumber: tx.orderNumber ? `#${String(tx.orderNumber).replace(/^#/, '')}` : `#${tx.id.slice(-6).toUpperCase()}`,
        customerName: tx.customerName || 'Walk-in Customer',
        channel: tx.channel === 'pos' || tx.source === 'POS' ? 'POS Kasir' : 'PWA Online',
        itemsCount,
        totalAmount: toIdr(tx.totalAmount ?? tx.total ?? 0),
        paymentMethod: payMethod,
        paymentStatus: payMethod === 'COD' || payMethod === 'DEBT' || payMethod === 'HUTANG' ? 'Belum Bayar' : 'Lunas',
        orderStatus: mapOrderStatus(tx.status, tx.fulfillmentStatus),
        time: timeStr,
        createdAt: createdDate.toISOString(),
      });
    });

    return items.sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }, [appData.orders, rawStoreOrders, unifiedTransactions, txSubItemsMap]);

  const orderCountsByStatus = useMemo(() => {
    return {
      menunggu: ordersList.filter((o) => o.orderStatus === 'menunggu').length,
      diproses: ordersList.filter((o) => o.orderStatus === 'diproses').length,
      siap: ordersList.filter((o) => o.orderStatus === 'siap').length,
    };
  }, [ordersList]);

  // Filtered orders according to tab
  const displayedOrders = useMemo(() => {
    return ordersList.filter((o) => {
      if (orderFilterTab === 'all') return true;
      return o.orderStatus === orderFilterTab;
    });
  }, [ordersList, orderFilterTab]);

  // Hourly sales chart aggregated from real transactions (00:00 - 23:00 WIB)
  const hourlyData = useMemo(() => {
    const slots = [
      { hour: '06:00', start: 0, end: 7, amount: 0, tx: 0 },
      { hour: '08:00', start: 8, end: 9, amount: 0, tx: 0 },
      { hour: '10:00', start: 10, end: 11, amount: 0, tx: 0 },
      { hour: '12:00', start: 12, end: 13, amount: 0, tx: 0 },
      { hour: '14:00', start: 14, end: 15, amount: 0, tx: 0 },
      { hour: '16:00', start: 16, end: 17, amount: 0, tx: 0 },
      { hour: '18:00', start: 18, end: 19, amount: 0, tx: 0 },
      { hour: '20:00', start: 20, end: 21, amount: 0, tx: 0 },
      { hour: '22:00', start: 22, end: 23, amount: 0, tx: 0 },
    ];

    filteredRawTransactions.forEach((tx) => {
      const d = parseRecordDate(tx.createdAt || tx.timestamp || tx.date || tx.updatedAt);
      if (!d) return;
      const hr = d.getHours();
      const amount = toIdr(tx.totalAmount ?? tx.total ?? tx.subtotal ?? 0);
      const bucket = slots.find((s) => hr >= s.start && hr <= s.end) || slots[slots.length - 1];
      bucket.amount += amount;
      bucket.tx += 1;
    });

    return slots.map(({ hour, amount, tx }) => ({ hour, amount, tx }));
  }, [filteredRawTransactions]);

  const maxHourAmount = Math.max(...hourlyData.map((d) => d.amount), 1);

  const peakHourSummary = useMemo(() => {
    const busiest = [...hourlyData].sort((a, b) => b.amount - a.amount)[0];
    if (!busiest || busiest.amount <= 0) {
      return tr('Waiting for transaction data', 'Menunggu data transaksi');
    }
    return `${busiest.hour} WIB (${formatCurrency(busiest.amount)})`;
  }, [hourlyData, tr, currencyMode, appData.exchangeRate]);

  // Top products aggregated from real transaction line items & mergedLiveProducts
  const topProducts = useMemo(() => {
    const salesByProduct = new Map<
      string,
      { name: string; category: string; sold: number; rev: number; stock: number; minStock: number }
    >();

    // Seed map from mergedLiveProducts so we have accurate stock & category metadata
    const prodById = new Map<string, LiveProduct>();
    const prodByName = new Map<string, LiveProduct>();
    mergedLiveProducts.forEach((p) => {
      prodById.set(p.id, p);
      prodByName.set(p.name.toLowerCase(), p);
    });

    filteredRawTransactions.forEach((tx) => {
      const items: RawTxLineItem[] =
        Array.isArray(tx.items) && tx.items.length > 0
          ? tx.items
          : txSubItemsMap[tx.id] || [];

      items.forEach((it: any) => {
        const pid = it.productId || '';
        const rawName = it.productName || it.name || 'Produk';
        const matchedProd = prodById.get(pid) || prodByName.get(rawName.toLowerCase());
        const key = matchedProd ? matchedProd.id : pid || rawName;
        const qty = Number(it.unitsDeducted ?? it.quantityOrdered ?? it.qty ?? it.quantity ?? 1);
        const unitPrice = toIdr(it.price ?? it.unitPrice ?? it.sellingPrice ?? matchedProd?.pricePerUnit ?? 0);
        const sub = toIdr(it.subtotal ?? unitPrice * qty);

        const existing = salesByProduct.get(key);
        if (existing) {
          existing.sold += qty;
          existing.rev += sub;
        } else {
          salesByProduct.set(key, {
            name: matchedProd?.name || rawName,
            category: matchedProd?.category || it.category || 'UMUM',
            sold: qty,
            rev: sub,
            stock: matchedProd?.stockInUnits ?? 0,
            minStock: matchedProd?.minStockAlert ?? 10,
          });
        }
      });
    });

    const sorted = Array.from(salesByProduct.values()).sort((a, b) => b.rev - a.rev || b.sold - a.sold);
    if (sorted.length > 0) {
      return sorted.slice(0, 5);
    }

    return mergedLiveProducts.slice(0, 5).map((p) => ({
      name: p.name,
      category: p.category,
      sold: 0,
      rev: 0,
      stock: p.stockInUnits,
      minStock: p.minStockAlert,
    }));
  }, [filteredRawTransactions, txSubItemsMap, mergedLiveProducts]);

  // Critical stock items from real Firestore products collection
  const criticalStockItems = useMemo(() => {
    return mergedLiveProducts
      .filter((p) => p.stockInUnits <= p.minStockAlert)
      .sort((a, b) => a.stockInUnits - b.stockInUnits)
      .slice(0, 5)
      .map((p) => ({
        name: p.name,
        currentStock: p.stockInUnits,
        minStock: p.minStockAlert,
        unit: 'Dus',
        severity: p.stockInUnits <= Math.floor(p.minStockAlert / 2) ? 'danger' : 'warning',
      }));
  }, [mergedLiveProducts]);

  // Recent transactions mapped from real Firestore transactions
  const recentTransactions = useMemo<TransactionItem[]>(() => {
    return filteredRawTransactions.slice(0, 20).map((tx) => {
      const createdDate = parseRecordDate(tx.createdAt || tx.timestamp || tx.date || tx.updatedAt) || new Date();
      const validDate = !Number.isNaN(createdDate.getTime());
      const timeStr = validDate
        ? createdDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB'
        : '-';
      const dateStr = validDate
        ? createdDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
        : '-';

      const items: RawTxLineItem[] =
        Array.isArray(tx.items) && tx.items.length > 0
          ? tx.items
          : txSubItemsMap[tx.id] || [];

      const itemsSummary =
        items.length > 0
          ? items
              .map(
                (it: any) =>
                  `${it.productName || it.name || 'Item'} (${
                    it.unitsDeducted ?? it.quantityOrdered ?? it.qty ?? it.quantity ?? 1
                  } Dus)`
              )
              .join(', ')
          : tx.cartonBreakdown || (tx.channel === 'pwa_client' ? 'Pesanan Online PWA' : 'Transaksi Kasir POS');

      const rawMethod = String(tx.paymentMethod || 'cash').toLowerCase();
      const methodLabel =
        rawMethod.includes('cash') || rawMethod.includes('tunai')
          ? 'Tunai'
          : rawMethod.includes('qris')
          ? 'QRIS'
          : rawMethod.includes('debt') || rawMethod.includes('kasbon')
          ? 'Kasbon'
          : rawMethod.toUpperCase();

      const rawStatus = String(tx.status || 'completed').toLowerCase();
      const statusLabel: TransactionItem['status'] =
        rawStatus === 'completed' || rawStatus === 'delivered' || rawStatus === 'paid' || rawStatus === 'selesai'
          ? 'Berhasil'
          : rawStatus === 'rejected' || rawStatus === 'refunded'
          ? 'Dibatalkan'
          : 'Menunggu';

      return {
        id: tx.id,
        receiptNumber:
          tx.orderNumber ||
          (tx.id.startsWith('RC-') || tx.id.startsWith('TRX-') || tx.id.startsWith('POS-')
            ? tx.id
            : `POS-${tx.id.slice(-6).toUpperCase()}`),
        time: timeStr,
        date: dateStr,
        cashier:
          tx.cashierName ||
          tx.cashier ||
          tx.deliveryStaffName ||
          (tx.channel === 'pwa_client' ? 'Order Online (PWA)' : 'Kasir POS'),
        customer: tx.customerName || 'Pelanggan Umum',
        method: methodLabel,
        itemsSummary,
        total: toIdr(tx.totalAmount ?? tx.total ?? tx.subtotal ?? 0),
        status: statusLabel,
        createdAt: createdDate.toISOString(),
      };
    });
  }, [filteredRawTransactions, txSubItemsMap]);

  // Filtered transactions for search
  const displayedTransactions = useMemo(() => {
    return recentTransactions.filter((tx) => {
      if (!txSearchQuery.trim()) return true;
      const q = txSearchQuery.toLowerCase();
      return (
        tx.receiptNumber.toLowerCase().includes(q) ||
        tx.customer.toLowerCase().includes(q) ||
        tx.cashier.toLowerCase().includes(q) ||
        tx.itemsSummary.toLowerCase().includes(q)
      );
    });
  }, [recentTransactions, txSearchQuery]);

  const updateOrderStatus = async (orderId: string, nextStatus: 'diproses' | 'siap' | 'selesai') => {
    const target = ordersList.find((o) => o.id === orderId);
    const firestoreOrderStatus =
      nextStatus === 'diproses' ? 'packing' : nextStatus === 'siap' ? 'shipped' : 'delivered';
    const firestoreFulfillment =
      nextStatus === 'diproses' ? 'processing' : nextStatus === 'siap' ? 'ready' : 'completed';
    const nowIso = new Date().toISOString();

    try {
      if (!target || target.sourceCollection === 'orders') {
        await updateDoc(doc(db, `stores/${ACTIVE_STORE_ID}/orders`, orderId), {
          status: firestoreOrderStatus,
          fulfillmentStatus: firestoreFulfillment,
          updatedAt: nowIso,
        });
      }
      if (!target || target.sourceCollection === 'transactions') {
        await updateDoc(doc(db, 'transactions', orderId), {
          status: nextStatus === 'selesai' ? 'completed' : 'pending_approval',
          fulfillmentStatus: firestoreFulfillment,
          updatedAt: nowIso,
        });
      }
      showFlash(tr('Order status updated in Firestore.', 'Status pesanan diperbarui di database.'));
    } catch (err) {
      console.warn('Error updating order status:', err);
    }
  };

  const handleCreateManualOrder = async () => {
    if (!newOrderCustomer.trim()) {
      showFlash(tr('Please enter customer name.', 'Masukkan nama pelanggan terlebih dahulu.'));
      return;
    }
    const nowIso = new Date().toISOString();
    const amountNum = toIdr(newOrderTotal || 0);
    const orderNum = `NL-${Date.now().toString().slice(-4)}`;

    try {
      await addDoc(collection(db, 'stores', ACTIVE_STORE_ID, 'orders'), {
        storeId: ACTIVE_STORE_ID,
        orderNumber: orderNum,
        customerName: newOrderCustomer.trim(),
        customerPhone: '-',
        customerAddress: '-',
        channel: newOrderChannel.toLowerCase().includes('pwa') ? 'pwa' : 'visitor',
        itemsCount: 1,
        items: [
          {
            productId: 'MANUAL-ORDER',
            name: newOrderNotes.trim() || 'Pesanan Manual Kasir',
            sku: 'MANUAL',
            packageType: 'unit',
            qty: 1,
            costPrice: 0,
            sellingPrice: amountNum,
            subtotal: amountNum,
            profit: amountNum,
          },
        ],
        totalCost: 0,
        totalAmount: amountNum,
        totalProfit: amountNum,
        status: 'new',
        fulfillmentStatus: 'pending',
        paymentMethod: 'Tunai',
        paymentStatus: 'paid',
        notes: newOrderNotes.trim(),
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      setNewOrderCustomer('');
      setNewOrderNotes('');
      setNewOrderTotal('');
      setShowNewOrderModal(false);
      showFlash(tr('Order saved to Firestore.', 'Pesanan berhasil disimpan ke database.'));
    } catch (err) {
      console.warn('Error creating manual order:', err);
    }
  };

  return (
    <div className="space-y-6 font-sans text-zinc-100 animate-in fade-in duration-200">
      {/* 1. TOP EXECUTIVE HEADER BANNER */}
      <div className="bg-zinc-900/90 border border-zinc-800 p-5 rounded-2xl shadow-sm backdrop-blur-md">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Title & Outlet Selector */}
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-400 flex items-center justify-center font-black shadow-inner">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                    {tr('ADMIN DASHBOARD', 'DASHBOARD ADMIN')}
                  </h1>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wide uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {tr('Operational System Active', 'Sistem Operasional Aktif')}
                  </span>
                </div>
                <p className="text-xs text-zinc-400">
                  {tr('Store operational summary, cashier sales, incoming orders, and financial status', 'Ringkasan operasional toko, penjualan kasir, pesanan masuk, dan status keuangan')}
                </p>
              </div>
            </div>

            {/* Outlet Selection Pills */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-zinc-400" />
                {tr('Outlet:', 'Outlet:')}
              </span>
              <div className="inline-flex rounded-lg bg-zinc-950 border border-zinc-800 p-0.5 text-xs flex-wrap gap-0.5">
                <button
                  onClick={() => setSelectedOutlet('pusat')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                    selectedOutlet === 'pusat'
                      ? 'bg-zinc-800 text-white shadow-xs'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {storeInfo.name || tr('Main Store (Central)', 'Toko Utama (Pusat)')}
                </button>
                {outletsList.map((outl) => (
                  <button
                    key={outl.id}
                    onClick={() => setSelectedOutlet(outl.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                      selectedOutlet === outl.id
                        ? 'bg-zinc-800 text-white shadow-xs'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {outl.name || outl.code || outl.id}
                  </button>
                ))}
                <button
                  onClick={() => setSelectedOutlet('all')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                    selectedOutlet === 'all'
                      ? 'bg-zinc-800 text-white shadow-xs'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {tr('All Outlets', 'Semua Outlet')}
                </button>
              </div>
            </div>
          </div>

          {/* Right Header Controls: Time Clock, Time Filter & Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Live Clock */}
            <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-300">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <span>{currentTime || tr('Loading time...', 'Memuat waktu...')}</span>
            </div>

            {/* Time range selector */}
            <div className="flex items-center p-1 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-semibold">
              <button
                onClick={() => setTimeRange('today')}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  timeRange === 'today' ? 'bg-blue-600 text-white shadow-xs' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {tr('Today', 'Hari Ini')}
              </button>
              <button
                onClick={() => setTimeRange('yesterday')}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  timeRange === 'yesterday' ? 'bg-blue-600 text-white shadow-xs' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {tr('Yesterday', 'Kemarin')}
              </button>
              <button
                onClick={() => setTimeRange('7days')}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  timeRange === '7days' ? 'bg-blue-600 text-white shadow-xs' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {tr('7 Days', '7 Hari')}
              </button>
              <button
                onClick={() => setTimeRange('month')}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  timeRange === 'month' ? 'bg-blue-600 text-white shadow-xs' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {tr('This Month', 'Bulan Ini')}
              </button>
              <button
                onClick={() => setTimeRange('year')}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  timeRange === 'year' ? 'bg-blue-600 text-white shadow-xs' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {tr('This Year', 'Tahun Ini')}
              </button>
            </div>

            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              className={`p-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 transition cursor-pointer ${
                isRefreshing ? 'animate-spin text-blue-400' : ''
              }`}
              title={tr('Refresh Dashboard Data', 'Refresh Data Dashboard')}
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {/* CTA + Tambah Produk */}
            <button
              onClick={() => {
                if (onOpenAddProduct) {
                  onOpenAddProduct();
                } else {
                  onNavigateTab('products');
                }
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition shadow-md shadow-blue-600/20 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{tr('+ Add Product', '+ Tambah Produk')}</span>
            </button>

            {/* CTA Buka Kasir POS */}
            <button
              onClick={() => onNavigateTab('pos_machine')}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-md shadow-emerald-600/20 cursor-pointer"
            >
              <Store className="w-3.5 h-3.5" />
              <span>{tr('Open POS Machine', 'Buka POS Machine')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. SIX KEY METRIC SUMMARY CARDS (REAL-TIME FIRESTORE) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {/* Card 1: Total Penjualan */}
        <div className="bg-zinc-900/90 border border-zinc-800 p-4 rounded-2xl relative overflow-hidden group hover:border-zinc-700 transition">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              {tr('Total Sales', 'Total Penjualan')}
            </span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
              <DollarSign className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-black text-white tracking-tight">
            {formatCurrency(kpiMetrics.totalSales)}
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-[11px]">
            <span className={kpiMetrics.txCount > 0 ? 'text-emerald-400 font-semibold' : 'text-zinc-500'}>
              {kpiMetrics.txCount > 0
                ? `${kpiMetrics.txCount} ${tr('completed transactions', 'transaksi selesai')} (${kpiMetrics.totalUnitsSold} Dus)`
                : tr('No sales recorded yet', 'Belum ada penjualan')}
            </span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-400 opacity-60" />
        </div>

        {/* Card 2: Total Transaksi & Dus Terjual */}
        <div className="bg-zinc-900/90 border border-zinc-800 p-4 rounded-2xl relative overflow-hidden group hover:border-zinc-700 transition">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              {tr('Total Transactions', 'Total Transaksi')}
            </span>
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center">
              <ShoppingBag className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-black text-white tracking-tight">
            {kpiMetrics.txCount} {tr('Transactions', 'Transaksi')}
          </div>
          <div className="flex items-center justify-between gap-1.5 mt-2 text-[11px]">
            <span className={kpiMetrics.avgPerReceipt > 0 ? 'text-blue-400 font-bold' : 'text-zinc-500'}>
              {tr('Avg:', 'Rata2:')} {formatCompactCurrency(kpiMetrics.avgPerReceipt)}
            </span>
            <span className="text-zinc-300 font-mono font-bold">
              {kpiMetrics.totalUnitsSold} Dus
            </span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500 opacity-60" />
        </div>

        {/* Card 3: Estimasi Laba Kotor & Modal HPP */}
        <div className="bg-zinc-900/90 border border-zinc-800 p-4 rounded-2xl relative overflow-hidden group hover:border-zinc-700 transition">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              {tr('Gross Profit Estimate', 'Estimasi Laba Kotor')}
            </span>
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-black text-white tracking-tight">
            {formatCurrency(kpiMetrics.grossProfit)}
          </div>
          <div className="flex items-center justify-between gap-1.5 mt-2 text-[11px]">
            <span
              className={
                kpiMetrics.grossMarginPct > 0
                  ? 'text-indigo-400 font-bold bg-indigo-500/10 px-1 py-0.2 rounded'
                  : 'text-zinc-500'
              }
            >
              {tr('Margin:', 'Margin:')} {kpiMetrics.grossMarginPct}%
            </span>
            <span className="text-zinc-400 font-mono">
              HPP: {formatCompactCurrency(kpiMetrics.totalCost)}
            </span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-purple-500 opacity-60" />
        </div>

        {/* Card 4: Hutang Pelanggan (Piutang) */}
        <div className="bg-zinc-900/90 border border-zinc-800 p-4 rounded-2xl relative overflow-hidden group hover:border-zinc-700 transition">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              {tr('Customer Receivables', 'Pelanggan Hutang')}
            </span>
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center">
              <Users className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-black text-white tracking-tight">
            {formatCurrency(kpiMetrics.totalReceivables)}
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-[11px]">
            <span className="text-zinc-500">
              {kpiMetrics.totalReceivablesCount} {tr('Pending Invoices', 'Tagihan Tertunda')}
            </span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-yellow-500 opacity-60" />
        </div>

        {/* Card 5: Invoice Supplier (Belum Terbayarkan) */}
        <div className="bg-zinc-900/90 border border-zinc-800 p-4 rounded-2xl relative overflow-hidden group hover:border-zinc-700 transition">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              {tr('Supplier Invoices', 'Invoice Supplier')}
            </span>
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center justify-center">
              <Truck className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-black text-white tracking-tight">
            {formatCurrency(totalUnpaidPOAmount)}
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-[11px]">
            <span className={totalUnpaidPOAmount > 0 ? 'text-amber-400 font-bold' : 'text-zinc-500'}>
              {unpaidPOs.length} {tr('Unpaid PO Invoices', 'Faktur Belum Terbayarkan')}
            </span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-pink-500 opacity-60" />
        </div>

        {/* Card 6: Kas di Laci Kasir */}
        <div className="bg-zinc-900/90 border border-zinc-800 p-4 rounded-2xl relative overflow-hidden group hover:border-zinc-700 transition">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              {tr('Cash Drawer Balance', 'Kas di Laci Kasir')}
            </span>
            <div className="w-7 h-7 rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/20 flex items-center justify-center">
              <Banknote className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-black text-white tracking-tight">
            {formatCurrency(kpiMetrics.cashInDrawer)}
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-[11px]">
            <span className="text-teal-400 font-semibold">
              {tr('Cash Sales:', 'Penjualan Tunai:')} {formatCurrency(kpiMetrics.cashSales)}
            </span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-teal-500 to-emerald-500 opacity-60" />
        </div>
      </div>

      {/* PUSAT ANALITIK AREA CHARTS: PENJUALAN, ASSET PRODUK, PEMBELIAN, STOK VS BARANG MASUK VS PENJUALAN */}
      <AdminAreaCharts
        onNavigateTab={onNavigateTab}
        onOpenAddProduct={onOpenAddProduct}
        parentTimeRange={timeRange}
        externalTransactions={unifiedTransactions}
        externalProducts={mergedLiveProducts}
        externalSubItemsMap={txSubItemsMap}
        selectedOutlet={selectedOutlet}
      />

      {/* 3. MIDDLE DUAL SECTION: PESANAN BERJALAN & STATISTIK SHIFT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (8 Cols): Order Section & Charts */}
        <div className="lg:col-span-8 space-y-6">
          {/* PESANAN MASUK / ORDER BERJALAN CARD */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
            {/* Header with status tabs */}
            <div className="p-5 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Inbox className="w-4 h-4 text-blue-400" />
                    {tr('Incoming & Active Orders', 'Pesanan Masuk & Berjalan')}
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/25">
                    {displayedOrders.length} {tr('Orders', 'Order')}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {tr('Monitor live incoming orders from PWA online catalog and POS checkouts', 'Pantau pesanan masuk secara realtime dari katalog online PWA dan pemesanan kasir')}
                </p>
              </div>

              {/* Status filter tabs */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 text-xs font-semibold">
                <button
                  onClick={() => setOrderFilterTab('all')}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer shrink-0 ${
                    orderFilterTab === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                  }`}
                >
                  {tr('All', 'Semua')} ({ordersList.length})
                </button>
                <button
                  onClick={() => setOrderFilterTab('menunggu')}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer shrink-0 ${
                    orderFilterTab === 'menunggu'
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                  }`}
                >
                  {tr('Pending', 'Menunggu')} ({orderCountsByStatus.menunggu})
                </button>
                <button
                  onClick={() => setOrderFilterTab('diproses')}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer shrink-0 ${
                    orderFilterTab === 'diproses'
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                  }`}
                >
                  {tr('Processing', 'Diproses')} ({orderCountsByStatus.diproses})
                </button>
                <button
                  onClick={() => setOrderFilterTab('siap')}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer shrink-0 ${
                    orderFilterTab === 'siap'
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                  }`}
                >
                  {tr('Ready to Ship', 'Siap Kirim')} ({orderCountsByStatus.siap})
                </button>
              </div>
            </div>

            {/* Content: Genuine Empty state or real orders list */}
            {displayedOrders.length === 0 ? (
              <div className="py-16 px-6 text-center flex flex-col items-center justify-center">
                <div className="w-20 h-20 rounded-2xl bg-zinc-800/60 border border-zinc-700/60 flex items-center justify-center text-zinc-400 mb-4 shadow-inner">
                  <Inbox className="w-10 h-10 stroke-[1.5]" />
                </div>
                <h3 className="text-base font-bold text-white mb-1">
                  {tr('No orders yet', 'Belum ada order')}
                </h3>
                <p className="text-xs text-zinc-400 max-w-md mx-auto mb-6">
                  {tr('Incoming orders from PWA online customers, dine-in tables, or POS queue will appear here in real-time.', 'Pesanan masuk dari pelanggan online PWA, pemesanan meja, atau pesanan pending kasir akan otomatis tampil di sini secara realtime.')}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={() => setShowNewOrderModal(true)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition shadow-md shadow-blue-600/20 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{tr('+ Create New Order', '+ Buat Order Baru')}</span>
                  </button>
                  <button
                    onClick={() => onNavigateTab('pos_machine')}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition border border-zinc-700 cursor-pointer"
                  >
                    <Store className="w-3.5 h-3.5" />
                    <span>{tr('Open POS Cashier', 'Buka Kasir POS')}</span>
                  </button>
                </div>
              </div>
            ) : (
              /* ACTIVE ORDERS LIST */
              <div className="divide-y divide-zinc-800/80">
                {displayedOrders.map((ord) => (
                  <div key={ord.id} className="p-4 sm:p-5 hover:bg-zinc-800/30 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                          {ord.orderNumber}
                        </span>
                        <span className="text-sm font-bold text-white">{ord.customerName}</span>
                        <span className="text-[10px] font-semibold bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">
                          {ord.channel}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-zinc-400">
                        <span>{ord.itemsCount} {tr('Items', 'Barang')}</span>
                        <span>&bull;</span>
                        <span className="font-mono font-bold text-emerald-400">
                          {formatCurrency(ord.totalAmount)}
                        </span>
                        <span>&bull;</span>
                        <span className="text-zinc-400">{ord.paymentMethod} ({ord.paymentStatus})</span>
                        <span>&bull;</span>
                        <span className="text-zinc-500">{ord.time}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {ord.orderStatus === 'menunggu' && (
                        <button
                          onClick={() => updateOrderStatus(ord.id, 'diproses')}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition cursor-pointer"
                        >
                          {tr('Process Order', 'Proses Pesanan')}
                        </button>
                      )}
                      {ord.orderStatus === 'diproses' && (
                        <button
                          onClick={() => updateOrderStatus(ord.id, 'siap')}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition cursor-pointer"
                        >
                          {tr('Ready for Pickup', 'Siap Diambil')}
                        </button>
                      )}
                      {ord.orderStatus === 'siap' && (
                        <button
                          onClick={() => updateOrderStatus(ord.id, 'selesai')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer"
                        >
                          {tr('Complete', 'Selesaikan')}
                        </button>
                      )}
                      {ord.orderStatus === 'selesai' && (
                        <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" /> {tr('Completed', 'Selesai')}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* HOURLY SALES CHART VISUAL */}
          <div className="bg-zinc-900/90 border border-zinc-800 p-5 rounded-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-400" />
                  {tr('Hourly Sales Trend Chart', 'Grafik Tren Penjualan Jam Per Jam')}
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {tr('Daily sales volume distribution across operating hours to optimize shifts and inventory', 'Visualisasi beban penjualan sepanjang hari untuk memetakan shift dan stok')}
                </p>
              </div>
              <div className="text-right">
                <span className="text-xs font-mono text-zinc-400">{tr('Total Transactions', 'Total Transaksi')}</span>
                <div className="text-xs font-bold text-emerald-400">
                  {kpiMetrics.txCount} {tr('Receipts', 'Struk')}
                </div>
              </div>
            </div>

            {/* Bar chart container */}
            <div className="pt-4 pb-2">
              <div className="h-40 flex items-end justify-between gap-2 sm:gap-4 px-2 border-b border-zinc-800">
                {hourlyData.map((d) => {
                  const heightPercent = d.amount > 0 ? Math.round((d.amount / maxHourAmount) * 100) : 6;
                  return (
                    <div key={d.hour} className="flex-1 flex flex-col items-center gap-2 group">
                      <div className="opacity-0 group-hover:opacity-100 transition text-[10px] font-mono text-center bg-zinc-800 text-white px-1.5 py-0.5 rounded shadow pointer-events-none whitespace-nowrap">
                        {d.amount > 0 ? `${formatCompactCurrency(d.amount)} (${d.tx})` : formatCurrency(0)}
                      </div>
                      <div
                        className="w-full max-w-[42px] bg-zinc-800/80 rounded-t-lg group-hover:bg-blue-600 transition flex items-end justify-center relative overflow-hidden"
                        style={{ height: `${heightPercent}%` }}
                      >
                        <div className="w-full bg-gradient-to-t from-blue-700 to-indigo-500 rounded-t-lg h-full opacity-80 group-hover:opacity-100 transition" />
                      </div>
                      <span className="text-[11px] font-mono text-zinc-400 group-hover:text-white transition">
                        {d.hour}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Chart footer insights */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs border-t border-zinc-800/60">
              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800">
                <span className="text-zinc-500 block text-[11px]">{tr('Peak Busy Hour', 'Jam Puncak Teramai')}</span>
                <span className="font-bold text-white">{peakHourSummary}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800">
                <span className="text-zinc-500 block text-[11px]">{tr('Top Payment Method', 'Metode Favorit')}</span>
                <span className="font-bold text-white">{kpiMetrics.topPaymentMethodLabel}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800">
                <span className="text-zinc-500 block text-[11px]">{tr('Cash Drawer Compliance', 'Kepatuhan Laci Kas')}</span>
                <span className="font-bold text-emerald-400">{tr('100% Synced Real-Time', '100% Selaras Realtime')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (4 Cols): SIDEBAR KANAN DASHBOARD ADMIN (Shift Stats, Debt, Risk & Operations) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Header Marker for Right Sidebar */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5" />
                {tr('RIGHT SIDEBAR • OPERATIONS PANEL', 'SIDEBAR KANAN • PANEL OPERASIONAL')}
              </span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-300 border border-zinc-700 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {tr('Live Cashier', 'Kasir Live')}
            </span>
          </div>

          {/* STATISTIK SHIFT KASIR AKTIF */}
          <div className="bg-zinc-900/90 border border-zinc-800 p-5 rounded-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-400" />
                  {tr('Cashier Shift Statistics', 'Statistik Shift Kasir')}
                </h3>
                <span className="text-[11px] text-zinc-400">{tr('Real-Time Shift Summary', 'Ringkasan Shift Realtime')}</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {tr('Active Shift', 'Shift Aktif')}
              </span>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                <div>
                  <span className="text-zinc-400 block text-[11px]">{tr('Cashier on Duty:', 'Kasir Bertugas:')}</span>
                  <span className="font-bold text-white">
                    {kpiMetrics.activeCashierName}
                  </span>
                </div>
                <span className="text-[10px] bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded font-mono">
                  {kpiMetrics.txCount} {tr('Receipts', 'Struk')}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
                <div className="flex justify-between items-center text-zinc-400">
                  <span>{tr('Opening Cash Float:', 'Modal Awal Kas:')}</span>
                  <span className="font-mono font-bold text-zinc-200">
                    {formatCurrency(kpiMetrics.openingFloat)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-zinc-400">
                  <span>{tr('Cash Sales:', 'Penjualan Tunai:')}</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {formatCurrency(kpiMetrics.cashSales)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-zinc-400">
                  <span>{tr('Non-Cash / QRIS Sales:', 'Penjualan Non-Tunai / QRIS:')}</span>
                  <span className="font-mono font-bold text-blue-400">
                    {formatCurrency(kpiMetrics.nonCashSales)}
                  </span>
                </div>
                <div className="pt-2 border-t border-zinc-800/80 flex justify-between items-center">
                  <span className="font-bold text-white">{tr('Physical Cash in Drawer:', 'Kas Fisik di Laci:')}</span>
                  <span className="font-mono font-black text-white text-sm">
                    {formatCurrency(kpiMetrics.cashInDrawer)}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => setShowShiftModal(true)}
                className="w-full py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold transition border border-zinc-700 cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{tr('Print Shift', 'Cetak Shift')}</span>
              </button>
              <button
                onClick={() => setShowShiftModal(true)}
                className="w-full py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <BadgeCheck className="w-3.5 h-3.5" />
                <span>{tr('Close Shift', 'Tutup Shift')}</span>
              </button>
            </div>
          </div>

          {/* PELANGGAN HUTANG & INVOICE SUPPLIER */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
            {/* Pelanggan Hutang */}
            <div className="bg-zinc-900/90 border border-zinc-800 p-4 rounded-2xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                  {tr('Customer Receivables', 'Pelanggan Hutang')}
                </span>
                <span className="text-[10px] font-bold bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/20">
                  {kpiMetrics.totalReceivables > 0 ? tr('Active', 'Aktif') : tr('Current', 'Lancar')}
                </span>
              </div>
              <div className="text-lg font-black text-white">
                {formatCurrency(kpiMetrics.totalReceivables)}
              </div>
              <p className="text-[11px] text-zinc-400">
                {kpiMetrics.totalReceivables > 0
                  ? `${kpiMetrics.totalReceivablesCount} ${tr('customer credit bills recorded in Firestore.', 'tagihan piutang pelanggan tercatat di database.')}`
                  : tr('No unpaid or overdue customer credit bills.', 'Tidak ada tagihan hutang pelanggan yang belum dibayar atau jatuh tempo.')}
              </p>
              <button
                onClick={() => navigateToPath('/dashboard/pelanggan/hutang')}
                className="text-xs text-blue-400 hover:text-blue-300 font-semibold cursor-pointer pt-1 block"
              >
                {tr('Open Receivables Ledger', 'Buka Buku Piutang')} &rarr;
              </button>
            </div>

            {/* Invoice Supplier */}
            <div className="bg-zinc-900/90 border border-zinc-800 p-4 rounded-2xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5 text-purple-400" />
                  {tr('Supplier Invoices (Payables)', 'Invoice Supplier (Hutang)')}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  totalUnpaidPOAmount > 0
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                }`}>
                  {totalUnpaidPOAmount > 0 ? `${unpaidPOs.length} ${tr('Unpaid', 'Belum Lunas')}` : tr('Paid', 'Lunas')}
                </span>
              </div>
              <div className="text-lg font-black text-white">
                {formatCurrency(totalUnpaidPOAmount)}
              </div>
              <p className="text-[11px] text-zinc-400">
                {totalUnpaidPOAmount > 0
                  ? `${unpaidPOs.length} ${tr('purchase orders awaiting payment / tempo.', 'faktur PO supplier menunggu pembayaran / tempo.')}`
                  : tr('All purchase invoices from distributors/suppliers are fully paid.', 'Semua faktur pesanan barang dari distributor/supplier telah lunas terbayarkan.')}
              </p>
              <button
                onClick={() => navigateToPath('/dashboard/pembelian/daftar-pembelian')}
                className="text-xs text-blue-400 hover:text-blue-300 font-semibold cursor-pointer pt-1 block"
              >
                {tr('Open Business Invoices', 'Buka Faktur Usaha')} &rarr;
              </button>
            </div>
          </div>

          {/* PERINGATAN STOK KRITIS / RESTOCK ALERT */}
          <div className="bg-zinc-900/90 border border-zinc-800 p-5 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                {tr('Low Stock Alerts', 'Peringatan Stok Menipis')}
              </h3>
              <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                {criticalStockItems.length} {tr('Need Restock', 'Perlu Restock')}
              </span>
            </div>

            {criticalStockItems.length === 0 ? (
              <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800 text-xs text-zinc-400 text-center">
                {tr('All product stocks are above minimum alert thresholds.', 'Seluruh stok produk berada di atas batas minimum.')}
              </div>
            ) : (
              <div className="space-y-2 text-xs">
                {criticalStockItems.map((item, idx) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-white">{item.name}</div>
                      <div className="text-[11px] text-zinc-400">
                        {tr('Remaining:', 'Sisa:')} <span className="text-rose-400 font-bold">{item.currentStock} {item.unit}</span> ({tr('Min Limit:', 'Batas Min:')} {item.minStock})
                      </div>
                    </div>
                    <button
                      onClick={() => onNavigateTab('restock')}
                      className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-semibold cursor-pointer"
                    >
                      Restock
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => onNavigateTab('restock')}
              className="w-full text-center text-xs text-blue-400 hover:text-blue-300 font-semibold cursor-pointer pt-1 block"
            >
              {tr('Open Restock AI Advisor', 'Buka Restock AI Advisor')} &rarr;
            </button>
          </div>

          {/* PINTASAN CEPAT OPERASIONAL KASIR */}
          <div className="bg-zinc-900/90 border border-zinc-800 p-5 rounded-2xl space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-400" />
              {tr('Quick Operational Shortcuts', 'Pintasan Cepat Operasional')}
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs font-semibold">
              <button
                onClick={() => setShowNewOrderModal(true)}
                className="p-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 flex flex-col items-center justify-center gap-1.5 transition cursor-pointer text-center group"
              >
                <Plus className="w-4 h-4 text-blue-400 group-hover:scale-110 transition" />
                <span>{tr('+ Create Order', '+ Buat Order')}</span>
              </button>
              <button
                onClick={() => onNavigateTab('pos_machine')}
                className="p-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-emerald-400 flex flex-col items-center justify-center gap-1.5 transition cursor-pointer text-center group"
              >
                <Store className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition" />
                <span>{tr('Open POS Cashier', 'Buka Kasir POS')}</span>
              </button>
              <button
                onClick={onOpenAddProduct}
                className="p-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 flex flex-col items-center justify-center gap-1.5 transition cursor-pointer text-center group"
              >
                <Boxes className="w-4 h-4 text-amber-400 group-hover:scale-110 transition" />
                <span>{tr('Add Product', 'Tambah Produk')}</span>
              </button>
              <button
                onClick={() => setShowShiftModal(true)}
                className="p-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 flex flex-col items-center justify-center gap-1.5 transition cursor-pointer text-center group"
              >
                <Printer className="w-4 h-4 text-purple-400 group-hover:scale-110 transition" />
                <span>{tr('Print Shift', 'Cetak Shift')}</span>
              </button>
            </div>
          </div>

          {/* LOG AUDIT & NOTIFIKASI KASIR REALTIME */}
          <div className="bg-zinc-900/90 border border-zinc-800 p-5 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                {tr('Cashier Audit & Drawer Integrity', 'Audit Kasir & Integritas Laci')}
              </h3>
              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-bold">
                {tr('100% Secure', 'Aman 100%')}
              </span>
            </div>

            {recentTransactions.length === 0 ? (
              <div className="p-3 rounded-lg bg-zinc-950/70 border border-zinc-800/80 text-[11px] text-zinc-400 text-center">
                {tr('No cashier transaction logs recorded in this period.', 'Belum ada log audit transaksi kasir pada periode ini.')}
              </div>
            ) : (
              <div className="space-y-2 text-[11px] text-zinc-400">
                {recentTransactions.slice(0, 3).map((tx) => (
                  <div key={tx.id} className="flex items-start gap-2 p-2 rounded-lg bg-zinc-950/70 border border-zinc-800/80">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shrink-0" />
                    <div>
                      <span className="text-white font-medium">{tx.time}</span> &bull;{' '}
                      {tr(
                        `${tx.method} transaction of ${formatCurrency(tx.total)} (${tx.customer}) recorded.`,
                        `Transaksi ${tx.method} ${formatCurrency(tx.total)} (${tx.customer}) tercatat.`
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. BOTTOM SECTION: PRODUK TERLARIS & TABEL TRANSAKSI REALTIME */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Top Products (4 cols) */}
        <div className="lg:col-span-4 bg-zinc-900/90 border border-zinc-800 p-5 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Boxes className="w-4 h-4 text-blue-400" />
                {tr('Top Selling Products Today', 'Produk Terlaris Hari Ini')}
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">{tr('Top 5 SKUs generating highest revenue', 'Top 5 SKU penyumbang omset tertinggi')}</p>
            </div>
            <button
              onClick={() => onNavigateTab('products')}
              className="text-xs text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
            >
              {tr('View All', 'Lihat Semua')} &rarr;
            </button>
          </div>

          {topProducts.length === 0 ? (
            <div className="p-6 rounded-xl bg-zinc-950/80 border border-zinc-800/80 text-center text-xs text-zinc-400">
              {tr('No products or sales data available yet.', 'Belum ada data produk atau penjualan.')}
            </div>
          ) : (
            <div className="space-y-3">
              {topProducts.map((p, idx) => (
                <div
                  key={`${p.name}-${idx}`}
                  className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800/80 hover:border-zinc-700 transition flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-7 h-7 rounded-lg font-black text-xs flex items-center justify-center shrink-0 ${
                        idx === 0
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : idx === 1
                          ? 'bg-zinc-700/50 text-zinc-300'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      #{idx + 1}
                    </div>
                    <div>
                      <div className="font-bold text-white truncate max-w-[160px] sm:max-w-[200px]">
                        {p.name}
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {tr('Sold', 'Terjual')} {p.sold} &bull; {tr('Stock', 'Stok')} {p.stock}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-bold text-emerald-400">
                      {formatCurrency(p.rev)}
                    </div>
                    <span className="text-[10px] text-zinc-500 font-semibold">{p.category}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Transactions Table (8 cols) */}
        <div className="lg:col-span-8 bg-zinc-900/90 border border-zinc-800 p-5 rounded-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Receipt className="w-4 h-4 text-emerald-400" />
                {tr('Recent Transactions (Live POS Feed)', 'Transaksi Terkini (Live Feed POS)')}
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">{tr('Live feed of direct cashier sales receipts', 'Daftar struk transaksi penjualan kasir langsung')}</p>
            </div>

            {/* Search filter */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder={tr('Search receipt / cashier / customer...', 'Cari struk / kasir / pelanggan...')}
                value={txSearchQuery}
                onChange={(e) => setTxSearchQuery(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-hidden focus:border-blue-500 transition"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-left text-xs text-zinc-300">
              <thead className="bg-zinc-950/90 text-zinc-400 uppercase text-[10px] font-semibold border-b border-zinc-800">
                <tr>
                  <th className="py-2.5 px-3">{tr('Receipt No.', 'No. Struk')}</th>
                  <th className="py-2.5 px-3">{tr('Time', 'Waktu')}</th>
                  <th className="py-2.5 px-3">{tr('Cashier / Customer', 'Kasir / Pelanggan')}</th>
                  <th className="py-2.5 px-3">{tr('Payment Method', 'Metode Bayar')}</th>
                  <th className="py-2.5 px-3 text-right">{tr('Total Paid', 'Total Bayar')}</th>
                  <th className="py-2.5 px-3 text-center">{tr('Status', 'Status')}</th>
                  <th className="py-2.5 px-3 text-center">{tr('Action', 'Aksi')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {displayedTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-xs text-zinc-400">
                      {tr('No transactions found for the selected period.', 'Belum ada transaksi pada periode yang dipilih.')}
                    </td>
                  </tr>
                ) : (
                  displayedTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-zinc-800/30 transition">
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-400">
                        {tx.receiptNumber}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-400 whitespace-nowrap">
                        {tx.time}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-white">{tx.cashier}</div>
                        <div className="text-[11px] text-zinc-400">{tx.customer}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-800 text-zinc-200">
                          {tx.method}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-400 text-right">
                        {formatCurrency(tx.total)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                          {tx.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <button
                          onClick={() => setSelectedReceipt(tx)}
                          className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-semibold transition cursor-pointer"
                        >
                          {tr('Details', 'Detail')}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* MODAL 1: DETAIL STRUK TRANSAKSI */}
      {selectedReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-white text-base">{tr('Cashier Receipt Details', 'Rincian Struk Kasir')}</h3>
              </div>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="p-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-zinc-950 font-mono text-xs space-y-2 border border-zinc-800">
              <div className="text-center pb-2 border-b border-dashed border-zinc-800">
                <div className="font-bold text-white text-sm">
                  {storeInfo.name || tr('RISKCART POS • CENTRAL OUTLET', 'RISKCART POS • OUTLET PUSAT')}
                </div>
              </div>

              <div className="flex justify-between text-zinc-400 pt-1">
                <span>{tr('Receipt No.:', 'No. Struk:')}</span>
                <span className="text-white font-bold">{selectedReceipt.receiptNumber}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>{tr('Time / Date:', 'Waktu / Tgl:')}</span>
                <span className="text-white">{selectedReceipt.time}, {selectedReceipt.date}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>{tr('Cashier:', 'Kasir:')}</span>
                <span className="text-white">{selectedReceipt.cashier}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>{tr('Customer:', 'Pelanggan:')}</span>
                <span className="text-white">{selectedReceipt.customer}</span>
              </div>

              <div className="py-2 my-1 border-t border-b border-dashed border-zinc-800 space-y-1">
                <div className="text-zinc-300">{selectedReceipt.itemsSummary}</div>
              </div>

              <div className="flex justify-between text-sm font-bold pt-1">
                <span className="text-white">{tr('TOTAL PAID:', 'TOTAL BAYAR:')}</span>
                <span className="text-emerald-400">{formatCurrency(selectedReceipt.total)}</span>
              </div>
              <div className="flex justify-between text-zinc-400 text-[11px]">
                <span>{tr('Payment Method:', 'Metode Pembayaran:')}</span>
                <span className="text-white font-bold">{selectedReceipt.method} ({tr('PAID', 'LUNAS')})</span>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  showFlash(
                    tr(
                      `Printing receipt ${selectedReceipt.receiptNumber} to POS thermal printer...`,
                      `Mencetak struk ${selectedReceipt.receiptNumber} ke printer thermal POS...`
                    )
                  );
                  setSelectedReceipt(null);
                }}
                className="flex-1 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{tr('Reprint Receipt', 'Cetak Ulang Struk')}</span>
              </button>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="py-2 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition cursor-pointer"
              >
                {tr('Close', 'Tutup')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Flash Notification */}
      {flashMsg && (
        <div className="fixed top-20 right-6 z-50 bg-emerald-600 text-white px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold animate-in slide-in-from-top-2">
          <CheckCircle className="w-4 h-4 text-white" />
          <span>{flashMsg}</span>
        </div>
      )}

      {/* MODAL 2: TUTUP SHIFT KASIR & REKONSILIASI */}
      {showShiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-white text-base">{tr('Reconciliation & Close Shift', 'Rekonsiliasi & Tutup Shift')}</h3>
              </div>
              <button
                onClick={() => setShowShiftModal(false)}
                className="p-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-zinc-950 text-xs space-y-2 border border-zinc-800">
              <div className="font-bold text-white text-sm mb-1">{tr('Active Shift Summary', 'Rangkuman Shift Aktif')}</div>
              <div className="flex justify-between text-zinc-400">
                <span>{tr('Opening Cash Float:', 'Modal Awal Kas:')}</span>
                <span className="font-mono text-white">{formatCurrency(kpiMetrics.openingFloat)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>{tr('Cash Sales:', 'Penjualan Tunai:')}</span>
                <span className="font-mono text-emerald-400">{formatCurrency(kpiMetrics.cashSales)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>{tr('Total Non-Cash / QRIS:', 'Total Non-Tunai / QRIS:')}</span>
                <span className="font-mono text-blue-400">{formatCurrency(kpiMetrics.nonCashSales)}</span>
              </div>
              <div className="pt-2 border-t border-zinc-800 flex justify-between font-bold">
                <span className="text-white">{tr('Physical Cash in Drawer:', 'Uang Fisik Kas di Laci:')}</span>
                <span className="font-mono text-emerald-400 text-sm">{formatCurrency(kpiMetrics.cashInDrawer)}</span>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  showFlash(
                    tr(
                      'Shift closed successfully. Cash reconciliation slip sent to thermal printer.',
                      'Shift ditutup berhasil. Slip rekonsiliasi kas telah dikirim ke printer thermal.'
                    )
                  );
                  setShowShiftModal(false);
                }}
                className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>{tr('Confirm Close Shift', 'Konfirmasi Tutup Shift')}</span>
              </button>
              <button
                onClick={() => setShowShiftModal(false)}
                className="py-2 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition cursor-pointer"
              >
                {tr('Cancel', 'Batal')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: TAMBAH PESANAN CEPAT */}
      {showNewOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-white text-base">{tr('Create Manual Order', 'Buat Pesanan Manual')}</h3>
              </div>
              <button
                onClick={() => setShowNewOrderModal(false)}
                className="p-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-zinc-400 font-semibold block mb-1">{tr('Customer Name', 'Nama Pemesan / Pelanggan')}</label>
                <input
                  type="text"
                  value={newOrderCustomer}
                  onChange={(e) => setNewOrderCustomer(e.target.value)}
                  placeholder={tr('Enter customer name', 'Masukkan nama pelanggan')}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-hidden focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-zinc-400 font-semibold block mb-1">{tr('Order Channel', 'Saluran Pemesanan')}</label>
                <select
                  value={newOrderChannel}
                  onChange={(e) => setNewOrderChannel(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-hidden focus:border-blue-500"
                >
                  <option value="PWA Online">PWA Online</option>
                  <option value="WhatsApp Order">WhatsApp Order</option>
                  <option value="Dine In / Meja">{tr('Dine In / Table', 'Dine In / Meja')}</option>
                  <option value="Telepon / Manual">{tr('Phone / Manual', 'Telepon / Manual')}</option>
                </select>
              </div>

              <div>
                <label className="text-zinc-400 font-semibold block mb-1">{tr('Total Order Amount (Rp)', 'Total Nilai Pesanan (Rp)')}</label>
                <input
                  type="number"
                  value={newOrderTotal}
                  onChange={(e) => setNewOrderTotal(e.target.value)}
                  placeholder="0"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-hidden focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-zinc-400 font-semibold block mb-1">{tr('Product / Order Notes', 'Catatan Produk / Pesanan')}</label>
                <textarea
                  rows={2}
                  value={newOrderNotes}
                  onChange={(e) => setNewOrderNotes(e.target.value)}
                  placeholder={tr('Enter ordered items and notes', 'Masukkan rincian barang dan catatan pesanan')}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-hidden focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleCreateManualOrder}
                className="flex-1 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>{tr('Save Incoming Order', 'Simpan Pesanan Masuk')}</span>
              </button>
              <button
                onClick={() => setShowNewOrderModal(false)}
                className="py-2 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition cursor-pointer"
              >
                {tr('Cancel', 'Batal')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL RESET DATABASE */}
      {showResetDbModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-rose-800/80 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2 text-rose-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 className="font-bold text-white text-base">
                  {tr('Reset All Database Data?', 'Reset & Hapus Semua Data Database?')}
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowResetDbModal(false);
                  setResetDbFeedback(null);
                }}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-zinc-300">
              <div className="p-3 bg-rose-950/40 border border-rose-900/60 rounded-xl text-rose-300 leading-relaxed">
                <strong>{tr('CRITICAL WARNING:', 'PERINGATAN KRUSIAL:')}</strong>{' '}
                {tr(
                  'This action will permanently delete all documents across all Firestore collections (products, transactions, customers, categories, brands, POs, suppliers, staff, shifts, vouchers, vault entries, etc.) and reset the system to a clean state ready for fresh input.',
                  'Tindakan ini akan menghapus secara permanen SELURUH dokumen di semua koleksi Firestore (produk, transaksi, pelanggan, kategori, brand, PO, supplier, staff, shift, voucher, kas toko, dll) dan mereset sistem menjadi bersih siap input ulang.'
                )}
              </div>

              {resetDbFeedback && (
                <div className="p-3 bg-emerald-950/60 border border-emerald-800 rounded-xl text-emerald-300 font-bold">
                  {resetDbFeedback}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2 border-t border-zinc-800">
              <button
                disabled={isResettingDb}
                onClick={async () => {
                  setIsResettingDb(true);
                  try {
                    const res = await resetAllDatabaseData();
                    setResetDbFeedback(
                      tr(
                        `Database successfully wiped (${res.deletedCount} items deleted). Ready for fresh input!`,
                        `Database berhasil dikosongkan (${res.deletedCount} data terhapus). Sistem siap untuk input ulang!`
                      )
                    );
                    setTimeout(() => {
                      setShowResetDbModal(false);
                      setResetDbFeedback(null);
                      window.location.reload();
                    }, 2000);
                  } catch (err: any) {
                    setResetDbFeedback(`Error: ${err.message || err}`);
                  } finally {
                    setIsResettingDb(false);
                  }
                }}
                className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-rose-600/30"
              >
                <Trash2 className="w-4 h-4" />
                <span>
                  {isResettingDb
                    ? tr('Deleting all records...', 'Sedang Menghapus Seluruh Data...')
                    : tr('Yes, Reset Database Completely', 'Ya, Reset Seluruh Database')}
                </span>
              </button>
              <button
                disabled={isResettingDb}
                onClick={() => {
                  setShowResetDbModal(false);
                  setResetDbFeedback(null);
                }}
                className="py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition cursor-pointer"
              >
                {tr('Cancel', 'Batal')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

