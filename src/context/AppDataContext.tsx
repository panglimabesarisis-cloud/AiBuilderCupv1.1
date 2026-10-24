import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  enableNetwork,
} from 'firebase/firestore';
import { db, isDemoModeActive, resetDemoSandbox } from '../firebase';
import { Product, Transaction } from '../types';
import { ACTIVE_STORE_ID } from '../config/store';
import { DEFAULT_CATEGORIES, DEFAULT_BRANDS } from '../services/masterDataService';
import {
  wipeAllFirestoreData as runWipeAllFirestoreData,
  forceWipeAllDatabaseExceptOwner as runForceWipeAllDatabaseExceptOwner,
  isLegacyMockOrderOrTx,
} from '../services/dataSeeder';
import {
  feedStockSyncData,
  updateSynchronizedProductStock,
  reconcileCompletedTransaction,
} from '../services/stockSyncService';
import {
  loadGlobalDefaultAIModel,
  saveGlobalDefaultAIModel,
} from '../services/aiInstructionStore';
import {
  CurrencyMode,
  getCurrencyMode,
  getExchangeRate,
  setCurrencyModeGlobal,
  subscribeCurrency,
  fmtMoney,
  formatCompactMoney,
} from '../utils/money';
import { getDefaultMinStock } from '../services/posRuntime';

function isDummySimulationItem(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  const id = String(item.id || '').trim();
  const receipt = String(item.receiptNo || item.orderNumber || '').trim();
  if (
    id.startsWith('demo_prod_') ||
    id.startsWith('demo_tx_') ||
    id.startsWith('demo_ord_') ||
    id.startsWith('demo_cust_') ||
    id.startsWith('demo_sup_') ||
    id.startsWith('demo_doc_') ||
    receipt.startsWith('INV-DEMO-') ||
    receipt.startsWith('ORD-PWA-880')
  ) {
    return true;
  }
  return isLegacyMockOrderOrTx(item);
}

// Helper to safely read from localStorage (`riskcart_cache_*` and `riskcart_fs_*`), stripping any legacy dummy simulation data
function getLocalCache<T>(key: string, fallback: T): T {
  try {
    const rawFs = localStorage.getItem(`riskcart_fs_${key}`);
    const rawCache = localStorage.getItem(`riskcart_cache_${key}`);
    const parsedFs = rawFs ? JSON.parse(rawFs) : null;
    const parsedCache = rawCache ? JSON.parse(rawCache) : null;

    if (Array.isArray(parsedFs)) {
      const cleaned = parsedFs.filter((item) => !isDummySimulationItem(item));
      return cleaned as unknown as T;
    }
    if (Array.isArray(parsedCache)) {
      const cleaned = parsedCache.filter((item) => !isDummySimulationItem(item));
      return cleaned as unknown as T;
    }
    if (parsedCache && typeof parsedCache === 'object' && !Array.isArray(parsedCache)) {
      return parsedCache as unknown as T;
    }
  } catch (e) {
    // Ignore JSON parse errors
  }
  return fallback;
}

function setLocalCache<T>(key: string, data: T): void {
  try {
    const cleaned = Array.isArray(data)
      ? data.filter((item) => !isDummySimulationItem(item))
      : data;
    const serialized = JSON.stringify(cleaned);
    // In Demo Sandbox mode, never overwrite persistent localStorage cache with sandbox mutations
    if (isDemoModeActive()) {
      sessionStorage.setItem(`riskcart_demo_cache_${key}`, serialized);
      return;
    }
    localStorage.setItem(`riskcart_cache_${key}`, serialized);
    localStorage.setItem(`riskcart_fs_${key}`, serialized);
  } catch (e) {
    // Quota of localStorage exceeded or private mode, ignore safely
  }
}

// Check if error is Firestore quota exceeded
export function isQuotaExceededError(error: any): boolean {
  if (!error) return false;
  const msg = String(error.message || error || '').toLowerCase();
  const code = String(error.code || '').toLowerCase();
  return (
    code.includes('resource-exhausted') ||
    code.includes('quota-exceeded') ||
    msg.includes('quota exceeded') ||
    msg.includes('resource_exhausted') ||
    msg.includes('resource has been exhausted')
  );
}

export type EcosystemWriteActionType =
  | 'restock_product'
  | 'deduct_stock'
  | 'add_cash_in'
  | 'add_cash_out'
  | 'update_product_price'
  | 'update_order_status';

export interface EcosystemWritePayload {
  productId?: string;
  quantity?: number;
  amount?: number;
  newPrice?: number;
  newCost?: number;
  isiPerDus?: number;
  beratPerItem?: number;
  orderId?: string;
  orderStatus?: string;
  category?: string;
  description?: string;
  note?: string;
  cashierName?: string;
  shiftId?: string;
}

export interface AppDataContextValue {
  products: Product[];
  categories: string[];
  brands: string[];
  transactions: Transaction[];
  customers: any[];
  orders: any[];
  pendingPwaOrders: any[];
  pendingPwaCount: number;
  shifts: any[];
  cashLogs: any[];
  procurements: any[];
  brangkas_toko_logs: any[];
  brangkasLogs: any[];
  staff: any[];
  aiTokenLogs: any[];
  loadingProducts: boolean;
  loadingTransactions: boolean;
  isQuotaExceeded: boolean;
  dismissQuotaBanner: boolean;
  setDismissQuotaBanner: (dismiss: boolean) => void;
  upsertProductLocal: (prod: Product) => void;
  deleteProductLocal: (id: string) => void;
  addTransactionLocal: (tx: Transaction) => void;
  executeEcosystemWriteAction: (
    actionType: EcosystemWriteActionType,
    payload: EcosystemWritePayload
  ) => Promise<{ ok: boolean; message: string }>;
  refreshFirestore: () => void;
  currency: CurrencyMode;
  currencyMode: CurrencyMode;
  setCurrency: (curr: CurrencyMode) => void;
  exchangeRate: number;
  formatMoney: (amount: number, baseCurrency?: CurrencyMode) => string;
  formatCompactMoney: (amount: number, baseCurrency?: CurrencyMode) => string;
  defaultAiModel: string;
  globalAiModel?: string;
  setDefaultAiModel: (modelId: string, applyToAllAgents?: boolean) => Promise<void>;
  wipeAllFirestoreData: (forceRun?: boolean) => Promise<{ success: boolean; deletedCount: number }>;
  forceWipeAllDatabaseExceptOwner: (forceRun?: boolean) => Promise<{ success: boolean; deletedCount: number }>;
  isDemoUser: boolean;
  resetDemoData: () => void;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export const AppDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. Initial states populated from clean live cache (no dummy products)
  const [products, setProducts] = useState<Product[]>(() =>
    getLocalCache<Product[]>('products', [])
  );

  const [categories, setCategories] = useState<string[]>(() =>
    getLocalCache<string[]>('categories', [])
  );

  const [brands, setBrands] = useState<string[]>(() =>
    getLocalCache<string[]>('brands', [])
  );

  const [transactions, setTransactions] = useState<Transaction[]>(() =>
    getLocalCache<Transaction[]>('transactions', [])
  );

  const [customers, setCustomers] = useState<any[]>(() =>
    getLocalCache<any[]>('customers', [])
  );

  const [orders, setOrders] = useState<any[]>(() =>
    getLocalCache<any[]>('orders', [])
  );

  const [shifts, setShifts] = useState<any[]>(() =>
    getLocalCache<any[]>('shifts', [])
  );

  const [cashLogs, setCashLogs] = useState<any[]>(() =>
    getLocalCache<any[]>('cash_logs', [])
  );

  const [procurements, setProcurements] = useState<any[]>(() =>
    getLocalCache<any[]>('procurements', [])
  );

  const [brangkasTokoLogs, setBrangkasTokoLogs] = useState<any[]>(() =>
    getLocalCache<any[]>('brangkas_toko_logs', [])
  );

  const [aiTokenLogs, setAiTokenLogs] = useState<any[]>(() =>
    getLocalCache<any[]>('ai_token_logs', [])
  );

  const [loadingProducts, setLoadingProducts] = useState<boolean>(true);
  const [loadingTransactions, setLoadingTransactions] = useState<boolean>(true);
  // Always reset quotaExceeded on page load/refresh so upgraded Blaze databases connect live immediately
  const [isQuotaExceeded, setIsQuotaExceeded] = useState<boolean>(() => {
    try {
      sessionStorage.removeItem('riskcart_quota_exhausted');
    } catch {}
    return false;
  });
  const [dismissQuotaBanner, setDismissQuotaBanner] = useState<boolean>(false);
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);

  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const isListeningRef = useRef<boolean>(false);

  const [currency, setCurrencyState] = useState<CurrencyMode>(getCurrencyMode);
  const [exchangeRate, setExchangeRateState] = useState<number>(getExchangeRate);
  const [defaultAiModel, setDefaultAiModelState] = useState<string>(() =>
    loadGlobalDefaultAIModel()
  );
  const [isDemoUser, setIsDemoUser] = useState<boolean>(() => isDemoModeActive());

  const resetDemoData = useCallback(() => {
    resetDemoSandbox();
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const syncModel = () => {
      setDefaultAiModelState(loadGlobalDefaultAIModel());
    };
    const handleDemoModeEvent = () => {
      const active = isDemoModeActive();
      setIsDemoUser(active);
      if (!active) {
        // Restore clean live caches immediately when exiting Demo Mode
        setProducts(getLocalCache<Product[]>('products', []));
        setTransactions(getLocalCache<Transaction[]>('transactions', []));
        setCustomers(getLocalCache<any[]>('customers', []));
        setOrders(getLocalCache<any[]>('orders', []));
        setShifts(getLocalCache<any[]>('shifts', []));
        setCashLogs(getLocalCache<any[]>('cash_logs', []));
        setProcurements(getLocalCache<any[]>('procurements', []));
        setBrangkasTokoLogs(getLocalCache<any[]>('brangkas_toko_logs', []));
      }
      setRefreshTrigger((prev) => prev + 1);
    };
    window.addEventListener('riskcart_ai_instructions_updated', syncModel);
    window.addEventListener('riskcart_demo_mode_changed', handleDemoModeEvent);
    return () => {
      window.removeEventListener('riskcart_ai_instructions_updated', syncModel);
      window.removeEventListener('riskcart_demo_mode_changed', handleDemoModeEvent);
    };
  }, []);

  const setDefaultAiModel = useCallback(async (modelId: string, applyToAllAgents: boolean = true) => {
    const saved = await saveGlobalDefaultAIModel(modelId, applyToAllAgents);
    setDefaultAiModelState(saved);
  }, []);

  useEffect(() => {
    return subscribeCurrency((curr, rate) => {
      setCurrencyState(curr);
      setExchangeRateState(rate);
    });
  }, []);

  const setCurrency = useCallback((curr: CurrencyMode) => {
    setCurrencyModeGlobal(curr);
    setCurrencyState(curr);
  }, []);

  const formatMoney = useCallback(
    (amount: number, baseCurrency: CurrencyMode = 'IDR') =>
      fmtMoney(amount, currency, baseCurrency, exchangeRate),
    [currency, exchangeRate]
  );

  const formatCompactMoneyCb = useCallback(
    (amount: number, baseCurrency: CurrencyMode = 'IDR') =>
      formatCompactMoney(amount, currency, baseCurrency, exchangeRate),
    [currency, exchangeRate]
  );

  const clearQuotaErrorState = useCallback(() => {
    try {
      sessionStorage.removeItem('riskcart_quota_exhausted');
    } catch {}
    setIsQuotaExceeded(false);
    setDismissQuotaBanner(false);
  }, []);

  const handleQuotaDetected = useCallback((err: any, source: string) => {
    if (isQuotaExceededError(err)) {
      console.warn(`[AppDataContext] Firestore quota exceeded on ${source}. Activating offline cache mode.`);
      setIsQuotaExceeded(true);
      setDismissQuotaBanner(false);
    }
  }, []);

  // Helper to normalize Firestore Timestamp or date fields into ISO string
  const normalizeDateValue = (val: any): string => {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (typeof val?.toDate === 'function') {
      try {
        return val.toDate().toISOString();
      } catch {
        return '';
      }
    }
    if (typeof val?.seconds === 'number') {
      return new Date(val.seconds * 1000).toISOString();
    }
    if (val instanceof Date && !isNaN(val.getTime())) {
      return val.toISOString();
    }
    return String(val);
  };

  // 2. Centralized Singleton Listeners for Core Collections (100% Live Cloud Firestore `db`)
  useEffect(() => {
    isListeningRef.current = true;
    let unsubProducts: () => void = () => {};
    let unsubStoreProducts: () => void = () => {};
    let unsubTransactions: () => void = () => {};
    let unsubStoreTransactions: () => void = () => {};
    let unsubCategories: () => void = () => {};
    let unsubBrands: () => void = () => {};
    let unsubCustomers: () => void = () => {};
    let unsubOrders: () => void = () => {};
    let unsubRootOrders: () => void = () => {};

    let rootProductsMap = new Map<string, Product>();
    let storeProductsMap = new Map<string, Product>();

    const mapDocToProduct = (id: string, data: any): Product | null => {
      if (!data || data.isActive === false) return null;
      const piecesPerCarton = Math.max(
        1,
        Number(data.isiPerDus ?? data.itemsPerCarton ?? data.piecesPerCarton ?? 1)
      );
      const weightMl = Number(data.beratPerItem ?? data.weightMl ?? 0);
      const totalBeratKg =
        data.totalBeratKg !== undefined && data.totalBeratKg !== null
          ? Number(data.totalBeratKg)
          : Number(((weightMl * piecesPerCarton) / 1000).toFixed(2));
      const unitCost = Number(data.costPrice ?? data.buyPrice ?? data.modal ?? data.costPerUnit ?? 0);
      const sellByUnit = data.sellByUnit !== undefined ? Boolean(data.sellByUnit) : true;
      const sellPrice = Number(data.posPrice ?? data.sellPrice ?? data.pricePerUnit ?? data.price ?? 0);
      const posPrice = Number(data.posPrice ?? sellPrice);
      const pwaPrice = Number(data.pwaPrice ?? sellPrice);
      const costPerCarton = unitCost;
      const pricePerCarton = sellPrice;
      return {
        id,
        storeId: data.storeId || ACTIVE_STORE_ID,
        name: data.name || data.groupName || 'Produk',
        sku: data.sku || id,
        category: data.category || 'Air Mineral & Galon',
        brand: data.brand || '',
        barcode: data.barcode || '',
        piecesPerCarton,
        isiPerDus: piecesPerCarton,
        weightMl,
        beratPerItem: weightMl,
        totalBeratKg,
        stockInUnits: Number(data.stock ?? data.stockInUnits ?? 0),
        costPerUnit: unitCost,
        costPrice: unitCost,
        buyPrice: unitCost,
        modal: unitCost,
        costPerCarton,
        pricePerUnit: sellPrice,
        posPrice,
        pwaPrice,
        pricePerCarton,
        deliveryCommission: Number(data.deliveryCommission ?? data.komisiPengirim ?? 0),
        komisiPengirim: Number(data.komisiPengirim ?? data.deliveryCommission ?? 0),
        minStockAlert: Number(data.minStockAlert ?? data.minStock ?? getDefaultMinStock()),
        imageUrl: data.imageUrl || '',
        galleryUrls: data.galleryUrls ?? data.galleryImages ?? [],
        variantGroupId: data.variantGroupId,
        groupName: data.groupName,
        variantType: data.variantType,
        variantName: data.variantName,
        productionDate: normalizeDateValue(data.productionDate ?? data.tanggalProduksi ?? ''),
        tanggalProduksi: normalizeDateValue(data.tanggalProduksi ?? data.productionDate ?? ''),
        expiryDate: normalizeDateValue(data.expiryDate ?? data.tanggalKadaluarsa ?? ''),
        tanggalKadaluarsa: normalizeDateValue(data.tanggalKadaluarsa ?? data.expiryDate ?? ''),
        description: data.description || '',
        batchCode: data.batchCode || '',
        batches: Array.isArray(data.batches) ? data.batches : undefined,
        isActive: data.isActive !== false,
        isPosVisible: data.isPosVisible !== false,
        isPwaVisible: data.isPwaVisible !== false,
        sellByUnit,
        createdAt: normalizeDateValue(data.createdAt),
        updatedAt: normalizeDateValue(data.updatedAt),
      } as any;
    };

    const publishMergedProducts = () => {
      const mergedMap = new Map<string, Product>();
      storeProductsMap.forEach((p, id) => mergedMap.set(id, p));
      rootProductsMap.forEach((p, id) => {
        const existing = mergedMap.get(id);
        if (!existing) {
          mergedMap.set(id, p);
        } else {
          const storeTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() || 0 : 0;
          const rootTime = p.updatedAt ? new Date(p.updatedAt).getTime() || 0 : 0;
          mergedMap.set(id, rootTime >= storeTime ? { ...existing, ...p } : { ...p, ...existing });
        }
      });

      const list = Array.from(mergedMap.values()).filter((p) => !isDummySimulationItem(p));
      setProducts(list);
      setLocalCache('products', list);
      clearQuotaErrorState();
      setLoadingProducts(false);
    };

    // A. LISTENERS: Products (`collection(db, 'products')` merged with `collection(db, 'stores', 'store_001', 'products')`)
    try {
      unsubProducts = onSnapshot(
        collection(db, 'products'),
        (snapshot) => {
          const nextMap = new Map<string, Product>();
          snapshot.forEach((d) => {
            const p = mapDocToProduct(d.id, d.data());
            if (p) nextMap.set(d.id, p);
          });
          rootProductsMap = nextMap;
          publishMergedProducts();
        },
        (err) => {
          handleQuotaDetected(err, 'products');
          setLoadingProducts(false);
        }
      );
    } catch {
      setLoadingProducts(false);
    }

    try {
      unsubStoreProducts = onSnapshot(
        collection(db, 'stores', 'store_001', 'products'),
        (snapshot) => {
          const nextMap = new Map<string, Product>();
          snapshot.forEach((d) => {
            const p = mapDocToProduct(d.id, d.data());
            if (p) nextMap.set(d.id, p);
          });
          storeProductsMap = nextMap;
          publishMergedProducts();
        },
        () => {}
      );
    } catch {}

    // B. LISTENERS: Transactions (`collection(db, 'transactions')` + `collection(db, 'stores', 'store_001', 'transactions')` WITHOUT orderBy)
    // & Orders (`collection(db, 'orders')` + `collection(db, 'stores', 'store_001', 'orders')` WITHOUT orderBy)
    let rootTxMap = new Map<string, Transaction>();
    let storeTxMap = new Map<string, Transaction>();
    let storeOrdersMap = new Map<string, any>();
    let rootOrdersMap = new Map<string, any>();

    const normalizeTxDoc = (id: string, raw: any): Transaction => {
      const createdAt =
        normalizeDateValue(raw.orderDate) ||
        normalizeDateValue(raw.createdAt) ||
        normalizeDateValue(raw.timestamp) ||
        normalizeDateValue(raw.date) ||
        normalizeDateValue(raw.updatedAt) ||
        new Date().toISOString();
      const channel = raw.channel || (String(raw.source || '').toUpperCase() === 'PWA' ? 'pwa_client' : 'pos');
      const isPwa =
        channel === 'pwa_client' ||
        channel === 'client_pwa' ||
        channel === 'pwa' ||
        String(raw.source || '').toUpperCase() === 'PWA';
      const defaultCashierName = isPwa
        ? raw.reviewedBy && raw.reviewedBy !== 'Administrator'
          ? raw.reviewedBy
          : 'Order Online (PWA)'
        : 'Muhammad Irfan';

      const totalAmount = Number(
        raw.totalAmount ?? raw.total ?? raw.totalRevenue ?? raw.subtotal ?? 0
      );
      const totalCost = Number(raw.totalCost ?? raw.totalModal ?? 0);
      const totalProfit = Number(
        raw.totalProfit ?? raw.keuntungan ?? Math.max(0, totalAmount - totalCost)
      );

      const rawPm = String(raw.paymentMethod || 'cash').toLowerCase();
      const isDebtOrCod =
        rawPm === 'debt' ||
        rawPm === 'hutang' ||
        rawPm.includes('kasbon') ||
        rawPm.includes('tempo') ||
        rawPm === 'cod';
      const rawPs = String(
        raw.paymentStatus || (isDebtOrCod ? 'unpaid' : 'paid')
      ).toLowerCase();
      const normalizedPaidAmount =
        rawPs === 'paid' || rawPs === 'lunas' || rawPs === 'completed'
          ? totalAmount
          : Math.min(totalAmount, Math.max(0, Number(raw.paidAmount ?? 0)));
      const normalizedRemainingDebt =
        rawPs === 'paid' || rawPs === 'lunas' || rawPs === 'completed'
          ? 0
          : Number(
              raw.remainingDebt !== undefined
                ? raw.remainingDebt
                : Math.max(0, totalAmount - normalizedPaidAmount)
            );
      const normalizedPaymentStatus =
        normalizedRemainingDebt <= 0 && totalAmount > 0 && (rawPs === 'paid' || rawPs === 'lunas' || rawPs === 'completed' || normalizedPaidAmount >= totalAmount)
          ? 'paid'
          : normalizedPaidAmount > 0 && normalizedRemainingDebt > 0
          ? 'partial'
          : rawPs === 'partial' || rawPs === 'dp'
          ? 'partial'
          : rawPs === 'unpaid' || rawPs === 'hutang' || rawPs === 'cod_pending' || rawPs === 'pending' || isDebtOrCod
          ? 'unpaid'
          : 'paid';

      return {
        ...raw,
        id,
        storeId: raw.storeId || ACTIVE_STORE_ID,
        outletId: raw.outletId || 'OUT-01',
        channel,
        source: raw.source || (isPwa ? 'PWA' : 'POS'),
        customerName: raw.customerName || 'General Walk-in Customer',
        total: totalAmount,
        totalAmount,
        totalCost,
        totalModal: totalCost,
        totalProfit,
        keuntungan: totalProfit,
        paymentMethod: raw.paymentMethod || 'cash',
        paymentMethodLabel:
          raw.paymentMethodLabel ||
          (rawPm === 'debt' || rawPm === 'hutang' || rawPm.includes('kasbon') || rawPm.includes('tempo')
            ? 'Hutang'
            : rawPm === 'cod'
            ? 'COD'
            : rawPm === 'qris'
            ? 'QRIS'
            : 'Tunai'),
        paymentStatus: normalizedPaymentStatus,
        paidAmount: normalizedPaidAmount,
        remainingDebt: normalizedRemainingDebt,
        status: raw.status || 'completed',
        fulfillmentStatus: raw.fulfillmentStatus || 'completed',
        fraudScore: Number(raw.fraudScore ?? 5),
        fraudFlags: Array.isArray(raw.fraudFlags) ? raw.fraudFlags : [],
        riskLevel: raw.riskLevel || 'clean',
        cashierId: raw.cashierId || raw.staffId || 'staff_001',
        cashierName: raw.cashierName || raw.cashier || defaultCashierName,
        cashierRole: raw.cashierRole || 'Cashier',
        cashierEmail: raw.cashierEmail || '',
        deliveryStaffId: raw.deliveryStaffId || null,
        deliveryStaffName: raw.deliveryStaffName || null,
        deliveryStaffRole: raw.deliveryStaffRole || null,
        deliveryStaffPhone: raw.deliveryStaffPhone || null,
        deliveryCommission: Number(raw.deliveryCommission ?? 0),
        shiftId: raw.shiftId || '',
        createdAt,
      } as Transaction;
    };

    const getSortableTimestamp = (item: any): number => {
      if (!item) return 0;
      const rawDate = item.orderDate || item.createdAt || item.timestamp || item.date || item.updatedAt || 0;
      const t = new Date(rawDate).getTime();
      return Number.isNaN(t) ? 0 : t;
    };

    const publishMergedTransactions = () => {
      const merged = new Map<string, Transaction>();
      storeTxMap.forEach((tx, id) => merged.set(id, tx));
      rootTxMap.forEach((tx, id) => {
        const existing = merged.get(id);
        merged.set(id, existing ? { ...existing, ...tx } : tx);
      });

      const mergeOrderIntoTx = (ord: any, id: string) => {
        const txKey = ord.transactionId || ord.orderId || id;
        const normalizedOrdTx = normalizeTxDoc(id, ord);
        const existingKey = merged.has(txKey) ? txKey : merged.has(id) ? id : null;
        if (!existingKey) {
          merged.set(id, normalizedOrdTx);
        } else {
          const existing = merged.get(existingKey)!;
          merged.set(existingKey, {
            ...existing,
            paymentStatus: (normalizedOrdTx as any).paymentStatus || (existing as any).paymentStatus,
            paidAmount: (normalizedOrdTx as any).paidAmount ?? (existing as any).paidAmount,
            remainingDebt: (normalizedOrdTx as any).remainingDebt ?? (existing as any).remainingDebt,
            deliveryStaffId: ord.deliveryStaffId ?? (existing as any).deliveryStaffId,
            deliveryStaffName: ord.deliveryStaffName ?? (existing as any).deliveryStaffName,
            deliveryStaffRole: ord.deliveryStaffRole ?? (existing as any).deliveryStaffRole,
            deliveryStaffPhone: ord.deliveryStaffPhone ?? (existing as any).deliveryStaffPhone,
            status: ord.status || (existing as any).status,
            fulfillmentStatus:
              ord.fulfillmentStatus ||
              ord.status ||
              (existing as any).fulfillmentStatus,
          } as Transaction);
        }
      };

      storeOrdersMap.forEach(mergeOrderIntoTx);
      rootOrdersMap.forEach(mergeOrderIntoTx);

      const list = Array.from(merged.values())
        .filter((tx) => !isDummySimulationItem(tx))
        .sort((a: any, b: any) => getSortableTimestamp(b) - getSortableTimestamp(a));

      setTransactions(list);
      setLocalCache('transactions', list);
      clearQuotaErrorState();
      setLoadingTransactions(false);
    };

    try {
      unsubTransactions = onSnapshot(
        collection(db, 'transactions'),
        (snapshot) => {
          const next = new Map<string, Transaction>();
          snapshot.docs.forEach((d) => {
            next.set(d.id, normalizeTxDoc(d.id, d.data()));
          });
          rootTxMap = next;
          publishMergedTransactions();
        },
        (err) => {
          handleQuotaDetected(err, 'transactions');
          setLoadingTransactions(false);
        }
      );
    } catch {
      setLoadingTransactions(false);
    }

    try {
      unsubStoreTransactions = onSnapshot(
        collection(db, 'stores', 'store_001', 'transactions'),
        (snapshot) => {
          const next = new Map<string, Transaction>();
          snapshot.docs.forEach((d) => {
            next.set(d.id, normalizeTxDoc(d.id, d.data()));
          });
          storeTxMap = next;
          publishMergedTransactions();
        },
        () => {}
      );
    } catch {}

    // C. LISTENERS: Categories (`collection(db, 'categories')`) & Brands (`collection(db, 'brands')`)
    try {
      unsubCategories = onSnapshot(
        collection(db, 'categories'),
        (snapshot) => {
          const catNames = snapshot.docs
            .filter((d) => !d.data().deleted)
            .map((d) => String(d.data().name || d.id || '').trim())
            .filter(Boolean);
          const merged = Array.from(new Set(catNames));
          setCategories(merged);
          setLocalCache('categories', merged);
        },
        () => {}
      );
    } catch {}

    try {
      unsubBrands = onSnapshot(
        collection(db, 'brands'),
        (snapshot) => {
          const brandNames = snapshot.docs
            .filter((d) => !d.data().deleted)
            .map((d) => String(d.data().name || d.id || '').trim())
            .filter(Boolean);
          const merged = Array.from(new Set(brandNames));
          setBrands(merged);
          setLocalCache('brands', merged);
        },
        () => {}
      );
    } catch {}

    // D. LISTENERS: Customers (`collection(db, 'customers')`)
    try {
      unsubCustomers = onSnapshot(
        collection(db, 'customers'),
        (snapshot) => {
          const list = snapshot.docs
            .map((d) => ({
              id: d.id,
              ...d.data(),
            }))
            .filter((c) => !isDummySimulationItem(c));
          setCustomers(list);
          setLocalCache('customers', list);
        },
        () => {}
      );
    } catch {}

    // E. LISTENERS: Orders (`collection(db, 'orders')` merged with `collection(db, 'stores', 'store_001', 'orders')` WITHOUT orderBy)
    const publishMergedOrders = () => {
      const merged = new Map<string, any>();
      storeOrdersMap.forEach((ord, id) => merged.set(id, ord));
      rootOrdersMap.forEach((ord, id) => {
        const existing = merged.get(id);
        merged.set(id, existing ? { ...existing, ...ord } : ord);
      });
      const list = Array.from(merged.values())
        .filter((o) => !isDummySimulationItem(o))
        .sort((a: any, b: any) => getSortableTimestamp(b) - getSortableTimestamp(a));
      setOrders(list);
      setLocalCache('orders', list);
      publishMergedTransactions();
    };

    try {
      unsubOrders = onSnapshot(
        collection(db, 'stores', 'store_001', 'orders'),
        (snapshot) => {
          const next = new Map<string, any>();
          snapshot.docs.forEach((d) => {
            const data = d.data();
            next.set(d.id, {
              id: d.id,
              ...data,
              createdAt:
                normalizeDateValue(data.orderDate) ||
                normalizeDateValue(data.createdAt) ||
                normalizeDateValue(data.timestamp) ||
                normalizeDateValue(data.date) ||
                new Date().toISOString(),
            });
          });
          storeOrdersMap = next;
          publishMergedOrders();
        },
        () => {}
      );
    } catch {}

    try {
      unsubRootOrders = onSnapshot(
        collection(db, 'orders'),
        (snapshot) => {
          const next = new Map<string, any>();
          snapshot.docs.forEach((d) => {
            const data = d.data();
            next.set(d.id, {
              id: d.id,
              ...data,
              createdAt:
                normalizeDateValue(data.orderDate) ||
                normalizeDateValue(data.createdAt) ||
                normalizeDateValue(data.timestamp) ||
                normalizeDateValue(data.date) ||
                new Date().toISOString(),
            });
          });
          rootOrdersMap = next;
          publishMergedOrders();
        },
        () => {}
      );
    } catch {}

    // 7. Shifts listener (shifts & shift_history)
    let unsubShifts = () => {};
    try {
      unsubShifts = onSnapshot(
        collection(db, 'shifts'),
        (snapshot) => {
          const list = snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));
          setShifts(list);
          setLocalCache('shifts', list);
        },
        () => {}
      );
    } catch {}

    // 8. Cash Logs listener
    let unsubCashLogs = () => {};
    try {
      unsubCashLogs = onSnapshot(
        collection(db, 'cash_logs'),
        (snapshot) => {
          const list = snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));
          setCashLogs(list);
          setLocalCache('cash_logs', list);
        },
        () => {}
      );
    } catch {}

    // 9. AI Token Logs listener
    let unsubAiLogs = () => {};
    try {
      unsubAiLogs = onSnapshot(
        query(collection(db, 'ai_logs'), orderBy('ts', 'desc'), limit(60)),
        (snapshot) => {
          const list = snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));
          setAiTokenLogs(list);
          setLocalCache('ai_token_logs', list);
        },
        () => {}
      );
    } catch {}

    // 10. Procurements (`purchase_orders`) & Brangkas Toko Logs (`brangkas_toko_logs`) listeners
    let unsubProcurements = () => {};
    try {
      unsubProcurements = onSnapshot(
        collection(db, 'purchase_orders'),
        (snapshot) => {
          const list = snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));
          setProcurements(list);
          setLocalCache('procurements', list);
        },
        () => {}
      );
    } catch {}

    let unsubBrangkasLogs = () => {};
    try {
      unsubBrangkasLogs = onSnapshot(
        collection(db, 'brangkas_toko_logs'),
        (snapshot) => {
          const list = snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));
          setBrangkasTokoLogs(list);
          setLocalCache('brangkas_toko_logs', list);
        },
        () => {}
      );
    } catch {}

    const handleCleanSlateWiped = () => {
      rootProductsMap = new Map<string, Product>();
      storeProductsMap = new Map<string, Product>();
      rootTxMap = new Map<string, Transaction>();
      storeTxMap = new Map<string, Transaction>();
      storeOrdersMap = new Map<string, any>();
      rootOrdersMap = new Map<string, any>();
      setProducts([]);
      setCategories([]);
      setBrands([]);
      setTransactions([]);
      setCustomers([]);
      setOrders([]);
      setShifts([]);
      setCashLogs([]);
      setProcurements([]);
      setBrangkasTokoLogs([]);
      setAiTokenLogs([]);
      feedStockSyncData([], [], []);
    };
    window.addEventListener('riskcart_clean_slate_wiped', handleCleanSlateWiped);

    const handleDemoModeChanged = () => {
      setRefreshTrigger((prev) => prev + 1);
    };
    window.addEventListener('riskcart_demo_mode_changed', handleDemoModeChanged);

    // Cleanup all listeners on unmount
    return () => {
      isListeningRef.current = false;
      window.removeEventListener('riskcart_clean_slate_wiped', handleCleanSlateWiped);
      window.removeEventListener('riskcart_demo_mode_changed', handleDemoModeChanged);
      unsubProducts();
      unsubStoreProducts();
      unsubTransactions();
      unsubStoreTransactions();
      unsubCategories();
      unsubBrands();
      unsubCustomers();
      unsubOrders();
      unsubRootOrders();
      unsubShifts();
      unsubCashLogs();
      unsubProcurements();
      unsubBrangkasLogs();
      unsubAiLogs();
    };
  }, [refreshTrigger, handleQuotaDetected, clearQuotaErrorState]);

  // Synchronize StockSyncService with centralized AppDataContext state (0 extra Firestore reads)
  useEffect(() => {
    feedStockSyncData(products, transactions, orders);
  }, [products, transactions, orders]);

  // Optimistic local mutations so UI updates instantaneously without waiting for Firestore
  const upsertProductLocal = useCallback((prod: Product) => {
    setProducts((prev) => {
      const existingIdx = prev.findIndex((p) => p.id === prod.id || p.sku === prod.sku);
      let updated: Product[];
      if (existingIdx >= 0) {
        updated = [...prev];
        updated[existingIdx] = { ...updated[existingIdx], ...prod };
      } else {
        updated = [prod, ...prev];
      }
      setLocalCache('products', updated);
      return updated;
    });
  }, []);

  const deleteProductLocal = useCallback((id: string) => {
    setProducts((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      setLocalCache('products', updated);
      return updated;
    });
  }, []);

  const addTransactionLocal = useCallback((tx: Transaction) => {
    setTransactions((prev) => {
      const updated = [tx, ...prev.filter((t) => t.id !== tx.id)];
      setLocalCache('transactions', updated);
      return updated;
    });
  }, []);

  const refreshFirestore = useCallback(async () => {
    setIsReconnecting(true);
    try {
      sessionStorage.removeItem('riskcart_quota_exhausted');
      sessionStorage.removeItem('riskcart_conn_verified');
    } catch {}
    try {
      await enableNetwork(db);
    } catch (e) {
      console.warn('[AppDataContext] enableNetwork notice:', e);
    }
    setIsQuotaExceeded(false);
    setDismissQuotaBanner(false);
    setRefreshTrigger((prev) => prev + 1);
    setTimeout(() => setIsReconnecting(false), 600);
  }, []);

  // Two-Way Ecosystem Write & Trigger Sync
  const executeEcosystemWriteAction = useCallback(
    async (
      actionType: EcosystemWriteActionType,
      payload: EcosystemWritePayload
    ): Promise<{ ok: boolean; message: string }> => {
      const nowIso = new Date().toISOString();
      const cashierName = payload.cashierName || 'Admin Utama (Owner)';

      try {
        if (actionType === 'restock_product' || actionType === 'deduct_stock') {
          const targetProd = products.find(
            (p) => p.id === payload.productId || p.sku === payload.productId
          );
          if (!targetProd) {
            return { ok: false, message: 'Produk tidak ditemukan di katalog.' };
          }
          const delta = Math.max(1, Math.round(Number(payload.quantity) || 1));
          const currentStock = Math.max(0, Number(targetProd.stockInUnits || 0));
          const newStock =
            actionType === 'restock_product'
              ? currentStock + delta
              : Math.max(0, currentStock - delta);

          // 1. Update stock in both `products` and `stores/store_001/products` + `stock_movements`
          await updateSynchronizedProductStock(
            targetProd.id,
            newStock,
            actionType === 'restock_product' ? 'ai_page_restock' : 'ai_page_deduction'
          );

          // Optimistic local state update
          upsertProductLocal({
            ...targetProd,
            stockInUnits: newStock,
          });

          // 2. If restock includes cost, record expense to cash_logs, expenses, and vault_entries so LaporanKas & Finance update
          if (actionType === 'restock_product') {
            const unitCost = Number(payload.newCost ?? targetProd.costPerUnit ?? 0);
            const totalRestockCost = Number(payload.amount ?? unitCost * delta);
            if (totalRestockCost > 0) {
              const expId = `EXP-RESTOCK-${Date.now().toString().slice(-6)}`;
              const expDoc = {
                id: expId,
                date: new Date().toLocaleString('id-ID'),
                createdAt: nowIso,
                category: 'Pembelian / Restock Barang',
                recipient: targetProd.name,
                method: 'Kas Toko / Brangkas',
                amount: totalRestockCost,
                cashierName,
                note:
                  payload.note ||
                  `Restock +${delta} Dus ${targetProd.name} (Stok: ${currentStock} -> ${newStock} Dus)`,
              };
              await setDoc(doc(db, 'expenses', expId), expDoc, { merge: true }).catch(() => {});
              await setDoc(
                doc(db, 'cash_logs', expId),
                {
                  ...expDoc,
                  type: 'out',
                  shiftId: payload.shiftId || null,
                },
                { merge: true }
              ).catch(() => {});
              await addDoc(collection(db, 'stores', ACTIVE_STORE_ID, 'vault_entries'), {
                type: 'expense',
                source: 'Restock Barang',
                description: expDoc.note,
                amount: totalRestockCost,
                paymentMethod: 'Cash',
                cashierName,
                date: nowIso,
                createdAt: serverTimestamp(),
              }).catch(() => {});
            }
          }

          return {
            ok: true,
            message: `Stok "${targetProd.name}" berhasil diupdate (${currentStock} → ${newStock} Dus) dan tersinkronisasi ke POS, Client PWA & Laporan Kas!`,
          };
        }

        if (actionType === 'add_cash_in' || actionType === 'add_cash_out') {
          const amountNum = Math.max(0, Number(payload.amount) || 0);
          if (amountNum <= 0) {
            return { ok: false, message: 'Nominal kas harus lebih besar dari 0.' };
          }
          const isCashIn = actionType === 'add_cash_in';
          const logId = `${isCashIn ? 'KAS-IN' : 'KAS-OUT'}-${Date.now().toString().slice(-6)}`;
          const noteText =
            payload.note ||
            (isCashIn ? 'Kas Masuk Operasional (AI Page)' : 'Pengeluaran Kas Operasional (AI Page)');
          const categoryText =
            payload.category || (isCashIn ? 'Kas Masuk Operasional' : 'Biaya Operasional Toko');

          const cashLogDoc = {
            id: logId,
            type: isCashIn ? 'in' : 'out',
            category: categoryText,
            amount: amountNum,
            note: noteText,
            cashierName,
            shiftId: payload.shiftId || null,
            date: new Date().toLocaleString('id-ID'),
            createdAt: nowIso,
          };

          await setDoc(doc(db, 'cash_logs', logId), cashLogDoc, { merge: true }).catch(() => {});

          if (isCashIn) {
            await setDoc(
              doc(db, 'incomes', logId),
              {
                id: logId,
                date: cashLogDoc.date,
                createdAt: nowIso,
                category: categoryText,
                source: cashierName,
                method: 'Kas Kasir Tunai',
                amount: amountNum,
                isReceivableSettlement: categoryText.toLowerCase().includes('piutang'),
                note: noteText,
              },
              { merge: true }
            ).catch(() => {});
          } else {
            await setDoc(
              doc(db, 'expenses', logId),
              {
                id: logId,
                date: cashLogDoc.date,
                createdAt: nowIso,
                category: categoryText,
                recipient: cashierName,
                method: 'Kas Kecil Kasir',
                amount: amountNum,
                approver: cashierName,
                note: noteText,
              },
              { merge: true }
            ).catch(() => {});
          }

          await addDoc(collection(db, 'stores', ACTIVE_STORE_ID, 'vault_entries'), {
            type: isCashIn ? 'income' : 'expense',
            source: categoryText,
            description: noteText,
            amount: amountNum,
            paymentMethod: 'Cash',
            cashierName,
            date: nowIso,
            createdAt: serverTimestamp(),
          }).catch(() => {});

          return {
            ok: true,
            message: `${isCashIn ? 'Kas Masuk' : 'Kas Keluar'} senilai ${fmtMoney(
              amountNum,
              currency
            )} berhasil disimpan ke Keuangan, Shift Kasir, Brangkas, dan Laporan Kas!`,
          };
        }

        if (actionType === 'update_product_price') {
          const targetProd = products.find(
            (p) => p.id === payload.productId || p.sku === payload.productId
          );
          if (!targetProd) {
            return { ok: false, message: 'Produk tidak ditemukan.' };
          }
          const nextPrice =
            payload.newPrice !== undefined && Number(payload.newPrice) > 0
              ? Number(payload.newPrice)
              : targetProd.pricePerUnit;
          const nextCost =
            payload.newCost !== undefined && Number(payload.newCost) > 0
              ? Number(payload.newCost)
              : targetProd.costPerUnit;
          const nextIsi =
            payload.isiPerDus !== undefined && Number(payload.isiPerDus) > 0
              ? Number(payload.isiPerDus)
              : Number(targetProd.isiPerDus || targetProd.piecesPerCarton || 1);
          const nextBeratMl =
            payload.beratPerItem !== undefined && Number(payload.beratPerItem) >= 0
              ? Number(payload.beratPerItem)
              : Number(targetProd.beratPerItem || 0);
          const nextTotalBeratKg = Number(((nextBeratMl * nextIsi) / 1000).toFixed(3));

          const updatePayload = {
            pricePerUnit: nextPrice,
            pricePerCarton: nextPrice,
            posPrice: nextPrice,
            pwaPrice: nextPrice,
            costPerUnit: nextCost,
            costPerCarton: nextCost,
            costPrice: nextCost,
            isiPerDus: nextIsi,
            piecesPerCarton: nextIsi,
            itemsPerCarton: nextIsi,
            beratPerItem: nextBeratMl,
            totalBeratKg: nextTotalBeratKg,
            updatedAt: nowIso,
          };

          await setDoc(doc(db, 'products', targetProd.id), updatePayload, { merge: true });
          await setDoc(
            doc(db, 'stores', ACTIVE_STORE_ID, 'products', targetProd.id),
            updatePayload,
            { merge: true }
          ).catch(() => {});

          upsertProductLocal({
            ...targetProd,
            ...updatePayload,
          });

          return {
            ok: true,
            message: `Data produk "${targetProd.name}" (Harga Jual, Modal, Isi 1 Dus: ${nextIsi}, Total Berat: ${nextTotalBeratKg} kg) berhasil diupdate di POS & Client PWA!`,
          };
        }

        if (actionType === 'update_order_status') {
          const targetOrder = orders.find((o) => o.id === payload.orderId);
          if (!targetOrder) {
            return { ok: false, message: 'Pesanan tidak ditemukan.' };
          }
          const nextStatus = payload.orderStatus || 'Terkirim';
          const orderUpdate = {
            status: nextStatus,
            fulfillmentStatus: nextStatus,
            updatedAt: nowIso,
            cashierName,
          };
          await updateDoc(doc(db, 'orders', targetOrder.id), orderUpdate).catch(() =>
            setDoc(doc(db, 'orders', targetOrder.id), orderUpdate, { merge: true }).catch(() => {})
          );
          await setDoc(
            doc(db, 'stores', ACTIVE_STORE_ID, 'orders', targetOrder.id),
            orderUpdate,
            { merge: true }
          ).catch(() => {});
          await setDoc(doc(db, 'transactions', targetOrder.id), orderUpdate, {
            merge: true,
          }).catch(() => {});
          await setDoc(
            doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', targetOrder.id),
            orderUpdate,
            { merge: true }
          ).catch(() => {});

          if (
            nextStatus === 'completed' ||
            nextStatus.toLowerCase() === 'delivered' ||
            nextStatus.toLowerCase() === 'terkirim'
          ) {
            await reconcileCompletedTransaction(
              targetOrder.id,
              { ...targetOrder, ...orderUpdate },
              'stores/store_001/orders'
            );
          }

          return {
            ok: true,
            message: `Status pesanan #${targetOrder.id} berhasil diupdate menjadi "${nextStatus}" dan tersinkronisasi dengan stok & kas!`,
          };
        }

        return { ok: false, message: 'Tipe aksi tidak dikenali.' };
      } catch (err: any) {
        return {
          ok: false,
          message: err?.message || 'Gagal menjalankan aksi sinkronisasi 2 arah.',
        };
      }
    },
    [products, orders, currency, upsertProductLocal]
  );

  // Compute real-time pending PWA / online orders queue from Firestore `orders` & `transactions`
  const pendingPwaOrders = useMemo(() => {
    const queueMap = new Map<string, any>();

    const isPendingPwaRecord = (rec: any): boolean => {
      if (!rec || isLegacyMockOrderOrTx(rec, rec.id)) return false;
      const ch = String(rec.channel || '').toLowerCase();
      const src = String(rec.source || '').toUpperCase();
      const isPwaChannel =
        ch === 'pwa' ||
        ch === 'pwa_client' ||
        ch === 'client_pwa' ||
        ch === 'whatsapp' ||
        src === 'PWA';
      if (!isPwaChannel) return false;

      const st = String(rec.status || '').toLowerCase();
      const fs = String(rec.fulfillmentStatus || '').toLowerCase();
      const doneStatuses = [
        'completed',
        'delivered',
        'shipped',
        'packing',
        'diproses',
        'selesai',
        'cancelled',
        'rejected',
        'returned',
        'void',
      ];
      if (doneStatuses.includes(st) || doneStatuses.includes(fs)) return false;

      return ['pending', 'menunggu', 'antrean', 'new', 'pending_approval'].includes(st);
    };

    // 1. Check `orders` collection (`orders` + `stores/{storeId}/orders`)
    orders.forEach((ord) => {
      if (isPendingPwaRecord(ord)) {
        const key = ord.canonicalSyncKey || ord.orderNumber || ord.transactionId || ord.id;
        queueMap.set(key, ord);
      }
    });

    // 2. Also check `transactions` collection for any pending_approval PWA orders not yet in queueMap
    transactions.forEach((tx: any) => {
      if (isPendingPwaRecord(tx)) {
        const key = tx.canonicalSyncKey || tx.orderNumber || tx.orderId || tx.id;
        if (!queueMap.has(key) && !queueMap.has(tx.id) && !(tx.orderId && queueMap.has(tx.orderId))) {
          queueMap.set(key, tx);
        }
      }
    });

    return Array.from(queueMap.values()).sort((a, b) => {
      const ta = new Date(a.createdAt || a.timestamp || 0).getTime();
      const tb = new Date(b.createdAt || b.timestamp || 0).getTime();
      return tb - ta;
    });
  }, [orders, transactions]);

  const pendingPwaCount = pendingPwaOrders.length;

  const wipeAllFirestoreData = useCallback(
    async (forceRun: boolean = true): Promise<{ success: boolean; deletedCount: number }> => {
      const activeItemsSnapshot = {
        products,
        orders,
        transactions,
        customers,
        shifts,
        cashLogs,
        categories,
        brands,
      };
      setProducts([]);
      setCategories([]);
      setBrands([]);
      setTransactions([]);
      setCustomers([]);
      setOrders([]);
      setShifts([]);
      setCashLogs([]);
      setAiTokenLogs([]);
      feedStockSyncData([], [], []);
      if (isDemoModeActive()) {
        resetDemoSandbox();
        return { success: true, deletedCount: 0 };
      }
      return runWipeAllFirestoreData(forceRun, activeItemsSnapshot);
    },
    [products, orders, transactions, customers, shifts, cashLogs, categories, brands]
  );

  const forceWipeAllDatabaseExceptOwner = useCallback(
    async (forceRun: boolean = false): Promise<{ success: boolean; deletedCount: number }> => {
      return wipeAllFirestoreData(forceRun);
    },
    [wipeAllFirestoreData]
  );

  const contextValue = useMemo<AppDataContextValue>(
    () => ({
      products,
      categories,
      brands,
      transactions,
      customers,
      orders,
      pendingPwaOrders,
      pendingPwaCount,
      shifts,
      cashLogs,
      procurements,
      brangkas_toko_logs: brangkasTokoLogs,
      brangkasLogs: brangkasTokoLogs,
      staff: [],
      currencyMode: currency,
      aiTokenLogs,
      loadingProducts,
      loadingTransactions,
      isQuotaExceeded,
      dismissQuotaBanner,
      setDismissQuotaBanner,
      upsertProductLocal,
      deleteProductLocal,
      addTransactionLocal,
      executeEcosystemWriteAction,
      refreshFirestore,
      currency,
      setCurrency,
      exchangeRate,
      formatMoney,
      formatCompactMoney: formatCompactMoneyCb,
      defaultAiModel,
      globalAiModel: defaultAiModel,
      setDefaultAiModel,
      wipeAllFirestoreData,
      forceWipeAllDatabaseExceptOwner,
      isDemoUser,
      resetDemoData,
    }),
    [
      products,
      categories,
      brands,
      transactions,
      customers,
      orders,
      pendingPwaOrders,
      pendingPwaCount,
      shifts,
      cashLogs,
      procurements,
      brangkasTokoLogs,
      aiTokenLogs,
      loadingProducts,
      loadingTransactions,
      isQuotaExceeded,
      dismissQuotaBanner,
      upsertProductLocal,
      deleteProductLocal,
      addTransactionLocal,
      executeEcosystemWriteAction,
      refreshFirestore,
      currency,
      setCurrency,
      exchangeRate,
      formatMoney,
      formatCompactMoneyCb,
      defaultAiModel,
      setDefaultAiModel,
      wipeAllFirestoreData,
      forceWipeAllDatabaseExceptOwner,
      isDemoUser,
      resetDemoData,
    ]
  );

  return (
    <AppDataContext.Provider value={contextValue}>
      {/* Non-intrusive Quota Exceeded / Offline Cache Alert Banner */}
      {isQuotaExceeded && !dismissQuotaBanner && (
        <div className="bg-amber-950/90 border-b border-amber-600/60 px-4 py-2 text-xs text-amber-200 flex items-center justify-between z-50 sticky top-0 backdrop-blur-md shadow-md animate-in fade-in">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span className="font-bold">Mode Offline / Cache Aktif:</span>
            <span>
              Kuota baca Cloud Firestore harian tercapai (*Resource Exhausted*). Data transaksi dan katalog produk dimuat dari cache lokal perangkat agar operasional kasir tetap dapat berjalan 100%.
            </span>
          </div>
          <div className="flex items-center gap-2 ml-4 shrink-0">
            <button
              onClick={() => void refreshFirestore()}
              disabled={isReconnecting}
              className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold text-[11px] cursor-pointer transition shadow-sm flex items-center gap-1.5"
            >
              {isReconnecting ? 'Menghubungkan...' : 'Hubungkan Ulang ke Cloud'}
            </button>
          </div>
        </div>
      )}
      {children}
    </AppDataContext.Provider>
  );
};

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) {
    throw new Error('useAppData must be used within an AppDataProvider');
  }
  return ctx;
}
