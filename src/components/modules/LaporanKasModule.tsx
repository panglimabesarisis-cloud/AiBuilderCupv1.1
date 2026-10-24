import React, { useState, useMemo, useEffect } from 'react';
import {
  FileText,
  Search,
  Calendar,
  Download,
  Printer,
  TrendingUp,
  ShoppingCart,
  Tag,
  CreditCard,
  Layers,
  Percent,
  BarChart2,
  ShieldAlert,
  RefreshCw,
  Store,
  Wallet,
} from 'lucide-react';
import { useFirestoreList } from '../../hooks/useFirestoreList';
import { useAppData } from '../../context/AppDataContext';
import { Transaction, Product } from '../../types';
import {
  computeProductReportData,
  ProductReportSubType,
} from './multiOutletReport';
import { ProductReportDetailView } from './ReportDetailPanel';
import { openTransactionDetailModal } from '../common/GlobalModals';
import { LaporanCashflowModule } from './LaporanCashflowModule';
import { useAppNavigation } from '../../router';

interface LaporanKasModuleProps {
  subModule?: string;
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string, sub?: string) => void;
}

type ReportType =
  | 'produk_keseluruhan'
  | 'produk_masuk'
  | 'produk_keluar'
  | 'keseluruhan'
  | 'rincian'
  | 'backdate'
  | 'loyalty_point'
  | 'online_order'
  | 'food_delivery'
  | 'marketplace'
  | 'pending_pos'
  | 'hourly'
  | 'item_date'
  | 'item_brand'
  | 'item_kategori'
  | 'petugas'
  | 'pelanggan'
  | 'diskon'
  | 'pengeluaran'
  | 'arus_kas'
  | 'laba_rugi'
  | 'pembatalan'
  | 'kas_selisih';

interface ReportMenuItem {
  id: ReportType;
  title: string;
  category: 'Penjualan' | 'Waktu & Tren' | 'Produk' | 'Petugas & Pelanggan' | 'Kas & Keuangan';
  badge?: string;
}

const PRODUCT_REPORT_MENU_ITEMS: ReportMenuItem[] = [
  { id: 'produk_keseluruhan', title: 'Laporan Keseluruhan Produk', category: 'Produk', badge: 'UTAMA' },
  { id: 'produk_masuk', title: 'Rincian Produk Masuk', category: 'Produk', badge: 'IN' },
  { id: 'produk_keluar', title: 'Rincian Produk Keluar', category: 'Produk', badge: 'OUT' },
];

const REPORT_MENU_ITEMS: ReportMenuItem[] = [
  // 1. Penjualan
  { id: 'keseluruhan', title: 'Laporan Keseluruhan Penjualan', category: 'Penjualan', badge: 'UTAMA' },
  { id: 'rincian', title: 'Rincian Penjualan', category: 'Penjualan' },
  { id: 'backdate', title: 'Rincian Penjualan Backdate', category: 'Penjualan' },
  { id: 'online_order', title: 'Rincian Penjualan - Online Order', category: 'Penjualan', badge: 'PWA' },
  { id: 'food_delivery', title: 'Rincian Penjualan Food delivery', category: 'Penjualan' },
  { id: 'marketplace', title: 'Rincian Penjualan Marketplace', category: 'Penjualan' },
  { id: 'pending_pos', title: 'Rincian Penjualan Pending POS', category: 'Penjualan' },
  // 2. Waktu & Tren
  { id: 'hourly', title: 'Rincian Penjualan berdasarkan Jam', category: 'Waktu & Tren', badge: 'PEAK' },
  { id: 'item_date', title: 'Item Penjualan berdasarkan Tanggal', category: 'Waktu & Tren' },
  // 3. Produk
  { id: 'item_brand', title: 'Item Penjualan berdasarkan Brand', category: 'Produk' },
  { id: 'item_kategori', title: 'Item Penjualan berdasarkan Kategori', category: 'Produk' },
  // 4. Petugas & Pelanggan
  { id: 'petugas', title: 'Penjualan berdasarkan Petugas / Kasir', category: 'Petugas & Pelanggan' },
  { id: 'pelanggan', title: 'Penjualan berdasarkan Pelanggan', category: 'Petugas & Pelanggan' },
  { id: 'loyalty_point', title: 'Rincian Penggunaan Loyalty Point', category: 'Petugas & Pelanggan' },
  // 5. Kas & Keuangan
  { id: 'diskon', title: 'Ringkasan Diskon & Promo', category: 'Kas & Keuangan' },
  { id: 'pengeluaran', title: 'Pengeluaran berdasarkan Tanggal', category: 'Kas & Keuangan' },
  { id: 'arus_kas', title: 'Laporan Arus Kas & Rekonsiliasi Laci', category: 'Kas & Keuangan', badge: 'KAS' },
  { id: 'laba_rugi', title: 'Laba / Rugi & Gross Margin', category: 'Kas & Keuangan', badge: 'PROFIT' },
  { id: 'pembatalan', title: 'Rincian Pembatalan / Void & Retur', category: 'Kas & Keuangan' },
  { id: 'kas_selisih', title: 'Kas Selisih & Rekonsiliasi Kasir', category: 'Kas & Keuangan' },
];

const ALL_REPORT_MENU_ITEMS: ReportMenuItem[] = [
  ...PRODUCT_REPORT_MENU_ITEMS,
  ...REPORT_MENU_ITEMS,
];

const CATEGORY_COLORS = [
  'bg-blue-500',
  'bg-cyan-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-rose-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-sky-500',
];

function toLocalDateKey(raw: any): string {
  if (!raw) return '';
  const d =
    typeof raw?.toDate === 'function'
      ? raw.toDate()
      : raw instanceof Date
      ? raw
      : new Date(raw);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toTimestampMs(raw: any): number {
  if (!raw) return 0;
  const d =
    typeof raw?.toDate === 'function'
      ? raw.toDate()
      : raw instanceof Date
      ? raw
      : new Date(raw);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

export const LaporanKasModule: React.FC<LaporanKasModuleProps> = ({
  subModule,
  currencyMode,
  onNavigateTab,
}) => {
  const { navigateToPath } = useAppNavigation();
  const [activeTopTab, setActiveTopTab] = useState<string>('penjualan');
  const [selectedReport, setSelectedReport] = useState<ReportType>('keseluruhan');
  const [searchReportKeyword, setSearchReportKeyword] = useState<string>('');

  useEffect(() => {
    if (!subModule) return;
    const normalized = subModule.toLowerCase().replace(/-/g, '_') as ReportType;
    if (ALL_REPORT_MENU_ITEMS.some((item) => item.id === normalized)) {
      setSelectedReport(normalized);
      if (normalized.startsWith('produk_')) {
        setActiveTopTab('produk');
      } else {
        setActiveTopTab('penjualan');
      }
    }
  }, [subModule]);

  // Date range filter (defaults to Bulan Ini so all current month live Firestore records are visible, with instant toggle for Hari Ini / Semua)
  const now = new Date();
  const todayStr = toLocalDateKey(now);
  const firstOfMonthStr = toLocalDateKey(new Date(now.getFullYear(), now.getMonth(), 1));

  const [dateRangePreset, setDateRangePreset] = useState<'today' | 'yesterday' | '7days' | 'month' | 'year' | 'all' | 'custom'>('month');
  const [startDate, setStartDate] = useState<string>(firstOfMonthStr);
  const [endDate, setEndDate] = useState<string>(todayStr);

  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterCashier, setFilterCashier] = useState<string>('all');
  const [filterPayment, setFilterPayment] = useState<string>('all');

  const [chartMode, setChartMode] = useState<'sales' | 'hourly' | 'category'>('sales');

  // 100% Live Cloud Firestore Data via AppDataContext & Firestore collections
  const {
    transactions: ctxTransactions,
    products: ctxProducts,
    orders: ctxOrders,
    currencyMode: activeCurrencyMode,
    refreshFirestore,
    formatMoney,
  } = useAppData();

  const { data: storeTransactions } = useFirestoreList<any>('stores/store_001/transactions', []);
  const { data: rawCashFlows } = useFirestoreList<any>('cash_flows', []);
  const { data: rawKasMasuk } = useFirestoreList<any>('shift_kas_masuk', []);
  const { data: rawKasKeluar } = useFirestoreList<any>('shift_kas_keluar', []);
  const { data: rawShifts } = useFirestoreList<any>('shifts', []);
  const { data: rawShiftHistory } = useFirestoreList<any>('shift_history', []);
  const { data: rawPurchaseOrders } = useFirestoreList<any>('purchase_orders', []);
  const { data: rawStockMovements } = useFirestoreList<any>('stock_movements', []);
  const { data: rawStockMutations } = useFirestoreList<any>('stock_mutations', []);

  // Format currency helpers (reactive to global IDR <-> USD switcher & live exchange rate)
  const fmt = (num: number) => {
    const val = Number.isFinite(num) ? num : 0;
    return formatMoney(val);
  };

  const fmtShort = (num: number) => {
    const val = Number.isFinite(num) ? num : 0;
    return formatMoney(val);
  };

  // Build product lookup map by id, sku, and name for accurate category & HPP (cost) resolution
  const productLookup = useMemo(() => {
    const byId = new Map<string, Product>();
    const byName = new Map<string, Product>();
    ctxProducts.forEach((p) => {
      if (p.id) byId.set(p.id, p);
      if (p.sku) byId.set(p.sku, p);
      if (p.name) byName.set(p.name.trim().toLowerCase(), p);
    });
    return { byId, byName };
  }, [ctxProducts]);

  // Merge and deduplicate live transactions + orders from Firestore
  const allUnifiedTransactions = useMemo(() => {
    const map = new Map<string, any>();

    const addRecord = (rec: any, defaultChannel: 'pos' | 'pwa_client') => {
      if (!rec) return;
      const canonicalId = String(rec.transactionId || rec.orderId || rec.id || '');
      if (!canonicalId) return;
      const existing = map.get(canonicalId);
      if (!existing) {
        map.set(canonicalId, {
          ...rec,
          id: rec.id || canonicalId,
          channel: rec.channel || (rec.orderId ? 'pwa_client' : defaultChannel),
        });
      }
    };

    ctxTransactions.forEach((t) => addRecord(t, 'pos'));
    storeTransactions.forEach((t) => addRecord(t, 'pos'));
    ctxOrders.forEach((o) => {
      // Include orders that are not already mirrored in transactions
      const key = String(o.transactionId || o.orderId || o.id || '');
      if (key && !map.has(key)) {
        addRecord(
          {
            ...o,
            id: o.id || key,
            channel: 'pwa_client',
            totalAmount: Number(o.totalAmount ?? o.total ?? o.grandTotal ?? 0),
            paymentMethod: o.paymentMethod || 'online',
          },
          'pwa_client'
        );
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      const ta = toTimestampMs(a.createdAt || a.timestamp || a.date);
      const tb = toTimestampMs(b.createdAt || b.timestamp || b.date);
      return tb - ta;
    });
  }, [ctxTransactions, storeTransactions, ctxOrders]);

  // Extract distinct cashiers from real transactions for the cashier filter dropdown
  const availableCashiers = useMemo(() => {
    const set = new Set<string>();
    allUnifiedTransactions.forEach((t) => {
      const c = String(t.cashierName || t.cashierId || t.createdBy || '').trim();
      if (c) set.add(c);
    });
    return Array.from(set);
  }, [allUnifiedTransactions]);

  // Helper to check if a date key falls within [startDate, endDate]
  const isWithinPeriod = (rawDate: any): boolean => {
    if (dateRangePreset === 'all') return true;
    const key = toLocalDateKey(rawDate);
    if (!key) return false;
    if (startDate && key < startDate) return false;
    if (endDate && key > endDate) return false;
    return true;
  };

  // Pure 100% Real-Time Calculations from Firestore
  const reportData = useMemo(() => {
    // 1. Filter transactions by period, source, cashier, payment method
    const periodTrx = allUnifiedTransactions.filter((t) => {
      const rawTime = t.createdAt || t.timestamp || t.date || t.updatedAt;
      if (!isWithinPeriod(rawTime)) return false;

      const ch = String(t.channel || t.source || 'pos').toLowerCase();
      if (filterSource === 'pos' && (ch.includes('pwa') || ch.includes('online') || ch.includes('market'))) {
        return false;
      }
      if (filterSource === 'online' && !ch.includes('pwa') && !ch.includes('online')) {
        return false;
      }
      if (filterSource === 'marketplace' && !ch.includes('market') && !ch.includes('grab') && !ch.includes('gofood')) {
        return false;
      }

      if (filterCashier !== 'all') {
        const cName = String(t.cashierName || t.cashierId || t.createdBy || '').toLowerCase();
        if (cName !== filterCashier.toLowerCase()) return false;
      }

      if (filterPayment !== 'all') {
        const pm = String(t.paymentMethod || '').toLowerCase();
        if (filterPayment === 'cash' && pm !== 'cash' && pm !== 'tunai') return false;
        if (filterPayment === 'qris' && !pm.includes('qris')) return false;
        if (filterPayment === 'hutang' && pm !== 'debt' && pm !== 'hutang') return false;
        if (filterPayment === 'cod' && pm !== 'cod') return false;
        if (filterPayment === 'bank_transfer' && !pm.includes('transfer') && !pm.includes('bca') && !pm.includes('bank')) return false;
        if (filterPayment === 'card' && !pm.includes('card') && !pm.includes('debit') && !pm.includes('edc') && !pm.includes('kredit')) return false;
      }

      return true;
    });

    // Separate valid/completed sales vs void/cancelled/refunded transactions
    const voidStatuses = new Set(['void', 'cancelled', 'canceled', 'rejected', 'refunded', 'batal']);
    const voidTrx = periodTrx.filter((t) =>
      voidStatuses.has(String(t.status || t.fulfillmentStatus || '').toLowerCase())
    );
    const validTrx = periodTrx.filter(
      (t) => !voidStatuses.has(String(t.status || t.fulfillmentStatus || '').toLowerCase())
    );

    // Calculate Gross Sales, Discounts, Net Sales, COGS, Gross Profit
    let totalGrossSales = 0;
    let totalDiscounts = 0;
    let totalNetSales = 0;
    let totalCostOfGoods = 0;

    // Source breakdown
    let posSalesAmount = 0;
    let posSalesCount = 0;
    let onlineSalesAmount = 0;
    let onlineSalesCount = 0;
    let marketplaceSalesAmount = 0;
    let marketplaceSalesCount = 0;

    // Payment method breakdown
    let cashSalesAmount = 0;
    let qrisSalesAmount = 0;
    let transferSalesAmount = 0;
    let cardSalesAmount = 0;
    let voidCashAmount = 0;
    let refundCashAmount = 0;

    // Discount & Loyalty breakdown
    const discountRowsMap = new Map<string, { source: string; code: string; name: string; amount: number; count: number }>();
    let totalLoyaltyPointsRedeemed = 0;
    let totalLoyaltyDiscountAmount = 0;

    // Category, Brand, Product, Cashier, Customer aggregations
    const categoryMap = new Map<string, { name: string; qty: number; amount: number }>();
    const productMap = new Map<string, { name: string; category: string; brand: string; qty: number; amount: number; cogs: number }>();
    const brandMap = new Map<string, { name: string; qty: number; amount: number }>();
    const cashierMap = new Map<string, { name: string; trxCount: number; qty: number; amount: number }>();
    const customerMap = new Map<string, { name: string; trxCount: number; amount: number }>();

    // Void calculations
    let totalVoidAmount = 0;
    let totalVoidDiscount = 0;
    voidTrx.forEach((vt) => {
      const amt = Number(vt.totalAmount ?? vt.total ?? vt.grandTotal ?? 0);
      const disc = Number(vt.discount ?? vt.discountAmount ?? 0);
      totalVoidAmount += amt;
      totalVoidDiscount += disc;
      const pm = String(vt.paymentMethod || '').toLowerCase();
      const st = String(vt.status || '').toLowerCase();
      if (pm === 'cash' || pm === 'tunai') {
        if (st === 'refunded' || st === 'retur') {
          refundCashAmount += amt;
        } else {
          voidCashAmount += amt;
        }
      }
    });

    validTrx.forEach((t) => {
      const netAmt = Number(t.totalAmount ?? t.total ?? t.grandTotal ?? 0);
      const discAmt = Number(t.discount ?? t.discountAmount ?? t.voucherDiscount ?? 0);
      const grossAmt = Number(t.subtotal ?? t.grossAmount ?? netAmt + discAmt);

      totalNetSales += netAmt;
      totalDiscounts += discAmt;
      totalGrossSales += grossAmt > 0 ? grossAmt : netAmt;

      // Channel / Source
      const ch = String(t.channel || t.source || 'pos').toLowerCase();
      if (ch.includes('pwa') || ch.includes('online')) {
        onlineSalesAmount += netAmt;
        onlineSalesCount += 1;
      } else if (ch.includes('market') || ch.includes('grab') || ch.includes('gofood')) {
        marketplaceSalesAmount += netAmt;
        marketplaceSalesCount += 1;
      } else {
        posSalesAmount += netAmt;
        posSalesCount += 1;
      }

      // Payment Method (Tunai immediately enters cash; COD enters cash when paid; Hutang only counts cash DP)
      const pm = String(t.paymentMethod || 'cash').toLowerCase();
      const pStatus = String(
        t.paymentStatus || (pm === 'debt' || pm === 'hutang' || pm === 'cod' ? 'unpaid' : 'paid')
      ).toLowerCase();
      if (pm.includes('qris')) {
        qrisSalesAmount += netAmt;
      } else if (pm.includes('transfer') || pm.includes('bca') || pm.includes('mandiri') || pm.includes('bank')) {
        transferSalesAmount += netAmt;
      } else if (pm.includes('card') || pm.includes('debit') || pm.includes('kredit') || pm.includes('edc')) {
        cardSalesAmount += netAmt;
      } else if (pm === 'debt' || pm === 'hutang') {
        const dpCash = Number(t.paidAmount || 0);
        if (pStatus === 'paid') {
          cashSalesAmount += netAmt;
        } else {
          cashSalesAmount += dpCash;
          cardSalesAmount += Math.max(0, netAmt - dpCash);
        }
      } else if (pm === 'cod') {
        if (pStatus === 'paid') {
          cashSalesAmount += netAmt;
        } else {
          transferSalesAmount += netAmt;
        }
      } else {
        cashSalesAmount += netAmt;
      }

      // Discounts tracking
      if (discAmt > 0) {
        const srcLabel = ch.includes('pwa') ? 'ONLINE ORDER (PWA)' : 'POINT OF SALE';
        const code = String(t.promoCode || t.voucherCode || t.discountCode || 'DISC-POS');
        const name = String(t.promoName || t.discountName || 'Potongan Harga Transaksi');
        const dKey = `${srcLabel}_${code}`;
        const prevD = discountRowsMap.get(dKey) || { source: srcLabel, code, name, amount: 0, count: 0 };
        prevD.amount += discAmt;
        prevD.count += 1;
        discountRowsMap.set(dKey, prevD);
      }

      // Loyalty tracking
      const pts = Number(t.pointsRedeemed ?? t.loyaltyPointsUsed ?? 0);
      const loyDisc = Number(t.loyaltyDiscount ?? 0);
      if (pts > 0 || loyDisc > 0) {
        totalLoyaltyPointsRedeemed += pts;
        totalLoyaltyDiscountAmount += loyDisc;
      }

      // Cashier tracking
      const cashierName = String(t.cashierName || t.cashierId || t.createdBy || 'Kasir POS').trim();
      const prevCashier = cashierMap.get(cashierName) || { name: cashierName, trxCount: 0, qty: 0, amount: 0 };
      prevCashier.trxCount += 1;
      prevCashier.amount += netAmt;

      // Customer tracking
      const custName = String(t.customerName || t.customer?.name || 'Pelanggan Umum').trim();
      const prevCust = customerMap.get(custName) || { name: custName, trxCount: 0, amount: 0 };
      prevCust.trxCount += 1;
      prevCust.amount += netAmt;
      customerMap.set(custName, prevCust);

      // Line Items & COGS calculation
      const items = Array.isArray(t.items) ? t.items : [];
      let txCogs = Number(t.totalCost ?? t.cogs ?? 0);
      let calculatedItemsCogs = 0;
      let txUnits = 0;

      items.forEach((item: any) => {
        const pid = String(item.productId || item.product?.id || item.id || '');
        const pName = String(item.productName || item.name || item.product?.name || 'Produk').trim();
        const matchedProd =
          productLookup.byId.get(pid) ||
          productLookup.byName.get(pName.toLowerCase());

        const catName = String(
          item.category || item.product?.category || matchedProd?.category || 'Tanpa Kategori'
        ).trim();
        const brandName = String(
          item.brand || item.product?.brand || matchedProd?.brand || 'Tanpa Brand'
        ).trim();

        const qty = Number(item.quantityOrdered ?? item.quantity ?? item.qty ?? 1);
        const unitPrice = Number(
          item.unitPrice ?? item.price ?? item.pricePerUnit ?? matchedProd?.pricePerUnit ?? 0
        );
        const lineSubtotal = Number(item.subtotal ?? item.total ?? qty * unitPrice);

        const unitCost = Number(
          item.costPerUnit ?? item.costPrice ?? item.product?.costPerUnit ?? matchedProd?.costPerUnit ?? 0
        );
        const lineCogs = unitCost * qty;
        calculatedItemsCogs += lineCogs;
        txUnits += qty;

        // Aggregate Category
        const prevCat = categoryMap.get(catName) || { name: catName, qty: 0, amount: 0 };
        prevCat.qty += qty;
        prevCat.amount += lineSubtotal;
        categoryMap.set(catName, prevCat);

        // Aggregate Product
        const prodKey = pid || pName;
        const prevProd = productMap.get(prodKey) || {
          name: pName,
          category: catName,
          brand: brandName,
          qty: 0,
          amount: 0,
          cogs: 0,
        };
        prevProd.qty += qty;
        prevProd.amount += lineSubtotal;
        prevProd.cogs += lineCogs;
        productMap.set(prodKey, prevProd);

        // Aggregate Brand
        const prevBrand = brandMap.get(brandName) || { name: brandName, qty: 0, amount: 0 };
        prevBrand.qty += qty;
        prevBrand.amount += lineSubtotal;
        brandMap.set(brandName, prevBrand);
      });

      // If transaction had no line items array, attribute to general category so category total matches sales
      if (items.length === 0 && netAmt > 0) {
        const fallbackCat = String((t as any).category || 'Penjualan Umum');
        const prevCat = categoryMap.get(fallbackCat) || { name: fallbackCat, qty: 0, amount: 0 };
        prevCat.qty += 1;
        prevCat.amount += netAmt;
        categoryMap.set(fallbackCat, prevCat);
        txUnits += 1;
      }

      prevCashier.qty += txUnits;
      cashierMap.set(cashierName, prevCashier);

      totalCostOfGoods += txCogs > 0 ? txCogs : calculatedItemsCogs;
    });

    // Cash Flows (Kas Masuk & Kas Keluar) from `cash_flows`, `shift_kas_masuk`, `shift_kas_keluar`
    const periodCashFlows = rawCashFlows.filter((cf) =>
      isWithinPeriod(cf.createdAt || cf.timestamp || cf.date)
    );
    const periodKasMasuk = rawKasMasuk.filter((km) =>
      isWithinPeriod(km.createdAt || km.timestamp || km.date)
    );
    const periodKasKeluar = rawKasKeluar.filter((kk) =>
      isWithinPeriod(kk.createdAt || kk.timestamp || kk.date)
    );

    const cfIn = periodCashFlows
      .filter((cf) => String(cf.type || cf.direction || '').toLowerCase() === 'in')
      .reduce((sum, cf) => sum + Number(cf.amount || cf.nominal || 0), 0);
    const cfOut = periodCashFlows
      .filter((cf) => String(cf.type || cf.direction || '').toLowerCase() === 'out')
      .reduce((sum, cf) => sum + Number(cf.amount || cf.nominal || 0), 0);

    const totalKasMasuk =
      cfIn + periodKasMasuk.reduce((sum, km) => sum + Number(km.amount || km.nominal || 0), 0);
    const totalKasKeluar =
      cfOut + periodKasKeluar.reduce((sum, kk) => sum + Number(kk.amount || kk.nominal || 0), 0);

    // Combine expense records for "Pengeluaran berdasarkan Tanggal" report
    const expenseRecords = [
      ...periodCashFlows
        .filter((cf) => String(cf.type || cf.direction || '').toLowerCase() === 'out')
        .map((cf) => ({
          id: cf.id,
          date: cf.createdAt || cf.timestamp || cf.date,
          category: cf.category || 'Operasional Toko',
          note: cf.description || cf.note || '-',
          pic: cf.cashierName || cf.createdBy || 'Kasir',
          amount: Number(cf.amount || cf.nominal || 0),
        })),
      ...periodKasKeluar.map((kk) => ({
        id: kk.id,
        date: kk.createdAt || kk.timestamp || kk.date,
        category: kk.category || 'Kas Keluar Shift',
        note: kk.note || kk.description || '-',
        pic: kk.cashierName || kk.pic || 'Kasir',
        amount: Number(kk.amount || kk.nominal || 0),
      })),
    ];

    // Shift Variance (Kas Selisih) from `shifts` & `shift_history`
    const allShiftDocs = [...rawShifts, ...rawShiftHistory].filter((s) =>
      isWithinPeriod(s.endTime || s.closedAt || s.startTime || s.createdAt)
    );
    const kasSelisih = allShiftDocs.reduce((sum, s) => {
      if (typeof s.variance === 'number') return sum + s.variance;
      if (typeof s.selisih === 'number') return sum + s.selisih;
      if (typeof s.actualCash === 'number' && typeof s.expectedCash === 'number') {
        return sum + (s.actualCash - s.expectedCash);
      }
      return sum;
    }, 0);

    // Stock Movements in Period (E. Stok)
    const periodMovements = rawStockMovements.filter((m) =>
      isWithinPeriod(m.createdAt || m.timestamp || m.date)
    );
    let stokKeluarValue = 0;
    let opnameStokValue = 0;
    periodMovements.forEach((m) => {
      const mType = String(m.type || '').toLowerCase();
      const prod = productLookup.byId.get(String(m.productId || ''));
      const unitCost = Number(m.costPerUnit ?? prod?.costPerUnit ?? 0);
      const units = Math.abs(Number(m.unitsChange ?? m.quantity ?? 0));
      if (mType.includes('opname') || mType.includes('adjust')) {
        opnameStokValue += units * unitCost;
      } else if (mType.includes('out') || mType.includes('sale') || mType.includes('waste')) {
        stokKeluarValue += units * unitCost;
      }
    });

    // Purchase Orders in Period (F. Pembelian)
    const periodPOs = rawPurchaseOrders.filter((po) =>
      isWithinPeriod(po.createdAt || po.orderDate || po.date)
    );
    const poDiscount = periodPOs.reduce((s, po) => s + Number(po.discount || 0), 0);
    const poShipping = periodPOs.reduce((s, po) => s + Number(po.shippingCost || po.ongkir || 0), 0);
    const poTax = periodPOs.reduce((s, po) => s + Number(po.tax || po.ppn || 0), 0);
    const poTotal = periodPOs.reduce((s, po) => s + Number(po.totalAmount || po.total || 0), 0);

    // Profit & Cash Drawer Totals
    const grossProfit = totalNetSales - totalCostOfGoods;
    const netProfit = grossProfit - totalKasKeluar;
    const grossMarginPct = totalNetSales > 0 ? (grossProfit / totalNetSales) * 100 : 0;
    const pendapatanTunai = Math.max(0, cashSalesAmount + totalKasMasuk - totalKasKeluar - refundCashAmount);
    const totalDigitalSales = qrisSalesAmount + transferSalesAmount + cardSalesAmount;
    const trxCount = validTrx.length;
    const avgBasket = trxCount > 0 ? totalNetSales / trxCount : 0;

    // Sort Category Breakdown (Sold categories sorted by revenue desc)
    const categoryBreakdown = Array.from(categoryMap.values())
      .sort((a, b) => b.amount - a.amount || b.qty - a.qty)
      .map((c, i) => ({
        ...c,
        color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
      }));

    const topGrupProduk = categoryBreakdown.slice(0, 4);
    const topProducts = Array.from(productMap.values()).sort((a, b) => b.amount - a.amount || b.qty - a.qty);
    const topBrands = Array.from(brandMap.values()).sort((a, b) => b.amount - a.amount || b.qty - a.qty);
    const cashierBreakdown = Array.from(cashierMap.values()).sort((a, b) => b.amount - a.amount);
    const customerBreakdown = Array.from(customerMap.values()).sort((a, b) => b.amount - a.amount);
    const discountRows = Array.from(discountRowsMap.values());

    return {
      periodTrx,
      validTrx,
      voidTrx,
      totalGrossSales,
      totalDiscounts,
      netSales: totalNetSales,
      totalCostOfGoods,
      grossProfit,
      netProfit,
      grossMarginPct,
      totalKasMasuk,
      totalKasKeluar,
      kasSelisih,
      pendapatanTunai,
      cashSalesAmount,
      qrisSalesAmount,
      transferSalesAmount,
      cardSalesAmount,
      totalDigitalSales,
      voidCashAmount,
      refundCashAmount,
      totalVoidAmount,
      totalVoidDiscount,
      posSalesAmount,
      posSalesCount,
      onlineSalesAmount,
      onlineSalesCount,
      marketplaceSalesAmount,
      marketplaceSalesCount,
      discountRows,
      totalLoyaltyPointsRedeemed,
      totalLoyaltyDiscountAmount,
      stokKeluarValue,
      opnameStokValue,
      poDiscount,
      poShipping,
      poTax,
      poTotal,
      categoryBreakdown,
      topGrupProduk,
      topProducts,
      topBrands,
      cashierBreakdown,
      customerBreakdown,
      expenseRecords,
      trxCount,
      avgBasket,
    };
  }, [
    allUnifiedTransactions,
    rawCashFlows,
    rawKasMasuk,
    rawKasKeluar,
    rawShifts,
    rawShiftHistory,
    rawStockMovements,
    rawPurchaseOrders,
    productLookup,
    dateRangePreset,
    startDate,
    endDate,
    filterSource,
    filterCashier,
    filterPayment,
  ]);

  // Filtered menu items in the left panel
  const filteredMenuItems = useMemo(() => {
    const baseItems =
      activeTopTab === 'produk' ? PRODUCT_REPORT_MENU_ITEMS : REPORT_MENU_ITEMS;
    if (!searchReportKeyword.trim()) return baseItems;
    const kw = searchReportKeyword.toLowerCase();
    return baseItems.filter(
      (m) => m.title.toLowerCase().includes(kw) || m.category.toLowerCase().includes(kw)
    );
  }, [activeTopTab, searchReportKeyword]);

  // Real-time Product Report computations for "Laporan Produk" (3 sub-reports)
  const productReportData = useMemo(() => {
    return computeProductReportData({
      products: ctxProducts,
      validTransactions: reportData.validTrx,
      purchaseOrders: rawPurchaseOrders,
      stockMutations: rawStockMutations,
      stockMovements: rawStockMovements,
      isWithinPeriod,
    });
  }, [
    ctxProducts,
    reportData.validTrx,
    rawPurchaseOrders,
    rawStockMutations,
    rawStockMovements,
    dateRangePreset,
    startDate,
    endDate,
  ]);

  // Handler for Export to Excel (CSV) using 100% real data
  const handleExportCSV = () => {
    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'RISKCART STORE - LAPORAN PENJUALAN & KAS\n';
    csvContent += `Periode: ${dateRangePreset === 'all' ? 'Semua Periode' : `${startDate} s/d ${endDate}`}\n`;
    csvContent += `Mata Uang: ${activeCurrencyMode || 'IDR'}\n`;
    csvContent += `Tanggal Cetak: ${new Date().toLocaleString('id-ID')}\n\n`;

    csvContent += 'METRIK,NILAI\n';
    csvContent += `"Total Omzet Kotor",${reportData.totalGrossSales}\n`;
    csvContent += `"Total Diskon",${reportData.totalDiscounts}\n`;
    csvContent += `"Penjualan Bersih (Net Sales)",${reportData.netSales}\n`;
    csvContent += `"HPP (Cost of Goods Sold)",${reportData.totalCostOfGoods}\n`;
    csvContent += `"Laba Kotor (Gross Profit)",${reportData.grossProfit}\n`;
    csvContent += `"Laba Bersih (Net Profit)",${reportData.netProfit}\n`;
    csvContent += `"Pendapatan Kas Tunai Laci",${reportData.pendapatanTunai}\n`;
    csvContent += `"Total Transaksi Valid",${reportData.trxCount}\n`;

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Laporan_Penjualan_Kas_RiskCart_${startDate}_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  // Preset Date Selection
  const handleDatePreset = (preset: 'today' | 'yesterday' | '7days' | 'month' | 'year' | 'all' | 'custom') => {
    setDateRangePreset(preset);
    const current = new Date();
    if (preset === 'today') {
      const s = toLocalDateKey(current);
      setStartDate(s);
      setEndDate(s);
    } else if (preset === 'yesterday') {
      const y = toLocalDateKey(new Date(current.getTime() - 86400000));
      setStartDate(y);
      setEndDate(y);
    } else if (preset === '7days') {
      const s = toLocalDateKey(new Date(current.getTime() - 6 * 86400000));
      setStartDate(s);
      setEndDate(toLocalDateKey(current));
    } else if (preset === 'month') {
      const firstDay = toLocalDateKey(new Date(current.getFullYear(), current.getMonth(), 1));
      setStartDate(firstDay);
      setEndDate(toLocalDateKey(current));
    } else if (preset === 'year') {
      const firstDayYear = toLocalDateKey(new Date(current.getFullYear(), 0, 1));
      setStartDate(firstDayYear);
      setEndDate(toLocalDateKey(current));
    }
  };

  // Real-time 7-Day Trend Chart Data (computed 100% from Firestore transactions)
  const dailyTrendData = useMemo(() => {
    const baseDate = endDate ? new Date(`${endDate}T12:00:00`) : new Date();
    const validBase = isNaN(baseDate.getTime()) ? new Date() : baseDate;
    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    const days: Array<{ key: string; day: string; revenue: number; trx: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(validBase.getTime() - i * 86400000);
      const key = toLocalDateKey(d);
      const label = `${dayNames[d.getDay()]}, ${d.getDate()} ${monthNames[d.getMonth()]}`;
      days.push({ key, day: label, revenue: 0, trx: 0 });
    }

    const dayMap = new Map(days.map((d) => [d.key, d]));
    const voidStatuses = new Set(['void', 'cancelled', 'canceled', 'rejected', 'refunded', 'batal']);

    allUnifiedTransactions.forEach((t) => {
      if (voidStatuses.has(String(t.status || t.fulfillmentStatus || '').toLowerCase())) return;
      const key = toLocalDateKey(t.createdAt || t.timestamp || t.date);
      const bucket = dayMap.get(key);
      if (bucket) {
        bucket.revenue += Number(t.totalAmount ?? t.total ?? t.grandTotal ?? 0);
        bucket.trx += 1;
      }
    });

    return days;
  }, [allUnifiedTransactions, endDate]);

  const highestDayInfo = useMemo(() => {
    let best = { day: '-', revenue: 0, trx: 0 };
    dailyTrendData.forEach((d) => {
      if (d.revenue > best.revenue) best = d;
    });
    return best;
  }, [dailyTrendData]);

  // Real-time Hourly Chart Data (computed 100% from filtered Firestore transactions)
  const hourlyData = useMemo(() => {
    const hours: Array<{ hour: string; sales: number; trx: number }> = [];
    for (let h = 6; h <= 22; h++) {
      hours.push({
        hour: `${String(h).padStart(2, '0')}:00`,
        sales: 0,
        trx: 0,
      });
    }

    reportData.validTrx.forEach((t) => {
      const ms = toTimestampMs(t.createdAt || t.timestamp || t.date);
      if (!ms) return;
      const h = new Date(ms).getHours();
      const clampedH = Math.max(6, Math.min(22, h));
      const idx = clampedH - 6;
      if (hours[idx]) {
        hours[idx].sales += Number(t.totalAmount ?? t.total ?? t.grandTotal ?? 0);
        hours[idx].trx += 1;
      }
    });

    return hours;
  }, [reportData.validTrx]);

  const peakHourInfo = useMemo(() => {
    let best = { hour: '-', sales: 0, trx: 0 };
    hourlyData.forEach((h) => {
      if (h.sales > best.sales) best = h;
    });
    return best;
  }, [hourlyData]);

  const maxDailyRev = Math.max(1, ...dailyTrendData.map((d) => d.revenue));
  const maxHourlySales = Math.max(1, ...hourlyData.map((h) => h.sales));

  const isCashflowRoute =
    subModule === 'laporancashflow' ||
    subModule === 'laporan_cashflow' ||
    subModule === 'laporan-cashflow' ||
    subModule === 'cashflow' ||
    (typeof window !== 'undefined' &&
      (window.location.pathname.toLowerCase().includes('/laporancashflow') ||
        window.location.pathname.toLowerCase().includes('/laporan-cashflow')));

  if (isCashflowRoute) {
    return (
      <LaporanCashflowModule
        currencyMode={currencyMode}
        onNavigateTab={onNavigateTab}
      />
    );
  }

  return (
    <div className="space-y-6 print:p-0 print:space-y-2">
      {/* 1. TOP NAVIGATION TABS & SHORTCUT TO LAPORAN CASHFLOW */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/70 p-2 rounded-2xl shadow-sm print:hidden">
        <div className="flex items-center gap-1 overflow-x-auto">
          <button
            onClick={() => {
              setActiveTopTab('produk');
              setSelectedReport('produk_keseluruhan');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              activeTopTab === 'produk'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
            }`}
          >
            Laporan Produk
          </button>
          <button
            onClick={() => {
              setActiveTopTab('pembelian');
              setSelectedReport('pengeluaran');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              activeTopTab === 'pembelian'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
            }`}
          >
            Laporan Pembelian
          </button>
          <button
            onClick={() => {
              setActiveTopTab('penjualan');
              setSelectedReport('keseluruhan');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTopTab === 'penjualan'
                ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-500/30'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
            }`}
          >
            <span>Laporan Penjualan</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          </button>
          <button
            onClick={() => {
              setActiveTopTab('shift');
              setSelectedReport('petugas');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              activeTopTab === 'shift'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
            }`}
          >
            Laporan Penjualan Per Shift
          </button>
          <button
            onClick={() => {
              setActiveTopTab('pembayaran');
              setSelectedReport('arus_kas');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              activeTopTab === 'pembayaran'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
            }`}
          >
            Laporan Pembayaran dan Kas
          </button>
        </div>

        <button
          type="button"
          onClick={() => navigateToPath('/dashboard/laporancashflow')}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 hover:brightness-110 text-black text-xs font-black transition flex items-center justify-center gap-2 shadow-[0_0_16px_rgba(245,158,11,0.3)] border border-amber-300/60 shrink-0 cursor-pointer"
        >
          <span>📊 Buka Laporan Cashflow &amp; Print 1 Halaman</span>
        </button>
      </div>

      {/* 2. MAIN 2-COLUMN LAYOUT: LAPORAN PRODUK (Kiri) + KONTEN LAPORAN DETAIL (Kanan) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* KOLOM KIRI: LAPORAN PRODUK */}
        <div className="lg:col-span-3 bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 space-y-4 shadow-xl print:hidden sticky top-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
            <h3 className="font-black text-white text-sm tracking-tight flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-400" />
              <span>
                {['produk', 'pembelian', 'penjualan', 'shift', 'pembayaran'].includes(activeTopTab)
                  ? 'Laporan Produk'
                  : 'Laporan Produk'}
              </span>
            </h3>
            <span className="text-[11px] font-mono text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full">
              {filteredMenuItems.length}
            </span>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Ketikkan keyword..."
              value={searchReportKeyword}
              onChange={(e) => setSearchReportKeyword(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          <div className="space-y-1 max-h-[640px] overflow-y-auto pr-1 custom-scrollbar text-xs">
            {filteredMenuItems.map((item) => {
              const isSelected = selectedReport === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedReport(item.id)}
                  className={`w-full text-left px-3 py-2 rounded-xl transition flex items-center justify-between group cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600/20 text-blue-400 font-bold border border-blue-500/40 shadow-sm'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
                  }`}
                >
                  <span className="truncate pr-2">{item.title}</span>
                  {item.badge && (
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase shrink-0 ${
                        isSelected
                          ? 'bg-blue-500 text-white'
                          : 'bg-zinc-800 text-zinc-400 group-hover:bg-zinc-700'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* KOLOM KANAN: DETAIL LAPORAN, FILTER, CHARTS, & TABEL */}
        <div className="lg:col-span-9 space-y-5">
          {/* HEADER ACTION BAR & FILTER */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 shadow-xl space-y-4">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
              <div>
                <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                  <BarChart2 className="w-5 h-5 text-emerald-400" />
                  <span>
                    {ALL_REPORT_MENU_ITEMS.find((r) => r.id === selectedReport)?.title ||
                      'Laporan Keseluruhan Penjualan'}
                  </span>
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Data dihitung 100% secara real-time dari koleksi Cloud Firestore (`products`, `transactions`, `orders`, `purchase_orders`, `cash_flows`).
                </p>
              </div>

              {/* DATE PICKER & ACTION BUTTONS */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-300">
                  <Calendar className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setDateRangePreset('custom');
                    }}
                    className="bg-transparent text-zinc-200 font-mono text-xs focus:outline-none"
                  />
                  <span className="text-zinc-500">s/d</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setDateRangePreset('custom');
                    }}
                    className="bg-transparent text-zinc-200 font-mono text-xs focus:outline-none"
                  />
                </div>

                <select
                  value={filterSource}
                  onChange={(e) => setFilterSource(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="all">Semua Penjualan</option>
                  <option value="pos">Point of Sale (POS Toko)</option>
                  <option value="online">Online Order (Client PWA)</option>
                  <option value="marketplace">Marketplace / Delivery</option>
                </select>

                <button
                  type="button"
                  onClick={() => refreshFirestore()}
                  className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold transition flex items-center gap-1.5 border border-zinc-700 cursor-pointer"
                  title="Sinkronkan Ulang dari Cloud Firestore"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Sync Live</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrint}
                  className="px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold transition flex items-center gap-1.5 border border-zinc-700 shadow-sm cursor-pointer"
                  title="Cetak atau Unduh Laporan PDF"
                >
                  <Printer className="w-3.5 h-3.5 text-rose-400" />
                  <span>PDF</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md cursor-pointer"
                  title="Ekspor Data Laporan ke File Excel / CSV"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>EXCEL</span>
                </button>
              </div>
            </div>

            {/* QUICK PRESET FILTER TANGGAL & DROPDOWN FILTER TAMBAHAN */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-zinc-500 text-[11px] font-bold uppercase tracking-wider mr-1">
                  Periode:
                </span>
                <button
                  onClick={() => handleDatePreset('today')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                    dateRangePreset === 'today'
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800/80 text-zinc-400 hover:text-white'
                  }`}
                >
                  Hari Ini
                </button>
                <button
                  onClick={() => handleDatePreset('yesterday')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                    dateRangePreset === 'yesterday'
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800/80 text-zinc-400 hover:text-white'
                  }`}
                >
                  Kemarin
                </button>
                <button
                  onClick={() => handleDatePreset('7days')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                    dateRangePreset === '7days'
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800/80 text-zinc-400 hover:text-white'
                  }`}
                >
                  7 Hari Terakhir
                </button>
                <button
                  onClick={() => handleDatePreset('month')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                    dateRangePreset === 'month'
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800/80 text-zinc-400 hover:text-white'
                  }`}
                >
                  Bulan Ini
                </button>
                <button
                  onClick={() => handleDatePreset('all')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                    dateRangePreset === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800/80 text-zinc-400 hover:text-white'
                  }`}
                >
                  Semua Periode
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={filterCashier}
                  onChange={(e) => setFilterCashier(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-zinc-300 text-xs focus:outline-none"
                >
                  <option value="all">Semua Kasir</option>
                  {availableCashiers.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <select
                  value={filterPayment}
                  onChange={(e) => setFilterPayment(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-zinc-300 text-xs focus:outline-none"
                >
                  <option value="all">Semua Pembayaran</option>
                  <option value="cash">Tunai (Cash Laci)</option>
                  <option value="qris">QRIS Statis/Dinamis</option>
                  <option value="bank_transfer">Transfer Bank</option>
                  <option value="card">Kartu Debit / Kredit</option>
                </select>
              </div>
            </div>
          </div>

          {/* 3A. KHUSUS TAB "LAPORAN PRODUK": TAMPILKAN TABEL SUB-LAPORAN PRODUK DI KOLOM KANAN */}
          {(activeTopTab === 'produk' ||
            selectedReport === 'produk_keseluruhan' ||
            selectedReport === 'produk_masuk' ||
            selectedReport === 'produk_keluar') ? (
            <ProductReportDetailView
              subReport={
                selectedReport === 'produk_masuk' || selectedReport === 'produk_keluar'
                  ? selectedReport
                  : ('produk_keseluruhan' as ProductReportSubType)
              }
              data={productReportData}
              periodLabel={
                dateRangePreset === 'all' ? 'Semua Periode' : `${startDate} s/d ${endDate}`
              }
            />
          ) : (
            <>
              {/* 3. REAL-TIME KPI CARDS (100% dari Firestore, Rp 0 jika kosong) */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-1">
                  <span className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider block">
                    Total Omzet Penjualan
                  </span>
                  <div className="text-lg md:text-xl font-mono font-black text-white">
                    {fmtShort(reportData.totalGrossSales)}
                  </div>
              <div className="text-[11px] text-emerald-400 flex items-center gap-1 font-bold">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Net: {fmtShort(reportData.netSales)}</span>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-1">
              <span className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider block">
                Laba Kotor (Gross Profit)
              </span>
              <div className="text-lg md:text-xl font-mono font-black text-emerald-400">
                {fmtShort(reportData.grossProfit)}
              </div>
              <div className="text-[11px] text-zinc-400">
                Margin Kotor:{' '}
                <span className="font-bold text-white">
                  {reportData.grossMarginPct.toFixed(1)}%
                </span>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-1">
              <span className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider block">
                Pendapatan Kas Tunai Laci
              </span>
              <div className="text-lg md:text-xl font-mono font-black text-amber-400">
                {fmtShort(reportData.pendapatanTunai)}
              </div>
              <div className="text-[11px] text-zinc-400">
                Selisih Laci:{' '}
                <span
                  className={`font-bold font-mono ${
                    reportData.kasSelisih < 0 ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {reportData.kasSelisih >= 0 ? '+' : ''}
                  {fmtShort(reportData.kasSelisih)}
                </span>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-1">
              <span className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider block">
                Total Transaksi &amp; Produk
              </span>
              <div className="text-lg md:text-xl font-mono font-black text-cyan-400">
                {reportData.trxCount}{' '}
                <span className="text-xs font-normal text-zinc-400">Trx</span>
              </div>
              <div className="text-[11px] text-zinc-400">
                Avg Basket:{' '}
                <span className="font-bold text-white">{fmtShort(reportData.avgBasket)}</span>
              </div>
            </div>
          </div>

          {/* 4. REAL-TIME CHART SECTION */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-xl space-y-4 print:hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-white text-sm">
                  Visualisasi Tren &amp; Analitik Penjualan POS (Real-Time Firestore)
                </h3>
              </div>

              <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs">
                <button
                  onClick={() => setChartMode('sales')}
                  className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                    chartMode === 'sales' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Tren 7 Hari
                </button>
                <button
                  onClick={() => setChartMode('hourly')}
                  className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                    chartMode === 'hourly' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Per Jam (Peak Hours)
                </button>
                <button
                  onClick={() => setChartMode('category')}
                  className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                    chartMode === 'category' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Kategori
                </button>
              </div>
            </div>

            {/* CHART VIEW 1: Tren 7 Hari */}
            {chartMode === 'sales' && (
              <div className="space-y-3">
                <div className="h-44 w-full flex items-end gap-3 pt-6 px-2">
                  {dailyTrendData.map((item, idx) => {
                    const heightPct =
                      item.revenue > 0 ? Math.max(6, Math.round((item.revenue / maxDailyRev) * 100)) : 2;
                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 group h-full justify-end">
                        <span className="text-[10px] font-mono text-zinc-300 opacity-80 group-hover:opacity-100 transition whitespace-nowrap">
                          {fmtShort(item.revenue)}
                        </span>
                        <div
                          style={{ height: `${heightPct}%` }}
                          className={`w-full rounded-t-lg transition-all duration-300 relative ${
                            item.revenue > 0
                              ? 'bg-gradient-to-t from-blue-700 to-cyan-400 group-hover:from-blue-600 group-hover:to-cyan-300'
                              : 'bg-zinc-800/60'
                          }`}
                        />
                        <span className="text-[10px] text-zinc-400 font-medium text-center truncate w-full">
                          {item.day}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-2 border-t border-zinc-800/60">
                  <span>Data penjualan 7 hari terakhir dari Cloud Firestore (`transactions` &amp; `orders`)</span>
                  <span className="text-emerald-400 font-bold">
                    {highestDayInfo.revenue > 0
                      ? `Tertinggi: ${highestDayInfo.day} (${fmtShort(highestDayInfo.revenue)} • ${highestDayInfo.trx} trx)`
                      : 'Tertinggi: Rp 0 (Belum ada transaksi pada 7 hari ini)'}
                  </span>
                </div>
              </div>
            )}

            {/* CHART VIEW 2: Per Jam */}
            {chartMode === 'hourly' && (
              <div className="space-y-3">
                <div className="h-44 w-full flex items-end gap-1.5 pt-6 px-1">
                  {hourlyData.map((item, idx) => {
                    const heightPct =
                      item.sales > 0 ? Math.max(6, Math.round((item.sales / maxHourlySales) * 100)) : 2;
                    const isPeak = item.sales > 0 && item.sales === peakHourInfo.sales;
                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center gap-1 group h-full justify-end">
                        <span className="text-[9px] font-mono text-zinc-400 opacity-0 group-hover:opacity-100 transition whitespace-nowrap">
                          {fmtShort(item.sales)} ({item.trx} trx)
                        </span>
                        <div
                          style={{ height: `${heightPct}%` }}
                          className={`w-full rounded-t-md transition-all duration-300 ${
                            item.sales === 0
                              ? 'bg-zinc-800/60'
                              : isPeak
                              ? 'bg-gradient-to-t from-rose-600 to-amber-400'
                              : 'bg-gradient-to-t from-blue-800 to-blue-500'
                          }`}
                        />
                        <span className="text-[9px] text-zinc-400 font-mono -rotate-45 origin-left mt-2">
                          {item.hour.slice(0, 2)}h
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-3 border-t border-zinc-800/60">
                  <span>Distribusi transaksi per jam sesuai filter periode aktif</span>
                  <span className="text-amber-400 font-bold">
                    {peakHourInfo.sales > 0
                      ? `Jam Tertinggi: ${peakHourInfo.hour} (${fmtShort(peakHourInfo.sales)} • ${peakHourInfo.trx} trx)`
                      : 'Jam Tertinggi: Rp 0 (0 trx)'}
                  </span>
                </div>
              </div>
            )}

            {/* CHART VIEW 3: Kategori Produk */}
            {chartMode === 'category' && (
              <div className="space-y-2.5">
                {reportData.categoryBreakdown.length === 0 ? (
                  <div className="text-center py-8 text-xs text-zinc-500">
                    Belum ada transaksi penjualan kategori pada periode ini (Rp 0).
                  </div>
                ) : (
                  reportData.categoryBreakdown.slice(0, 8).map((cat, idx) => {
                    const pct =
                      reportData.totalGrossSales > 0
                        ? Math.min(100, Math.round((cat.amount / reportData.totalGrossSales) * 100))
                        : 0;
                    return (
                      <div key={idx} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-zinc-200 font-bold flex items-center gap-2">
                            <span className={`w-2.5 h-2.5 rounded-full ${cat.color}`} />
                            {cat.name} ({cat.qty} pcs)
                          </span>
                          <div className="flex items-center gap-3">
                            <span className="text-zinc-400 font-mono">{pct}%</span>
                            <span className="font-mono font-bold text-white">{fmtShort(cat.amount)}</span>
                          </div>
                        </div>
                        <div className="w-full bg-zinc-950 rounded-full h-2 overflow-hidden border border-zinc-800">
                          <div style={{ width: `${pct}%` }} className={`h-full ${cat.color} rounded-full`} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* 5. DYNAMIC SUB-REPORT TABLE (Jika user memilih menu spesifik selain keseluruhan) */}
          {selectedReport !== 'keseluruhan' && (
            <div className="bg-zinc-900 border border-blue-500/30 rounded-2xl p-5 shadow-xl space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <h3 className="font-bold text-blue-400 text-sm">
                  Detail Laporan: {REPORT_MENU_ITEMS.find((r) => r.id === selectedReport)?.title}
                </h3>
                <span className="text-xs font-mono text-zinc-400">
                  Periode: {dateRangePreset === 'all' ? 'Semua Periode' : `${startDate} s/d ${endDate}`}
                </span>
              </div>

              {(selectedReport === 'rincian' ||
                selectedReport === 'backdate' ||
                selectedReport === 'online_order' ||
                selectedReport === 'food_delivery' ||
                selectedReport === 'marketplace' ||
                selectedReport === 'pending_pos') && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800">
                      <tr>
                        <th className="py-2.5 px-3">ID Transaksi</th>
                        <th className="py-2.5 px-3">Waktu</th>
                        <th className="py-2.5 px-3">Sumber</th>
                        <th className="py-2.5 px-3">Kasir / Pelanggan</th>
                        <th className="py-2.5 px-3">Metode Bayar</th>
                        <th className="py-2.5 px-3 text-right">Nominal (IDR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
                      {reportData.validTrx.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-zinc-500">
                            Belum ada data transaksi pada periode ini (Rp 0).
                          </td>
                        </tr>
                      ) : (
                        reportData.validTrx.slice(0, 50).map((tx) => (
                          <tr
                            key={tx.id}
                            onClick={() => openTransactionDetailModal(tx, 'SALE')}
                            className="hover:bg-zinc-800/40 cursor-pointer transition"
                          >
                            <td className="py-2 px-3 font-mono font-bold text-amber-400 hover:underline">{tx.id}</td>
                            <td className="py-2 px-3 font-mono text-zinc-400">
                              {toLocalDateKey(tx.createdAt || tx.timestamp || tx.date)}
                            </td>
                            <td className="py-2 px-3 uppercase font-semibold text-cyan-400">
                              {tx.channel || 'POS'}
                            </td>
                            <td className="py-2 px-3">
                              {tx.cashierName || tx.customerName || 'Kasir POS'}
                            </td>
                            <td className="py-2 px-3 uppercase font-mono">
                              {tx.paymentMethod || 'cash'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-emerald-400">
                              {fmt(Number(tx.totalAmount ?? tx.total ?? 0))}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedReport === 'petugas' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800">
                      <tr>
                        <th className="py-2.5 px-3">Nama Petugas / Kasir</th>
                        <th className="py-2.5 px-3 text-center">Jumlah Transaksi</th>
                        <th className="py-2.5 px-3 text-center">Total Qty Item</th>
                        <th className="py-2.5 px-3 text-right">Total Penjualan (IDR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
                      {reportData.cashierBreakdown.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-zinc-500">
                            Belum ada transaksi petugas/kasir pada periode ini (Rp 0).
                          </td>
                        </tr>
                      ) : (
                        reportData.cashierBreakdown.map((c, i) => (
                          <tr key={i} className="hover:bg-zinc-800/30">
                            <td className="py-2 px-3 font-bold text-white">{c.name}</td>
                            <td className="py-2 px-3 text-center font-mono">{c.trxCount}</td>
                            <td className="py-2 px-3 text-center font-mono">{c.qty}</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-emerald-400">
                              {fmt(c.amount)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedReport === 'pelanggan' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800">
                      <tr>
                        <th className="py-2.5 px-3">Nama Pelanggan</th>
                        <th className="py-2.5 px-3 text-center">Jumlah Pesanan</th>
                        <th className="py-2.5 px-3 text-right">Total Belanja (IDR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
                      {reportData.customerBreakdown.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="py-6 text-center text-zinc-500">
                            Belum ada transaksi pelanggan pada periode ini (Rp 0).
                          </td>
                        </tr>
                      ) : (
                        reportData.customerBreakdown.map((c, i) => (
                          <tr key={i} className="hover:bg-zinc-800/30">
                            <td className="py-2 px-3 font-bold text-white">{c.name}</td>
                            <td className="py-2 px-3 text-center font-mono">{c.trxCount}</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-emerald-400">
                              {fmt(c.amount)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedReport === 'item_brand' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800">
                      <tr>
                        <th className="py-2.5 px-3">Nama Brand</th>
                        <th className="py-2.5 px-3 text-center">Qty Terjual</th>
                        <th className="py-2.5 px-3 text-right">Total Penjualan (IDR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
                      {reportData.topBrands.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="py-6 text-center text-zinc-500">
                            Belum ada penjualan brand pada periode ini (Rp 0).
                          </td>
                        </tr>
                      ) : (
                        reportData.topBrands.map((b, i) => (
                          <tr key={i} className="hover:bg-zinc-800/30">
                            <td className="py-2 px-3 font-bold text-white">{b.name}</td>
                            <td className="py-2 px-3 text-center font-mono">{b.qty}</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-emerald-400">
                              {fmt(b.amount)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedReport === 'pengeluaran' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800">
                      <tr>
                        <th className="py-2.5 px-3">Tanggal</th>
                        <th className="py-2.5 px-3">Kategori Biaya</th>
                        <th className="py-2.5 px-3">Keterangan</th>
                        <th className="py-2.5 px-3">Petugas</th>
                        <th className="py-2.5 px-3 text-right">Nominal Kas Keluar (IDR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
                      {reportData.expenseRecords.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-zinc-500">
                            Tidak ada pengeluaran kas pada periode ini (Rp 0).
                          </td>
                        </tr>
                      ) : (
                        reportData.expenseRecords.map((ex, i) => (
                          <tr
                            key={i}
                            onClick={() =>
                              openTransactionDetailModal(
                                {
                                  ...ex,
                                  description: ex.note || ex.category,
                                  source: ex.category,
                                  cashierName: ex.pic,
                                },
                                'CASH_OUT'
                              )
                            }
                            className="hover:bg-zinc-800/40 cursor-pointer transition"
                          >
                            <td className="py-2 px-3 font-mono">{toLocalDateKey(ex.date)}</td>
                            <td className="py-2 px-3 font-bold text-amber-300 hover:underline">{ex.category}</td>
                            <td className="py-2 px-3 text-zinc-400">{ex.note}</td>
                            <td className="py-2 px-3">{ex.pic}</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-rose-400">
                              {fmt(ex.amount)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 6. SEKSI LAPORAN KESELURUHAN LENGKAP (100% REAL-TIME DARI CLOUD FIRESTORE) */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-8 print:border-none print:shadow-none print:bg-white print:text-black">
            <div className="hidden print:block border-b-2 border-black pb-3 text-center">
              <h1 className="text-xl font-black uppercase tracking-wider">RISKCART RETAIL POS - LAPORAN KESELURUHAN</h1>
              <p className="text-xs">
                Periode: {dateRangePreset === 'all' ? 'Semua Periode' : `${startDate} s/d ${endDate}`} &bull; Dicetak:{' '}
                {new Date().toLocaleString('id-ID')}
              </p>
            </div>

            {/* A. RINGKASAN DISKON */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <Percent className="w-4 h-4 text-amber-400" />
                  <span>Ringkasan Diskon</span>
                </h3>
                <span className="text-xs text-zinc-500">
                  Total Diskon: {fmt(reportData.totalDiscounts)}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800 font-medium">
                    <tr>
                      <th className="py-2.5 px-3">Sumber Penjualan</th>
                      <th className="py-2.5 px-3">Kode Diskon</th>
                      <th className="py-2.5 px-3">Nama Diskon</th>
                      <th className="py-2.5 px-3 text-right">Jumlah Diskon</th>
                      <th className="py-2.5 px-3 text-right">Qty Pesanan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
                    {reportData.discountRows.length === 0 ? (
                      <tr className="hover:bg-zinc-800/30">
                        <td className="py-2.5 px-3 font-semibold text-white">POINT OF SALE</td>
                        <td className="py-2.5 px-3 font-mono text-zinc-400">-</td>
                        <td className="py-2.5 px-3 text-zinc-400">Tidak ada diskon pada periode ini</td>
                        <td className="py-2.5 px-3 text-right font-mono text-zinc-400">{fmt(0)}</td>
                        <td className="py-2.5 px-3 text-right font-mono">0</td>
                      </tr>
                    ) : (
                      reportData.discountRows.map((d, i) => (
                        <tr key={i} className="hover:bg-zinc-800/30">
                          <td className="py-2.5 px-3 font-semibold text-white">{d.source}</td>
                          <td className="py-2.5 px-3 font-mono text-amber-400">{d.code}</td>
                          <td className="py-2.5 px-3 text-zinc-200">{d.name}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-400">
                            {fmt(d.amount)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">{d.count}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* B. RINGKASAN LOYALTY POINT */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <Tag className="w-4 h-4 text-purple-400" />
                  <span>Ringkasan Loyalty Point</span>
                </h3>
                <span className="text-xs text-zinc-500">Redeem poin &amp; reward pelanggan</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800 font-medium">
                    <tr>
                      <th className="py-2.5 px-3">Nama Loyalty Point</th>
                      <th className="py-2.5 px-3 text-right">Tebus Point</th>
                      <th className="py-2.5 px-3 text-right">Tebus Diskon</th>
                      <th className="py-2.5 px-3 text-right">Tebus Item Gratis</th>
                      <th className="py-2.5 px-3 text-right">Qty Item Gratis</th>
                      <th className="py-2.5 px-3 text-right">Total Redeem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
                    <tr className="hover:bg-zinc-800/30">
                      <td className="py-2.5 px-3 font-semibold text-white">Program Poin Member</td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {reportData.totalLoyaltyPointsRedeemed}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {fmt(reportData.totalLoyaltyDiscountAmount)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">0</td>
                      <td className="py-2.5 px-3 text-right font-mono">0</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                        {reportData.totalLoyaltyPointsRedeemed}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* C. PESANAN DIBATALKAN & SUMBER PENJUALAN */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Pesanan Dibatalkan */}
              <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-4 space-y-3">
                <h4 className="font-bold text-white text-xs uppercase tracking-wider flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                  <span>Pesanan Dibatalkan (Void)</span>
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between text-zinc-400">
                    <span>Qty Pesanan Dibatalkan:</span>
                    <span className="font-mono font-bold text-white">
                      {reportData.voidTrx.length} Pesanan
                    </span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Jumlah Diskon Void (IDR):</span>
                    <span className="font-mono text-zinc-400">
                      {fmt(reportData.totalVoidDiscount)}
                    </span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Total Nominal Void:</span>
                    <span className="font-mono font-bold text-rose-400">
                      {fmt(reportData.totalVoidAmount)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sumber Penjualan */}
              <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-4 space-y-3">
                <h4 className="font-bold text-white text-xs uppercase tracking-wider flex items-center gap-2">
                  <Store className="w-4 h-4 text-blue-400" />
                  <span>Sumber Penjualan</span>
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center py-1 border-b border-zinc-800/50">
                    <span className="font-bold text-white">POINT OF SALE (Kasir Toko)</span>
                    <span className="font-mono font-black text-emerald-400">
                      {fmt(reportData.posSalesAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Qty Pesanan Kasir POS:</span>
                    <span className="font-mono font-bold text-white">
                      {reportData.posSalesCount} Trx
                    </span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Online Order (Client PWA):</span>
                    <span className="font-mono text-zinc-300">
                      {fmt(reportData.onlineSalesAmount)} ({reportData.onlineSalesCount} Trx)
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* D. TOP GRUP PRODUK & TOP PRODUK */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Top Grup Produk */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <h4 className="font-bold text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-cyan-400" />
                    <span>Top Grup Produk</span>
                  </h4>
                  <span className="text-[11px] text-zinc-500">Kategori Teratas</span>
                </div>
                <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800">
                      <tr>
                        <th className="py-2 px-3">Nama Kategori</th>
                        <th className="py-2 px-3 text-center">Qty</th>
                        <th className="py-2 px-3 text-right">Jumlah</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
                      {reportData.topGrupProduk.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="py-4 px-3 text-center text-zinc-500">
                            Belum ada penjualan grup produk pada periode ini (Rp 0)
                          </td>
                        </tr>
                      ) : (
                        reportData.topGrupProduk.map((grp, idx) => (
                          <tr key={idx} className="hover:bg-zinc-800/30">
                            <td className="py-2 px-3 font-semibold text-white">{grp.name}</td>
                            <td className="py-2 px-3 text-center font-mono">{grp.qty}</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-zinc-200">
                              {fmt(grp.amount)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Top Produk Terlaris */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <h4 className="font-bold text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
                    <ShoppingCart className="w-4 h-4 text-emerald-400" />
                    <span>Top Produk</span>
                  </h4>
                  <span className="text-[11px] text-zinc-500">Produk Terlaris</span>
                </div>
                <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800">
                      <tr>
                        <th className="py-2 px-3">Nama Produk</th>
                        <th className="py-2 px-3 text-center">Qty</th>
                        <th className="py-2 px-3 text-right">Jumlah</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
                      {reportData.topProducts.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="py-4 px-3 text-center text-zinc-500">
                            Belum ada produk terjual pada periode ini (Rp 0)
                          </td>
                        </tr>
                      ) : (
                        reportData.topProducts.slice(0, 5).map((prod, idx) => (
                          <tr key={idx} className="hover:bg-zinc-800/30">
                            <td className="py-2.5 px-3 font-semibold text-white">{prod.name}</td>
                            <td className="py-2.5 px-3 text-center font-mono">{prod.qty}</td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                              {fmt(prod.amount)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* E, F, G, H: REKAPITULASI KEUANGAN, STOK, LABA BERSIH, KOMISI */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-2xl bg-zinc-950/70 border border-zinc-800">
              {/* E. Stok */}
              <div className="space-y-1.5 border-r border-zinc-800/60 pr-2">
                <span className="text-xs font-black text-white uppercase block tracking-wider">E. Stok</span>
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Stok Keluar:</span>
                  <span className="font-mono text-zinc-300">{fmtShort(reportData.stokKeluarValue)}</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Opname Stok:</span>
                  <span className="font-mono text-zinc-300">{fmtShort(reportData.opnameStokValue)}</span>
                </div>
              </div>

              {/* F. Pembelian */}
              <div className="space-y-1.5 border-r border-zinc-800/60 pr-2">
                <span className="text-xs font-black text-white uppercase block tracking-wider">F. Pembelian</span>
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Diskon PO:</span>
                  <span className="font-mono text-zinc-300">{fmt(reportData.poDiscount)}</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Pengiriman:</span>
                  <span className="font-mono text-zinc-300">{fmt(reportData.poShipping)}</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Pajak:</span>
                  <span className="font-mono text-zinc-300">{fmt(reportData.poTax)}</span>
                </div>
              </div>

              {/* G. Laba Bersih */}
              <div className="space-y-1.5 border-r border-zinc-800/60 pr-2">
                <span className="text-xs font-black text-white uppercase block tracking-wider">G. Laba Bersih</span>
                <div className="text-base font-mono font-black text-emerald-400 pt-1">
                  {fmt(reportData.netProfit)}
                </div>
                <span className="text-[10px] text-zinc-500 block">
                  Laba Kotor ({fmtShort(reportData.grossProfit)}) - Kas Keluar ({fmtShort(reportData.totalKasKeluar)})
                </span>
              </div>

              {/* H. Komisi Pelanggan */}
              <div className="space-y-1.5">
                <span className="text-xs font-black text-white uppercase block tracking-wider">H. Komisi Pelanggan</span>
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Total Komisi Dicairkan:</span>
                  <span className="font-mono text-zinc-300">IDR 0,00</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Komisi Tersedia:</span>
                  <span className="font-mono text-zinc-300">IDR 0,00</span>
                </div>
              </div>
            </div>

            {/* I. PENJUALAN BERDASARKAN KATEGORI */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-400" />
                  <span>Penjualan berdasarkan Kategori</span>
                </h3>
                <span className="text-xs text-zinc-500">
                  {reportData.categoryBreakdown.length} Kategori Terjual pada Periode Ini
                </span>
              </div>

              <div className="bg-zinc-950/70 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800 font-semibold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Nama Kategori</th>
                      <th className="py-3 px-4 text-center">Qty</th>
                      <th className="py-3 px-4 text-right">Jumlah Total (IDR)</th>
                      <th className="py-3 px-4 text-center">Kontribusi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                    {reportData.categoryBreakdown.length === 0 ? (
                      ctxCategories.length > 0 ? (
                        ctxCategories.map((catName, idx) => (
                          <tr key={idx} className="hover:bg-zinc-850/50 transition">
                            <td className="py-2.5 px-4 font-semibold text-zinc-400 flex items-center gap-2.5">
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  CATEGORY_COLORS[idx % CATEGORY_COLORS.length]
                                }`}
                              />
                              <span>{catName}</span>
                            </td>
                            <td className="py-2.5 px-4 text-center font-mono text-zinc-500">0</td>
                            <td className="py-2.5 px-4 text-right font-mono text-zinc-500">
                              {fmt(0)}
                            </td>
                            <td className="py-2.5 px-4 text-center font-mono text-zinc-500">
                              0.0%
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-zinc-500">
                            Belum ada transaksi penjualan kategori pada periode ini (Rp 0).
                          </td>
                        </tr>
                      )
                    ) : (
                      reportData.categoryBreakdown.map((row, idx) => {
                        const totalCatSales = reportData.categoryBreakdown.reduce(
                          (s, r) => s + r.amount,
                          0
                        );
                        const share =
                          totalCatSales > 0 ? ((row.amount / totalCatSales) * 100).toFixed(1) : '0.0';
                        return (
                          <tr key={idx} className="hover:bg-zinc-850/50 transition">
                            <td className="py-3 px-4 font-bold text-white flex items-center gap-2.5">
                              <span className={`w-2.5 h-2.5 rounded-full ${row.color}`} />
                              <span>{row.name}</span>
                            </td>
                            <td className="py-3 px-4 text-center font-mono font-semibold text-zinc-200">
                              {row.qty}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-white">
                              {fmt(row.amount)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span className="font-mono text-[11px] bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded-full text-zinc-300 font-medium">
                                {share}%
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  <tfoot className="bg-zinc-950 font-bold border-t-2 border-zinc-700 text-white">
                    <tr>
                      <td className="py-3 px-4 uppercase tracking-wider text-[11px]">TOTAL KATEGORI</td>
                      <td className="py-3 px-4 text-center font-mono text-cyan-400">
                        {reportData.categoryBreakdown.reduce((a, b) => a + b.qty, 0)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-emerald-400 text-sm">
                        {fmt(reportData.categoryBreakdown.reduce((a, b) => a + b.amount, 0))}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-zinc-400">
                        {reportData.categoryBreakdown.length > 0 ? '100%' : '0%'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* J. RINGKASAN METODE PEMBAYARAN & REKONSILIASI KAS */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-emerald-400" />
                  <span>Ringkasan Metode Pembayaran</span>
                </h3>
                <span className="text-xs text-zinc-500">
                  Kas Masuk: {fmtShort(reportData.totalKasMasuk)} &bull; Kas Keluar: {fmtShort(reportData.totalKasKeluar)}
                </span>
              </div>

              {/* Transaksi Tunai Card */}
              <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <Wallet className="w-4 h-4" />
                    <span>Transaksi Tunai (Cash Drawer)</span>
                  </span>
                  <span className="text-[11px] text-zinc-500 font-mono">Rekonsiliasi Laci Toko</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                  <div className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Void Tunai</span>
                    <span className="text-xs font-mono font-bold text-zinc-300">
                      {fmt(reportData.voidCashAmount)}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Kas Selisih</span>
                    <span
                      className={`text-xs font-mono font-bold ${
                        reportData.kasSelisih < 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {fmt(reportData.kasSelisih)}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Pengembalian Tunai</span>
                    <span className="text-xs font-mono font-bold text-zinc-300">
                      {fmt(reportData.refundCashAmount)}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Pendapatan Tunai</span>
                    <span className="text-sm font-mono font-black text-emerald-400">
                      {fmt(reportData.pendapatanTunai)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Transaksi Non-Tunai Digital */}
              <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4" />
                    <span>Transaksi Non-Tunai / Digital</span>
                  </span>
                  <span className="text-[11px] text-zinc-500 font-mono">QRIS, EDC, Transfer Bank</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 text-xs">
                  <div className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">QRIS Statis &amp; Dinamis</span>
                    <span className="font-mono font-bold text-cyan-400">
                      {fmt(reportData.qrisSalesAmount)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Transfer Bank</span>
                    <span className="font-mono font-bold text-blue-400">
                      {fmt(reportData.transferSalesAmount)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Kartu Debit / EDC</span>
                    <span className="font-mono font-bold text-purple-400">
                      {fmt(reportData.cardSalesAmount)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Total Pendapatan Digital</span>
                    <span className="text-sm font-mono font-black text-blue-400">
                      {fmt(reportData.totalDigitalSales)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
