import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Product, Transaction } from '../types';
import { ACTIVE_STORE_ID } from '../config/store';
import { CLEAN_SLATE_STORAGE_KEY, isDatabaseWipeInProgress } from './dataSeeder';
import { deductFefoBatches } from '../utils/expiryUtils';
import { deductRawMaterialsForProductBom } from './rawMaterialService';

export interface ReconciledProductMetrics {
  productId: string;
  name: string;
  sku: string;
  category: string;
  stockInUnits: number;
  piecesPerCarton: number;
  sellByUnit: boolean;
  costPerUnit: number;
  pricePerUnit: number;
  minStockAlert: number;
  unitsSold7d: number;
  dailyVelocity: number;
  daysRemaining: number;
  suggestedCartons: number;
  urgency: 'critical' | 'warning' | 'healthy';
  lastSyncedAt: string;
}

export interface StockSyncSnapshot {
  lastReconciledAt: string;
  reconciledTransactionsCount: number;
  totalProductsSynced: number;
  discrepanciesResolved: number;
  lastCompletedTxId: string | null;
  lastChannel: 'pos' | 'pwa_client' | 'orders' | 'system';
  productMetrics: Record<string, ReconciledProductMetrics>;
}

type SyncListener = (snapshot: StockSyncSnapshot) => void;

const listeners = new Set<SyncListener>();
const inFlightReconciliations = new Set<string>();
const processedCanonicalKeys = new Set<string>();

let serviceStarted = false;
let unsubFunctions: Array<() => void> = [];

let latestRootProducts = new Map<string, any>();
let latestStoreProducts = new Map<string, any>();
let latestRootTransactions = new Map<string, any>();
let latestStoreTransactions = new Map<string, any>();
let latestStoreOrders = new Map<string, any>();
let discrepanciesResolvedCount = 0;

let currentSyncSnapshot: StockSyncSnapshot = {
  lastReconciledAt: new Date().toISOString(),
  reconciledTransactionsCount: 0,
  totalProductsSynced: 0,
  discrepanciesResolved: 0,
  lastCompletedTxId: null,
  lastChannel: 'system',
  productMetrics: {},
};

function notifyListeners() {
  listeners.forEach((listener) => {
    try {
      listener(currentSyncSnapshot);
    } catch (e) {
      console.warn('[StockSyncService] Listener error:', e);
    }
  });
}

export function subscribeToStockSync(listener: SyncListener): () => void {
  listeners.add(listener);
  listener(currentSyncSnapshot);
  return () => {
    listeners.delete(listener);
  };
}

export function getStockSyncSnapshot(): StockSyncSnapshot {
  return currentSyncSnapshot;
}

/**
 * Computes canonical reconciliation key so that a PWA order mirrored between
 * `stores/store_001/orders` and `transactions` is reconciled strictly once.
 */
export function getCanonicalTxKey(docId: string, data: any): string {
  if (data?.canonicalSyncKey) return String(data.canonicalSyncKey);
  if (data?.orderId) return `ORD_${data.orderId}`;
  if (data?.transactionId) return `TX_${data.transactionId}`;
  return `DOC_${docId}`;
}

/**
 * Resolves unified product map from both `products` and `stores/store_001/products`
 * and automatically repairs any stock drift between POS and PWA collections.
 */
async function reconcileProductCatalogParity(): Promise<Map<string, Product>> {
  const unified = new Map<string, Product>();
  const allIds = new Set<string>([
    ...Array.from(latestRootProducts.keys()),
    ...Array.from(latestStoreProducts.keys()),
  ]);

  allIds.forEach((id) => {
    const rootDoc = latestRootProducts.get(id);
    const storeDoc = latestStoreProducts.get(id);

    const rootTime = rootDoc?.updatedAt ? new Date(rootDoc.updatedAt).getTime() : 0;
    const storeTime = storeDoc?.updatedAt ? new Date(storeDoc.updatedAt).getTime() : 0;

    // Pick authoritative record by latest updatedAt timestamp
    const primary = rootTime >= storeTime ? rootDoc || storeDoc : storeDoc || rootDoc;
    if (!primary) return;

    const authoritativeStock = Math.max(
      0,
      Number(primary.stockInUnits ?? primary.stock ?? 0)
    );
    const piecesPerCarton = Math.max(
      1,
      Number(primary.isiPerDus ?? primary.piecesPerCarton ?? primary.itemsPerCarton ?? 1)
    );
    const sellByUnit = primary.sellByUnit !== undefined ? Boolean(primary.sellByUnit) : true;
    const unitCost = Number(primary.costPerUnit ?? primary.costPrice ?? 0);
    const unitPrice = Number(
      primary.pricePerUnit ?? primary.posPrice ?? primary.sellPrice ?? primary.price ?? 0
    );

    unified.set(id, {
      ...primary,
      id,
      name: primary.name || primary.groupName || 'Produk',
      sku: primary.sku || id,
      category: primary.category || 'Umum',
      piecesPerCarton,
      isiPerDus: piecesPerCarton,
      sellByUnit,
      stockInUnits: authoritativeStock,
      costPerUnit: unitCost,
      pricePerUnit: unitPrice,
      pricePerCarton: unitPrice,
      costPerCarton: unitCost,
      minStockAlert: Number(primary.minStockAlert ?? 10),
    } as Product);
  });

  return unified;
}

/**
 * Reconciles a single completed transaction or delivered order idempotently.
 * Ensures stock is deducted strictly once across both `products` and `stores/store_001/products`
 * and records an audit entry in `stock_movements`.
 */
export async function reconcileCompletedTransaction(
  docId: string,
  txData: any,
  sourceCollection: 'transactions' | 'stores/store_001/transactions' | 'stores/store_001/orders',
  options?: { alreadyDeductedInCaller?: boolean }
): Promise<boolean> {
  if (!docId || !txData || isDatabaseWipeInProgress()) return false;

  const canonicalKey = getCanonicalTxKey(docId, txData);
  if (
    txData.stockReconciled === true ||
    processedCanonicalKeys.has(canonicalKey) ||
    inFlightReconciliations.has(canonicalKey)
  ) {
    processedCanonicalKeys.add(canonicalKey);
    return false;
  }

  inFlightReconciliations.add(canonicalKey);

  try {
    // Check persistent ledger in Firestore to prevent duplicate deduction across tabs/devices
    const ledgerRef = doc(db, 'stock_reconciliation_ledger', canonicalKey);
    const ledgerSnap = await getDoc(ledgerRef);
    if (ledgerSnap.exists()) {
      processedCanonicalKeys.add(canonicalKey);
      // Ensure document itself has stockReconciled: true
      try {
        await setDoc(
          doc(db, sourceCollection, docId),
          {
            stockReconciled: true,
            stockReconciledAt: ledgerSnap.data()?.reconciledAt || new Date().toISOString(),
          },
          { merge: true }
        );
      } catch {}
      return false;
    }

    // Gather line items from document array or subcollection
    let items: any[] = Array.isArray(txData.items) ? txData.items : [];
    if (items.length === 0 && sourceCollection !== 'stores/store_001/orders') {
      try {
        const subSnap = await getDocs(collection(db, sourceCollection, docId, 'items'));
        subSnap.forEach((d) => items.push(d.data()));
      } catch {}
    }

    const nowIso = new Date().toISOString();
    const batch = writeBatch(db);
    const deductionsSummary: Array<{
      productId: string;
      productName: string;
      unitsDeducted: number;
      previousStock: number;
      newStock: number;
    }> = [];

    if (!options?.alreadyDeductedInCaller && items.length > 0) {
      // Aggregate units to deduct per productId
      const deductMap = new Map<string, { units: number; name: string }>();

      for (const item of items) {
        const productId = item.productId || item.product?.id || item.id;
        if (!productId || productId === 'PRD-CUSTOM') continue;

        const prod =
          latestRootProducts.get(productId) ||
          latestStoreProducts.get(productId) ||
          item.product;

        const qtyOrdered = Math.max(
          1,
          Number(item.quantityOrdered ?? item.quantity ?? item.qty ?? 1)
        );

        const computedUnits = qtyOrdered;

        const prev = deductMap.get(productId);
        deductMap.set(productId, {
          units: (prev?.units || 0) + computedUnits,
          name: item.productName || item.name || prod?.name || productId,
        });
      }

      deductMap.forEach(({ units, name }, productId) => {
        const rootProd = latestRootProducts.get(productId);
        const storeProd = latestStoreProducts.get(productId);
        // Never create a ghost "Unnamed Product" document if the product no longer exists in catalog
        if (!rootProd && !storeProd) return;

        const baseProd = rootProd || storeProd;
        const currentStock = Math.max(
          0,
          Number(
            rootProd?.stockInUnits ??
              rootProd?.stock ??
              storeProd?.stockInUnits ??
              storeProd?.stock ??
              0
          )
        );
        const fefoRes = deductFefoBatches(
          { ...baseProd, stockInUnits: currentStock },
          units
        );
        const nextStock = fefoRes.nextStock;

        const prodUpdatePayload: Record<string, any> = {
          stockInUnits: nextStock,
          stock: nextStock,
          batches: fefoRes.updatedBatches,
          updatedAt: nowIso,
          lastReconciledTxId: docId,
        };
        if (fefoRes.nearestBatch?.productionDate) {
          prodUpdatePayload.productionDate = fefoRes.nearestBatch.productionDate;
          prodUpdatePayload.tanggalProduksi = fefoRes.nearestBatch.productionDate;
        }
        if (fefoRes.nearestBatch?.expiryDate) {
          prodUpdatePayload.expiryDate = fefoRes.nearestBatch.expiryDate;
          prodUpdatePayload.tanggalKadaluarsa = fefoRes.nearestBatch.expiryDate;
        }

        // Update both root `products` and `stores/store_001/products` atomically
        batch.set(doc(db, 'products', productId), prodUpdatePayload, { merge: true });
        batch.set(doc(db, 'stores/store_001/products', productId), prodUpdatePayload, {
          merge: true,
        });

        // Record audit movement in `stock_movements`
        const movementId = `MOV-${canonicalKey}-${productId}`;
        batch.set(
          doc(db, 'stock_movements', movementId),
          {
            id: movementId,
            storeId: ACTIVE_STORE_ID,
            productId,
            productName: name,
            type: 'sale_deduction',
            channel: txData.channel || (sourceCollection.includes('orders') ? 'pwa_client' : 'pos'),
            transactionId: docId,
            previousStock: currentStock,
            unitsChange: -units,
            newStock: nextStock,
            batchCode: fefoRes.deductedBreakdown[0]?.batchCode || '',
            fefoBatchesUsed: fefoRes.deductedBreakdown,
            createdAt: nowIso,
          },
          { merge: true }
        );

        deductionsSummary.push({
          productId,
          productName: name,
          unitsDeducted: units,
          previousStock: currentStock,
          newStock: nextStock,
        });

        // Auto-deduct Raw Materials (BOM) if product has `hasRawMaterials` & `rawMaterialRecipe`
        if (
          baseProd?.hasRawMaterials &&
          baseProd?.autoDeductRawMaterial !== false &&
          Array.isArray(baseProd?.rawMaterialRecipe) &&
          baseProd.rawMaterialRecipe.length > 0
        ) {
          deductRawMaterialsForProductBom({
            productId,
            productName: name,
            productQtySoldOrProduced: units,
            recipe: baseProd.rawMaterialRecipe,
            referenceId: docId,
            operator: `Transaksi ${txData.channel || 'POS'} (${docId})`,
          }).catch(() => {});
        }
      });
    }

    // Write idempotent ledger entry
    batch.set(ledgerRef, {
      canonicalKey,
      sourceId: docId,
      sourceCollection,
      channel: txData.channel || 'pos',
      reconciledAt: nowIso,
      alreadyDeductedInCaller: Boolean(options?.alreadyDeductedInCaller),
      deductionsSummary,
    });

    // Mark source document as reconciled
    batch.set(
      doc(db, sourceCollection, docId),
      {
        stockReconciled: true,
        stockReconciledAt: nowIso,
        canonicalSyncKey: canonicalKey,
      },
      { merge: true }
    );

    // If linked orderId or transactionId exists, mark the counterpart document reconciled too
    if (txData.orderId && sourceCollection !== 'stores/store_001/orders') {
      batch.set(
        doc(db, 'stores/store_001/orders', String(txData.orderId)),
        {
          stockReconciled: true,
          stockReconciledAt: nowIso,
          canonicalSyncKey: canonicalKey,
        },
        { merge: true }
      );
    }
    if (txData.transactionId && sourceCollection === 'stores/store_001/orders') {
      batch.set(
        doc(db, 'transactions', String(txData.transactionId)),
        {
          stockReconciled: true,
          stockReconciledAt: nowIso,
          canonicalSyncKey: canonicalKey,
        },
        { merge: true }
      );
    }

    await batch.commit();
    processedCanonicalKeys.add(canonicalKey);

    currentSyncSnapshot = {
      ...currentSyncSnapshot,
      lastReconciledAt: nowIso,
      reconciledTransactionsCount: currentSyncSnapshot.reconciledTransactionsCount + 1,
      lastCompletedTxId: docId,
      lastChannel:
        txData.channel === 'pwa_client' || txData.channel === 'pwa'
          ? 'pwa_client'
          : sourceCollection.includes('orders')
          ? 'orders'
          : 'pos',
    };

    await recomputeAndPublishRestockMetrics();
    return true;
  } catch (err) {
    console.warn('[StockSyncService] Error reconciling transaction:', docId, err);
    return false;
  } finally {
    inFlightReconciliations.delete(canonicalKey);
  }
}

/**
 * Recomputes 7-day completed sales velocity across all POS + PWA transactions
 * and publishes unified product stock & velocity metrics so RestockAdvisor and AIHubModule
 * always use identical, reconciled data.
 */
export async function recomputeAndPublishRestockMetrics(): Promise<void> {
  const unifiedCatalog = await reconcileProductCatalogParity();

  // Merge completed transactions from `transactions` and `stores/store_001/transactions`
  // deduplicated by canonical key
  const completedTxByKey = new Map<string, any>();

  const considerTx = (id: string, tx: any) => {
    const status = String(tx?.status || '').toLowerCase();
    const fulfillment = String(tx?.fulfillmentStatus || '').toLowerCase();
    const isRejectedOrCancelled =
      status === 'cancelled' ||
      status === 'rejected' ||
      status === 'void' ||
      status === 'returned' ||
      status === 'refunded';
    if (isRejectedOrCancelled) return;
    const isCompleted =
      status === 'completed' ||
      status === 'delivered' ||
      status === 'terkirim' ||
      status === 'settled' ||
      status === 'new' ||
      status === 'sedang mengemas' ||
      status === 'packing' ||
      status === 'dikirim' ||
      status === 'shipped' ||
      fulfillment === 'completed' ||
      fulfillment === 'terkirim' ||
      fulfillment === 'new' ||
      fulfillment === 'sedang mengemas' ||
      fulfillment === 'dikirim';
    if (!isCompleted) return;
    const key = getCanonicalTxKey(id, tx);
    if (!completedTxByKey.has(key)) {
      completedTxByKey.set(key, { id, ...tx });
    }
  };

  latestRootTransactions.forEach((tx, id) => considerTx(id, tx));
  latestStoreTransactions.forEach((tx, id) => considerTx(id, tx));
  latestStoreOrders.forEach((ord, id) => considerTx(id, ord));

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const unitsSold7dMap = new Map<string, number>();

  completedTxByKey.forEach((tx) => {
    const rawTime = tx.createdAt || tx.timestamp || tx.updatedAt;
    const ts = rawTime ? new Date(rawTime).getTime() : Date.now();
    if (ts < sevenDaysAgo) return;

    const items = Array.isArray(tx.items) ? tx.items : [];
    items.forEach((item: any) => {
      const pId = item.productId || item.product?.id || item.id;
      if (!pId) return;
      const qtyOrdered = Math.max(
        1,
        Number(item.quantityOrdered ?? item.quantity ?? item.qty ?? 1)
      );

      const units = qtyOrdered;

      unitsSold7dMap.set(pId, (unitsSold7dMap.get(pId) || 0) + units);
    });
  });

  const nowIso = new Date().toISOString();
  const metricsMap: Record<string, ReconciledProductMetrics> = {};

  unifiedCatalog.forEach((prod, productId) => {
    const unitsSold7d = unitsSold7dMap.get(productId) || 0;
    const dailyVelocity = Number((unitsSold7d / 7).toFixed(2));
    const stockInUnits = Math.max(0, Number(prod.stockInUnits ?? 0));
    const piecesPerCarton = Math.max(1, Number(prod.piecesPerCarton ?? 1));
    const minStockAlert = Math.max(1, Number(prod.minStockAlert ?? 10));

    const daysRemaining =
      dailyVelocity > 0
        ? Number((stockInUnits / dailyVelocity).toFixed(1))
        : stockInUnits <= minStockAlert
        ? 3
        : 30;

    // Target 14-day stock coverage
    const targetUnits14d = Math.max(minStockAlert * 2, Math.ceil(dailyVelocity * 14));
    const deficitUnits = Math.max(0, targetUnits14d - stockInUnits);
    const suggestedCartons =
      deficitUnits > 0 ? Math.max(1, Math.ceil(deficitUnits / piecesPerCarton)) : 0;

    const urgency: 'critical' | 'warning' | 'healthy' =
      stockInUnits <= minStockAlert || daysRemaining <= 3
        ? 'critical'
        : daysRemaining <= 7 || stockInUnits <= minStockAlert * 1.5
        ? 'warning'
        : 'healthy';

    metricsMap[productId] = {
      productId,
      name: prod.name,
      sku: prod.sku || productId,
      category: prod.category || 'Umum',
      stockInUnits,
      piecesPerCarton,
      sellByUnit: prod.sellByUnit !== false,
      costPerUnit: Number(prod.costPerUnit ?? 0),
      pricePerUnit: Number(prod.pricePerUnit ?? 0),
      minStockAlert,
      unitsSold7d,
      dailyVelocity,
      daysRemaining,
      suggestedCartons,
      urgency,
      lastSyncedAt: nowIso,
    };
  });

  currentSyncSnapshot = {
    ...currentSyncSnapshot,
    lastReconciledAt: nowIso,
    totalProductsSynced: unifiedCatalog.size,
    discrepanciesResolved: discrepanciesResolvedCount,
    productMetrics: metricsMap,
  };

  try {
    localStorage.setItem('riskcart_cache_stock_sync', JSON.stringify(currentSyncSnapshot));
  } catch {}

  notifyListeners();
}

let feedDebounceTimer: any = null;

export function clearStockSyncMemory(): void {
  latestRootProducts = new Map<string, any>();
  latestStoreProducts = new Map<string, any>();
  latestRootTransactions = new Map<string, any>();
  latestStoreTransactions = new Map<string, any>();
  latestStoreOrders = new Map<string, any>();
  processedCanonicalKeys.clear();
  inFlightReconciliations.clear();
  discrepanciesResolvedCount = 0;
  currentSyncSnapshot = {
    lastReconciledAt: new Date().toISOString(),
    reconciledTransactionsCount: 0,
    totalProductsSynced: 0,
    discrepanciesResolved: 0,
    lastCompletedTxId: null,
    lastChannel: 'system',
    productMetrics: {},
  };
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('riskcart_cache_stock_sync');
    }
  } catch {}
  notifyListeners();
}

/**
 * Feeds centralized data from AppDataContext into StockSyncService so zero duplicate
 * Firestore listeners are opened.
 */
export function feedStockSyncData(
  products: any[],
  transactions: any[],
  orders: any[] = []
): void {
  if (Array.isArray(products)) {
    const nextP = new Map<string, any>();
    products.forEach((p) => {
      if (p?.id) nextP.set(p.id, p);
    });
    latestRootProducts = nextP;
    if (products.length === 0) {
      latestStoreProducts = new Map<string, any>();
    }
  }

  if (Array.isArray(transactions)) {
    const nextT = new Map<string, any>();
    transactions.forEach((t) => {
      if (t?.id) nextT.set(t.id, t);
    });
    latestRootTransactions = nextT;
    if (transactions.length === 0) {
      latestStoreTransactions = new Map<string, any>();
    }
  }

  if (Array.isArray(orders)) {
    const nextO = new Map<string, any>();
    orders.forEach((o) => {
      if (o?.id) nextO.set(o.id, o);
    });
    latestStoreOrders = nextO;
  }

  if (feedDebounceTimer) clearTimeout(feedDebounceTimer);
  feedDebounceTimer = setTimeout(() => {
    void recomputeAndPublishRestockMetrics();
  }, 250);
}

/**
 * Starts the centralized background stock synchronization service.
 * Safe to call multiple times (singleton lifecycle).
 * Relies on AppDataContext & localStorage cache to avoid redundant Firestore listeners.
 */
export function startStockSyncService(): () => void {
  if (serviceStarted) {
    return () => {};
  }
  serviceStarted = true;

  const handleCleanSlate = () => {
    clearStockSyncMemory();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('riskcart_clean_slate_wiped', handleCleanSlate);
  }

  try {
    clearStockSyncMemory();
  } catch {}

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('riskcart_clean_slate_wiped', handleCleanSlate);
    }
    unsubFunctions.forEach((fn) => fn());
    unsubFunctions = [];
    serviceStarted = false;
  };
}

/**
 * Helper to update product stock in both `products` and `stores/store_001/products` simultaneously
 * (e.g., when applying a 1-Click Restock in RestockAdvisor).
 */
export async function updateSynchronizedProductStock(
  productId: string,
  newStockInUnits: number,
  reason: string = 'restock'
): Promise<void> {
  const safeStock = Math.max(0, Math.round(Number(newStockInUnits) || 0));
  const nowIso = new Date().toISOString();
  const batch = writeBatch(db);

  batch.set(
    doc(db, 'products', productId),
    {
      stockInUnits: safeStock,
      stock: safeStock,
      updatedAt: nowIso,
    },
    { merge: true }
  );
  batch.set(
    doc(db, 'stores', ACTIVE_STORE_ID, 'products', productId),
    {
      stockInUnits: safeStock,
      stock: safeStock,
      updatedAt: nowIso,
    },
    { merge: true }
  );

  const movementId = `MOV-${reason.toUpperCase()}-${productId}-${Date.now()}`;
  batch.set(doc(db, 'stock_movements', movementId), {
    id: movementId,
    storeId: ACTIVE_STORE_ID,
    productId,
    type: reason,
    newStock: safeStock,
    createdAt: nowIso,
  });

  await batch.commit();
  await recomputeAndPublishRestockMetrics();
}

export {
  roundUpPrice,
  calculateProportionalPrices,
  syncProductPricingFromProcurement,
  type PriceAdjustmentResult,
  type SyncProductProcurementParams,
} from './productService';

import {
  syncProductPricingFromProcurement as runSyncProductPricingFromProcurement,
  type SyncProductProcurementParams as InternalSyncProcurementParams,
} from './productService';

/**
 * Sinkronisasi stok masuk sekaligus Auto-Markup Harga Modal & Harga Jual dari Pembelian Produk
 */
export async function syncStockFromProcurement(
  params: InternalSyncProcurementParams
) {
  const result = await runSyncProductPricingFromProcurement(params);
  if (result && params.productId) {
    const cleanId = String(params.productId).trim();
    const prevRoot = latestRootProducts.get(cleanId) || params.currentProduct || {};
    const mergedProd = { ...prevRoot, ...result.updatedPayload, id: cleanId };
    latestRootProducts.set(cleanId, mergedProd);
    latestStoreProducts.set(cleanId, mergedProd);
    await recomputeAndPublishRestockMetrics();
  }
  return result;
}

export const updateProductFromProcurement = syncStockFromProcurement;

