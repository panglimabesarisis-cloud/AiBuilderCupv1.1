import React, { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../../services/firebaseSession';
import {
  Sparkles,
  TrendingUp,
  Package,
  Layers,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  ShoppingBag,
  MapPin,
  Zap,
  Plus,
  ArrowRight,
  RefreshCw,
  BarChart3,
  Tag,
  Percent,
  Eye,
  Send,
  Award,
  Flame,
  Boxes,
  Store,
  FileText,
  Check,
  Search,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  doc,
  addDoc,
  setDoc,
  serverTimestamp,
  query,
  where,
  limit,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { ACTIVE_STORE_ID } from '../../config/store';
import { useAppData } from '../../context/AppDataContext';
import { useAppNavigation } from '../../router';
import {
  getActiveAgentInstruction,
  getActiveAgentModel,
  DEFAULT_GOOGLE_GEMINI_MODEL,
} from '../../services/aiInstructionStore';
import { checkAndRecordAiCooldown } from '../../utils/aiCooldown';
import { ProductBundle, BundleItem } from '../../types';
import { fetchDailyStatsForAiContext } from '../../services/dailyStatsService';
import { AiRunControlBar, useAiFeatureControl } from '../common/AiRunControlBar';

interface AIBusinessAdvisorViewProps {
  currencyMode?: 'IDR' | 'USD';
}

export interface EnrichedAdvisorProduct {
  id: string;
  docId: string;
  name: string;
  sku: string;
  category: string;
  brand: string;
  stock: number;
  minStock: number;
  itemsPerCarton: number;
  costPrice: number; // Harga Modal (/dashboard/produk)
  sellingPrice: number; // Harga Jual (/dashboard/produk)
  pwaPrice: number;
  unitProfit: number; // Harga Jual - Harga Modal
  marginPercent: number; // (unitProfit / sellingPrice) * 100
  stockAssetValue: number; // Harga Modal * Stok
  potentialRevenueValue: number; // Harga Jual * Stok
  shelfLocation: string;
  // Data dari /dashboard/laporankas (Kolom Penjualan)
  soldQty: number;
  salesRevenue: number; // Kolom Penjualan (Rp)
  salesCogs: number;
  salesProfit: number; // Laba Aktual dari Penjualan
  txCount: number;
  lastSoldDate: string;
  // Klasifikasi AI
  isOverstock: boolean;
  isDeadstock: boolean;
  isMostProfitable: boolean;
  turnoverRatio: number; // soldQty / max(1, stock + soldQty)
  profitabilityScore: number;
}

export interface AutoBundleRecommendation {
  id: string;
  bundleCode: string;
  bundleName: string;
  strategyType: 'PROFIT_X_OVERSTOCK' | 'PROFIT_X_DEADSTOCK' | 'FAST_MOVER_CLEARANCE';
  badgeLabel: string;
  profitableProduct: EnrichedAdvisorProduct;
  profitableQty: number;
  targetProduct: EnrichedAdvisorProduct;
  targetQty: number;
  totalCostPrice: number;
  totalNormalPrice: number;
  recommendedBundlePrice: number;
  customerSavingsRp: number;
  customerSavingsPercent: number;
  netBundleProfitRp: number;
  netBundleMarginPercent: number;
  marketingHook: string;
  placementTip: string;
  rationale: string;
}

function parseFlexibleTimestamp(raw: any): number {
  if (!raw) return 0;
  if (typeof raw?.toDate === 'function') {
    const d = raw.toDate();
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  if (typeof raw?.seconds === 'number') {
    return raw.seconds * 1000;
  }
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? 0 : raw.getTime();
  }
  if (typeof raw === 'number') return raw;
  const parsed = new Date(String(raw)).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

function formatDateShort(tsMs: number): string {
  if (!tsMs || tsMs <= 0) return 'Belum Pernah Terjual';
  try {
    return new Date(tsMs).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
}

export const AIBusinessAdvisorView: React.FC<AIBusinessAdvisorViewProps> = ({
  currencyMode = 'IDR',
}) => {
  const appData = useAppData();
  const { navigateToPath } = useAppNavigation();

  const [activePillarTab, setActivePillarTab] = useState<
    'all' | 'overstock' | 'bundling' | 'deadstock' | 'data_matrix'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Live Firestore listeners for store_001 transactions & bundles to complement AppDataContext
  const [storeSubTransactions, setStoreSubTransactions] = useState<any[]>([]);
  const [existingBundles, setExistingBundles] = useState<ProductBundle[]>([]);
  const [directRootProducts, setDirectRootProducts] = useState<any[]>([]);
  const [directStoreProducts, setDirectStoreProducts] = useState<any[]>([]);

  // Toast feedback state
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(
    null
  );
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4500);
  };

  // Placement update state
  const [updatingPlacementId, setUpdatingPlacementId] = useState<string | null>(null);
  const [customLocations, setCustomLocations] = useState<Record<string, string>>({});

  // Bundle creation state
  const [creatingBundleId, setCreatingBundleId] = useState<string | null>(null);
  const [customProfitProdId, setCustomProfitProdId] = useState<string>('');
  const [customProfitQty, setCustomProfitQty] = useState<number>(1);
  const [customOverstockProdId, setCustomOverstockProdId] = useState<string>('');
  const [customOverstockQty, setCustomOverstockQty] = useState<number>(1);
  const [customDiscountPct, setCustomDiscountPct] = useState<number>(8);
  const [customBundleName, setCustomBundleName] = useState<string>('');
  const [customBundleQuota, setCustomBundleQuota] = useState<number>(30);

  // Interactive AI Advisor Consultation state
  const [aiPromptInput, setAiPromptInput] = useState<string>('');
  const [aiResponseText, setAiResponseText] = useState<string>('');
  const [isAiGenerating, setIsAiGenerating] = useState<boolean>(false);

  const fmt = (val: number) => {
    const safe = Number.isFinite(val) ? val : 0;
    if (appData?.formatMoney) return appData.formatMoney(safe);
    if (currencyMode === 'USD') {
      return `$${(safe / 15800).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    return `Rp ${Math.round(safe).toLocaleString('id-ID')}`;
  };

  // Subscribe to bundles collection with where('storeId', '==', ACTIVE_STORE_ID) + limit(50); products & transactions use shared AppDataContext listener
  useEffect(() => {
    const unsubBundles = onSnapshot(
      query(
        collection(db, 'stores', ACTIVE_STORE_ID, 'bundles'),
        where('storeId', '==', ACTIVE_STORE_ID),
        limit(50)
      ),
      (snap) => {
        const list: ProductBundle[] = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            storeId: data.storeId || ACTIVE_STORE_ID,
            bundleCode: data.bundleCode || `BUNDLE-${d.id.slice(0, 4).toUpperCase()}`,
            name: data.name || 'Paket Bundling',
            description: data.description || '',
            startDate: data.startDate || '',
            endDate: data.endDate || '',
            quota: Number(data.quota) || 0,
            soldCount: Number(data.soldCount) || 0,
            items: Array.isArray(data.items) ? data.items : [],
            totalCostPrice: Number(data.totalCostPrice) || 0,
            totalStandardPrice: Number(data.totalStandardPrice) || 0,
            totalPromoPrice: Number(data.totalPromoPrice) || 0,
            totalDiscount: Number(data.totalDiscount) || 0,
            bundleProfit: Number(data.bundleProfit) || 0,
            status: data.status || 'active',
          });
        });
        setExistingBundles(list);
      },
      () => {}
    );

    return () => {
      unsubBundles();
    };
  }, []);

  // 1. Merge & Normalize Products from /dashboard/produk (AppDataContext + root 'products' + 'stores/store_001/products')
  const mergedRawProducts = useMemo(() => {
    const map = new Map<string, any>();
    const addProd = (p: any) => {
      if (!p || p.deleted === true) return;
      const key = String(p.id || p.docId || p.sku || p.name || '').trim();
      if (!key) return;
      const existing = map.get(key);
      map.set(key, existing ? { ...existing, ...p } : p);
    };
    (appData.products || []).forEach(addProd);
    directStoreProducts.forEach(addProd);
    directRootProducts.forEach(addProd);
    return Array.from(map.values());
  }, [appData.products, directStoreProducts, directRootProducts]);

  // 2. Merge & Deduplicate Valid Sales Transactions exactly like /dashboard/laporankas (LaporanKasModule.tsx)
  const validSalesTransactions = useMemo(() => {
    const map = new Map<string, any>();
    const voidStatuses = new Set([
      'void',
      'cancelled',
      'canceled',
      'rejected',
      'refunded',
      'batal',
    ]);

    const addRecord = (rec: any, defaultChannel: 'pos' | 'pwa_client') => {
      if (!rec) return;
      const status = String(rec.status || rec.fulfillmentStatus || '').toLowerCase();
      if (voidStatuses.has(status)) return;

      const canonicalId = String(rec.transactionId || rec.orderId || rec.id || '').trim();
      if (!canonicalId) return;
      if (!map.has(canonicalId)) {
        map.set(canonicalId, {
          ...rec,
          id: rec.id || canonicalId,
          channel: rec.channel || (rec.orderId ? 'pwa_client' : defaultChannel),
          totalAmount: Number(rec.totalAmount ?? rec.total ?? rec.grandTotal ?? 0),
        });
      }
    };

    (appData.transactions || []).forEach((t) => addRecord(t, 'pos'));
    storeSubTransactions.forEach((t) => addRecord(t, 'pos'));
    (appData.orders || []).forEach((o) => addRecord(o, 'pwa_client'));

    return Array.from(map.values());
  }, [appData.transactions, storeSubTransactions, appData.orders]);

  // 3. Compute Enriched Product Analytics combining /dashboard/produk prices & stock with /dashboard/laporankas Kolom Penjualan
  const {
    enrichedProducts,
    totalLaporanKasSalesRevenue,
    totalLaporanKasProfit,
    totalStockUnits,
    totalInventoryCostAsset,
  } = useMemo(() => {
    // Build lookup by ID, SKU, and lowercase name
    const salesByProductKey = new Map<
      string,
      {
        qty: number;
        revenue: number;
        cogs: number;
        txCount: number;
        lastSoldMs: number;
      }
    >();

    const prodLookupById = new Map<string, any>();
    const prodLookupByName = new Map<string, any>();

    mergedRawProducts.forEach((p) => {
      const id = String(p.id || p.docId || '').trim();
      const sku = String(p.sku || p.barcode || '').trim();
      const name = String(p.name || p.productName || '').trim().toLowerCase();
      if (id) prodLookupById.set(id, p);
      if (sku) prodLookupById.set(sku, p);
      if (name) prodLookupByName.set(name, p);
    });

    let globalSalesRev = 0;
    let globalSalesCogs = 0;

    validSalesTransactions.forEach((tx) => {
      const netAmt = Number(tx.totalAmount ?? tx.total ?? tx.grandTotal ?? 0);
      globalSalesRev += netAmt;

      const txMs = parseFlexibleTimestamp(tx.createdAt || tx.timestamp || tx.date || tx.orderDate);
      const items = Array.isArray(tx.items) ? tx.items : [];

      items.forEach((item: any) => {
        const rawPid = String(item.productId || item.product?.id || item.id || '').trim();
        const rawSku = String(item.sku || item.product?.sku || '').trim();
        const rawName = String(item.productName || item.name || item.product?.name || '')
          .trim()
          .toLowerCase();

        const matchedProd =
          prodLookupById.get(rawPid) ||
          prodLookupById.get(rawSku) ||
          prodLookupByName.get(rawName);

        const canonicalKey = matchedProd
          ? String(matchedProd.id || matchedProd.sku || matchedProd.name)
          : rawPid || rawSku || rawName;

        if (!canonicalKey) return;

        const qty = Math.max(
          1,
          Number(item.unitsDeducted ?? item.quantityOrdered ?? item.quantity ?? item.qty ?? 1)
        );

        const fallbackSellPrice = matchedProd
          ? Number(
              matchedProd.posPrice ??
                matchedProd.sellPrice ??
                matchedProd.sellingPrice ??
                matchedProd.pricePerUnit ??
                matchedProd.pricePerCarton ??
                matchedProd.price ??
                0
            )
          : 0;

        const unitPrice = Number(
          item.unitPrice ?? item.price ?? item.pricePerUnit ?? fallbackSellPrice
        );
        const lineRevenue = Number(item.subtotal ?? item.total ?? qty * unitPrice);

        const fallbackCostPrice = matchedProd
          ? Number(
              matchedProd.costPrice ??
                matchedProd.costPerUnit ??
                matchedProd.buyPrice ??
                matchedProd.modalPrice ??
                matchedProd.hargaModal ??
                0
            )
          : 0;

        const unitCost = Number(
          item.costPerUnit ?? item.costPrice ?? item.product?.costPerUnit ?? fallbackCostPrice
        );
        const lineCogs = unitCost * qty;
        globalSalesCogs += lineCogs;

        const prev = salesByProductKey.get(canonicalKey) || {
          qty: 0,
          revenue: 0,
          cogs: 0,
          txCount: 0,
          lastSoldMs: 0,
        };
        prev.qty += qty;
        prev.revenue += lineRevenue;
        prev.cogs += lineCogs;
        prev.txCount += 1;
        if (txMs > prev.lastSoldMs) prev.lastSoldMs = txMs;
        salesByProductKey.set(canonicalKey, prev);
      });
    });

    // Build enriched product list from /dashboard/produk
    const rawEnriched: EnrichedAdvisorProduct[] = mergedRawProducts.map((p) => {
      const firstVar =
        Array.isArray(p.variants) && p.variants.length > 0 ? p.variants[0] : null;

      // Exact Harga Modal from /dashboard/produk
      const costPrice = Math.max(
        0,
        Number(
          p.costPrice ??
            p.costPerCarton ??
            p.costPerUnit ??
            p.buyPrice ??
            p.modalPrice ??
            p.hargaModal ??
            firstVar?.costPrice ??
            firstVar?.costPerUnit ??
            0
        ) || 0
      );

      // Exact Harga Jual from /dashboard/produk
      const sellingPrice = Math.max(
        0,
        Number(
          p.posPrice ??
            p.sellPrice ??
            p.sellingPrice ??
            p.pricePerCarton ??
            p.pricePerUnit ??
            p.price ??
            p.pwaPrice ??
            firstVar?.posPrice ??
            firstVar?.sellPrice ??
            firstVar?.pricePerUnit ??
            0
        ) || 0
      );

      const pwaPrice = Math.max(
        0,
        Number(p.pwaPrice ?? p.onlinePrice ?? firstVar?.pwaPrice ?? sellingPrice) || sellingPrice
      );

      // Exact Stock from /dashboard/produk
      const stock = Math.max(
        0,
        Number(
          p.totalStock ??
            p.stock ??
            p.stockInUnits ??
            (Array.isArray(p.variants)
              ? p.variants.reduce((acc: number, v: any) => acc + (Number(v.stock) || 0), 0)
              : 0)
        ) || 0
      );

      const minStock = Math.max(1, Number(p.minStockAlert ?? p.minStock ?? 5) || 5);
      const itemsPerCarton = Math.max(
        1,
        Number(p.itemsPerCarton ?? p.isiPerDus ?? p.piecesPerCarton ?? 1) || 1
      );

      const canonicalKey = String(p.id || p.sku || p.name);
      const salesStat = salesByProductKey.get(canonicalKey) ||
        salesByProductKey.get(String(p.sku || '')) ||
        salesByProductKey.get(String(p.name || '').trim().toLowerCase()) || {
          qty: 0,
          revenue: 0,
          cogs: 0,
          txCount: 0,
          lastSoldMs: 0,
        };

      const unitProfit = sellingPrice - costPrice;
      const marginPercent =
        sellingPrice > 0 ? Math.round((unitProfit / sellingPrice) * 1000) / 10 : 0;
      const stockAssetValue = costPrice * stock;
      const potentialRevenueValue = sellingPrice * stock;

      const salesRevenue = salesStat.revenue;
      const salesCogs = salesStat.cogs > 0 ? salesStat.cogs : salesStat.qty * costPrice;
      const salesProfit = salesRevenue - salesCogs;
      const turnoverRatio =
        stock + salesStat.qty > 0
          ? Math.round((salesStat.qty / (stock + salesStat.qty)) * 1000) / 10
          : 0;

      // Profitability score combines unit profit margin, unit profit Rp, and realized sales profit
      const profitabilityScore =
        unitProfit * 2 + salesProfit * 0.5 + (marginPercent > 0 ? marginPercent * 500 : 0);

      return {
        id: String(p.id || p.sku || p.name),
        docId: String(p.docId || p.id || ''),
        name: String(p.name || p.productName || p.sku || 'Produk Tanpa Nama').trim(),
        sku: String(p.sku || p.barcode || p.id || '-').trim(),
        category: String(p.category || 'Umum').trim(),
        brand: String(p.brand || 'Tanpa Brand').trim(),
        stock,
        minStock,
        itemsPerCarton,
        costPrice,
        sellingPrice,
        pwaPrice,
        unitProfit,
        marginPercent,
        stockAssetValue,
        potentialRevenueValue,
        shelfLocation: String(
          p.shelfLocation || p.storageLocation || p.rak || 'Rak Standar Gudang/Toko'
        ),
        soldQty: salesStat.qty,
        salesRevenue,
        salesCogs,
        salesProfit,
        txCount: salesStat.txCount,
        lastSoldDate: formatDateShort(salesStat.lastSoldMs),
        isOverstock: false,
        isDeadstock: false,
        isMostProfitable: false,
        turnoverRatio,
        profitabilityScore,
      };
    });

    // Dynamic thresholds based on store catalog distribution so it works accurately whether the store has 2 products or 200 products
    const withStock = rawEnriched.filter((p) => p.stock > 0);
    const avgStock =
      withStock.length > 0
        ? withStock.reduce((acc, p) => acc + p.stock, 0) / withStock.length
        : 10;

    // Sort copies to mark top overstock, deadstock, and most profitable
    const sortedByStockDesc = [...withStock].sort(
      (a, b) => b.stock - a.stock || b.stockAssetValue - a.stockAssetValue
    );
    const overstockIds = new Set(
      sortedByStockDesc
        .filter((p, idx) => p.stock >= Math.max(avgStock * 0.8, p.minStock) || idx < Math.ceil(withStock.length / 2))
        .map((p) => p.id)
    );

    // Deadstock: products with stock > 0 and 0 sales in /dashboard/laporankas (or lowest sales velocity if all products have some sales)
    const zeroSalesWithStock = withStock.filter((p) => p.soldQty === 0 || p.salesRevenue === 0);
    const deadstockIds = new Set<string>();
    if (zeroSalesWithStock.length > 0) {
      zeroSalesWithStock.forEach((p) => deadstockIds.add(p.id));
    } else {
      // Fallback: lowest turnover products with stock > 0
      [...withStock]
        .sort((a, b) => a.soldQty - b.soldQty || b.stock - a.stock)
        .slice(0, Math.max(1, Math.ceil(withStock.length * 0.4)))
        .forEach((p) => deadstockIds.add(p.id));
    }

    // Most profitable: products with highest unitProfit & salesProfit
    const sortedByProfit = [...rawEnriched]
      .filter((p) => p.unitProfit > 0 || p.sellingPrice > 0)
      .sort((a, b) => b.profitabilityScore - a.profitabilityScore || b.unitProfit - a.unitProfit);
    const profitableIds = new Set(
      sortedByProfit
        .slice(0, Math.max(1, Math.ceil(rawEnriched.length * 0.5)))
        .map((p) => p.id)
    );

    const finalized = rawEnriched.map((p) => ({
      ...p,
      isOverstock: overstockIds.has(p.id),
      isDeadstock: deadstockIds.has(p.id),
      isMostProfitable: profitableIds.has(p.id),
    }));

    const totalStock = finalized.reduce((acc, p) => acc + p.stock, 0);
    const totalAsset = finalized.reduce((acc, p) => acc + p.stockAssetValue, 0);

    return {
      enrichedProducts: finalized,
      totalLaporanKasSalesRevenue: globalSalesRev,
      totalLaporanKasProfit: globalSalesRev - globalSalesCogs,
      totalStockUnits: totalStock,
      totalInventoryCostAsset: totalAsset,
    };
  }, [mergedRawProducts, validSalesTransactions]);

  // Derived specialized lists for the 4 Advisor Pillars
  const overstockProducts = useMemo(() => {
    return [...enrichedProducts]
      .filter((p) => p.stock > 0)
      .sort((a, b) => b.stock - a.stock || b.stockAssetValue - a.stockAssetValue);
  }, [enrichedProducts]);

  const deadstockProducts = useMemo(() => {
    return [...enrichedProducts]
      .filter((p) => p.isDeadstock || (p.stock > 0 && p.soldQty === 0))
      .sort((a, b) => a.soldQty - b.soldQty || b.stockAssetValue - a.stockAssetValue);
  }, [enrichedProducts]);

  const mostProfitableProducts = useMemo(() => {
    return [...enrichedProducts].sort(
      (a, b) =>
        b.unitProfit - a.unitProfit ||
        b.salesProfit - a.salesProfit ||
        b.marginPercent - a.marginPercent
    );
  }, [enrichedProducts]);

  // Initialize default selection for Custom Bundle Generator from real products
  useEffect(() => {
    if (enrichedProducts.length === 0) return;
    if (!customProfitProdId && mostProfitableProducts.length > 0) {
      setCustomProfitProdId(mostProfitableProducts[0].id);
    }
    if (!customOverstockProdId && overstockProducts.length > 0) {
      const diffProd =
        overstockProducts.find((p) => p.id !== mostProfitableProducts[0]?.id) ||
        overstockProducts[0];
      if (diffProd) setCustomOverstockProdId(diffProd.id);
    }
  }, [enrichedProducts, mostProfitableProducts, overstockProducts, customProfitProdId, customOverstockProdId]);

  // Tugas 4: Auto-Generate Data-Driven Product Bundles (Produk Paling Menguntungkan + Produk Overstock/Deadstock)
  const autoBundleRecommendations = useMemo<AutoBundleRecommendation[]>(() => {
    if (enrichedProducts.length === 0) return [];

    const recommendations: AutoBundleRecommendation[] = [];
    const usedPairs = new Set<string>();

    const profitLeaders = mostProfitableProducts.slice(0, 5);
    const stockTargets = [...overstockProducts, ...deadstockProducts];

    for (const leader of profitLeaders) {
      for (const target of stockTargets) {
        if (recommendations.length >= 6) break;
        // If store only has 1 product total, allow self-bundle (Paket Grosir Hemat 2x)
        if (enrichedProducts.length > 1 && leader.id === target.id) continue;

        const pairKey = [leader.id, target.id].sort().join('__');
        if (usedPairs.has(pairKey)) continue;
        usedPairs.add(pairKey);

        const profitableQty = 1;
        const targetQty = leader.id === target.id ? 2 : target.stock >= leader.stock * 2 ? 2 : 1;

        const totalCostPrice =
          leader.costPrice * profitableQty + target.costPrice * targetQty;
        const totalNormalPrice =
          leader.sellingPrice * profitableQty + target.sellingPrice * targetQty;
        const rawCombinedProfit = totalNormalPrice - totalCostPrice;

        // Calculate safe discount that sacrifices 25%–35% of the combined profit while guaranteeing positive profit above costPrice
        const maxSafeDiscount =
          rawCombinedProfit > 0
            ? Math.floor(rawCombinedProfit * 0.3)
            : Math.floor(totalNormalPrice * 0.05);

        const recommendedBundlePrice = Math.max(
          totalCostPrice + Math.max(500, Math.round(rawCombinedProfit * 0.65)),
          totalNormalPrice - maxSafeDiscount
        );

        const customerSavingsRp = Math.max(0, totalNormalPrice - recommendedBundlePrice);
        const customerSavingsPercent =
          totalNormalPrice > 0
            ? Math.round((customerSavingsRp / totalNormalPrice) * 1000) / 10
            : 0;
        const netBundleProfitRp = recommendedBundlePrice - totalCostPrice;
        const netBundleMarginPercent =
          recommendedBundlePrice > 0
            ? Math.round((netBundleProfitRp / recommendedBundlePrice) * 1000) / 10
            : 0;

        const isTargetDead = target.soldQty === 0;
        const idxNum = String(recommendations.length + 1).padStart(2, '0');

        recommendations.push({
          id: `rec_bundle_${pairKey}`,
          bundleCode: `AI-BND-${idxNum}`,
          bundleName:
            leader.id === target.id
              ? `Paket Twin Hemat ${leader.name}`
              : `Paket Kombo Cuan: ${leader.name} + ${target.name}`,
          strategyType: isTargetDead ? 'PROFIT_X_DEADSTOCK' : 'PROFIT_X_OVERSTOCK',
          badgeLabel: isTargetDead
            ? 'PENYELAMAT DEADSTOCK + MARGIN TINGGI'
            : 'kombinasi PALING MENGUNTUNGKAN + OVERSTOCK',
          profitableProduct: leader,
          profitableQty,
          targetProduct: target,
          targetQty,
          totalCostPrice,
          totalNormalPrice,
          recommendedBundlePrice,
          customerSavingsRp,
          customerSavingsPercent,
          netBundleProfitRp,
          netBundleMarginPercent,
          marketingHook:
            customerSavingsRp > 0
              ? `Beli ${profitableQty}x ${leader.name} + ${targetQty}x ${target.name} Hemat ${fmt(customerSavingsRp)}!`
              : `Paket Spesial ${leader.name} & ${target.name} Harga Grosir!`,
          placementTip: isTargetDead
            ? `Letakkan paket ini tepat di sebelah Kasir POS & Highlight Banner #1 Client PWA agar ${target.name} langsung terlihat pembeli.`
            : `Pasang display bundling di Rak Eye-Level kategori ${leader.category} untuk menyeret stok ${target.name} (${target.stock} unit) ikut terjual cepat.`,
          rationale: `Produk "${leader.name}" memiliki margin untung tinggi (${fmt(leader.unitProfit)}/unit • Penjualan ${fmt(leader.salesRevenue)} di Laporan Kas), sehingga mampu mensubsidi potongan harga untuk mempercepat pencairan stok "${target.name}" (${target.stock} unit tersisa, modal tertahan ${fmt(target.stockAssetValue)}) tanpa merusak laba bersih toko.`,
        });
      }
    }

    return recommendations;
  }, [enrichedProducts, mostProfitableProducts, overstockProducts, deadstockProducts]);

  // Live calculation for Custom Bundle Builder (Produk Paling Menguntungkan + Produk Overstock)
  const customBundleCalc = useMemo(() => {
    const prodA = enrichedProducts.find((p) => p.id === customProfitProdId) || mostProfitableProducts[0];
    const prodB =
      enrichedProducts.find((p) => p.id === customOverstockProdId) ||
      overstockProducts[0] ||
      mostProfitableProducts[0];

    if (!prodA || !prodB) {
      return null;
    }

    const qtyA = Math.max(1, Number(customProfitQty) || 1);
    const qtyB = Math.max(1, Number(customOverstockQty) || 1);
    const totalCost = prodA.costPrice * qtyA + prodB.costPrice * qtyB;
    const totalNormal = prodA.sellingPrice * qtyA + prodB.sellingPrice * qtyB;

    const rawDiscountRp = Math.round(totalNormal * (Math.max(0, Math.min(50, customDiscountPct)) / 100));
    const promoPrice = Math.max(totalCost, totalNormal - rawDiscountRp);
    const actualDiscountRp = Math.max(0, totalNormal - promoPrice);
    const netProfit = promoPrice - totalCost;
    const marginPct = promoPrice > 0 ? Math.round((netProfit / promoPrice) * 1000) / 10 : 0;

    return {
      prodA,
      prodB,
      qtyA,
      qtyB,
      totalCost,
      totalNormal,
      promoPrice,
      actualDiscountRp,
      netProfit,
      marginPct,
      suggestedName:
        customBundleName.trim() || `Paket Bundling ${prodA.name} + ${prodB.name}`,
    };
  }, [
    enrichedProducts,
    mostProfitableProducts,
    overstockProducts,
    customProfitProdId,
    customProfitQty,
    customOverstockProdId,
    customOverstockQty,
    customDiscountPct,
    customBundleName,
  ]);

  // Action: Publish Auto or Custom Bundle directly to Firestore ('stores/store_001/bundles')
  const handlePublishBundleToFirestore = async (rec: {
    idKey: string;
    bundleCode: string;
    bundleName: string;
    description: string;
    quota: number;
    items: Array<{
      product: EnrichedAdvisorProduct;
      qty: number;
    }>;
    totalCostPrice: number;
    totalStandardPrice: number;
    totalPromoPrice: number;
  }) => {
    try {
      setCreatingBundleId(rec.idKey);
      const today = new Date().toISOString().substring(0, 10);
      const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .substring(0, 10);

      const discountRatio =
        rec.totalStandardPrice > 0 ? rec.totalPromoPrice / rec.totalStandardPrice : 1;

      const computedItems: BundleItem[] = rec.items.map(({ product, qty }) => {
        const itemPromoPrice = Math.max(
          product.costPrice,
          Math.round(product.sellingPrice * discountRatio)
        );
        return {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          qty,
          costPrice: product.costPrice,
          sellingPrice: product.sellingPrice,
          promoPrice: itemPromoPrice,
          discount: Math.max(0, product.sellingPrice - itemPromoPrice),
          unit: product.itemsPerCarton > 1 ? 'Dus' : 'Pcs',
        };
      });

      const totalDiscount = Math.max(0, rec.totalStandardPrice - rec.totalPromoPrice);
      const bundleProfit = rec.totalPromoPrice - rec.totalCostPrice;

      const payload = {
        storeId: ACTIVE_STORE_ID,
        bundleCode: rec.bundleCode.toUpperCase(),
        name: rec.bundleName,
        description: rec.description,
        startDate: today,
        endDate: nextMonth,
        quota: rec.quota,
        soldCount: 0,
        items: computedItems,
        totalCostPrice: rec.totalCostPrice,
        totalStandardPrice: rec.totalStandardPrice,
        totalPromoPrice: rec.totalPromoPrice,
        totalDiscount,
        bundleProfit,
        status: 'active',
        source: 'ai_business_advisor',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await addDoc(collection(db, 'stores', ACTIVE_STORE_ID, 'bundles'), payload);
      showToast(
        `Paket Bundling "${rec.bundleName}" berhasil diterbitkan ke database (/dashboard/paket-produk)!`,
        'success'
      );
    } catch (err: any) {
      console.error('Failed to publish AI bundle:', err);
      showToast(`Gagal menerbitkan paket bundling: ${err?.message || 'Error'}`, 'error');
    } finally {
      setCreatingBundleId(null);
    }
  };

  // Action: Apply Strategic Placement for Deadstock Product directly to Firestore
  const handleApplyStrategicPlacement = async (
    product: EnrichedAdvisorProduct,
    newPlacement: string
  ) => {
    try {
      setUpdatingPlacementId(product.id);
      const targetDocId = product.docId || product.id;
      const updatePayload = {
        shelfLocation: newPlacement,
        storageLocation: newPlacement,
        isFeaturedPwa: true,
        strategicPlacementUpdatedAt: new Date().toISOString(),
      };

      await Promise.allSettled([
        setDoc(doc(db, 'products', targetDocId), updatePayload, { merge: true }),
        setDoc(
          doc(db, 'stores', ACTIVE_STORE_ID, 'products', targetDocId),
          updatePayload,
          { merge: true }
        ),
      ]);

      showToast(
        `Lokasi penempatan strategis "${product.name}" berhasil diperbarui ke: "${newPlacement}" & disorot di Etalase PWA!`,
        'success'
      );
    } catch (err: any) {
      showToast(`Gagal memperbarui lokasi penempatan: ${err?.message || 'Error'}`, 'error');
    } finally {
      setUpdatingPlacementId(null);
    }
  };

  // Action: Run Gemini AI Business Advisor Consultation grounded in dailyStats summary docs
  const handleRunAiAdvisorAnalysis = async (customTopic?: string, signal?: AbortSignal) => {
    const cooldown = checkAndRecordAiCooldown('business-advisor');
    if (!cooldown.allowed) {
      showToast(cooldown.message, 'info');
      setAiResponseText(cooldown.message);
      return;
    }

    const promptTopic =
      customTopic ||
      aiPromptInput.trim() ||
      'Berikan strategi marketing & penjualan komprehensif untuk menghabiskan produk overstock/deadstock dan strategi bundling dengan produk paling menguntungkan berdasarkan ringkasan dailyStats.';

    setIsAiGenerating(true);
    try {
      const selectedModel =
        getActiveAgentModel('business-advisor') ||
        appData.defaultAiModel ||
        DEFAULT_GOOGLE_GEMINI_MODEL;
      const systemInstruction =
        getActiveAgentInstruction('business-advisor') ||
        'Anda adalah AI Business Advisor (Penasihat Strategi Bisnis & Marketing Retail) RiskCart.';

      const dailyStatsDocs = await fetchDailyStatsForAiContext(ACTIVE_STORE_ID, 14);
      if (signal?.aborted) return;

      const advisorDataSnapshot = {
        dailyStatsSummaryDocs: dailyStatsDocs,
        ringkasanToko: {
          totalProdukKatalog: enrichedProducts.length,
          totalStokFisikUnit: totalStockUnits,
          totalNilaiAsetModalTertahanRp: totalInventoryCostAsset,
          totalKolomPenjualanLaporanKasRp: totalLaporanKasSalesRevenue,
          totalLabaKotorLaporanKasRp: totalLaporanKasProfit,
          jumlahTransaksiValid: validSalesTransactions.length,
        },
        rekomendasiBundlingOtomatis: autoBundleRecommendations.slice(0, 6).map((b) => ({
          namaPaket: b.bundleName,
          kombinasi: `${b.profitableQty}x ${b.profitableProduct.name} (Untung Tinggi) + ${b.targetQty}x ${b.targetProduct.name} (Stok Banyak/Deadstock)`,
          totalModal: b.totalCostPrice,
          hargaNormal: b.totalNormalPrice,
          hargaBundling: b.recommendedBundlePrice,
          estimasiUntungBersih: b.netBundleProfitRp,
        })),
      };

      const fullQuery = `ATURAN WAJIB PENASIHAT BISNIS:
1. Anda WAJIB menggunakan HANYA data ringkasan dailyStats dan metrik bundling yang dilampirkan pada JSON di bawah ini.
2. Jawab dengan terstruktur mencakup:
   - Strategi Menjual Cepat Produk yang Stoknya Masih Banyak (Overstock)
   - Trik Penjualan & Bundling Berbasis Data (Produk Paling Menguntungkan + Produk Overstock) beserta hitungan Harga Modal, Harga Bundling, dan Estimasi Untung
   - Strategi Penempatan Strategis (Eye-Level, Meja Kasir, Etalase PWA) untuk Produk Deadstock agar langsung terlihat pembeli.

DATA RINGKASAN DAILYSTATS & BUNDLING:
${JSON.stringify(advisorDataSnapshot, null, 2)}

PERTANYAAN / FOKUS ANALISIS:
${promptTopic}`;

      const res = await apiFetch('/api/ai/agent-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          manualTrigger: true,
          agentKey: 'business-advisor',
          agentName: 'AI Business Advisor (Penasihat Bisnis)',
          systemPrompt: systemInstruction,
          query: fullQuery,
          model: selectedModel,
          modelId: selectedModel,
          language: 'id',
        }),
      });

      const data = await res.json();
      if (data?.text) {
        setAiResponseText(data.text);
      } else {
        throw new Error('Empty AI response');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      const topOver = overstockProducts[0];
      const topProfit = mostProfitableProducts[0];
      const topDead = deadstockProducts[0];
      const topBundle = autoBundleRecommendations[0];

      const lines: string[] = [
        `📊 LAPORAN EKSEKUTIF AI BUSINESS ADVISOR (BERBASIS DATA REAL-TIME FIREBASE)`,
        `• Total Katalog (/dashboard/produk): ${enrichedProducts.length} Produk (${totalStockUnits} unit fisik • Nilai Modal Tertahan ${fmt(totalInventoryCostAsset)})`,
        `• Total Kolom Penjualan (/dashboard/laporankas): ${fmt(totalLaporanKasSalesRevenue)} (Estimasi Laba Kotor: ${fmt(totalLaporanKasProfit)})`,
        ``,
        `1. STRATEGI MARKETING & PENJUALAN PRODUK STOK BANYAK (OVERSTOCK):`,
        topOver
          ? `• Fokus Utama: "${topOver.name}" memiliki stok tertinggi (${topOver.stock} unit) dengan modal tertahan ${fmt(topOver.stockAssetValue)} (Harga Modal: ${fmt(topOver.costPrice)}, Harga Jual: ${fmt(topOver.sellingPrice)}, Penjualan di Laporan Kas: ${fmt(topOver.salesRevenue)}). Terapkan Harga Grosir Bertingkat (Beli 3+ diskon 5% menjadi ${fmt(Math.max(topOver.costPrice, Math.round(topOver.sellingPrice * 0.95)))}/unit) sehingga stok cepat cair dan tetap untung ${fmt(Math.max(0, Math.round(topOver.sellingPrice * 0.95) - topOver.costPrice))}/unit.`
          : `• Belum ada produk overstock yang terdeteksi.`,
        ``,
        `2. TRIK PENJUALAN & BUNDLING BERBASIS DATA (PRODUK PALING MENGUNTUNGKAN + OVERSTOCK):`,
        topBundle
          ? `• Paket Rekomendasi: "${topBundle.bundleName}" menggabungkan "${topBundle.profitableProduct.name}" (Margin Untung ${fmt(topBundle.profitableProduct.unitProfit)}/unit) dengan "${topBundle.targetProduct.name}" (Stok ${topBundle.targetProduct.stock} unit). Harga Normal ${fmt(topBundle.totalNormalPrice)} -> Harga Bundling ${fmt(topBundle.recommendedBundlePrice)} (Total Modal ${fmt(topBundle.totalCostPrice)}). Pembeli hemat ${fmt(topBundle.customerSavingsRp)} dan toko tetap meraih Laba Bersih ${fmt(topBundle.netBundleProfitRp)} per paket!`
          : topProfit
          ? `• Jadikan "${topProfit.name}" (Untung ${fmt(topProfit.unitProfit)}/unit) sebagai produk jangkar (anchor) untuk menarik penjualan produk lainnya.`
          : `• Tambahkan produk untuk melihat rekomendasi bundling.`,
        ``,
        `3. STRATEGI PENEMPATAN PRODUK DEADSTOCK AGAR LANGSUNG TERLIHAT PEMBELI:`,
        topDead
          ? `• Produk Deadstock Prioritas: "${topDead.name}" (Stok: ${topDead.stock} unit, Kolom Penjualan Laporan Kas: ${fmt(topDead.salesRevenue)}). Pindahkan segera ke Zona Impulse Meja Kasir POS atau Rak Eye-Level bersebelahan dengan "${topProfit?.name || 'produk terlaris'}", serta sematkan label "Rekomendasi Hemat" di baris pertama Client PWA.`
          : `• Seluruh produk memiliki pergerakan penjualan aktif.`,
      ];
      setAiResponseText(lines.join('\n'));
    } finally {
      setIsAiGenerating(false);
    }
  };

  const aiAdvisorControl = useAiFeatureControl({
    featureKey: 'ai_business_advisor',
    onRun: async (signal) => {
      await handleRunAiAdvisorAnalysis(undefined, signal);
    },
  });

  // Filtered matrix rows
  const filteredMatrixProducts = useMemo(() => {
    if (!searchQuery.trim()) return enrichedProducts;
    const q = searchQuery.toLowerCase();
    return enrichedProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q)
    );
  }, [enrichedProducts, searchQuery]);

  // Helper to recommend strategic placement zone for deadstock product
  const getStrategicPlacementAdvice = (prod: EnrichedAdvisorProduct, bestSellerName?: string) => {
    if (prod.sellingPrice <= 25000) {
      return {
        zoneBadge: 'ZONA 1 • HOTSPOT MEJA KASIR (IMPULSE BUYING)',
        recommendedLocation: `Meja Kasir Utama (Impulse Display) & Banner #1 PWA`,
        whyItWorks: `Karena harga jual "${prod.name}" terjangkau (${fmt(prod.sellingPrice)}), menempatkannya tepat di depan antrean kasir memicu pembelian impulsif saat pelanggan menunggu kembalian/struk.`,
        visualTrick: `Pasang kartu harga kuning kontras bertuliskan "Tambah ${fmt(prod.sellingPrice)} Langsung Bawa Pulang!" di dekat mesin EDC/QRIS.`,
      };
    }
    if (prod.marginPercent >= 20) {
      return {
        zoneBadge: 'ZONA 2 • RAK EYE-LEVEL (SEJAJAR PANDANGAN MATA 130CM)',
        recommendedLocation: `Rak Eye-Level Tengah (Sebelah ${bestSellerName || 'Produk Terlaris'})`,
        whyItWorks: `Produk "${prod.name}" memiliki margin bagus (${prod.marginPercent}% / ${fmt(prod.unitProfit)} per unit) namun tidak terlihat oleh pembeli. Memindahkannya dari rak bawah ke posisi sejajar mata tepat di samping "${bestSellerName || 'produk utama'}" meningkatkan impresi visual hingga 3x lipat.`,
        visualTrick: `Gunakan teknik Shadow Placement: letakkan tepat di sebelah kanan produk yang paling sering dicari pelanggan.`,
      };
    }
    return {
      zoneBadge: 'ZONA 3 • END-CAP GONDOLA DEPAN PINTU MASUK & ETALASE PWA',
      recommendedLocation: `End-Cap Ujung Rak Depan Pintu Masuk & Highlight PWA`,
      whyItWorks: `Stok "${prod.name}" masih menumpuk (${prod.stock} unit • Nilai Modal ${fmt(prod.stockAssetValue)}). Menempatkannya di ujung lorong utama (End-Cap) memastikan 100% pengunjung toko langsung melihat produk ini begitu masuk.`,
      visualTrick: `Susun tumpukan karton massal (Bulk Pyramid Display) dengan penanda harga "Promo Cuci Gudang Stok Terbatas".`,
    };
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`p-4 rounded-xl border text-xs font-bold flex items-center justify-between shadow-lg ${
            toast.type === 'error'
              ? 'bg-rose-950/90 border-rose-700 text-rose-200'
              : 'bg-emerald-950/90 border-emerald-600 text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toast.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-zinc-400 hover:text-white cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* EXECUTIVE HEADER & LIVE DATA SYNC BANNER (/produk & /laporankas)      */}
      {/* ===================================================================== */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-[#1b1509] via-[#110e08] to-[#0a0805] border border-amber-500/40 shadow-[0_0_30px_rgba(245,158,11,0.12)] space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-300 shrink-0 shadow-inner">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/40 text-amber-300 font-mono text-[10px] font-bold uppercase tracking-wider">
                  AI-12 • PENASIHAT BISNIS &amp; STRATEGI PENJUALAN
                </span>
                <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[10px] font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Sinkronisasi Live: /dashboard/produk &amp; /dashboard/laporankas
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-white mt-1.5 tracking-tight">
                AI Business Advisor — Strategi Marketing, Bundling &amp; Optimasi Stok
              </h1>
              <p className="text-xs text-zinc-300 mt-1 max-w-3xl leading-relaxed">
                Penasihat bisnis cerdas berbasis data aktual Firebase: menganalisis{' '}
                <strong className="text-amber-300">Harga Modal &amp; Harga Jual (/dashboard/produk)</strong>{' '}
                serta{' '}
                <strong className="text-emerald-300">Kolom Penjualan (/dashboard/laporankas)</strong>{' '}
                untuk mempercepat penjualan produk overstock, menata penempatan produk deadstock, dan membuat paket bundling otomatis dengan produk paling menguntungkan.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => navigateToPath('/dashboard/produk')}
              className="px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-amber-500/30 text-amber-200 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition"
            >
              <Boxes className="w-3.5 h-3.5 text-amber-400" />
              <span>Cek Harga (/dashboard/produk)</span>
            </button>
            <button
              type="button"
              onClick={() => navigateToPath('/dashboard/laporankas')}
              className="px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-emerald-500/30 text-emerald-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition"
            >
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              <span>Cek Penjualan (/dashboard/laporankas)</span>
            </button>
            <button
              type="button"
              onClick={() => navigateToPath('/dashboard/paket-produk')}
              className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xs flex items-center gap-1.5 cursor-pointer transition shadow-lg shadow-amber-500/20"
            >
              <Package className="w-3.5 h-3.5" />
              <span>Direktori Paket Bundling ({existingBundles.length})</span>
            </button>
          </div>
        </div>

        {/* 5 Real-Time KPI Cards connected to /dashboard/produk & /dashboard/laporankas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 pt-2">
          <div className="p-4 rounded-xl bg-zinc-950/90 border border-amber-500/30 space-y-1">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-amber-300/90">
              <span>Stok Katalog (/produk)</span>
              <Boxes className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-xl font-black text-white font-mono">
              {totalStockUnits.toLocaleString('id-ID')} Unit
            </div>
            <div className="text-[11px] text-zinc-400">
              Dari <strong className="text-white">{enrichedProducts.length}</strong> SKU Produk Aktif
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-950/90 border border-amber-500/30 space-y-1">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-amber-300/90">
              <span>Modal Tertahan di Stok</span>
              <DollarSign className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-xl font-black text-amber-300 font-mono">
              {fmt(totalInventoryCostAsset)}
            </div>
            <div className="text-[11px] text-zinc-400">
              Rumus: <span className="font-mono">Harga Modal &times; Stok</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-950/90 border border-emerald-500/30 space-y-1">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              <span>Kolom Penjualan (/laporankas)</span>
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-black text-emerald-400 font-mono">
              {fmt(totalLaporanKasSalesRevenue)}
            </div>
            <div className="text-[11px] text-zinc-400">
              Laba Kotor: <strong className="text-emerald-300 font-mono">{fmt(totalLaporanKasProfit)}</strong>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-950/90 border border-blue-500/30 space-y-1">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-blue-300">
              <span>Produk Overstock &amp; Deadstock</span>
              <AlertTriangle className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="text-xl font-black text-blue-300 font-mono">
              {overstockProducts.length} Over &bull; {deadstockProducts.length} Dead
            </div>
            <div className="text-[11px] text-zinc-400">
              Prioritas percepatan perputaran stok
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-950/90 border border-purple-500/30 space-y-1">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-purple-300">
              <span>Rekomendasi Bundling AI</span>
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <div className="text-xl font-black text-purple-300 font-mono">
              {autoBundleRecommendations.length} Paket Siap
            </div>
            <div className="text-[11px] text-zinc-400">
              {existingBundles.length} Paket Bundling Aktif di Toko
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* NAVIGATION PILLARS FOR THE 5 ADVISOR TASKS                            */}
      {/* ===================================================================== */}
      <div className="flex flex-wrap items-center gap-2 p-2 rounded-2xl bg-zinc-900/90 border border-zinc-800">
        {[
          {
            id: 'all',
            label: 'Semua Rekomendasi Penasihat Bisnis',
            icon: Award,
          },
          {
            id: 'overstock',
            label: `1. Strategi Jual Produk Stok Banyak (${overstockProducts.length})`,
            icon: Flame,
          },
          {
            id: 'bundling',
            label: `2 & 4. Trik Penjualan & Bundling Produk (${autoBundleRecommendations.length})`,
            icon: Package,
          },
          {
            id: 'deadstock',
            label: `3. Penempatan Strategis Deadstock (${deadstockProducts.length})`,
            icon: MapPin,
          },
          {
            id: 'data_matrix',
            label: `5. Tabel Harga (/produk) vs Kolom Penjualan (/laporankas)`,
            icon: BarChart3,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activePillarTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActivePillarTab(tab.id as any)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer ${
                active
                  ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-zinc-950 shadow-md'
                  : 'bg-zinc-950 text-zinc-300 hover:text-amber-300 border border-zinc-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ===================================================================== */}
      {/* TUGAS 1: STRATEGI MENJUAL BARANG YANG STOK MASIH BANYAK (OVERSTOCK)   */}
      {/* ===================================================================== */}
      {(activePillarTab === 'all' || activePillarTab === 'overstock') && (
        <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                <Flame className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white">
                  1. Saran Strategi Marketing &amp; Penjualan Barang yang Stok Masih Banyak (Overstock)
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Berdasarkan perbandingan sisa stok fisik &amp; Harga Modal di{' '}
                  <span className="font-mono text-amber-300">/dashboard/produk</span> terhadap kecepatan penjualan aktual di{' '}
                  <span className="font-mono text-emerald-300">/dashboard/laporankas</span>.
                </p>
              </div>
            </div>
            <span className="px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono text-xs font-bold">
              Proteksi Margin Aktif (Harga Promo &gt; Harga Modal)
            </span>
          </div>

          {overstockProducts.length === 0 ? (
            <div className="p-8 rounded-xl bg-zinc-950 border border-zinc-800 text-center space-y-2">
              <Boxes className="w-8 h-8 text-zinc-500 mx-auto" />
              <div className="text-sm font-bold text-zinc-300">
                Belum ada produk dengan stok berlebih di katalog.
              </div>
              <p className="text-xs text-zinc-500">
                Tambahkan stok produk di /dashboard/produk untuk mendapatkan rekomendasi pencairan stok.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {overstockProducts.slice(0, 6).map((prod, idx) => {
                // Calculate safe tiered wholesale price that never drops below costPrice
                const safeTierDiscount =
                  prod.unitProfit > 0 ? Math.floor(prod.unitProfit * 0.25) : 0;
                const recommendedTierPrice = Math.max(
                  prod.costPrice,
                  prod.sellingPrice - safeTierDiscount
                );
                const netProfitPerUnitAfterPromo = recommendedTierPrice - prod.costPrice;
                const totalCashUnlockedIfCleared = recommendedTierPrice * prod.stock;
                const totalNetProfitIfCleared = netProfitPerUnitAfterPromo * prod.stock;

                return (
                  <div
                    key={prod.id}
                    className="p-5 rounded-2xl bg-zinc-950 border border-amber-500/30 hover:border-amber-400/60 transition flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold">
                              PRIORITAS OVERSTOCK #{idx + 1}
                            </span>
                            <span className="text-[11px] text-zinc-400 font-mono">
                              SKU: {prod.sku} &bull; {prod.category}
                            </span>
                          </div>
                          <h3 className="text-base font-black text-white mt-1">{prod.name}</h3>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-base font-black text-amber-400 font-mono">
                            Stok: {prod.stock} Unit
                          </div>
                          <div className="text-[10px] text-zinc-400 font-mono">
                            Modal Tertahan: {fmt(prod.stockAssetValue)}
                          </div>
                        </div>
                      </div>

                      {/* Data Harga (/dashboard/produk) & Penjualan (/dashboard/laporankas) */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 text-[11px]">
                        <div>
                          <span className="text-zinc-400 block text-[10px]">Harga Modal (/produk)</span>
                          <span className="font-mono font-bold text-white">
                            {fmt(prod.costPrice)}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block text-[10px]">Harga Jual (/produk)</span>
                          <span className="font-mono font-bold text-amber-300">
                            {fmt(prod.sellingPrice)}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block text-[10px]">Untung / Unit</span>
                          <span className="font-mono font-bold text-emerald-400">
                            +{fmt(prod.unitProfit)} ({prod.marginPercent}%)
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block text-[10px]">Penjualan (/laporankas)</span>
                          <span className="font-mono font-bold text-cyan-300">
                            {fmt(prod.salesRevenue)} ({prod.soldQty}x)
                          </span>
                        </div>
                      </div>

                      {/* Concrete AI Marketing & Sales Advice */}
                      <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-2 text-xs">
                        <div className="font-bold text-amber-300 flex items-center gap-1.5">
                          <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>Saran Strategi Marketing &amp; Penjualan AI:</span>
                        </div>
                        <ul className="space-y-1.5 text-zinc-200 text-[11px] leading-relaxed list-disc pl-4">
                          <li>
                            <strong>Trik Grosir Bertingkat (Tiered Volume Promo):</strong> Tawarkan harga spesial{' '}
                            <strong className="text-amber-300 font-mono">{fmt(recommendedTierPrice)}/unit</strong>{' '}
                            untuk pembelian minimal <strong>3 unit</strong> (harga normal {fmt(prod.sellingPrice)}). Margin tetap aman karena masih di atas Harga Modal ({fmt(prod.costPrice)}) dengan untung bersih{' '}
                            <strong className="text-emerald-400 font-mono">+{fmt(netProfitPerUnitAfterPromo)}/unit</strong>.
                          </li>
                          <li>
                            <strong>Program Kejar Target PWA:</strong> Jadikan <em>{prod.name}</em> sebagai produk pemicu di menu{' '}
                            <span className="font-mono text-amber-200">/dashboard/marketing/hadiah-target</span> agar pelanggan grosir/warung membeli dalam jumlah dus/karton.
                          </li>
                          <li>
                            <strong>Potensi Pencairan Kas:</strong> Jika seluruh {prod.stock} unit terjual dengan harga promo bertingkat ini, toko mencairkan uang tunai sebesar{' '}
                            <strong className="text-white font-mono">{fmt(totalCashUnlockedIfCleared)}</strong>{' '}
                            dan mengantongi laba bersih{' '}
                            <strong className="text-emerald-400 font-mono">+{fmt(totalNetProfitIfCleared)}</strong>.
                          </li>
                        </ul>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800/80">
                      <button
                        type="button"
                        onClick={() => {
                          setCustomOverstockProdId(prod.id);
                          setActivePillarTab('bundling');
                        }}
                        className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-zinc-950 border border-amber-500/40 font-bold text-xs transition cursor-pointer flex items-center gap-1.5"
                      >
                        <Package className="w-3.5 h-3.5" />
                        <span>Masukkan ke Bundling Otomatis</span>
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => navigateToPath('/dashboard/harga-diskon/tambah')}
                          className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs transition cursor-pointer"
                        >
                          Atur Harga Diskon
                        </button>
                        <button
                          type="button"
                          onClick={() => navigateToPath('/dashboard/marketing/hadiah-target/tambah')}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition cursor-pointer"
                        >
                          Buat Promo Target
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TUGAS 2 & 4: TRIK PENJUALAN & BUNDLING OTOMATIS (PROFIT + OVERSTOCK)  */}
      {/* ===================================================================== */}
      {(activePillarTab === 'all' || activePillarTab === 'bundling') && (
        <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400 shrink-0">
                <Package className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white">
                  2 &amp; 4. Trik Penjualan &amp; Generator Bundling Otomatis (Produk Paling Menguntungkan + Produk Overstock)
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Mengawinkan produk dengan margin/keuntungan tertinggi dengan produk yang stoknya masih banyak agar cepat habis tanpa mengorbankan laba bersih toko.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigateToPath('/dashboard/paket-produk')}
              className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer transition shrink-0"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Lihat Paket Bundling Aktif ({existingBundles.length})</span>
            </button>
          </div>

          {/* 3 Data-Driven Sales Tricks Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-zinc-950 border border-purple-500/30 space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Trik Penjualan #1: Subsidi Silang Margin</span>
              </div>
              <div className="text-xs font-bold text-white">
                Produk Margin Tinggi Menarik Produk Overstock
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Gunakan sebagian margin dari produk paling menguntungkan (seperti{' '}
                <strong className="text-amber-300">
                  {mostProfitableProducts[0]?.name || 'Produk Unggulan'}
                </strong>
                ) untuk memberikan diskon psikologis pada produk overstock (seperti{' '}
                <strong className="text-emerald-300">
                  {overstockProducts[0]?.name || 'Produk Stok Banyak'}
                </strong>
                ). Pembeli merasa sangat untung, sementara stok mengendap langsung keluar.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-zinc-950 border border-amber-500/30 space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" />
                <span>Trik Penjualan #2: Tebus Murah di Kasir POS</span>
              </div>
              <div className="text-xs font-bold text-white">
                Upselling Otomatis Saat Belanja Mencapai Ambang Tertentu
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Setiap transaksi di atas rata-rata keranjang belanja pada{' '}
                <span className="font-mono text-zinc-200">/dashboard/laporankas</span>, kasir menawarkan paket bundling tebus murah. Strategi ini terbukti meningkatkan nilai struk (Basket Size) sekaligus menguras stok gudang.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-zinc-950 border border-emerald-500/30 space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Trik Penjualan #3: Harga Coret (Anchor Pricing)</span>
              </div>
              <div className="text-xs font-bold text-white">
                Tampilkan Harga Satuan Normal vs Harga Paket Bundling
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Ketika produk dijual terpisah, pembeli membandingkan harga per unit. Dengan menggabungkan 2 produk dalam 1 Harga Paket di POS &amp; PWA, fokus pembeli beralih pada nominal{' '}
                <strong className="text-emerald-300">&quot;Total Hemat Rupiah&quot;</strong>.
              </p>
            </div>
          </div>

          {/* Auto-Generated Bundle Recommendations Grid */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-amber-300 uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Rekomendasi Paket Bundling Siap Terbit (Berdasarkan Data Harga &amp; Stok Aktual)</span>
            </h3>

            {autoBundleRecommendations.length === 0 ? (
              <div className="p-6 rounded-xl bg-zinc-950 border border-zinc-800 text-center text-xs text-zinc-500">
                Tambahkan minimal 1 produk dengan Harga Modal &amp; Harga Jual di /dashboard/produk untuk membuat rekomendasi paket bundling otomatis.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {autoBundleRecommendations.map((rec) => {
                  const isAlreadyPublished = existingBundles.some(
                    (b) =>
                      b.bundleCode.toUpperCase() === rec.bundleCode.toUpperCase() ||
                      b.name.toLowerCase() === rec.bundleName.toLowerCase()
                  );

                  return (
                    <div
                      key={rec.id}
                      className="p-5 rounded-2xl bg-gradient-to-br from-zinc-950 via-[#120f09] to-zinc-950 border border-amber-500/35 flex flex-col justify-between gap-4 shadow-md"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="px-2.5 py-0.5 rounded-md bg-purple-500/20 border border-purple-400/40 text-purple-300 font-mono text-[10px] font-bold uppercase">
                            {rec.badgeLabel}
                          </span>
                          <span className="font-mono text-xs font-bold text-amber-400">
                            {rec.bundleCode}
                          </span>
                        </div>

                        <h4 className="text-base font-black text-white">{rec.bundleName}</h4>

                        {/* Pairing Breakdown */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 space-y-1">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400 block">
                              🔥 Produk Paling Menguntungkan
                            </span>
                            <div className="text-xs font-bold text-white truncate">
                              {rec.profitableQty}x {rec.profitableProduct.name}
                            </div>
                            <div className="text-[10px] text-zinc-300 font-mono">
                              Modal: {fmt(rec.profitableProduct.costPrice)} | Jual: {fmt(rec.profitableProduct.sellingPrice)}
                            </div>
                            <div className="text-[10px] text-emerald-400 font-mono font-bold">
                              Untung/Unit: +{fmt(rec.profitableProduct.unitProfit)} ({rec.profitableProduct.marginPercent}%)
                            </div>
                          </div>

                          <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 space-y-1">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 block">
                              📦 Produk Overstock / Deadstock
                            </span>
                            <div className="text-xs font-bold text-white truncate">
                              {rec.targetQty}x {rec.targetProduct.name}
                            </div>
                            <div className="text-[10px] text-zinc-300 font-mono">
                              Modal: {fmt(rec.targetProduct.costPrice)} | Jual: {fmt(rec.targetProduct.sellingPrice)}
                            </div>
                            <div className="text-[10px] text-amber-300 font-mono font-bold">
                              Stok Tersisa: {rec.targetProduct.stock} Unit &bull; Terjual: {rec.targetProduct.soldQty}
                            </div>
                          </div>
                        </div>

                        {/* Financial Calculation Box */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px]">
                          <div>
                            <span className="text-zinc-400 text-[10px] block">Total Harga Modal</span>
                            <span className="font-mono font-bold text-zinc-200">
                              {fmt(rec.totalCostPrice)}
                            </span>
                          </div>
                          <div>
                            <span className="text-zinc-400 text-[10px] block">Harga Normal</span>
                            <span className="font-mono font-bold text-zinc-400 line-through">
                              {fmt(rec.totalNormalPrice)}
                            </span>
                          </div>
                          <div>
                            <span className="text-amber-300 text-[10px] font-bold block">
                              Harga Bundling AI
                            </span>
                            <span className="font-mono font-black text-amber-400 text-xs">
                              {fmt(rec.recommendedBundlePrice)}
                            </span>
                          </div>
                          <div>
                            <span className="text-emerald-300 text-[10px] font-bold block">
                              Untung Bersih/Paket
                            </span>
                            <span className="font-mono font-black text-emerald-400 text-xs">
                              +{fmt(rec.netBundleProfitRp)} ({rec.netBundleMarginPercent}%)
                            </span>
                          </div>
                        </div>

                        <p className="text-[11px] text-zinc-300 leading-relaxed">
                          <strong className="text-amber-300">Alasan Data AI:</strong> {rec.rationale}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-zinc-800">
                        <span className="text-[11px] text-emerald-400 font-mono font-bold">
                          Hemat Pembeli: {fmt(rec.customerSavingsRp)} ({rec.customerSavingsPercent}%)
                        </span>

                        <button
                          type="button"
                          disabled={creatingBundleId === rec.id || isAlreadyPublished}
                          onClick={() =>
                            handlePublishBundleToFirestore({
                              idKey: rec.id,
                              bundleCode: rec.bundleCode,
                              bundleName: rec.bundleName,
                              description: `${rec.marketingHook} — ${rec.rationale}`,
                              quota: Math.max(10, Math.min(50, rec.targetProduct.stock || 25)),
                              items: [
                                { product: rec.profitableProduct, qty: rec.profitableQty },
                                { product: rec.targetProduct, qty: rec.targetQty },
                              ],
                              totalCostPrice: rec.totalCostPrice,
                              totalStandardPrice: rec.totalNormalPrice,
                              totalPromoPrice: rec.recommendedBundlePrice,
                            })
                          }
                          className={`px-4 py-2 rounded-xl font-black text-xs flex items-center gap-1.5 transition cursor-pointer ${
                            isAlreadyPublished
                              ? 'bg-emerald-950/80 border border-emerald-600 text-emerald-300 cursor-default'
                              : 'bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-zinc-950 shadow-lg shadow-amber-500/20'
                          }`}
                        >
                          {isAlreadyPublished ? (
                            <>
                              <Check className="w-4 h-4" />
                              <span>Sudah Terbit di Paket Produk</span>
                            </>
                          ) : creatingBundleId === rec.id ? (
                            <span>Menerbitkan...</span>
                          ) : (
                            <>
                              <Plus className="w-4 h-4" />
                              <span>Buat &amp; Terbitkan Paket Bundling Ini</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Interactive Custom Bundle Builder (Produk Paling Menguntungkan + Produk Overstock) */}
          {customBundleCalc && (
            <div className="p-5 rounded-2xl bg-zinc-950 border border-amber-500/40 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                <div>
                  <h3 className="text-sm font-black text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>Kalkulator &amp; Pembuat Bundling Kustom (Produk Menguntungkan + Produk Overstock)</span>
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Pilih kombinasi produk secara bebas, atur diskon paket, dan langsung terbitkan ke katalog{' '}
                    <span className="font-mono text-amber-300">/dashboard/paket-produk</span>.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block text-emerald-300 font-bold mb-1">
                    1. Pilih Produk Paling Menguntungkan
                  </label>
                  <select
                    value={customProfitProdId}
                    onChange={(e) => setCustomProfitProdId(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-400"
                  >
                    {mostProfitableProducts.map((p) => (
                      <option key={`prof-${p.id}`} value={p.id}>
                        {p.name} (Untung +{fmt(p.unitProfit)} • Margin {p.marginPercent}%)
                      </option>
                    ))}
                  </select>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-400">
                    <span>Jumlah di Paket:</span>
                    <input
                      type="number"
                      min={1}
                      value={customProfitQty}
                      onChange={(e) => setCustomProfitQty(Math.max(1, Number(e.target.value) || 1))}
                      className="w-20 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-white font-mono text-right"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-amber-300 font-bold mb-1">
                    2. Pilih Produk Overstock / Stok Banyak
                  </label>
                  <select
                    value={customOverstockProdId}
                    onChange={(e) => setCustomOverstockProdId(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-400"
                  >
                    {overstockProducts.map((p) => (
                      <option key={`over-${p.id}`} value={p.id}>
                        {p.name} (Stok: {p.stock} • Terjual: {p.soldQty})
                      </option>
                    ))}
                  </select>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-400">
                    <span>Jumlah di Paket:</span>
                    <input
                      type="number"
                      min={1}
                      value={customOverstockQty}
                      onChange={(e) =>
                        setCustomOverstockQty(Math.max(1, Number(e.target.value) || 1))
                      }
                      className="w-20 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-white font-mono text-right"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-zinc-300 font-bold mb-1">
                    3. Nama Paket &amp; Kuota Promo
                  </label>
                  <input
                    type="text"
                    value={customBundleName}
                    onChange={(e) => setCustomBundleName(e.target.value)}
                    placeholder={customBundleCalc.suggestedName}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400"
                  />
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-400">
                    <span>Kuota Paket:</span>
                    <input
                      type="number"
                      min={1}
                      value={customBundleQuota}
                      onChange={(e) =>
                        setCustomBundleQuota(Math.max(1, Number(e.target.value) || 10))
                      }
                      className="w-20 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-white font-mono text-right"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-zinc-300 font-bold">4. Diskon Bundling (%)</label>
                    <span className="font-mono font-bold text-amber-400">{customDiscountPct}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={35}
                    step={1}
                    value={customDiscountPct}
                    onChange={(e) => setCustomDiscountPct(Number(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer mt-2"
                  />
                  <div className="text-[10px] text-zinc-400 mt-1">
                    Otomatis dijaga agar tidak di bawah Total Harga Modal ({fmt(customBundleCalc.totalCost)})
                  </div>
                </div>
              </div>

              {/* Automatic Live Summary Bar */}
              <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs flex-1">
                  <div>
                    <span className="text-zinc-400 text-[10px] block">Total Harga Modal Gabungan</span>
                    <span className="font-mono font-bold text-white text-sm">
                      {fmt(customBundleCalc.totalCost)}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-400 text-[10px] block">Total Harga Jual Normal</span>
                    <span className="font-mono font-bold text-zinc-400 line-through text-sm">
                      {fmt(customBundleCalc.totalNormal)}
                    </span>
                  </div>
                  <div>
                    <span className="text-amber-300 text-[10px] font-bold block">
                      Harga Jual Bundling Baru
                    </span>
                    <span className="font-mono font-black text-amber-400 text-sm">
                      {fmt(customBundleCalc.promoPrice)}
                    </span>
                  </div>
                  <div>
                    <span className="text-emerald-300 text-[10px] font-bold block">
                      Grand Total Untung / Paket
                    </span>
                    <span className="font-mono font-black text-emerald-400 text-sm">
                      +{fmt(customBundleCalc.netProfit)} ({customBundleCalc.marginPct}%)
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={creatingBundleId === 'custom_builder'}
                  onClick={() =>
                    handlePublishBundleToFirestore({
                      idKey: 'custom_builder',
                      bundleCode: `BND-AI-${Date.now().toString().slice(-4)}`,
                      bundleName: customBundleCalc.suggestedName,
                      description: `Bundling Strategis AI Business Advisor: ${customBundleCalc.qtyA}x ${customBundleCalc.prodA.name} + ${customBundleCalc.qtyB}x ${customBundleCalc.prodB.name}`,
                      quota: customBundleQuota,
                      items: [
                        { product: customBundleCalc.prodA, qty: customBundleCalc.qtyA },
                        { product: customBundleCalc.prodB, qty: customBundleCalc.qtyB },
                      ],
                      totalCostPrice: customBundleCalc.totalCost,
                      totalStandardPrice: customBundleCalc.totalNormal,
                      totalPromoPrice: customBundleCalc.promoPrice,
                    })
                  }
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-zinc-950 font-black text-xs flex items-center justify-center gap-2 cursor-pointer transition shadow-lg shadow-emerald-500/20 shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>
                    {creatingBundleId === 'custom_builder'
                      ? 'Menyimpan Paket...'
                      : 'Simpan & Terbitkan Bundling Kustom'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TUGAS 3: SARAN PRODUK DEADSTOCK & STRATEGI PENEMPATAN STRATEGIS       */}
      {/* ===================================================================== */}
      {(activePillarTab === 'all' || activePillarTab === 'deadstock') && (
        <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white">
                  3. Rekomendasi Produk Deadstock &amp; Strategi Penempatan Strategis (Agar Pembeli Melihat Langsung)
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Mendeteksi produk dengan stok mengendap namun minim/nol penjualan di{' '}
                  <span className="font-mono text-emerald-300">/dashboard/laporankas</span>, lengkap dengan rekomendasi penataan rak fisik (Eye-Level, Kasir, End-Cap) &amp; posisi teratas Client PWA.
                </p>
              </div>
            </div>
          </div>

          {deadstockProducts.length === 0 ? (
            <div className="p-8 rounded-xl bg-zinc-950 border border-zinc-800 text-center text-xs text-zinc-400">
              Tidak ada produk deadstock yang terdeteksi saat ini.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {deadstockProducts.map((deadProd) => {
                const topSellerName = mostProfitableProducts[0]?.name || 'Produk Terlaris';
                const advice = getStrategicPlacementAdvice(deadProd, topSellerName);
                const selectedLocation =
                  customLocations[deadProd.id] ?? advice.recommendedLocation;

                return (
                  <div
                    key={deadProd.id}
                    className="p-5 rounded-2xl bg-zinc-950 border border-rose-500/30 hover:border-rose-400/60 transition flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="px-2.5 py-0.5 rounded bg-rose-500/20 border border-rose-500/30 text-rose-300 font-mono text-[10px] font-bold">
                            {advice.zoneBadge}
                          </span>
                          <h3 className="text-base font-black text-white mt-1.5">
                            {deadProd.name}
                          </h3>
                          <div className="text-[11px] text-zinc-400 font-mono">
                            SKU: {deadProd.sku} &bull; Kategori: {deadProd.category} &bull; Terakhir Terjual:{' '}
                            <strong className="text-rose-300">{deadProd.lastSoldDate}</strong>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-black text-rose-400 font-mono">
                            Penjualan: {fmt(deadProd.salesRevenue)}
                          </div>
                          <div className="text-[11px] text-amber-300 font-mono font-bold">
                            Stok Mengendap: {deadProd.stock} Unit
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px]">
                        <div>
                          <span className="text-zinc-400 text-[10px] block">Harga Modal / Jual</span>
                          <span className="font-mono font-bold text-white">
                            {fmt(deadProd.costPrice)} / {fmt(deadProd.sellingPrice)}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-400 text-[10px] block">Modal Tertahan</span>
                          <span className="font-mono font-bold text-amber-300">
                            {fmt(deadProd.stockAssetValue)}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-400 text-[10px] block">Lokasi Saat Ini</span>
                          <span className="font-mono font-bold text-emerald-300 truncate block">
                            {deadProd.shelfLocation}
                          </span>
                        </div>
                      </div>

                      {/* Strategic Placement Advice Box */}
                      <div className="p-3.5 rounded-xl bg-rose-950/25 border border-rose-500/25 space-y-2 text-xs">
                        <div className="font-bold text-rose-300 flex items-center gap-1.5">
                          <MapPin className="w-4 h-4 text-rose-400 shrink-0" />
                          <span>Rekomendasi Penempatan Strategis: {advice.recommendedLocation}</span>
                        </div>
                        <p className="text-[11px] text-zinc-200 leading-relaxed">
                          {advice.whyItWorks}
                        </p>
                        <p className="text-[11px] text-amber-300/90 leading-relaxed">
                          <strong>Trik Visual Merchandising:</strong> {advice.visualTrick}
                        </p>
                      </div>
                    </div>

                    {/* 1-Click Update Shelf Location & PWA Spotlight */}
                    <div className="pt-2 border-t border-zinc-800 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <input
                        type="text"
                        value={selectedLocation}
                        onChange={(e) =>
                          setCustomLocations((prev) => ({
                            ...prev,
                            [deadProd.id]: e.target.value,
                          }))
                        }
                        className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
                        placeholder="Lokasi penempatan strategis..."
                      />
                      <button
                        type="button"
                        disabled={updatingPlacementId === deadProd.id}
                        onClick={() => handleApplyStrategicPlacement(deadProd, selectedLocation)}
                        className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition shrink-0"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>
                          {updatingPlacementId === deadProd.id
                            ? 'Menyimpan...'
                            : 'Terapkan Lokasi & Sorot di PWA'}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TUGAS 5: TABEL AUDIT HARGA (/dashboard/produk) VS PENJUALAN (/laporankas) */}
      {/* ===================================================================== */}
      {(activePillarTab === 'all' || activePillarTab === 'data_matrix') && (
        <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-emerald-400" />
                <span>
                  5. Matriks Sinkronisasi Harga (/dashboard/produk) &amp; Kolom Penjualan (/dashboard/laporankas)
                </span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Seluruh keputusan AI Business Advisor di atas dihitung secara live dari tabel perbandingan Harga Modal, Harga Jual, Stok, dan realisasi Kolom Penjualan di bawah ini.
              </p>
            </div>

            <div className="relative w-full md:w-72">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari produk, SKU, atau kategori..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950 text-zinc-400 uppercase text-[10px] font-bold border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Produk &amp; Lokasi Rak</th>
                  <th className="py-3 px-3 text-center">Stok (/produk)</th>
                  <th className="py-3 px-3 text-right">Harga Modal (/produk)</th>
                  <th className="py-3 px-3 text-right">Harga Jual (/produk)</th>
                  <th className="py-3 px-3 text-right">Untung / Unit</th>
                  <th className="py-3 px-3 text-center">Terjual (Qty)</th>
                  <th className="py-3 px-3 text-right">Kolom Penjualan (/laporankas)</th>
                  <th className="py-3 px-3 text-right">Realisasi Laba</th>
                  <th className="py-3 px-4 text-center">Status Analisis AI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80 text-zinc-200">
                {filteredMatrixProducts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-zinc-500">
                      Belum ada data produk yang cocok.
                    </td>
                  </tr>
                ) : (
                  filteredMatrixProducts.map((p) => (
                    <tr key={p.id} className="hover:bg-zinc-800/40 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-white">{p.name}</div>
                        <div className="text-[10px] text-zinc-400 font-mono mt-0.5">
                          SKU: {p.sku} &bull; {p.category} &bull; 📍 {p.shelfLocation}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center font-mono font-bold text-amber-300">
                        {p.stock}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-zinc-300">
                        {fmt(p.costPrice)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-white">
                        {fmt(p.sellingPrice)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-emerald-400">
                        +{fmt(p.unitProfit)} ({p.marginPercent}%)
                      </td>
                      <td className="py-3 px-3 text-center font-mono font-bold text-cyan-300">
                        {p.soldQty}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-black text-emerald-400">
                        {fmt(p.salesRevenue)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-amber-300">
                        {fmt(p.salesProfit)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          {p.isMostProfitable && (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[9px] font-bold">
                              PALING MENGUNTUNGKAN
                            </span>
                          )}
                          {p.isOverstock && (
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[9px] font-bold">
                              OVERSTOCK
                            </span>
                          )}
                          {p.isDeadstock && (
                            <span className="px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[9px] font-bold">
                              DEADSTOCK
                            </span>
                          )}
                          {!p.isMostProfitable && !p.isOverstock && !p.isDeadstock && (
                            <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[9px] font-bold">
                              AKTIF NORMAL
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* INTERACTIVE GEMINI AI BUSINESS ADVISOR CONSULTATION                   */}
      {/* ===================================================================== */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-zinc-900 via-[#14110a] to-zinc-900 border border-amber-500/35 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Konsultasi Interaktif AI Penasihat Bisnis (Gemini AI + Live Firebase)
              </h3>
              <p className="text-xs text-zinc-400">
                Minta AI menyusun strategi kampanye promosi, skrip broadcast WhatsApp, atau simulasi diskon dari data aktual toko Anda.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <AiRunControlBar
              featureLabel="AI Advisor"
              enabled={aiAdvisorControl.enabled}
              isRunning={aiAdvisorControl.isRunning || isAiGenerating}
              onToggle={aiAdvisorControl.toggleEnabled}
              onRun={() => void aiAdvisorControl.runNow()}
            />
            {[
              'Strategi Habiskan Produk Stok Terbanyak Minggu Ini',
              'Rekomendasi Bundling Paling Untung + Deadstock',
              'Tata Letak Rak Toko Agar Deadstock Cepat Laku',
            ].map((quickPrompt) => (
              <button
                key={quickPrompt}
                type="button"
                disabled={aiAdvisorControl.isRunning || isAiGenerating}
                onClick={() => {
                  setAiPromptInput(quickPrompt);
                  void handleRunAiAdvisorAnalysis(quickPrompt);
                }}
                className="px-2.5 py-1 rounded-lg bg-zinc-950 hover:bg-amber-500/20 disabled:opacity-50 border border-amber-500/30 text-amber-200 text-[11px] font-semibold transition cursor-pointer"
              >
                {quickPrompt}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={aiPromptInput}
            onChange={(e) => setAiPromptInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void aiAdvisorControl.runNow()}
            placeholder="Tanyakan strategi penjualan, paket bundling, atau penataan produk deadstock..."
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400"
          />
          <button
            type="button"
            disabled={isAiGenerating || aiAdvisorControl.isRunning}
            onClick={() => void aiAdvisorControl.runNow()}
            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-zinc-950 font-black text-xs flex items-center justify-center gap-2 cursor-pointer transition shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isAiGenerating || aiAdvisorControl.isRunning ? 'Running AI...' : 'Run AI'}</span>
          </button>
        </div>

        {aiResponseText && (
          <div className="p-4 rounded-xl bg-zinc-950 border border-amber-500/30 text-xs text-zinc-200 whitespace-pre-wrap leading-relaxed font-sans">
            {aiResponseText}
          </div>
        )}
      </div>
    </div>
  );
};
