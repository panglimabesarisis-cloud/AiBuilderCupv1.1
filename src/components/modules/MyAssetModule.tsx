import React, { useState, useMemo, useEffect } from 'react';
import {
  Vault,
  Package,
  TrendingUp,
  DollarSign,
  Layers,
  AlertTriangle,
  Truck,
  Users,
  RefreshCw,
  Download,
  Printer,
  Plus,
  Search,
  Edit2,
  Trash2,
  Building2,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  PieChart,
  ShieldCheck,
  Wallet,
  Boxes,
  Clock,
  X,
  Save,
  ExternalLink,
  Filter,
  Calendar,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { doc, updateDoc, setDoc, addDoc, deleteDoc, collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppData } from '../../context/AppDataContext';
import { useFirestoreList } from '../../hooks/useFirestoreList';
import { isDatabaseWipeInProgress } from '../../services/dataSeeder';
import { useAppNavigation } from '../../router';
import { useLanguage } from '../../context/LanguageContext';
import { ACTIVE_STORE_ID } from '../../config/store';
import { Product } from '../../types';
import { formatMoney } from '../../utils/money';
import {
  evaluateProductExpiry,
  CATEGORY_EXPIRY_RULES,
  normalizeToInputDate,
  getActiveProductBatches,
  mergeBatchIntoProduct,
} from '../../utils/expiryUtils';
import { AIAssetAndStockAnalytics } from './AIAssetAndStockAnalytics';
import { getDefaultMinStock } from '../../services/posRuntime';

interface MyAssetModuleProps {
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string, sub?: string) => void;
}

interface FixedAssetItem {
  id: string;
  name: string;
  code: string;
  category: 'Peralatan Toko' | 'Elektronik & Kasir' | 'Pendingin / Chiller' | 'Kendaraan' | 'Properti & Rak' | 'Lainnya';
  qty: number;
  purchaseCost: number;
  currentValue: number;
  condition: 'Baik' | 'Perlu Servis' | 'Rusak';
  acquiredDate: string;
  location: string;
  notes?: string;
  updatedAt?: string;
}

const toIdr = (val: unknown): number => {
  const num = Number(val) || 0;
  if (!Number.isFinite(num) || num === 0) return 0;
  return num > 0 && num < 500 ? Math.round(num * 15000) : Math.round(num);
};

export const MyAssetModule: React.FC<MyAssetModuleProps> = () => {
  const { tr, currencyMode } = useLanguage();
  const { navigateToPath } = useAppNavigation();

  // 1. Live Cloud Firestore Data from AppDataContext
  const {
    products: ctxProducts,
    transactions: ctxTransactions,
    orders: ctxOrders,
    customers: ctxCustomers,
    categories: ctxCategories,
    refreshFirestore,
  } = useAppData();
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // 2. Live Auxiliary Firestore Collections (0% Dummy Data - Empty Array Fallbacks)
  const { data: storeTransactions } = useFirestoreList<any>(`stores/${ACTIVE_STORE_ID}/transactions`, []);
  const { data: storeCustomers, updateItem: updateStoreCustomer } = useFirestoreList<any>(
    `stores/${ACTIVE_STORE_ID}/customers`,
    []
  );
  const {
    data: safeDeposits,
    addItem: addSafeDeposit,
    deleteItem: deleteSafeDeposit,
  } = useFirestoreList<any>('safe_deposits', []);
  const { data: cashFlows } = useFirestoreList<any>('cash_flows', []);
  const { data: shiftKasMasuk } = useFirestoreList<any>('shift_kas_masuk', []);
  const { data: shiftKasKeluar } = useFirestoreList<any>('shift_kas_keluar', []);
  const { data: purchaseOrders, updateItem: updatePurchaseOrder } = useFirestoreList<any>(
    'purchase_orders',
    []
  );
  const {
    data: fixedAssets,
    addItem: addFixedAsset,
    updateItem: updateFixedAsset,
    deleteItem: deleteFixedAsset,
  } = useFirestoreList<FixedAssetItem>('store_fixed_assets', []);

  // Store opening cash metadata from Firestore 'stores'
  const [openingCash, setOpeningCash] = useState<number>(0);
  const [storeName, setStoreName] = useState<string>('RiskCart Store');

  useEffect(() => {
    const handleCleanSlate = () => {
      setOpeningCash(0);
    };
    window.addEventListener('riskcart_clean_slate_wiped', handleCleanSlate);

    const unsub = onSnapshot(
      collection(db, 'stores'),
      (snap) => {
        if (isDatabaseWipeInProgress()) {
          snap.docs.forEach((d) => void deleteDoc(d.ref).catch(() => {}));
          setOpeningCash(0);
          return;
        }
        const docMatch = snap.docs.find((d) => d.id === ACTIVE_STORE_ID) || snap.docs[0];
        if (docMatch) {
          const d = docMatch.data() as any;
          setOpeningCash(toIdr(d.openingCash ?? d.openingFloat ?? 0));
          if (d.name || d.storeName) setStoreName(d.name || d.storeName);
        } else {
          setOpeningCash(0);
        }
      },
      () => {}
    );
    return () => {
      window.removeEventListener('riskcart_clean_slate_wiped', handleCleanSlate);
      unsub();
    };
  }, []);

  // UI Tabs & Filters
  const [activeTab, setActiveTab] = useState<
    'inventory_asset' | 'fixed_asset' | 'cash_vault' | 'receivables_payables'
  >('inventory_asset');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [stockStatusFilter, setStockStatusFilter] = useState<
    'ALL' | 'PRODUCTIVE' | 'DEAD_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
  >('ALL');
  const [sortBy, setSortBy] = useState<
    'cost_desc' | 'retail_desc' | 'margin_desc' | 'stock_desc' | 'name_asc'
  >('cost_desc');
  const [flashMsg, setFlashMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setFlashMsg(msg);
    setTimeout(() => setFlashMsg(null), 4000);
  };

  // Modal: Quick Edit Product Asset (HPP, Selling Price, Physical Stock, Production & Expiry Date)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editCostPerUnit, setEditCostPerUnit] = useState<string>('0');
  const [editPricePerUnit, setEditPricePerUnit] = useState<string>('0');
  const [editStockUnits, setEditStockUnits] = useState<string>('0');
  const [editPiecesPerCarton, setEditPiecesPerCarton] = useState<string>('1');
  const [editProductionDate, setEditProductionDate] = useState<string>('');
  const [editExpiryDate, setEditExpiryDate] = useState<string>('');
  const [isSavingProduct, setIsSavingProduct] = useState<boolean>(false);
  const [expiryBoxFilter, setExpiryBoxFilter] = useState<'ALL' | 'NEAR_EXPIRY' | 'CRITICAL' | 'SAFE'>('ALL');

  // State: TOTAL ASSET STATISTIK ASSET CHART (Month+Year Filter & Curve Toggles)
  const assetChartMonthOptions = useMemo(() => {
    const monthNamesId = [
      'JANUARI',
      'FEBRUARI',
      'MARET',
      'APRIL',
      'MEI',
      'JUNI',
      'JULI',
      'AGUSTUS',
      'SEPTEMBER',
      'OKTOBER',
      'NOVEMBER',
      'DESEMBER',
    ];
    const now = new Date();
    const baseYear = now.getFullYear() >= 2026 ? now.getFullYear() : 2026;
    const baseMonth = now.getFullYear() >= 2026 ? now.getMonth() : 9; // default Oktober 2026 (index 9)
    const list: { value: string; label: string; year: number; monthIndex: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(baseYear, baseMonth - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const val = `${y}-${String(m + 1).padStart(2, '0')}`;
      list.push({
        value: val,
        label: `${monthNamesId[m]} ${y}`,
        year: y,
        monthIndex: m,
      });
    }
    return list;
  }, []);

  const [selectedAssetChartMonth, setSelectedAssetChartMonth] = useState<string>(
    () => assetChartMonthOptions[0]?.value || '2026-10'
  );
  const [visibleAssetCurves, setVisibleAssetCurves] = useState<{
    nilaiJualStok: boolean;
    modalStok: boolean;
    kasBrankas: boolean;
    piutangPelanggan: boolean;
    utangPemasok: boolean;
  }>({
    nilaiJualStok: true,
    modalStok: true,
    kasBrankas: true,
    piutangPelanggan: true,
    utangPemasok: true,
  });

  const toggleAssetCurve = (key: keyof typeof visibleAssetCurves) => {
    setVisibleAssetCurves((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Modal: Add / Edit Fixed Store Asset (`store_fixed_assets`)
  const [showFixedAssetModal, setShowFixedAssetModal] = useState<boolean>(false);
  const [editingFixedAsset, setEditingFixedAsset] = useState<FixedAssetItem | null>(null);
  const [faName, setFaName] = useState<string>('');
  const [faCode, setFaCode] = useState<string>('');
  const [faCategory, setFaCategory] = useState<FixedAssetItem['category']>('Peralatan Toko');
  const [faQty, setFaQty] = useState<string>('1');
  const [faPurchaseCost, setFaPurchaseCost] = useState<string>('0');
  const [faCurrentValue, setFaCurrentValue] = useState<string>('0');
  const [faCondition, setFaCondition] = useState<FixedAssetItem['condition']>('Baik');
  const [faAcquiredDate, setFaAcquiredDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [faLocation, setFaLocation] = useState<string>('Outlet Utama');
  const [faNotes, setFaNotes] = useState<string>('');

  // Modal: Add Brankas Mutation (`safe_deposits`)
  const [showVaultModal, setShowVaultModal] = useState<boolean>(false);
  const [vaultType, setVaultType] = useState<'SETORAN_BRANKAS' | 'MUTASI_MODAL' | 'ALOKASI_LABA'>(
    'SETORAN_BRANKAS'
  );
  const [vaultAmount, setVaultAmount] = useState<string>('0');
  const [vaultFrom, setVaultFrom] = useState<string>('Kasir Laci POS');
  const [vaultTo, setVaultTo] = useState<string>('Brankas Toko');
  const [vaultNote, setVaultNote] = useState<string>('');

  // Format currency helper (reactive to global IDR <-> USD switcher & live exchange rate from src/utils/money.ts)
  const fmtRp = (val: number) => {
    const safe = Number.isFinite(val) ? val : 0;
    return formatMoney(safe, currencyMode);
  };

  // Deduplicate all live transactions & orders to compute product velocity and cash revenue
  const allValidTransactions = useMemo(() => {
    const map = new Map<string, any>();
    [...ctxTransactions, ...storeTransactions, ...ctxOrders].forEach((rec) => {
      if (!rec) return;
      const id = String(rec.transactionId || rec.orderId || rec.id || '');
      if (!id) return;
      const st = String(rec.status || rec.orderStatus || 'completed').toLowerCase();
      if (
        st === 'void' ||
        st === 'cancelled' ||
        st === 'canceled' ||
        st === 'rejected' ||
        st === 'returned' ||
        st === 'dibatalkan'
      ) {
        return;
      }
      if (!map.has(id)) {
        map.set(id, rec);
      }
    });
    return Array.from(map.values());
  }, [ctxTransactions, storeTransactions, ctxOrders]);

  // Compute sold units per product from live transactions & orders
  const productSalesMap = useMemo(() => {
    const soldByProdId = new Map<string, { qtySold: number; revenue: number }>();
    const soldByProdName = new Map<string, { qtySold: number; revenue: number }>();

    allValidTransactions.forEach((tx) => {
      const items = Array.isArray(tx.items) ? tx.items : [];
      items.forEach((it: any) => {
        const pid = String(it.productId || it.id || '');
        const pname = String(it.productName || it.name || '')
          .trim()
          .toLowerCase();
        const rawQty = Number(it.quantityInUnits ?? it.quantityOrdered ?? it.qty ?? it.quantity ?? 0);
        const lineRev = toIdr(
          it.subtotal ??
            rawQty * toIdr(it.unitPrice ?? it.sellingPrice ?? it.price ?? 0)
        );

        if (pid) {
          const prev = soldByProdId.get(pid) || { qtySold: 0, revenue: 0 };
          soldByProdId.set(pid, {
            qtySold: prev.qtySold + rawQty,
            revenue: prev.revenue + lineRev,
          });
        }
        if (pname) {
          const prev = soldByProdName.get(pname) || { qtySold: 0, revenue: 0 };
          soldByProdName.set(pname, {
            qtySold: prev.qtySold + rawQty,
            revenue: prev.revenue + lineRev,
          });
        }
      });
    });

    return { soldByProdId, soldByProdName };
  }, [allValidTransactions]);

  // Enrich live products with asset valuation metrics
  const enrichedProducts = useMemo(() => {
    return ctxProducts.map((p) => {
      const stockUnits = Math.max(0, Number(p.stockInUnits ?? (p as any).stock ?? 0));
      const pcsPerCarton = Math.max(1, Number(p.piecesPerCarton ?? (p as any).itemsPerCarton ?? 1));
      const cartons = stockUnits / pcsPerCarton;
      const costPerUnit = toIdr(p.costPerUnit ?? (p as any).costPrice ?? 0);
      const pricePerUnit = toIdr(p.pricePerUnit ?? (p as any).sellPrice ?? (p as any).posPrice ?? 0);
      const minAlert = Number(p.minStockAlert ?? (p as any).minStock ?? getDefaultMinStock());

      const totalAssetCost = stockUnits * costPerUnit;
      const totalAssetRetail = stockUnits * pricePerUnit;
      const potentialMargin = totalAssetRetail - totalAssetCost;
      const marginPct =
        totalAssetRetail > 0
          ? Number(((potentialMargin / totalAssetRetail) * 100).toFixed(1))
          : 0;

      const salesStat =
        productSalesMap.soldByProdId.get(p.id) ||
        productSalesMap.soldByProdId.get(p.sku) ||
        productSalesMap.soldByProdName.get((p.name || '').trim().toLowerCase()) || {
          qtySold: 0,
          revenue: 0,
        };

      let assetStatus: 'PRODUCTIVE' | 'DEAD_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' = 'PRODUCTIVE';
      if (stockUnits <= 0) {
        assetStatus = 'OUT_OF_STOCK';
      } else if (stockUnits <= minAlert) {
        assetStatus = 'LOW_STOCK';
      } else if (salesStat.qtySold <= 0) {
        assetStatus = 'DEAD_STOCK';
      }

      const expiryEval = evaluateProductExpiry({
        ...p,
        stockInUnits: stockUnits,
      });

      return {
        ...p,
        stockInUnits: stockUnits,
        piecesPerCarton: pcsPerCarton,
        cartonsEquivalent: cartons,
        costPerUnit,
        pricePerUnit,
        minStockAlert: minAlert,
        totalAssetCost,
        totalAssetRetail,
        potentialMargin,
        marginPct,
        qtySold: salesStat.qtySold,
        realizedRevenue: salesStat.revenue,
        assetStatus,
        expiryEval,
      };
    });
  }, [ctxProducts, productSalesMap]);

  // Available categories for filter
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    ctxCategories.forEach((c) => {
      if (c) set.add(c.toUpperCase());
    });
    enrichedProducts.forEach((p) => {
      if (p.category) set.add(p.category.toUpperCase());
    });
    return Array.from(set).sort();
  }, [ctxCategories, enrichedProducts]);

  // Filtered & sorted product asset rows
  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = enrichedProducts.filter((p) => {
      if (selectedCategory !== 'ALL' && (p.category || '').toUpperCase() !== selectedCategory) {
        return false;
      }
      if (stockStatusFilter !== 'ALL' && p.assetStatus !== stockStatusFilter) {
        return false;
      }
      if (q) {
        const matchName = (p.name || '').toLowerCase().includes(q);
        const matchSku = (p.sku || '').toLowerCase().includes(q);
        const matchBarcode = String(p.barcode || '').toLowerCase().includes(q);
        const matchCat = (p.category || '').toLowerCase().includes(q);
        if (!matchName && !matchSku && !matchBarcode && !matchCat) return false;
      }
      return true;
    });

    return list.sort((a, b) => {
      if (sortBy === 'cost_desc') return b.totalAssetCost - a.totalAssetCost;
      if (sortBy === 'retail_desc') return b.totalAssetRetail - a.totalAssetRetail;
      if (sortBy === 'margin_desc') return b.potentialMargin - a.potentialMargin;
      if (sortBy === 'stock_desc') return b.stockInUnits - a.stockInUnits;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [enrichedProducts, searchQuery, selectedCategory, stockStatusFilter, sortBy]);

  // 3. Comprehensive Store Asset & Balance Sheet Aggregations (100% Real Firestore)
  const assetSummary = useMemo(() => {
    // A. Inventory Asset Valuation
    const totalInventoryCost = enrichedProducts.reduce((s, p) => s + p.totalAssetCost, 0);
    const totalInventoryRetail = enrichedProducts.reduce((s, p) => s + p.totalAssetRetail, 0);
    const totalPotentialProfit = totalInventoryRetail - totalInventoryCost;
    const avgInventoryMarginPct =
      totalInventoryRetail > 0
        ? Number(((totalPotentialProfit / totalInventoryRetail) * 100).toFixed(1))
        : 0;
    const totalUnitsInStock = enrichedProducts.reduce((s, p) => s + p.stockInUnits, 0);
    const totalCartonsInStock = enrichedProducts.reduce((s, p) => s + p.cartonsEquivalent, 0);

    // Health breakdown
    const productiveProducts = enrichedProducts.filter((p) => p.assetStatus === 'PRODUCTIVE');
    const deadStockProducts = enrichedProducts.filter((p) => p.assetStatus === 'DEAD_STOCK');
    const lowStockProducts = enrichedProducts.filter((p) => p.assetStatus === 'LOW_STOCK');
    const outOfStockProducts = enrichedProducts.filter((p) => p.assetStatus === 'OUT_OF_STOCK');

    const productiveCapital = productiveProducts.reduce((s, p) => s + p.totalAssetCost, 0);
    const deadStockCapital = deadStockProducts.reduce((s, p) => s + p.totalAssetCost, 0);
    const lowStockCapital = lowStockProducts.reduce((s, p) => s + p.totalAssetCost, 0);

    // B. Cash, POS Drawer & Vault Assets
    let cashSalesTotal = 0;
    let nonCashSalesTotal = 0;
    let realizedCogsTotal = 0;
    let debtTxTotal = 0;

    allValidTransactions.forEach((tx) => {
      const amt = toIdr(tx.totalAmount ?? tx.subtotal ?? 0);
      const cogs = toIdr(tx.totalCost ?? 0);
      realizedCogsTotal += cogs;

      const method = String(tx.paymentMethod || 'cash').toLowerCase();
      const payStatus = String(tx.paymentStatus || 'paid').toLowerCase();
      if (method === 'debt' || method === 'kasbon' || payStatus === 'unpaid') {
        debtTxTotal += amt;
      } else if (method === 'cash' || method === 'tunai' || method === 'cod') {
        cashSalesTotal += amt;
      } else {
        nonCashSalesTotal += amt;
      }
    });

    const totalKasMasuk = shiftKasMasuk.reduce((s, item) => s + toIdr(item.amount ?? item.nominal ?? 0), 0);
    const totalKasKeluar = shiftKasKeluar.reduce((s, item) => s + toIdr(item.amount ?? item.nominal ?? 0), 0);

    let cashFlowIn = 0;
    let cashFlowOut = 0;
    cashFlows.forEach((cf) => {
      const amt = toIdr(cf.amount ?? cf.nominal ?? 0);
      const t = String(cf.type || cf.category || '').toUpperCase();
      if (t.includes('OUT') || t.includes('KELUAR') || t.includes('EXPENSE') || t.includes('BIAYA')) {
        cashFlowOut += amt;
      } else {
        cashFlowIn += amt;
      }
    });

    const vaultSafeDrops = safeDeposits
      .filter((d) => !d.type || d.type === 'SETORAN_BRANKAS')
      .reduce((s, d) => s + toIdr(d.amount ?? 0), 0);
    const vaultModalReserve = safeDeposits
      .filter((d) => d.type === 'MUTASI_MODAL')
      .reduce((s, d) => s + toIdr(d.amount ?? 0), 0);
    const vaultProfitAllocated = safeDeposits
      .filter((d) => d.type === 'ALOKASI_LABA')
      .reduce((s, d) => s + toIdr(d.amount ?? 0), 0);

    const cashInDrawer = Math.max(
      0,
      openingCash + cashSalesTotal + totalKasMasuk + cashFlowIn - totalKasKeluar - cashFlowOut
    );
    const totalLiquidCashAndVault =
      cashInDrawer + nonCashSalesTotal + vaultSafeDrops + vaultModalReserve;

    // C. Customer Receivables (Piutang Pelanggan)
    const mergedCustomerDebts = new Map<string, any>();
    [...ctxCustomers, ...storeCustomers].forEach((c) => {
      if (!c) return;
      const key = String(c.id || c.phone || c.name || '');
      if (!key) return;
      const debt = toIdr(c.debtAmount ?? c.hutang ?? 0);
      if (debt > 0) {
        mergedCustomerDebts.set(key, {
          ...c,
          id: c.id || key,
          debtAmount: debt,
          creditLimit: toIdr(c.creditLimit ?? 0),
          debtAgeDays: Number(c.debtAgeDays ?? 0),
        });
      }
    });
    const customerDebtList = Array.from(mergedCustomerDebts.values());
    const customerDebtFromDocs = customerDebtList.reduce((s, c) => s + c.debtAmount, 0);
    const totalReceivables = Math.max(customerDebtFromDocs, debtTxTotal);

    // D. Supplier Payables (Hutang Dagang PO Supplier)
    const unpaidPurchaseOrders = purchaseOrders
      .map((po) => {
        const total = toIdr(po.totalAmount ?? 0);
        const paid = toIdr(
          po.paidAmount ??
            (String(po.paymentStatus || '')
              .toLowerCase()
              .includes('tempo') ||
            String(po.paymentStatus || '')
              .toLowerCase()
              .includes('hutang') ||
            String(po.paymentStatus || '')
              .toLowerCase()
              .includes('belum')
              ? 0
              : total)
        );
        const remaining =
          po.remainingDebt !== undefined
            ? toIdr(po.remainingDebt)
            : Math.max(0, total - paid);
        const isTempo =
          remaining > 0 ||
          String(po.paymentStatus || '')
            .toLowerCase()
            .includes('tempo') ||
          String(po.paymentStatus || '')
            .toLowerCase()
            .includes('hutang') ||
          String(po.paymentStatus || '')
            .toLowerCase()
            .includes('belum');
        return {
          ...po,
          totalAmountIdr: total,
          paidAmountIdr: paid,
          remainingDebtIdr: isTempo ? (remaining > 0 ? remaining : total) : 0,
          isUnpaid: isTempo && (remaining > 0 || paid < total),
        };
      })
      .filter((po) => po.isUnpaid && po.remainingDebtIdr > 0);

    const totalSupplierPayables = unpaidPurchaseOrders.reduce(
      (s, po) => s + po.remainingDebtIdr,
      0
    );

    // E. Fixed Store Assets (`store_fixed_assets`)
    const totalFixedAssetAcquisition = fixedAssets.reduce(
      (s, a) => s + Math.max(1, Number(a.qty || 1)) * toIdr(a.purchaseCost || 0),
      0
    );
    const totalFixedAssetBookValue = fixedAssets.reduce(
      (s, a) =>
        s +
        Math.max(1, Number(a.qty || 1)) *
          toIdr(a.currentValue !== undefined ? a.currentValue : a.purchaseCost || 0),
      0
    );

    // F. Total Store Gross & Net Asset Worth
    const totalGrossAssetsCostBasis =
      totalInventoryCost +
      totalLiquidCashAndVault +
      totalReceivables +
      totalFixedAssetBookValue;

    const totalNetStoreWorth = totalGrossAssetsCostBasis - totalSupplierPayables;
    const totalGrossAssetsRetailBasis =
      totalInventoryRetail +
      totalLiquidCashAndVault +
      totalReceivables +
      totalFixedAssetBookValue -
      totalSupplierPayables;

    return {
      totalInventoryCost,
      totalInventoryRetail,
      totalPotentialProfit,
      avgInventoryMarginPct,
      totalUnitsInStock,
      totalCartonsInStock,
      productiveCount: productiveProducts.length,
      deadStockCount: deadStockProducts.length,
      lowStockCount: lowStockProducts.length,
      outOfStockCount: outOfStockProducts.length,
      productiveCapital,
      deadStockCapital,
      lowStockCapital,
      cashInDrawer,
      cashSalesTotal,
      nonCashSalesTotal,
      vaultSafeDrops,
      vaultModalReserve,
      vaultProfitAllocated,
      totalLiquidCashAndVault,
      totalKasMasuk,
      totalKasKeluar,
      cashFlowIn,
      cashFlowOut,
      customerDebtList,
      totalReceivables,
      unpaidPurchaseOrders,
      totalSupplierPayables,
      totalFixedAssetAcquisition,
      totalFixedAssetBookValue,
      totalGrossAssetsCostBasis,
      totalNetStoreWorth,
      totalGrossAssetsRetailBasis,
    };
  }, [
    enrichedProducts,
    allValidTransactions,
    shiftKasMasuk,
    shiftKasKeluar,
    cashFlows,
    safeDeposits,
    openingCash,
    ctxCustomers,
    storeCustomers,
    purchaseOrders,
    fixedAssets,
  ]);

  // 4. Category Asset Valuation Breakdown
  const categoryBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        category: string;
        skuCount: number;
        totalUnits: number;
        totalCartons: number;
        costValue: number;
        retailValue: number;
        marginValue: number;
      }
    >();

    enrichedProducts.forEach((p) => {
      const cat = (p.category || 'UMUM').toUpperCase();
      const prev = map.get(cat) || {
        category: cat,
        skuCount: 0,
        totalUnits: 0,
        totalCartons: 0,
        costValue: 0,
        retailValue: 0,
        marginValue: 0,
      };
      map.set(cat, {
        category: cat,
        skuCount: prev.skuCount + 1,
        totalUnits: prev.totalUnits + p.stockInUnits,
        totalCartons: prev.totalCartons + p.cartonsEquivalent,
        costValue: prev.costValue + p.totalAssetCost,
        retailValue: prev.retailValue + p.totalAssetRetail,
        marginValue: prev.marginValue + p.potentialMargin,
      });
    });

    return Array.from(map.values()).sort((a, b) => b.costValue - a.costValue);
  }, [enrichedProducts]);

  // Top 5 Highest Capital Products
  const topCapitalProducts = useMemo(() => {
    return [...enrichedProducts]
      .sort((a, b) => b.totalAssetCost - a.totalAssetCost)
      .slice(0, 5);
  }, [enrichedProducts]);

  // 4B. Daily Time-Series (Day 1..30/31) for TOTAL ASSET STATISTIK ASSET CHART
  const dailyAssetChartData = useMemo(() => {
    const [yearStr, monthStr] = (selectedAssetChartMonth || '2026-10').split('-');
    const year = Number(yearStr) || 2026;
    const monthIndex = Math.max(0, (Number(monthStr) || 10) - 1);
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

    const extractDayIfSameMonth = (rawDate: any): number | null => {
      if (!rawDate) return null;
      let d: Date | null = null;
      if (typeof rawDate?.toDate === 'function') {
        d = rawDate.toDate();
      } else if (rawDate instanceof Date) {
        d = rawDate;
      } else if (typeof rawDate === 'number') {
        d = new Date(rawDate);
      } else if (typeof rawDate === 'string') {
        const s = rawDate.trim();
        const idMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (idMatch) {
          d = new Date(Number(idMatch[3]), Number(idMatch[2]) - 1, Number(idMatch[1]));
        } else {
          const parsed = new Date(s);
          if (!Number.isNaN(parsed.getTime())) d = parsed;
        }
      }
      if (!d || Number.isNaN(d.getTime())) return null;
      if (d.getFullYear() === year && d.getMonth() === monthIndex) {
        return d.getDate();
      }
      return null;
    };

    // Track daily deltas from real transactions, POs, cash flows & vault mutations in the selected month
    const dailySalesRetail = new Array(daysInMonth + 1).fill(0);
    const dailySalesCost = new Array(daysInMonth + 1).fill(0);
    const dailyCashDelta = new Array(daysInMonth + 1).fill(0);
    const dailyDebtDelta = new Array(daysInMonth + 1).fill(0);
    const dailyPoCostAdded = new Array(daysInMonth + 1).fill(0);
    const dailyPoRetailAdded = new Array(daysInMonth + 1).fill(0);
    const dailyPayablesDelta = new Array(daysInMonth + 1).fill(0);

    const avgMarkupRatio =
      assetSummary.totalInventoryCost > 0
        ? assetSummary.totalInventoryRetail / assetSummary.totalInventoryCost
        : 1.22;

    allValidTransactions.forEach((tx) => {
      const day = extractDayIfSameMonth(tx.createdAt || tx.date || tx.timestamp || tx.orderDate);
      if (!day || day < 1 || day > daysInMonth) return;
      const amt = toIdr(tx.totalAmount ?? tx.subtotal ?? 0);
      const cogs = toIdr(tx.totalCost ?? Math.round(amt / avgMarkupRatio));
      dailySalesRetail[day] += amt;
      dailySalesCost[day] += cogs;

      const method = String(tx.paymentMethod || 'cash').toLowerCase();
      const payStatus = String(tx.paymentStatus || 'paid').toLowerCase();
      if (method === 'debt' || method === 'kasbon' || payStatus === 'unpaid') {
        dailyDebtDelta[day] += amt;
      } else {
        dailyCashDelta[day] += amt;
      }
    });

    purchaseOrders.forEach((po) => {
      const day = extractDayIfSameMonth(po.createdAt || po.date || po.orderDate || po.updatedAt);
      if (!day || day < 1 || day > daysInMonth) return;
      const total = toIdr(po.totalAmount ?? 0);
      const paid = toIdr(po.paidAmount ?? 0);
      const remaining =
        po.remainingDebt !== undefined ? toIdr(po.remainingDebt) : Math.max(0, total - paid);
      dailyPoCostAdded[day] += total;
      dailyPoRetailAdded[day] += Math.round(total * avgMarkupRatio);
      if (remaining > 0) {
        dailyPayablesDelta[day] += remaining;
      }
    });

    safeDeposits.forEach((sd) => {
      const day = extractDayIfSameMonth(sd.createdAt || sd.date);
      if (!day || day < 1 || day > daysInMonth) return;
      dailyCashDelta[day] += toIdr(sd.amount ?? 0);
    });

    cashFlows.forEach((cf) => {
      const day = extractDayIfSameMonth(cf.createdAt || cf.date);
      if (!day || day < 1 || day > daysInMonth) return;
      const amt = toIdr(cf.amount ?? cf.nominal ?? 0);
      const t = String(cf.type || cf.category || '').toUpperCase();
      if (t.includes('OUT') || t.includes('KELUAR') || t.includes('EXPENSE') || t.includes('BIAYA')) {
        dailyCashDelta[day] -= amt;
      } else {
        dailyCashDelta[day] += amt;
      }
    });

    // Build daily trajectory 1..daysInMonth anchored on real current Firestore asset balances
    const baseRetail = assetSummary.totalInventoryRetail;
    const baseCost = assetSummary.totalInventoryCost;
    const baseCash = assetSummary.totalLiquidCashAndVault;
    const baseReceivables = assetSummary.totalReceivables;
    const basePayables = assetSummary.totalSupplierPayables;

    // Suffix sums from day+1..daysInMonth to reconstruct historical progression up to end of month
    const points: {
      day: number;
      dateLabel: string;
      nilaiJualStok: number;
      modalStok: number;
      kasBrankas: number;
      piutangPelanggan: number;
      utangPemasok: number;
    }[] = [];

    const monthLabel =
      assetChartMonthOptions.find((m) => m.value === selectedAssetChartMonth)?.label ||
      `${monthStr}/${year}`;

    let runningRetailChange = 0;
    let runningCostChange = 0;
    let runningCashChange = 0;
    let runningDebtChange = 0;
    let runningPayablesChange = 0;

    // Total activity inside month
    const totalMonthActivity =
      dailySalesRetail.reduce((a, b) => a + b, 0) +
      dailyPoCostAdded.reduce((a, b) => a + b, 0) +
      dailyCashDelta.reduce((a, b) => a + Math.abs(b), 0);

    for (let d = 1; d <= daysInMonth; d++) {
      runningRetailChange += dailyPoRetailAdded[d] - dailySalesRetail[d];
      runningCostChange += dailyPoCostAdded[d] - dailySalesCost[d];
      runningCashChange += dailyCashDelta[d];
      runningDebtChange += dailyDebtDelta[d];
      runningPayablesChange += dailyPayablesDelta[d];

      let nilaiJualStok = baseRetail;
      let modalStok = baseCost;
      let kasBrankas = baseCash;
      let piutangPelanggan = baseReceivables;
      let utangPemasok = basePayables;

      if (totalMonthActivity > 0) {
        const netRetailMonth = dailyPoRetailAdded.reduce((a, b) => a + b, 0) - dailySalesRetail.reduce((a, b) => a + b, 0);
        const netCostMonth = dailyPoCostAdded.reduce((a, b) => a + b, 0) - dailySalesCost.reduce((a, b) => a + b, 0);
        const netCashMonth = dailyCashDelta.reduce((a, b) => a + b, 0);
        const netDebtMonth = dailyDebtDelta.reduce((a, b) => a + b, 0);
        const netPayablesMonth = dailyPayablesDelta.reduce((a, b) => a + b, 0);

        const startRetail = Math.max(0, baseRetail - netRetailMonth);
        const startCost = Math.max(0, baseCost - netCostMonth);
        const startCash = Math.max(0, baseCash - netCashMonth);
        const startDebt = Math.max(0, baseReceivables - netDebtMonth);
        const startPayables = Math.max(0, basePayables - netPayablesMonth);

        nilaiJualStok = Math.max(0, Math.round(startRetail + runningRetailChange));
        modalStok = Math.max(0, Math.round(startCost + runningCostChange));
        kasBrankas = Math.max(0, Math.round(startCash + runningCashChange));
        piutangPelanggan = Math.max(0, Math.round(startDebt + runningDebtChange));
        utangPemasok = Math.max(0, Math.round(startPayables + runningPayablesChange));
      }

      points.push({
        day: d,
        dateLabel: `${d} ${monthLabel}`,
        nilaiJualStok,
        modalStok,
        kasBrankas,
        piutangPelanggan,
        utangPemasok,
      });
    }

    return points;
  }, [
    selectedAssetChartMonth,
    assetChartMonthOptions,
    assetSummary,
    allValidTransactions,
    purchaseOrders,
    safeDeposits,
    cashFlows,
  ]);

  // Handlers: Edit Product Asset (HPP, Price, Stock, Production & Expiry Date) in Firestore
  const openEditProductModal = (prod: any) => {
    setEditingProduct(prod);
    setEditCostPerUnit(String(prod.costPerUnit || 0));
    setEditPricePerUnit(String(prod.pricePerUnit || 0));
    setEditStockUnits(String(prod.stockInUnits || 0));
    setEditPiecesPerCarton(String(prod.piecesPerCarton || 1));
    setEditProductionDate(
      normalizeToInputDate(prod.productionDate ?? prod.tanggalProduksi ?? '')
    );
    setEditExpiryDate(
      normalizeToInputDate(prod.expiryDate ?? prod.tanggalKadaluarsa ?? '')
    );
  };

  const handleSaveProductAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    setIsSavingProduct(true);
    try {
      const nextCost = Math.max(0, Number(editCostPerUnit) || 0);
      const nextPrice = Math.max(0, Number(editPricePerUnit) || 0);
      const nextStock = Math.max(0, Number(editStockUnits) || 0);
      const nextPcsPerCarton = Math.max(1, Number(editPiecesPerCarton) || 1);
      const prevStock = Number(editingProduct.stockInUnits || 0);
      const cleanProdDate = (editProductionDate || '').trim();
      const cleanExpDate = (editExpiryDate || '').trim();

      const payload = {
        costPerUnit: nextCost,
        costPrice: nextCost,
        pricePerUnit: nextPrice,
        sellPrice: nextPrice,
        posPrice: nextPrice,
        stockInUnits: nextStock,
        stock: nextStock,
        piecesPerCarton: nextPcsPerCarton,
        itemsPerCarton: nextPcsPerCarton,
        isiPerDus: nextPcsPerCarton,
        productionDate: cleanProdDate,
        tanggalProduksi: cleanProdDate,
        expiryDate: cleanExpDate,
        tanggalKadaluarsa: cleanExpDate,
        updatedAt: new Date().toISOString(),
      };

      await updateDoc(doc(db, 'products', editingProduct.id), payload);
      await setDoc(
        doc(db, `stores/${ACTIVE_STORE_ID}/products`, editingProduct.id),
        { ...editingProduct, ...payload },
        { merge: true }
      );

      if (nextStock !== prevStock) {
        await addDoc(collection(db, 'stock_movements'), {
          productId: editingProduct.id,
          productName: editingProduct.name,
          sku: editingProduct.sku || editingProduct.id,
          type: nextStock > prevStock ? 'MASUK' : 'PENYESUAIAN',
          qty: Math.abs(nextStock - prevStock),
          beforeStock: prevStock,
          afterStock: nextStock,
          reason: 'Penyesuaian dari Halaman Asset Toko (/dashboard/myasset)',
          actor: 'Owner / Admin Asset',
          date: new Date().toLocaleDateString('id-ID'),
          createdAt: new Date().toISOString(),
        });
      }

      setEditingProduct(null);
      showToast(`Valuasi aset produk "${editingProduct.name}" berhasil diperbarui di Cloud Firestore!`);
    } catch (err: any) {
      console.error('Failed to update product asset:', err);
      showToast(`Gagal menyimpan perubahan: ${err?.message || 'Error'}`);
    } finally {
      setIsSavingProduct(false);
    }
  };

  // Handlers: Fixed Store Asset CRUD (`store_fixed_assets`)
  const openAddFixedAsset = () => {
    setEditingFixedAsset(null);
    setFaName('');
    setFaCode(`INV-${String(fixedAssets.length + 1).padStart(3, '0')}`);
    setFaCategory('Peralatan Toko');
    setFaQty('1');
    setFaPurchaseCost('0');
    setFaCurrentValue('0');
    setFaCondition('Baik');
    setFaAcquiredDate(new Date().toISOString().slice(0, 10));
    setFaLocation('Outlet Utama');
    setFaNotes('');
    setShowFixedAssetModal(true);
  };

  const openEditFixedAsset = (item: FixedAssetItem) => {
    setEditingFixedAsset(item);
    setFaName(item.name || '');
    setFaCode(item.code || '');
    setFaCategory(item.category || 'Peralatan Toko');
    setFaQty(String(item.qty || 1));
    setFaPurchaseCost(String(item.purchaseCost || 0));
    setFaCurrentValue(String(item.currentValue ?? item.purchaseCost ?? 0));
    setFaCondition(item.condition || 'Baik');
    setFaAcquiredDate(item.acquiredDate || new Date().toISOString().slice(0, 10));
    setFaLocation(item.location || 'Outlet Utama');
    setFaNotes(item.notes || '');
    setShowFixedAssetModal(true);
  };

  const handleSaveFixedAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!faName.trim()) return;
    const payload = {
      name: faName.trim(),
      code: faCode.trim() || `INV-${Date.now().toString().slice(-4)}`,
      category: faCategory,
      qty: Math.max(1, Number(faQty) || 1),
      purchaseCost: Math.max(0, Number(faPurchaseCost) || 0),
      currentValue: Math.max(0, Number(faCurrentValue) || 0),
      condition: faCondition,
      acquiredDate: faAcquiredDate,
      location: faLocation.trim() || 'Outlet Utama',
      notes: faNotes.trim(),
      updatedAt: new Date().toISOString(),
    };

    if (editingFixedAsset?.id) {
      await updateFixedAsset(editingFixedAsset.id, payload);
      showToast(`Aset tetap "${payload.name}" berhasil diperbarui!`);
    } else {
      await addFixedAsset(payload as any);
      showToast(`Aset tetap "${payload.name}" berhasil ditambahkan ke Cloud Firestore!`);
    }
    setShowFixedAssetModal(false);
  };

  // Handler: Add Brankas Mutation
  const handleSaveVaultMutation = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Math.max(0, Number(vaultAmount) || 0);
    if (amt <= 0) return;

    await addSafeDeposit({
      type: vaultType,
      amount: amt,
      from: vaultFrom,
      to: vaultTo,
      note: vaultNote || 'Mutasi aset kas dari halaman Asset Toko',
      actor: 'Admin / Owner',
      date: new Date().toLocaleString('id-ID'),
      createdAt: new Date().toISOString(),
    });
    setShowVaultModal(false);
    setVaultAmount('0');
    setVaultNote('');
    showToast(`Mutasi kas/brankas sebesar ${fmtRp(amt)} berhasil dicatat ke Firestore!`);
  };

  // Export CSV of Real Store Asset Valuation
  const handleExportCsv = () => {
    const headers = [
      'SKU',
      'Nama Produk',
      'Kategori',
      'Stok Unit',
      'Ekuivalen Karton',
      'HPP per Unit (Rp)',
      'Harga Jual per Unit (Rp)',
      'Total Aset Modal HPP (Rp)',
      'Total Nilai Jual (Rp)',
      'Potensi Margin (Rp)',
      'Margin (%)',
      'Status Aset',
    ];
    const rows = filteredProducts.map((p) => [
      `"${(p.sku || p.id).replace(/"/g, '""')}"`,
      `"${(p.name || '').replace(/"/g, '""')}"`,
      `"${(p.category || 'UMUM').replace(/"/g, '""')}"`,
      p.stockInUnits,
      p.cartonsEquivalent.toFixed(2),
      p.costPerUnit,
      p.pricePerUnit,
      p.totalAssetCost,
      p.totalAssetRetail,
      p.potentialMargin,
      p.marginPct,
      p.assetStatus,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `asset_toko_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Composition percentages for Asset Allocation Bar
  const totalPositiveAssets = Math.max(
    1,
    assetSummary.totalInventoryCost +
      assetSummary.totalLiquidCashAndVault +
      assetSummary.totalReceivables +
      assetSummary.totalFixedAssetBookValue
  );
  const pctInventory = Math.round((assetSummary.totalInventoryCost / totalPositiveAssets) * 100);
  const pctCash = Math.round((assetSummary.totalLiquidCashAndVault / totalPositiveAssets) * 100);
  const pctReceivables = Math.round((assetSummary.totalReceivables / totalPositiveAssets) * 100);
  const pctFixed = Math.max(
    0,
    100 - pctInventory - pctCash - pctReceivables
  );

  return (
    <div className="space-y-6 pb-10">
      {/* Toast Notification */}
      {flashMsg && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-950/95 border border-emerald-500/40 text-emerald-200 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs font-semibold">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{flashMsg}</span>
        </div>
      )}

      {/* 1. TOP HEADER & ACTION BAR */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900/95 to-cyan-950/30 border border-zinc-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[10px] font-bold uppercase tracking-wider">
                {tr('STORE ASSET CONTROL', 'ASSET TOKO • NERACA KEKAYAAN')}
              </span>
              <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-mono font-bold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE CLOUD FIRESTORE ({storeName})
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-2.5">
              <Vault className="w-7 h-7 text-cyan-400 shrink-0" />
              <span>{tr('Store Asset & Balance Sheet', 'Asset Toko & Valuasi Kekayaan')}</span>
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 max-w-3xl">
              {tr(
                'Real-time store wealth valuation connected 100% to Cloud Firestore inventory stock, POS cash drawers, safe vaults, customer receivables, supplier payables, and fixed equipment.',
                'Valuasi kekayaan bersih toko secara real-time yang terhubung 100% ke data stok produk, kas laci POS, brankas, piutang pelanggan, hutang PO supplier, dan inventaris aset tetap di Cloud Firestore.'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={async () => {
                setIsRefreshing(true);
                try {
                  await refreshFirestore();
                  showToast('Data aset toko berhasil disinkronkan langsung dari Cloud Firestore!');
                } finally {
                  setIsRefreshing(false);
                }
              }}
              disabled={isRefreshing}
              className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{tr('Sync Cloud', 'Sinkronisasi Live')}</span>
            </button>

            <button
              onClick={openAddFixedAsset}
              className="px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-cyan-950/50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{tr('+ Add Fixed Asset', '+ Catat Aset Tetap')}</span>
            </button>

            <button
              onClick={() => setShowVaultModal(true)}
              className="px-3 py-2 rounded-xl bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>{tr('+ Vault Transfer', '+ Mutasi Brankas')}</span>
            </button>

            <button
              onClick={handleExportCsv}
              className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={() => window.print()}
              className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-zinc-300" />
              <span>{tr('Print', 'Cetak')}</span>
            </button>
          </div>
        </div>

        {/* EXECUTIVE NET ASSET VALUATION BANNER & ALLOCATION BAR */}
        <div className="mt-5 pt-5 border-t border-zinc-800/80 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          <div className="lg:col-span-5 bg-zinc-950/80 border border-cyan-500/25 rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-400">
                {tr('TOTAL NET STORE ASSET WORTH (MODAL BERSIH)', 'TOTAL NILAI ASET BERSIH TOKO (KEKAYAAN BERSIH)')}
              </span>
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black font-mono text-white mt-1.5">
              {fmtRp(assetSummary.totalNetStoreWorth)}
            </div>
            <div className="mt-2 pt-2 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="text-zinc-400">
                {tr('Gross Retail Valuation:', 'Valuasi Jual Bruto:')}{' '}
                <strong className="text-emerald-400 font-mono">
                  {fmtRp(assetSummary.totalGrossAssetsRetailBasis)}
                </strong>
              </span>
              <span className="text-zinc-400">
                {tr('Projected Stock Profit:', 'Potensi Laba Stok:')}{' '}
                <strong className="text-amber-300 font-mono">
                  +{fmtRp(assetSummary.totalPotentialProfit)} ({assetSummary.avgInventoryMarginPct}%)
                </strong>
              </span>
            </div>
          </div>

          {/* Asset Composition Visual Bar */}
          <div className="lg:col-span-7 bg-zinc-950/60 border border-zinc-800/90 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-zinc-200 flex items-center gap-1.5">
                <PieChart className="w-3.5 h-3.5 text-cyan-400" />
                {tr('Store Asset Allocation Structure', 'Komposisi Struktur Aset Toko (Real-Time)')}
              </span>
              <span className="text-[11px] font-mono text-zinc-400">
                {tr('Gross Asset:', 'Total Aset Aktif:')} {fmtRp(assetSummary.totalGrossAssetsCostBasis)}
              </span>
            </div>

            {/* Multi-segment bar */}
            <div className="w-full h-3.5 bg-zinc-900 rounded-full overflow-hidden flex border border-zinc-800">
              <div
                style={{ width: `${Math.max(pctInventory, 2)}%` }}
                className="bg-blue-500 h-full transition-all duration-500"
                title={`Modal Stok Barang: ${fmtRp(assetSummary.totalInventoryCost)} (${pctInventory}%)`}
              />
              <div
                style={{ width: `${Math.max(pctCash, 2)}%` }}
                className="bg-emerald-500 h-full transition-all duration-500"
                title={`Kas & Brankas: ${fmtRp(assetSummary.totalLiquidCashAndVault)} (${pctCash}%)`}
              />
              <div
                style={{ width: `${Math.max(pctReceivables, 1)}%` }}
                className="bg-amber-500 h-full transition-all duration-500"
                title={`Piutang Pelanggan: ${fmtRp(assetSummary.totalReceivables)} (${pctReceivables}%)`}
              />
              <div
                style={{ width: `${Math.max(pctFixed, 1)}%` }}
                className="bg-purple-500 h-full transition-all duration-500"
                title={`Aset Tetap Toko: ${fmtRp(assetSummary.totalFixedAssetBookValue)} (${pctFixed}%)`}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
              <div className="bg-zinc-900/80 px-2.5 py-1.5 rounded-lg border border-zinc-800/80">
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  <span className="truncate">Modal Stok ({pctInventory}%)</span>
                </div>
                <div className="font-mono font-bold text-white mt-0.5 truncate">
                  {fmtRp(assetSummary.totalInventoryCost)}
                </div>
              </div>

              <div className="bg-zinc-900/80 px-2.5 py-1.5 rounded-lg border border-zinc-800/80">
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className="truncate">Kas &amp; Brankas ({pctCash}%)</span>
                </div>
                <div className="font-mono font-bold text-emerald-400 mt-0.5 truncate">
                  {fmtRp(assetSummary.totalLiquidCashAndVault)}
                </div>
              </div>

              <div className="bg-zinc-900/80 px-2.5 py-1.5 rounded-lg border border-zinc-800/80">
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                  <span className="truncate">Piutang ({pctReceivables}%)</span>
                </div>
                <div className="font-mono font-bold text-amber-400 mt-0.5 truncate">
                  {fmtRp(assetSummary.totalReceivables)}
                </div>
              </div>

              <div className="bg-zinc-900/80 px-2.5 py-1.5 rounded-lg border border-zinc-800/80">
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
                  <span className="truncate">Aset Tetap ({pctFixed}%)</span>
                </div>
                <div className="font-mono font-bold text-purple-300 mt-0.5 truncate">
                  {fmtRp(assetSummary.totalFixedAssetBookValue)}
                </div>
              </div>

              <div className="bg-rose-950/25 px-2.5 py-1.5 rounded-lg border border-rose-900/40">
                <div className="flex items-center gap-1.5 text-rose-300">
                  <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                  <span className="truncate">Hutang PO (-)</span>
                </div>
                <div className="font-mono font-bold text-rose-400 mt-0.5 truncate">
                  -{fmtRp(assetSummary.totalSupplierPayables)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI ASSET ANALYTICS (MoM) & STOCK VS PURCHASE VS SALES INFOGRAPHIC */}
      <div className="mt-6">
        <AIAssetAndStockAnalytics
          assets={fixedAssets}
          products={ctxProducts}
          procurements={purchaseOrders}
          transactions={ctxTransactions}
          expenses={shiftKasKeluar}
        />
      </div>

      {/* 2. 6 CONNECTED KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {/* Card 1: Modal Stok Barang (HPP) */}
        <div
          onClick={() => setActiveTab('inventory_asset')}
          className="bg-zinc-900/90 hover:bg-zinc-900 border border-zinc-800 hover:border-blue-500/40 rounded-2xl p-4 flex flex-col justify-between transition cursor-pointer shadow-lg"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Modal Stok (HPP)
            </span>
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-lg font-black font-mono text-white">
              {fmtRp(assetSummary.totalInventoryCost)}
            </div>
            <div className="text-[11px] text-zinc-400 mt-0.5">
              {enrichedProducts.length} SKU • {assetSummary.totalUnitsInStock.toLocaleString('id-ID')} Unit
            </div>
          </div>
          <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-blue-400 font-semibold">
            <span>{assetSummary.totalCartonsInStock.toFixed(1)} Karton (Dus)</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Card 2: Nilai Jual Stok & Potensi Margin */}
        <div
          onClick={() => setActiveTab('inventory_asset')}
          className="bg-zinc-900/90 hover:bg-zinc-900 border border-zinc-800 hover:border-emerald-500/40 rounded-2xl p-4 flex flex-col justify-between transition cursor-pointer shadow-lg"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Nilai Jual Stok
            </span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-lg font-black font-mono text-emerald-400">
              {fmtRp(assetSummary.totalInventoryRetail)}
            </div>
            <div className="text-[11px] text-zinc-400 mt-0.5">
              Potensi Laba: <strong className="text-white">{fmtRp(assetSummary.totalPotentialProfit)}</strong>
            </div>
          </div>
          <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-emerald-400 font-semibold">
            <span>Rata-rata Margin {assetSummary.avgInventoryMarginPct}%</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Card 3: Kas Laci POS & Brankas Toko */}
        <div
          onClick={() => setActiveTab('cash_vault')}
          className="bg-zinc-900/90 hover:bg-zinc-900 border border-zinc-800 hover:border-cyan-500/40 rounded-2xl p-4 flex flex-col justify-between transition cursor-pointer shadow-lg"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Kas &amp; Brankas Aktif
            </span>
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-lg font-black font-mono text-cyan-300">
              {fmtRp(assetSummary.totalLiquidCashAndVault)}
            </div>
            <div className="text-[11px] text-zinc-400 mt-0.5">
              Laci Tunai: {fmtRp(assetSummary.cashInDrawer)}
            </div>
          </div>
          <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-cyan-400 font-semibold">
            <span>Brankas: {fmtRp(assetSummary.vaultSafeDrops + assetSummary.vaultModalReserve)}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Card 4: Piutang Pelanggan (Receivables) */}
        <div
          onClick={() => setActiveTab('receivables_payables')}
          className="bg-zinc-900/90 hover:bg-zinc-900 border border-zinc-800 hover:border-amber-500/40 rounded-2xl p-4 flex flex-col justify-between transition cursor-pointer shadow-lg"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Piutang Pelanggan
            </span>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-lg font-black font-mono text-amber-400">
              {fmtRp(assetSummary.totalReceivables)}
            </div>
            <div className="text-[11px] text-zinc-400 mt-0.5">
              {assetSummary.customerDebtList.length} Pelanggan Kasbon Aktif
            </div>
          </div>
          <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-amber-400 font-semibold">
            <span>Tagihan Masuk Toko</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Card 5: Hutang Dagang Supplier (Payables) */}
        <div
          onClick={() => setActiveTab('receivables_payables')}
          className="bg-zinc-900/90 hover:bg-zinc-900 border border-zinc-800 hover:border-rose-500/40 rounded-2xl p-4 flex flex-col justify-between transition cursor-pointer shadow-lg"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Hutang Supplier
            </span>
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-lg font-black font-mono text-rose-400">
              {fmtRp(assetSummary.totalSupplierPayables)}
            </div>
            <div className="text-[11px] text-zinc-400 mt-0.5">
              {assetSummary.unpaidPurchaseOrders.length} Faktur PO Tempo
            </div>
          </div>
          <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-rose-400 font-semibold">
            <span>Kewajiban Pembelian</span>
            <ArrowDownRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Card 6: Aset Tetap & Inventaris Alat */}
        <div
          onClick={() => setActiveTab('fixed_asset')}
          className="bg-zinc-900/90 hover:bg-zinc-900 border border-zinc-800 hover:border-purple-500/40 rounded-2xl p-4 flex flex-col justify-between transition cursor-pointer shadow-lg"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Aset Tetap &amp; Alat
            </span>
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-lg font-black font-mono text-purple-300">
              {fmtRp(assetSummary.totalFixedAssetBookValue)}
            </div>
            <div className="text-[11px] text-zinc-400 mt-0.5">
              {fixedAssets.length} Inventaris Terdaftar
            </div>
          </div>
          <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-purple-400 font-semibold">
            <span>Perolehan: {fmtRp(assetSummary.totalFixedAssetAcquisition)}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>

      {/* 2B. TOTAL ASSET - STATISTIK ASSET CHART (FULL WIDTH ABOVE EXPIRED DATE PRODUK) */}
      <div className="w-full mb-6 bg-[#0c0a06] border border-amber-500/35 rounded-2xl p-6 shadow-[0_0_24px_rgba(245,158,11,0.06)]">
        {/* 1. HEADER & DROPDOWN FILTER BULAN + TAHUN (FULL WIDTH) */}
        <div>
          <div className="text-xs uppercase tracking-widest text-neutral-400 font-semibold">
            REVENUE &amp; ASSET VALUATION
          </div>
          <div className="mt-1 leading-tight">
            <div className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              TOTAL ASSET
            </div>
            <div className="text-2xl md:text-3xl font-extrabold text-[#ff6b00] tracking-tight">
              STATISTIK ASSET CHART
            </div>
          </div>

          <select
            value={selectedAssetChartMonth}
            onChange={(e) => setSelectedAssetChartMonth(e.target.value)}
            aria-label="Filter Bulan dan Tahun Statistik Asset Chart"
            className="w-full mt-4 bg-[#14110b] border border-amber-500/40 text-white rounded-xl px-4 py-3 text-sm font-bold uppercase tracking-wider focus:outline-none focus:border-[#ff6b00] cursor-pointer"
          >
            {assetChartMonthOptions.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-[#14110b] text-white">
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* 2. BARISAN TOMBOL PILL INDIKATOR METRIK (BISA DIKLIK UNTUK TOGGLE KURVA) */}
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => toggleAssetCurve('nilaiJualStok')}
            className={`rounded-xl border px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition cursor-pointer ${
              visibleAssetCurves.nilaiJualStok
                ? 'border-[#ff6b00]/60 bg-[#15130f] text-white shadow-[0_0_12px_rgba(255,107,0,0.2)]'
                : 'border-white/10 bg-[#15130f]/50 text-neutral-500 opacity-60'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff6b00] inline-block shrink-0" />
            <span>NILAI JUAL STOK</span>
          </button>

          <button
            type="button"
            onClick={() => toggleAssetCurve('modalStok')}
            className={`rounded-xl border px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition cursor-pointer ${
              visibleAssetCurves.modalStok
                ? 'border-[#fbbf24]/60 bg-[#15130f] text-white shadow-[0_0_12px_rgba(251,191,36,0.15)]'
                : 'border-white/10 bg-[#15130f]/50 text-neutral-500 opacity-60'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#fbbf24] inline-block shrink-0" />
            <span>MODAL STOK</span>
          </button>

          <button
            type="button"
            onClick={() => toggleAssetCurve('kasBrankas')}
            className={`rounded-xl border px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition cursor-pointer ${
              visibleAssetCurves.kasBrankas
                ? 'border-[#10b981]/60 bg-[#15130f] text-white shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                : 'border-white/10 bg-[#15130f]/50 text-neutral-500 opacity-60'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#10b981] inline-block shrink-0" />
            <span>KAS &amp; BRANKAS AKTIF</span>
          </button>

          <button
            type="button"
            onClick={() => toggleAssetCurve('piutangPelanggan')}
            className={`rounded-xl border px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition cursor-pointer ${
              visibleAssetCurves.piutangPelanggan
                ? 'border-[#38bdf8]/60 bg-[#15130f] text-white shadow-[0_0_12px_rgba(56,189,248,0.15)]'
                : 'border-white/10 bg-[#15130f]/50 text-neutral-500 opacity-60'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#38bdf8] inline-block shrink-0" />
            <span>PIUTANG PELANGGAN</span>
          </button>

          <button
            type="button"
            onClick={() => toggleAssetCurve('utangPemasok')}
            className={`rounded-xl border px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition cursor-pointer ${
              visibleAssetCurves.utangPemasok
                ? 'border-white/50 bg-[#15130f] text-white shadow-[0_0_12px_rgba(255,255,255,0.12)]'
                : 'border-white/10 bg-[#15130f]/50 text-neutral-500 opacity-60'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#ffffff] inline-block shrink-0" />
            <span>UTANG PEMASOK</span>
          </button>
        </div>

        {/* 3. AREA CHART LINE PER TANGGAL (1 s/d 30/31) DENGAN GRADASI ORANYE, DOT & TOOLTIP */}
        <div className="mt-5 w-full h-[340px] bg-[#090805] border border-amber-500/20 rounded-2xl p-3 sm:p-4">
          <ResponsiveContainer width="100%" height={310}>
            <AreaChart
              data={dailyAssetChartData}
              margin={{ top: 14, right: 16, left: 8, bottom: 6 }}
            >
              <defs>
                <linearGradient id="gradNilaiJualOrange" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ff6b00" stopOpacity={0.55} />
                  <stop offset="95%" stopColor="#ff6b00" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="gradModalGold" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#fbbf24" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="gradKasEmerald" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="gradPiutangCyan" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="gradUtangWhite" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ffffff" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#ffffff" stopOpacity={0.0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="rgba(245, 158, 11, 0.12)" vertical={false} />

              <XAxis
                dataKey="day"
                interval={0}
                tick={{ fill: '#ffffff', fontSize: 11, fontWeight: 700 }}
                axisLine={{ stroke: 'rgba(245, 158, 11, 0.25)' }}
                tickLine={{ stroke: 'rgba(245, 158, 11, 0.25)' }}
              />

              <YAxis
                tick={{ fill: '#a3a3a3', fontSize: 11, fontWeight: 600 }}
                axisLine={{ stroke: 'rgba(245, 158, 11, 0.2)' }}
                tickLine={false}
                width={82}
                tickFormatter={(val: number) => {
                  const num = Number(val) || 0;
                  if (currencyMode === 'USD') {
                    return formatMoney(num, 'USD');
                  }
                  if (Math.abs(num) >= 1_000_000_000) {
                    return `Rp ${(num / 1_000_000_000).toFixed(1)}M`;
                  }
                  if (Math.abs(num) >= 1_000_000) {
                    return `Rp ${(num / 1_000_000).toFixed(1)}Jt`;
                  }
                  if (Math.abs(num) >= 1_000) {
                    return `Rp ${(num / 1_000).toFixed(0)}Rb`;
                  }
                  return `Rp ${num}`;
                }}
              />

              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const row = payload[0]?.payload;
                  return (
                    <div className="bg-[#120f09]/95 border border-amber-500/50 rounded-xl p-3 shadow-2xl text-xs space-y-1.5 min-w-[220px]">
                      <div className="font-extrabold text-amber-400 uppercase tracking-wider border-b border-white/10 pb-1">
                        TANGGAL {row?.dateLabel}
                      </div>
                      {payload.map((entry: any) => (
                        <div
                          key={entry.dataKey}
                          className="flex items-center justify-between gap-4 font-mono"
                        >
                          <span className="flex items-center gap-1.5 text-neutral-200 font-sans font-semibold">
                            <span
                              className="w-2.5 h-2.5 rounded-full inline-block"
                              style={{ backgroundColor: entry.color }}
                            />
                            {entry.name}
                          </span>
                          <span className="font-bold text-white">
                            {fmtRp(Number(entry.value) || 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />

              {visibleAssetCurves.nilaiJualStok && (
                <Area
                  type="monotone"
                  dataKey="nilaiJualStok"
                  name="Nilai Jual Stok"
                  stroke="#ff6b00"
                  strokeWidth={3}
                  fill="url(#gradNilaiJualOrange)"
                  dot={{ r: 4, stroke: '#ff6b00', strokeWidth: 2, fill: '#0c0a06' }}
                  activeDot={{ r: 6, stroke: '#ffffff', strokeWidth: 2, fill: '#ff6b00' }}
                />
              )}

              {visibleAssetCurves.modalStok && (
                <Area
                  type="monotone"
                  dataKey="modalStok"
                  name="Modal Stok"
                  stroke="#fbbf24"
                  strokeWidth={2.5}
                  fill="url(#gradModalGold)"
                  dot={{ r: 4, stroke: '#fbbf24', strokeWidth: 2, fill: '#0c0a06' }}
                  activeDot={{ r: 6, stroke: '#ffffff', strokeWidth: 2, fill: '#fbbf24' }}
                />
              )}

              {visibleAssetCurves.kasBrankas && (
                <Area
                  type="monotone"
                  dataKey="kasBrankas"
                  name="Kas & Brankas Aktif"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fill="url(#gradKasEmerald)"
                  dot={{ r: 4, stroke: '#10b981', strokeWidth: 2, fill: '#0c0a06' }}
                  activeDot={{ r: 6, stroke: '#ffffff', strokeWidth: 2, fill: '#10b981' }}
                />
              )}

              {visibleAssetCurves.piutangPelanggan && (
                <Area
                  type="monotone"
                  dataKey="piutangPelanggan"
                  name="Piutang Pelanggan"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  fill="url(#gradPiutangCyan)"
                  dot={{ r: 4, stroke: '#38bdf8', strokeWidth: 2, fill: '#0c0a06' }}
                  activeDot={{ r: 6, stroke: '#ffffff', strokeWidth: 2, fill: '#38bdf8' }}
                />
              )}

              {visibleAssetCurves.utangPemasok && (
                <Area
                  type="monotone"
                  dataKey="utangPemasok"
                  name="Utang Pemasok"
                  stroke="#ffffff"
                  strokeWidth={2}
                  fill="url(#gradUtangWhite)"
                  dot={{ r: 4, stroke: '#ffffff', strokeWidth: 2, fill: '#0c0a06' }}
                  activeDot={{ r: 6, stroke: '#ff6b00', strokeWidth: 2, fill: '#ffffff' }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 3A. ROW: KOTAK "EXPIRED DATE PRODUK" (KIRI) & KOTAK "VALUASI ASET STOK PER KATEGORI" (KANAN) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Panel Kiri: Kotak "Expired Date Produk" (Tepat di Sebelah Kiri Valuasi Aset Stok per Kategori) */}
        <div className="xl:col-span-8 bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 flex flex-col justify-between shadow-xl space-y-4">
          {(() => {
            const sortedByExpiry = [...enrichedProducts].sort((a, b) => {
              const da = a.expiryEval.daysUntilExpiry ?? 999999;
              const db = b.expiryEval.daysUntilExpiry ?? 999999;
              if (da !== db) return da - db;
              return b.totalAssetCost - a.totalAssetCost;
            });

            const filteredExpiryRows = sortedByExpiry.filter((p) => {
              if (expiryBoxFilter === 'NEAR_EXPIRY') {
                return (
                  p.expiryEval.daysUntilExpiry !== null &&
                  p.expiryEval.daysUntilExpiry >= 14 &&
                  p.expiryEval.daysUntilExpiry <= 30
                );
              }
              if (expiryBoxFilter === 'CRITICAL') {
                return (
                  p.expiryEval.daysUntilExpiry !== null &&
                  p.expiryEval.daysUntilExpiry < 14
                );
              }
              if (expiryBoxFilter === 'SAFE') {
                return (
                  p.expiryEval.daysUntilExpiry !== null &&
                  p.expiryEval.daysUntilExpiry > 30
                );
              }
              return true;
            });

            const totalStockUnitsInBox = filteredExpiryRows.reduce(
              (s, p) => s + p.stockInUnits,
              0
            );
            const totalRetailValueInBox = filteredExpiryRows.reduce(
              (s, p) => s + p.totalAssetRetail,
              0
            );
            const totalExpiredLossInBox = filteredExpiryRows.reduce(
              (s, p) => s + p.totalAssetCost,
              0
            );
            const atRisk30DaysLoss = sortedByExpiry
              .filter(
                (p) =>
                  p.stockInUnits > 0 &&
                  p.expiryEval.daysUntilExpiry !== null &&
                  p.expiryEval.daysUntilExpiry <= p.expiryEval.categoryWarningThresholdDays
              )
              .reduce((s, p) => s + p.totalAssetCost, 0);

            return (
              <>
                {/* Header Kotak Expired Date Produk */}
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-amber-400" />
                          <span>Expired Date Produk</span>
                        </h3>
                        <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-mono font-bold">
                          Soda • Mineral • Teh • Kopi (Alert H-30)
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Monitoring masa simpan, sisa hari kadaluarsa (Countdown FEFO), nilai jual, dan potensi kerugian aset stok secara real-time.
                      </p>
                    </div>

                    {/* Ringkasan Total Potensi Kerugian Jika Expired */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="px-3 py-1.5 rounded-xl bg-rose-950/35 border border-rose-500/30 text-right">
                        <div className="text-[10px] text-rose-300 font-bold uppercase">
                          Total Nilai Kerugian Jika Expired
                        </div>
                        <div className="text-xs sm:text-sm font-black font-mono text-rose-400">
                          {fmtRp(totalExpiredLossInBox)}
                        </div>
                      </div>
                      <div className="px-3 py-1.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-right">
                        <div className="text-[10px] text-amber-300 font-bold uppercase">
                          Risiko Mendekati Expired (&le;30h)
                        </div>
                        <div className="text-xs sm:text-sm font-black font-mono text-amber-400">
                          {fmtRp(atRisk30DaysLoss)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Filter Status Countdown & Indikator Warna */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-zinc-800/80">
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setExpiryBoxFilter('ALL')}
                        className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                          expiryBoxFilter === 'ALL'
                            ? 'bg-cyan-600 text-white'
                            : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                        }`}
                      >
                        Semua ({sortedByExpiry.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpiryBoxFilter('SAFE')}
                        className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${
                          expiryBoxFilter === 'SAFE'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span>Aman &gt; 30 Hari</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpiryBoxFilter('NEAR_EXPIRY')}
                        className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${
                          expiryBoxFilter === 'NEAR_EXPIRY'
                            ? 'bg-amber-500 text-zinc-950'
                            : 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        <span>Waspada 14 - 30 Hari</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpiryBoxFilter('CRITICAL')}
                        className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${
                          expiryBoxFilter === 'CRITICAL'
                            ? 'bg-rose-600 text-white'
                            : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-rose-400" />
                        <span>Kritis &lt; 14 Hari / Expired</span>
                      </button>
                    </div>

                    <span className="text-[10px] text-zinc-500 font-mono">
                      Klik baris produk untuk ubah Tanggal Produksi / Expired
                    </span>
                  </div>
                </div>

                {/* Tabel 7 Kolom Expired Date Produk */}
                <div className="overflow-x-auto rounded-xl border border-zinc-800 max-h-[340px] overflow-y-auto">
                  <table className="w-full text-left text-xs text-zinc-300 border-collapse">
                    <thead className="bg-zinc-950 sticky top-0 z-10 text-[10px] font-black uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
                      <tr>
                        <th className="py-2.5 px-3 whitespace-nowrap">1. Nama Produk</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">2. Tanggal Produksi</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">3. Tanggal Expired</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">4. Countdown</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">5. Stok</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap text-emerald-300">
                          6. Nilai Jual
                        </th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap text-rose-300">
                          7. Nilai Kerugian Jika Expired
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {filteredExpiryRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-zinc-500 text-xs">
                            Tidak ada produk untuk filter status kadaluarsa ini.
                          </td>
                        </tr>
                      ) : (
                        filteredExpiryRows.map((p) => {
                          const ev = p.expiryEval;
                          const countdownBadgeClass =
                            ev.status === 'expired' || ev.status === 'critical'
                              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                              : ev.status === 'warning'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : ev.status === 'safe'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : 'bg-zinc-800 text-zinc-400 border-zinc-700';

                          const dotColor =
                            ev.status === 'expired' || ev.status === 'critical'
                              ? 'bg-rose-400'
                              : ev.status === 'warning'
                              ? 'bg-amber-400'
                              : ev.status === 'safe'
                              ? 'bg-emerald-400'
                              : 'bg-zinc-500';

                          return (
                            <tr
                              key={p.id}
                              onClick={() => openEditProductModal(p)}
                              className="hover:bg-zinc-800/40 transition cursor-pointer"
                              title="Klik untuk edit Tanggal Produksi, Tanggal Expired, Stok, atau HPP"
                            >
                              {/* 1. Nama Produk + Badge Kategori & Batch FEFO */}
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-white leading-snug">{p.name}</div>
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300 font-mono text-[9px] font-bold uppercase border border-amber-500/30">
                                    {p.category || 'MINERAL'}
                                  </span>
                                  <span className="text-[10px] font-mono text-zinc-500">
                                    {p.sku || p.id}
                                  </span>
                                  {(() => {
                                    const activeBatches = getActiveProductBatches(p);
                                    const primaryBatch = activeBatches[0];
                                    return (
                                      <>
                                        {primaryBatch?.batchCode && (
                                          <span className="px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-500/40 text-amber-300 font-mono text-[9px] font-bold">
                                            {primaryBatch.batchCode}
                                          </span>
                                        )}
                                        {activeBatches.length > 1 && (
                                          <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-amber-500/30 text-amber-200 font-mono text-[9px]">
                                            {activeBatches.length} Batch FEFO
                                          </span>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                              </td>

                              {/* 2. Tanggal Produksi */}
                              <td className="py-2.5 px-3 whitespace-nowrap font-mono text-zinc-200">
                                {ev.productionDateFormatted}
                              </td>

                              {/* 3. Tanggal Expired */}
                              <td className="py-2.5 px-3 whitespace-nowrap font-mono text-zinc-200">
                                {ev.expiryDateFormatted}
                              </td>

                              {/* 4. Countdown */}
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <div className="flex flex-col gap-0.5">
                                  <span
                                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-mono font-bold w-fit ${countdownBadgeClass}`}
                                  >
                                    <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                                    <span>{ev.countdownLabel}</span>
                                  </span>
                                  {ev.shelfLifeLabel && (
                                    <span className="text-[10px] font-mono text-zinc-400">
                                      {ev.shelfLifeLabel}
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* 5. Stok */}
                              <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono">
                                <div className="font-bold text-white">
                                  {p.stockInUnits.toLocaleString('id-ID')} Dus
                                </div>
                                <div className="text-[10px] text-zinc-500">
                                  Isi {p.piecesPerCarton}/dus
                                </div>
                              </td>

                              {/* 6. Nilai Jual (Stok x Harga Jual) */}
                              <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono font-bold text-emerald-300 bg-emerald-950/10">
                                {fmtRp(p.totalAssetRetail)}
                              </td>

                              {/* 7. Nilai Kerugian Jika Expired (Stok x Harga Modal / HPP) */}
                              <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono font-bold text-rose-400 bg-rose-950/15">
                                {fmtRp(p.totalAssetCost)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                    {filteredExpiryRows.length > 0 && (
                      <tfoot className="bg-zinc-950 sticky bottom-0 font-mono text-[11px] font-bold text-white border-t border-zinc-800">
                        <tr>
                          <td colSpan={4} className="py-2.5 px-3 text-zinc-300 uppercase">
                            TOTAL AKUMULASI ({filteredExpiryRows.length} PRODUK)
                          </td>
                          <td className="py-2.5 px-3 text-right text-white">
                            {totalStockUnitsInBox.toLocaleString('id-ID')} Dus
                          </td>
                          <td className="py-2.5 px-3 text-right text-emerald-300">
                            {fmtRp(totalRetailValueInBox)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-rose-400">
                            {fmtRp(totalExpiredLossInBox)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </>
            );
          })()}
        </div>

        {/* Panel Kanan: Valuasi Aset Stok per Kategori (Tepat di Sebelah Kanan Kotak Expired Date Produk) */}
        <div className="xl:col-span-4 bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 flex flex-col justify-between shadow-xl">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-cyan-400" />
                <span>Valuasi Aset Stok per Kategori</span>
              </h3>
              <span className="text-[11px] text-zinc-400 font-mono">
                {categoryBreakdown.length} Kategori Aktif
              </span>
            </div>

            {categoryBreakdown.length === 0 ? (
              <div className="py-10 text-center text-xs text-zinc-500">
                Belum ada data produk di Cloud Firestore.
              </div>
            ) : (
              <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                {categoryBreakdown.map((cat) => {
                  const sharePct =
                    assetSummary.totalInventoryCost > 0
                      ? Math.round((cat.costValue / assetSummary.totalInventoryCost) * 100)
                      : 0;
                  return (
                    <div
                      key={cat.category}
                      onClick={() => {
                        setSelectedCategory(
                          selectedCategory === cat.category ? 'ALL' : cat.category
                        );
                        setActiveTab('inventory_asset');
                      }}
                      className={`p-3 rounded-xl border transition cursor-pointer ${
                        selectedCategory === cat.category
                          ? 'bg-cyan-950/30 border-cyan-500/50'
                          : 'bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="font-bold text-white flex items-center gap-2">
                          <span>{cat.category}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                            {cat.skuCount} SKU • {cat.totalUnits} Dus
                          </span>
                        </div>
                        <span className="font-mono font-bold text-cyan-400">
                          {fmtRp(cat.costValue)} ({sharePct}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden my-2">
                        <div
                          className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full rounded-full"
                          style={{ width: `${Math.max(sharePct, 2)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-zinc-400">
                        <span>
                          Nilai Jual: <strong className="text-zinc-200 font-mono">{fmtRp(cat.retailValue)}</strong>
                        </span>
                        <span className="text-emerald-400 font-mono font-semibold">
                          Margin: +{fmtRp(cat.marginValue)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3B. DIAGNOSTICS ROW (STOCK HEALTH & TOP 5 CAPITAL ASSETS) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Panel B: Diagnostik Kesehatan Aset Stok (Produktif vs Dead Stock vs Kritis) */}
        <div className="lg:col-span-7 bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 flex flex-col justify-between shadow-xl">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                <span>Kesehatan &amp; Perputaran Modal Stok</span>
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                LIVE AUDIT
              </span>
            </div>

            <div className="space-y-2.5">
              {/* Productive Fast-Moving Stock */}
              <div
                onClick={() => {
                  setStockStatusFilter(stockStatusFilter === 'PRODUCTIVE' ? 'ALL' : 'PRODUCTIVE');
                  setActiveTab('inventory_asset');
                }}
                className={`p-3 rounded-xl border cursor-pointer transition ${
                  stockStatusFilter === 'PRODUCTIVE'
                    ? 'bg-emerald-950/30 border-emerald-500/50'
                    : 'bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-emerald-400">Stok Produktif (Aktif Terjual)</span>
                  <span className="font-mono font-bold text-white">
                    {assetSummary.productiveCount} SKU
                  </span>
                </div>
                <div className="text-sm font-mono font-black text-white mt-1">
                  {fmtRp(assetSummary.productiveCapital)}
                </div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  Modal barang yang aktif berputar menghasilkan penjualan.
                </div>
              </div>

              {/* Dead Stock / Slow Moving Capital */}
              <div
                onClick={() => {
                  setStockStatusFilter(stockStatusFilter === 'DEAD_STOCK' ? 'ALL' : 'DEAD_STOCK');
                  setActiveTab('inventory_asset');
                }}
                className={`p-3 rounded-xl border cursor-pointer transition ${
                  stockStatusFilter === 'DEAD_STOCK'
                    ? 'bg-amber-950/30 border-amber-500/50'
                    : 'bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-amber-400">Modal Tertahan / Dead Stock</span>
                  <span className="font-mono font-bold text-white">
                    {assetSummary.deadStockCount} SKU
                  </span>
                </div>
                <div className="text-sm font-mono font-black text-amber-300 mt-1">
                  {fmtRp(assetSummary.deadStockCapital)}
                </div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  Produk dengan stok tersedia namun belum ada transaksi penjualan.
                </div>
              </div>

              {/* Low / Out of Stock */}
              <div
                onClick={() => {
                  setStockStatusFilter(stockStatusFilter === 'LOW_STOCK' ? 'ALL' : 'LOW_STOCK');
                  setActiveTab('inventory_asset');
                }}
                className={`p-3 rounded-xl border cursor-pointer transition ${
                  stockStatusFilter === 'LOW_STOCK'
                    ? 'bg-rose-950/30 border-rose-500/50'
                    : 'bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-rose-400">Stok Kritis &amp; Habis</span>
                  <span className="font-mono font-bold text-white">
                    {assetSummary.lowStockCount + assetSummary.outOfStockCount} SKU
                  </span>
                </div>
                <div className="text-sm font-mono font-black text-rose-300 mt-1">
                  {fmtRp(assetSummary.lowStockCapital)}
                </div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  {assetSummary.lowStockCount} SKU menipis, {assetSummary.outOfStockCount} SKU habis (Rp 0).
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Panel C: Top 5 Produk Aset Modal Tertinggi */}
        <div className="lg:col-span-5 bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 flex flex-col justify-between shadow-xl">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Boxes className="w-4 h-4 text-amber-400" />
                <span>Top 5 Konsentrasi Modal</span>
              </h3>
            </div>

            {topCapitalProducts.length === 0 ? (
              <div className="py-10 text-center text-xs text-zinc-500">
                Belum ada produk di Firestore.
              </div>
            ) : (
              <div className="space-y-2.5">
                {topCapitalProducts.map((p, idx) => {
                  const pct =
                    assetSummary.totalInventoryCost > 0
                      ? Math.round((p.totalAssetCost / assetSummary.totalInventoryCost) * 100)
                      : 0;
                  return (
                    <div
                      key={p.id}
                      onClick={() => openEditProductModal(p)}
                      className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 hover:border-zinc-700 transition cursor-pointer"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white truncate max-w-[160px]">
                          #{idx + 1} {p.name}
                        </span>
                        <span className="text-[10px] font-mono text-amber-400 font-bold">
                          {pct}% Modal
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] mt-1">
                        <span className="text-zinc-400 font-mono">
                          {p.stockInUnits} pcs ({p.cartonsEquivalent.toFixed(1)} dus)
                        </span>
                        <span className="font-mono font-bold text-cyan-300">
                          {fmtRp(p.totalAssetCost)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <button
            onClick={() => navigateToPath('/dashboard/produk')}
            className="mt-3 w-full py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
          >
            <span>Buka Katalog Produk Lengkap</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 4. MAIN INTERACTIVE TABS FOR DETAILED ASSET LEDGERS */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl shadow-xl overflow-hidden">
        {/* Tab Navigation Bar */}
        <div className="border-b border-zinc-800 px-4 pt-3 flex flex-wrap items-center justify-between gap-3 bg-zinc-950/50">
          <div className="flex items-center gap-1 overflow-x-auto pb-2 sm:pb-0">
            <button
              onClick={() => setActiveTab('inventory_asset')}
              className={`px-4 py-2.5 text-xs font-bold rounded-t-xl border-b-2 transition cursor-pointer flex items-center gap-2 ${
                activeTab === 'inventory_asset'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              <Package className="w-4 h-4" />
              <span>Rincian Aset Stok Produk ({enrichedProducts.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('fixed_asset')}
              className={`px-4 py-2.5 text-xs font-bold rounded-t-xl border-b-2 transition cursor-pointer flex items-center gap-2 ${
                activeTab === 'fixed_asset'
                  ? 'border-purple-400 text-purple-300 bg-purple-950/20'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>Aset Tetap &amp; Inventaris Toko ({fixedAssets.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('cash_vault')}
              className={`px-4 py-2.5 text-xs font-bold rounded-t-xl border-b-2 transition cursor-pointer flex items-center gap-2 ${
                activeTab === 'cash_vault'
                  ? 'border-emerald-400 text-emerald-300 bg-emerald-950/20'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              <Vault className="w-4 h-4" />
              <span>Kas Laci, Brankas &amp; Arus Dana ({safeDeposits.length + cashFlows.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('receivables_payables')}
              className={`px-4 py-2.5 text-xs font-bold rounded-t-xl border-b-2 transition cursor-pointer flex items-center gap-2 ${
                activeTab === 'receivables_payables'
                  ? 'border-amber-400 text-amber-300 bg-amber-950/20'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>
                Piutang Pelanggan &amp; Hutang PO (
                {assetSummary.customerDebtList.length + assetSummary.unpaidPurchaseOrders.length})
              </span>
            </button>
          </div>
        </div>

        {/* TAB 1: RINCIAN ASET STOK PRODUK */}
        {activeTab === 'inventory_asset' && (
          <div className="p-5 space-y-4">
            {/* Filter & Search Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari nama produk, SKU, barcode, atau kategori..."
                  className="w-full pl-9 pr-4 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs">
                  <Filter className="w-3.5 h-3.5 text-zinc-400" />
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="bg-transparent text-zinc-200 focus:outline-none cursor-pointer"
                  >
                    <option value="ALL" className="bg-zinc-900">
                      Semua Kategori
                    </option>
                    {availableCategories.map((cat) => (
                      <option key={cat} value={cat} className="bg-zinc-900">
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <select
                  value={stockStatusFilter}
                  onChange={(e) => setStockStatusFilter(e.target.value as any)}
                  className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none cursor-pointer"
                >
                  <option value="ALL">Semua Status Stok</option>
                  <option value="PRODUCTIVE">Stok Produktif (Aktif Terjual)</option>
                  <option value="DEAD_STOCK">Dead Stock (Modal Tertahan)</option>
                  <option value="LOW_STOCK">Stok Menipis / Kritis</option>
                  <option value="OUT_OF_STOCK">Stok Habis (0 Unit)</option>
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none cursor-pointer"
                >
                  <option value="cost_desc">Urutkan: Modal Aset Tertinggi</option>
                  <option value="retail_desc">Urutkan: Nilai Jual Tertinggi</option>
                  <option value="margin_desc">Urutkan: Potensi Laba Tertinggi</option>
                  <option value="stock_desc">Urutkan: Stok Fisik Terbanyak</option>
                  <option value="name_asc">Urutkan: Nama Produk (A-Z)</option>
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="bg-zinc-950/90 text-[11px] uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4">Produk &amp; SKU</th>
                    <th className="py-3 px-3">Kategori</th>
                    <th className="py-3 px-3 text-center">Kemasan</th>
                    <th className="py-3 px-3 text-right">Stok Fisik</th>
                    <th className="py-3 px-3 text-right">Terjual</th>
                    <th className="py-3 px-3 text-right">HPP / Unit</th>
                    <th className="py-3 px-3 text-right">Harga Jual</th>
                    <th className="py-3 px-4 text-right text-cyan-300">Nilai Aset Modal (HPP)</th>
                    <th className="py-3 px-4 text-right text-emerald-300">Nilai Jual Aset</th>
                    <th className="py-3 px-4 text-right">Potensi Margin</th>
                    <th className="py-3 px-3 text-center">Status Aset</th>
                    <th className="py-3 px-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-10 text-center text-zinc-500">
                        Tidak ada data produk yang sesuai filter di Cloud Firestore.
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((p) => (
                      <tr key={p.id} className="hover:bg-zinc-800/35 transition">
                        <td className="py-3 px-4">
                          <div className="font-bold text-white">{p.name}</div>
                          <div className="text-[10px] font-mono text-zinc-500">
                            SKU: {p.sku || p.id} {p.barcode ? `• ${p.barcode}` : ''}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px]">
                            {p.category || 'UMUM'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-zinc-400">
                          {p.piecesPerCarton} pcs/dus
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="font-bold text-white font-mono">
                            {p.stockInUnits.toLocaleString('id-ID')} pcs
                          </div>
                          <div className="text-[10px] font-mono text-zinc-500">
                            ({p.cartonsEquivalent.toFixed(1)} dus)
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-zinc-300">
                          {p.qtySold.toLocaleString('id-ID')} pcs
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-zinc-300">
                          {fmtRp(p.costPerUnit)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-zinc-200">
                          {fmtRp(p.pricePerUnit)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-cyan-300 bg-cyan-950/10">
                          {fmtRp(p.totalAssetCost)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-300 bg-emerald-950/10">
                          {fmtRp(p.totalAssetRetail)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          <div className="font-bold text-amber-300">+{fmtRp(p.potentialMargin)}</div>
                          <div className="text-[10px] text-zinc-400">{p.marginPct}%</div>
                        </td>
                        <td className="py-3 px-3 text-center">
                          {p.assetStatus === 'PRODUCTIVE' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              Produktif
                            </span>
                          )}
                          {p.assetStatus === 'DEAD_STOCK' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                              Dead Stock
                            </span>
                          )}
                          {p.assetStatus === 'LOW_STOCK' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                              Stok Kritis
                            </span>
                          )}
                          {p.assetStatus === 'OUT_OF_STOCK' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-zinc-700">
                              Habis
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <button
                            onClick={() => openEditProductModal(p)}
                            title="Edit HPP, Harga Jual, atau Stok Fisik"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-cyan-600 text-zinc-300 hover:text-white transition cursor-pointer inline-flex items-center gap-1 text-[10px] font-bold px-2"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span>Ubah</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredProducts.length > 0 && (
                  <tfoot className="bg-zinc-950 font-mono text-xs font-bold text-white border-t-2 border-zinc-800">
                    <tr>
                      <td colSpan={3} className="py-3.5 px-4 text-zinc-300 uppercase">
                        TOTAL ({filteredProducts.length} SKU TERFILTER)
                      </td>
                      <td className="py-3.5 px-3 text-right text-white">
                        {filteredProducts
                          .reduce((s, p) => s + p.stockInUnits, 0)
                          .toLocaleString('id-ID')}{' '}
                        pcs
                      </td>
                      <td className="py-3.5 px-3 text-right text-zinc-300">
                        {filteredProducts
                          .reduce((s, p) => s + p.qtySold, 0)
                          .toLocaleString('id-ID')}{' '}
                        pcs
                      </td>
                      <td colSpan={2} className="py-3.5 px-3 text-right text-zinc-400">
                        Subtotal Valuasi:
                      </td>
                      <td className="py-3.5 px-4 text-right text-cyan-300">
                        {fmtRp(filteredProducts.reduce((s, p) => s + p.totalAssetCost, 0))}
                      </td>
                      <td className="py-3.5 px-4 text-right text-emerald-300">
                        {fmtRp(filteredProducts.reduce((s, p) => s + p.totalAssetRetail, 0))}
                      </td>
                      <td className="py-3.5 px-4 text-right text-amber-300">
                        +{fmtRp(filteredProducts.reduce((s, p) => s + p.potentialMargin, 0))}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: ASET TETAP & INVENTARIS TOKO (`store_fixed_assets`) */}
        {activeTab === 'fixed_asset' && (
          <div className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-purple-950/20 border border-purple-500/30 rounded-xl p-4">
              <div>
                <h4 className="text-sm font-bold text-white">
                  Daftar Inventaris &amp; Aset Tetap Operasional Toko
                </h4>
                <p className="text-xs text-zinc-400">
                  Pencatatan peralatan toko, mesin kasir, kulkas chiller, rak gudang, dan kendaraan operasional di koleksi Firestore <code className="text-purple-300">store_fixed_assets</code>.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-[10px] text-zinc-400 uppercase block font-bold">
                    Total Nilai Buku Aset Tetap
                  </span>
                  <span className="text-xl font-mono font-black text-purple-300">
                    {fmtRp(assetSummary.totalFixedAssetBookValue)}
                  </span>
                </div>
                <button
                  onClick={openAddFixedAsset}
                  className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Tambah Aset Tetap</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="bg-zinc-950 text-[11px] uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4">Kode &amp; Nama Aset</th>
                    <th className="py-3 px-3">Kategori</th>
                    <th className="py-3 px-3">Lokasi</th>
                    <th className="py-3 px-3 text-center">Tanggal Beli</th>
                    <th className="py-3 px-3 text-right">Qty</th>
                    <th className="py-3 px-3 text-right">Harga Perolehan</th>
                    <th className="py-3 px-4 text-right text-purple-300">Total Nilai Buku Saat Ini</th>
                    <th className="py-3 px-3 text-center">Kondisi</th>
                    <th className="py-3 px-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {fixedAssets.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-zinc-500">
                        Belum ada aset tetap / peralatan toko yang dicatat di Firestore (Rp 0). Klik tombol <strong>+ Tambah Aset Tetap</strong> untuk mencatat inventaris toko Anda.
                      </td>
                    </tr>
                  ) : (
                    fixedAssets.map((item) => {
                      const qty = Math.max(1, Number(item.qty || 1));
                      const totalBook =
                        qty * toIdr(item.currentValue !== undefined ? item.currentValue : item.purchaseCost || 0);
                      return (
                        <tr key={item.id} className="hover:bg-zinc-800/35 transition">
                          <td className="py-3 px-4">
                            <div className="font-bold text-white">{item.name}</div>
                            <div className="text-[10px] font-mono text-zinc-500">
                              {item.code} {item.notes ? `• ${item.notes}` : ''}
                            </div>
                          </td>
                          <td className="py-3 px-3">{item.category}</td>
                          <td className="py-3 px-3 text-zinc-400">{item.location || 'Outlet Utama'}</td>
                          <td className="py-3 px-3 text-center font-mono text-zinc-400">
                            {item.acquiredDate || '-'}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-white">
                            {qty} unit
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-zinc-300">
                            {fmtRp(qty * toIdr(item.purchaseCost || 0))}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-purple-300">
                            {fmtRp(totalBook)}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                item.condition === 'Baik'
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                  : item.condition === 'Perlu Servis'
                                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                  : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                              }`}
                            >
                              {item.condition || 'Baik'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => openEditFixedAsset(item)}
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-purple-600 text-zinc-300 hover:text-white transition cursor-pointer"
                                title="Edit Aset Tetap"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={async () => {
                                  await deleteFixedAsset(item.id);
                                  showToast(`Aset tetap "${item.name}" telah dihapus.`);
                                }}
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-600 text-zinc-300 hover:text-white transition cursor-pointer"
                                title="Hapus Aset Tetap"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: KAS LACI, BRANKAS & ARUS DANA */}
        {activeTab === 'cash_vault' && (
          <div className="p-5 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                <span className="text-[10px] font-bold uppercase text-zinc-400">
                  Kas Fisik Laci Kasir (POS)
                </span>
                <div className="text-xl font-black font-mono text-emerald-400 mt-1">
                  {fmtRp(assetSummary.cashInDrawer)}
                </div>
                <div className="text-[11px] text-zinc-500 mt-1">
                  Modal Awal {fmtRp(openingCash)} + Tunai {fmtRp(assetSummary.cashSalesTotal)}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                <span className="text-[10px] font-bold uppercase text-zinc-400">
                  Pendapatan Non-Tunai / QRIS
                </span>
                <div className="text-xl font-black font-mono text-blue-400 mt-1">
                  {fmtRp(assetSummary.nonCashSalesTotal)}
                </div>
                <div className="text-[11px] text-zinc-500 mt-1">
                  Tercatat otomatis dari transaksi QRIS, Debit &amp; Transfer
                </div>
              </div>

              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                <span className="text-[10px] font-bold uppercase text-zinc-400">
                  Saldo Brankas Toko (Safe Drop)
                </span>
                <div className="text-xl font-black font-mono text-cyan-300 mt-1">
                  {fmtRp(assetSummary.vaultSafeDrops)}
                </div>
                <div className="text-[11px] text-zinc-500 mt-1">
                  Cadangan Modal PO: {fmtRp(assetSummary.vaultModalReserve)}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase text-zinc-400">
                    Kas Masuk vs Kas Keluar
                  </span>
                  <div className="text-sm font-mono font-bold text-emerald-400 mt-1">
                    Masuk: +{fmtRp(assetSummary.totalKasMasuk + assetSummary.cashFlowIn)}
                  </div>
                  <div className="text-sm font-mono font-bold text-rose-400">
                    Keluar: -{fmtRp(assetSummary.totalKasKeluar + assetSummary.cashFlowOut)}
                  </div>
                </div>
                <button
                  onClick={() => navigateToPath('/dashboard/keuangan/brangkas-toko')}
                  className="mt-2 text-[11px] text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <span>Buka Modul Brangkas Toko</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="bg-zinc-950 text-[11px] uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4">Waktu Pencatatan</th>
                    <th className="py-3 px-3">Kategori Mutasi</th>
                    <th className="py-3 px-3">Sumber &rarr; Tujuan</th>
                    <th className="py-3 px-3">Keterangan</th>
                    <th className="py-3 px-3">Petugas</th>
                    <th className="py-3 px-4 text-right">Nominal (Rp)</th>
                    <th className="py-3 px-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {safeDeposits.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-zinc-500">
                        Belum ada riwayat mutasi brankas di koleksi <code className="text-cyan-300">safe_deposits</code> (Rp 0). Klik <strong>+ Mutasi Brankas</strong> di atas untuk mencatat setoran kas.
                      </td>
                    </tr>
                  ) : (
                    safeDeposits.map((dep) => (
                      <tr key={dep.id} className="hover:bg-zinc-800/35 transition">
                        <td className="py-3 px-4 font-mono text-zinc-400">
                          {dep.date || dep.createdAt || '-'}
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[10px] font-bold">
                            {dep.type || 'SETORAN_BRANKAS'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-white font-semibold">
                          {dep.from || 'Kasir'} &rarr; {dep.to || 'Brankas'}
                        </td>
                        <td className="py-3 px-3 text-zinc-400">{dep.note || '-'}</td>
                        <td className="py-3 px-3 text-zinc-300">{dep.actor || 'Admin'}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                          {fmtRp(toIdr(dep.amount || 0))}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <button
                            onClick={() => deleteSafeDeposit(dep.id)}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-600 text-zinc-400 hover:text-white transition cursor-pointer"
                            title="Hapus Mutasi"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: PIUTANG PELANGGAN & HUTANG SUPPLIER */}
        {activeTab === 'receivables_payables' && (
          <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Customer Receivables (Piutang Pelanggan) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-amber-950/20 border border-amber-500/30 rounded-xl p-3.5">
                <div>
                  <h4 className="text-xs font-bold uppercase text-amber-300">
                    Piutang Pelanggan (Aset Tagihan Masuk)
                  </h4>
                  <p className="text-[11px] text-zinc-400">
                    Total piutang aktif: <strong className="text-white font-mono">{fmtRp(assetSummary.totalReceivables)}</strong>
                  </p>
                </div>
                <button
                  onClick={() => navigateToPath('/dashboard/pelanggan/hutang')}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold cursor-pointer flex items-center gap-1"
                >
                  <span>Kelola Piutang</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-zinc-800">
                <table className="w-full text-left text-xs text-zinc-300">
                  <thead className="bg-zinc-950 text-[11px] uppercase text-zinc-400 border-b border-zinc-800">
                    <tr>
                      <th className="py-2.5 px-3">Pelanggan</th>
                      <th className="py-2.5 px-3">Kontak</th>
                      <th className="py-2.5 px-3 text-right">Saldo Piutang</th>
                      <th className="py-2.5 px-3 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {assetSummary.customerDebtList.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-zinc-500">
                          Tidak ada piutang / kasbon pelanggan aktif di Firestore (Rp 0).
                        </td>
                      </tr>
                    ) : (
                      assetSummary.customerDebtList.map((c) => (
                        <tr key={c.id} className="hover:bg-zinc-800/35">
                          <td className="py-2.5 px-3 font-bold text-white">{c.name}</td>
                          <td className="py-2.5 px-3 font-mono text-zinc-400">{c.phone || '-'}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-400">
                            {fmtRp(c.debtAmount)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button
                              onClick={async () => {
                                await updateStoreCustomer(c.id, { debtAmount: 0, debtAgeDays: 0 });
                                showToast(`Piutang pelanggan "${c.name}" ditandai lunas!`);
                              }}
                              className="px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white text-[10px] font-bold transition cursor-pointer"
                            >
                              Tandai Lunas
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right: Supplier Payables (Hutang PO Supplier) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-rose-950/20 border border-rose-500/30 rounded-xl p-3.5">
                <div>
                  <h4 className="text-xs font-bold uppercase text-rose-300">
                    Hutang Dagang Supplier (Kewajiban PO)
                  </h4>
                  <p className="text-[11px] text-zinc-400">
                    Total kewajiban PO belum lunas:{' '}
                    <strong className="text-white font-mono">{fmtRp(assetSummary.totalSupplierPayables)}</strong>
                  </p>
                </div>
                <button
                  onClick={() => navigateToPath('/dashboard/pembelian/daftar-pembelian')}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer flex items-center gap-1"
                >
                  <span>Kelola Faktur PO</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-zinc-800">
                <table className="w-full text-left text-xs text-zinc-300">
                  <thead className="bg-zinc-950 text-[11px] uppercase text-zinc-400 border-b border-zinc-800">
                    <tr>
                      <th className="py-2.5 px-3">No. PO &amp; Supplier</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Sisa Hutang</th>
                      <th className="py-2.5 px-3 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {assetSummary.unpaidPurchaseOrders.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-zinc-500">
                          Semua faktur PO supplier telah lunas (Hutang Rp 0).
                        </td>
                      </tr>
                    ) : (
                      assetSummary.unpaidPurchaseOrders.map((po) => (
                        <tr key={po.id} className="hover:bg-zinc-800/35">
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-white">{po.supplier || 'Supplier'}</div>
                            <div className="text-[10px] font-mono text-zinc-500">{po.id}</div>
                          </td>
                          <td className="py-2.5 px-3 text-zinc-400">{po.paymentStatus || 'Tempo'}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-400">
                            {fmtRp(po.remainingDebtIdr)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button
                              onClick={async () => {
                                await updatePurchaseOrder(po.id, {
                                  paidAmount: po.totalAmountIdr,
                                  remainingDebt: 0,
                                  paymentStatus: 'Lunas (Pelunasan Aset Toko)',
                                  updatedAt: new Date().toISOString(),
                                });
                                showToast(`Hutang PO ${po.id} berhasil dilunasi!`);
                              }}
                              className="px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white text-[10px] font-bold transition cursor-pointer"
                            >
                              Lunasi PO
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
        )}
      </div>

      {/* MODAL 1: EDIT PRODUCT ASSET (HPP, SELLING PRICE, STOCK) */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">Update Valuasi Aset Produk</h3>
                <p className="text-xs text-zinc-400">{editingProduct.name}</p>
              </div>
              <button
                onClick={() => setEditingProduct(null)}
                className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProductAsset} className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">
                  Harga Beli / Modal (HPP) per Unit (Rp)
                </label>
                <input
                  type="number"
                  min={0}
                  value={editCostPerUnit}
                  onChange={(e) => setEditCostPerUnit(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">
                  Harga Jual Ritel per Unit (Rp)
                </label>
                <input
                  type="number"
                  min={0}
                  value={editPricePerUnit}
                  onChange={(e) => setEditPricePerUnit(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white font-mono"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">
                    Stok Fisik (Unit / Pcs)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={editStockUnits}
                    onChange={(e) => setEditStockUnits(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">
                    Isi 1 Dus (Pcs/Dus)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={editPiecesPerCarton}
                    onChange={(e) => setEditPiecesPerCarton(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">
                    Tanggal Produksi
                  </label>
                  <input
                    type="date"
                    value={editProductionDate}
                    onChange={(e) => setEditProductionDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">
                    Tanggal Kadaluarsa
                  </label>
                  <input
                    type="date"
                    value={editExpiryDate}
                    onChange={(e) => setEditExpiryDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white font-mono"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                <div className="flex justify-between text-zinc-400">
                  <span>Nilai Kerugian Jika Expired (HPP):</span>
                  <strong className="text-rose-400 font-mono">
                    {fmtRp((Number(editStockUnits) || 0) * (Number(editCostPerUnit) || 0))}
                  </strong>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Estimasi Total Nilai Jual:</span>
                  <strong className="text-emerald-400 font-mono">
                    {fmtRp((Number(editStockUnits) || 0) * (Number(editPricePerUnit) || 0))}
                  </strong>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSavingProduct}
                  className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingProduct ? 'Menyimpan...' : 'Simpan ke Firestore'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD / EDIT FIXED STORE ASSET */}
      {showFixedAssetModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingFixedAsset ? 'Ubah Data Aset Tetap Toko' : 'Catat Aset Tetap / Inventaris Baru'}
                </h3>
                <p className="text-xs text-zinc-400">
                  Tersimpan langsung ke koleksi <code className="text-purple-300">store_fixed_assets</code> di Cloud Firestore
                </p>
              </div>
              <button
                onClick={() => setShowFixedAssetModal(false)}
                className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveFixedAsset} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-zinc-400 font-semibold mb-1">Nama Aset / Peralatan</label>
                  <input
                    type="text"
                    value={faName}
                    onChange={(e) => setFaName(e.target.value)}
                    placeholder="Contoh: Kulkas Showcase 2 Pintu / Rak Gondola Besi"
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Kode Inventaris</label>
                  <input
                    type="text"
                    value={faCode}
                    onChange={(e) => setFaCode(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Kategori</label>
                  <select
                    value={faCategory}
                    onChange={(e) => setFaCategory(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white"
                  >
                    <option value="Peralatan Toko">Peralatan Toko</option>
                    <option value="Elektronik & Kasir">Elektronik &amp; Kasir</option>
                    <option value="Pendingin / Chiller">Pendingin / Chiller</option>
                    <option value="Properti & Rak">Properti &amp; Rak</option>
                    <option value="Kendaraan">Kendaraan</option>
                    <option value="Lainnya">Lainnya</option>
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Jumlah Unit (Qty)</label>
                  <input
                    type="number"
                    min={1}
                    value={faQty}
                    onChange={(e) => setFaQty(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Kondisi Fisik</label>
                  <select
                    value={faCondition}
                    onChange={(e) => setFaCondition(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white"
                  >
                    <option value="Baik">Baik</option>
                    <option value="Perlu Servis">Perlu Servis</option>
                    <option value="Rusak">Rusak</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">
                    Harga Beli / Perolehan Satuan (Rp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={faPurchaseCost}
                    onChange={(e) => {
                      setFaPurchaseCost(e.target.value);
                      if (!editingFixedAsset) setFaCurrentValue(e.target.value);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">
                    Estimasi Nilai Buku Saat Ini / Unit (Rp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={faCurrentValue}
                    onChange={(e) => setFaCurrentValue(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Tanggal Perolehan</label>
                  <input
                    type="date"
                    value={faAcquiredDate}
                    onChange={(e) => setFaAcquiredDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Lokasi Penempatan</label>
                  <input
                    type="text"
                    value={faLocation}
                    onChange={(e) => setFaLocation(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFixedAssetModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Simpan Aset Tetap</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: ADD VAULT / BRANKAS MUTATION */}
      {showVaultModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">Catat Mutasi Kas &amp; Brankas</h3>
                <p className="text-xs text-zinc-400">
                  Tersimpan ke koleksi <code className="text-emerald-300">safe_deposits</code> di Firestore
                </p>
              </div>
              <button
                onClick={() => setShowVaultModal(false)}
                className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveVaultMutation} className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Tipe Mutasi Brankas</label>
                <select
                  value={vaultType}
                  onChange={(e) => setVaultType(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white"
                >
                  <option value="SETORAN_BRANKAS">Setoran Kasir ke Brankas Toko</option>
                  <option value="MUTASI_MODAL">Alokasi Cadangan Modal Restock (PO)</option>
                  <option value="ALOKASI_LABA">Alokasi / Penarikan Laba Bersih</option>
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Nominal (Rp)</label>
                <input
                  type="number"
                  min={1}
                  value={vaultAmount}
                  onChange={(e) => setVaultAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white font-mono"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Dari Akun/Laci</label>
                  <input
                    type="text"
                    value={vaultFrom}
                    onChange={(e) => setVaultFrom(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Ke Akun/Brankas</label>
                  <input
                    type="text"
                    value={vaultTo}
                    onChange={(e) => setVaultTo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Catatan Audit</label>
                <input
                  type="text"
                  value={vaultNote}
                  onChange={(e) => setVaultNote(e.target.value)}
                  placeholder="Contoh: Safe drop shift siang"
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowVaultModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Simpan Mutasi</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
