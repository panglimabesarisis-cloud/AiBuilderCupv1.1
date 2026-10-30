import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ACTIVE_STORE_ID } from '../config/store';
import { ProductGroupItem, ProductVariantItem, variantToProduct } from './productMapper';
import { Product, ProductBatchItem } from '../types';
import { deductFefoBatches } from '../utils/expiryUtils';
import { deductRawMaterialsForProductBom } from './rawMaterialService';

export const MAX_PRODUCT_DOC_BYTES = 900 * 1024; // 900 KB
export const PHOTO_TOO_LARGE_MESSAGE = 'Ukuran foto terlalu besar, kurangi foto galeri';

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getJsonByteSize(obj: unknown): number {
  const jsonStr = JSON.stringify(obj);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(jsonStr).length;
  }
  return new Blob([jsonStr]).size;
}

/**
 * Recursively removes all keys with `undefined` values from an object or array.
 * Required to prevent Firestore setDoc errors on unsupported field values.
 */
export function stripUndefined<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => stripUndefined(item)) as unknown as T;
  }
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj as Record<string, any>)) {
    if (value !== undefined) {
      result[key] = stripUndefined(value);
    }
  }
  return result as T;
}

/**
 * Helper to write/merge a product document across primary (`products`) and store subcollections
 * using the exact same Firestore document ID (`docId`).
 */
export async function saveProductDocToAllPaths(docId: string, productData: Record<string, any>): Promise<void> {
  const cleanId = docId.trim();
  const rawPayload: Record<string, any> = {
    ...productData,
    id: cleanId,
    updatedAt: new Date().toISOString(),
  };

  const payload = stripUndefined(rawPayload);

  if (getJsonByteSize(payload) > MAX_PRODUCT_DOC_BYTES) {
    throw new Error(PHOTO_TOO_LARGE_MESSAGE);
  }

  // Immediately sync localStorage caches first so POS, PWA, and Product pages reflect updates without delay
  const cleanSku = typeof payload.sku === 'string' ? payload.sku.trim() : '';
  if (typeof window !== 'undefined') {
    for (const cacheKey of ['riskcart_fs_products', 'riskcart_cache_products']) {
      try {
        const raw = window.localStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            let found = false;
            const nextList = parsed.map((item: any) => {
              if (item && (item.id === cleanId || (cleanSku && item.sku === cleanSku))) {
                found = true;
                return { ...item, ...payload, id: item.id || cleanId };
              }
              return item;
            });
            if (!found) {
              nextList.push(payload);
            }
            window.localStorage.setItem(cacheKey, JSON.stringify(nextList));
          }
        }
      } catch (e) {}
    }
  }

  // Primary source of truth: root `products` collection + store subcollection (non-blocking in offline mode)
  void Promise.all([
    setDoc(doc(db, 'products', cleanId), payload, { merge: true }).catch(() => {}),
    setDoc(
      doc(db, 'stores', ACTIVE_STORE_ID, 'products', cleanId),
      {
        ...payload,
        storeId: ACTIVE_STORE_ID,
      },
      { merge: true }
    ).catch(() => {}),
  ]);

  if (cleanSku) {
    void getDocs(query(collection(db, 'products'), where('sku', '==', cleanSku)))
      .then((snapRoot) => {
        for (const d of snapRoot.docs) {
          if (d.id !== cleanId) {
            void setDoc(doc(db, 'products', d.id), { ...payload, id: d.id }, { merge: true }).catch(() => {});
          }
        }
      })
      .catch(() => {});
  }
}

/**
 * Create a new Product (standalone or with variants) in Firestore and return the created Product documents.
 * 1 variant = 1 document in `products` (plus mirrored to `stores/${ACTIVE_STORE_ID}/products`).
 */
export async function createProductGroupInDb(newProduct: ProductGroupItem): Promise<Product[]> {
  const nowISO = new Date().toISOString();
  const preparedDocs: Array<{ docId: string; prod: Product; payload: Record<string, any> }> = [];

  if (newProduct.hasVariants && newProduct.variants && newProduct.variants.length > 0) {
    const variantGroupId = generateUuid();
    const groupName = (newProduct.groupName || newProduct.name || '').trim();
    const fallbackMainImage = (newProduct.imageUrl || '').trim();

    for (const v of newProduct.variants) {
      const newDocRef = doc(collection(db, 'products'));
      const docId = newDocRef.id;
      const sku = (v.sku || `SKU-${docId.slice(0, 6).toUpperCase()}`).trim();
      const sellPrice = Number(v.pricePerUnit ?? v.sellPrice ?? v.posPrice ?? newProduct.sellPrice ?? 0);
      const posPrice = Number(v.posPrice ?? sellPrice);
      const pwaPrice = Number(v.pwaPrice ?? sellPrice);
      const costPrice = Number(v.costPerUnit ?? v.costPrice ?? newProduct.costPrice ?? 0);
      const stock = Number(v.stockInUnits ?? v.stock ?? 0);
      const piecesPerCarton = Math.max(
        1,
        Number(
          v.isiPerDus ??
            v.piecesPerCarton ??
            v.itemsPerCarton ??
            newProduct.isiPerDus ??
            newProduct.piecesPerCarton ??
            newProduct.itemsPerCarton ??
            1
        )
      );
      const weightMl = Number(
        v.beratPerItem ?? v.weightMl ?? newProduct.beratPerItem ?? newProduct.weightMl ?? 0
      );
      const totalBeratKg =
        v.totalBeratKg !== undefined && v.totalBeratKg !== null
          ? Number(v.totalBeratKg)
          : Number(((weightMl * piecesPerCarton) / 1000).toFixed(2));
      const sellByUnit = (v.sellByUnit ?? newProduct.sellByUnit) !== false;
      const pricePerCarton = sellPrice;
      const cartonWholesalePrice = sellPrice;
      const costPerCarton = costPrice;
      const deliveryCommission = Number(v.deliveryCommission ?? newProduct.deliveryCommission ?? 0);
      const trackStockCard = (v.trackStockCard ?? newProduct.trackStockCard) !== false;
      const mainUnit = v.mainUnit || newProduct.mainUnit || 'Dus';
      const subUnit = v.subUnit || newProduct.subUnit || 'Unit';
      const shelfLocation = (
        v.shelfLocation ??
        v.storageLocation ??
        newProduct.shelfLocation ??
        newProduct.storageLocation ??
        ''
      ).trim();
      const minStock = Number(
        v.minStock ?? v.minStockAlert ?? newProduct.minStock ?? newProduct.minStockAlert ?? 10
      );
      const variantType = (v.variantType || newProduct.variantType || 'Rasa').trim();

      const rawVarName = (v.variantName || v.name || '').trim();
      const variantName =
        v.variantName?.trim() ||
        (groupName && rawVarName.toLowerCase().startsWith(groupName.toLowerCase() + ' ')
          ? rawVarName.slice(groupName.length).trim()
          : rawVarName);

      const fullProductName =
        groupName && variantName
          ? `${groupName} ${variantName}`.trim()
          : variantName || groupName;

      // Brand = selected brand ONLY (never auto-fallback to groupName)
      const selectedBrand = (v.brand !== undefined ? v.brand : (newProduct.brand || '')).trim();
      // Empty variant imageUrl falls back to Foto Utama
      const imageUrl = (v.imageUrl || fallbackMainImage || '').trim();
      // galleryUrls defaults to []
      const galleryUrls = Array.isArray(v.galleryUrls)
        ? v.galleryUrls
        : Array.isArray(v.galleryImages)
        ? v.galleryImages
        : [];

      const prod = variantToProduct(
        {
          ...v,
          id: docId,
          docId,
          sku,
          name: fullProductName,
          brand: selectedBrand,
          category: v.category || newProduct.category || 'MINERAL',
          costPrice,
          costPerUnit: costPrice,
          sellPrice,
          pricePerUnit: sellPrice,
          posPrice,
          pwaPrice,
          stock,
          stockInUnits: stock,
          itemsPerCarton: piecesPerCarton,
          isiPerDus: piecesPerCarton,
          piecesPerCarton,
          weightMl,
          beratPerItem: weightMl,
          totalBeratKg,
          isActive: v.isActive !== false,
          isPosVisible: v.isPosVisible !== false,
          isPwaVisible: v.isPwaVisible !== false,
          imageUrl,
          galleryUrls,
          galleryImages: galleryUrls,
          pricePerCarton,
          cartonWholesalePrice,
          costPerCarton,
          deliveryCommission,
          trackStockCard,
          sellByUnit,
          mainUnit,
          subUnit,
          storageLocation: shelfLocation,
          shelfLocation,
          minStockAlert: minStock,
          minStock,
          variantType,
          variantName,
          variantGroupId,
          groupName,
        },
        {
          id: docId,
          sku,
          name: fullProductName,
          brand: selectedBrand,
          storeId: ACTIVE_STORE_ID,
          imageUrl,
          galleryUrls,
          galleryImages: galleryUrls,
          piecesPerCarton,
          isiPerDus: piecesPerCarton,
          weightMl,
          beratPerItem: weightMl,
          totalBeratKg,
          pricePerCarton,
          cartonWholesalePrice,
          pricePerUnit: sellPrice,
          costPerCarton,
          costPerUnit: costPrice,
          sellByUnit,
          stockInUnits: stock,
          trackStockCard,
          deliveryCommission,
          mainUnit,
          subUnit,
          storageLocation: shelfLocation,
          shelfLocation,
          minStockAlert: minStock,
          minStock,
          variantType,
          variantName,
          variantGroupId,
          groupName,
          createdAt: nowISO,
          updatedAt: nowISO,
        }
      );

      const productionDate = (
        v.productionDate ??
        v.tanggalProduksi ??
        newProduct.productionDate ??
        newProduct.tanggalProduksi ??
        ''
      ).trim();
      const expiryDate = (
        v.expiryDate ??
        v.tanggalKadaluarsa ??
        newProduct.expiryDate ??
        newProduct.tanggalKadaluarsa ??
        ''
      ).trim();

      const payload: Record<string, any> = {
        ...prod,
        price: sellPrice,
        sellPrice,
        costPrice,
        stock,
        posPrice,
        pwaPrice,
        itemsPerCarton: piecesPerCarton,
        isiPerDus: piecesPerCarton,
        weightMl,
        beratPerItem: weightMl,
        totalBeratKg,
        productionDate,
        tanggalProduksi: productionDate,
        expiryDate,
        tanggalKadaluarsa: expiryDate,
        hasRawMaterials: Boolean(v.hasRawMaterials ?? newProduct.hasRawMaterials),
        autoDeductRawMaterial: (v.autoDeductRawMaterial ?? newProduct.autoDeductRawMaterial) !== false,
        rawMaterialRecipe: Array.isArray(v.rawMaterialRecipe)
          ? v.rawMaterialRecipe
          : Array.isArray(newProduct.rawMaterialRecipe)
          ? newProduct.rawMaterialRecipe
          : [],
      };

      if (getJsonByteSize(payload) > MAX_PRODUCT_DOC_BYTES) {
        throw new Error(PHOTO_TOO_LARGE_MESSAGE);
      }

      preparedDocs.push({ docId, prod: { ...prod, productionDate, tanggalProduksi: productionDate, expiryDate, tanggalKadaluarsa: expiryDate }, payload });
    }
  } else {
    const newDocRef = doc(collection(db, 'products'));
    const docId = newDocRef.id;
    const sku = (newProduct.sku || `SKU-${docId.slice(0, 6).toUpperCase()}`).trim();
    const sellPrice = Number(newProduct.pricePerUnit ?? newProduct.sellPrice ?? newProduct.posPrice ?? 0);
    const posPrice = Number(newProduct.posPrice ?? sellPrice);
    const pwaPrice = Number(newProduct.pwaPrice ?? sellPrice);
    const costPrice = Number(newProduct.costPerUnit ?? newProduct.costPrice ?? 0);
    const hasRawMaterialsFlag = Boolean(
      newProduct.hasRawMaterials ||
        (Array.isArray(newProduct.rawMaterialRecipe) && newProduct.rawMaterialRecipe.length > 0)
    );
    const rawStock = Number(newProduct.stockInUnits ?? newProduct.totalStock ?? 0);
    const stock = hasRawMaterialsFlag ? Math.max(999, rawStock) : rawStock;
    const piecesPerCarton = Math.max(
      1,
      Number(newProduct.isiPerDus ?? newProduct.piecesPerCarton ?? newProduct.itemsPerCarton ?? 1)
    );
    const weightMl = Number(newProduct.beratPerItem ?? newProduct.weightMl ?? 0);
    const totalBeratKg =
      newProduct.totalBeratKg !== undefined && newProduct.totalBeratKg !== null
        ? Number(newProduct.totalBeratKg)
        : Number(((weightMl * piecesPerCarton) / 1000).toFixed(2));
    const sellByUnit = newProduct.sellByUnit !== false;
    const pricePerCarton = sellPrice;
    const cartonWholesalePrice = sellPrice;
    const costPerCarton = costPrice;
    const deliveryCommission = Number(newProduct.deliveryCommission ?? 0);
    const trackStockCard = newProduct.trackStockCard !== false;
    const mainUnit = newProduct.mainUnit || 'Dus';
    const subUnit = newProduct.subUnit || 'Unit';
    const shelfLocation = (newProduct.shelfLocation ?? newProduct.storageLocation ?? '').trim();
    const minStock = Number(newProduct.minStock ?? newProduct.minStockAlert ?? 10);
    const selectedBrand = (newProduct.brand || '').trim();
    const imageUrl = (newProduct.imageUrl || '').trim();
    const galleryUrls = Array.isArray(newProduct.galleryUrls)
      ? newProduct.galleryUrls
      : Array.isArray(newProduct.galleryImages)
      ? newProduct.galleryImages
      : [];

    const prod = variantToProduct(
      {
        ...newProduct,
        id: docId,
        docId,
        sku,
        brand: selectedBrand,
        category: newProduct.category || 'MINERAL',
        costPrice,
        costPerUnit: costPrice,
        sellPrice,
        pricePerUnit: sellPrice,
        posPrice,
        pwaPrice,
        stock,
        stockInUnits: stock,
        itemsPerCarton: piecesPerCarton,
        isiPerDus: piecesPerCarton,
        piecesPerCarton,
        weightMl,
        beratPerItem: weightMl,
        totalBeratKg,
        isActive: newProduct.isActive !== false,
        isPosVisible: newProduct.isPosVisible !== false,
        isPwaVisible: newProduct.isPwaVisible !== false,
        imageUrl,
        galleryUrls,
        galleryImages: galleryUrls,
        pricePerCarton,
        cartonWholesalePrice,
        costPerCarton,
        deliveryCommission,
        trackStockCard,
        sellByUnit,
        mainUnit,
        subUnit,
        storageLocation: shelfLocation,
        shelfLocation,
        minStockAlert: minStock,
        minStock,
      },
      {
        id: docId,
        sku,
        brand: selectedBrand,
        storeId: ACTIVE_STORE_ID,
        imageUrl,
        galleryUrls,
        galleryImages: galleryUrls,
        piecesPerCarton,
        isiPerDus: piecesPerCarton,
        weightMl,
        beratPerItem: weightMl,
        totalBeratKg,
        pricePerCarton,
        cartonWholesalePrice,
        pricePerUnit: sellPrice,
        costPerCarton,
        costPerUnit: costPrice,
        sellByUnit,
        stockInUnits: stock,
        trackStockCard,
        deliveryCommission,
        mainUnit,
        subUnit,
        storageLocation: shelfLocation,
        shelfLocation,
        minStockAlert: minStock,
        minStock,
        createdAt: nowISO,
        updatedAt: nowISO,
      }
    );

    const productionDate = (
      newProduct.productionDate ?? newProduct.tanggalProduksi ?? ''
    ).trim();
    const expiryDate = (
      newProduct.expiryDate ?? newProduct.tanggalKadaluarsa ?? ''
    ).trim();

    const payload: Record<string, any> = {
      ...prod,
      hasVariants: false,
      price: sellPrice,
      sellPrice,
      costPrice,
      stock,
      posPrice,
      pwaPrice,
      itemsPerCarton: piecesPerCarton,
      isiPerDus: piecesPerCarton,
      weightMl,
      beratPerItem: weightMl,
      totalBeratKg,
      productionDate,
      tanggalProduksi: productionDate,
      expiryDate,
      tanggalKadaluarsa: expiryDate,
      hasRawMaterials: Boolean(newProduct.hasRawMaterials),
      autoDeductRawMaterial: newProduct.autoDeductRawMaterial !== false,
      rawMaterialRecipe: Array.isArray(newProduct.rawMaterialRecipe) ? newProduct.rawMaterialRecipe : [],
    };

    // Do not include variantType, variantName, variantGroupId, or groupName if empty/undefined
    if (!payload.variantType) delete payload.variantType;
    if (!payload.variantName) delete payload.variantName;
    if (!payload.variantGroupId) delete payload.variantGroupId;
    if (!payload.groupName) delete payload.groupName;

    if (!prod.variantType) delete (prod as any).variantType;
    if (!prod.variantName) delete (prod as any).variantName;
    if (!prod.variantGroupId) delete (prod as any).variantGroupId;
    if (!prod.groupName) delete (prod as any).groupName;
    (prod as any).hasVariants = false;

    const cleanPayload = stripUndefined(payload);

    if (getJsonByteSize(cleanPayload) > MAX_PRODUCT_DOC_BYTES) {
      throw new Error(PHOTO_TOO_LARGE_MESSAGE);
    }

    preparedDocs.push({ docId, prod, payload: cleanPayload });
  }

  // Write all validated documents to the 3 paths via saveProductDocToAllPaths
  const createdProducts: Product[] = [];
  for (const item of preparedDocs) {
    await saveProductDocToAllPaths(item.docId, item.payload);
    createdProducts.push(item.prod);
  }

  return createdProducts;
}

/**
 * Update an existing Product Group or standalone Product/Variant in Firestore.
 */
export async function updateProductGroupInDb(editingGroup: ProductGroupItem): Promise<void> {
  const nowISO = new Date().toISOString();

  // Case 1: Editing a multi-variant group where variants array is present
  if (editingGroup.hasVariants && editingGroup.variants && editingGroup.variants.length > 0 && !editingGroup.editingVariantId) {
    const groupName = (editingGroup.groupName || editingGroup.name || '').trim();
    const variantGroupId =
      editingGroup.variantGroupId ||
      editingGroup.variants[0]?.variantGroupId ||
      generateUuid();
    const fallbackMainImage = (editingGroup.imageUrl || '').trim();

    for (const v of editingGroup.variants) {
      const rawId = v.docId || v.id || v.sku || '';
      const isTempRowId = !rawId || rawId.startsWith('vrow_') || rawId.startsWith('var_');
      const targetDocId = isTempRowId ? doc(collection(db, 'products')).id : rawId;

      const costPrice = Number(v.costPrice ?? v.costPerUnit ?? editingGroup.costPrice ?? 0);
      const posPrice = Number(v.posPrice ?? v.sellPrice ?? editingGroup.posPrice ?? editingGroup.sellPrice ?? 0);
      const pwaPrice = Number(v.pwaPrice ?? v.sellPrice ?? editingGroup.pwaPrice ?? editingGroup.sellPrice ?? 0);
      const sellPrice = posPrice;
      const itemsPerCarton = Math.max(
        1,
        Number(
          v.isiPerDus ??
            v.itemsPerCarton ??
            v.piecesPerCarton ??
            editingGroup.isiPerDus ??
            editingGroup.itemsPerCarton ??
            1
        )
      );
      const weightMl = Number(
        v.beratPerItem ?? v.weightMl ?? editingGroup.beratPerItem ?? editingGroup.weightMl ?? 0
      );
      const totalBeratKg = Number(((weightMl * itemsPerCarton) / 1000).toFixed(3));
      const stock =
        editingGroup.variants.length === 1 && v.stock === undefined
          ? Math.max(0, Number(editingGroup.totalStock ?? 0))
          : Math.max(0, Number(v.stock ?? v.stockInUnits ?? 0));
      const sellByUnit = (v.sellByUnit ?? editingGroup.sellByUnit) !== false;
      const pricePerCarton = sellPrice;
      const costPerCarton = costPrice;
      const shelfLocation = (v.shelfLocation ?? v.storageLocation ?? editingGroup.storageLocation ?? '').trim();
      const minStock = Number(v.minStock ?? v.minStockAlert ?? editingGroup.minStockAlert ?? 10);
      const galleryUrls = Array.isArray(v.galleryUrls)
        ? v.galleryUrls
        : Array.isArray(v.galleryImages)
        ? v.galleryImages
        : [];
      const variantName =
        v.variantName ||
        (v.groupName && v.name.toLowerCase().startsWith(v.groupName.toLowerCase() + ' ')
          ? v.name.slice(v.groupName.length).trim()
          : v.name);
      const fullProductName =
        editingGroup.variants.length === 1 && !variantName
          ? editingGroup.name.trim()
          : groupName && variantName && !variantName.toLowerCase().startsWith(groupName.toLowerCase())
          ? `${groupName} ${variantName}`.trim()
          : (v.name || groupName).trim();

      const productionDate = (
        v.productionDate ??
        v.tanggalProduksi ??
        editingGroup.productionDate ??
        editingGroup.tanggalProduksi ??
        ''
      ).trim();
      const expiryDate = (
        v.expiryDate ??
        v.tanggalKadaluarsa ??
        editingGroup.expiryDate ??
        editingGroup.tanggalKadaluarsa ??
        ''
      ).trim();
      const imageUrl = (v.imageUrl || fallbackMainImage || '').trim();
      const description = (v.description ?? editingGroup.description ?? '').trim();
      const batchCode = (v.batchCode ?? editingGroup.batchCode ?? '').trim();

      const batches =
        Array.isArray(v.batches) && v.batches.length > 0
          ? v.batches
          : batchCode || productionDate || expiryDate
          ? [
              {
                batchCode: batchCode || `BATCH-${targetDocId.slice(0, 6).toUpperCase()}`,
                productionDate,
                expiryDate,
                qty: stock,
                initialQty: stock,
                buyPrice: costPrice,
              },
            ]
          : undefined;

      await saveProductDocToAllPaths(targetDocId, {
        name: fullProductName,
        groupName,
        variantName,
        variantType: v.variantType || editingGroup.variantType || 'Rasa',
        variantGroupId,
        sku: (editingGroup.variants.length === 1 && editingGroup.sku ? editingGroup.sku : v.sku || targetDocId).trim(),
        category: v.category || editingGroup.category || 'MINERAL',
        brand: (v.brand !== undefined && v.brand !== '' ? v.brand : (editingGroup.brand || '')).trim(),
        description,
        batchCode,
        ...(batches ? { batches } : {}),
        imageUrl,
        costPerUnit: costPrice,
        costPrice: costPrice,
        pricePerUnit: sellPrice,
        price: sellPrice,
        sellPrice: sellPrice,
        posPrice: posPrice,
        pwaPrice: pwaPrice,
        pricePerCarton,
        cartonWholesalePrice: pricePerCarton,
        costPerCarton,
        piecesPerCarton: itemsPerCarton,
        itemsPerCarton,
        isiPerDus: itemsPerCarton,
        weightMl,
        beratPerItem: weightMl,
        totalBeratKg,
        stockInUnits: stock,
        stock: stock,
        sellByUnit,
        mainUnit: v.mainUnit || editingGroup.mainUnit || 'Dus',
        subUnit: v.subUnit || editingGroup.subUnit || 'Unit',
        deliveryCommission: Number(v.deliveryCommission ?? editingGroup.deliveryCommission ?? 0),
        trackStockCard: (v.trackStockCard ?? editingGroup.trackStockCard) !== false,
        shelfLocation,
        storageLocation: shelfLocation,
        minStock,
        minStockAlert: minStock,
        galleryUrls,
        galleryImages: galleryUrls,
        productionDate,
        tanggalProduksi: productionDate,
        expiryDate,
        tanggalKadaluarsa: expiryDate,
        hasRawMaterials: Boolean(v.hasRawMaterials ?? editingGroup.hasRawMaterials),
        autoDeductRawMaterial: (v.autoDeductRawMaterial ?? editingGroup.autoDeductRawMaterial) !== false,
        rawMaterialRecipe: Array.isArray(v.rawMaterialRecipe)
          ? v.rawMaterialRecipe
          : Array.isArray(editingGroup.rawMaterialRecipe)
          ? editingGroup.rawMaterialRecipe
          : [],
        isActive: v.isActive !== false,
        isPosVisible: v.isPosVisible !== false,
        isPwaVisible: v.isPwaVisible !== false,
        updatedAt: nowISO,
      });
    }
    return;
  }

  // Case 2: Editing a single standalone product or a specific variant
  const targetDocId =
    editingGroup.editingVariantId ||
    editingGroup.docId ||
    editingGroup.docIds?.[0] ||
    editingGroup.id.replace(/^grp_/, '') ||
    editingGroup.sku;

  if (!targetDocId) {
    throw new Error('ID dokumen produk tidak ditemukan.');
  }

  const costPrice = Number(editingGroup.costPrice ?? editingGroup.costPerUnit) || 0;
  const posPrice = Number(editingGroup.posPrice ?? editingGroup.sellPrice ?? editingGroup.pricePerUnit) || 0;
  const pwaPrice = Number(editingGroup.pwaPrice ?? editingGroup.sellPrice ?? editingGroup.pricePerUnit) || 0;
  const sellPrice = posPrice;
  const itemsPerCarton = Math.max(
    1,
    Number(editingGroup.isiPerDus ?? editingGroup.itemsPerCarton ?? editingGroup.piecesPerCarton) || 1
  );
  const weightMl = Number(editingGroup.beratPerItem ?? editingGroup.weightMl) || 0;
  const totalBeratKg =
    editingGroup.totalBeratKg !== undefined && editingGroup.totalBeratKg !== null
      ? Number(editingGroup.totalBeratKg)
      : Number(((weightMl * itemsPerCarton) / 1000).toFixed(3));
  const hasRawMaterialsFlag = Boolean(
    editingGroup.hasRawMaterials ||
      (Array.isArray(editingGroup.rawMaterialRecipe) && editingGroup.rawMaterialRecipe.length > 0)
  );
  const rawStock = Math.max(0, Number(editingGroup.totalStock ?? editingGroup.stockInUnits) || 0);
  const stock = hasRawMaterialsFlag ? Math.max(999, rawStock) : rawStock;
  const sellByUnit = editingGroup.sellByUnit !== false;
  const pricePerCarton = sellPrice;
  const costPerCarton = costPrice;
  const shelfLocation = (editingGroup.shelfLocation ?? editingGroup.storageLocation ?? '').trim();
  const minStock = Number(editingGroup.minStock ?? editingGroup.minStockAlert ?? 10);

  const productionDate = (
    editingGroup.productionDate ?? editingGroup.tanggalProduksi ?? ''
  ).trim();
  const expiryDate = (
    editingGroup.expiryDate ?? editingGroup.tanggalKadaluarsa ?? ''
  ).trim();
  const imageUrl = (editingGroup.imageUrl ?? '').trim();
  const galleryUrls = Array.isArray(editingGroup.galleryUrls)
    ? editingGroup.galleryUrls
    : Array.isArray(editingGroup.galleryImages)
    ? editingGroup.galleryImages
    : [];
  const description = (editingGroup.description ?? '').trim();
  const batchCode = (editingGroup.batchCode ?? '').trim();

  const batches =
    Array.isArray(editingGroup.batches) && editingGroup.batches.length > 0
      ? editingGroup.batches.map((b: any, idx: number) =>
          idx === 0
            ? {
                ...b,
                batchCode: batchCode || b.batchCode,
                productionDate: productionDate || b.productionDate,
                expiryDate: expiryDate || b.expiryDate,
                qty: stock,
                buyPrice: costPrice,
              }
            : b
        )
      : batchCode || productionDate || expiryDate
      ? [
          {
            batchCode: batchCode || `BATCH-${targetDocId.slice(0, 6).toUpperCase()}`,
            productionDate,
            expiryDate,
            qty: stock,
            initialQty: stock,
            buyPrice: costPrice,
          },
        ]
      : undefined;

  await saveProductDocToAllPaths(targetDocId, {
    name: editingGroup.name.trim(),
    sku: (editingGroup.sku || targetDocId).trim(),
    barcode: (editingGroup.sku || targetDocId).trim(),
    category: editingGroup.category || 'MINERAL',
    brand: (editingGroup.brand || '').trim(),
    description,
    batchCode,
    ...(batches ? { batches } : {}),
    imageUrl,
    galleryUrls,
    galleryImages: galleryUrls,
    costPerUnit: costPrice,
    costPrice: costPrice,
    pricePerUnit: sellPrice,
    price: sellPrice,
    sellPrice: sellPrice,
    posPrice: posPrice,
    pwaPrice: pwaPrice,
    pricePerCarton,
    cartonWholesalePrice: pricePerCarton,
    costPerCarton,
    piecesPerCarton: itemsPerCarton,
    itemsPerCarton,
    isiPerDus: itemsPerCarton,
    weightMl,
    beratPerItem: weightMl,
    totalBeratKg,
    stockInUnits: stock,
    stock: stock,
    sellByUnit,
    mainUnit: editingGroup.mainUnit || 'Dus',
    subUnit: editingGroup.subUnit || 'Unit',
    deliveryCommission: Number(editingGroup.deliveryCommission ?? 0),
    trackStockCard: editingGroup.trackStockCard !== false,
    shelfLocation,
    storageLocation: shelfLocation,
    minStock,
    minStockAlert: minStock,
    productionDate,
    tanggalProduksi: productionDate,
    expiryDate,
    tanggalKadaluarsa: expiryDate,
    hasRawMaterials: Boolean(editingGroup.hasRawMaterials),
    autoDeductRawMaterial: editingGroup.autoDeductRawMaterial !== false,
    rawMaterialRecipe: Array.isArray(editingGroup.rawMaterialRecipe) ? editingGroup.rawMaterialRecipe : [],
    isActive: editingGroup.isActive !== false,
    isPosVisible: editingGroup.isPosVisible !== false,
    isPwaVisible: editingGroup.isPwaVisible !== false,
    updatedAt: nowISO,
  });
}

/**
 * Delete product document(s) permanently from Firestore (`products` and store subcollections).
 * Also cleans up any matching SKU documents if legacy records used SKU as document ID.
 */
export async function deleteProductDocsFromDb(
  docIds: string[],
  skus: string[] = []
): Promise<void> {
  const candidateIds = Array.from(
    new Set(
      [...docIds, ...skus]
        .map((id) => (id || '').trim())
        .filter(Boolean)
    )
  );

  if (candidateIds.length === 0) {
    throw new Error('Tidak ada ID dokumen produk yang valid untuk dihapus.');
  }

  // Record tombstones in localStorage and purge local product caches immediately
  try {
    if (typeof window !== 'undefined') {
      const tombstoneKey = 'riskcart_deleted_fs_products_v1';
      const rawDel = window.localStorage.getItem(tombstoneKey);
      const delSet = new Set<string>(rawDel ? JSON.parse(rawDel) : []);
      candidateIds.forEach((id) => delSet.add(id));
      window.localStorage.setItem(tombstoneKey, JSON.stringify(Array.from(delSet)));

      const cleanCacheKey = (lsKey: string) => {
        const raw = window.localStorage.getItem(lsKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter(
            (p: any) =>
              !delSet.has(String(p?.id || '')) && !delSet.has(String(p?.sku || ''))
          );
          window.localStorage.setItem(lsKey, JSON.stringify(filtered));
          window.dispatchEvent(
            new CustomEvent('riskcart_fs_cache_updated', {
              detail: { collectionName: 'products', items: filtered },
            })
          );
        }
      };
      cleanCacheKey('riskcart_fs_products');
      cleanCacheKey('riskcart_cache_products');
    }
  } catch {}

  // 1. Delete by exact document IDs across all product collections
  for (const id of candidateIds) {
    await deleteDoc(doc(db, 'products', id)).catch(() => {});
    try {
      await deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'products', id));
    } catch (e) {}
  }

  // 2. Also query by `sku` in case a duplicate document was created with an auto-generated ID
  const cleanSkus = Array.from(new Set(skus.map((s) => (s || '').trim()).filter(Boolean)));
  for (const sku of cleanSkus) {
    try {
      const qRoot = query(collection(db, 'products'), where('sku', '==', sku));
      const snapRoot = await getDocs(qRoot);
      for (const d of snapRoot.docs) {
        await deleteDoc(d.ref);
      }
    } catch (e) {}

    try {
      const qStore = query(collection(db, 'stores', ACTIVE_STORE_ID, 'products'), where('sku', '==', sku));
      const snapStore = await getDocs(qStore);
      for (const d of snapStore.docs) {
        await deleteDoc(d.ref);
      }
    } catch (e) {}
  }
}

/**
 * Update a single variant document in Firestore.
 */
export async function updateVariantInDb(
  variant: ProductVariantItem,
  docIdOverride?: string
): Promise<void> {
  const targetDocId = (docIdOverride || variant.docId || variant.id || variant.sku || '').trim();
  if (!targetDocId) {
    throw new Error('ID dokumen varian tidak ditemukan.');
  }

  const nowISO = new Date().toISOString();
  const costPrice = Number(variant.costPrice ?? variant.costPerUnit) || 0;
  const posPrice = Number(variant.posPrice ?? variant.sellPrice ?? variant.pricePerUnit) || 0;
  const pwaPrice = Number(variant.pwaPrice ?? variant.sellPrice ?? variant.pricePerUnit) || 0;
  const sellPrice = posPrice;
  const itemsPerCarton = Math.max(
    1,
    Number(variant.isiPerDus ?? variant.itemsPerCarton ?? variant.piecesPerCarton) || 1
  );
  const weightMl = Number(variant.beratPerItem ?? variant.weightMl) || 0;
  const totalBeratKg =
    variant.totalBeratKg !== undefined && variant.totalBeratKg !== null
      ? Number(variant.totalBeratKg)
      : Number(((weightMl * itemsPerCarton) / 1000).toFixed(2));
  const stock = Math.max(0, Number(variant.stock ?? variant.stockInUnits) || 0);
  const sellByUnit = variant.sellByUnit !== false;
  const pricePerCarton = sellPrice;
  const costPerCarton = costPrice;
  const shelfLocation = (variant.shelfLocation ?? variant.storageLocation ?? '').trim();
  const minStock = Number(variant.minStock ?? variant.minStockAlert ?? 10);
  const galleryUrls = Array.isArray(variant.galleryUrls)
    ? variant.galleryUrls
    : Array.isArray(variant.galleryImages)
    ? variant.galleryImages
    : [];

  const groupName = variant.groupName?.trim();
  const rawName = variant.name.trim();
  const variantName =
    groupName && rawName.toLowerCase().startsWith(groupName.toLowerCase() + ' ')
      ? rawName.slice(groupName.length).trim()
      : variant.variantName?.trim() || rawName;
  const finalName = rawName;

  const updatePayload: Record<string, any> = {
    name: finalName,
    variantName,
    sku: (variant.sku || targetDocId).trim(),
    category: variant.category || 'MINERAL',
    brand: (variant.brand || '').trim(),
    costPerUnit: costPrice,
    costPrice: costPrice,
    pricePerUnit: sellPrice,
    price: sellPrice,
    sellPrice: sellPrice,
    posPrice: posPrice,
    pwaPrice: pwaPrice,
    pricePerCarton,
    cartonWholesalePrice: pricePerCarton,
    costPerCarton,
    piecesPerCarton: itemsPerCarton,
    itemsPerCarton,
    isiPerDus: itemsPerCarton,
    weightMl,
    beratPerItem: weightMl,
    totalBeratKg,
    stockInUnits: stock,
    stock: stock,
    sellByUnit,
    trackStockCard: variant.trackStockCard !== false,
    shelfLocation,
    storageLocation: shelfLocation,
    minStock,
    minStockAlert: minStock,
    galleryUrls,
    galleryImages: galleryUrls,
    isActive: variant.isActive !== false,
    isPosVisible: variant.isPosVisible !== false,
    isPwaVisible: variant.isPwaVisible !== false,
    updatedAt: nowISO,
  };

  if (variant.variantGroupId) updatePayload.variantGroupId = variant.variantGroupId;
  if (groupName) updatePayload.groupName = groupName;
  if (variant.variantType) updatePayload.variantType = variant.variantType;
  if (variant.imageUrl !== undefined) updatePayload.imageUrl = variant.imageUrl;
  const productionDate = (variant.productionDate ?? variant.tanggalProduksi ?? '').trim();
  const expiryDate = (variant.expiryDate ?? variant.tanggalKadaluarsa ?? '').trim();
  if (productionDate || variant.productionDate !== undefined) {
    updatePayload.productionDate = productionDate;
    updatePayload.tanggalProduksi = productionDate;
  }
  if (expiryDate || variant.expiryDate !== undefined) {
    updatePayload.expiryDate = expiryDate;
    updatePayload.tanggalKadaluarsa = expiryDate;
  }

  await saveProductDocToAllPaths(targetDocId, updatePayload);
}

/**
 * Adjust stock for a product or product group in Firestore.
 */
export async function adjustProductStockInDb(
  group: ProductGroupItem,
  delta: number
): Promise<void> {
  if (group.hasVariants && group.variants && group.variants.length > 0) {
    const firstVar = group.variants[0];
    const nextStock = Math.max(0, Number(firstVar.stock || 0) + delta);
    await updateVariantInDb(
      {
        ...firstVar,
        stock: nextStock,
        stockInUnits: nextStock,
      },
      firstVar.docId || firstVar.id
    );
    return;
  }

  const nextTotal = Math.max(0, Number(group.totalStock || 0) + delta);
  await updateProductGroupInDb({
    ...group,
    totalStock: nextTotal,
    stockInUnits: nextTotal,
  });
}

/**
 * Delete a product or multi-variant product group from Firestore.
 */
export async function deleteProductFromDb(params: {
  docIds: string[];
  skus?: string[];
  brandName?: string;
  variantGroupId?: string;
}): Promise<void> {
  await deleteProductDocsFromDb(params.docIds, params.skus || []);

  if (params.variantGroupId) {
    const cleanVGrp = params.variantGroupId.trim();
    if (cleanVGrp) {
      try {
        const qVGrp = query(collection(db, 'products'), where('variantGroupId', '==', cleanVGrp));
        const snapVGrp = await getDocs(qVGrp);
        for (const d of snapVGrp.docs) {
          await deleteDoc(d.ref);
        }
      } catch (e) {}

      try {
        const qStoreVGrp = query(
          collection(db, 'stores', ACTIVE_STORE_ID, 'products'),
          where('variantGroupId', '==', cleanVGrp)
        );
        const snapStoreVGrp = await getDocs(qStoreVGrp);
        for (const d of snapStoreVGrp.docs) {
          await deleteDoc(d.ref);
        }
      } catch (e) {}
    }
  }
}

/**
 * Delete a single variant document from Firestore.
 */
export async function deleteVariantFromDb(variant: ProductVariantItem): Promise<void> {
  const ids = [variant.docId, variant.id].filter(Boolean) as string[];
  const skus = [variant.sku].filter(Boolean) as string[];
  await deleteProductDocsFromDb(ids, skus);
}

/**
 * Deducts stock in Firestore across both `products/{id}` and `stores/{ACTIVE_STORE_ID}/products/{id}`
 * using Multi-Batch FEFO (First Expired, First Out) and records `stock_movements` and `stock_mutations`.
 */
export async function deductProductStockInFirestore(
  deductions: Array<{
    productId: string;
    productName: string;
    currentStock: number;
    unitsDeducted: number;
    product?: Partial<Product> & Record<string, any>;
    updatedBatches?: ProductBatchItem[];
    nearestProductionDate?: string;
    nearestExpiryDate?: string;
    fefoBatchesUsed?: Array<{
      batchCode: string;
      deductedQty: number;
      remainingQty?: number;
      productionDate?: string;
      expiryDate?: string;
    }>;
  }>,
  transactionId: string,
  channel: string = 'pos'
): Promise<void> {
  if (!deductions || deductions.length === 0) return;
  const nowIso = new Date().toISOString();

  await Promise.all(
    deductions.map(async (item) => {
      if (!item.productId || item.unitsDeducted <= 0) return;

      const isBomProduct = Boolean(
        item.product?.hasRawMaterials ||
          (Array.isArray(item.product?.rawMaterialRecipe) &&
            item.product.rawMaterialRecipe.length > 0)
      );

      let nextStock = isBomProduct
        ? Math.max(999, item.currentStock || 999)
        : Math.max(0, Math.round(item.currentStock - item.unitsDeducted));
      let updatedBatches = item.updatedBatches;
      let fefoBatchesUsed = item.fefoBatchesUsed;
      let nearestProductionDate = item.nearestProductionDate;
      let nearestExpiryDate = item.nearestExpiryDate;

      if (!isBomProduct && !updatedBatches && item.product) {
        const fefoRes = deductFefoBatches(item.product, item.unitsDeducted);
        updatedBatches = fefoRes.updatedBatches;
        fefoBatchesUsed = fefoRes.deductedBreakdown;
        nextStock = fefoRes.nextStock;
        if (fefoRes.nearestBatch) {
          nearestProductionDate = fefoRes.nearestBatch.productionDate;
          nearestExpiryDate = fefoRes.nearestBatch.expiryDate;
        }
      }

      if (
        isBomProduct &&
        item.product?.autoDeductRawMaterial !== false &&
        Array.isArray(item.product?.rawMaterialRecipe) &&
        item.product.rawMaterialRecipe.length > 0
      ) {
        try {
          await deductRawMaterialsForProductBom(
            item.product.rawMaterialRecipe,
            item.unitsDeducted,
            item.productName,
            transactionId
          );
        } catch (err) {
          console.error('[BOM Deduction] Failed to deduct raw materials:', err);
        }
      }

      const payload: Record<string, any> = {
        stockInUnits: nextStock,
        stock: nextStock,
        updatedAt: nowIso,
        lastReconciledTxId: transactionId,
      };

      if (updatedBatches !== undefined) {
        payload.batches = updatedBatches;
      }
      if (nearestProductionDate) {
        payload.productionDate = nearestProductionDate;
        payload.tanggalProduksi = nearestProductionDate;
      }
      if (nearestExpiryDate) {
        payload.expiryDate = nearestExpiryDate;
        payload.tanggalKadaluarsa = nearestExpiryDate;
      }

      const batchSummaryStr =
        fefoBatchesUsed && fefoBatchesUsed.length > 0
          ? fefoBatchesUsed
              .map(
                (b) =>
                  `${b.batchCode} (-${b.deductedQty}${b.expiryDate ? `, Exp: ${b.expiryDate}` : ''})`
              )
              .join(', ')
          : '';

      await Promise.all([
        setDoc(doc(db, 'products', item.productId), payload, { merge: true }),
        setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'products', item.productId), payload, {
          merge: true,
        }),
        setDoc(
          doc(db, 'stock_movements', `MOV-DOC_${transactionId}-${item.productId}`),
          {
            id: `MOV-DOC_${transactionId}-${item.productId}`,
            storeId: ACTIVE_STORE_ID,
            productId: item.productId,
            productName: item.productName,
            type: 'sale_deduction',
            channel,
            transactionId,
            previousStock: item.currentStock,
            unitsChange: -item.unitsDeducted,
            newStock: nextStock,
            batchCode: fefoBatchesUsed?.[0]?.batchCode || '',
            fefoBatchesUsed: fefoBatchesUsed || [],
            batchSummary: batchSummaryStr,
            createdAt: nowIso,
          },
          { merge: true }
        ),
      ]);
    })
  );
}

export interface PriceAdjustmentResult {
  oldCostPrice: number;
  newCostPrice: number;
  oldSellPrice: number;
  newSellPrice: number;
  oldOnlinePrice: number;
  newOnlinePrice: number;
  increasePercentage: number;
  isIncreased: boolean;
}

/**
 * Pembulatan harga jual agar ramah kasir (kelipatan Rp 100 terdekat ke atas)
 */
export const roundUpPrice = (price: number, nearest = 100): number => {
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (nearest <= 1) return Math.round(price);
  return Math.ceil(price / nearest) * nearest;
};

/**
 * Menghitung Harga Modal & Harga Jual baru yang naik sebanding dengan kenaikan harga pembelian
 */
export const calculateProportionalPrices = (
  oldCost: number,
  newBuyCost: number,
  oldSell: number,
  oldOnline?: number,
  mode: 'proportional_margin' | 'nominal_diff' = 'proportional_margin',
  roundingStep = 100
): PriceAdjustmentResult => {
  const safeOldCost = Math.max(0, Number(oldCost) || 0);
  const safeNewCost = Math.max(0, Number(newBuyCost) || 0);
  const safeOldSell = Math.max(0, Number(oldSell) || 0);
  const safeOldOnline = Math.max(0, Number(oldOnline) || safeOldSell);

  // Jika harga modal lama 0 tetapi harga beli baru > 0
  if (safeOldCost <= 0 && safeNewCost > 0) {
    const fallbackSell =
      safeOldSell > safeNewCost
        ? safeOldSell
        : roundUpPrice(safeNewCost * 1.25, roundingStep);
    const fallbackOnline =
      safeOldOnline > safeNewCost
        ? Math.max(safeOldOnline, fallbackSell)
        : fallbackSell;
    return {
      oldCostPrice: 0,
      newCostPrice: safeNewCost,
      oldSellPrice: safeOldSell,
      newSellPrice: fallbackSell,
      oldOnlinePrice: safeOldOnline,
      newOnlinePrice: fallbackOnline,
      increasePercentage: 100,
      isIncreased: true,
    };
  }

  // Jika harga beli tidak naik (sama atau lebih murah), pertahankan harga jual lama
  if (safeNewCost <= safeOldCost || safeOldCost <= 0) {
    return {
      oldCostPrice: safeOldCost,
      newCostPrice: safeNewCost > 0 ? safeNewCost : safeOldCost,
      oldSellPrice: safeOldSell,
      newSellPrice: safeOldSell,
      oldOnlinePrice: safeOldOnline,
      newOnlinePrice: safeOldOnline,
      increasePercentage: 0,
      isIncreased: false,
    };
  }

  const diffNominal = safeNewCost - safeOldCost;
  const ratio = safeNewCost / safeOldCost;
  const increasePercentage = Number(((ratio - 1) * 100).toFixed(2));

  let rawNewSell = safeOldSell;
  let rawNewOnline = safeOldOnline;

  if (mode === 'proportional_margin') {
    // Harga jual naik sebanding dengan rasio persentase kenaikan modal
    rawNewSell = safeOldSell > 0 ? safeOldSell * ratio : safeNewCost * 1.25;
    rawNewOnline = safeOldOnline > 0 ? safeOldOnline * ratio : rawNewSell;
  } else {
    // Harga jual naik sebesar nominal kenaikan modal (Rp)
    rawNewSell = safeOldSell + diffNominal;
    rawNewOnline = safeOldOnline + diffNominal;
  }

  // Pastikan harga jual baru minimal selalu di atas harga modal baru
  const finalSellPrice = Math.max(
    roundUpPrice(rawNewSell, roundingStep),
    safeNewCost + diffNominal
  );
  const finalOnlinePrice = Math.max(
    roundUpPrice(rawNewOnline, roundingStep),
    finalSellPrice
  );

  return {
    oldCostPrice: safeOldCost,
    newCostPrice: safeNewCost,
    oldSellPrice: safeOldSell,
    newSellPrice: finalSellPrice,
    oldOnlinePrice: safeOldOnline,
    newOnlinePrice: finalOnlinePrice,
    increasePercentage,
    isIncreased: true,
  };
};

export interface SyncProductProcurementParams {
  productId: string;
  currentProduct?: Partial<Product> & Record<string, any>;
  newStockInUnits: number;
  addedUnits?: number;
  newBuyCost: number;
  autoAdjustSellingPrice?: boolean;
  adjustmentMode?: 'proportional_margin' | 'nominal_diff';
  roundingStep?: number;
  batches?: ProductBatchItem[];
  productionDate?: string;
  expiryDate?: string;
  batchCode?: string;
  supplierName?: string;
  poId?: string;
}

/**
 * Menyinkronkan stok, Harga Modal, dan Harga Jual (Karton, Online PWA, Satuan, dan Varian)
 * dari transaksi Pembelian Produk (/dashboard/pembelian/pembelian-produk) ke koleksi `products`
 * serta mencatat log perubahan ke `product_logs`.
 */
export async function syncProductPricingFromProcurement(
  params: SyncProductProcurementParams
): Promise<{
  updatedPayload: Record<string, any>;
  priceAdjustment: PriceAdjustmentResult;
} | null> {
  const cleanId = String(params.productId || '').trim();
  if (!cleanId) return null;

  const prod = (params.currentProduct || {}) as Record<string, any>;
  const oldCost = Number(
    prod.costPrice ??
      prod.costPerCarton ??
      prod.costPerUnit ??
      prod.buyPrice ??
      prod.hargaModal ??
      prod.modal ??
      0
  );
  const oldSell = Number(
    prod.sellPrice ??
      prod.price ??
      prod.posPrice ??
      prod.sellingPrice ??
      prod.pricePerCarton ??
      prod.pricePerUnit ??
      prod.hargaJual ??
      0
  );
  const oldOnline = Number(
    prod.pwaPrice ??
      prod.onlinePrice ??
      prod.hargaOnline ??
      oldSell
  );
  const itemsPerCarton = Math.max(
    1,
    Number(prod.isiPerDus ?? prod.piecesPerCarton ?? prod.itemsPerCarton ?? 1)
  );

  const mode = params.adjustmentMode || 'proportional_margin';
  const roundingStep = params.roundingStep ?? 100;
  const autoAdjust = params.autoAdjustSellingPrice !== false;

  const priceAdjustment = calculateProportionalPrices(
    oldCost,
    params.newBuyCost,
    oldSell,
    oldOnline,
    mode,
    roundingStep
  );

  const shouldRaisePrices = autoAdjust && priceAdjustment.isIncreased;
  const finalCostPrice = priceAdjustment.isIncreased
    ? priceAdjustment.newCostPrice
    : oldCost > 0
    ? oldCost
    : Math.max(0, Number(params.newBuyCost) || 0);
  const finalSellPrice = shouldRaisePrices
    ? priceAdjustment.newSellPrice
    : oldSell > 0
    ? oldSell
    : finalCostPrice;
  const finalOnlinePrice = shouldRaisePrices
    ? priceAdjustment.newOnlinePrice
    : oldOnline > 0
    ? oldOnline
    : finalSellPrice;
  const finalUnitPrice = Math.ceil(finalSellPrice / itemsPerCarton);

  const safeStock = Math.max(0, Math.round(Number(params.newStockInUnits) || 0));
  const nowIso = new Date().toISOString();

  // If product has embedded variants array, update matching variants too
  let updatedVariants: any[] | undefined = undefined;
  if (Array.isArray(prod.variants) && prod.variants.length > 0) {
    updatedVariants = prod.variants.map((v: any, idx: number) => {
      const isMatch =
        v.id === cleanId ||
        v.docId === cleanId ||
        (prod.sku && v.sku === prod.sku) ||
        idx === 0;
      if (!isMatch) return v;
      const vItemsPerCarton = Math.max(
        1,
        Number(v.isiPerDus ?? v.piecesPerCarton ?? v.itemsPerCarton ?? itemsPerCarton)
      );
      return {
        ...v,
        stock: safeStock,
        stockInUnits: safeStock,
        costPrice: finalCostPrice,
        costPerUnit: finalCostPrice,
        costPerCarton: finalCostPrice,
        buyPrice: finalCostPrice,
        hargaModal: finalCostPrice,
        price: finalSellPrice,
        sellPrice: finalSellPrice,
        sellingPrice: finalSellPrice,
        posPrice: finalSellPrice,
        pricePerUnit: finalSellPrice,
        pricePerCarton: finalSellPrice,
        cartonWholesalePrice: finalSellPrice,
        hargaJual: finalSellPrice,
        onlinePrice: finalOnlinePrice,
        pwaPrice: finalOnlinePrice,
        hargaOnline: finalOnlinePrice,
        unitPrice: Math.ceil(finalSellPrice / vItemsPerCarton),
        updatedAt: nowIso,
      };
    });
  }

  const updatedPayload: Record<string, any> = {
    stockInUnits: safeStock,
    stock: safeStock,
    totalStock: safeStock,
    // Variasi properti Harga Modal
    costPrice: finalCostPrice,
    costPerUnit: finalCostPrice,
    costPerCarton: finalCostPrice,
    buyPrice: finalCostPrice,
    modal: finalCostPrice,
    hargaModal: finalCostPrice,
    capitalPrice: finalCostPrice,
    // Variasi properti Harga Jual POS / Karton
    price: finalSellPrice,
    sellingPrice: finalSellPrice,
    sellPrice: finalSellPrice,
    posPrice: finalSellPrice,
    pricePerUnit: finalSellPrice,
    pricePerCarton: finalSellPrice,
    cartonWholesalePrice: finalSellPrice,
    hargaJual: finalSellPrice,
    cartonPrice: finalSellPrice,
    // Variasi properti Harga Online PWA
    onlinePrice: finalOnlinePrice,
    pwaPrice: finalOnlinePrice,
    hargaOnline: finalOnlinePrice,
    // Harga Satuan / Eceran
    unitPrice: finalUnitPrice,
    updatedAt: nowIso,
  };

  if (updatedVariants) {
    updatedPayload.variants = updatedVariants;
  }
  if (params.batches !== undefined) {
    updatedPayload.batches = params.batches;
  }
  if (params.productionDate) {
    updatedPayload.productionDate = params.productionDate;
    updatedPayload.tanggalProduksi = params.productionDate;
  }
  if (params.expiryDate) {
    updatedPayload.expiryDate = params.expiryDate;
    updatedPayload.tanggalKadaluarsa = params.expiryDate;
  }

  await saveProductDocToAllPaths(cleanId, updatedPayload);

  // Record in `product_logs` (Kartu Stok & Riwayat Kenaikan Harga Otomatis)
  try {
    const logId = `PLOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const prodName = prod.name || prod.groupName || cleanId;
    const priceNote = priceAdjustment.isIncreased
      ? shouldRaisePrices
        ? `Auto-Markup Harga (+${priceAdjustment.increasePercentage}%): Modal Rp ${oldCost.toLocaleString('id-ID')} → Rp ${finalCostPrice.toLocaleString('id-ID')} | Harga Jual Rp ${oldSell.toLocaleString('id-ID')} → Rp ${finalSellPrice.toLocaleString('id-ID')}`
        : `Kenaikan Harga Modal: Rp ${oldCost.toLocaleString('id-ID')} → Rp ${finalCostPrice.toLocaleString('id-ID')}`
      : `Harga Modal tetap Rp ${finalCostPrice.toLocaleString('id-ID')}`;

    await setDoc(
      doc(db, 'product_logs', logId),
      {
        id: logId,
        productId: cleanId,
        productName: prodName,
        sku: prod.sku || cleanId,
        type: priceAdjustment.isIncreased ? 'PEMBELIAN & AUTO-MARKUP HARGA' : 'PEMBELIAN STOK',
        action: priceAdjustment.isIncreased ? 'price_and_stock_increase' : 'stock_in',
        qtyChange: Number(params.addedUnits || 0),
        newStock: safeStock,
        oldCostPrice: oldCost,
        newCostPrice: finalCostPrice,
        oldSellPrice: oldSell,
        newSellPrice: finalSellPrice,
        oldOnlinePrice: oldOnline,
        newOnlinePrice: finalOnlinePrice,
        increasePercentage: priceAdjustment.increasePercentage,
        referenceId: params.poId || '-',
        batchCode: params.batchCode || '-',
        supplierName: params.supplierName || '-',
        note: priceNote,
        date: new Date().toLocaleString('id-ID'),
        createdAt: nowIso,
        actor: 'Sistem Pembelian (Auto-Sync)',
      },
      { merge: true }
    );
  } catch (e) {
    console.warn('Failed to write product_logs entry:', e);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('riskcart:product-pricing-synced', {
        detail: {
          productId: cleanId,
          updatedPayload: { ...prod, ...updatedPayload, id: cleanId },
          priceAdjustment,
        },
      })
    );
  }

  return { updatedPayload, priceAdjustment };
}


