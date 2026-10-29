import { Product, ProductBatchItem } from '../types';

export type ExpiryStatusLevel = 'expired' | 'critical' | 'warning' | 'safe' | 'unset';

export interface ProductExpiryEvaluation {
  productionDateRaw: string;
  expiryDateRaw: string;
  productionDateFormatted: string;
  expiryDateFormatted: string;
  daysUntilExpiry: number | null;
  totalShelfLifeDays: number | null;
  categoryWarningThresholdDays: number;
  status: ExpiryStatusLevel;
  isNearExpiryAlert: boolean; // true if stock > 0 and daysUntilExpiry <= threshold (30 days)
  isNearExpiry?: boolean;
  isExpired?: boolean;
  isIn14To30Window: boolean; // true if daysUntilExpiry is between 14 and 30 inclusive
  isCriticalUnder14: boolean; // true if daysUntilExpiry < 14 (including expired)
  countdownLabel: string;
  countdownText?: string;
  shelfLifeLabel: string;
  badgeLabel?: string;
  activeBatchCode?: string;
  activeBatchesCount?: number;
}

/**
 * Category Expiry Alert Threshold Rules:
 * - Kategori: Soda    -> Peringatan Kadaluarsa mulai 30 Hari sebelum Tanggal Kadaluarsa
 * - Kategori: Mineral -> Peringatan Kadaluarsa mulai 30 Hari sebelum Tanggal Kadaluarsa
 * - Kategori: Teh     -> Peringatan Kadaluarsa mulai 30 Hari sebelum Tanggal Kadaluarsa
 * - Kategori: Kopi    -> Peringatan Kadaluarsa mulai 30 Hari sebelum Tanggal Kadaluarsa
 * (Applies case-insensitively and defaults to 30 days for all beverage products with an expiry date).
 */
export const CATEGORY_EXPIRY_RULES = [
  { category: 'Soda', warningDays: 30 },
  { category: 'Mineral', warningDays: 30 },
  { category: 'Teh', warningDays: 30 },
  { category: 'Kopi', warningDays: 30 },
] as const;

export function getCategoryExpiryThresholdDays(category?: string): number {
  const norm = String(category || '').trim().toLowerCase();
  if (norm.includes('soda')) return 30;
  if (norm.includes('mineral') || norm.includes('air') || norm.includes('galon')) return 30;
  if (norm.includes('teh') || norm.includes('tea')) return 30;
  if (norm.includes('kopi') || norm.includes('coffee')) return 30;
  return 30;
}

/**
 * Normalizes a date string or Timestamp into YYYY-MM-DD format for <input type="date" />
 */
export function normalizeToInputDate(raw: any): string {
  if (!raw) return '';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return '';
  }
  if (typeof raw?.toDate === 'function') {
    try {
      const d = raw.toDate();
      return normalizeToInputDate(d.toISOString());
    } catch {
      return '';
    }
  }
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

const MONTHS_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

/**
 * Formats a YYYY-MM-DD or ISO date string into "DD MMM YYYY" (e.g., "17 Okt 2026")
 */
export function formatDateDdMmmYyyy(raw?: string | null): string {
  const norm = normalizeToInputDate(raw);
  if (!norm) return '-';
  const [yStr, mStr, dStr] = norm.split('-');
  const year = Number(yStr);
  const monthIdx = Number(mStr) - 1;
  const day = Number(dStr);
  if (!year || monthIdx < 0 || monthIdx > 11 || !day) return norm;
  return `${String(day).padStart(2, '0')} ${MONTHS_ID[monthIdx]} ${year}`;
}

function parseLocalMidnight(yyyyMmDd: string): Date | null {
  const norm = normalizeToInputDate(yyyyMmDd);
  if (!norm) return null;
  const [y, m, d] = norm.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * Generates an automatic FEFO Batch Code with format: BATCH-YYYYMMDD-01
 */
export function generateAutoBatchCode(seqIndex: number = 1, dateStr?: string): string {
  const baseDate = normalizeToInputDate(dateStr) || new Date().toISOString().slice(0, 10);
  const compactDate = baseDate.replace(/-/g, '');
  const seq = String(Math.max(1, seqIndex)).padStart(2, '0');
  return `BATCH-${compactDate}-${seq}`;
}

/**
 * Computes default Production Date (today or existing) and Expiry Date (+180 days from production date if not provided)
 */
export function getDefaultProductionAndExpiryDates(
  existingProdDate?: string | (Partial<Product> & Record<string, any>) | null,
  existingExpDate?: string,
  defaultShelfDays: number = 180
): { productionDate: string; expiryDate: string } {
  let prodInput: any = existingProdDate;
  let expInput: any = existingExpDate;
  if (existingProdDate && typeof existingProdDate === 'object') {
    prodInput = (existingProdDate as any).productionDate ?? (existingProdDate as any).tanggalProduksi ?? '';
    expInput = existingExpDate || (existingProdDate as any).expiryDate || (existingProdDate as any).tanggalKadaluarsa || '';
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  const productionDate = normalizeToInputDate(prodInput) || todayIso;
  let expiryDate = normalizeToInputDate(expInput);
  if (!expiryDate) {
    const prodDt = parseLocalMidnight(productionDate) || new Date();
    const expDt = new Date(prodDt.getTime() + defaultShelfDays * 24 * 60 * 60 * 1000);
    const y = expDt.getFullYear();
    const m = String(expDt.getMonth() + 1).padStart(2, '0');
    const d = String(expDt.getDate()).padStart(2, '0');
    expiryDate = `${y}-${m}-${d}`;
  }
  return { productionDate, expiryDate };
}

/**
 * Returns active FEFO batches for a product, sorted ascending by expiryDate (First Expired, First Out).
 * If a product has stockInUnits > 0 and no batches array (or unallocated stock), synthesizes a default batch
 * so all existing products seamlessly support Multi-Batch FEFO.
 */
export function getSortedFefoBatches(
  product: Partial<Product> & Record<string, any>
): ProductBatchItem[] {
  const stockUnits = Math.max(0, Number(product?.stockInUnits ?? product?.stock ?? 0));
  const rawBatches = Array.isArray(product?.batches) ? product.batches : [];
  const defaultBuyPrice = Number(
    product?.costPerUnit ?? product?.costPrice ?? product?.buyPrice ?? 0
  );

  const validBatches: ProductBatchItem[] = rawBatches
    .map((b: any, idx: number) => ({
      batchCode: String(b?.batchCode || generateAutoBatchCode(idx + 1, b?.receivedAt || product?.createdAt)),
      productionDate: normalizeToInputDate(
        b?.productionDate ?? product?.productionDate ?? product?.tanggalProduksi ?? ''
      ),
      expiryDate: normalizeToInputDate(
        b?.expiryDate ?? product?.expiryDate ?? product?.tanggalKadaluarsa ?? ''
      ),
      qty: Math.max(0, Number(b?.qty ?? 0)),
      initialQty: Math.max(0, Number(b?.initialQty ?? b?.qty ?? 0)),
      buyPrice: Math.max(0, Number(b?.buyPrice ?? defaultBuyPrice)),
      supplier: b?.supplier || '',
      poNumber: b?.poNumber || '',
      receivedAt: b?.receivedAt || '',
    }))
    .filter((b) => b.qty > 0);

  const batchSum = validBatches.reduce((sum, b) => sum + b.qty, 0);

  // If product has physical stock not yet tracked in batches, create/adjust fallback batch
  if (stockUnits > 0 && validBatches.length === 0) {
    const prodRaw = normalizeToInputDate(
      product?.productionDate ?? product?.tanggalProduksi ?? ''
    );
    const expRaw = normalizeToInputDate(
      product?.expiryDate ?? product?.tanggalKadaluarsa ?? ''
    );
    validBatches.push({
      batchCode: generateAutoBatchCode(1, prodRaw || product?.createdAt),
      productionDate: prodRaw,
      expiryDate: expRaw,
      qty: stockUnits,
      initialQty: stockUnits,
      buyPrice: defaultBuyPrice,
      supplier: 'Stok Gudang Utama',
      poNumber: 'INIT-STOCK',
      receivedAt: product?.updatedAt || product?.createdAt || new Date().toISOString(),
    });
  } else if (stockUnits > batchSum && validBatches.length > 0) {
    // Reconcile unallocated units into the latest batch or a reconciliation batch
    const diff = stockUnits - batchSum;
    validBatches[validBatches.length - 1].qty += diff;
  } else if (stockUnits < batchSum && validBatches.length > 0) {
    // Trim excess from earliest batches if stockInUnits was reduced manually
    let toRemove = batchSum - stockUnits;
    validBatches.sort((a, b) => {
      const ea = a.expiryDate || '9999-12-31';
      const eb = b.expiryDate || '9999-12-31';
      return ea.localeCompare(eb);
    });
    for (const b of validBatches) {
      if (toRemove <= 0) break;
      const deduct = Math.min(b.qty, toRemove);
      b.qty -= deduct;
      toRemove -= deduct;
    }
  }

  return validBatches
    .filter((b) => b.qty > 0)
    .sort((a, b) => {
      const ea = a.expiryDate || '9999-12-31';
      const eb = b.expiryDate || '9999-12-31';
      if (ea !== eb) return ea.localeCompare(eb);
      return a.batchCode.localeCompare(b.batchCode);
    });
}

/**
 * Appends or merges newly purchased batches into a product's FEFO batch list,
 * returning the sorted batches, new total stock, earliest FEFO productionDate & expiryDate, and updated HPP.
 */
export function appendOrMergeFefoBatches(
  existingProduct: Partial<Product> & Record<string, any>,
  incomingBatches: ProductBatchItem[]
): {
  batches: ProductBatchItem[];
  totalStock: number;
  productionDate: string;
  expiryDate: string;
  earliestProductionDate?: string;
  earliestExpiryDate?: string;
  costPerUnit: number;
} {
  const currentBatches = getSortedFefoBatches(existingProduct);
  const mergedMap = new Map<string, ProductBatchItem>();

  currentBatches.forEach((b) => {
    const key = `${b.batchCode.trim().toUpperCase()}__${b.expiryDate}`;
    mergedMap.set(key, { ...b });
  });

  incomingBatches.forEach((inc, idx) => {
    const qty = Math.max(0, Number(inc.qty || 0));
    if (qty <= 0) return;
    const cleanCode = (inc.batchCode || generateAutoBatchCode(idx + 1)).trim();
    const cleanProd = normalizeToInputDate(inc.productionDate);
    const cleanExp = normalizeToInputDate(inc.expiryDate);
    const key = `${cleanCode.toUpperCase()}__${cleanExp}`;
    const existing = mergedMap.get(key);
    if (existing) {
      existing.qty += qty;
      existing.initialQty = (existing.initialQty || 0) + qty;
      if (inc.buyPrice > 0) existing.buyPrice = inc.buyPrice;
      if (inc.supplier) existing.supplier = inc.supplier;
      if (inc.poNumber) existing.poNumber = inc.poNumber;
      if (inc.receivedAt) existing.receivedAt = inc.receivedAt;
    } else {
      mergedMap.set(key, {
        batchCode: cleanCode,
        productionDate: cleanProd,
        expiryDate: cleanExp,
        qty,
        initialQty: qty,
        buyPrice: Math.max(
          0,
          Number(inc.buyPrice || existingProduct?.costPerUnit || existingProduct?.costPrice || 0)
        ),
        supplier: inc.supplier || '',
        poNumber: inc.poNumber || '',
        receivedAt: inc.receivedAt || new Date().toISOString(),
      });
    }
  });

  const sorted = Array.from(mergedMap.values())
    .filter((b) => b.qty > 0)
    .sort((a, b) => {
      const ea = a.expiryDate || '9999-12-31';
      const eb = b.expiryDate || '9999-12-31';
      if (ea !== eb) return ea.localeCompare(eb);
      return a.batchCode.localeCompare(b.batchCode);
    });

  const totalStock = sorted.reduce((s, b) => s + b.qty, 0);
  const earliestBatch = sorted[0] || null;
  const productionDate =
    earliestBatch?.productionDate ||
    normalizeToInputDate(existingProduct?.productionDate ?? existingProduct?.tanggalProduksi ?? '');
  const expiryDate =
    earliestBatch?.expiryDate ||
    normalizeToInputDate(existingProduct?.expiryDate ?? existingProduct?.tanggalKadaluarsa ?? '');

  // Calculate latest or weighted HPP
  const latestIncomingWithCost = [...incomingBatches].reverse().find((b) => b.buyPrice > 0);
  const costPerUnit =
    latestIncomingWithCost?.buyPrice ||
    Number(existingProduct?.costPerUnit ?? existingProduct?.costPrice ?? 0);

  return {
    batches: sorted,
    totalStock,
    productionDate,
    expiryDate,
    earliestProductionDate: productionDate,
    earliestExpiryDate: expiryDate,
    costPerUnit,
  };
}

/**
 * Alias for getSortedFefoBatches returning active FEFO batches sorted ascending by expiryDate.
 */
export function getActiveProductBatches(
  product: Partial<Product> & Record<string, any>
): ProductBatchItem[] {
  return getSortedFefoBatches(product);
}

/**
 * Merges a single incoming ProductBatchItem into a product's FEFO batch array.
 */
export function mergeBatchIntoProduct(
  existingProduct: Partial<Product> & Record<string, any>,
  incomingBatch: ProductBatchItem
) {
  return appendOrMergeFefoBatches(existingProduct, [incomingBatch]);
}

/**
 * Deducts `unitsToDeduct` from a product's batches using strict FEFO (First Expired, First Out).
 * Automatically depletes the earliest expiring batch first and spills over to the next batch if needed.
 */
export function deductFefoBatches(
  product: Partial<Product> & Record<string, any>,
  unitsToDeduct: number
): {
  updatedBatches: ProductBatchItem[];
  deductedBreakdown: Array<{
    batchCode: string;
    deductedQty: number;
    remainingQty: number;
    productionDate: string;
    expiryDate: string;
    buyPrice: number;
  }>;
  nextStock: number;
  nearestBatch: ProductBatchItem | null;
  earliestProductionDate: string;
  earliestExpiryDate: string;
} {
  const sorted = getSortedFefoBatches(product).map((b) => ({ ...b }));
  const currentTotal = Math.max(0, Number(product?.stockInUnits ?? product?.stock ?? 0));
  let remainingToDeduct = Math.max(0, Number(unitsToDeduct || 0));
  const deductedBreakdown: Array<{
    batchCode: string;
    deductedQty: number;
    remainingQty: number;
    productionDate: string;
    expiryDate: string;
    buyPrice: number;
  }> = [];

  for (const batch of sorted) {
    if (remainingToDeduct <= 0) break;
    if (batch.qty <= 0) continue;
    const take = Math.min(batch.qty, remainingToDeduct);
    batch.qty -= take;
    remainingToDeduct -= take;
    deductedBreakdown.push({
      batchCode: batch.batchCode,
      deductedQty: take,
      remainingQty: batch.qty,
      productionDate: batch.productionDate,
      expiryDate: batch.expiryDate,
      buyPrice: batch.buyPrice,
    });
  }

  const updatedBatches = sorted.filter((b) => b.qty > 0);
  const nextStock = Math.max(0, currentTotal - Math.max(0, Number(unitsToDeduct || 0)));
  const nearestBatch = updatedBatches[0] || null;
  const earliestProductionDate =
    nearestBatch?.productionDate ||
    normalizeToInputDate(product?.productionDate ?? product?.tanggalProduksi ?? '');
  const earliestExpiryDate =
    nearestBatch?.expiryDate ||
    normalizeToInputDate(product?.expiryDate ?? product?.tanggalKadaluarsa ?? '');

  return {
    updatedBatches,
    deductedBreakdown,
    nextStock,
    nearestBatch,
    earliestProductionDate,
    earliestExpiryDate,
  };
}

/**
 * Evaluates a product's production date, expiry date, shelf life, and real-time countdown.
 * Automatically prioritizes the earliest expiring active FEFO batch if `product.batches` exists.
 */
export function evaluateProductExpiry(
  product: Partial<Product> & Record<string, any>,
  referenceDate: Date = new Date()
): ProductExpiryEvaluation {
  const fefoBatches = Array.isArray(product?.batches) && product.batches.length > 0
    ? getSortedFefoBatches(product)
    : [];
  const primaryBatch = fefoBatches[0] || null;

  const productionDateRaw = normalizeToInputDate(
    primaryBatch?.productionDate ||
      product.productionDate ||
      product.tanggalProduksi ||
      ''
  );
  const expiryDateRaw = normalizeToInputDate(
    primaryBatch?.expiryDate ||
      product.expiryDate ||
      product.tanggalKadaluarsa ||
      ''
  );

  const categoryWarningThresholdDays = getCategoryExpiryThresholdDays(product.category);
  const stockUnits = Math.max(0, Number(product.stockInUnits ?? product.stock ?? 0));

  const todayMidnight = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    0,
    0,
    0,
    0
  );

  const prodMidnight = parseLocalMidnight(productionDateRaw);
  const expMidnight = parseLocalMidnight(expiryDateRaw);

  let daysUntilExpiry: number | null = null;
  let totalShelfLifeDays: number | null = null;

  if (expMidnight) {
    const diffMs = expMidnight.getTime() - todayMidnight.getTime();
    daysUntilExpiry = Math.round(diffMs / (1000 * 60 * 60 * 24));
  }

  if (prodMidnight && expMidnight) {
    const shelfMs = expMidnight.getTime() - prodMidnight.getTime();
    totalShelfLifeDays = Math.max(0, Math.round(shelfMs / (1000 * 60 * 60 * 24)));
  }

  let status: ExpiryStatusLevel = 'unset';
  let countdownLabel = 'Belum Diatur';

  if (daysUntilExpiry !== null) {
    if (daysUntilExpiry < 0) {
      status = 'expired';
      countdownLabel = `Expired (${Math.abs(daysUntilExpiry)} hari lalu)`;
    } else if (daysUntilExpiry === 0) {
      status = 'expired';
      countdownLabel = 'Expired Hari Ini (0 hari)';
    } else if (daysUntilExpiry < 14) {
      status = 'critical';
      countdownLabel = `${daysUntilExpiry} hari lagi (Kritis < 14 hari)`;
    } else if (daysUntilExpiry <= categoryWarningThresholdDays) {
      status = 'warning';
      countdownLabel = `${daysUntilExpiry} hari lagi (Waspada 14-30 hari)`;
    } else {
      status = 'safe';
      countdownLabel = `${daysUntilExpiry} hari lagi (Aman)`;
    }
  }

  const shelfLifeLabel =
    totalShelfLifeDays !== null ? `Masa simpan: ${totalShelfLifeDays} hari` : '';

  const isIn14To30Window =
    daysUntilExpiry !== null &&
    daysUntilExpiry >= 14 &&
    daysUntilExpiry <= categoryWarningThresholdDays;

  const isCriticalUnder14 = daysUntilExpiry !== null && daysUntilExpiry < 14;

  const isNearExpiryAlert =
    stockUnits > 0 &&
    daysUntilExpiry !== null &&
    daysUntilExpiry <= categoryWarningThresholdDays;

  return {
    productionDateRaw,
    expiryDateRaw,
    productionDateFormatted: formatDateDdMmmYyyy(productionDateRaw),
    expiryDateFormatted: formatDateDdMmmYyyy(expiryDateRaw),
    daysUntilExpiry,
    totalShelfLifeDays,
    categoryWarningThresholdDays,
    status,
    isNearExpiryAlert,
    isNearExpiry: isNearExpiryAlert,
    isExpired: status === 'expired',
    isIn14To30Window,
    isCriticalUnder14,
    countdownLabel,
    countdownText: countdownLabel,
    shelfLifeLabel,
    badgeLabel:
      status === 'expired'
        ? 'Kadaluarsa'
        : status === 'critical'
        ? 'Kritis'
        : status === 'warning'
        ? 'Waspada'
        : 'Aman',
    activeBatchCode: primaryBatch?.batchCode,
    activeBatchesCount: fefoBatches.length,
  };
}

