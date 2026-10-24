import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TrendingUp,
  Boxes,
  Truck,
  BarChart3,
  Layers,
  Sparkles,
  Activity,
  Info,
  Package,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppData } from '../../context/AppDataContext';
import { useLanguage } from '../../context/LanguageContext';
import { formatMoney, formatCompactMoney } from '../../utils/money';
import { ACTIVE_STORE_ID } from '../../config/store';

export type ChartViewTab = 'all' | 'penjualan' | 'asset' | 'pembelian' | 'stok_vs_sales';
export type TimeframeOption = 'today' | 'yesterday' | '7d' | '14d' | '30d' | 'month' | 'year';

export interface ChartPoint {
  date: string;
  label: string;
  // 1. Penjualan
  penjualan: number; // Nominal (IDR base)
  penjualanCost: number; // Modal HPP (IDR base)
  penjualanProfit: number; // Keuntungan Kotor (IDR base)
  penjualanUnits: number; // Qty terjual (Dus/Unit)
  transaksiCount: number; // Jumlah struk/order
  // 2. Asset Produk
  assetTotal: number; // Valuasi Harga Jual Retail (IDR base)
  assetCost: number; // Valuasi Harga Modal HPP (IDR base)
  assetUnits: number; // Stok (Dus/Unit)
  // 3. Pembelian & Barang Masuk (PO / Procurement / Log Masuk)
  pembelian: number; // Nominal Pembelian (IDR base)
  pembelianUnits: number; // Qty Barang Masuk (Dus/Unit)
  poCount: number; // Jumlah Faktur PO / Log Masuk
  // 4. Stok vs Barang Masuk vs Penjualan
  stokUnits: number; // Stok Sistem (Dus/Unit)
}

interface AdminAreaChartsProps {
  onNavigateTab?: (tab: string) => void;
  onOpenAddProduct?: () => void;
  parentTimeRange?: 'today' | 'yesterday' | '7days' | 'month' | 'year' | 'custom';
  externalTransactions?: any[];
  externalProducts?: any[];
  externalSubItemsMap?: Record<string, any[]>;
  selectedOutlet?: string;
}

const toIdrAmount = (val: unknown): number => {
  const n = Number(val ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 500 ? Math.round(n * 15500) : Math.round(n);
};

export const parseRecordDate = (val: any): Date | null => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val?.toDate === 'function') {
    try {
      const d = val.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof val?.seconds === 'number') {
    return new Date(val.seconds * 1000);
  }
  if (typeof val === 'number') {
    return new Date(val);
  }
  const str = String(val).trim();
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed;

  // Support Indonesian locale date string e.g. "17/10/2026, 14.30.00"
  const idMatch = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (idMatch) {
    const day = Number(idMatch[1]);
    const month = Number(idMatch[2]) - 1;
    const year = Number(idMatch[3]);
    const fallbackDate = new Date(year, month, day);
    if (!isNaN(fallbackDate.getTime())) return fallbackDate;
  }
  return null;
};

export const AdminAreaCharts: React.FC<AdminAreaChartsProps> = ({
  onNavigateTab,
  onOpenAddProduct,
  parentTimeRange,
  externalTransactions,
  externalProducts,
  externalSubItemsMap = {},
  selectedOutlet = 'pusat',
}) => {
  const { currencyMode: langCurrencyMode } = useLanguage();
  const appData = useAppData();

  // Active currency synchronized with top-right Currency switcher (IDR <-> USD)
  const activeCurrency = appData.currency || langCurrencyMode || 'IDR';
  const activeExchangeRate = appData.exchangeRate || 15500;

  const [activeTab, setActiveTab] = useState<ChartViewTab>('all');
  const [timeframe, setTimeframe] = useState<TimeframeOption>('today');
  const [curveType, setCurveType] = useState<'smooth' | 'linear'>('smooth');

  // Independent Product Filter State for each of the 4 Chart Boxes
  const [selectedProductSales, setSelectedProductSales] = useState<string>('ALL');
  const [selectedProductAsset, setSelectedProductAsset] = useState<string>('ALL');
  const [selectedProductPurchase, setSelectedProductPurchase] = useState<string>('ALL');
  const [selectedProductCompare, setSelectedProductCompare] = useState<string>('ALL');

  // Sync timeframe with parent AdminDashboard filter when clicked
  useEffect(() => {
    if (!parentTimeRange) return;
    if (parentTimeRange === 'today') setTimeframe('today');
    else if (parentTimeRange === 'yesterday') setTimeframe('yesterday');
    else if (parentTimeRange === '7days') setTimeframe('7d');
    else if (parentTimeRange === 'month') setTimeframe('month');
    else if (parentTimeRange === 'year') setTimeframe('year');
  }, [parentTimeRange]);

  // Multi-series visibility toggle for Chart 4 (Stok vs Barang Masuk vs Penjualan)
  const [seriesVisible, setSeriesVisible] = useState({
    stok: true,
    barangMasuk: true,
    penjualan: true,
  });

  // Hover states for interactive tooltips
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoveredChart, setHoveredChart] = useState<string | null>(null);

  // Real-time Products & Transactions from AppDataContext + parent merged props
  const liveProducts: any[] = useMemo(() => {
    const map = new Map<string, any>();
    (appData.products || []).forEach((p: any) => {
      if (p && p.id && p.isActive !== false) map.set(p.id, p);
    });
    (externalProducts || []).forEach((p: any) => {
      if (p && p.id && p.isActive !== false) {
        map.set(p.id, { ...(map.get(p.id) || {}), ...p });
      }
    });
    return Array.from(map.values()).sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'id-ID')
    );
  }, [appData.products, externalProducts]);

  const liveTransactions: any[] = useMemo(() => {
    const map = new Map<string, any>();
    const addTx = (tx: any) => {
      if (!tx) return;
      const id = String(tx.transactionId || tx.orderId || tx.id || '');
      if (!id) return;
      map.set(id, { ...(map.get(id) || {}), ...tx, id });
    };
    (appData.transactions || []).forEach(addTx);
    (appData.orders || []).forEach((ord: any) => {
      const status = String(ord.status || '').toLowerCase();
      if (status === 'cancelled' || status === 'rejected' || status === 'void') return;
      addTx({
        ...ord,
        id: ord.transactionId || ord.orderId || ord.id,
        totalAmount: Number(ord.totalAmount ?? ord.total ?? ord.subtotal ?? 0),
      });
    });
    (externalTransactions || []).forEach(addTx);
    return Array.from(map.values());
  }, [appData.transactions, appData.orders, externalTransactions]);

  // Real-time Listeners for Procurement / Purchase Orders & Incoming Stock Logs
  const [rawPurchaseOrders, setRawPurchaseOrders] = useState<any[]>([]);
  const [rawProcurements, setRawProcurements] = useState<any[]>([]);
  const [rawProductLogs, setRawProductLogs] = useState<any[]>([]);
  const [rawStockMutations, setRawStockMutations] = useState<any[]>([]);
  const [rawStockMovements, setRawStockMovements] = useState<any[]>([]);

  useEffect(() => {
    const unsubPO = onSnapshot(
      collection(db, 'purchase_orders'),
      (snap) => setRawPurchaseOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {}
    );
    const unsubProc = onSnapshot(
      collection(db, 'procurements'),
      (snap) => setRawProcurements(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {}
    );
    const unsubLogs = onSnapshot(
      collection(db, 'product_logs'),
      (snap) => setRawProductLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {}
    );
    const unsubMutations = onSnapshot(
      collection(db, 'stock_mutations'),
      (snap) => setRawStockMutations(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {}
    );
    const unsubMovements = onSnapshot(
      collection(db, 'stock_movements'),
      (snap) => setRawStockMovements(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {}
    );

    return () => {
      unsubPO();
      unsubProc();
      unsubLogs();
      unsubMutations();
      unsubMovements();
    };
  }, []);

  // Product lookup maps by id, sku, and normalized name
  const productLookup = useMemo(() => {
    const byId = new Map<string, any>();
    const bySku = new Map<string, any>();
    const byName = new Map<string, any>();
    liveProducts.forEach((p) => {
      if (p.id) byId.set(String(p.id), p);
      if (p.sku) bySku.set(String(p.sku).trim().toLowerCase(), p);
      if (p.name) byName.set(String(p.name).trim().toLowerCase(), p);
    });
    return { byId, bySku, byName };
  }, [liveProducts]);

  // Helper to check if a transaction item or PO/log entry belongs to a selected product
  const matchesTargetProduct = useCallback(
    (entry: any, targetProduct: any): boolean => {
      if (!entry || !targetProduct) return false;
      const targetId = String(targetProduct.id || '').trim();
      const targetSku = String(targetProduct.sku || '').trim().toLowerCase();
      const targetName = String(targetProduct.name || '').trim().toLowerCase();

      const entryProdId = String(entry.productId || entry.id || '').trim();
      if (targetId && entryProdId === targetId) return true;

      const entrySku = String(entry.sku || '').trim().toLowerCase();
      if (targetSku && entrySku && entrySku === targetSku) return true;

      const entryName = String(
        entry.productName || entry.name || entry.product || entry.groupName || ''
      )
        .trim()
        .toLowerCase();
      if (targetName && entryName && (entryName === targetName || entryName.includes(targetName))) {
        return true;
      }
      return false;
    },
    []
  );

  // Unified & deduplicated Incoming Stock / Purchase records from Firestore
  const unifiedIncomingRecords = useMemo(() => {
    const records: Array<{
      id: string;
      date: Date;
      totalAmount: number;
      totalUnits: number;
      items: Array<{
        productId?: string;
        sku?: string;
        productName?: string;
        qty: number;
        buyPrice: number;
        subtotal: number;
      }>;
    }> = [];
    const seenRefs = new Set<string>();

    // 1. Purchase Orders & Procurements (Primary Purchase Records)
    [...rawPurchaseOrders, ...rawProcurements].forEach((po) => {
      if (!po) return;
      const status = String(po.status || po.deliveryStatus || '').toLowerCase();
      if (status.includes('batal') || status.includes('cancel') || status.includes('reject')) {
        return;
      }
      const refId = String(po.poNumber || po.id || '');
      if (refId) seenRefs.add(refId);

      const poDate = parseRecordDate(po.createdAt || po.date || po.updatedAt);
      if (!poDate) return;

      const rawItems = Array.isArray(po.items) ? po.items : [];
      if (rawItems.length > 0) {
        const mappedItems = rawItems.map((it: any) => {
          const matchedProd =
            productLookup.byId.get(String(it.productId || '')) ||
            productLookup.bySku.get(String(it.sku || '').trim().toLowerCase()) ||
            productLookup.byName.get(String(it.productName || it.name || '').trim().toLowerCase());
          const qty = Math.max(
            1,
            Number(it.qty ?? it.cartons ?? it.addedUnits ?? it.quantity ?? 1)
          );
          const buyPrice = toIdrAmount(
            it.buyPrice ??
              it.contractPrice ??
              it.unitPrice ??
              it.costPrice ??
              matchedProd?.costPerUnit ??
              matchedProd?.costPrice ??
              0
          );
          const subtotal = toIdrAmount(it.subtotal ?? qty * buyPrice);
          return {
            productId: it.productId || matchedProd?.id,
            sku: it.sku || matchedProd?.sku,
            productName: it.productName || it.name || matchedProd?.name,
            qty,
            buyPrice,
            subtotal,
          };
        });
        const totalUnits = mappedItems.reduce((acc: number, it: any) => acc + it.qty, 0);
        const totalAmount =
          toIdrAmount(po.totalAmount ?? po.estimatedCost ?? 0) ||
          mappedItems.reduce((acc: number, it: any) => acc + it.subtotal, 0);

        records.push({
          id: refId || `po_${records.length}`,
          date: poDate,
          totalAmount,
          totalUnits,
          items: mappedItems,
        });
      } else {
        const matchedProd =
          productLookup.byId.get(String(po.productId || '')) ||
          productLookup.byName.get(
            String(po.productName || po.product || '').trim().toLowerCase()
          );
        const qty = Math.max(
          1,
          Number(po.cartons ?? po.totalUnits ?? po.itemsCount ?? po.qty ?? 1)
        );
        const unitCost = toIdrAmount(
          po.pricePerCarton ??
            po.buyPrice ??
            po.unitPrice ??
            matchedProd?.costPerUnit ??
            matchedProd?.costPrice ??
            0
        );
        const totalAmount =
          toIdrAmount(po.totalAmount ?? po.estimatedCost ?? 0) || qty * unitCost;

        records.push({
          id: refId || `po_${records.length}`,
          date: poDate,
          totalAmount,
          totalUnits: qty,
          items: [
            {
              productId: po.productId || matchedProd?.id,
              sku: po.sku || matchedProd?.sku,
              productName: po.productName || po.product || matchedProd?.name,
              qty,
              buyPrice: unitCost,
              subtotal: totalAmount,
            },
          ],
        });
      }
    });

    // 2. Stock Mutations, Stock Movements & Product Logs (Inflow / Barang Masuk not already in POs)
    [...rawStockMutations, ...rawStockMovements, ...rawProductLogs].forEach((log) => {
      if (!log) return;
      const rawType = String(log.type || log.movementType || log.direction || '').toUpperCase();
      const isMasuk =
        rawType === 'MASUK' ||
        rawType === 'IN' ||
        rawType === 'RESTOCK' ||
        rawType === 'PURCHASE' ||
        (Number(log.quantityChanged ?? 0) > 0 && rawType !== 'KELUAR');
      if (!isMasuk) return;

      const refId = String(log.reference || log.poNumber || log.docNumber || '');
      if (refId && seenRefs.has(refId)) return; // Avoid double counting POs that also wrote a stock_mutation
      if (log.id && seenRefs.has(String(log.id))) return;
      if (log.id) seenRefs.add(String(log.id));

      const logDate = parseRecordDate(log.createdAt || log.timestamp || log.date);
      if (!logDate) return;

      const matchedProd =
        productLookup.byId.get(String(log.productId || '')) ||
        productLookup.bySku.get(String(log.sku || '').trim().toLowerCase()) ||
        productLookup.byName.get(String(log.productName || log.name || '').trim().toLowerCase());

      const qty = Math.max(
        1,
        Math.abs(Number(log.qty ?? log.quantity ?? log.quantityChanged ?? log.addedUnits ?? 1))
      );
      const buyPrice = toIdrAmount(
        log.unitPrice ??
          log.buyPrice ??
          log.costPrice ??
          matchedProd?.costPerUnit ??
          matchedProd?.costPrice ??
          0
      );
      const totalAmount = toIdrAmount(log.totalValue ?? log.totalAmount ?? qty * buyPrice);

      records.push({
        id: String(log.id || `log_${records.length}`),
        date: logDate,
        totalAmount,
        totalUnits: qty,
        items: [
          {
            productId: log.productId || matchedProd?.id,
            sku: log.sku || matchedProd?.sku,
            productName: log.productName || log.name || matchedProd?.name,
            qty,
            buyPrice,
            subtotal: totalAmount,
          },
        ],
      });
    });

    return records;
  }, [
    rawPurchaseOrders,
    rawProcurements,
    rawStockMutations,
    rawStockMovements,
    rawProductLogs,
    productLookup,
  ]);

  // Core Builder: Generates time-bucketed ChartPoint[] and Summary Metrics for any selected Product ID ('ALL' or specific productId)
  const buildSeriesForProduct = useCallback(
    (selectedProductId: string) => {
      const now = new Date();
      const targetProd =
        selectedProductId !== 'ALL' ? productLookup.byId.get(selectedProductId) || null : null;

      // Active products for this filter
      const filteredProds = targetProd ? [targetProd] : liveProducts;

      // Current live inventory valuation from Firestore products
      let currentStockUnits = 0;
      let currentAssetCost = 0;
      let currentAssetRetail = 0;
      let unitRetailWeighted = 0;
      let unitCostWeighted = 0;

      filteredProds.forEach((p) => {
        if (p.isActive === false) return;
        const units = Math.max(0, Number(p.stockInUnits ?? p.stock ?? p.totalUnits ?? 0));
        const costUnit = toIdrAmount(p.costPerUnit ?? p.costPrice ?? p.modalCost ?? p.modal ?? 0);
        const priceUnit = toIdrAmount(
          p.posPrice ?? p.pricePerUnit ?? p.sellPrice ?? p.price ?? p.pricePerCarton ?? 0
        );
        currentStockUnits += units;
        currentAssetCost += units * costUnit;
        currentAssetRetail += units * priceUnit;
      });

      if (targetProd) {
        unitCostWeighted = toIdrAmount(
          targetProd.costPerUnit ?? targetProd.costPrice ?? targetProd.modalCost ?? 0
        );
        unitRetailWeighted = toIdrAmount(
          targetProd.posPrice ??
            targetProd.pricePerUnit ??
            targetProd.sellPrice ??
            targetProd.pricePerCarton ??
            0
        );
      } else if (currentStockUnits > 0) {
        unitCostWeighted = Math.round(currentAssetCost / currentStockUnits);
        unitRetailWeighted = Math.round(currentAssetRetail / currentStockUnits);
      }

      // Build time buckets (Hourly for 'today'/'yesterday', Daily for '7d'/'14d'/'30d'/'month', Monthly for 'year')
      const buckets: Array<{
        date: string;
        label: string;
        start: Date;
        end: Date;
      }> = [];

      const isHourlyMode = timeframe === 'today' || timeframe === 'yesterday';

      if (isHourlyMode) {
        const targetDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (timeframe === 'yesterday') {
          targetDay.setDate(targetDay.getDate() - 1);
        }
        const dayLabelPrefix = targetDay.toLocaleDateString('id-ID', {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
        });

        for (let hr = 0; hr < 24; hr++) {
          const bucketStart = new Date(
            targetDay.getFullYear(),
            targetDay.getMonth(),
            targetDay.getDate(),
            hr,
            0,
            0,
            0
          );
          const bucketEnd = new Date(
            targetDay.getFullYear(),
            targetDay.getMonth(),
            targetDay.getDate(),
            hr,
            59,
            59,
            999
          );
          const hourStr = `${String(hr).padStart(2, '0')}:00`;
          buckets.push({
            date: hourStr,
            label: `${dayLabelPrefix} • ${hourStr} WIB`,
            start: bucketStart,
            end: bucketEnd,
          });
        }
      } else {
        const pointsCount =
          timeframe === '7d'
            ? 7
            : timeframe === '14d'
            ? 14
            : timeframe === '30d'
            ? 30
            : timeframe === 'month'
            ? Math.max(1, now.getDate())
            : 12;

        for (let i = pointsCount - 1; i >= 0; i--) {
          const d = new Date(now);
          let bucketStart: Date;
          let bucketEnd: Date;

          if (timeframe === 'year') {
            d.setMonth(d.getMonth() - i, 1);
            bucketStart = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
            bucketEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
          } else {
            d.setDate(d.getDate() - i);
            bucketStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
            bucketEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
          }

          const dateStr =
            timeframe === 'year'
              ? bucketStart.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' })
              : bucketStart.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });

          const dayName =
            timeframe === 'year'
              ? bucketStart.toLocaleDateString('id-ID', { month: 'long' })
              : bucketStart.toLocaleDateString('id-ID', { weekday: 'short' });

          buckets.push({
            date: dateStr,
            label: `${dayName}, ${dateStr}`,
            start: bucketStart,
            end: bucketEnd,
          });
        }
      }

      // Populate sales & purchase metrics for each bucket
      const rawPoints: ChartPoint[] = buckets.map((b) => {
        let penjualan = 0;
        let penjualanCost = 0;
        let penjualanUnits = 0;
        let transaksiCount = 0;

        liveTransactions.forEach((tx) => {
          const status = String(tx.status || 'completed').toLowerCase();
          if (
            status === 'rejected' ||
            status === 'cancelled' ||
            status === 'void' ||
            status === 'refunded' ||
            status === 'dibatalkan'
          ) {
            return;
          }

          // Outlet filter matching AdminDashboard
          if (selectedOutlet && selectedOutlet !== 'all') {
            const rawOutlet = String(tx.outletId || tx.storeId || '').toLowerCase();
            if (selectedOutlet === 'pusat') {
              const isMainOutlet =
                !rawOutlet ||
                rawOutlet === 'pusat' ||
                rawOutlet === 'out-01' ||
                rawOutlet === 'out_1' ||
                rawOutlet === 'out-1' ||
                rawOutlet === ACTIVE_STORE_ID.toLowerCase();
              if (!isMainOutlet) return;
            } else if (rawOutlet && rawOutlet !== selectedOutlet.toLowerCase()) {
              return;
            }
          }

          const txDate = parseRecordDate(tx.createdAt || tx.timestamp || tx.date || tx.updatedAt);
          if (!txDate || txDate < b.start || txDate > b.end) return;

          const items: any[] =
            Array.isArray(tx.items) && tx.items.length > 0
              ? tx.items
              : externalSubItemsMap[tx.id] || [];

          if (targetProd) {
            // Filter specifically for the chosen product
            let matchedInTx = false;
            items.forEach((it: any) => {
              if (!matchesTargetProduct(it, targetProd)) return;
              matchedInTx = true;
              const q = Math.max(
                1,
                Number(it.unitsDeducted ?? it.quantityOrdered ?? it.quantity ?? it.qty ?? 1)
              );
              const unitSell = toIdrAmount(
                it.price ??
                  it.unitPrice ??
                  it.sellingPrice ??
                  it.posPrice ??
                  targetProd.posPrice ??
                  targetProd.pricePerUnit ??
                  0
              );
              const itemRev = toIdrAmount(it.subtotal ?? q * unitSell);
              const unitCost = toIdrAmount(
                it.costPrice ??
                  it.unitCost ??
                  targetProd.costPerUnit ??
                  targetProd.costPrice ??
                  0
              );
              penjualan += itemRev;
              penjualanCost += q * unitCost;
              penjualanUnits += q;
            });

            if (matchedInTx) {
              transaksiCount += 1;
            }
          } else {
            // All Products ('ALL')
            const txTotal = toIdrAmount(tx.totalAmount ?? tx.total ?? tx.subtotal ?? 0);
            let txCost = toIdrAmount(tx.totalCost ?? tx.totalModal ?? 0);
            let txQty = 0;

            if (items.length > 0) {
              let computedCost = 0;
              items.forEach((it: any) => {
                const q = Math.max(
                  1,
                  Number(it.unitsDeducted ?? it.quantityOrdered ?? it.quantity ?? it.qty ?? 1)
                );
                txQty += q;
                const matchedP =
                  productLookup.byId.get(String(it.productId || '')) ||
                  productLookup.byName.get(
                    String(it.productName || it.name || '').trim().toLowerCase()
                  );
                const itemCost = toIdrAmount(
                  it.costPrice ?? it.unitCost ?? matchedP?.costPerUnit ?? matchedP?.costPrice ?? 0
                );
                computedCost += itemCost * q;
              });
              if (txCost <= 0 && computedCost > 0) txCost = computedCost;
            } else {
              txQty = Math.max(1, Number(tx.itemsCount ?? 1));
            }

            penjualan += txTotal;
            penjualanCost += txCost;
            penjualanUnits += txQty;
            transaksiCount += 1;
          }
        });

        let pembelian = 0;
        let pembelianUnits = 0;
        let poCount = 0;

        unifiedIncomingRecords.forEach((rec) => {
          if (rec.date < b.start || rec.date > b.end) return;

          if (targetProd) {
            let matchedInPo = false;
            rec.items.forEach((it) => {
              if (!matchesTargetProduct(it, targetProd)) return;
              matchedInPo = true;
              const q = Math.max(1, Number(it.qty || 1));
              const sub =
                toIdrAmount(it.subtotal) ||
                q *
                  (toIdrAmount(it.buyPrice) ||
                    toIdrAmount(targetProd.costPerUnit ?? targetProd.costPrice ?? 0));
              pembelian += sub;
              pembelianUnits += q;
            });
            if (matchedInPo) {
              poCount += 1;
            }
          } else {
            pembelian += rec.totalAmount;
            pembelianUnits += rec.totalUnits;
            poCount += 1;
          }
        });

        return {
          date: b.date,
          label: b.label,
          penjualan,
          penjualanCost,
          penjualanProfit: Math.max(0, penjualan - penjualanCost),
          penjualanUnits,
          transaksiCount,
          assetTotal: currentAssetRetail,
          assetCost: currentAssetCost,
          assetUnits: currentStockUnits,
          pembelian,
          pembelianUnits,
          poCount,
          stokUnits: currentStockUnits,
        };
      });

      // Reconstruct dynamic historical stock trajectory backward from current live stock
      // so Chart 2 (Asset Produk) and Chart 4 (Garis 1 — Stok) reflect real stock changes when goods enter or sell!
      let runningStockAfterBucket = currentStockUnits;
      for (let idx = rawPoints.length - 1; idx >= 0; idx--) {
        const pt = rawPoints[idx];
        const bucketStock = Math.max(0, runningStockAfterBucket);
        pt.stokUnits = bucketStock;
        pt.assetUnits = bucketStock;
        if (bucketStock === currentStockUnits) {
          pt.assetTotal = currentAssetRetail;
          pt.assetCost = currentAssetCost;
        } else {
          pt.assetTotal = Math.max(0, Math.round(bucketStock * unitRetailWeighted));
          pt.assetCost = Math.max(0, Math.round(bucketStock * unitCostWeighted));
        }
        // Before this bucket: stock_before = stock_after - barangMasuk + penjualan
        const netDelta = pt.pembelianUnits - pt.penjualanUnits;
        runningStockAfterBucket = Math.max(0, runningStockAfterBucket - netDelta);
      }

      // Compute summary metrics for this series
      const totalPenjualan = rawPoints.reduce((acc, p) => acc + p.penjualan, 0);
      const totalPenjualanCost = rawPoints.reduce((acc, p) => acc + p.penjualanCost, 0);
      const totalPenjualanProfit = Math.max(0, totalPenjualan - totalPenjualanCost);
      const grossMarginPct =
        totalPenjualan > 0 ? Number(((totalPenjualanProfit / totalPenjualan) * 100).toFixed(1)) : 0;

      const activeBucketsCount = Math.max(1, rawPoints.length);
      const avgPenjualanBucket = Math.round(totalPenjualan / activeBucketsCount);
      const maxPenjualanPoint = [...rawPoints].sort((a, b) => b.penjualan - a.penjualan)[0];

      const assetProfitPotential = Math.max(0, currentAssetRetail - currentAssetCost);

      const totalPembelian = rawPoints.reduce((acc, p) => acc + p.pembelian, 0);
      const totalPO = rawPoints.reduce((acc, p) => acc + p.poCount, 0);
      const maxPembelianPoint = [...rawPoints].sort((a, b) => b.pembelian - a.pembelian)[0];

      const totalUnitsSold = rawPoints.reduce((acc, p) => acc + p.penjualanUnits, 0);
      const totalUnitsBought = rawPoints.reduce((acc, p) => acc + p.pembelianUnits, 0);
      const totalTxCount = rawPoints.reduce((acc, p) => acc + p.transaksiCount, 0);

      const stockToSalesRatio =
        currentStockUnits > 0 ? (totalUnitsSold / currentStockUnits).toFixed(2) : '0.00';
      const avgUnitsPerDay =
        timeframe === 'today' || timeframe === 'yesterday'
          ? totalUnitsSold
          : totalUnitsSold / Math.max(1, rawPoints.length);
      const estimatedStockDays =
        avgUnitsPerDay > 0
          ? Math.round(currentStockUnits / avgUnitsPerDay)
          : currentStockUnits > 0
          ? 30
          : 0;
      const annualizedTurnover =
        currentAssetCost > 0 && totalPenjualanCost > 0
          ? Number(((totalPenjualanCost / currentAssetCost) * 12).toFixed(1))
          : 0;

      return {
        points: rawPoints,
        targetProd,
        metrics: {
          totalPenjualan,
          totalPenjualanCost,
          totalPenjualanProfit,
          grossMarginPct,
          avgPenjualanHarian: avgPenjualanBucket,
          maxPenjualanPoint,
          currentAssetTotal: currentAssetRetail,
          currentAssetCost,
          assetProfitPotential,
          currentStockUnits,
          totalPembelian,
          totalPO,
          maxPembelianPoint,
          totalUnitsSold,
          totalUnitsBought,
          totalTxCount,
          stockToSalesRatio,
          estimatedStockDays,
          annualizedTurnover,
        },
      };
    },
    [
      timeframe,
      liveProducts,
      liveTransactions,
      unifiedIncomingRecords,
      productLookup,
      selectedOutlet,
      externalSubItemsMap,
      matchesTargetProduct,
    ]
  );

  // Build real-time datasets for Global Overview ('ALL') and for each of the 4 Chart Boxes
  const globalBundle = useMemo(() => buildSeriesForProduct('ALL'), [buildSeriesForProduct]);
  const salesBundle = useMemo(
    () =>
      selectedProductSales === 'ALL'
        ? globalBundle
        : buildSeriesForProduct(selectedProductSales),
    [selectedProductSales, globalBundle, buildSeriesForProduct]
  );
  const assetBundle = useMemo(
    () =>
      selectedProductAsset === 'ALL'
        ? globalBundle
        : buildSeriesForProduct(selectedProductAsset),
    [selectedProductAsset, globalBundle, buildSeriesForProduct]
  );
  const purchaseBundle = useMemo(
    () =>
      selectedProductPurchase === 'ALL'
        ? globalBundle
        : buildSeriesForProduct(selectedProductPurchase),
    [selectedProductPurchase, globalBundle, buildSeriesForProduct]
  );
  const compareBundle = useMemo(
    () =>
      selectedProductCompare === 'ALL'
        ? globalBundle
        : buildSeriesForProduct(selectedProductCompare),
    [selectedProductCompare, globalBundle, buildSeriesForProduct]
  );

  const summaryMetrics = globalBundle.metrics;

  // Helper to generate SVG Area & Line Path with dynamic YAxis ticks
  const generatePath = (
    values: number[],
    width = 720,
    height = 220,
    paddingTop = 20,
    paddingBottom = 25,
    paddingLeft = 64,
    paddingRight = 20,
    explicitMaxVal?: number
  ) => {
    if (values.length === 0) {
      return { linePath: '', areaPath: '', points: [], maxVal: 1, yTicks: [] };
    }

    const minVal = 0;
    const rawMax = explicitMaxVal !== undefined ? explicitMaxVal : Math.max(...values, 0);
    const maxVal = rawMax > 0 ? rawMax * 1.12 : 4;

    const usableWidth = width - paddingLeft - paddingRight;
    const usableHeight = height - paddingTop - paddingBottom;
    const stepX = usableWidth / (values.length - 1 || 1);

    const points = values.map((val, idx) => {
      const x = paddingLeft + idx * stepX;
      const normalizedY = Math.min(1, Math.max(0, (val - minVal) / (maxVal - minVal || 1)));
      const y = height - paddingBottom - normalizedY * usableHeight;
      return { x, y, val };
    });

    const yTicks = [1, 0.75, 0.5, 0.25, 0].map((ratio) => {
      const tickVal = Math.round(rawMax > 0 ? maxVal * ratio : 0);
      const y = height - paddingBottom - ratio * usableHeight;
      return { ratio, y, val: tickVal };
    });

    if (curveType === 'linear' || points.length < 3) {
      const linePath = points.reduce(
        (acc, pt, idx) => (idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`),
        ''
      );
      const firstX = points[0].x;
      const lastX = points[points.length - 1].x;
      const baselineY = height - paddingBottom;
      const areaPath = `${linePath} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;
      return { linePath, areaPath, points, maxVal, yTicks };
    }

    let linePath = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = i > 0 ? points[i - 1] : points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = i < points.length - 2 ? points[i + 2] : p2;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = Math.min(
        height - paddingBottom,
        Math.max(paddingTop, p1.y + (p2.y - p0.y) / 6)
      );
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = Math.min(
        height - paddingBottom,
        Math.max(paddingTop, p2.y - (p3.y - p1.y) / 6)
      );

      linePath += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }

    const firstX = points[0].x;
    const lastX = points[points.length - 1].x;
    const baselineY = height - paddingBottom;
    const areaPath = `${linePath} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;

    return { linePath, areaPath, points, maxVal, yTicks };
  };

  // Handle SVG mouse movement to find nearest data point index
  const handleSvgMouseMove = (
    e: React.MouseEvent<SVGSVGElement>,
    chartId: string,
    pointsLength: number
  ) => {
    if (pointsLength <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clientX / rect.width));
    const targetIdx = Math.min(
      pointsLength - 1,
      Math.max(0, Math.round(ratio * (pointsLength - 1)))
    );

    setHoveredIndex(targetIdx);
    setHoveredChart(chartId);
  };

  const handleSvgMouseLeave = () => {
    setHoveredIndex(null);
    setHoveredChart(null);
  };

  // Currency Formatters reactive to global IDR <-> USD switcher
  const formatRupiah = (val: number) => {
    return formatMoney(val, activeCurrency, 'IDR', activeExchangeRate);
  };

  const formatShortRupiah = (val: number) => {
    return formatCompactMoney(val, activeCurrency, 'IDR', activeExchangeRate);
  };

  // Reusable Product Filter Dropdown Component for each Chart Box Header
  const renderProductSelectDropdown = (
    selectedValue: string,
    onChangeValue: (val: string) => void,
    accentBorderClass: string
  ) => (
    <div className="relative flex items-center">
      <Package className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 pointer-events-none" />
      <select
        value={selectedValue}
        onChange={(e) => onChangeValue(e.target.value)}
        aria-label="Filter Produk Grafik"
        className={`pl-8 pr-7 py-1.5 rounded-xl bg-zinc-900/95 text-zinc-100 text-xs font-semibold border border-zinc-800 ${accentBorderClass} focus:outline-none transition cursor-pointer max-w-[190px] sm:max-w-[220px] truncate`}
      >
        <option value="ALL">Semua Produk ({liveProducts.length})</option>
        {liveProducts.map((p) => {
          const stk = Math.max(0, Number(p.stockInUnits ?? p.stock ?? 0));
          return (
            <option key={p.id} value={p.id}>
              {p.name} ({stk} Dus)
            </option>
          );
        })}
      </select>
    </div>
  );

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-3xl p-5 sm:p-6 space-y-6 shadow-2xl relative overflow-hidden backdrop-blur-md">
      {/* Decorative background glow */}
      <div className="absolute -top-24 -right-24 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* TOP HEADER & CONTROLS */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              Pusat Analitik Bisnis
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-emerald-400">
              Live Realtime Firestore ({activeCurrency})
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white mt-1 tracking-tight flex items-center gap-2">
            Visualisasi 4 Area Chart Line Ekosistem
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">
            Monitoring real-time Penjualan, Asset Produk, Pembelian, serta Stok vs Barang Masuk vs Penjualan dengan filter per produk.
          </p>
        </div>

        {/* Global Chart Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Timeframe Filter */}
          <div className="flex items-center bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs font-semibold flex-wrap">
            <button
              onClick={() => setTimeframe('today')}
              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                timeframe === 'today' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Hari Ini (Jam)
            </button>
            <button
              onClick={() => setTimeframe('7d')}
              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                timeframe === '7d' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              7 Hari
            </button>
            <button
              onClick={() => setTimeframe('14d')}
              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                timeframe === '14d' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              14 Hari
            </button>
            <button
              onClick={() => setTimeframe('month')}
              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                timeframe === 'month' || timeframe === '30d'
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Bulan Ini
            </button>
            <button
              onClick={() => setTimeframe('year')}
              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                timeframe === 'year' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Tahunan
            </button>
          </div>

          {/* Curve Tension Selector */}
          <button
            onClick={() => setCurveType(curveType === 'smooth' ? 'linear' : 'smooth')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold border border-zinc-800 transition cursor-pointer"
            title="Ubah gaya kurva: Halus (Spline) atau Poligon Sudut (Linear)"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            <span>Kurva: {curveType === 'smooth' ? 'Halus' : 'Linear'}</span>
          </button>
        </div>
      </div>

      {/* CHART NAVIGATION TABS */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-bold scrollbar-none">
        <button
          onClick={() => setActiveTab('all')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl transition cursor-pointer shrink-0 ${
            activeTab === 'all'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
              : 'bg-zinc-950/80 text-zinc-400 hover:text-white border border-zinc-800'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Semua Chart (Grid 4)</span>
        </button>

        <button
          onClick={() => setActiveTab('penjualan')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl transition cursor-pointer shrink-0 ${
            activeTab === 'penjualan'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
              : 'bg-zinc-950/80 text-zinc-400 hover:text-white border border-zinc-800'
          }`}
        >
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <span>1. Area Chart Line Penjualan</span>
        </button>

        <button
          onClick={() => setActiveTab('asset')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl transition cursor-pointer shrink-0 ${
            activeTab === 'asset'
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/20'
              : 'bg-zinc-950/80 text-zinc-400 hover:text-white border border-zinc-800'
          }`}
        >
          <Boxes className="w-4 h-4 text-purple-400" />
          <span>2. Area Chart Line Asset Produk</span>
        </button>

        <button
          onClick={() => setActiveTab('pembelian')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl transition cursor-pointer shrink-0 ${
            activeTab === 'pembelian'
              ? 'bg-amber-600 text-white shadow-lg shadow-amber-600/20'
              : 'bg-zinc-950/80 text-zinc-400 hover:text-white border border-zinc-800'
          }`}
        >
          <Truck className="w-4 h-4 text-amber-400" />
          <span>3. Area Chart Line Pembelian</span>
        </button>

        <button
          onClick={() => setActiveTab('stok_vs_sales')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl transition cursor-pointer shrink-0 ${
            activeTab === 'stok_vs_sales'
              ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/20'
              : 'bg-zinc-950/80 text-zinc-400 hover:text-white border border-zinc-800'
          }`}
        >
          <BarChart3 className="w-4 h-4 text-cyan-400" />
          <span>4. Area Chart Line : Stok vs Barang Masuk vs Penjualan</span>
        </button>
      </div>

      {/* QUICK KPI TILES FOR ALL 4 CHARTS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* KPI 1: Penjualan */}
        <div
          onClick={() => setActiveTab('penjualan')}
          className="bg-zinc-950/80 border border-zinc-800/90 hover:border-emerald-500/40 p-4 rounded-2xl cursor-pointer transition group"
        >
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
            <span className="font-semibold flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              Total Penjualan
            </span>
            <span className="text-[11px] font-mono text-emerald-400">
              {salesBundle.targetProd ? salesBundle.targetProd.name : 'Semua Produk'}
            </span>
          </div>
          <div className="text-lg sm:text-xl font-black text-white font-mono tracking-tight group-hover:text-emerald-300 transition">
            {formatRupiah(salesBundle.metrics.totalPenjualan)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1 flex items-center justify-between">
            <span>
              Rata2: {formatShortRupiah(salesBundle.metrics.avgPenjualanHarian)}/
              {timeframe === 'today' || timeframe === 'yesterday' ? 'jam' : 'hari'}
            </span>
            <span className="text-emerald-400 font-semibold">
              {salesBundle.metrics.totalUnitsSold} Dus Terjual
            </span>
          </div>
        </div>

        {/* KPI 2: Asset Produk */}
        <div
          onClick={() => setActiveTab('asset')}
          className="bg-zinc-950/80 border border-zinc-800/90 hover:border-purple-500/40 p-4 rounded-2xl cursor-pointer transition group"
        >
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
            <span className="font-semibold flex items-center gap-1.5">
              <Boxes className="w-3.5 h-3.5 text-purple-400" />
              Valuasi Aset Produk
            </span>
            <span className="text-[11px] font-mono text-purple-400">
              {assetBundle.targetProd ? assetBundle.targetProd.name : 'Semua Produk'}
            </span>
          </div>
          <div className="text-lg sm:text-xl font-black text-white font-mono tracking-tight group-hover:text-purple-300 transition">
            {formatRupiah(assetBundle.metrics.currentAssetTotal)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1 flex items-center justify-between">
            <span>HPP: {formatShortRupiah(assetBundle.metrics.currentAssetCost)}</span>
            <span className="text-purple-400 font-semibold">
              Margin{' '}
              {assetBundle.metrics.currentAssetTotal > 0
                ? Math.round(
                    ((assetBundle.metrics.currentAssetTotal - assetBundle.metrics.currentAssetCost) /
                      assetBundle.metrics.currentAssetTotal) *
                      100
                  )
                : 0}
              %
            </span>
          </div>
        </div>

        {/* KPI 3: Pembelian Supplier */}
        <div
          onClick={() => setActiveTab('pembelian')}
          className="bg-zinc-950/80 border border-zinc-800/90 hover:border-amber-500/40 p-4 rounded-2xl cursor-pointer transition group"
        >
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
            <span className="font-semibold flex items-center gap-1.5">
              <Truck className="w-3.5 h-3.5 text-amber-400" />
              Total Pembelian
            </span>
            <span className="text-[11px] font-mono text-amber-400">
              {purchaseBundle.targetProd ? purchaseBundle.targetProd.name : 'Semua Produk'}
            </span>
          </div>
          <div className="text-lg sm:text-xl font-black text-white font-mono tracking-tight group-hover:text-amber-300 transition">
            {formatRupiah(purchaseBundle.metrics.totalPembelian)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1 flex items-center justify-between">
            <span>Barang Masuk: {purchaseBundle.metrics.totalUnitsBought} Dus</span>
            <span className="text-amber-400 font-semibold">
              {purchaseBundle.metrics.totalPO} Faktur/Log
            </span>
          </div>
        </div>

        {/* KPI 4: Stok vs Barang Masuk vs Penjualan */}
        <div
          onClick={() => setActiveTab('stok_vs_sales')}
          className="bg-zinc-950/80 border border-zinc-800/90 hover:border-cyan-500/40 p-4 rounded-2xl cursor-pointer transition group"
        >
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
            <span className="font-semibold flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
              Stok vs Masuk vs Jual
            </span>
            <span className="text-[11px] font-mono text-cyan-400">
              {compareBundle.targetProd ? compareBundle.targetProd.name : 'Semua Produk'}
            </span>
          </div>
          <div className="text-lg sm:text-xl font-black text-white font-mono tracking-tight group-hover:text-cyan-300 transition">
            {compareBundle.metrics.currentStockUnits.toLocaleString('id-ID')} Dus
          </div>
          <div className="text-[11px] text-zinc-500 mt-1 flex items-center justify-between">
            <span>Masuk: +{compareBundle.metrics.totalUnitsBought} Dus</span>
            <span className="text-emerald-400 font-semibold">
              Terjual: {compareBundle.metrics.totalUnitsSold} Dus
            </span>
          </div>
        </div>
      </div>

      {/* 4 AREA CHARTS CONTAINER GRID (2x2 Symmetric Grid on Desktop) */}
      <div
        className={`grid gap-6 ${
          activeTab === 'all' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
        }`}
      >
        {/* ========================================================= */}
        {/* CHART 1: AREA CHART LINE PENJUALAN                        */}
        {/* ========================================================= */}
        {(activeTab === 'all' || activeTab === 'penjualan') && (
          <div className="bg-zinc-950/70 border border-zinc-800/90 p-5 rounded-2xl space-y-4 hover:border-emerald-500/30 transition relative flex flex-col justify-between">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    1. Area Chart Line Penjualan
                  </h3>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Tren nilai penjualan/omzet &amp; qty terjual dari transaksi Mesin Kasir POS &amp; PWA
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3">
                {renderProductSelectDropdown(
                  selectedProductSales,
                  setSelectedProductSales,
                  'hover:border-emerald-500/40 focus:border-emerald-500'
                )}
                <div className="text-right">
                  <span className="text-[10px] font-mono text-zinc-400 block">
                    Total Omzet ({salesBundle.targetProd ? salesBundle.targetProd.name : 'Semua'})
                  </span>
                  <div className="text-sm sm:text-base font-black text-emerald-400 font-mono">
                    {formatRupiah(salesBundle.metrics.totalPenjualan)}
                  </div>
                </div>
              </div>
            </div>

            {/* SVG Area Chart 1 */}
            {(() => {
              const svgWidth = 720;
              const svgHeight = 220;
              const seriesPoints = salesBundle.points;
              const { linePath, areaPath, points, yTicks } = generatePath(
                seriesPoints.map((d) => d.penjualan),
                svgWidth,
                svgHeight
              );
              const hoveredPt =
                hoveredChart === 'penjualan' && hoveredIndex !== null
                  ? seriesPoints[hoveredIndex] || null
                  : null;

              return (
                <div className="relative pt-2">
                  <svg
                    viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                    className="w-full h-48 sm:h-56 overflow-visible cursor-crosshair select-none"
                    onMouseMove={(e) => handleSvgMouseMove(e, 'penjualan', seriesPoints.length)}
                    onMouseLeave={handleSvgMouseLeave}
                  >
                    <defs>
                      <linearGradient id="area-gradient-sales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity="0.45" />
                        <stop offset="60%" stopColor="#059669" stopOpacity="0.15" />
                        <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                      </linearGradient>
                      <linearGradient id="line-gradient-sales" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#34d399" />
                        <stop offset="50%" stopColor="#10b981" />
                        <stop offset="100%" stopColor="#06b6d4" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal Grid lines & Dynamic YAxis Labels (IDR / USD) */}
                    {yTicks.map((tick) => (
                      <g key={tick.ratio}>
                        <line
                          x1="64"
                          y1={tick.y}
                          x2={svgWidth - 20}
                          y2={tick.y}
                          stroke="#27272a"
                          strokeDasharray="4 4"
                          strokeWidth="1"
                        />
                        <text
                          x="58"
                          y={tick.y + 3}
                          textAnchor="end"
                          className="fill-zinc-500 text-[10px] font-mono"
                        >
                          {formatShortRupiah(tick.val)}
                        </text>
                      </g>
                    ))}

                    {/* Filled Area */}
                    <path d={areaPath} fill="url(#area-gradient-sales)" />

                    {/* Smooth Stroke Line */}
                    <path
                      d={linePath}
                      fill="none"
                      stroke="url(#line-gradient-sales)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {/* Data Points */}
                    {points.map((pt, idx) => (
                      <circle
                        key={idx}
                        cx={pt.x}
                        cy={pt.y}
                        r={hoveredIndex === idx && hoveredChart === 'penjualan' ? 6 : 3}
                        className="transition-all duration-150"
                        fill="#09090b"
                        stroke="#10b981"
                        strokeWidth="2.5"
                      />
                    ))}

                    {/* Active Hover Crosshair Line */}
                    {hoveredChart === 'penjualan' &&
                      hoveredIndex !== null &&
                      points[hoveredIndex] && (
                        <g>
                          <line
                            x1={points[hoveredIndex].x}
                            y1="15"
                            x2={points[hoveredIndex].x}
                            y2={svgHeight - 25}
                            stroke="#34d399"
                            strokeWidth="1.5"
                            strokeDasharray="3 3"
                          />
                          <circle
                            cx={points[hoveredIndex].x}
                            cy={points[hoveredIndex].y}
                            r="8"
                            fill="#10b981"
                            fillOpacity="0.3"
                          />
                          <circle
                            cx={points[hoveredIndex].x}
                            cy={points[hoveredIndex].y}
                            r="4"
                            fill="#ffffff"
                          />
                        </g>
                      )}
                  </svg>

                  {/* Floating Tooltip Box */}
                  {hoveredPt && (
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-zinc-900/95 border border-emerald-500/40 p-3 rounded-xl shadow-2xl text-xs z-20 pointer-events-none min-w-[230px]">
                      <div className="font-bold text-white flex items-center justify-between border-b border-zinc-800 pb-1.5 mb-1.5 gap-3">
                        <span>{hoveredPt.label}</span>
                        <span className="text-[10px] text-emerald-400 font-mono truncate max-w-[110px]">
                          {salesBundle.targetProd ? salesBundle.targetProd.name : 'Semua Produk'}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-zinc-400">Nilai Penjualan:</span>
                          <span className="font-mono font-black text-emerald-400">
                            {formatRupiah(hoveredPt.penjualan)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-zinc-400">Qty Terjual:</span>
                          <span className="font-mono text-zinc-200 font-bold">
                            {hoveredPt.penjualanUnits} Dus
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-zinc-400">Laba Kotor:</span>
                          <span className="font-mono text-teal-400 font-semibold">
                            {formatRupiah(hoveredPt.penjualanProfit)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-zinc-400">Struk / Pesanan:</span>
                          <span className="font-mono text-zinc-200">
                            {hoveredPt.transaksiCount} Transaksi
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* X Axis Labels */}
                  <div className="flex items-center justify-between pl-14 pr-2 pt-1 text-[11px] font-mono text-zinc-400">
                    <span>{seriesPoints[0]?.date}</span>
                    <span>{seriesPoints[Math.floor(seriesPoints.length / 2)]?.date}</span>
                    <span>{seriesPoints[seriesPoints.length - 1]?.date}</span>
                  </div>
                </div>
              );
            })()}

            {/* Sub-insights footer */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 text-xs border-t border-zinc-800/80">
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-zinc-500 block text-[10px]">
                  {timeframe === 'today' || timeframe === 'yesterday'
                    ? 'Jam Penjualan Tertinggi'
                    : 'Titik Penjualan Tertinggi'}
                </span>
                <span className="font-bold text-white font-mono text-[11px]">
                  {salesBundle.metrics.maxPenjualanPoint &&
                  salesBundle.metrics.maxPenjualanPoint.penjualan > 0
                    ? `${salesBundle.metrics.maxPenjualanPoint.date} (${formatShortRupiah(
                        salesBundle.metrics.maxPenjualanPoint.penjualan
                      )})`
                    : formatRupiah(0)}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-zinc-500 block text-[10px]">
                  Qty Terjual ({salesBundle.targetProd ? 'Produk' : 'Total'})
                </span>
                <span className="font-bold text-emerald-400 font-mono text-[11px]">
                  {salesBundle.metrics.totalUnitsSold} Dus ({salesBundle.metrics.totalTxCount} Struk)
                </span>
              </div>
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800 col-span-2 sm:col-span-1">
                <span className="text-zinc-500 block text-[10px]">Laba Kotor &amp; Margin</span>
                <span className="font-bold text-blue-400 font-mono text-[11px]">
                  {formatShortRupiah(salesBundle.metrics.totalPenjualanProfit)} (
                  {salesBundle.metrics.grossMarginPct}%)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* CHART 2: AREA CHART LINE ASSET PRODUK                     */}
        {/* ========================================================= */}
        {(activeTab === 'all' || activeTab === 'asset') && (
          <div className="bg-zinc-950/70 border border-zinc-800/90 p-5 rounded-2xl space-y-4 hover:border-purple-500/30 transition relative flex flex-col justify-between">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-400 shadow-sm shadow-purple-400/50" />
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    2. Area Chart Line Asset Produk
                  </h3>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Valuasi nilai aset produk (Stok × Harga Jual Retail vs Stok × Harga Modal HPP)
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3">
                {renderProductSelectDropdown(
                  selectedProductAsset,
                  setSelectedProductAsset,
                  'hover:border-purple-500/40 focus:border-purple-500'
                )}
                <div className="text-right">
                  <span className="text-[10px] font-mono text-zinc-400 block">
                    Valuasi Retail ({assetBundle.targetProd ? assetBundle.targetProd.name : 'Semua'})
                  </span>
                  <div className="text-sm sm:text-base font-black text-purple-400 font-mono">
                    {formatRupiah(assetBundle.metrics.currentAssetTotal)}
                  </div>
                </div>
              </div>
            </div>

            {/* SVG Area Chart 2 */}
            {(() => {
              const svgWidth = 720;
              const svgHeight = 220;
              const seriesPoints = assetBundle.points;
              const sharedMaxAsset = Math.max(
                ...seriesPoints.map((d) => Math.max(d.assetTotal, d.assetCost)),
                0
              );
              const { linePath, areaPath, points, yTicks } = generatePath(
                seriesPoints.map((d) => d.assetTotal),
                svgWidth,
                svgHeight,
                20,
                25,
                64,
                20,
                sharedMaxAsset
              );

              // Secondary line for HPP (Cost) on the exact same Y-axis scale
              const costPaths = generatePath(
                seriesPoints.map((d) => d.assetCost),
                svgWidth,
                svgHeight,
                20,
                25,
                64,
                20,
                sharedMaxAsset
              );

              const hoveredPt =
                hoveredChart === 'asset' && hoveredIndex !== null
                  ? seriesPoints[hoveredIndex] || null
                  : null;

              return (
                <div className="relative pt-2">
                  <svg
                    viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                    className="w-full h-48 sm:h-56 overflow-visible cursor-crosshair select-none"
                    onMouseMove={(e) => handleSvgMouseMove(e, 'asset', seriesPoints.length)}
                    onMouseLeave={handleSvgMouseLeave}
                  >
                    <defs>
                      <linearGradient id="area-gradient-asset" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.4" />
                        <stop offset="60%" stopColor="#d97706" stopOpacity="0.15" />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                      </linearGradient>
                      <linearGradient id="line-gradient-asset" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#fde68a" />
                        <stop offset="50%" stopColor="#fbbf24" />
                        <stop offset="100%" stopColor="#f59e0b" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal Grid lines & Dynamic YAxis Labels (IDR / USD) */}
                    {yTicks.map((tick) => (
                      <g key={tick.ratio}>
                        <line
                          x1="64"
                          y1={tick.y}
                          x2={svgWidth - 20}
                          y2={tick.y}
                          stroke="#262013"
                          strokeDasharray="4 4"
                          strokeWidth="1"
                        />
                        <text
                          x="58"
                          y={tick.y + 3}
                          textAnchor="end"
                          className="fill-amber-200/50 text-[10px] font-mono"
                        >
                          {formatShortRupiah(tick.val)}
                        </text>
                      </g>
                    ))}

                    {/* Filled Area Retail */}
                    <path d={areaPath} fill="url(#area-gradient-asset)" />

                    {/* Secondary Cost HPP Line (Dotted) */}
                    <path
                      d={costPaths.linePath}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2"
                      strokeDasharray="5 3"
                    />

                    {/* Main Smooth Line Retail */}
                    <path
                      d={linePath}
                      fill="none"
                      stroke="url(#line-gradient-asset)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {/* Data Points */}
                    {points.map((pt, idx) => (
                      <circle
                        key={idx}
                        cx={pt.x}
                        cy={pt.y}
                        r={hoveredIndex === idx && hoveredChart === 'asset' ? 6 : 3}
                        className="transition-all duration-150"
                        fill="#070604"
                        stroke="#fbbf24"
                        strokeWidth="2.5"
                      />
                    ))}

                    {/* Active Hover Crosshair Line */}
                    {hoveredChart === 'asset' &&
                      hoveredIndex !== null &&
                      points[hoveredIndex] && (
                        <g>
                          <line
                            x1={points[hoveredIndex].x}
                            y1="15"
                            x2={points[hoveredIndex].x}
                            y2={svgHeight - 25}
                            stroke="#fbbf24"
                            strokeWidth="1.5"
                            strokeDasharray="3 3"
                          />
                          <circle
                            cx={points[hoveredIndex].x}
                            cy={points[hoveredIndex].y}
                            r="8"
                            fill="#f59e0b"
                            fillOpacity="0.3"
                          />
                          <circle
                            cx={points[hoveredIndex].x}
                            cy={points[hoveredIndex].y}
                            r="4"
                            fill="#ffffff"
                          />
                        </g>
                      )}
                  </svg>

                  {/* Floating Tooltip Box */}
                  {hoveredPt && (
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-[#12100b] border border-amber-500/40 p-3 rounded-xl shadow-2xl text-xs z-20 pointer-events-none min-w-[230px]">
                      <div className="font-bold text-amber-50 flex items-center justify-between border-b border-amber-500/25 pb-1.5 mb-1.5 gap-3">
                        <span>{hoveredPt.label}</span>
                        <span className="text-[10px] text-amber-400 font-mono truncate max-w-[110px]">
                          {assetBundle.targetProd ? assetBundle.targetProd.name : 'Semua Produk'}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-amber-200/70">Nilai Jual Retail:</span>
                          <span className="font-mono font-black text-amber-400">
                            {formatRupiah(hoveredPt.assetTotal)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-zinc-400">Nilai Modal (HPP):</span>
                          <span className="font-mono text-zinc-300">
                            {formatRupiah(hoveredPt.assetCost)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-zinc-400">Potensi Margin:</span>
                          <span className="font-mono text-emerald-400 font-bold">
                            {formatRupiah(Math.max(0, hoveredPt.assetTotal - hoveredPt.assetCost))}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-zinc-400">Stok Tersedia:</span>
                          <span className="font-mono text-zinc-200 font-bold">
                            {hoveredPt.assetUnits} Dus
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* X Axis Labels */}
                  <div className="flex items-center justify-between pl-14 pr-2 pt-1 text-[11px] font-mono text-zinc-400">
                    <span>{seriesPoints[0]?.date}</span>
                    <span className="text-[10px] text-zinc-500">
                      Garis putus-putus: Nilai Modal HPP
                    </span>
                    <span>{seriesPoints[seriesPoints.length - 1]?.date}</span>
                  </div>
                </div>
              );
            })()}

            {/* Sub-insights footer */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 text-xs border-t border-zinc-800/80">
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-zinc-500 block text-[10px]">Modal HPP Tertanam</span>
                <span className="font-bold text-white font-mono text-[11px]">
                  {formatShortRupiah(assetBundle.metrics.currentAssetCost)} (
                  {assetBundle.metrics.currentStockUnits} Dus)
                </span>
              </div>
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-zinc-500 block text-[10px]">Potensi Margin Aset</span>
                <span className="font-bold text-emerald-400 font-mono text-[11px]">
                  +{formatShortRupiah(assetBundle.metrics.assetProfitPotential)}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800 col-span-2 sm:col-span-1">
                <span className="text-zinc-500 block text-[10px]">Tingkat Perputaran</span>
                <span className="font-bold text-purple-400 font-mono text-[11px]">
                  {assetBundle.metrics.annualizedTurnover}x Perputaran/Thn
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* CHART 3: AREA CHART LINE PEMBELIAN                        */}
        {/* ========================================================= */}
        {(activeTab === 'all' || activeTab === 'pembelian') && (
          <div className="bg-zinc-950/70 border border-zinc-800/90 p-5 rounded-2xl space-y-4 hover:border-amber-500/30 transition relative flex flex-col justify-between">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-sm shadow-amber-400/50" />
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    3. Area Chart Line Pembelian
                  </h3>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Tren nilai pengadaan, faktur pembelian PO supplier, &amp; barang masuk stok
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3">
                {renderProductSelectDropdown(
                  selectedProductPurchase,
                  setSelectedProductPurchase,
                  'hover:border-amber-500/40 focus:border-amber-500'
                )}
                <div className="text-right">
                  <span className="text-[10px] font-mono text-zinc-400 block">
                    Total Pembelian (
                    {purchaseBundle.targetProd ? purchaseBundle.targetProd.name : 'Semua'})
                  </span>
                  <div className="text-sm sm:text-base font-black text-amber-400 font-mono">
                    {formatRupiah(purchaseBundle.metrics.totalPembelian)}
                  </div>
                </div>
              </div>
            </div>

            {/* SVG Area Chart 3 */}
            {(() => {
              const svgWidth = 720;
              const svgHeight = 220;
              const seriesPoints = purchaseBundle.points;
              const { linePath, areaPath, points, yTicks } = generatePath(
                seriesPoints.map((d) => d.pembelian),
                svgWidth,
                svgHeight
              );
              const hoveredPt =
                hoveredChart === 'pembelian' && hoveredIndex !== null
                  ? seriesPoints[hoveredIndex] || null
                  : null;

              return (
                <div className="relative pt-2">
                  <svg
                    viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                    className="w-full h-48 sm:h-56 overflow-visible cursor-crosshair select-none"
                    onMouseMove={(e) => handleSvgMouseMove(e, 'pembelian', seriesPoints.length)}
                    onMouseLeave={handleSvgMouseLeave}
                  >
                    <defs>
                      <linearGradient id="area-gradient-purchase" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.45" />
                        <stop offset="60%" stopColor="#d97706" stopOpacity="0.15" />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                      </linearGradient>
                      <linearGradient id="line-gradient-purchase" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#fbbf24" />
                        <stop offset="50%" stopColor="#f59e0b" />
                        <stop offset="100%" stopColor="#ef4444" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal Grid lines & Dynamic YAxis Labels (IDR / USD) */}
                    {yTicks.map((tick) => (
                      <g key={tick.ratio}>
                        <line
                          x1="64"
                          y1={tick.y}
                          x2={svgWidth - 20}
                          y2={tick.y}
                          stroke="#27272a"
                          strokeDasharray="4 4"
                          strokeWidth="1"
                        />
                        <text
                          x="58"
                          y={tick.y + 3}
                          textAnchor="end"
                          className="fill-zinc-500 text-[10px] font-mono"
                        >
                          {formatShortRupiah(tick.val)}
                        </text>
                      </g>
                    ))}

                    {/* Filled Area */}
                    <path d={areaPath} fill="url(#area-gradient-purchase)" />

                    {/* Smooth Stroke Line */}
                    <path
                      d={linePath}
                      fill="none"
                      stroke="url(#line-gradient-purchase)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {/* Data Points */}
                    {points.map((pt, idx) => (
                      <circle
                        key={idx}
                        cx={pt.x}
                        cy={pt.y}
                        r={hoveredIndex === idx && hoveredChart === 'pembelian' ? 6 : 3}
                        className="transition-all duration-150"
                        fill="#09090b"
                        stroke="#f59e0b"
                        strokeWidth="2.5"
                      />
                    ))}

                    {/* Active Hover Crosshair Line */}
                    {hoveredChart === 'pembelian' &&
                      hoveredIndex !== null &&
                      points[hoveredIndex] && (
                        <g>
                          <line
                            x1={points[hoveredIndex].x}
                            y1="15"
                            x2={points[hoveredIndex].x}
                            y2={svgHeight - 25}
                            stroke="#fbbf24"
                            strokeWidth="1.5"
                            strokeDasharray="3 3"
                          />
                          <circle
                            cx={points[hoveredIndex].x}
                            cy={points[hoveredIndex].y}
                            r="8"
                            fill="#f59e0b"
                            fillOpacity="0.3"
                          />
                          <circle
                            cx={points[hoveredIndex].x}
                            cy={points[hoveredIndex].y}
                            r="4"
                            fill="#ffffff"
                          />
                        </g>
                      )}
                  </svg>

                  {/* Floating Tooltip Box */}
                  {hoveredPt && (
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-zinc-900/95 border border-amber-500/40 p-3 rounded-xl shadow-2xl text-xs z-20 pointer-events-none min-w-[230px]">
                      <div className="font-bold text-white flex items-center justify-between border-b border-zinc-800 pb-1.5 mb-1.5 gap-3">
                        <span>{hoveredPt.label}</span>
                        <span className="text-[10px] text-amber-400 font-mono truncate max-w-[110px]">
                          {purchaseBundle.targetProd
                            ? purchaseBundle.targetProd.name
                            : 'Semua Produk'}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-zinc-400">Nilai Pembelian:</span>
                          <span className="font-mono font-black text-amber-400">
                            {formatRupiah(hoveredPt.pembelian)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-zinc-400">Barang Masuk:</span>
                          <span className="font-mono text-zinc-200 font-bold">
                            {hoveredPt.pembelianUnits} Dus
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-zinc-400">Faktur / Log Masuk:</span>
                          <span className="font-mono text-zinc-200">
                            {hoveredPt.poCount} Pencatatan
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* X Axis Labels */}
                  <div className="flex items-center justify-between pl-14 pr-2 pt-1 text-[11px] font-mono text-zinc-400">
                    <span>{seriesPoints[0]?.date}</span>
                    <span>{seriesPoints[Math.floor(seriesPoints.length / 2)]?.date}</span>
                    <span>{seriesPoints[seriesPoints.length - 1]?.date}</span>
                  </div>
                </div>
              );
            })()}

            {/* Sub-insights footer */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 text-xs border-t border-zinc-800/80">
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-zinc-500 block text-[10px]">Titik Kulakan Tertinggi</span>
                <span className="font-bold text-white font-mono text-[11px]">
                  {purchaseBundle.metrics.maxPembelianPoint &&
                  purchaseBundle.metrics.maxPembelianPoint.pembelian > 0
                    ? `${purchaseBundle.metrics.maxPembelianPoint.date} (${formatShortRupiah(
                        purchaseBundle.metrics.maxPembelianPoint.pembelian
                      )})`
                    : formatRupiah(0)}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-zinc-500 block text-[10px]">PO / Log Masuk</span>
                <span className="font-bold text-amber-400 font-mono text-[11px]">
                  {purchaseBundle.metrics.totalPO} Faktur Verified
                </span>
              </div>
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800 col-span-2 sm:col-span-1">
                <span className="text-zinc-500 block text-[10px]">Total Barang Masuk</span>
                <span className="font-bold text-emerald-400 font-mono text-[11px]">
                  {purchaseBundle.metrics.totalUnitsBought} Dus Masuk
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* CHART 4: AREA CHART LINE : STOK VS BARANG MASUK VS PENJUALAN              */}
        {/* Placed right next to Chart 3 in the 2x2 Desktop Grid                      */}
        {/* ========================================================================= */}
        {(activeTab === 'all' || activeTab === 'stok_vs_sales') && (
          <div className="bg-zinc-950/70 border border-zinc-800/90 p-5 rounded-2xl space-y-4 hover:border-cyan-500/30 transition relative flex flex-col justify-between">
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-sm shadow-cyan-400/50" />
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      4. Area Chart Line : Stok vs Barang Masuk vs Penjualan
                    </h3>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Perbandingan 3 kurva real-time: Stok Sistem, Barang Masuk (Restock/PO), dan Penjualan (POS/PWA)
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 shrink-0">
                  {renderProductSelectDropdown(
                    selectedProductCompare,
                    setSelectedProductCompare,
                    'hover:border-cyan-500/40 focus:border-cyan-500'
                  )}
                </div>
              </div>

              {/* Active Interactive 3-Line Legend */}
              <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => setSeriesVisible((prev) => ({ ...prev, stok: !prev.stok }))}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
                      seriesVisible.stok
                        ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                        : 'bg-zinc-900 text-zinc-500 border-zinc-800 line-through'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    <span>Stok ({compareBundle.metrics.currentStockUnits} Dus)</span>
                  </button>

                  <button
                    onClick={() =>
                      setSeriesVisible((prev) => ({ ...prev, barangMasuk: !prev.barangMasuk }))
                    }
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
                      seriesVisible.barangMasuk
                        ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                        : 'bg-zinc-900 text-zinc-500 border-zinc-800 line-through'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span>Barang Masuk ({compareBundle.metrics.totalUnitsBought} Dus)</span>
                  </button>

                  <button
                    onClick={() =>
                      setSeriesVisible((prev) => ({ ...prev, penjualan: !prev.penjualan }))
                    }
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
                      seriesVisible.penjualan
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                        : 'bg-zinc-900 text-zinc-500 border-zinc-800 line-through'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>Penjualan ({compareBundle.metrics.totalUnitsSold} Dus)</span>
                  </button>
                </div>

                <span className="text-[10px] font-mono text-zinc-400">
                  Satuan Sumbu Y: <strong className="text-cyan-400">Dus / Qty</strong>
                </span>
              </div>
            </div>

            {/* SVG Multi-Area 3-Series Comparison Chart */}
            {(() => {
              const svgWidth = 720;
              const svgHeight = 220;
              const seriesPoints = compareBundle.points;

              // Unified quantity scale (Dus / Unit) across the 3 active series
              const maxQtyAcrossSeries = Math.max(
                ...(seriesVisible.stok ? seriesPoints.map((d) => d.stokUnits) : [0]),
                ...(seriesVisible.barangMasuk ? seriesPoints.map((d) => d.pembelianUnits) : [0]),
                ...(seriesVisible.penjualan ? seriesPoints.map((d) => d.penjualanUnits) : [0]),
                1
              );

              const stokPath = generatePath(
                seriesPoints.map((d) => d.stokUnits),
                svgWidth,
                svgHeight,
                20,
                25,
                64,
                20,
                maxQtyAcrossSeries
              );

              const masukPath = generatePath(
                seriesPoints.map((d) => d.pembelianUnits),
                svgWidth,
                svgHeight,
                20,
                25,
                64,
                20,
                maxQtyAcrossSeries
              );

              const salesPath = generatePath(
                seriesPoints.map((d) => d.penjualanUnits),
                svgWidth,
                svgHeight,
                20,
                25,
                64,
                20,
                maxQtyAcrossSeries
              );

              const hoveredPt =
                hoveredChart === 'stok_vs_sales' && hoveredIndex !== null
                  ? seriesPoints[hoveredIndex] || null
                  : null;

              return (
                <div className="relative pt-2">
                  <svg
                    viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                    className="w-full h-48 sm:h-56 overflow-visible cursor-crosshair select-none"
                    onMouseMove={(e) =>
                      handleSvgMouseMove(e, 'stok_vs_sales', seriesPoints.length)
                    }
                    onMouseLeave={handleSvgMouseLeave}
                  >
                    <defs>
                      {/* Garis 1: Stok Gold Area */}
                      <linearGradient id="area-multi-stok" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.34" />
                        <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.0" />
                      </linearGradient>

                      {/* Garis 2: Barang Masuk Amber Area */}
                      <linearGradient id="area-multi-purch" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                      </linearGradient>

                      {/* Garis 3: Penjualan Emerald Area */}
                      <linearGradient id="area-multi-sales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity="0.38" />
                        <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Grid lines & Quantity YAxis Labels (Dus) */}
                    {stokPath.yTicks.map((tick) => (
                      <g key={tick.ratio}>
                        <line
                          x1="64"
                          y1={tick.y}
                          x2={svgWidth - 20}
                          y2={tick.y}
                          stroke="#262013"
                          strokeDasharray="4 4"
                          strokeWidth="1"
                        />
                        <text
                          x="58"
                          y={tick.y + 3}
                          textAnchor="end"
                          className="fill-amber-200/50 text-[10px] font-mono"
                        >
                          {tick.val.toLocaleString('id-ID')} Dus
                        </text>
                      </g>
                    ))}

                    {/* Garis 1: STOK (Stok Sistem) */}
                    {seriesVisible.stok && (
                      <g>
                        <path d={stokPath.areaPath} fill="url(#area-multi-stok)" />
                        <path
                          d={stokPath.linePath}
                          fill="none"
                          stroke="#fbbf24"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                        {stokPath.points.map((pt, idx) => (
                          <circle
                            key={`stok-${idx}`}
                            cx={pt.x}
                            cy={pt.y}
                            r={hoveredIndex === idx && hoveredChart === 'stok_vs_sales' ? 5 : 2.5}
                            fill="#070604"
                            stroke="#fbbf24"
                            strokeWidth="2"
                          />
                        ))}
                      </g>
                    )}

                    {/* Garis 2: BARANG MASUK (Procurement / Restock) */}
                    {seriesVisible.barangMasuk && (
                      <g>
                        <path d={masukPath.areaPath} fill="url(#area-multi-purch)" />
                        <path
                          d={masukPath.linePath}
                          fill="none"
                          stroke="#f59e0b"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                        {masukPath.points.map((pt, idx) => (
                          <circle
                            key={`masuk-${idx}`}
                            cx={pt.x}
                            cy={pt.y}
                            r={hoveredIndex === idx && hoveredChart === 'stok_vs_sales' ? 5 : 2.5}
                            fill="#070604"
                            stroke="#f59e0b"
                            strokeWidth="2"
                          />
                        ))}
                      </g>
                    )}

                    {/* Garis 3: PENJUALAN (POS + PWA Orders) */}
                    {seriesVisible.penjualan && (
                      <g>
                        <path d={salesPath.areaPath} fill="url(#area-multi-sales)" />
                        <path
                          d={salesPath.linePath}
                          fill="none"
                          stroke="#10b981"
                          strokeWidth="3"
                          strokeLinecap="round"
                        />
                        {salesPath.points.map((pt, idx) => (
                          <circle
                            key={`sales-${idx}`}
                            cx={pt.x}
                            cy={pt.y}
                            r={hoveredIndex === idx && hoveredChart === 'stok_vs_sales' ? 5.5 : 2.5}
                            fill="#070604"
                            stroke="#10b981"
                            strokeWidth="2"
                          />
                        ))}
                      </g>
                    )}

                    {/* Hover Crosshair indicator */}
                    {hoveredChart === 'stok_vs_sales' &&
                      hoveredIndex !== null &&
                      stokPath.points[hoveredIndex] && (
                        <g>
                          <line
                            x1={stokPath.points[hoveredIndex].x}
                            y1="15"
                            x2={stokPath.points[hoveredIndex].x}
                            y2={svgHeight - 25}
                            stroke="#fbbf24"
                            strokeWidth="1.5"
                            strokeDasharray="3 3"
                          />
                          {seriesVisible.stok && stokPath.points[hoveredIndex] && (
                            <circle
                              cx={stokPath.points[hoveredIndex].x}
                              cy={stokPath.points[hoveredIndex].y}
                              r="5"
                              fill="#fbbf24"
                              stroke="#ffffff"
                              strokeWidth="1.5"
                            />
                          )}
                          {seriesVisible.barangMasuk && masukPath.points[hoveredIndex] && (
                            <circle
                              cx={masukPath.points[hoveredIndex].x}
                              cy={masukPath.points[hoveredIndex].y}
                              r="5"
                              fill="#f59e0b"
                              stroke="#ffffff"
                              strokeWidth="1.5"
                            />
                          )}
                          {seriesVisible.penjualan && salesPath.points[hoveredIndex] && (
                            <circle
                              cx={salesPath.points[hoveredIndex].x}
                              cy={salesPath.points[hoveredIndex].y}
                              r="5"
                              fill="#10b981"
                              stroke="#ffffff"
                              strokeWidth="1.5"
                            />
                          )}
                        </g>
                      )}
                  </svg>

                  {/* Multi-metric 3-Series Tooltip Box with Quantity (Dus) & Currency (IDR / USD) */}
                  {hoveredPt && (
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-[#12100b] border border-amber-500/40 p-3 rounded-xl shadow-2xl text-xs z-20 pointer-events-none min-w-[275px]">
                      <div className="font-bold text-amber-50 flex items-center justify-between border-b border-amber-500/25 pb-1.5 mb-2 gap-3">
                        <span>{hoveredPt.label}</span>
                        <span className="text-[10px] text-amber-400 font-mono truncate max-w-[120px]">
                          {compareBundle.targetProd
                            ? compareBundle.targetProd.name
                            : 'Semua Produk'}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-amber-200">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-300" />
                            1. Stok Sistem:
                          </span>
                          <span className="font-mono font-bold">
                            {hoveredPt.stokUnits} Dus ({formatShortRupiah(hoveredPt.assetTotal)})
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-amber-300">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-400" />
                            2. Barang Masuk:
                          </span>
                          <span className="font-mono font-bold">
                            {hoveredPt.pembelianUnits} Dus ({formatShortRupiah(hoveredPt.pembelian)})
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-emerald-300">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400" />
                            3. Penjualan:
                          </span>
                          <span className="font-mono font-bold">
                            {hoveredPt.penjualanUnits} Dus ({formatShortRupiah(hoveredPt.penjualan)})
                          </span>
                        </div>
                        <div className="border-t border-zinc-800 pt-1 flex justify-between items-center text-[11px] text-zinc-400">
                          <span>Selisih Mutasi (Masuk - Jual):</span>
                          <span
                            className={`font-mono font-bold ${
                              hoveredPt.pembelianUnits - hoveredPt.penjualanUnits >= 0
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {hoveredPt.pembelianUnits - hoveredPt.penjualanUnits >= 0 ? '+' : ''}
                            {hoveredPt.pembelianUnits - hoveredPt.penjualanUnits} Dus
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* X Axis Labels */}
                  <div className="flex items-center justify-between pl-14 pr-2 pt-1 text-[11px] font-mono text-zinc-400">
                    <span>{seriesPoints[0]?.date}</span>
                    <span>{seriesPoints[Math.floor(seriesPoints.length / 2)]?.date}</span>
                    <span>{seriesPoints[seriesPoints.length - 1]?.date}</span>
                  </div>
                </div>
              );
            })()}

            {/* Tri-balance summary footer */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 text-xs border-t border-zinc-800/80">
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-zinc-500 block text-[10px]">1. Stok Sistem Saat Ini</span>
                <span className="font-bold text-cyan-400 font-mono text-[11px]">
                  {compareBundle.metrics.currentStockUnits} Dus (
                  {formatShortRupiah(compareBundle.metrics.currentAssetTotal)})
                </span>
              </div>
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="text-zinc-500 block text-[10px]">2. Total Barang Masuk</span>
                <span className="font-bold text-amber-400 font-mono text-[11px]">
                  +{compareBundle.metrics.totalUnitsBought} Dus (
                  {formatShortRupiah(compareBundle.metrics.totalPembelian)})
                </span>
              </div>
              <div className="p-2 rounded-xl bg-zinc-900/80 border border-zinc-800 col-span-2 sm:col-span-1">
                <span className="text-zinc-500 block text-[10px]">3. Total Penjualan</span>
                <span className="font-bold text-emerald-400 font-mono text-[11px]">
                  {compareBundle.metrics.totalUnitsSold} Dus (
                  {formatShortRupiah(compareBundle.metrics.totalPenjualan)})
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* FOOTER ACTIONS BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 text-xs text-zinc-400 border-t border-zinc-800/70">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-400 shrink-0" />
          <span>
            Ke-4 grafik tersinkronisasi secara real-time dengan Firestore (POS, PWA Orders, Master Produk, Pengadaan PO, &amp; Log Stok) dalam mata uang {activeCurrency}.
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onOpenAddProduct && (
            <button
              onClick={onOpenAddProduct}
              className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold border border-zinc-700 transition cursor-pointer"
            >
              + Tambah Stok / Produk
            </button>
          )}
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('pos_machine')}
              className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition shadow-md shadow-blue-600/20 cursor-pointer"
            >
              Buka Mesin POS Kasir
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
