import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  enableNetwork,
  where,
} from 'firebase/firestore';
import {
  db,
  isDemoModeActive,
  resetDemoSandbox,
  markFirestoreQuotaExhausted,
} from '../firebase';
import { Product, Transaction } from '../types';
import { ACTIVE_STORE_ID } from '../config/store';
import { subscribeRealtimeEvent } from '../utils/realtimeSyncBus';
import {
  sanitizeForDatabase,
  syncDocToDatabase,
  autoResyncLocalCachesToServer,
} from '../utils/dbSync';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_BRANDS,
  normalizeCategoryKey,
  toCategorySlug,
  getDeletedCategorySlugs,
  updateMasterCategory,
  deleteMasterCategory,
  deduplicateCategories as runDeduplicateCategories,
} from '../services/masterDataService';
import {
  wipeAllFirestoreData as runWipeAllFirestoreData,
  forceWipeAllDatabaseExceptOwner as runForceWipeAllDatabaseExceptOwner,
  performSafeFactoryReset,
  restoreMissingMasterDatabase,
  purgeTransactionsBeforeDate,
  purgeTodayShiftTransactions as runPurgeTodayShiftTransactions,
  purgeFictitiousDatabaseEntries,
  isFictitiousDoc,
  isDocFromTargetDateOrShift,
  getTodayJakartaYmd,
  extractDocTimestamp,
  type PurgeResult,
  isLegacyMockOrderOrTx,
} from '../services/dataSeeder';
import {
  ARABIAN_FOOD_CATEGORIES,
  ARABIAN_FOOD_PRODUCTS,
  ensureArabianFoodMasterSynced,
} from '../services/rawMaterialService';
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
import {
  POSSettings,
  DEFAULT_POS_SETTINGS,
  GlobalSettings,
  DEFAULT_GLOBAL_SETTINGS,
  StoreSettings,
  DEFAULT_STORE_SETTINGS,
  PaymentGatewayConfig,
  DEFAULT_PAYMENT_GATEWAY_CONFIG,
} from '../types/settings';
import {
  recordTransactionInDailyStats,
  getTodayDateYmd,
} from '../services/dailyStatsService';

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
    receipt.startsWith('ORD-PWA-880') ||
    isFictitiousDoc(id, item)
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

    if (Array.isArray(parsedFs) && parsedFs.length > 0) {
      const cleaned = parsedFs.filter((item) => !isDummySimulationItem(item));
      if (cleaned.length > 0) return cleaned as unknown as T;
    }
    if (Array.isArray(parsedCache) && parsedCache.length > 0) {
      const cleaned = parsedCache.filter((item) => !isDummySimulationItem(item));
      if (cleaned.length > 0) return cleaned as unknown as T;
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
      ? data.filter((item) => !isDummySimulationItem(item)).slice(0, 120)
      : data;
    const serialized = JSON.stringify(cleaned);
    // In Demo Sandbox mode, never overwrite persistent localStorage cache with sandbox mutations
    if (isDemoModeActive()) {
      sessionStorage.setItem(`riskcart_demo_cache_${key}`, serialized);
      return;
    }
    localStorage.setItem(`riskcart_cache_${key}`, serialized);
  } catch (e) {
    // Quota of localStorage exceeded or private mode, ignore safely
  }
}

// Check if error is Firestore quota exceeded (strictly error.code === 'resource-exhausted')
export function isQuotaExceededError(error: any): boolean {
  return error?.code === 'resource-exhausted';
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
  rewardTargets: any[];
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
  wipeAllFirestoreData: (
    forceRun?: boolean,
    mode?: 'transactions_only' | 'full_with_reseed'
  ) => Promise<{ success: boolean; deletedCount: number }>;
  forceWipeAllDatabaseExceptOwner: (forceRun?: boolean) => Promise<{ success: boolean; deletedCount: number }>;
  resetAllData: (
    mode?: 'transactions_only' | 'full_with_reseed'
  ) => Promise<{ success: boolean; deletedCount: number }>;
  restoreDatabase: () => Promise<{ restored: string[] }>;
  purgeTransactionsBefore: (
    cutoffDate?: string,
    onProgress?: (msg: string) => void
  ) => Promise<PurgeResult>;
  purgeOldTransactions: (
    cutoffDate?: string,
    onProgress?: (msg: string) => void
  ) => Promise<PurgeResult>;
  purgeTodayShiftTransactions: (
    targetDateYmd?: string,
    onProgress?: (msg: string) => void
  ) => Promise<PurgeResult>;
  updateCategory: (
    categoryId: string,
    oldName: string,
    newName: string,
    icon?: string
  ) => Promise<void>;
  deleteCategory: (categoryId: string, categoryName?: string) => Promise<void>;
  deduplicateCategories: () => Promise<{ removedCount: number; keptCount: number }>;
  cleanFictitiousData: (
    onProgress?: (msg: string) => void
  ) => Promise<{ deletedCount: number }>;
  isDemoUser: boolean;
  resetDemoData: () => void;
  posSettings: POSSettings;
  globalSettings: GlobalSettings;
  storeSettings: StoreSettings;
  paymentGatewayConfig: PaymentGatewayConfig;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export const AppDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Cache-First initialization from localStorage with fallback to master catalog
  const [products, setProducts] = useState<Product[]>(() =>
    getLocalCache<Product[]>('products', ARABIAN_FOOD_PRODUCTS as unknown as Product[])
  );
  const [categories, setCategories] = useState<string[]>(() =>
    getLocalCache<string[]>('categories', [...ARABIAN_FOOD_CATEGORIES])
  );
  const [brands, setBrands] = useState<string[]>(() =>
    getLocalCache<string[]>('brands', [
      'Al-Barakah Kitchen',
      'La Bella Italia Kitchen',
      'Merlion Singapore Kitchen',
      'Selera Nusantara Kitchen',
    ])
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
  const [rewardTargets, setRewardTargets] = useState<any[]>(() => {
    try {
      const raw =
        localStorage.getItem('riskcart_reward_targets') ||
        localStorage.getItem('riskcart_marketing_targets') ||
        localStorage.getItem('riskcart_fs_marketing_targets');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    let rewardDocs: any[] = [];
    let marketingDocs: any[] = [];

    const syncMergedTargets = () => {
      const map = new Map<string, any>();
      [...rewardDocs, ...marketingDocs].forEach((t) => {
        if (t && t.id && !t.isDeleted) {
          map.set(String(t.id), t);
        }
      });
      if (map.size > 0) {
        const merged = Array.from(map.values());
        setRewardTargets(merged);
        try {
          localStorage.setItem('riskcart_reward_targets', JSON.stringify(merged));
        } catch {}
      }
    };

    const unsubReward = onSnapshot(
      query(collection(db, 'reward_targets'), where('storeId', '==', ACTIVE_STORE_ID), limit(50)),
      (snap) => {
        rewardDocs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        syncMergedTargets();
      },
      () => {}
    );

    const unsubMarketing = onSnapshot(
      query(collection(db, 'marketing_targets'), where('storeId', '==', ACTIVE_STORE_ID), limit(50)),
      (snap) => {
        marketingDocs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        syncMergedTargets();
      },
      () => {}
    );

    const handleCustomUpdate = (e: any) => {
      if (e?.detail && Array.isArray(e.detail)) {
        setRewardTargets(e.detail);
      }
    };
    window.addEventListener('riskcart:reward-targets-updated', handleCustomUpdate);

    return () => {
      unsubReward();
      unsubMarketing();
      window.removeEventListener('riskcart:reward-targets-updated', handleCustomUpdate);
    };
  }, []);

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

  // Real-time synchronized store settings (`settings/pos`, `settings/global`, `settings/store`, `settings/payment_gateways`)
  const [posSettings, setPosSettings] = useState<POSSettings>(DEFAULT_POS_SETTINGS);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>(DEFAULT_GLOBAL_SETTINGS);
  const [storeSettings, setStoreSettings] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [paymentGatewayConfig, setPaymentGatewayConfig] = useState<PaymentGatewayConfig>(
    DEFAULT_PAYMENT_GATEWAY_CONFIG
  );

  useEffect(() => {
    const mergeToPos = (patch: Partial<POSSettings>) => {
      setPosSettings((prev) => ({ ...prev, ...patch }));
    };

    const unsubStorePos = onSnapshot(
      doc(db, 'stores', ACTIVE_STORE_ID, 'settings', 'pos'),
      (snap) => {
        if (snap.exists()) {
          mergeToPos(snap.data() as Partial<POSSettings>);
        }
      },
      () => {}
    );
    const unsubRootPos = onSnapshot(
      doc(db, 'settings', 'pos'),
      (snap) => {
        if (snap.exists()) {
          mergeToPos(snap.data() as Partial<POSSettings>);
        }
      },
      () => {}
    );
    const unsubStoreProfile = onSnapshot(
      doc(db, 'settings', 'store'),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as Partial<StoreSettings>;
          setStoreSettings((prev) => ({ ...prev, ...d }));
          mergeToPos(d as Partial<POSSettings>);
        }
      },
      () => {}
    );
    const unsubGlobal = onSnapshot(
      doc(db, 'settings', 'global'),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as Partial<GlobalSettings>;
          setGlobalSettings((prev) => ({ ...prev, ...d }));
          mergeToPos(d as Partial<POSSettings>);
        }
      },
      () => {}
    );
    const unsubGateways = onSnapshot(
      doc(db, 'settings', 'payment_gateways'),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as Partial<PaymentGatewayConfig>;
          setPaymentGatewayConfig((prev) => ({
            ...prev,
            ...d,
            midtrans: { ...prev.midtrans, ...(d.midtrans || {}) },
            xendit: { ...prev.xendit, ...(d.xendit || {}) },
            tripay: { ...prev.tripay, ...(d.tripay || {}) },
            doku: { ...prev.doku, ...(d.doku || {}) },
          }));
        }
      },
      () => {}
    );

    return () => {
      unsubStorePos();
      unsubRootPos();
      unsubStoreProfile();
      unsubGlobal();
      unsubGateways();
    };
  }, []);

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
      console.warn(
        `[AppDataContext] Firestore quota exceeded on ${source}. Operating 100% from local cache (IndexedDB/LocalStorage).`
      );
      markFirestoreQuotaExhausted(true);
      setIsQuotaExceeded(true);
      // Load from local cache immediately so POS cashier & Admin never halt
      setProducts((prev) =>
        prev.length > 0
          ? prev
          : getLocalCache<Product[]>('products', ARABIAN_FOOD_PRODUCTS as unknown as Product[])
      );
      setCategories((prev) =>
        prev.length > 0 ? prev : getLocalCache<string[]>('categories', [...ARABIAN_FOOD_CATEGORIES])
      );
      setBrands((prev) =>
        prev.length > 0
          ? prev
          : getLocalCache<string[]>('brands', [
              'Al-Barakah Kitchen',
              'La Bella Italia Kitchen',
              'Merlion Singapore Kitchen',
              'Selera Nusantara Kitchen',
            ])
      );
      setTransactions((prev) =>
        prev.length > 0 ? prev : getLocalCache<Transaction[]>('transactions', [])
      );
      setOrders((prev) => (prev.length > 0 ? prev : getLocalCache<any[]>('orders', [])));
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

  // 2. Centralized Singleton Listeners for Core Collections (Cache-First + Quota-Safe Cloud Firestore `db`)
  useEffect(() => {
    isListeningRef.current = true;

    if (typeof window !== 'undefined') {
      void ensureArabianFoodMasterSynced();
      void autoResyncLocalCachesToServer();

      // Local-only normalization (zero extra Firestore getDocs scans to conserve quota)
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;
          const rawVal = localStorage.getItem(key);
          if (rawVal && /muhammad\s+irfan/i.test(rawVal)) {
            localStorage.setItem(
              key,
              rawVal.replace(/muhammad\s+irfan/gi, 'Dede Fajar Kurniawan')
            );
          }
        }
      } catch {}
    }

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
      if (!data || data.isActive === false || isFictitiousDoc(id, data)) return null;
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
      const rawCat = String(data.category || '').trim();
      const cleanCat =
        rawCat && rawCat.toLowerCase() !== 'other' && !/^cat_default_\d+$/i.test(rawCat)
          ? rawCat
          : '';
      const hasRawMaterials = Boolean(
        data.hasRawMaterials ||
          (Array.isArray(data.rawMaterialRecipe) && data.rawMaterialRecipe.length > 0)
      );
      const rawStockVal = Number(data.stock ?? data.stockInUnits ?? 0);
      const effectiveStock = hasRawMaterials ? Math.max(999, rawStockVal) : rawStockVal;
      return {
        id,
        storeId: data.storeId || ACTIVE_STORE_ID,
        name: data.name || data.groupName || 'Produk',
        sku: data.sku || id,
        category: cleanCat,
        brand: data.brand || '',
        barcode: data.barcode || '',
        piecesPerCarton,
        isiPerDus: piecesPerCarton,
        weightMl,
        beratPerItem: weightMl,
        totalBeratKg,
        stockInUnits: effectiveStock,
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
        hasRawMaterials,
        autoDeductRawMaterial: data.autoDeductRawMaterial !== false,
        rawMaterialRecipe: Array.isArray(data.rawMaterialRecipe) ? data.rawMaterialRecipe : [],
        createdAt: normalizeDateValue(data.createdAt),
        updatedAt: normalizeDateValue(data.updatedAt),
      } as any;
    };

    const getDeletedSet = (colName: string): Set<string> => {
      try {
        if (typeof window === 'undefined') return new Set();
        const raw = window.localStorage.getItem(`riskcart_deleted_fs_${colName}_v1`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return new Set(parsed.map(String));
        }
      } catch {}
      return new Set();
    };

    const publishMergedProducts = () => {
      const deletedProducts = getDeletedSet('products');
      const mergedMap = new Map<string, Product>();

      // Baseline Arabian Food BOM catalog (unless deleted by user)
      for (const seedProd of ARABIAN_FOOD_PRODUCTS) {
        const mappedSeed = mapDocToProduct(seedProd.id, seedProd);
        if (
          mappedSeed &&
          !deletedProducts.has(seedProd.id) &&
          !deletedProducts.has(String(seedProd.sku || ''))
        ) {
          mergedMap.set(seedProd.id, mappedSeed);
        }
      }

      storeProductsMap.forEach((p, id) => {
        if (!deletedProducts.has(id) && !deletedProducts.has(String(p.sku || ''))) {
          mergedMap.set(id, p);
        }
      });
      rootProductsMap.forEach((p, id) => {
        if (deletedProducts.has(id) || deletedProducts.has(String(p.sku || ''))) return;
        const existing = mergedMap.get(id);
        if (!existing) {
          mergedMap.set(id, p);
        } else {
          const storeTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() || 0 : 0;
          const rootTime = p.updatedAt ? new Date(p.updatedAt).getTime() || 0 : 0;
          mergedMap.set(id, rootTime >= storeTime ? { ...existing, ...p } : { ...p, ...existing });
        }
      });

      const list = Array.from(mergedMap.values()).filter(
        (p) =>
          !isDummySimulationItem(p) &&
          !deletedProducts.has(String(p.id || '')) &&
          !deletedProducts.has(String(p.sku || ''))
      );
      setProducts(list);
      setLocalCache('products', list);
      clearQuotaErrorState();
      setLoadingProducts(false);
    };

    // A. ONE SHARED LISTENER: Products (`collection(db, 'products')` with where('storeId','==',storeId) + limit(250))
    try {
      unsubProducts = onSnapshot(
        query(collection(db, 'products'), where('storeId', '==', ACTIVE_STORE_ID), limit(250)),
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
        : 'Dede Fajar Kurniawan';

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
        cashierName: String(raw.cashierName || raw.cashier || defaultCashierName).replace(
          /muhammad\s+irfan/gi,
          'Dede Fajar Kurniawan'
        ),
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
      const deletedTx = getDeletedSet('transactions');
      const deletedOrders = getDeletedSet('orders');
      const merged = new Map<string, Transaction>();

      // Include locally cached offline transactions first so offline POS sales are never lost
      const cachedLocalTx = getLocalCache<Transaction[]>('transactions', []);
      cachedLocalTx.forEach((tx) => {
        if (tx?.id && !deletedTx.has(tx.id) && !deletedOrders.has(tx.id)) {
          merged.set(tx.id, tx);
        }
      });

      storeTxMap.forEach((tx, id) => {
        if (!deletedTx.has(id) && !deletedOrders.has(id)) merged.set(id, tx);
      });
      rootTxMap.forEach((tx, id) => {
        if (deletedTx.has(id) || deletedOrders.has(id)) return;
        const existing = merged.get(id);
        merged.set(id, existing ? { ...existing, ...tx } : tx);
      });

      const mergeOrderIntoTx = (ord: any, id: string) => {
        const txKey = ord.transactionId || ord.orderId || id;
        if (
          deletedTx.has(id) ||
          deletedTx.has(String(txKey)) ||
          deletedOrders.has(id) ||
          deletedOrders.has(String(txKey))
        ) {
          return;
        }
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
        .filter(
          (tx) =>
            !isDummySimulationItem(tx) &&
            !deletedTx.has(String(tx.id || '')) &&
            !deletedOrders.has(String(tx.id || ''))
        )
        .sort((a: any, b: any) => getSortableTimestamp(b) - getSortableTimestamp(a));

      setTransactions(list);
      setLocalCache('transactions', list);
      clearQuotaErrorState();
      setLoadingTransactions(false);
    };

    // B. ONE SHARED LISTENER FOR TODAY'S TRANSACTIONS: default query = today's date range + storeId + limit(50)
    const todayStartIso = `${getTodayDateYmd()}T00:00:00.000Z`;
    try {
      unsubTransactions = onSnapshot(
        query(
          collection(db, 'transactions'),
          where('storeId', '==', ACTIVE_STORE_ID),
          where('createdAt', '>=', todayStartIso),
          limit(50)
        ),
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

    // C. LISTENERS: Categories (`collection(db, 'categories')`) & Brands (`collection(db, 'brands')`) with storeId + limit(100)
    try {
      unsubCategories = onSnapshot(
        query(collection(db, 'categories'), where('storeId', '==', ACTIVE_STORE_ID), limit(100)),
        (snapshot) => {
          const deletedSet = getDeletedCategorySlugs();
          const uniqueByNormKey = new Map<string, string>();
          for (const seedCat of ARABIAN_FOOD_CATEGORIES) {
            const normKey = normalizeCategoryKey(seedCat);
            const slug = toCategorySlug(seedCat);
            if (
              normKey &&
              slug &&
              !deletedSet.has(slug) &&
              !deletedSet.has(normKey) &&
              !deletedSet.has(seedCat.toLowerCase())
            ) {
              uniqueByNormKey.set(normKey, seedCat);
            }
          }
          snapshot.docs
            .filter((d) => !d.data().deleted && !isFictitiousDoc(d.id, d.data()))
            .forEach((d) => {
              const name = String(d.data().name || '').trim();
              if (!name || name.toLowerCase() === 'other' || /^cat_default_\d+$/i.test(name)) return;
              const normKey = normalizeCategoryKey(name);
              const slug = toCategorySlug(name);
              if (
                !normKey ||
                !slug ||
                deletedSet.has(slug) ||
                deletedSet.has(normKey) ||
                deletedSet.has(name.toLowerCase())
              ) {
                return;
              }
              if (!uniqueByNormKey.has(normKey) || d.id === `cat_${slug}`) {
                uniqueByNormKey.set(normKey, name);
              }
            });
          const merged = Array.from(uniqueByNormKey.values()).sort((a, b) =>
            a.localeCompare(b, 'id', { sensitivity: 'base' })
          );
          setCategories(merged);
          setLocalCache('categories', merged);
        },
        () => {}
      );
    } catch {}

    try {
      unsubBrands = onSnapshot(
        query(collection(db, 'brands'), where('storeId', '==', ACTIVE_STORE_ID), limit(100)),
        (snapshot) => {
          const brandNames = snapshot.docs
            .filter((d) => !d.data().deleted && !isFictitiousDoc(d.id, d.data()))
            .map((d) => String(d.data().name || '').trim())
            .filter((n) => Boolean(n) && !/^brand_default_\d+$/i.test(n));
          const merged = Array.from(new Set(brandNames));
          setBrands(merged);
          setLocalCache('brands', merged);
        },
        () => {}
      );
    } catch {}

    // D. LISTENERS: Customers (`collection(db, 'customers')`) with where('storeId','==',storeId) + limit(100)
    try {
      unsubCustomers = onSnapshot(
        query(collection(db, 'customers'), where('storeId', '==', ACTIVE_STORE_ID), limit(100)),
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

    // E. LISTENERS: Orders (`collection(db, 'orders')` merged with `collection(db, 'stores', 'store_001', 'orders')` with limit(50))
    const publishMergedOrders = () => {
      const deletedOrders = getDeletedSet('orders');
      const deletedTx = getDeletedSet('transactions');
      const merged = new Map<string, any>();

      // Preserve locally cached orders so offline creations are retained
      const cachedLocalOrders = getLocalCache<any[]>('orders', []);
      cachedLocalOrders.forEach((ord) => {
        if (ord?.id && !deletedOrders.has(ord.id) && !deletedTx.has(ord.id)) {
          merged.set(ord.id, ord);
        }
      });

      storeOrdersMap.forEach((ord, id) => {
        if (!deletedOrders.has(id) && !deletedTx.has(id)) merged.set(id, ord);
      });
      rootOrdersMap.forEach((ord, id) => {
        if (deletedOrders.has(id) || deletedTx.has(id)) return;
        const existing = merged.get(id);
        merged.set(id, existing ? { ...existing, ...ord } : ord);
      });
      const list = Array.from(merged.values())
        .filter(
          (o) =>
            !isDummySimulationItem(o) &&
            !deletedOrders.has(String(o.id || '')) &&
            !deletedTx.has(String(o.id || ''))
        )
        .sort((a: any, b: any) => getSortableTimestamp(b) - getSortableTimestamp(a));
      setOrders(list);
      setLocalCache('orders', list);
      publishMergedTransactions();
    };

    try {
      unsubRootOrders = onSnapshot(
        query(collection(db, 'orders'), where('storeId', '==', ACTIVE_STORE_ID), limit(50)),
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
        (err) => {
          handleQuotaDetected(err, 'orders');
        }
      );
    } catch {}

    // 7. Shifts listener (shifts with where('storeId','==',storeId) + limit(50))
    let unsubShifts = () => {};
    try {
      unsubShifts = onSnapshot(
        query(collection(db, 'shifts'), where('storeId', '==', ACTIVE_STORE_ID), limit(50)),
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

    // 8. Cash Logs listener with where('storeId','==',storeId) + limit(50)
    let unsubCashLogs = () => {};
    try {
      unsubCashLogs = onSnapshot(
        query(collection(db, 'cash_logs'), where('storeId', '==', ACTIVE_STORE_ID), limit(50)),
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

    // 9. AI Token Logs listener with where('storeId','==',storeId) + limit(50)
    let unsubAiLogs = () => {};
    try {
      unsubAiLogs = onSnapshot(
        query(collection(db, 'ai_logs'), where('storeId', '==', ACTIVE_STORE_ID), limit(50)),
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

    // 10. Procurements (`purchase_orders`) & Brangkas Toko Logs (`brangkas_toko_logs`) listeners with where('storeId','==',storeId) + limit(50)
    let unsubProcurements = () => {};
    try {
      unsubProcurements = onSnapshot(
        query(collection(db, 'purchase_orders'), where('storeId', '==', ACTIVE_STORE_ID), limit(50)),
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
        query(collection(db, 'brangkas_toko_logs'), where('storeId', '==', ACTIVE_STORE_ID), limit(50)),
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
    const cleanProd = sanitizeForDatabase(prod);
    setProducts((prev) => {
      const existingIdx = prev.findIndex((p) => p.id === cleanProd.id || p.sku === cleanProd.sku);
      let updated: Product[];
      if (existingIdx >= 0) {
        updated = [...prev];
        updated[existingIdx] = { ...updated[existingIdx], ...cleanProd };
      } else {
        updated = [cleanProd, ...prev];
      }
      setLocalCache('products', updated);
      return updated;
    });
    if (cleanProd?.id) {
      void syncDocToDatabase('products', String(cleanProd.id), cleanProd);
      if (ACTIVE_STORE_ID) {
        void syncDocToDatabase(`stores/${ACTIVE_STORE_ID}/products`, String(cleanProd.id), cleanProd);
      }
    }
  }, []);

  useEffect(() => {
    const handleProductPricingSynced = (evt: Event) => {
      const detail = (evt as CustomEvent)?.detail;
      if (detail?.updatedPayload && detail?.productId) {
        upsertProductLocal(detail.updatedPayload as Product);
      }
    };
    window.addEventListener('riskcart:product-pricing-synced', handleProductPricingSynced);
    return () => {
      window.removeEventListener('riskcart:product-pricing-synced', handleProductPricingSynced);
    };
  }, [upsertProductLocal]);

  const deleteProductLocal = useCallback((id: string) => {
    setProducts((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      setLocalCache('products', updated);
      return updated;
    });
  }, []);

  const addTransactionLocal = useCallback((tx: Transaction) => {
    const cleanTx = sanitizeForDatabase(tx);
    setTransactions((prev) => {
      const updated = [cleanTx, ...prev.filter((t) => t.id !== cleanTx.id)];
      setLocalCache('transactions', updated);
      return updated;
    });
    if (cleanTx?.id) {
      void syncDocToDatabase('transactions', String(cleanTx.id), cleanTx);
      if (ACTIVE_STORE_ID) {
        void syncDocToDatabase(`stores/${ACTIVE_STORE_ID}/transactions`, String(cleanTx.id), cleanTx);
      }
      // Update summary doc dailyStats/{storeId}_{YYYYMMDD} using increment() when transaction is saved
      void recordTransactionInDailyStats(cleanTx as any, ACTIVE_STORE_ID);
    }

    // Also persist transaction to Cloud SQL in background when authenticated
    try {
      const token =
        sessionStorage.getItem('riskcart_server_session_token') ||
        localStorage.getItem('riskcart_server_session_token') ||
        '';
      if (token && tx) {
        fetch('/api/db/transactions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            transactionNumber: (tx as any).receiptNo || (tx as any).orderNumber || tx.id,
            channel: tx.channel || 'pos',
            paymentMethod: tx.paymentMethod || 'cash',
            totalAmount: tx.totalAmount || 0,
            status: tx.status || 'completed',
            cashierName: (tx as any).cashierName || (tx as any).cashier || 'Cashier',
            customerName: (tx as any).customerName || undefined,
            items: tx.items || [],
            aiRiskLevel: tx.riskLevel || 'clean',
            aiFraudScore: tx.fraudScore || 0,
          }),
        }).catch(() => {});
      }
    } catch {}
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
    void autoResyncLocalCachesToServer();
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
      const idStr = String(rec.id || rec.orderNumber || '').toUpperCase();
      const pmStr = String(rec.paymentMethod || '').toLowerCase();
      const psStr = String(rec.paymentStatus || '').toLowerCase();

      const isWaiterOrTableOrder =
        idStr.startsWith('ORD-WTR-') ||
        pmStr.includes('waiter') ||
        pmStr.includes('dine-in') ||
        Boolean(rec.tableId || rec.tableNumber);

      const isPwaChannel =
        ch === 'pwa' ||
        ch === 'pwa_client' ||
        ch === 'client_pwa' ||
        ch === 'whatsapp' ||
        src === 'PWA' ||
        (isWaiterOrTableOrder && psStr !== 'paid' && psStr !== 'lunas');
      if (!isPwaChannel) return false;

      const st = String(rec.status || '').toLowerCase();
      const fs = String(rec.fulfillmentStatus || '').toLowerCase();
      const doneStatuses = [
        'completed',
        'delivered',
        'terkirim',
        'selesai',
        'cancelled',
        'rejected',
        'returned',
        'void',
      ];
      if (doneStatuses.includes(st) || doneStatuses.includes(fs)) return false;
      if (psStr === 'paid' || psStr === 'lunas') return false;

      if (isWaiterOrTableOrder) {
        return true;
      }

      const nonPendingPwaStatuses = ['shipped', 'packing', 'diproses', 'sedang mengemas', 'dikirim'];
      if (nonPendingPwaStatuses.includes(st) || nonPendingPwaStatuses.includes(fs)) return false;

      return ['pending', 'menunggu', 'antrean', 'new', '1. new', 'pending_approval'].includes(st);
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

  // Listen to cross-tab real-time sync bus so state updates immediately across open browser tabs
  useEffect(() => {
    const unsubOrders = subscribeRealtimeEvent('orders_updated', (payload: any) => {
      if (!payload) return;
      if (payload.newOrder && payload.newOrder.id) {
        setOrders((prev) => {
          const exists = prev.some((o: any) => o.id === payload.newOrder.id);
          const next = exists
            ? prev.map((o: any) => (o.id === payload.newOrder.id ? { ...o, ...payload.newOrder } : o))
            : [payload.newOrder, ...prev];
          setLocalCache('orders', next);
          return next;
        });
      } else if (payload.orderId) {
        setOrders((prev) => {
          const next = prev.map((o: any) =>
            o.id === payload.orderId || o.orderNumber === payload.orderId
              ? { ...o, ...payload }
              : o
          );
          setLocalCache('orders', next);
          return next;
        });
      }
    });

    const unsubTx = subscribeRealtimeEvent('transactions_updated', (payload: any) => {
      if (payload?.transaction) {
        addTransactionLocal(payload.transaction);
      }
    });

    const unsubProd = subscribeRealtimeEvent('products_updated', (payload: any) => {
      if (payload?.product) {
        upsertProductLocal(payload.product);
      }
    });

    return () => {
      unsubOrders();
      unsubTx();
      unsubProd();
    };
  }, [addTransactionLocal, upsertProductLocal]);

  const wipeAllFirestoreData = useCallback(
    async (
      forceRun: boolean = true,
      mode: 'transactions_only' | 'full_with_reseed' = 'transactions_only'
    ): Promise<{ success: boolean; deletedCount: number }> => {
      if (!forceRun) return { success: true, deletedCount: 0 };

      setTransactions([]);
      setOrders([]);
      setShifts([]);
      setCashLogs([]);
      setProcurements([]);
      setBrangkasTokoLogs([]);
      setAiTokenLogs([]);

      if (mode === 'full_with_reseed') {
        setProducts([]);
        setCategories([]);
        setBrands([]);
        setCustomers([]);
        feedStockSyncData([], [], []);
      } else {
        feedStockSyncData(products, [], []);
      }

      if (isDemoModeActive()) {
        resetDemoSandbox(mode);
        return { success: true, deletedCount: 0 };
      }

      const res = await performSafeFactoryReset({ mode });
      setRefreshTrigger((prev) => prev + 1);
      return { success: res.success, deletedCount: res.deletedCount };
    },
    [products]
  );

  const forceWipeAllDatabaseExceptOwner = useCallback(
    async (forceRun: boolean = false): Promise<{ success: boolean; deletedCount: number }> => {
      return wipeAllFirestoreData(forceRun, 'transactions_only');
    },
    [wipeAllFirestoreData]
  );

  const resetAllData = useCallback(
    async (
      mode: 'transactions_only' | 'full_with_reseed' = 'transactions_only'
    ): Promise<{
      success: boolean;
      deletedCount: number;
    }> => {
      return wipeAllFirestoreData(true, mode);
    },
    [wipeAllFirestoreData]
  );

  const restoreDatabase = useCallback(async (): Promise<{ restored: string[] }> => {
    const res = await restoreMissingMasterDatabase();
    setRefreshTrigger((prev) => prev + 1);
    return res;
  }, []);

  const purgeTransactionsBefore = useCallback(
    async (
      cutoffDate: string = '2026-10-27T00:00:00+07:00',
      onProgress?: (msg: string) => void
    ): Promise<PurgeResult> => {
      const normalizedIso =
        cutoffDate.length === 10 ? `${cutoffDate}T00:00:00+07:00` : cutoffDate;
      const cutoffMs = new Date(normalizedIso).getTime();

      const res = await purgeTransactionsBeforeDate(normalizedIso, onProgress);

      if (!isNaN(cutoffMs)) {
        const keepOnOrAfterCutoff = (item: any) => {
          const t = extractDocTimestamp(item || {});
          return t === null || t >= cutoffMs;
        };
        setTransactions((prev) => prev.filter(keepOnOrAfterCutoff));
        setOrders((prev) => prev.filter(keepOnOrAfterCutoff));
        setShifts((prev) => prev.filter(keepOnOrAfterCutoff));
        setCashLogs((prev) => prev.filter(keepOnOrAfterCutoff));
        setProcurements((prev) => prev.filter(keepOnOrAfterCutoff));
        setBrangkasTokoLogs((prev) => prev.filter(keepOnOrAfterCutoff));
      }

      setRefreshTrigger((prev) => prev + 1);
      return res;
    },
    []
  );

  const purgeTodayShiftTransactions = useCallback(
    async (
      targetDateYmd?: string,
      onProgress?: (msg: string) => void
    ): Promise<PurgeResult> => {
      const targetYmd =
        targetDateYmd && targetDateYmd.length >= 10
          ? targetDateYmd.slice(0, 10)
          : getTodayJakartaYmd();
      let activeShiftId = '';
      try {
        const rawShift =
          localStorage.getItem('riskcart_active_shift') ||
          localStorage.getItem('riskcart_active_open_shift');
        if (rawShift) {
          const parsed = JSON.parse(rawShift);
          if (parsed?.id) activeShiftId = String(parsed.id);
        }
      } catch {}

      const keepNotTodayOrActiveShift = (item: any) =>
        !isDocFromTargetDateOrShift(item || {}, targetYmd, activeShiftId, item?.id);

      setTransactions((prev) => prev.filter(keepNotTodayOrActiveShift));
      setOrders((prev) => prev.filter(keepNotTodayOrActiveShift));
      setShifts((prev) => prev.filter(keepNotTodayOrActiveShift));
      setCashLogs((prev) => prev.filter(keepNotTodayOrActiveShift));
      setBrangkasTokoLogs((prev) => prev.filter(keepNotTodayOrActiveShift));

      const res = await runPurgeTodayShiftTransactions(targetYmd, onProgress);
      setRefreshTrigger((prev) => prev + 1);
      return res;
    },
    []
  );

  // Auto-purge on page load disabled to prevent full-collection Firestore reads on startup

  const updateCategory = useCallback(
    async (categoryId: string, oldName: string, newName: string, icon?: string) => {
      const cleanNew = (newName || '').trim();
      const oldSlug = toCategorySlug(oldName || categoryId);
      await updateMasterCategory(categoryId, oldName, cleanNew, icon);
      setCategories((prev) => {
        const nextMap = new Map<string, string>();
        prev.forEach((c) => {
          const s = toCategorySlug(c);
          if (!s) return;
          if (s === oldSlug || c === categoryId) {
            nextMap.set(toCategorySlug(cleanNew), cleanNew);
          } else {
            nextMap.set(s, c);
          }
        });
        nextMap.set(toCategorySlug(cleanNew), cleanNew);
        return Array.from(nextMap.values()).sort((a, b) =>
          a.localeCompare(b, 'id', { sensitivity: 'base' })
        );
      });
      setProducts((prev) =>
        prev.map((p) =>
          toCategorySlug(p.category || '') === oldSlug
            ? { ...p, category: cleanNew }
            : p
        )
      );
    },
    []
  );

  const deleteCategory = useCallback(
    async (categoryId: string, categoryName?: string) => {
      const targetName = categoryName || categoryId;
      const targetSlug = toCategorySlug(targetName);
      const idSlug = toCategorySlug(categoryId);
      setCategories((prev) =>
        prev.filter((c) => {
          const s = toCategorySlug(c);
          return s !== targetSlug && s !== idSlug && c !== categoryId && c !== targetName;
        })
      );
      setProducts((prev) =>
        prev.map((p) => {
          const pSlug = toCategorySlug(p.category || '');
          return pSlug === targetSlug || pSlug === idSlug ? { ...p, category: '' } : p;
        })
      );
      await deleteMasterCategory(categoryId, targetName);
    },
    []
  );

  const deduplicateCategories = useCallback(async () => {
    return runDeduplicateCategories();
  }, []);

  const cleanFictitiousData = useCallback(
    async (onProgress?: (msg: string) => void) => {
      const res = await purgeFictitiousDatabaseEntries(
        { removeUnusedCategoriesAndBrands: true },
        onProgress
      );
      setRefreshTrigger((prev) => prev + 1);
      return res;
    },
    []
  );

  // Auto-clean fictitious entries on initialization disabled to avoid full-collection Firestore reads on page load

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
      rewardTargets,
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
      resetAllData,
      restoreDatabase,
      purgeTransactionsBefore,
      purgeOldTransactions: purgeTransactionsBefore,
      purgeTodayShiftTransactions,
      updateCategory,
      deleteCategory,
      deduplicateCategories,
      cleanFictitiousData,
      isDemoUser,
      resetDemoData,
      posSettings,
      globalSettings,
      storeSettings,
      paymentGatewayConfig,
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
      rewardTargets,
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
      resetAllData,
      restoreDatabase,
      purgeTransactionsBefore,
      purgeTodayShiftTransactions,
      updateCategory,
      deleteCategory,
      deduplicateCategories,
      cleanFictitiousData,
      isDemoUser,
      resetDemoData,
      posSettings,
      globalSettings,
      storeSettings,
      paymentGatewayConfig,
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
