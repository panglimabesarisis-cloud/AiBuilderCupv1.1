import { Product } from '../types';
import { ACTIVE_STORE_ID } from '../config/store';

export interface ProductVariantItem {
  id: string; // Exact Firestore document ID
  docId?: string; // Explicit Firestore document ID
  sku: string;
  name: string;
  category: string;
  brand: string;
  costPrice: number;
  sellPrice: number;
  posPrice: number;
  pwaPrice: number;
  stock: number;
  itemsPerCarton: number;
  isiPerDus?: number;
  weightMl: number;
  beratPerItem?: number;
  totalBeratKg?: number;
  isActive: boolean;
  isPosVisible: boolean;
  isPwaVisible: boolean;
  imageUrl?: string;
  galleryUrls?: string[];
  galleryImages?: string[];
  deliveryCommission?: number;
  trackStockCard?: boolean;
  sellByUnit?: boolean;
  mainUnit?: string;
  subUnit?: string;
  piecesPerCarton?: number;
  pricePerCarton?: number;
  pricePerUnit?: number;
  costPerCarton?: number;
  costPerUnit?: number;
  stockInUnits?: number;
  cartonWholesalePrice?: number;
  shelfLocation?: string;
  storageLocation?: string;
  minStock?: number;
  minStockAlert?: number;
  variantGroupId?: string;
  groupName?: string;
  variantType?: string;
  variantName?: string;
  productionDate?: string;
  tanggalProduksi?: string;
  expiryDate?: string;
  tanggalKadaluarsa?: string;
  description?: string;
  batchCode?: string;
  batches?: any[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductGroupItem {
  id: string; // Exact Firestore document ID for standalone, or grp_<variantGroupId> for multi-variant group
  docId?: string; // Exact Firestore document ID for standalone product
  docIds?: string[]; // Exact Firestore document IDs for all documents in this group
  editingVariantId?: string; // Set when editing a specific variant inside a group
  name: string;
  category: string;
  brand: string;
  hasVariants: boolean;
  sku?: string;
  imageUrl?: string;
  galleryUrls?: string[];
  galleryImages?: string[];
  costPrice?: number;
  sellPrice?: number;
  posPrice?: number;
  pwaPrice?: number;
  sellPriceRange?: string;
  costPriceRange?: string;
  totalStock: number;
  itemsPerCarton?: number;
  isiPerDus?: number;
  weightMl?: number;
  beratPerItem?: number;
  totalBeratKg?: number;
  isActive?: boolean;
  isPosVisible?: boolean;
  isPwaVisible?: boolean;
  deliveryCommission?: number;
  trackStockCard?: boolean;
  sellByUnit?: boolean;
  mainUnit?: string;
  subUnit?: string;
  piecesPerCarton?: number;
  pricePerCarton?: number;
  pricePerUnit?: number;
  costPerCarton?: number;
  costPerUnit?: number;
  stockInUnits?: number;
  cartonWholesalePrice?: number;
  shelfLocation?: string;
  storageLocation?: string;
  minStock?: number;
  minStockAlert?: number;
  variantGroupId?: string;
  groupName?: string;
  variantType?: string;
  variantName?: string;
  productionDate?: string;
  tanggalProduksi?: string;
  expiryDate?: string;
  tanggalKadaluarsa?: string;
  description?: string;
  batchCode?: string;
  batches?: any[];
  createdAt?: string;
  updatedAt?: string;
  variants?: ProductVariantItem[];
}

/**
 * Maps a single Firestore Product document to a ProductVariantItem,
 * strictly preserving the real Firestore document ID (`p.id`).
 */
export function productToVariant(p: Product): ProductVariantItem {
  const raw = p as any;
  const docId = p.id || raw._id || p.sku;
  const sku = p.sku || docId;
  const sellPrice = Number(raw.posPrice ?? raw.sellPrice ?? p.pricePerUnit ?? raw.price ?? 0);
  const posPrice = Number(raw.posPrice ?? sellPrice);
  const pwaPrice = Number(raw.pwaPrice ?? sellPrice);
  const costPrice = Number(raw.costPrice ?? p.costPerUnit ?? 0);
  const stock = Number(raw.stock ?? p.stockInUnits ?? 0);
  const itemsPerCarton = Math.max(
    1,
    Number(raw.isiPerDus ?? raw.itemsPerCarton ?? p.piecesPerCarton ?? 1)
  );
  const weightMl = Number(raw.beratPerItem ?? p.weightMl ?? 0);
  const totalBeratKg =
    raw.totalBeratKg !== undefined && raw.totalBeratKg !== null
      ? Number(raw.totalBeratKg)
      : Number(((weightMl * itemsPerCarton) / 1000).toFixed(2));
  const pricePerCarton = sellPrice;
  const cartonWholesalePrice = sellPrice;
  const costPerCarton = costPrice;
  const galleryUrls = Array.isArray(p.galleryUrls)
    ? p.galleryUrls
    : Array.isArray(p.galleryImages)
    ? p.galleryImages
    : [];
  const shelfLocation = (p.shelfLocation ?? p.storageLocation ?? '').trim();
  const minStock = Number(p.minStock ?? p.minStockAlert ?? 10);
  const groupName = p.groupName;
  const derivedVariantName =
    p.variantName ||
    (groupName && p.name && p.name.toLowerCase().startsWith(groupName.toLowerCase() + ' ')
      ? p.name.slice(groupName.length).trim()
      : p.name);

  return {
    id: docId,
    docId: docId,
    sku: sku,
    name: p.name || 'Unnamed Product',
    category: p.category || 'GENERAL',
    brand: p.brand || '',
    costPrice,
    sellPrice,
    posPrice,
    pwaPrice,
    stock,
    itemsPerCarton,
    isiPerDus: itemsPerCarton,
    piecesPerCarton: itemsPerCarton,
    pricePerCarton,
    pricePerUnit: sellPrice,
    costPerCarton,
    costPerUnit: costPrice,
    sellByUnit: p.sellByUnit !== false,
    stockInUnits: stock,
    trackStockCard: p.trackStockCard !== false,
    cartonWholesalePrice,
    shelfLocation,
    storageLocation: shelfLocation,
    minStock,
    minStockAlert: minStock,
    weightMl,
    beratPerItem: weightMl,
    totalBeratKg,
    isActive: p.isActive !== false,
    isPosVisible: p.isPosVisible !== false,
    isPwaVisible: p.isPwaVisible !== false,
    imageUrl: p.imageUrl,
    galleryUrls,
    galleryImages: galleryUrls,
    deliveryCommission: Number(p.deliveryCommission ?? raw.deliveryCommission ?? 0),
    mainUnit: p.mainUnit || 'Dus',
    subUnit: p.subUnit || 'Unit',
    variantType: p.variantType,
    variantName: derivedVariantName,
    variantGroupId: p.variantGroupId,
    groupName: p.groupName,
    productionDate: raw.productionDate ?? raw.tanggalProduksi ?? '',
    tanggalProduksi: raw.tanggalProduksi ?? raw.productionDate ?? '',
    expiryDate: raw.expiryDate ?? raw.tanggalKadaluarsa ?? '',
    tanggalKadaluarsa: raw.tanggalKadaluarsa ?? raw.expiryDate ?? '',
    description: raw.description ?? '',
    batchCode: raw.batchCode ?? raw.batches?.[0]?.batchCode ?? '',
    batches: Array.isArray(raw.batches) ? raw.batches : undefined,
    createdAt: raw.createdAt?.toDate ? raw.createdAt.toDate().toISOString() : p.createdAt,
    updatedAt: raw.updatedAt?.toDate ? raw.updatedAt.toDate().toISOString() : p.updatedAt,
  };
}

/**
 * Maps a ProductVariantItem back to a Firestore Product document
 */
export function variantToProduct(
  v: Partial<ProductVariantItem> & { name: string },
  overrides?: Partial<Product>
): Product {
  const nowISO = new Date().toISOString();
  const sku = (v.sku || overrides?.sku || `SKU-${Date.now()}`).trim();
  const docId = overrides?.id || v.docId || v.id || sku;
  const sellPrice = Number(
    v.pricePerUnit ?? v.sellPrice ?? v.posPrice ?? v.pwaPrice ?? overrides?.pricePerUnit ?? 0
  );
  const posPrice = Number(v.posPrice ?? sellPrice);
  const pwaPrice = Number(v.pwaPrice ?? sellPrice);
  const costPrice = Number(v.costPerUnit ?? v.costPrice ?? overrides?.costPerUnit ?? 0);
  const stock = Number(v.stockInUnits ?? v.stock ?? overrides?.stockInUnits ?? 0);
  const itemsPerCarton = Math.max(
    1,
    Number(
      v.isiPerDus ??
        v.itemsPerCarton ??
        v.piecesPerCarton ??
        overrides?.isiPerDus ??
        overrides?.piecesPerCarton ??
        1
    )
  );
  const weightMl = Number(
    v.beratPerItem ?? v.weightMl ?? overrides?.beratPerItem ?? overrides?.weightMl ?? 0
  );
  const totalBeratKg =
    v.totalBeratKg !== undefined && v.totalBeratKg !== null
      ? Number(v.totalBeratKg)
      : overrides?.totalBeratKg !== undefined && overrides?.totalBeratKg !== null
      ? Number(overrides.totalBeratKg)
      : Number(((weightMl * itemsPerCarton) / 1000).toFixed(2));
  const pricePerCarton = sellPrice;
  const cartonWholesalePrice = sellPrice;
  const costPerCarton = costPrice;

  const galleryUrls = Array.isArray(v.galleryUrls)
    ? v.galleryUrls
    : Array.isArray(v.galleryImages)
    ? v.galleryImages
    : Array.isArray(overrides?.galleryUrls)
    ? overrides.galleryUrls
    : Array.isArray(overrides?.galleryImages)
    ? overrides.galleryImages
    : [];

  const shelfLocation = (
    v.shelfLocation ??
    v.storageLocation ??
    overrides?.shelfLocation ??
    overrides?.storageLocation ??
    ''
  ).trim();

  const minStock = Number(
    overrides?.minStock ??
      overrides?.minStockAlert ??
      v.minStock ??
      v.minStockAlert ??
      10
  );

  return {
    id: docId,
    storeId: overrides?.storeId || ACTIVE_STORE_ID,
    name: v.name.trim(),
    sku: sku,
    category: v.category || overrides?.category || 'GENERAL',
    barcode: overrides?.barcode || sku,
    piecesPerCarton: itemsPerCarton,
    isiPerDus: itemsPerCarton,
    stockInUnits: stock,
    costPerUnit: costPrice,
    pricePerUnit: sellPrice,
    posPrice: posPrice,
    pwaPrice: pwaPrice,
    pricePerCarton,
    cartonWholesalePrice,
    minStockAlert: minStock,
    minStock,
    imageUrl: v.imageUrl || overrides?.imageUrl || '',
    galleryUrls,
    galleryImages: galleryUrls,
    storageLocation: shelfLocation,
    shelfLocation,
    brand: v.brand !== undefined ? v.brand : (overrides?.brand || ''),
    isActive: v.isActive !== false,
    isPosVisible: v.isPosVisible !== false,
    isPwaVisible: v.isPwaVisible !== false,
    weightMl,
    beratPerItem: weightMl,
    totalBeratKg,
    deliveryCommission: Number(v.deliveryCommission ?? overrides?.deliveryCommission ?? 0),
    trackStockCard: (v.trackStockCard ?? overrides?.trackStockCard) !== false,
    sellByUnit: (v.sellByUnit ?? overrides?.sellByUnit) !== false,
    mainUnit: v.mainUnit || overrides?.mainUnit || 'Dus',
    subUnit: v.subUnit || overrides?.subUnit || 'Unit',
    costPerCarton,
    ...(v.variantType ?? overrides?.variantType
      ? { variantType: v.variantType ?? overrides?.variantType }
      : {}),
    ...(v.variantName ?? overrides?.variantName
      ? { variantName: v.variantName ?? overrides?.variantName }
      : {}),
    ...(v.variantGroupId ?? overrides?.variantGroupId
      ? { variantGroupId: v.variantGroupId ?? overrides?.variantGroupId }
      : {}),
    ...(v.groupName ?? overrides?.groupName
      ? { groupName: v.groupName ?? overrides?.groupName }
      : {}),
    productionDate:
      v.productionDate ??
      v.tanggalProduksi ??
      overrides?.productionDate ??
      overrides?.tanggalProduksi ??
      '',
    tanggalProduksi:
      v.tanggalProduksi ??
      v.productionDate ??
      overrides?.tanggalProduksi ??
      overrides?.productionDate ??
      '',
    expiryDate:
      v.expiryDate ??
      v.tanggalKadaluarsa ??
      overrides?.expiryDate ??
      overrides?.tanggalKadaluarsa ??
      '',
    tanggalKadaluarsa:
      v.tanggalKadaluarsa ??
      v.expiryDate ??
      overrides?.tanggalKadaluarsa ??
      overrides?.expiryDate ??
      '',
    createdAt: v.createdAt || overrides?.createdAt || nowISO,
    updatedAt: v.updatedAt || overrides?.updatedAt || nowISO,
    ...(overrides
      ? Object.fromEntries(
          Object.entries(overrides).filter(([_, val]) => val !== undefined)
        )
      : {}),
  };
}

function buildMultiVariantGroupItem(
  groupId: string,
  groupName: string,
  brandName: string,
  items: Product[],
  variantGroupId?: string
): ProductGroupItem {
  const variants = items.map(productToVariant);
  const totalStock = variants.reduce((sum, v) => sum + (v.stock || 0), 0);

  const sellPrices = variants.map((v) => v.sellPrice ?? 0);
  const minSell = Math.min(...sellPrices);
  const maxSell = Math.max(...sellPrices);
  const sellPriceRange =
    minSell === maxSell
      ? `Rp ${minSell.toLocaleString('id-ID')}`
      : `Rp ${minSell.toLocaleString('id-ID')} - Rp ${maxSell.toLocaleString('id-ID')}`;

  const costPrices = variants.map((v) => v.costPrice ?? 0);
  const minCost = Math.min(...costPrices);
  const maxCost = Math.max(...costPrices);
  const costPriceRange =
    minCost === maxCost
      ? `Rp ${minCost.toLocaleString('id-ID')}`
      : `Rp ${minCost.toLocaleString('id-ID')} - Rp ${maxCost.toLocaleString('id-ID')}`;

  const createdDates = variants.map((v) => v.createdAt).filter(Boolean) as string[];
  createdDates.sort();

  const first = variants[0];
  return {
    id: groupId,
    docIds: variants.map((v) => v.id),
    name: groupName,
    category: first.category || 'GENERAL',
    brand: brandName,
    hasVariants: true,
    imageUrl: variants.find((v) => v.imageUrl)?.imageUrl || first.imageUrl,
    galleryUrls: first.galleryUrls || [],
    galleryImages: first.galleryImages || [],
    sellPriceRange,
    costPriceRange,
    totalStock,
    stockInUnits: totalStock,
    itemsPerCarton: first.itemsPerCarton,
    isiPerDus: first.isiPerDus ?? first.itemsPerCarton,
    piecesPerCarton: first.piecesPerCarton ?? first.itemsPerCarton,
    pricePerCarton: first.pricePerCarton,
    cartonWholesalePrice: first.cartonWholesalePrice ?? first.pricePerCarton,
    pricePerUnit: first.pricePerUnit ?? first.sellPrice,
    costPerCarton: first.costPerCarton,
    costPerUnit: first.costPerUnit ?? first.costPrice,
    weightMl: first.weightMl,
    beratPerItem: first.beratPerItem ?? first.weightMl,
    totalBeratKg: first.totalBeratKg,
    isActive: variants.some((v) => v.isActive !== false),
    isPosVisible: variants.some((v) => v.isPosVisible !== false),
    isPwaVisible: variants.some((v) => v.isPwaVisible !== false),
    deliveryCommission: first.deliveryCommission,
    trackStockCard: first.trackStockCard,
    sellByUnit: first.sellByUnit,
    mainUnit: first.mainUnit,
    subUnit: first.subUnit,
    variantType: first.variantType,
    variantName: first.variantName,
    variantGroupId: variantGroupId || first.variantGroupId,
    groupName: groupName,
    shelfLocation: first.shelfLocation ?? first.storageLocation,
    storageLocation: first.storageLocation ?? first.shelfLocation,
    minStock: first.minStock ?? first.minStockAlert,
    minStockAlert: first.minStockAlert ?? first.minStock,
    productionDate: first.productionDate ?? first.tanggalProduksi ?? '',
    tanggalProduksi: first.tanggalProduksi ?? first.productionDate ?? '',
    expiryDate: first.expiryDate ?? first.tanggalKadaluarsa ?? '',
    tanggalKadaluarsa: first.tanggalKadaluarsa ?? first.expiryDate ?? '',
    variants,
    createdAt: createdDates[0],
    updatedAt: first.updatedAt,
  };
}

function buildStandaloneGroupItem(p: Product, brandOverride?: string): ProductGroupItem {
  const v = productToVariant(p);
  return {
    id: v.id,
    docId: v.id,
    docIds: [v.id],
    name: v.name,
    sku: v.sku,
    category: v.category,
    brand: brandOverride !== undefined ? brandOverride : v.brand,
    hasVariants: false,
    imageUrl: v.imageUrl,
    galleryUrls: v.galleryUrls,
    galleryImages: v.galleryImages,
    costPrice: v.costPrice,
    sellPrice: v.sellPrice,
    posPrice: v.posPrice,
    pwaPrice: v.pwaPrice,
    totalStock: v.stock,
    stockInUnits: v.stockInUnits ?? v.stock,
    itemsPerCarton: v.itemsPerCarton,
    isiPerDus: v.isiPerDus ?? v.itemsPerCarton,
    piecesPerCarton: v.piecesPerCarton ?? v.itemsPerCarton,
    pricePerCarton: v.pricePerCarton,
    cartonWholesalePrice: v.cartonWholesalePrice ?? v.pricePerCarton,
    pricePerUnit: v.pricePerUnit ?? v.sellPrice,
    costPerCarton: v.costPerCarton,
    costPerUnit: v.costPerUnit ?? v.costPrice,
    weightMl: v.weightMl,
    beratPerItem: v.beratPerItem ?? v.weightMl,
    totalBeratKg: v.totalBeratKg,
    isActive: v.isActive,
    isPosVisible: v.isPosVisible,
    isPwaVisible: v.isPwaVisible,
    deliveryCommission: v.deliveryCommission,
    trackStockCard: v.trackStockCard,
    sellByUnit: v.sellByUnit,
    mainUnit: v.mainUnit,
    subUnit: v.subUnit,
    variantType: v.variantType,
    variantName: v.variantName,
    variantGroupId: v.variantGroupId,
    groupName: v.groupName,
    shelfLocation: v.shelfLocation,
    storageLocation: v.storageLocation,
    minStock: v.minStock,
    minStockAlert: v.minStockAlert,
    productionDate: v.productionDate ?? v.tanggalProduksi ?? '',
    tanggalProduksi: v.tanggalProduksi ?? v.productionDate ?? '',
    expiryDate: v.expiryDate ?? v.tanggalKadaluarsa ?? '',
    tanggalKadaluarsa: v.tanggalKadaluarsa ?? v.expiryDate ?? '',
    description: v.description ?? '',
    batchCode: v.batchCode ?? '',
    batches: v.batches,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

/**
 * Converts a flat array of Firestore Products into grouped ProductGroupItems.
 * 1. Deduplicates by document ID first.
 * 2. Groups products sharing the same `variantGroupId` (using `groupName` as the group name).
 * 3. Products without `variantGroupId` are treated as standalone products.
 */
export function productsToGroups(products: Product[]): ProductGroupItem[] {
  if (!products || products.length === 0) {
    return [];
  }

  // Deduplicate by document ID so duplicate listeners/snapshots never create phantom rows
  const uniqueMap = new Map<string, Product>();
  for (const prod of products) {
    if (!prod || (!prod.id && !prod.sku)) continue;
    const key = prod.id || prod.sku;
    uniqueMap.set(key, prod);
  }
  const deduplicated = Array.from(uniqueMap.values());

  const variantGroups = new Map<string, Product[]>();
  const standaloneProducts: Product[] = [];

  for (const prod of deduplicated) {
    const vGroupId = prod.variantGroupId?.trim();
    if (vGroupId) {
      const existing = variantGroups.get(vGroupId) || [];
      existing.push(prod);
      variantGroups.set(vGroupId, existing);
    } else {
      standaloneProducts.push(prod);
    }
  }

  const result: ProductGroupItem[] = [];

  // 1. Process variantGroupId groups (name = groupName)
  for (const [vGroupId, items] of variantGroups.entries()) {
    const groupTitle =
      items.find((i) => i.groupName?.trim())?.groupName?.trim() ||
      items[0].name;
    const brandName = items.find((i) => i.brand?.trim())?.brand?.trim() || '';
    const groupId = vGroupId.startsWith('grp_') ? vGroupId : `grp_${vGroupId}`;
    result.push(buildMultiVariantGroupItem(groupId, groupTitle, brandName, items, vGroupId));
  }

  // 2. Products without variantGroupId are always standalone products
  for (const p of standaloneProducts) {
    result.push(buildStandaloneGroupItem(p));
  }

  return result;
}

/**
 * Extracts flat variant list from ProductGroupItem array
 */
export function extractVariantsFromGroups(groups: ProductGroupItem[]): ProductVariantItem[] {
  const result: ProductVariantItem[] = [];
  for (const group of groups) {
    if (group.hasVariants && group.variants && group.variants.length > 0) {
      for (const v of group.variants) {
        result.push({
          ...v,
          brand: v.brand !== undefined ? v.brand : (group.brand || ''),
          category: v.category || group.category || 'GENERAL',
          variantGroupId: v.variantGroupId || group.variantGroupId,
          groupName: v.groupName || group.groupName || group.name,
        });
      }
    } else {
      const docId = group.docId || group.id;
      const itemsPerCarton = Math.max(
        1,
        group.isiPerDus ?? group.itemsPerCarton ?? group.piecesPerCarton ?? 1
      );
      const weightMl = group.beratPerItem ?? group.weightMl ?? 0;
      const totalBeratKg =
        group.totalBeratKg !== undefined && group.totalBeratKg !== null
          ? group.totalBeratKg
          : Number(((weightMl * itemsPerCarton) / 1000).toFixed(2));
      const sellPrice = group.posPrice ?? group.sellPrice ?? group.pricePerUnit ?? 0;
      const costPrice = group.costPrice ?? group.costPerUnit ?? 0;
      const stock = group.totalStock ?? group.stockInUnits ?? 0;
      const pricePerCarton = sellPrice;
      const costPerCarton = costPrice;
      const galleryUrls = Array.isArray(group.galleryUrls)
        ? group.galleryUrls
        : Array.isArray(group.galleryImages)
        ? group.galleryImages
        : [];
      const shelfLocation = group.shelfLocation ?? group.storageLocation ?? '';
      const minStock = group.minStock ?? group.minStockAlert ?? 10;

      result.push({
        id: docId,
        docId: docId,
        sku: group.sku || docId,
        name: group.name,
        category: group.category || 'GENERAL',
        brand: group.brand || '',
        costPrice,
        sellPrice,
        posPrice: group.posPrice ?? sellPrice,
        pwaPrice: group.pwaPrice ?? sellPrice,
        stock,
        itemsPerCarton,
        isiPerDus: itemsPerCarton,
        piecesPerCarton: itemsPerCarton,
        pricePerCarton,
        pricePerUnit: sellPrice,
        costPerCarton,
        costPerUnit: costPrice,
        sellByUnit: group.sellByUnit !== false,
        stockInUnits: stock,
        trackStockCard: group.trackStockCard !== false,
        cartonWholesalePrice: pricePerCarton,
        shelfLocation,
        storageLocation: shelfLocation,
        minStock,
        minStockAlert: minStock,
        weightMl,
        beratPerItem: weightMl,
        totalBeratKg,
        isActive: group.isActive !== false,
        isPosVisible: group.isPosVisible !== false,
        isPwaVisible: group.isPwaVisible !== false,
        imageUrl: group.imageUrl,
        galleryUrls,
        galleryImages: galleryUrls,
        deliveryCommission: group.deliveryCommission ?? 0,
        mainUnit: group.mainUnit || 'Dus',
        subUnit: group.subUnit || 'Unit',
        variantType: group.variantType,
        variantName: group.variantName,
        variantGroupId: group.variantGroupId,
        groupName: group.groupName,
        productionDate: group.productionDate ?? group.tanggalProduksi ?? '',
        tanggalProduksi: group.tanggalProduksi ?? group.productionDate ?? '',
        expiryDate: group.expiryDate ?? group.tanggalKadaluarsa ?? '',
        tanggalKadaluarsa: group.tanggalKadaluarsa ?? group.expiryDate ?? '',
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      });
    }
  }
  return result;
}
