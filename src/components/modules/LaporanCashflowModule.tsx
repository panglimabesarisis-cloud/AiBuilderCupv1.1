import React, { useState, useMemo } from 'react';
import {
  Search,
  Calendar,
  Download,
  Printer,
  RefreshCw,
  ArrowLeft,
  FileText,
  TrendingUp,
  Layers,
  Users,
  Monitor,
  Truck,
} from 'lucide-react';
import { useFirestoreList } from '../../hooks/useFirestoreList';
import { useAppData } from '../../context/AppDataContext';
import { Product } from '../../types';
import { openTransactionDetailModal } from '../common/GlobalModals';
import { useAppNavigation } from '../../router';

export interface LaporanCashflowModuleProps {
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string, sub?: string) => void;
}

type ExecutiveReportMode =
  | 'pnl'
  | 'daily'
  | 'customer'
  | 'category_product'
  | 'channel'
  | 'shipper_payment';

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

export const LaporanCashflowModule: React.FC<LaporanCashflowModuleProps> = ({
  onNavigateTab,
}) => {
  const { navigateToPath } = useAppNavigation();

  const now = new Date();
  const todayStr = toLocalDateKey(now);
  const firstOfMonthStr = toLocalDateKey(new Date(now.getFullYear(), now.getMonth(), 1));

  const [dateRangePreset, setDateRangePreset] = useState<
    'today' | 'yesterday' | '7days' | 'month' | 'year' | 'all' | 'custom'
  >('month');
  const [startDate, setStartDate] = useState<string>(firstOfMonthStr);
  const [endDate, setEndDate] = useState<string>(todayStr);

  const [execMode, setExecMode] = useState<ExecutiveReportMode>('pnl');
  const [sheetTheme, setSheetTheme] = useState<'white' | 'dark'>('white');
  const [execSearch, setExecSearch] = useState<string>('');
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Record<string, boolean>>({});
  const [showAllNotesDetail, setShowAllNotesDetail] = useState<boolean>(false);

  const toggleExpandGroup = (key: string) => {
    setExpandedGroupKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // 100% Real-Time Data from AppDataContext & Cloud Firestore
  const {
    transactions: ctxTransactions,
    products: ctxProducts,
    orders: ctxOrders,
    customers: ctxCustomers,
    procurements: ctxProcurements,
    brangkas_toko_logs: ctxBrangkasLogs,
    cashLogs: ctxCashLogs,
    shifts: ctxShifts,
    currencyMode: activeCurrencyMode,
    refreshFirestore,
    formatMoney,
  } = useAppData();

  const { data: storeTransactions } = useFirestoreList<any>('stores/store_001/transactions', []);
  const { data: rawCashFlows } = useFirestoreList<any>('cash_flows', []);
  const { data: rawKasMasuk } = useFirestoreList<any>('shift_kas_masuk', []);
  const { data: rawKasKeluar } = useFirestoreList<any>('shift_kas_keluar', []);
  const { data: rawPurchaseOrders } = useFirestoreList<any>('purchase_orders', []);
  const { data: rawShifts } = useFirestoreList<any>('shifts', []);

  const fmt = (num: number) => {
    const val = Number.isFinite(num) ? num : 0;
    return formatMoney(val);
  };

  // Product lookup by id, sku, and name for accurate HPP (costPrice) & category
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

  // Unified and deduplicated transactions + orders
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

  // Real-time Executive Statement Calculations
  const executiveStatementData = useMemo(() => {
    const voidStatuses = new Set(['void', 'cancelled', 'canceled', 'rejected', 'refunded', 'batal']);

    let priorStartKey = '';
    let priorEndKey = '';
    if (dateRangePreset !== 'all' && startDate && endDate) {
      const sDate = new Date(`${startDate}T00:00:00`);
      const eDate = new Date(`${endDate}T00:00:00`);
      if (!isNaN(sDate.getTime()) && !isNaN(eDate.getTime())) {
        const spanDays = Math.max(1, Math.round((eDate.getTime() - sDate.getTime()) / 86400000) + 1);
        const pEnd = new Date(sDate.getTime() - 86400000);
        const pStart = new Date(pEnd.getTime() - (spanDays - 1) * 86400000);
        priorStartKey = toLocalDateKey(pStart);
        priorEndKey = toLocalDateKey(pEnd);
      }
    }

    const inWindow = (rawDate: any, sKey: string, eKey: string, isAll: boolean): boolean => {
      if (isAll) return true;
      const k = toLocalDateKey(rawDate);
      if (!k) return false;
      if (sKey && k < sKey) return false;
      if (eKey && k > eKey) return false;
      return true;
    };

    const resolveTxMetrics = (t: any) => {
      const netAmt = Number(t.totalAmount ?? t.total ?? t.grandTotal ?? 0);
      const discAmt = Number(t.discount ?? t.discountAmount ?? t.voucherDiscount ?? 0);
      const grossAmt = Number(t.subtotal ?? t.grossAmount ?? netAmt + discAmt);
      const ch = String(t.channel || t.source || 'pos').toLowerCase();
      const isPwa = ch.includes('pwa') || ch.includes('online');
      const pm = String(t.paymentMethod || 'cash').toLowerCase();
      const isCreditOrCod = pm === 'debt' || pm === 'hutang' || pm === 'cod' || pm === 'piutang';
      const pStatus = String(
        t.paymentStatus || (isCreditOrCod ? 'unpaid' : 'paid')
      ).toLowerCase();

      const items = Array.isArray(t.items) ? t.items : [];
      let calcCogs = 0;
      let totalQty = 0;
      items.forEach((item: any) => {
        const pid = String(item.productId || item.product?.id || item.id || '');
        const pName = String(item.productName || item.name || item.product?.name || 'Produk').trim();
        const matchedProd =
          productLookup.byId.get(pid) || productLookup.byName.get(pName.toLowerCase());
        const qty = Number(item.quantityOrdered ?? item.quantity ?? item.qty ?? 1);
        const unitCost = Number(
          item.costPerUnit ??
            item.costPrice ??
            item.product?.costPerUnit ??
            matchedProd?.costPerUnit ??
            0
        );
        calcCogs += qty * unitCost;
        totalQty += qty;
      });
      const storedCogs = Number(t.totalCost ?? t.cogs ?? 0);
      const cogs = storedCogs > 0 ? storedCogs : calcCogs;
      if (totalQty === 0 && netAmt > 0) totalQty = 1;

      const shipper = String(
        t.shipperName ||
          t.courierName ||
          t.driverName ||
          t.deliveryStaff ||
          t.pengirim ||
          (isPwa ? 'Kurir Toko (PWA)' : 'Ambil Sendiri')
      ).trim();

      return {
        netAmt,
        discAmt,
        grossAmt: grossAmt > 0 ? grossAmt : netAmt + discAmt,
        cogs,
        qty: totalQty,
        isPwa,
        pm,
        isCreditOrCod,
        pStatus,
        shipper,
        dateKey: toLocalDateKey(t.createdAt || t.timestamp || t.date || t.updatedAt) || todayStr,
        receiptNo: String(t.receiptNo || t.orderNumber || t.transactionId || t.id || '-'),
        customerName: String(t.customerName || t.customer?.name || 'Pelanggan Umum').trim(),
        cashierName: String(t.cashierName || t.cashierId || t.createdBy || 'Kasir POS').trim(),
      };
    };

    const allVaultAndCashLogs = [
      ...(Array.isArray(ctxBrangkasLogs) ? ctxBrangkasLogs : []),
      ...(Array.isArray(ctxCashLogs) ? ctxCashLogs : []),
      ...(Array.isArray(rawCashFlows) ? rawCashFlows : []),
      ...(Array.isArray(rawKasMasuk) ? rawKasMasuk.map((x) => ({ ...x, type: 'in' })) : []),
      ...(Array.isArray(rawKasKeluar) ? rawKasKeluar.map((x) => ({ ...x, type: 'out' })) : []),
    ];

    const allProcurementsMap = new Map<string, any>();
    [
      ...(Array.isArray(ctxProcurements) ? ctxProcurements : []),
      ...(Array.isArray(rawPurchaseOrders) ? rawPurchaseOrders : []),
    ].forEach((po, idx) => {
      if (!po) return;
      const id = String(po.id || po.poNumber || `po_${idx}`);
      if (!allProcurementsMap.has(id)) allProcurementsMap.set(id, po);
    });
    const allProcurements = Array.from(allProcurementsMap.values());

    const computePnLForWindow = (sKey: string, eKey: string, isAll: boolean) => {
      let posCashQrisRev = 0;
      let posCreditCodRev = 0;
      let pwaOnlineRev = 0;
      let otherCashInRev = 0;

      let posCogs = 0;
      let pwaCogs = 0;
      let promoDiscounts = 0;

      let operationalExpenses = 0;
      let procurementExpenses = 0;
      let courierCommissionExpenses = 0;

      const windowValidTrx: Array<{ raw: any; m: ReturnType<typeof resolveTxMetrics> }> = [];

      allUnifiedTransactions.forEach((t) => {
        const rawTime = t.createdAt || t.timestamp || t.date || t.updatedAt;
        if (!inWindow(rawTime, sKey, eKey, isAll)) return;
        if (voidStatuses.has(String(t.status || t.fulfillmentStatus || '').toLowerCase())) return;
        if (execSearch.trim()) {
          const kw = execSearch.toLowerCase();
          const matchText = `${t.id || ''} ${t.receiptNo || ''} ${t.customerName || ''} ${t.cashierName || ''} ${t.paymentMethod || ''} ${t.shipperName || ''}`.toLowerCase();
          if (!matchText.includes(kw)) return;
        }

        const m = resolveTxMetrics(t);
        windowValidTrx.push({ raw: t, m });

        if (m.isPwa) {
          pwaOnlineRev += m.grossAmt;
          pwaCogs += m.cogs;
        } else if (m.isCreditOrCod) {
          posCreditCodRev += m.grossAmt;
          posCogs += m.cogs;
        } else {
          posCashQrisRev += m.grossAmt;
          posCogs += m.cogs;
        }
        promoDiscounts += m.discAmt;

        const shipFee = Number(t.shippingCost ?? t.deliveryFee ?? t.ongkir ?? t.courierFee ?? 0);
        if (shipFee > 0) {
          courierCommissionExpenses += shipFee;
        }
      });

      const seenLogIds = new Set<string>();
      allVaultAndCashLogs.forEach((log, i) => {
        if (!log) return;
        const logId = String(
          log.id || `${log.createdAt || log.date || i}_${log.amount || log.nominal || 0}`
        );
        if (seenLogIds.has(logId)) return;
        seenLogIds.add(logId);

        const rawTime = log.createdAt || log.timestamp || log.date;
        if (!inWindow(rawTime, sKey, eKey, isAll)) return;

        const amt = Math.abs(Number(log.amount ?? log.nominal ?? 0));
        if (!amt) return;
        const dir = String(log.type || log.direction || log.action || '').toLowerCase();
        const cat = String(log.category || log.description || log.note || '').toLowerCase();

        // Avoid double-counting automatic sales entries
        if (
          cat.includes('penjualan pos') ||
          cat.includes('auto pos') ||
          cat.includes('transaksi pos') ||
          cat.includes('transaksi penjualan')
        ) {
          return;
        }

        if (dir === 'in' || dir === 'masuk' || dir === 'deposit' || dir === 'tambah') {
          otherCashInRev += amt;
        } else if (dir === 'out' || dir === 'keluar' || dir === 'expense' || dir === 'tarik') {
          if (
            cat.includes('kurir') ||
            cat.includes('komisi') ||
            cat.includes('ongkir') ||
            cat.includes('pengiriman')
          ) {
            courierCommissionExpenses += amt;
          } else {
            operationalExpenses += amt;
          }
        }
      });

      allProcurements.forEach((po) => {
        const rawTime = po.createdAt || po.orderDate || po.date || po.updatedAt;
        if (!inWindow(rawTime, sKey, eKey, isAll)) return;
        const st = String(po.status || '').toLowerCase();
        if (st === 'cancelled' || st === 'void' || st === 'batal') return;
        const amt = Number(po.totalAmount ?? po.total ?? po.grandTotal ?? po.subtotal ?? 0);
        const ship = Number(po.shippingCost ?? po.ongkir ?? 0);
        procurementExpenses += amt;
        if (ship > 0) courierCommissionExpenses += ship;
      });

      const totalRevenue = posCashQrisRev + posCreditCodRev + pwaOnlineRev + otherCashInRev;
      const totalCogsAndDisc = posCogs + pwaCogs + promoDiscounts;
      const grossProfit = totalRevenue - totalCogsAndDisc;
      const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
      const totalExpenses =
        operationalExpenses + procurementExpenses + courierCommissionExpenses;
      const netProfit = grossProfit - totalExpenses;
      const netMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

      return {
        posCashQrisRev,
        posCreditCodRev,
        pwaOnlineRev,
        otherCashInRev,
        totalRevenue,
        posCogs,
        pwaCogs,
        promoDiscounts,
        totalCogsAndDisc,
        grossProfit,
        grossMarginPct,
        operationalExpenses,
        procurementExpenses,
        courierCommissionExpenses,
        totalExpenses,
        netProfit,
        netMarginPct,
        windowValidTrx,
      };
    };

    const currentPnL = computePnLForWindow(startDate, endDate, dateRangePreset === 'all');
    const priorPnL =
      priorStartKey && priorEndKey
        ? computePnLForWindow(priorStartKey, priorEndKey, false)
        : computePnLForWindow('1970-01-01', '1970-01-01', false);

    // Mode 2: Daily Sales
    const dailyMap = new Map<
      string,
      {
        dateKey: string;
        posCount: number;
        pwaCount: number;
        qty: number;
        grossSales: number;
        cogs: number;
        discount: number;
        netSales: number;
        netProfit: number;
        transactions: any[];
      }
    >();

    // Mode 3: Customer Breakdown
    const customerTypeLookup = new Map<string, string>();
    (Array.isArray(ctxCustomers) ? ctxCustomers : []).forEach((c: any) => {
      if (c?.name) {
        customerTypeLookup.set(
          String(c.name).trim().toLowerCase(),
          String(c.type || c.level || c.tier || c.category || 'Member Reguler')
        );
      }
    });

    const custExecMap = new Map<
      string,
      {
        name: string;
        level: string;
        trxCount: number;
        qty: number;
        cashPaid: number;
        debtUnpaid: number;
        totalSpent: number;
        cogs: number;
        profitContribution: number;
        transactions: any[];
      }
    >();

    // Mode 4: Category & Product Breakdown
    const catProdExecMap = new Map<
      string,
      {
        category: string;
        qty: number;
        cogs: number;
        revenue: number;
        profit: number;
        products: Map<
          string,
          {
            id: string;
            name: string;
            qty: number;
            unitCost: number;
            cogs: number;
            revenue: number;
            profit: number;
          }
        >;
        transactions: any[];
      }
    >();

    // Mode 5: Channel Breakdown (POS vs Client PWA)
    const channelExecMap = new Map<
      string,
      {
        channelKey: string;
        channelLabel: string;
        paymentLabel: string;
        trxCount: number;
        qty: number;
        grossSales: number;
        discount: number;
        netSales: number;
        cogs: number;
        profit: number;
        transactions: any[];
      }
    >();

    // Mode 6: Shipper / Courier & Payment Breakdown
    const shipperExecMap = new Map<
      string,
      {
        shipperName: string;
        paymentMethod: string;
        paidCount: number;
        unpaidCount: number;
        trxCount: number;
        qty: number;
        paidAmount: number;
        unpaidAmount: number;
        totalAmount: number;
        profit: number;
        transactions: any[];
      }
    >();

    currentPnL.windowValidTrx.forEach(({ raw: t, m }) => {
      const txProfit = m.netAmt - m.cogs;

      // Daily
      const dRow = dailyMap.get(m.dateKey) || {
        dateKey: m.dateKey,
        posCount: 0,
        pwaCount: 0,
        qty: 0,
        grossSales: 0,
        cogs: 0,
        discount: 0,
        netSales: 0,
        netProfit: 0,
        transactions: [],
      };
      if (m.isPwa) dRow.pwaCount += 1;
      else dRow.posCount += 1;
      dRow.qty += m.qty;
      dRow.grossSales += m.grossAmt;
      dRow.cogs += m.cogs;
      dRow.discount += m.discAmt;
      dRow.netSales += m.netAmt;
      dRow.netProfit += txProfit;
      dRow.transactions.push(t);
      dailyMap.set(m.dateKey, dRow);

      // Customer
      const cLevel =
        customerTypeLookup.get(m.customerName.toLowerCase()) ||
        String(
          t.customerType ||
            t.customerLevel ||
            (m.customerName === 'Pelanggan Umum' ? 'Walk-In / Umum' : 'Pelanggan Terdaftar')
        );
      const cRow = custExecMap.get(m.customerName) || {
        name: m.customerName,
        level: cLevel,
        trxCount: 0,
        qty: 0,
        cashPaid: 0,
        debtUnpaid: 0,
        totalSpent: 0,
        cogs: 0,
        profitContribution: 0,
        transactions: [],
      };
      cRow.trxCount += 1;
      cRow.qty += m.qty;
      const isUnpaidDebt =
        (m.pm === 'debt' || m.pm === 'hutang' || m.pm === 'cod' || m.pm === 'piutang') &&
        m.pStatus !== 'paid' &&
        m.pStatus !== 'lunas';
      const paidPortion = isUnpaidDebt ? Math.min(m.netAmt, Number(t.paidAmount || 0)) : m.netAmt;
      const unpaidPortion = isUnpaidDebt ? Math.max(0, m.netAmt - paidPortion) : 0;
      cRow.cashPaid += paidPortion;
      cRow.debtUnpaid += unpaidPortion;
      cRow.totalSpent += m.netAmt;
      cRow.cogs += m.cogs;
      cRow.profitContribution += txProfit;
      cRow.transactions.push(t);
      custExecMap.set(m.customerName, cRow);

      // Category & Product
      const items = Array.isArray(t.items) ? t.items : [];
      if (items.length > 0) {
        items.forEach((item: any) => {
          const pid = String(item.productId || item.product?.id || item.id || item.name || 'item');
          const pName = String(
            item.productName || item.name || item.product?.name || 'Produk'
          ).trim();
          const matchedProd =
            productLookup.byId.get(pid) || productLookup.byName.get(pName.toLowerCase());
          const catName = String(
            item.category || item.product?.category || matchedProd?.category || 'Tanpa Kategori'
          ).trim();
          const qty = Number(item.quantityOrdered ?? item.quantity ?? item.qty ?? 1);
          const unitPrice = Number(
            item.unitPrice ?? item.price ?? item.pricePerUnit ?? matchedProd?.pricePerUnit ?? 0
          );
          const lineRev = Number(item.subtotal ?? item.total ?? qty * unitPrice);
          const unitCost = Number(
            item.costPerUnit ??
              item.costPrice ??
              item.product?.costPerUnit ??
              matchedProd?.costPerUnit ??
              0
          );
          const lineCogs = qty * unitCost;
          const lineProfit = lineRev - lineCogs;

          const catGroup = catProdExecMap.get(catName) || {
            category: catName,
            qty: 0,
            cogs: 0,
            revenue: 0,
            profit: 0,
            products: new Map(),
            transactions: [] as any[],
          };
          catGroup.qty += qty;
          catGroup.cogs += lineCogs;
          catGroup.revenue += lineRev;
          catGroup.profit += lineProfit;
          if (!catGroup.transactions.includes(t)) catGroup.transactions.push(t);

          const pKey = `${pid}_${pName}`;
          const prodEntry = catGroup.products.get(pKey) || {
            id: pid,
            name: pName,
            qty: 0,
            unitCost,
            cogs: 0,
            revenue: 0,
            profit: 0,
          };
          prodEntry.qty += qty;
          prodEntry.cogs += lineCogs;
          prodEntry.revenue += lineRev;
          prodEntry.profit += lineProfit;
          catGroup.products.set(pKey, prodEntry);
          catProdExecMap.set(catName, catGroup);
        });
      } else {
        const fallbackCat = String((t as any).category || 'Penjualan Umum');
        const catGroup = catProdExecMap.get(fallbackCat) || {
          category: fallbackCat,
          qty: 0,
          cogs: 0,
          revenue: 0,
          profit: 0,
          products: new Map(),
          transactions: [] as any[],
        };
        catGroup.qty += m.qty;
        catGroup.cogs += m.cogs;
        catGroup.revenue += m.netAmt;
        catGroup.profit += txProfit;
        catGroup.transactions.push(t);
        catProdExecMap.set(fallbackCat, catGroup);
      }

      // Channel
      const pmUpper =
        m.pm === 'cash' || m.pm === 'tunai'
          ? 'Tunai (Cash)'
          : m.pm === 'debt' || m.pm === 'hutang'
          ? 'Piutang / Hutang'
          : m.pm === 'cod'
          ? 'COD (Bayar di Tempat)'
          : m.pm.includes('qris')
          ? 'QRIS Digital'
          : m.pm.toUpperCase();
      const chGroupLabel = m.isPwa ? 'CLIENT PWA (PESANAN ONLINE)' : 'KASIR POS (TOKO FISIK)';
      const chKey = `${chGroupLabel}__${pmUpper}`;
      const chRow = channelExecMap.get(chKey) || {
        channelKey: chKey,
        channelLabel: chGroupLabel,
        paymentLabel: pmUpper,
        trxCount: 0,
        qty: 0,
        grossSales: 0,
        discount: 0,
        netSales: 0,
        cogs: 0,
        profit: 0,
        transactions: [],
      };
      chRow.trxCount += 1;
      chRow.qty += m.qty;
      chRow.grossSales += m.grossAmt;
      chRow.discount += m.discAmt;
      chRow.netSales += m.netAmt;
      chRow.cogs += m.cogs;
      chRow.profit += txProfit;
      chRow.transactions.push(t);
      channelExecMap.set(chKey, chRow);

      // Shipper & Payment
      const shipKey = `${m.shipper}__${pmUpper}`;
      const shRow = shipperExecMap.get(shipKey) || {
        shipperName: m.shipper,
        paymentMethod: pmUpper,
        paidCount: 0,
        unpaidCount: 0,
        trxCount: 0,
        qty: 0,
        paidAmount: 0,
        unpaidAmount: 0,
        totalAmount: 0,
        profit: 0,
        transactions: [],
      };
      shRow.trxCount += 1;
      shRow.qty += m.qty;
      if (isUnpaidDebt) {
        shRow.unpaidCount += 1;
        shRow.paidAmount += paidPortion;
        shRow.unpaidAmount += unpaidPortion;
      } else {
        shRow.paidCount += 1;
        shRow.paidAmount += m.netAmt;
      }
      shRow.totalAmount += m.netAmt;
      shRow.profit += txProfit;
      shRow.transactions.push(t);
      shipperExecMap.set(shipKey, shRow);
    });

    return {
      currentPnL,
      priorPnL,
      priorStartKey,
      priorEndKey,
      dailyRows: Array.from(dailyMap.values()).sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
      customerRows: Array.from(custExecMap.values()).sort((a, b) => b.totalSpent - a.totalSpent),
      categoryProductRows: Array.from(catProdExecMap.values())
        .sort((a, b) => b.revenue - a.revenue)
        .map((c) => ({
          ...c,
          productList: Array.from(c.products.values()).sort((a, b) => b.revenue - a.revenue),
        })),
      channelRows: Array.from(channelExecMap.values()).sort((a, b) => b.netSales - a.netSales),
      shipperRows: Array.from(shipperExecMap.values()).sort(
        (a, b) => b.totalAmount - a.totalAmount
      ),
      activeShiftsCount: (Array.isArray(ctxShifts) ? ctxShifts.length : 0) + rawShifts.length,
    };
  }, [
    allUnifiedTransactions,
    ctxCustomers,
    ctxProcurements,
    ctxBrangkasLogs,
    ctxCashLogs,
    ctxShifts,
    rawCashFlows,
    rawKasMasuk,
    rawKasKeluar,
    rawPurchaseOrders,
    rawShifts,
    productLookup,
    dateRangePreset,
    startDate,
    endDate,
    execSearch,
    todayStr,
  ]);

  const handleDatePreset = (
    preset: 'today' | 'yesterday' | '7days' | 'month' | 'year' | 'all' | 'custom'
  ) => {
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

  const handleExportCSV = () => {
    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'RISKCART STORE - LAPORAN EKSEKUTIF CASHFLOW & LABA RUGI\n';
    csvContent += `Mode Laporan: ${execMode.toUpperCase()}\n`;
    csvContent += `Periode: ${dateRangePreset === 'all' ? 'Semua Periode' : `${startDate} s/d ${endDate}`}\n`;
    csvContent += `Mata Uang: ${activeCurrencyMode || 'IDR'}\n`;
    csvContent += `Tanggal Cetak: ${new Date().toLocaleString('id-ID')}\n\n`;

    const c = executiveStatementData.currentPnL;
    const p = executiveStatementData.priorPnL;
    csvContent +=
      'PROFIT & LOSS STATEMENT (RINGKASAN LABA RUGI),PERIODE INI (CURRENT),PERIODE SEBELUMNYA (PRIOR)\n';
    csvContent += `"Penjualan Kasir POS (Tunai / QRIS)",${c.posCashQrisRev},${p.posCashQrisRev}\n`;
    csvContent += `"Penjualan Kasir POS (Piutang / COD)",${c.posCreditCodRev},${p.posCreditCodRev}\n`;
    csvContent += `"Penjualan Online Client PWA",${c.pwaOnlineRev},${p.pwaOnlineRev}\n`;
    csvContent += `"Pendapatan Lainnya / Kas Masuk Brangkas Toko",${c.otherCashInRev},${p.otherCashInRev}\n`;
    csvContent += `"Total Revenue & Gains",${c.totalRevenue},${p.totalRevenue}\n`;
    csvContent += `"HPP Produk Terjual POS",${c.posCogs},${p.posCogs}\n`;
    csvContent += `"HPP Produk Terjual Client PWA",${c.pwaCogs},${p.pwaCogs}\n`;
    csvContent += `"Potongan Diskon & Voucher Promo",${c.promoDiscounts},${p.promoDiscounts}\n`;
    csvContent += `"Gross Profit (Laba Kotor)",${c.grossProfit},${p.grossProfit}\n`;
    csvContent += `"Pengeluaran Operasional Toko",${c.operationalExpenses},${p.operationalExpenses}\n`;
    csvContent += `"Pembayaran Kulakan / PO Supplier",${c.procurementExpenses},${p.procurementExpenses}\n`;
    csvContent += `"Komisi Pengiriman / Kurir & Biaya Lain-lain",${c.courierCommissionExpenses},${p.courierCommissionExpenses}\n`;
    csvContent += `"Total Expenses",${c.totalExpenses},${p.totalExpenses}\n`;
    csvContent += `"Net Profit / Laba Bersih Operasional",${c.netProfit},${p.netProfit}\n\n`;

    csvContent += 'RINCIAN PENJUALAN PER HARI\n';
    csvContent += 'Tanggal,Nota POS,Order PWA,Qty Terjual,Omzet Kotor,HPP,Diskon,Laba Bersih\n';
    executiveStatementData.dailyRows.forEach((d) => {
      csvContent += `"${d.dateKey}",${d.posCount},${d.pwaCount},${d.qty},${d.grossSales},${d.cogs},${d.discount},${d.netProfit}\n`;
    });

    csvContent += '\nRINCIAN BERDASARKAN PELANGGAN\n';
    csvContent +=
      'Nama Pelanggan,Level,Transaksi,Total Belanja Tunai,Total Piutang/Hutang,Total Belanja,Kontribusi Laba\n';
    executiveStatementData.customerRows.forEach((cu) => {
      csvContent += `"${cu.name}","${cu.level}",${cu.trxCount},${cu.cashPaid},${cu.debtUnpaid},${cu.totalSpent},${cu.profitContribution}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Laporan_Cashflow_RiskCart_${startDate}_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleGoToLaporanKas = () => {
    if (onNavigateTab) {
      onNavigateTab('/dashboard/laporankas');
    } else {
      navigateToPath('/dashboard/laporankas');
    }
  };

  const isWhiteSheet = sheetTheme === 'white';
  const execModeTitleMap: Record<ExecutiveReportMode, string> = {
    pnl: 'Profit & Loss Statement / Laporan Laba Rugi & Penjualan Detail',
    daily: 'Daily Sales & Profit Statement / Laporan Penjualan Per Hari',
    customer: 'Customer Revenue & Receivables / Laporan Penjualan Berdasarkan Pelanggan',
    category_product: 'Category & Product Profitability / Laporan Kategori & Item Produk',
    channel: 'Channel Performance Statement / Perbandingan Kasir POS vs Client PWA',
    shipper_payment: 'Courier & Payment Settlement / Laporan Kurir Pengirim & Metode Bayar',
  };

  const modeButtons: Array<{
    id: ExecutiveReportMode;
    label: string;
    subtitle: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'pnl',
      label: '📄 Ringkasan Laba Rugi (Profit & Loss Statement)',
      subtitle: 'Revenue, HPP, Pengeluaran & Laba Bersih',
      icon: <FileText className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'daily',
      label: '📅 Penjualan Per Hari',
      subtitle: 'Rekap harian nota POS, order PWA, HPP & profit',
      icon: <TrendingUp className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'customer',
      label: '👥 Berdasarkan Pelanggan',
      subtitle: 'Belanja lunas, piutang/hutang & kontribusi laba',
      icon: <Users className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'category_product',
      label: '🏷️ Berdasarkan Kategori & Produk',
      subtitle: 'Rincian produk per kategori, HPP, omzet & margin',
      icon: <Layers className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'channel',
      label: '🖥️ Berdasarkan Channel (POS vs Client PWA)',
      subtitle: 'Perbandingan Kasir Toko vs Pesanan Online',
      icon: <Monitor className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'shipper_payment',
      label: '🚚 Berdasarkan Kurir / Pengirim & Metode Bayar',
      subtitle: 'Rekap pengirim, nota lunas vs piutang/COD',
      icon: <Truck className="w-4 h-4 shrink-0" />,
    },
  ];

  return (
    <div className="space-y-5 print:p-0 print:m-0 print:space-y-0">
      {/* CSS Print 1 Halaman A4 */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
          }
          body, html {
            background: #ffffff !important;
            color: #000000 !important;
          }
          nav, aside, header, footer, .print\\:hidden {
            display: none !important;
          }
          #printable-executive-sheet {
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 12px !important;
            border: none !important;
            box-shadow: none !important;
            background: #ffffff !important;
            color: #0f172a !important;
          }
        }
      `}</style>

      {/* LAYOUT 2 KOLOM: KIRI = LEMBAR DOKUMEN CETAK (lg:col-span-8), KANAN = PANEL KONTROL STICKY (lg:col-span-4) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ==========================================================================
            A. KOLOM SEBELAH KIRI (lg:col-span-8 — AREA HALAMAN UNTUK PRINT / EXECUTIVE SHEET)
           ========================================================================== */}
        <div className="lg:col-span-8 w-full ml-0 mr-auto print:col-span-12">
          <div
            id="printable-executive-sheet"
            className={`ml-0 mr-auto w-full rounded-xl p-6 sm:p-8 md:p-10 shadow-2xl transition-colors print:max-w-none print:w-full print:rounded-none print:p-4 print:shadow-none print:bg-white print:text-black ${
              isWhiteSheet
                ? 'bg-white text-slate-900 border border-slate-300'
                : 'bg-[#100d08] text-amber-50 border border-amber-500/45 shadow-[0_0_35px_rgba(245,158,11,0.14)]'
            }`}
          >
            {/* 1. HEADER DOKUMEN RESMI */}
            <div
              className={`pb-4 mb-4 border-b ${
                isWhiteSheet ? 'border-slate-300' : 'border-amber-500/30'
              } flex flex-col sm:flex-row sm:items-end justify-between gap-2`}
            >
              <div>
                <h2
                  className={`text-xl sm:text-2xl md:text-3xl font-black tracking-tight uppercase ${
                    isWhiteSheet ? 'text-slate-900' : 'text-amber-300'
                  }`}
                >
                  RISKCART STORE — LAPORAN EKSEKUTIF CASHFLOW &amp; LABA RUGI
                </h2>
                <p
                  className={`text-xs mt-1 font-medium ${
                    isWhiteSheet ? 'text-slate-600' : 'text-amber-200/80'
                  }`}
                >
                  Periode Laporan:{' '}
                  <span className="font-bold font-mono">
                    {dateRangePreset === 'all' ? 'Semua Periode' : `${startDate} s/d ${endDate}`}
                  </span>{' '}
                  &bull; Mata Uang Aktif:{' '}
                  <span className="font-bold font-mono">
                    {activeCurrencyMode === 'USD' ? 'USD ($)' : 'IDR (Rp)'}
                  </span>
                </p>
              </div>
              <div
                className={`text-[11px] font-mono sm:text-right ${
                  isWhiteSheet ? 'text-slate-500' : 'text-amber-300/70'
                }`}
              >
                <div>
                  Dicetak:{' '}
                  {new Date().toLocaleDateString('id-ID', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}{' '}
                  {new Date().toLocaleTimeString('id-ID', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
                <div>
                  Total Transaksi Valid: {executiveStatementData.currentPnL.windowValidTrx.length}{' '}
                  Trx
                </div>
              </div>
            </div>

            {/* 2. BANNER JUDUL MODE LAPORAN */}
            <div
              className={`w-full px-4 py-3 rounded-t-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-white ${
                isWhiteSheet
                  ? 'bg-[#1b4332] border-b-2 border-[#081c15]'
                  : 'bg-gradient-to-r from-[#452c06] via-[#5c3b09] to-[#2e1d04] border-b-2 border-amber-400/60'
              }`}
            >
              <div className="font-black text-sm md:text-base tracking-wide">
                {execModeTitleMap[execMode]}
              </div>
              {execMode === 'pnl' ? (
                <div className="grid grid-cols-2 gap-4 text-right font-mono text-xs font-bold shrink-0 sm:w-72">
                  <div>
                    <div className="text-[10px] uppercase opacity-80">Periode Ini (Current)</div>
                    <div>
                      {dateRangePreset === 'all'
                        ? 'All Time'
                        : `${startDate.slice(5)}..${endDate.slice(5)}`}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase opacity-80">
                      Periode Sebelumnya (Prior)
                    </div>
                    <div>
                      {executiveStatementData.priorStartKey
                        ? `${executiveStatementData.priorStartKey.slice(5)}..${executiveStatementData.priorEndKey.slice(5)}`
                        : 'Prior Window'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3 text-right font-mono text-xs font-bold shrink-0 sm:w-80">
                  <span>Qty / Transaksi</span>
                  <span>Nominal</span>
                  <span>% Porsi / Margin</span>
                </div>
              )}
            </div>

            {/* 3. ISI TABEL DINAMIS SESUAI 6 MODE LAPORAN */}
            {execMode === 'pnl' && (
              <div className="mt-4 space-y-6 text-xs md:text-sm">
                {/* SEKSI 1: REVENUE (PENDAPATAN PENJUALAN) */}
                <div>
                  <h3
                    className={`font-black uppercase tracking-wider text-xs pb-1.5 mb-2 border-b ${
                      isWhiteSheet
                        ? 'text-[#1b4332] border-slate-300'
                        : 'text-amber-400 border-amber-500/30'
                    }`}
                  >
                    REVENUE (PENDAPATAN PENJUALAN)
                  </h3>
                  <div
                    className={`divide-y ${
                      isWhiteSheet ? 'divide-slate-200' : 'divide-amber-500/15'
                    }`}
                  >
                    {[
                      {
                        label: 'Penjualan Kasir POS (Tunai / QRIS)',
                        curr: executiveStatementData.currentPnL.posCashQrisRev,
                        prior: executiveStatementData.priorPnL.posCashQrisRev,
                      },
                      {
                        label: 'Penjualan Kasir POS (Piutang / COD)',
                        curr: executiveStatementData.currentPnL.posCreditCodRev,
                        prior: executiveStatementData.priorPnL.posCreditCodRev,
                      },
                      {
                        label: 'Penjualan Online Client PWA',
                        curr: executiveStatementData.currentPnL.pwaOnlineRev,
                        prior: executiveStatementData.priorPnL.pwaOnlineRev,
                      },
                      {
                        label: 'Pendapatan Lainnya / Kas Masuk Brangkas Toko',
                        curr: executiveStatementData.currentPnL.otherCashInRev,
                        prior: executiveStatementData.priorPnL.otherCashInRev,
                      },
                    ].map((row, i) => (
                      <div
                        key={i}
                        className="py-2 flex items-center justify-between gap-4 pl-3 pr-1"
                      >
                        <span className={isWhiteSheet ? 'text-slate-700' : 'text-amber-100/90'}>
                          {row.label}
                        </span>
                        <div className="grid grid-cols-2 gap-4 text-right font-mono sm:w-72 shrink-0">
                          <span className="font-semibold">{fmt(row.curr)}</span>
                          <span className={isWhiteSheet ? 'text-slate-500' : 'text-amber-200/60'}>
                            {fmt(row.prior)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div
                    className={`mt-1 py-2.5 px-3 flex items-center justify-between gap-4 font-black border-t border-b-2 ${
                      isWhiteSheet
                        ? 'bg-slate-100 border-slate-800 text-slate-900'
                        : 'bg-amber-500/10 border-amber-400 text-amber-200'
                    }`}
                  >
                    <span>Total Revenue &amp; Gains</span>
                    <div className="grid grid-cols-2 gap-4 text-right font-mono sm:w-72 shrink-0">
                      <span>{fmt(executiveStatementData.currentPnL.totalRevenue)}</span>
                      <span className="opacity-80">
                        {fmt(executiveStatementData.priorPnL.totalRevenue)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* SEKSI 2: COST OF GOODS SOLD / HPP (MODAL BARANG TERJUAL) */}
                <div>
                  <h3
                    className={`font-black uppercase tracking-wider text-xs pb-1.5 mb-2 border-b ${
                      isWhiteSheet
                        ? 'text-[#1b4332] border-slate-300'
                        : 'text-amber-400 border-amber-500/30'
                    }`}
                  >
                    COST OF GOODS SOLD / HPP (MODAL BARANG TERJUAL)
                  </h3>
                  <div
                    className={`divide-y ${
                      isWhiteSheet ? 'divide-slate-200' : 'divide-amber-500/15'
                    }`}
                  >
                    {[
                      {
                        label: 'HPP Produk Terjual POS (Σ qty * costPrice)',
                        curr: executiveStatementData.currentPnL.posCogs,
                        prior: executiveStatementData.priorPnL.posCogs,
                      },
                      {
                        label: 'HPP Produk Terjual Client PWA',
                        curr: executiveStatementData.currentPnL.pwaCogs,
                        prior: executiveStatementData.priorPnL.pwaCogs,
                      },
                      {
                        label: 'Potongan Diskon & Voucher Promo',
                        curr: executiveStatementData.currentPnL.promoDiscounts,
                        prior: executiveStatementData.priorPnL.promoDiscounts,
                      },
                    ].map((row, i) => (
                      <div
                        key={i}
                        className="py-2 flex items-center justify-between gap-4 pl-3 pr-1"
                      >
                        <span className={isWhiteSheet ? 'text-slate-700' : 'text-amber-100/90'}>
                          {row.label}
                        </span>
                        <div className="grid grid-cols-2 gap-4 text-right font-mono sm:w-72 shrink-0">
                          <span className="font-semibold">{fmt(row.curr)}</span>
                          <span className={isWhiteSheet ? 'text-slate-500' : 'text-amber-200/60'}>
                            {fmt(row.prior)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div
                    className={`mt-1 py-2.5 px-3 flex items-center justify-between gap-4 font-black border-t border-b-2 ${
                      isWhiteSheet
                        ? 'bg-emerald-50 border-emerald-900 text-emerald-950'
                        : 'bg-emerald-500/15 border-emerald-400/70 text-emerald-300'
                    }`}
                  >
                    <span>
                      Gross Profit (Laba Kotor Penjualan &bull; Margin{' '}
                      {executiveStatementData.currentPnL.grossMarginPct.toFixed(1)}%)
                    </span>
                    <div className="grid grid-cols-2 gap-4 text-right font-mono sm:w-72 shrink-0">
                      <span>{fmt(executiveStatementData.currentPnL.grossProfit)}</span>
                      <span className="opacity-80">
                        {fmt(executiveStatementData.priorPnL.grossProfit)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* SEKSI 3: EXPENSES (BEBAN & PENGELUARAN OPERASIONAL) */}
                <div>
                  <h3
                    className={`font-black uppercase tracking-wider text-xs pb-1.5 mb-2 border-b ${
                      isWhiteSheet
                        ? 'text-[#1b4332] border-slate-300'
                        : 'text-amber-400 border-amber-500/30'
                    }`}
                  >
                    EXPENSES (BEBAN &amp; PENGELUARAN OPERASIONAL)
                  </h3>
                  <div
                    className={`divide-y ${
                      isWhiteSheet ? 'divide-slate-200' : 'divide-amber-500/15'
                    }`}
                  >
                    {[
                      {
                        label:
                          'Pengeluaran Operasional Toko (cash_logs / brangkas_toko_logs keluar)',
                        curr: executiveStatementData.currentPnL.operationalExpenses,
                        prior: executiveStatementData.priorPnL.operationalExpenses,
                      },
                      {
                        label: 'Pembayaran Kulakan / PO Supplier (procurements)',
                        curr: executiveStatementData.currentPnL.procurementExpenses,
                        prior: executiveStatementData.priorPnL.procurementExpenses,
                      },
                      {
                        label: 'Komisi Pengiriman / Kurir & Biaya Lain-lain',
                        curr: executiveStatementData.currentPnL.courierCommissionExpenses,
                        prior: executiveStatementData.priorPnL.courierCommissionExpenses,
                      },
                    ].map((row, i) => (
                      <div
                        key={i}
                        className="py-2 flex items-center justify-between gap-4 pl-3 pr-1"
                      >
                        <span className={isWhiteSheet ? 'text-slate-700' : 'text-amber-100/90'}>
                          {row.label}
                        </span>
                        <div className="grid grid-cols-2 gap-4 text-right font-mono sm:w-72 shrink-0">
                          <span className="font-semibold">{fmt(row.curr)}</span>
                          <span className={isWhiteSheet ? 'text-slate-500' : 'text-amber-200/60'}>
                            {fmt(row.prior)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div
                    className={`mt-1 py-2.5 px-3 flex items-center justify-between gap-4 font-black border-t border-b-2 ${
                      isWhiteSheet
                        ? 'bg-slate-100 border-slate-800 text-slate-900'
                        : 'bg-amber-500/10 border-amber-400 text-amber-200'
                    }`}
                  >
                    <span>Total Expenses</span>
                    <div className="grid grid-cols-2 gap-4 text-right font-mono sm:w-72 shrink-0">
                      <span>{fmt(executiveStatementData.currentPnL.totalExpenses)}</span>
                      <span className="opacity-80">
                        {fmt(executiveStatementData.priorPnL.totalExpenses)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* SEKSI 4: BOTTOM LINE (DOUBLE BORDER) */}
                <div
                  className={`py-4 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 font-black text-sm md:text-base border-t-2 border-b-4 border-double ${
                    isWhiteSheet
                      ? 'bg-[#e9f5ee] border-slate-900 text-[#081c15]'
                      : 'bg-gradient-to-r from-amber-500/20 to-emerald-500/20 border-amber-400 text-amber-200'
                  }`}
                >
                  <div>
                    <div>Net Profit / Laba Bersih Operasional (Revenue - HPP - Expenses)</div>
                    <div className="text-[11px] font-normal opacity-80">
                      Net Profit Margin: {executiveStatementData.currentPnL.netMarginPct.toFixed(1)}%
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-right font-mono sm:w-72 shrink-0">
                    <span
                      className={
                        executiveStatementData.currentPnL.netProfit < 0
                          ? 'text-rose-600'
                          : isWhiteSheet
                          ? 'text-emerald-800'
                          : 'text-emerald-300'
                      }
                    >
                      {fmt(executiveStatementData.currentPnL.netProfit)}
                    </span>
                    <span className="opacity-75">
                      {fmt(executiveStatementData.priorPnL.netProfit)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* MODE 2: PENJUALAN PER HARI */}
            {execMode === 'daily' && (
              <div className="mt-4 space-y-3 text-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr
                        className={`border-b-2 font-black uppercase text-[11px] ${
                          isWhiteSheet
                            ? 'border-slate-800 text-slate-700 bg-slate-100'
                            : 'border-amber-400/60 text-amber-300 bg-amber-500/10'
                        }`}
                      >
                        <th className="py-2.5 px-2">Tanggal</th>
                        <th className="py-2.5 px-2 text-center">Nota POS</th>
                        <th className="py-2.5 px-2 text-center">Order PWA</th>
                        <th className="py-2.5 px-2 text-center">Qty Terjual</th>
                        <th className="py-2.5 px-2 text-right">Omzet Kotor</th>
                        <th className="py-2.5 px-2 text-right">HPP</th>
                        <th className="py-2.5 px-2 text-right">Diskon</th>
                        <th className="py-2.5 px-2 text-right">Laba Bersih</th>
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y ${
                        isWhiteSheet ? 'divide-slate-200' : 'divide-amber-500/15'
                      }`}
                    >
                      {executiveStatementData.dailyRows.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center opacity-60">
                            Belum ada transaksi pada periode ini (Rp 0).
                          </td>
                        </tr>
                      ) : (
                        executiveStatementData.dailyRows.map((row) => {
                          const isExp = Boolean(expandedGroupKeys[`daily_${row.dateKey}`]);
                          return (
                            <React.Fragment key={row.dateKey}>
                              <tr
                                onClick={() => toggleExpandGroup(`daily_${row.dateKey}`)}
                                className={`cursor-pointer transition ${
                                  isWhiteSheet ? 'hover:bg-slate-50' : 'hover:bg-amber-500/10'
                                }`}
                              >
                                <td className="py-2.5 px-2 font-mono font-bold">
                                  <span className="mr-1.5">{isExp ? '▼' : '▶'}</span>
                                  {row.dateKey}
                                </td>
                                <td className="py-2.5 px-2 text-center font-mono">{row.posCount}</td>
                                <td className="py-2.5 px-2 text-center font-mono">{row.pwaCount}</td>
                                <td className="py-2.5 px-2 text-center font-mono font-bold">
                                  {row.qty}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono">
                                  {fmt(row.grossSales)}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono opacity-80">
                                  {fmt(row.cogs)}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono text-amber-600">
                                  {fmt(row.discount)}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono font-black text-emerald-600">
                                  {fmt(row.netProfit)}
                                </td>
                              </tr>
                              {isExp && (
                                <tr>
                                  <td
                                    colSpan={8}
                                    className={`p-3 ${
                                      isWhiteSheet ? 'bg-slate-50' : 'bg-[#16120b]'
                                    }`}
                                  >
                                    <div className="text-[11px] font-bold mb-1.5">
                                      Rincian Nomor Nota Tanggal {row.dateKey}:
                                    </div>
                                    <div className="space-y-1">
                                      {row.transactions.map((tx: any, idx: number) => (
                                        <div
                                          key={tx.id || idx}
                                          onClick={() => openTransactionDetailModal(tx, 'SALE')}
                                          className="flex items-center justify-between text-[11px] font-mono py-1.5 px-2 rounded hover:bg-amber-500/15 cursor-pointer transition border-b border-dashed border-slate-300/40"
                                        >
                                          <span className="font-bold text-amber-500 hover:underline">
                                            #{tx.receiptNo || tx.orderNumber || tx.id} &bull;{' '}
                                            {tx.customerName || 'Pelanggan Umum'} (
                                            {String(tx.paymentMethod || 'cash').toUpperCase()})
                                          </span>
                                          <span className="font-bold">
                                            {fmt(Number(tx.totalAmount ?? tx.total ?? 0))} &rarr;
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                    <tfoot>
                      <tr
                        className={`font-black border-t-2 border-b-4 border-double ${
                          isWhiteSheet
                            ? 'bg-[#e9f5ee] border-slate-900 text-slate-900'
                            : 'bg-amber-500/15 border-amber-400 text-amber-200'
                        }`}
                      >
                        <td className="py-3 px-2 uppercase">GRAND TOTAL AKUMULASI</td>
                        <td className="py-3 px-2 text-center font-mono">
                          {executiveStatementData.dailyRows.reduce((s, r) => s + r.posCount, 0)}
                        </td>
                        <td className="py-3 px-2 text-center font-mono">
                          {executiveStatementData.dailyRows.reduce((s, r) => s + r.pwaCount, 0)}
                        </td>
                        <td className="py-3 px-2 text-center font-mono">
                          {executiveStatementData.dailyRows.reduce((s, r) => s + r.qty, 0)}
                        </td>
                        <td className="py-3 px-2 text-right font-mono">
                          {fmt(
                            executiveStatementData.dailyRows.reduce((s, r) => s + r.grossSales, 0)
                          )}
                        </td>
                        <td className="py-3 px-2 text-right font-mono">
                          {fmt(executiveStatementData.dailyRows.reduce((s, r) => s + r.cogs, 0))}
                        </td>
                        <td className="py-3 px-2 text-right font-mono">
                          {fmt(
                            executiveStatementData.dailyRows.reduce((s, r) => s + r.discount, 0)
                          )}
                        </td>
                        <td className="py-3 px-2 text-right font-mono">
                          {fmt(
                            executiveStatementData.dailyRows.reduce((s, r) => s + r.netProfit, 0)
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* MODE 3: BERDASARKAN PELANGGAN */}
            {execMode === 'customer' && (
              <div className="mt-4 space-y-3 text-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr
                        className={`border-b-2 font-black uppercase text-[11px] ${
                          isWhiteSheet
                            ? 'border-slate-800 text-slate-700 bg-slate-100'
                            : 'border-amber-400/60 text-amber-300 bg-amber-500/10'
                        }`}
                      >
                        <th className="py-2.5 px-2">Nama Pelanggan</th>
                        <th className="py-2.5 px-2">Tipe / Level</th>
                        <th className="py-2.5 px-2 text-center">Jml Transaksi</th>
                        <th className="py-2.5 px-2 text-right">Belanja Tunai/Lunas</th>
                        <th className="py-2.5 px-2 text-right">Piutang / Hutang</th>
                        <th className="py-2.5 px-2 text-right">Total Belanja</th>
                        <th className="py-2.5 px-2 text-right">Kontribusi Laba</th>
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y ${
                        isWhiteSheet ? 'divide-slate-200' : 'divide-amber-500/15'
                      }`}
                    >
                      {executiveStatementData.customerRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center opacity-60">
                            Belum ada data transaksi pelanggan pada periode ini.
                          </td>
                        </tr>
                      ) : (
                        executiveStatementData.customerRows.map((row) => {
                          const isExp = Boolean(expandedGroupKeys[`cust_${row.name}`]);
                          return (
                            <React.Fragment key={row.name}>
                              <tr
                                onClick={() => toggleExpandGroup(`cust_${row.name}`)}
                                className={`cursor-pointer transition ${
                                  isWhiteSheet ? 'hover:bg-slate-50' : 'hover:bg-amber-500/10'
                                }`}
                              >
                                <td className="py-2.5 px-2 font-bold">
                                  <span className="mr-1.5 font-mono">{isExp ? '▼' : '▶'}</span>
                                  {row.name}
                                </td>
                                <td className="py-2.5 px-2">{row.level}</td>
                                <td className="py-2.5 px-2 text-center font-mono">
                                  {row.trxCount}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono">
                                  {fmt(row.cashPaid)}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono text-rose-500">
                                  {fmt(row.debtUnpaid)}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono font-bold">
                                  {fmt(row.totalSpent)}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono font-black text-emerald-600">
                                  {fmt(row.profitContribution)}
                                </td>
                              </tr>
                              {isExp && (
                                <tr>
                                  <td
                                    colSpan={7}
                                    className={`p-3 ${
                                      isWhiteSheet ? 'bg-slate-50' : 'bg-[#16120b]'
                                    }`}
                                  >
                                    <div className="space-y-1">
                                      {row.transactions.map((tx: any, idx: number) => (
                                        <div
                                          key={tx.id || idx}
                                          onClick={() => openTransactionDetailModal(tx, 'SALE')}
                                          className="flex items-center justify-between text-[11px] font-mono py-1.5 px-2 rounded hover:bg-amber-500/15 cursor-pointer transition border-b border-dashed border-slate-300/40"
                                        >
                                          <span className="font-bold text-amber-500 hover:underline">
                                            #{tx.receiptNo || tx.orderNumber || tx.id} &bull;{' '}
                                            {toLocalDateKey(
                                              tx.createdAt || tx.timestamp || tx.date
                                            )}{' '}
                                            &bull; {String(tx.paymentMethod || 'cash').toUpperCase()}
                                          </span>
                                          <span className="font-bold">
                                            {fmt(Number(tx.totalAmount ?? tx.total ?? 0))} &rarr;
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                    <tfoot>
                      <tr
                        className={`font-black border-t-2 border-b-4 border-double ${
                          isWhiteSheet
                            ? 'bg-[#e9f5ee] border-slate-900 text-slate-900'
                            : 'bg-amber-500/15 border-amber-400 text-amber-200'
                        }`}
                      >
                        <td className="py-3 px-2 uppercase" colSpan={2}>
                          GRAND TOTAL AKUMULASI
                        </td>
                        <td className="py-3 px-2 text-center font-mono">
                          {executiveStatementData.customerRows.reduce((s, r) => s + r.trxCount, 0)}
                        </td>
                        <td className="py-3 px-2 text-right font-mono">
                          {fmt(
                            executiveStatementData.customerRows.reduce((s, r) => s + r.cashPaid, 0)
                          )}
                        </td>
                        <td className="py-3 px-2 text-right font-mono">
                          {fmt(
                            executiveStatementData.customerRows.reduce(
                              (s, r) => s + r.debtUnpaid,
                              0
                            )
                          )}
                        </td>
                        <td className="py-3 px-2 text-right font-mono">
                          {fmt(
                            executiveStatementData.customerRows.reduce(
                              (s, r) => s + r.totalSpent,
                              0
                            )
                          )}
                        </td>
                        <td className="py-3 px-2 text-right font-mono">
                          {fmt(
                            executiveStatementData.customerRows.reduce(
                              (s, r) => s + r.profitContribution,
                              0
                            )
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* MODE 4: BERDASARKAN KATEGORI & PRODUK */}
            {execMode === 'category_product' && (
              <div className="mt-4 space-y-4 text-xs">
                {executiveStatementData.categoryProductRows.length === 0 ? (
                  <div className="py-8 text-center opacity-60">
                    Belum ada produk terjual pada periode ini (Rp 0).
                  </div>
                ) : (
                  executiveStatementData.categoryProductRows.map((cat) => {
                    const marginPct = cat.revenue > 0 ? (cat.profit / cat.revenue) * 100 : 0;
                    return (
                      <div
                        key={cat.category}
                        className={`border rounded-lg overflow-hidden ${
                          isWhiteSheet ? 'border-slate-300' : 'border-amber-500/30'
                        }`}
                      >
                        <div
                          className={`px-3 py-2 font-black flex items-center justify-between ${
                            isWhiteSheet
                              ? 'bg-slate-100 text-slate-900'
                              : 'bg-amber-500/15 text-amber-200'
                          }`}
                        >
                          <span className="uppercase">{cat.category}</span>
                          <span className="font-mono">
                            Qty: {cat.qty} &bull; Omzet: {fmt(cat.revenue)} &bull; Laba:{' '}
                            {fmt(cat.profit)} ({marginPct.toFixed(1)}%)
                          </span>
                        </div>
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr
                              className={`border-b text-[11px] font-bold ${
                                isWhiteSheet
                                  ? 'border-slate-200 text-slate-600'
                                  : 'border-amber-500/20 text-amber-300/80'
                              }`}
                            >
                              <th className="py-2 px-3">Nama Produk / Item</th>
                              <th className="py-2 px-3 text-center">Qty Terjual</th>
                              <th className="py-2 px-3 text-right">Harga Modal (HPP)</th>
                              <th className="py-2 px-3 text-right">Omzet Penjualan</th>
                              <th className="py-2 px-3 text-right">Margin Laba (Rp &amp; %)</th>
                            </tr>
                          </thead>
                          <tbody
                            className={`divide-y ${
                              isWhiteSheet ? 'divide-slate-200' : 'divide-amber-500/15'
                            }`}
                          >
                            {cat.productList.map((p) => {
                              const pMargin = p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0;
                              return (
                                <tr key={`${p.id}_${p.name}`}>
                                  <td className="py-2 px-3 font-semibold">{p.name}</td>
                                  <td className="py-2 px-3 text-center font-mono">{p.qty}</td>
                                  <td className="py-2 px-3 text-right font-mono">{fmt(p.cogs)}</td>
                                  <td className="py-2 px-3 text-right font-mono font-bold">
                                    {fmt(p.revenue)}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono font-bold text-emerald-600">
                                    {fmt(p.profit)} ({pMargin.toFixed(1)}%)
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })
                )}

                <div
                  className={`py-3.5 px-4 flex items-center justify-between font-black border-t-2 border-b-4 border-double ${
                    isWhiteSheet
                      ? 'bg-[#e9f5ee] border-slate-900 text-slate-900'
                      : 'bg-amber-500/15 border-amber-400 text-amber-200'
                  }`}
                >
                  <span>GRAND TOTAL AKUMULASI KATEGORI &amp; PRODUK</span>
                  <div className="font-mono text-right">
                    <span>
                      Qty: {executiveStatementData.categoryProductRows.reduce((s, c) => s + c.qty, 0)}{' '}
                      &bull;{' '}
                    </span>
                    <span>
                      Omzet:{' '}
                      {fmt(
                        executiveStatementData.categoryProductRows.reduce((s, c) => s + c.revenue, 0)
                      )}{' '}
                      &bull;{' '}
                    </span>
                    <span>
                      Laba:{' '}
                      {fmt(
                        executiveStatementData.categoryProductRows.reduce((s, c) => s + c.profit, 0)
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* MODE 5: BERDASARKAN CHANNEL (POS vs CLIENT PWA) */}
            {execMode === 'channel' && (
              <div className="mt-4 space-y-3 text-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr
                        className={`border-b-2 font-black uppercase text-[11px] ${
                          isWhiteSheet
                            ? 'border-slate-800 text-slate-700 bg-slate-100'
                            : 'border-amber-400/60 text-amber-300 bg-amber-500/10'
                        }`}
                      >
                        <th className="py-2.5 px-2">Channel Penjualan</th>
                        <th className="py-2.5 px-2">Metode Pembayaran</th>
                        <th className="py-2.5 px-2 text-center">Jml Nota</th>
                        <th className="py-2.5 px-2 text-center">Qty Unit</th>
                        <th className="py-2.5 px-2 text-right">Omzet Bersih</th>
                        <th className="py-2.5 px-2 text-right">HPP</th>
                        <th className="py-2.5 px-2 text-right">Laba Kotor</th>
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y ${
                        isWhiteSheet ? 'divide-slate-200' : 'divide-amber-500/15'
                      }`}
                    >
                      {executiveStatementData.channelRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center opacity-60">
                            Belum ada transaksi POS maupun Client PWA pada periode ini.
                          </td>
                        </tr>
                      ) : (
                        executiveStatementData.channelRows.map((row) => {
                          const isExp = Boolean(expandedGroupKeys[`ch_${row.channelKey}`]);
                          return (
                            <React.Fragment key={row.channelKey}>
                              <tr
                                onClick={() => toggleExpandGroup(`ch_${row.channelKey}`)}
                                className={`cursor-pointer transition ${
                                  isWhiteSheet ? 'hover:bg-slate-50' : 'hover:bg-amber-500/10'
                                }`}
                              >
                                <td className="py-2.5 px-2 font-bold">
                                  <span className="mr-1.5 font-mono">{isExp ? '▼' : '▶'}</span>
                                  {row.channelLabel}
                                </td>
                                <td className="py-2.5 px-2 font-semibold">{row.paymentLabel}</td>
                                <td className="py-2.5 px-2 text-center font-mono">
                                  {row.trxCount}
                                </td>
                                <td className="py-2.5 px-2 text-center font-mono">{row.qty}</td>
                                <td className="py-2.5 px-2 text-right font-mono font-bold">
                                  {fmt(row.netSales)}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono">
                                  {fmt(row.cogs)}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono font-black text-emerald-600">
                                  {fmt(row.profit)}
                                </td>
                              </tr>
                              {isExp && (
                                <tr>
                                  <td
                                    colSpan={7}
                                    className={`p-3 ${
                                      isWhiteSheet ? 'bg-slate-50' : 'bg-[#16120b]'
                                    }`}
                                  >
                                    <div className="space-y-1">
                                      {row.transactions.map((tx: any, idx: number) => (
                                        <div
                                          key={tx.id || idx}
                                          onClick={() => openTransactionDetailModal(tx, 'SALE')}
                                          className="flex items-center justify-between text-[11px] font-mono py-1.5 px-2 rounded hover:bg-amber-500/15 cursor-pointer transition border-b border-dashed border-slate-300/40"
                                        >
                                          <span className="font-bold text-amber-500 hover:underline">
                                            #{tx.receiptNo || tx.orderNumber || tx.id} &bull;{' '}
                                            {tx.customerName || 'Pelanggan Umum'} &bull;{' '}
                                            {toLocalDateKey(
                                              tx.createdAt || tx.timestamp || tx.date
                                            )}
                                          </span>
                                          <span className="font-bold">
                                            {fmt(Number(tx.totalAmount ?? tx.total ?? 0))} &rarr;
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                    <tfoot>
                      <tr
                        className={`font-black border-t-2 border-b-4 border-double ${
                          isWhiteSheet
                            ? 'bg-[#e9f5ee] border-slate-900 text-slate-900'
                            : 'bg-amber-500/15 border-amber-400 text-amber-200'
                        }`}
                      >
                        <td className="py-3 px-2 uppercase" colSpan={2}>
                          GRAND TOTAL AKUMULASI CHANNEL
                        </td>
                        <td className="py-3 px-2 text-center font-mono">
                          {executiveStatementData.channelRows.reduce((s, r) => s + r.trxCount, 0)}
                        </td>
                        <td className="py-3 px-2 text-center font-mono">
                          {executiveStatementData.channelRows.reduce((s, r) => s + r.qty, 0)}
                        </td>
                        <td className="py-3 px-2 text-right font-mono">
                          {fmt(
                            executiveStatementData.channelRows.reduce((s, r) => s + r.netSales, 0)
                          )}
                        </td>
                        <td className="py-3 px-2 text-right font-mono">
                          {fmt(executiveStatementData.channelRows.reduce((s, r) => s + r.cogs, 0))}
                        </td>
                        <td className="py-3 px-2 text-right font-mono">
                          {fmt(
                            executiveStatementData.channelRows.reduce((s, r) => s + r.profit, 0)
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* MODE 6: BERDASARKAN KURIR / PENGIRIM & METODE BAYAR */}
            {execMode === 'shipper_payment' && (
              <div className="mt-4 space-y-3 text-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr
                        className={`border-b-2 font-black uppercase text-[11px] ${
                          isWhiteSheet
                            ? 'border-slate-800 text-slate-700 bg-slate-100'
                            : 'border-amber-400/60 text-amber-300 bg-amber-500/10'
                        }`}
                      >
                        <th className="py-2.5 px-2">Kurir / Pengirim (Shipper)</th>
                        <th className="py-2.5 px-2">Metode Bayar</th>
                        <th className="py-2.5 px-2 text-center">Nota (Lunas/Belum)</th>
                        <th className="py-2.5 px-2 text-right">Sudah Lunas</th>
                        <th className="py-2.5 px-2 text-right">Belum Lunas (Piutang/COD)</th>
                        <th className="py-2.5 px-2 text-right">Total Nominal</th>
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y ${
                        isWhiteSheet ? 'divide-slate-200' : 'divide-amber-500/15'
                      }`}
                    >
                      {executiveStatementData.shipperRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center opacity-60">
                            Belum ada data pengiriman / kurir pada periode ini.
                          </td>
                        </tr>
                      ) : (
                        executiveStatementData.shipperRows.map((row) => {
                          const key = `ship_${row.shipperName}_${row.paymentMethod}`;
                          const isExp = Boolean(expandedGroupKeys[key]);
                          return (
                            <React.Fragment key={key}>
                              <tr
                                onClick={() => toggleExpandGroup(key)}
                                className={`cursor-pointer transition ${
                                  isWhiteSheet ? 'hover:bg-slate-50' : 'hover:bg-amber-500/10'
                                }`}
                              >
                                <td className="py-2.5 px-2 font-bold">
                                  <span className="mr-1.5 font-mono">{isExp ? '▼' : '▶'}</span>
                                  {row.shipperName}
                                </td>
                                <td className="py-2.5 px-2">{row.paymentMethod}</td>
                                <td className="py-2.5 px-2 text-center font-mono">
                                  {row.paidCount} Lunas / {row.unpaidCount} Belum
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono text-emerald-600 font-semibold">
                                  {fmt(row.paidAmount)}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono text-rose-500 font-semibold">
                                  {fmt(row.unpaidAmount)}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono font-black">
                                  {fmt(row.totalAmount)}
                                </td>
                              </tr>
                              {isExp && (
                                <tr>
                                  <td
                                    colSpan={6}
                                    className={`p-3 ${
                                      isWhiteSheet ? 'bg-slate-50' : 'bg-[#16120b]'
                                    }`}
                                  >
                                    <div className="space-y-1">
                                      {row.transactions.map((tx: any, idx: number) => (
                                        <div
                                          key={tx.id || idx}
                                          onClick={() => openTransactionDetailModal(tx, 'SALE')}
                                          className="flex items-center justify-between text-[11px] font-mono py-1.5 px-2 rounded hover:bg-amber-500/15 cursor-pointer transition border-b border-dashed border-slate-300/40"
                                        >
                                          <span className="font-bold text-amber-500 hover:underline">
                                            #{tx.receiptNo || tx.orderNumber || tx.id} &bull;{' '}
                                            {tx.customerName || 'Pelanggan Umum'} &bull;{' '}
                                            {toLocalDateKey(
                                              tx.createdAt || tx.timestamp || tx.date
                                            )}
                                          </span>
                                          <span className="font-bold">
                                            {fmt(Number(tx.totalAmount ?? tx.total ?? 0))} &rarr;
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                    <tfoot>
                      <tr
                        className={`font-black border-t-2 border-b-4 border-double ${
                          isWhiteSheet
                            ? 'bg-[#e9f5ee] border-slate-900 text-slate-900'
                            : 'bg-amber-500/15 border-amber-400 text-amber-200'
                        }`}
                      >
                        <td className="py-3 px-2 uppercase" colSpan={2}>
                          GRAND TOTAL AKUMULASI KURIR &amp; PEMBAYARAN
                        </td>
                        <td className="py-3 px-2 text-center font-mono">
                          {executiveStatementData.shipperRows.reduce((s, r) => s + r.trxCount, 0)}{' '}
                          Trx
                        </td>
                        <td className="py-3 px-2 text-right font-mono">
                          {fmt(
                            executiveStatementData.shipperRows.reduce((s, r) => s + r.paidAmount, 0)
                          )}
                        </td>
                        <td className="py-3 px-2 text-right font-mono">
                          {fmt(
                            executiveStatementData.shipperRows.reduce(
                              (s, r) => s + r.unpaidAmount,
                              0
                            )
                          )}
                        </td>
                        <td className="py-3 px-2 text-right font-mono">
                          {fmt(
                            executiveStatementData.shipperRows.reduce(
                              (s, r) => s + r.totalAmount,
                              0
                            )
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* 4. EXPANDABLE RINCIAN TABEL ITEM TRANSAKSI PER NOMOR NOTA */}
            <div
              className={`mt-6 pt-4 border-t ${
                isWhiteSheet ? 'border-slate-300' : 'border-amber-500/30'
              } print:hidden`}
            >
              <button
                type="button"
                onClick={() => setShowAllNotesDetail((prev) => !prev)}
                className={`w-full py-2.5 px-3 rounded-lg text-xs font-bold flex items-center justify-between cursor-pointer transition ${
                  isWhiteSheet
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                    : 'bg-[#16120b] hover:bg-amber-500/15 text-amber-200 border border-amber-500/30'
                }`}
              >
                <span>
                  {showAllNotesDetail ? '▼ Sembunyikan' : '▶ Tampilkan'} Rincian Tabel Item Transaksi
                  Per Nomor Nota ({executiveStatementData.currentPnL.windowValidTrx.length} Nota)
                </span>
                <span className="font-mono text-[11px]">Klik Nota untuk Lihat Detail</span>
              </button>

              {showAllNotesDetail && (
                <div className="mt-3 overflow-x-auto max-h-96 custom-scrollbar">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr
                        className={`border-b font-bold ${
                          isWhiteSheet
                            ? 'border-slate-300 bg-slate-50'
                            : 'border-amber-500/30 bg-[#14110b]'
                        }`}
                      >
                        <th className="py-2 px-2">No. Nota</th>
                        <th className="py-2 px-2">Tanggal</th>
                        <th className="py-2 px-2">Channel</th>
                        <th className="py-2 px-2">Pelanggan</th>
                        <th className="py-2 px-2">Kurir / Bayar</th>
                        <th className="py-2 px-2 text-right">HPP</th>
                        <th className="py-2 px-2 text-right">Total Nota</th>
                        <th className="py-2 px-2 text-right">Laba</th>
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y ${
                        isWhiteSheet ? 'divide-slate-200' : 'divide-amber-500/15'
                      }`}
                    >
                      {executiveStatementData.currentPnL.windowValidTrx.map(({ raw: tx, m }, i) => (
                        <tr
                          key={tx.id || i}
                          onClick={() => openTransactionDetailModal(tx, 'SALE')}
                          className="hover:bg-amber-500/15 cursor-pointer transition"
                        >
                          <td className="py-1.5 px-2 font-mono font-bold text-amber-500 hover:underline">
                            {m.receiptNo}
                          </td>
                          <td className="py-1.5 px-2 font-mono">{m.dateKey}</td>
                          <td className="py-1.5 px-2 uppercase font-mono">
                            {m.isPwa ? 'PWA' : 'POS'}
                          </td>
                          <td className="py-1.5 px-2">{m.customerName}</td>
                          <td className="py-1.5 px-2">
                            {m.shipper} ({m.pm.toUpperCase()})
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">{fmt(m.cogs)}</td>
                          <td className="py-1.5 px-2 text-right font-mono font-bold">
                            {fmt(m.netAmt)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono font-bold text-emerald-600">
                            {fmt(m.netAmt - m.cogs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ==========================================================================
            B. KOLOM SEBELAH KANAN (lg:col-span-4 — PANEL KONTROL, FILTER PERIODE, PILIHAN 6 MODE & AKSI CETAK)
           ========================================================================== */}
        <div className="lg:col-span-4 sticky top-4 space-y-4 print:hidden">
          {/* 1. PANEL HEADER & TOMBOL AKSI UTAMA */}
          <div className="bg-[#0d0b07] border border-amber-500/40 rounded-2xl p-4 sm:p-5 shadow-[0_0_24px_rgba(245,158,11,0.12)] space-y-4">
            <div className="flex items-start justify-between gap-2 border-b border-amber-500/25 pb-3">
              <div>
                <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-300 text-[10px] font-black uppercase tracking-widest mb-1">
                  <span>1-PAGE EXECUTIVE CASHFLOW</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <h1 className="text-base sm:text-lg font-black text-amber-100 tracking-tight">
                  PANEL KONTROL &amp; CETAK LAPORAN
                </h1>
                <p className="text-[11px] text-amber-200/70">
                  Lembar dokumen cetak berada di sebelah kiri (Siap Print A4 1 Halaman)
                </p>
              </div>
              <button
                type="button"
                onClick={() => refreshFirestore()}
                className="p-2 rounded-xl bg-[#14110b] hover:bg-amber-500/20 text-amber-300 border border-amber-500/35 transition cursor-pointer shrink-0"
                title="Sinkronkan Ulang dari Cloud Firestore"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {/* Tombol Cetak & Export */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handlePrint}
                className="w-full px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 hover:brightness-110 text-black text-xs font-black transition flex items-center justify-center gap-1.5 shadow-[0_0_14px_rgba(245,158,11,0.3)] cursor-pointer"
              >
                <Printer className="w-4 h-4 shrink-0" />
                <span>🖨️ Cetak / Save PDF (1 Halaman)</span>
              </button>

              <button
                type="button"
                onClick={handleExportCSV}
                className="w-full px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition flex items-center justify-center gap-1.5 border border-emerald-400/40 shadow-md cursor-pointer"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>⬇ Export CSV / Excel</span>
              </button>
            </div>

            {/* Toggle Tema Lembar Kiri */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-300/80 block">
                Tema Lembar Dokumen Kiri:
              </span>
              <div className="grid grid-cols-2 gap-1.5 bg-[#14110b] p-1 rounded-xl border border-amber-500/35">
                <button
                  type="button"
                  onClick={() => setSheetTheme('white')}
                  className={`px-2.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                    isWhiteSheet
                      ? 'bg-amber-400 text-black font-black shadow-sm'
                      : 'text-amber-200/70 hover:text-amber-100'
                  }`}
                >
                  📄 Kertas Putih Cetak
                </button>
                <button
                  type="button"
                  onClick={() => setSheetTheme('dark')}
                  className={`px-2.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                    !isWhiteSheet
                      ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-black font-black shadow-sm'
                      : 'text-amber-200/70 hover:text-amber-100'
                  }`}
                >
                  🌑 Dark Gold Sheet
                </button>
              </div>
            </div>

            {/* Pintasan kembali ke /dashboard/laporankas */}
            <button
              type="button"
              onClick={handleGoToLaporanKas}
              className="w-full px-3.5 py-2 rounded-xl bg-[#14110b] hover:bg-amber-500/15 text-amber-200 border border-amber-500/35 text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-amber-400" />
              <span>📋 Buka Laporan Penjualan &amp; Kas (/dashboard/laporankas)</span>
            </button>
          </div>

          {/* 2. RINGKASAN KPI CEPAT (MINI GOLD CARDS DI KANAN) */}
          <div className="bg-[#0d0b07] border border-amber-500/40 rounded-2xl p-4 shadow-xl space-y-2.5">
            <div className="text-[11px] font-black uppercase tracking-wider text-amber-300 flex items-center justify-between">
              <span>Ringkasan KPI Periode Aktif</span>
              <span className="font-mono text-[10px] text-amber-200/70">
                {executiveStatementData.currentPnL.windowValidTrx.length} Nota
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-[#14110b] border border-amber-500/30 rounded-xl p-3">
                <div className="text-[10px] text-amber-200/70 uppercase font-bold">
                  Total Revenue
                </div>
                <div className="text-sm font-mono font-black text-amber-100 mt-0.5 truncate">
                  {fmt(executiveStatementData.currentPnL.totalRevenue)}
                </div>
              </div>
              <div className="bg-[#14110b] border border-amber-500/30 rounded-xl p-3">
                <div className="text-[10px] text-amber-200/70 uppercase font-bold">
                  Total HPP &amp; Diskon
                </div>
                <div className="text-sm font-mono font-black text-amber-300 mt-0.5 truncate">
                  {fmt(executiveStatementData.currentPnL.totalCogsAndDisc)}
                </div>
              </div>
              <div className="bg-[#14110b] border border-amber-500/30 rounded-xl p-3">
                <div className="text-[10px] text-amber-200/70 uppercase font-bold">
                  Total Pengeluaran
                </div>
                <div className="text-sm font-mono font-black text-rose-400 mt-0.5 truncate">
                  {fmt(executiveStatementData.currentPnL.totalExpenses)}
                </div>
              </div>
              <div className="bg-[#14110b] border border-emerald-500/40 rounded-xl p-3">
                <div className="text-[10px] text-emerald-300/80 uppercase font-bold">
                  Net Profit (Laba Bersih)
                </div>
                <div
                  className={`text-sm font-mono font-black mt-0.5 truncate ${
                    executiveStatementData.currentPnL.netProfit < 0
                      ? 'text-rose-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {fmt(executiveStatementData.currentPnL.netProfit)}
                </div>
              </div>
            </div>
          </div>

          {/* 3. PILIHAN 6 MODE LAPORAN (VERTICAL STACK / INTERACTIVE CARDS DI KANAN) */}
          <div className="bg-[#0d0b07] border border-amber-500/40 rounded-2xl p-4 shadow-xl space-y-2.5">
            <div className="text-[11px] font-black uppercase tracking-wider text-amber-300">
              Pilih Mode Laporan (6 Format Dokumen):
            </div>
            <div className="space-y-1.5">
              {modeButtons.map((tab) => {
                const active = execMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setExecMode(tab.id)}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl transition cursor-pointer border flex items-start gap-2.5 ${
                      active
                        ? 'bg-gradient-to-r from-[#f59e0b] to-[#d97706] text-black font-black border-amber-300 shadow-[0_0_14px_rgba(245,158,11,0.28)]'
                        : 'bg-[#14110b] text-amber-100/90 border-amber-500/25 hover:border-amber-400/70 hover:bg-amber-500/15'
                    }`}
                  >
                    <div className="mt-0.5">{tab.icon}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold leading-snug">{tab.label}</div>
                      <div
                        className={`text-[10px] mt-0.5 ${
                          active ? 'text-black/80 font-semibold' : 'text-amber-200/60'
                        }`}
                      >
                        {tab.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. FILTER PERIODE & PENCARIAN CEPAT */}
          <div className="bg-[#0d0b07] border border-amber-500/40 rounded-2xl p-4 shadow-xl space-y-3 text-xs">
            <div className="text-[11px] font-black uppercase tracking-wider text-amber-300">
              Filter Periode &amp; Pencarian Cepat:
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {[
                { key: 'today', label: 'Hari Ini' },
                { key: 'yesterday', label: 'Kemarin' },
                { key: '7days', label: '7 Hari Terakhir' },
                { key: 'month', label: 'Bulan Ini' },
                { key: 'year', label: 'Tahun Ini' },
                { key: 'all', label: 'Semua' },
              ].map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handleDatePreset(p.key as any)}
                  className={`px-2 py-1.5 rounded-lg font-bold transition cursor-pointer border text-center ${
                    dateRangePreset === p.key
                      ? 'bg-amber-500/25 text-amber-200 border-amber-400 font-black'
                      : 'bg-[#14110b] text-amber-200/70 border-amber-500/25 hover:text-amber-100 hover:border-amber-500/50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="bg-[#14110b] border border-amber-500/35 rounded-xl px-2.5 py-1.5">
                <div className="text-[10px] text-amber-300/70 font-bold flex items-center gap-1 mb-0.5">
                  <Calendar className="w-3 h-3 text-amber-400" />
                  <span>Dari Tanggal:</span>
                </div>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setDateRangePreset('custom');
                  }}
                  className="w-full bg-transparent text-amber-100 font-mono text-xs focus:outline-none cursor-pointer"
                />
              </div>
              <div className="bg-[#14110b] border border-amber-500/35 rounded-xl px-2.5 py-1.5">
                <div className="text-[10px] text-amber-300/70 font-bold flex items-center gap-1 mb-0.5">
                  <Calendar className="w-3 h-3 text-amber-400" />
                  <span>Sampai Tanggal:</span>
                </div>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setDateRangePreset('custom');
                  }}
                  className="w-full bg-transparent text-amber-100 font-mono text-xs focus:outline-none cursor-pointer"
                />
              </div>
            </div>

            <div className="relative pt-1">
              <Search className="w-3.5 h-3.5 text-amber-400/70 absolute left-3 top-3.5" />
              <input
                type="text"
                placeholder="Cari No. Nota, Pelanggan, Kasir, Kurir..."
                value={execSearch}
                onChange={(e) => setExecSearch(e.target.value)}
                className="w-full bg-[#14110b] border border-amber-500/40 rounded-xl pl-8 pr-3 py-2 text-xs text-amber-100 placeholder-amber-200/40 focus:outline-none focus:border-amber-400"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
