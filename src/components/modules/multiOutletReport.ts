import { Product, Transaction } from '../../types';

export type ReportPeriod = 'today' | '7d' | '30d' | 'month';
export type OutletFilterId = 'all' | 'out_1' | 'out_2' | 'out_3';

export interface ReportFilter {
  period: ReportPeriod;
  outletId: OutletFilterId;
}

export interface KpiSummary {
  totalRevenue: number;
  totalProfit: number; // totalAmount - totalCost
  transactionsCount: number;
  completedCount: number;
  fraudCount: number;
  pendingCount: number;
  totalStockValue: number;
  criticalStockCount: number;
  habisCount: number;
  menipisCount: number;
  amanCount: number;
}

export interface DailyReport {
  date: string; // ISO date or formatted
  label: string; // e.g. "12 Okt" or "08:00"
  revenue: number;
  profit: number;
  transactionCount: number;
}

export interface OutletMetric {
  outletId: string;
  name: string;
  code: string;
  revenue: number;
  profit: number;
  totalTransactions: number;
  completedCount: number;
  fraudCount: number;
  pendingCount: number;
  stockValue: number;
  criticalStockCount: number;
  totalStockUnits: number;
}

export interface PaymentMetric {
  method: string;
  label: string;
  amount: number;
  count: number;
  percentage: number;
}

export interface ChannelMetric {
  channel: string;
  label: string;
  amount: number;
  count: number;
  percentage: number;
}

export interface LocationMetric {
  locationId: string;
  name: string;
  type: 'outlet' | 'warehouse';
  stockValue: number;
  productCount: number;
  criticalCount: number;
  totalUnits: number;
  cartonsStored: number;
}

export interface MultiOutletReportData {
  kpi: KpiSummary;
  daily: DailyReport[];
  byOutlet: OutletMetric[];
  byPayment: PaymentMetric[];
  byChannel: ChannelMetric[];
  byLocation: LocationMetric[];
  filteredTransactions: Transaction[];
  filteredProducts: Product[];
}

export interface OutletItem {
  id: string;
  name: string;
  code?: string;
  type?: string;
  address?: string;
  phone?: string;
  cashierActive?: number;
  geofenceRadius?: number;
  isHQ?: boolean;
}

export interface WarehouseItem {
  id: string;
  name: string;
  code?: string;
  manager?: string;
  capacityPct?: number;
  address?: string;
  temperature?: string;
  status?: string;
}

export const MASTER_OUTLETS: OutletItem[] = [];

export const MASTER_WAREHOUSES: WarehouseItem[] = [];

export function getStartDateForPeriod(period: ReportPeriod, now = new Date()): Date {
  const start = new Date(now);
  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (period === '7d') {
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
  } else if (period === '30d') {
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  return start;
}

export function computeReport(
  transactions: Transaction[],
  products: Product[],
  filter: ReportFilter,
  customOutlets: OutletItem[] = [],
  customWarehouses: WarehouseItem[] = []
): MultiOutletReportData {
  const { period, outletId } = filter;
  const now = new Date();
  const startDate = getStartDateForPeriod(period, now);

  // Filter transactions by period and outlet
  const filteredTransactions = transactions.filter((t) => {
    // Outlet filter
    const txOutlet = t.outletId ?? 'out_1';
    if (outletId !== 'all' && txOutlet !== outletId) {
      return false;
    }

    // Period filter
    if (!t.createdAt) return true;
    const txDate = new Date(t.createdAt);
    if (isNaN(txDate.getTime())) return true;
    return txDate >= startDate && txDate <= now;
  });

  // Filter products by outlet if specific outlet selected, otherwise all products
  const filteredProducts = products.filter((p) => {
    if (outletId === 'all') return true;
    const pLoc = p.storageLocation ?? 'out_1';
    return pLoc === outletId;
  });

  // KPI Calculations
  let totalRevenue = 0;
  let totalProfit = 0;
  let completedCount = 0;
  let fraudCount = 0;
  let pendingCount = 0;

  for (const t of filteredTransactions) {
    if (t.status === 'completed') {
      completedCount++;
      totalRevenue += t.totalAmount;
      const cost = t.totalCost ?? t.totalAmount * 0.65;
      totalProfit += t.totalAmount - cost;
    } else if (t.status === 'flagged_fraud') {
      fraudCount++;
    } else if (t.status === 'pending_approval' || t.status === 'pending') {
      pendingCount++;
    }
  }

  // Stock status calculations:
  // Habis (<= 0) / Menipis (<= minStockAlert) / Aman; Kritis = Habis + Menipis
  let totalStockValue = 0;
  let habisCount = 0;
  let menipisCount = 0;
  let amanCount = 0;

  for (const p of filteredProducts) {
    const units = p.stockInUnits ?? 0;
    const cost = p.costPerUnit ?? 0;
    totalStockValue += units * cost;

    const minAlert = p.minStockAlert ?? 10;
    if (units <= 0) {
      habisCount++;
    } else if (units <= minAlert) {
      menipisCount++;
    } else {
      amanCount++;
    }
  }

  const criticalStockCount = habisCount + menipisCount;

  const kpi: KpiSummary = {
    totalRevenue,
    totalProfit,
    transactionsCount: filteredTransactions.length,
    completedCount,
    fraudCount,
    pendingCount,
    totalStockValue,
    criticalStockCount,
    habisCount,
    menipisCount,
    amanCount,
  };

  // Daily Trend calculation
  const dailyMap = new Map<string, { label: string; revenue: number; profit: number; count: number; dateObj: Date }>();

  // Initialize date buckets for period to ensure smooth continuous lines
  const numDays = period === 'today' ? 1 : period === '7d' ? 7 : 30;
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString().split('T')[0];
    const dayLabel = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    dailyMap.set(key, { label: dayLabel, revenue: 0, profit: 0, count: 0, dateObj: d });
  }

  for (const t of filteredTransactions) {
    if (t.status !== 'completed' || !t.createdAt) continue;
    const txDate = new Date(t.createdAt);
    if (isNaN(txDate.getTime())) continue;
    const key = txDate.toISOString().split('T')[0];
    const existing = dailyMap.get(key);
    const cost = t.totalCost ?? t.totalAmount * 0.65;
    const profit = t.totalAmount - cost;
    if (existing) {
      existing.revenue += t.totalAmount;
      existing.profit += profit;
      existing.count += 1;
    } else {
      const dayLabel = txDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      dailyMap.set(key, { label: dayLabel, revenue: t.totalAmount, profit, count: 1, dateObj: txDate });
    }
  }

  const daily: DailyReport[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      label: data.label,
      revenue: data.revenue,
      profit: data.profit,
      transactionCount: data.count,
    }));

  // By Outlet Metrics
  // Note: Calculated in the selected period for comparison
  const outletsToUse = customOutlets.length > 0 ? customOutlets : MASTER_OUTLETS;
  const byOutlet: OutletMetric[] = outletsToUse.map((outlet) => {
    const outletTxs = transactions.filter((t) => {
      const txOutlet = t.outletId ?? 'out_1';
      if (txOutlet !== outlet.id) return false;
      if (!t.createdAt) return true;
      const txDate = new Date(t.createdAt);
      if (isNaN(txDate.getTime())) return true;
      return txDate >= startDate && txDate <= now;
    });

    let rev = 0;
    let prof = 0;
    let completed = 0;
    let fraud = 0;
    let pending = 0;

    for (const t of outletTxs) {
      if (t.status === 'completed') {
        completed++;
        rev += t.totalAmount;
        prof += t.totalAmount - (t.totalCost ?? t.totalAmount * 0.65);
      } else if (t.status === 'flagged_fraud') {
        fraud++;
      } else if (t.status === 'pending_approval' || t.status === 'pending') {
        pending++;
      }
    }

    const outletProds = products.filter((p) => (p.storageLocation ?? 'out_1') === outlet.id);
    let stockVal = 0;
    let critical = 0;
    let totalUnits = 0;

    for (const p of outletProds) {
      const units = p.stockInUnits ?? 0;
      stockVal += units * (p.costPerUnit ?? 0);
      totalUnits += units;
      const minAlert = p.minStockAlert ?? 10;
      if (units <= minAlert) critical++;
    }

    return {
      outletId: outlet.id,
      name: outlet.name,
      code: outlet.code || '',
      revenue: rev,
      profit: prof,
      totalTransactions: outletTxs.length,
      completedCount: completed,
      fraudCount: fraud,
      pendingCount: pending,
      stockValue: stockVal,
      criticalStockCount: critical,
      totalStockUnits: totalUnits,
    };
  });

  // By Payment Method (Donut)
  const paymentMap = new Map<string, { amount: number; count: number }>();
  let totalPaymentCompleted = 0;

  for (const t of filteredTransactions) {
    if (t.status !== 'completed') continue;
    const method = t.paymentMethod || 'cash';
    const entry = paymentMap.get(method) || { amount: 0, count: 0 };
    entry.amount += t.totalAmount;
    entry.count += 1;
    paymentMap.set(method, entry);
    totalPaymentCompleted += t.totalAmount;
  }

  const paymentLabels: Record<string, string> = {
    cash: 'Tunai (Cash)',
    qris: 'QRIS Statis/Dinamis',
    card: 'Debit / Kartu Kredit',
    bank_transfer: 'Transfer Bank',
    debt: 'Hutang / Kasbon',
    cod: 'COD',
  };

  const byPayment: PaymentMetric[] = Array.from(paymentMap.entries())
    .map(([method, data]) => ({
      method,
      label: paymentLabels[method] || method.toUpperCase(),
      amount: data.amount,
      count: data.count,
      percentage: totalPaymentCompleted > 0 ? (data.amount / totalPaymentCompleted) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // By Channel (POS vs PWA)
  const channelMap = new Map<string, { amount: number; count: number }>();
  let totalChannelCompleted = 0;

  for (const t of filteredTransactions) {
    if (t.status !== 'completed') continue;
    const channel = t.channel || 'pos';
    const entry = channelMap.get(channel) || { amount: 0, count: 0 };
    entry.amount += t.totalAmount;
    entry.count += 1;
    channelMap.set(channel, entry);
    totalChannelCompleted += t.totalAmount;
  }

  const channelLabels: Record<string, string> = {
    pos: 'POS Kasir Terminal',
    pwa_client: 'Client PWA (Member Self-Order)',
    offline_pos: 'POS Kasir Offline Mode',
    client_pwa: 'PWA Online Order',
  };

  const byChannel: ChannelMetric[] = Array.from(channelMap.entries()).map(([channel, data]) => ({
    channel,
    label: channelLabels[channel] || channel,
    amount: data.amount,
    count: data.count,
    percentage: totalChannelCompleted > 0 ? (data.amount / totalChannelCompleted) * 100 : 0,
  }));

  // By Location (outlets + warehouses)
  const warehousesToUse = customWarehouses.length > 0 ? customWarehouses : MASTER_WAREHOUSES;
  const locationList: { id: string; name: string; type: 'outlet' | 'warehouse' }[] = [
    ...outletsToUse.map((o) => ({ id: o.id, name: o.name, type: 'outlet' as const })),
    ...warehousesToUse.map((w) => ({ id: w.id, name: w.name, type: 'warehouse' as const })),
  ];

  const byLocation: LocationMetric[] = locationList.map((loc) => {
    const locProds = products.filter((p) => (p.storageLocation ?? 'out_1') === loc.id);
    let sVal = 0;
    let cCount = 0;
    let tUnits = 0;
    let cartons = 0;

    for (const p of locProds) {
      const units = p.stockInUnits ?? 0;
      const cogs = p.costPerUnit ?? 0;
      sVal += units * cogs;
      tUnits += units;
      const pieces = Math.max(1, p.piecesPerCarton || 1);
      cartons += Math.floor(units / pieces);
      const minAlert = p.minStockAlert ?? 10;
      if (units <= minAlert) {
        cCount++;
      }
    }

    return {
      locationId: loc.id,
      name: loc.name,
      type: loc.type,
      stockValue: sVal,
      productCount: locProds.length,
      criticalCount: cCount,
      totalUnits: tUnits,
      cartonsStored: cartons,
    };
  });

  return {
    kpi,
    daily,
    byOutlet,
    byPayment,
    byChannel,
    byLocation,
    filteredTransactions,
    filteredProducts,
  };
}

export type ProductReportSubType =
  | 'produk_keseluruhan'
  | 'produk_masuk'
  | 'produk_keluar';

export interface OverallProductReportRow {
  productId: string;
  produk: string;
  sku: string;
  category: string;
  masuk: number;
  penjualan: number;
  stokSistem: number;
}

export interface ProductMovementReportRow {
  id: string;
  tanggal: string;
  rawTimestamp: number;
  productId: string;
  produk: string;
  sku: string;
  docNumber: string;
  masuk: number;
  qty: number;
  totalStokMasuk: number;
  sourceLabel?: string;
}

export interface ProductReportComputedData {
  overallRows: OverallProductReportRow[];
  masukRows: ProductMovementReportRow[];
  keluarRows: ProductMovementReportRow[];
  totalMasukUnits: number;
  totalPenjualanUnits: number;
  totalStokSistemUnits: number;
}

function formatReportDate(raw: any): { label: string; ms: number } {
  if (!raw) return { label: '-', ms: 0 };
  const d =
    typeof raw?.toDate === 'function'
      ? raw.toDate()
      : raw instanceof Date
      ? raw
      : new Date(raw);
  if (isNaN(d.getTime())) {
    return { label: String(raw), ms: 0 };
  }
  const label = d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  return { label, ms: d.getTime() };
}

export function computeProductReportData(params: {
  products: Product[];
  validTransactions: any[];
  purchaseOrders: any[];
  stockMutations: any[];
  stockMovements: any[];
  isWithinPeriod: (rawDate: any) => boolean;
}): ProductReportComputedData {
  const {
    products,
    validTransactions,
    purchaseOrders,
    stockMutations,
    stockMovements,
    isWithinPeriod,
  } = params;

  const byId = new Map<string, Product>();
  const byName = new Map<string, Product>();
  products.forEach((p) => {
    if (p.id) byId.set(p.id, p);
    if (p.sku) byId.set(p.sku, p);
    if (p.name) byName.set(p.name.trim().toLowerCase(), p);
  });

  const overallMap = new Map<string, OverallProductReportRow>();
  products.forEach((p) => {
    overallMap.set(p.id, {
      productId: p.id,
      produk: p.name || 'Produk',
      sku: p.sku || p.id,
      category: p.category || '-',
      masuk: 0,
      penjualan: 0,
      stokSistem: Number(p.stockInUnits ?? (p as any).stock ?? 0),
    });
  });

  const ensureOverallRow = (pid: string, pName: string, matched?: Product): OverallProductReportRow => {
    const key = matched?.id || pid || pName.toLowerCase().trim() || 'unknown';
    let row = overallMap.get(key);
    if (!row) {
      row = {
        productId: key,
        produk: matched?.name || pName || 'Produk',
        sku: matched?.sku || pid || '-',
        category: matched?.category || '-',
        masuk: 0,
        penjualan: 0,
        stokSistem: matched ? Number(matched.stockInUnits ?? (matched as any).stock ?? 0) : 0,
      };
      overallMap.set(key, row);
    }
    return row;
  };

  const masukRows: ProductMovementReportRow[] = [];
  const processedInKeys = new Set<string>();

  // 1. Purchase Orders (ProcurementModule)
  purchaseOrders.forEach((po) => {
    const rawDate = po.date || po.createdAt || po.orderDate || po.timestamp;
    if (!isWithinPeriod(rawDate)) return;
    if (po.addToStock === false) return;

    const { label: dateLabel, ms } = formatReportDate(rawDate);
    const poDoc = String(po.poNumber || po.id || 'PO');

    if (Array.isArray(po.items) && po.items.length > 0) {
      po.items.forEach((item: any, idx: number) => {
        const pid = String(item.productId || '');
        const pName = String(item.productName || item.name || 'Produk');
        const matched = byId.get(pid) || byName.get(pName.trim().toLowerCase());
        const qty = Math.max(1, Number(item.qty ?? item.quantity ?? 1));
        const addedUnits = qty;

        const targetRow = ensureOverallRow(pid, pName, matched);
        targetRow.masuk += addedUnits;

        const dedupKey = `${poDoc}_${targetRow.productId}`;
        processedInKeys.add(dedupKey);

        masukRows.push({
          id: `po_${po.id || poDoc}_${idx}`,
          tanggal: dateLabel,
          rawTimestamp: ms,
          productId: targetRow.productId,
          produk: targetRow.produk,
          sku: targetRow.sku,
          docNumber: poDoc,
          masuk: addedUnits,
          qty,
          totalStokMasuk: targetRow.masuk,
          sourceLabel: po.supplier || 'Pembelian PO',
        });
      });
    } else {
      const pid = String(po.productId || '');
      const pName = String(po.productName || po.product || 'Produk Pembelian');
      const matched = byId.get(pid) || byName.get(pName.trim().toLowerCase());
      const qty = Math.max(1, Number(po.cartons ?? po.itemsCount ?? po.qty ?? 1));
      const addedUnits = qty;

      const targetRow = ensureOverallRow(pid, pName, matched);
      targetRow.masuk += addedUnits;

      const dedupKey = `${poDoc}_${targetRow.productId}`;
      processedInKeys.add(dedupKey);

      masukRows.push({
        id: `po_${po.id || poDoc}`,
        tanggal: dateLabel,
        rawTimestamp: ms,
        productId: targetRow.productId,
        produk: targetRow.produk,
        sku: targetRow.sku,
        docNumber: poDoc,
        masuk: addedUnits,
        qty,
        totalStokMasuk: targetRow.masuk,
        sourceLabel: po.supplier || 'Pembelian PO',
      });
    }
  });

  // 2. Stock Mutations & Stock Movements (Incoming / Restock)
  const allInMutations = [...stockMutations, ...stockMovements];
  allInMutations.forEach((mut, idx) => {
    const rawDate = mut.createdAt || mut.date || mut.timestamp;
    if (!isWithinPeriod(rawDate)) return;

    const rawType = String(mut.type || mut.direction || '').toUpperCase();
    const isMasuk =
      rawType === 'MASUK' ||
      rawType === 'IN' ||
      rawType.includes('RESTOCK') ||
      rawType.includes('PURCHASE') ||
      Number(mut.unitsChange) > 0;

    if (!isMasuk) return;

    const pid = String(mut.productId || '');
    const pName = String(mut.productName || mut.product || 'Produk');
    const matched = byId.get(pid) || byName.get(pName.trim().toLowerCase());
    const targetRow = ensureOverallRow(pid, pName, matched);

    const refDoc = String(mut.reference || mut.refNumber || mut.docNumber || `MUT-${mut.id || idx}`);
    const dedupKey = `${refDoc}_${targetRow.productId}`;
    if (processedInKeys.has(dedupKey)) return;
    processedInKeys.add(dedupKey);

    const qty = Math.max(1, Math.abs(Number(mut.qty ?? mut.quantity ?? mut.unitsChange ?? 1)));
    const addedUnits = Math.abs(Number(mut.addedUnits ?? mut.unitsChange ?? qty));
    targetRow.masuk += addedUnits;

    const { label: dateLabel, ms } = formatReportDate(rawDate);

    masukRows.push({
      id: `in_mut_${mut.id || idx}`,
      tanggal: dateLabel,
      rawTimestamp: ms,
      productId: targetRow.productId,
      produk: targetRow.produk,
      sku: targetRow.sku,
      docNumber: refDoc,
      masuk: addedUnits,
      qty,
      totalStokMasuk: Number(mut.afterStock ?? mut.stockAfter ?? targetRow.masuk),
      sourceLabel: mut.reason || mut.notes || 'Stok Masuk',
    });
  });

  // 3. Outgoing / Sales Transactions (POS & Orders) & Outgoing Stock Mutations
  const keluarRows: ProductMovementReportRow[] = [];
  const processedOutKeys = new Set<string>();

  validTransactions.forEach((tx) => {
    const rawDate = tx.createdAt || tx.timestamp || tx.date;
    if (!isWithinPeriod(rawDate)) return;

    const { label: dateLabel, ms } = formatReportDate(rawDate);
    const txDoc = String(tx.transactionId || tx.orderId || tx.id || 'TRX');
    const items = Array.isArray(tx.items) ? tx.items : [];

    items.forEach((item: any, idx: number) => {
      const pid = String(item.productId || item.product?.id || item.id || '');
      const pName = String(item.productName || item.name || item.product?.name || 'Produk').trim();
      const matched = byId.get(pid) || byName.get(pName.toLowerCase());
      const targetRow = ensureOverallRow(pid, pName, matched);

      const qty = Math.max(1, Number(item.quantityOrdered ?? item.quantity ?? item.qty ?? 1));
      const unitsSold = qty;

      targetRow.penjualan += unitsSold;

      const dedupKey = `${txDoc}_${targetRow.productId}_${idx}`;
      processedOutKeys.add(`${txDoc}_${targetRow.productId}`);

      keluarRows.push({
        id: `out_tx_${txDoc}_${idx}`,
        tanggal: dateLabel,
        rawTimestamp: ms,
        productId: targetRow.productId,
        produk: targetRow.produk,
        sku: targetRow.sku,
        docNumber: txDoc,
        masuk: targetRow.masuk,
        qty: unitsSold,
        totalStokMasuk: targetRow.masuk > 0 ? targetRow.masuk : targetRow.stokSistem,
        sourceLabel: tx.channel === 'pwa_client' ? 'Online Order (PWA)' : 'Penjualan POS',
      });
    });
  });

  // Also include manual KELUAR mutations from stock_mutations / stock_movements not from POS tx
  allInMutations.forEach((mut, idx) => {
    const rawDate = mut.createdAt || mut.date || mut.timestamp;
    if (!isWithinPeriod(rawDate)) return;

    const rawType = String(mut.type || mut.direction || '').toUpperCase();
    const isKeluar =
      rawType === 'KELUAR' ||
      rawType === 'OUT' ||
      rawType.includes('SALE') ||
      rawType.includes('WASTE') ||
      Number(mut.unitsChange) < 0;

    if (!isKeluar) return;

    const pid = String(mut.productId || '');
    const pName = String(mut.productName || mut.product || 'Produk');
    const matched = byId.get(pid) || byName.get(pName.trim().toLowerCase());
    const targetRow = ensureOverallRow(pid, pName, matched);

    const refDoc = String(mut.reference || mut.refNumber || mut.docNumber || `OUT-${mut.id || idx}`);
    if (processedOutKeys.has(`${refDoc}_${targetRow.productId}`)) return;
    processedOutKeys.add(`${refDoc}_${targetRow.productId}`);

    const qty = Math.max(1, Math.abs(Number(mut.qty ?? mut.quantity ?? mut.unitsChange ?? 1)));
    targetRow.penjualan += qty;

    const { label: dateLabel, ms } = formatReportDate(rawDate);

    keluarRows.push({
      id: `out_mut_${mut.id || idx}`,
      tanggal: dateLabel,
      rawTimestamp: ms,
      productId: targetRow.productId,
      produk: targetRow.produk,
      sku: targetRow.sku,
      docNumber: refDoc,
      masuk: targetRow.masuk,
      qty,
      totalStokMasuk: targetRow.masuk > 0 ? targetRow.masuk : targetRow.stokSistem,
      sourceLabel: mut.reason || mut.notes || 'Barang Keluar',
    });
  });

  // Update masuk & totalStokMasuk on keluarRows after all masuk have been aggregated
  keluarRows.forEach((r) => {
    const prodSummary = overallMap.get(r.productId);
    if (prodSummary) {
      r.masuk = prodSummary.masuk;
      r.totalStokMasuk = prodSummary.masuk;
    }
  });

  // Update cumulative totalStokMasuk on masukRows
  masukRows.forEach((r) => {
    const prodSummary = overallMap.get(r.productId);
    if (prodSummary) {
      r.totalStokMasuk = prodSummary.masuk;
    }
  });

  const overallRows = Array.from(overallMap.values()).sort(
    (a, b) => b.penjualan - a.penjualan || b.masuk - a.masuk || a.produk.localeCompare(b.produk)
  );

  masukRows.sort((a, b) => b.rawTimestamp - a.rawTimestamp);
  keluarRows.sort((a, b) => b.rawTimestamp - a.rawTimestamp);

  const totalMasukUnits = overallRows.reduce((s, r) => s + r.masuk, 0);
  const totalPenjualanUnits = overallRows.reduce((s, r) => s + r.penjualan, 0);
  const totalStokSistemUnits = overallRows.reduce((s, r) => s + r.stokSistem, 0);

  return {
    overallRows,
    masukRows,
    keluarRows,
    totalMasukUnits,
    totalPenjualanUnits,
    totalStokSistemUnits,
  };
}

