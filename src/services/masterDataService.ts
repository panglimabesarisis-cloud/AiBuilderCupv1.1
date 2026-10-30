import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  deleteDoc,
  query,
  where,
  limit,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ACTIVE_STORE_ID } from '../config/store';
import {
  DEFAULT_CATEGORIES as SEED_CATEGORIES,
  DEFAULT_BRANDS as SEED_BRANDS,
  isFictitiousDoc,
  purgeFictitiousDatabaseEntries,
} from './dataSeeder';

export { isFictitiousDoc, purgeFictitiousDatabaseEntries };

export const DEFAULT_CATEGORIES: string[] = [...SEED_CATEGORIES];
export const INITIAL_CATEGORIES: string[] = [...SEED_CATEGORIES];
export const FALLBACK_CATEGORIES: string[] = [...SEED_CATEGORIES];

export const DEFAULT_BRANDS: string[] = [...SEED_BRANDS];
export const INITIAL_BRANDS: string[] = [...SEED_BRANDS];
export const FALLBACK_BRANDS: string[] = [...SEED_BRANDS];

export interface MasterDataDoc {
  id: string;
  name: string;
  storeId: string;
  createdAt: string;
}

export interface CategoryItem {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  productCount?: number;
  totalStock?: number;
  totalAssetValue?: number;
  updatedAt?: string;
}

export const DELETED_CATEGORIES_STORAGE_KEY = 'riskcart_deleted_categories';

/**
 * Normalizes category name so case differences, extra spaces, and ID/EN synonyms
 * ("Air mineral", "Air Mineral", "Mineral Water") map to the exact same canonical key.
 */
export function normalizeCategoryKey(rawName?: string): string {
  const clean = String(rawName || '')
    .trim()
    .toLowerCase()
    .replace(/^cat[_\s-]+/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    clean === 'mineral water' ||
    clean === 'air mineral' ||
    clean === 'air mineral & galon' ||
    clean === 'air mineral dan galon' ||
    clean === 'mineral water & gallon'
  ) {
    return 'air mineral';
  }
  return clean;
}

export function toCategorySlug(name: string): string {
  return normalizeCategoryKey(name)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function getDeletedCategorySlugs(): Set<string> {
  try {
    if (typeof window === 'undefined') return new Set();
    const raw = localStorage.getItem(DELETED_CATEGORIES_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map((s) => String(s)) : []);
  } catch {
    return new Set();
  }
}

export function markCategoryDeleted(nameOrSlug: string): void {
  try {
    if (typeof window === 'undefined') return;
    const set = getDeletedCategorySlugs();
    const slug = toCategorySlug(nameOrSlug);
    const trimmedLower = String(nameOrSlug || '').trim().toLowerCase();
    if (slug) set.add(slug);
    if (trimmedLower) set.add(trimmedLower);
    localStorage.setItem(DELETED_CATEGORIES_STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

export function unmarkCategoryDeleted(nameOrSlug: string): void {
  try {
    if (typeof window === 'undefined') return;
    const set = getDeletedCategorySlugs();
    const slug = toCategorySlug(nameOrSlug);
    const trimmedLower = String(nameOrSlug || '').trim().toLowerCase();
    set.delete(slug);
    set.delete(trimmedLower);
    localStorage.setItem(DELETED_CATEGORIES_STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

function isCategorySlugDeleted(nameOrId: string, deletedSet: Set<string>): boolean {
  const trimmed = String(nameOrId || '').trim().toLowerCase();
  const slug = toCategorySlug(nameOrId);
  if (!trimmed && !slug) return true;
  return deletedSet.has(slug) || deletedSet.has(trimmed);
}

function normalizeAndSortUnique(names: string[], filterDeletedCategories = false): string[] {
  const deletedSet = filterDeletedCategories ? getDeletedCategorySlugs() : new Set<string>();
  const seen = new Map<string, string>();
  for (const raw of names) {
    const trimmed = (raw || '').trim();
    if (!trimmed) continue;
    // Ignore raw auto-generated document IDs like cat_default_1 if they leaked as names
    if (/^cat_default_\d+$/i.test(trimmed)) continue;
    const normKey = filterDeletedCategories
      ? normalizeCategoryKey(trimmed)
      : trimmed.toLowerCase().replace(/\s+/g, ' ');
    if (!normKey) continue;
    if (filterDeletedCategories && isCategorySlugDeleted(trimmed, deletedSet)) continue;
    if (!seen.has(normKey)) {
      seen.set(normKey, trimmed);
    }
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.localeCompare(b, 'id', { sensitivity: 'base' })
  );
}

/**
 * Fetch and deduplicate clean categories from Firestore + active products.
 * Automatically deletes duplicate category documents in Firestore using writeBatch.
 */
export async function fetchCleanCategories(products: any[] = []): Promise<CategoryItem[]> {
  const deletedSlugs = getDeletedCategorySlugs();
  const categoryMap = new Map<string, CategoryItem>();
  const duplicateRefsToDelete: any[] = [];

  try {
    const snap = await getDocs(collection(db, 'categories'));
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.deleted === true || isFictitiousDoc(docSnap.id, data)) {
        duplicateRefsToDelete.push(docSnap.ref);
        return;
      }
      const rawName = String(data.name || data.categoryName || data.title || '').trim();
      if (!rawName || /^cat_default_\d+$/i.test(rawName) || rawName.toLowerCase() === 'other') return;
      const normKey = normalizeCategoryKey(rawName);
      const slug = toCategorySlug(rawName);
      if (!normKey || !slug || isCategorySlugDeleted(rawName, deletedSlugs)) return;

      const existing = categoryMap.get(normKey);
      if (!existing) {
        categoryMap.set(normKey, {
          id: docSnap.id,
          name: rawName,
          slug,
          icon: data.icon || '📦',
          updatedAt: data.updatedAt || new Date().toISOString(),
        });
      } else {
        // Duplicate category document found in Firestore
        if (docSnap.id === `cat_${slug}` && existing.id !== `cat_${slug}`) {
          duplicateRefsToDelete.push(doc(db, 'categories', existing.id));
          categoryMap.set(normKey, {
            id: docSnap.id,
            name: rawName,
            slug,
            icon: data.icon || existing.icon || '📦',
            updatedAt: data.updatedAt || existing.updatedAt || new Date().toISOString(),
          });
        } else {
          duplicateRefsToDelete.push(docSnap.ref);
        }
      }
    });

    if (duplicateRefsToDelete.length > 0) {
      const batch = writeBatch(db);
      duplicateRefsToDelete.forEach((ref) => batch.delete(ref));
      await batch.commit().catch(() => {});
    }
  } catch (err) {
    console.warn('Error fetching categories collection:', err);
  }

  for (const p of products) {
    const pCat = String(p?.category || '').trim();
    if (!pCat || /^cat_default_\d+$/i.test(pCat) || pCat.toLowerCase() === 'other') continue;
    const normKey = normalizeCategoryKey(pCat);
    const slug = toCategorySlug(pCat);
    if (!normKey || !slug || isCategorySlugDeleted(pCat, deletedSlugs)) continue;
    if (!categoryMap.has(normKey)) {
      categoryMap.set(normKey, {
        id: `cat_${slug}`,
        name: pCat,
        slug,
        icon: '📦',
      });
    }
  }

  return Array.from(categoryMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'id', { sensitivity: 'base' })
  );
}

/**
 * Live hook returning sorted unique categories synchronized with /dashboard/kategori-produk
 * from both root `categories` and `stores/store_001/categories`.
 */
export function useCategories(): string[] {
  const [categories, setCategories] = useState<string[]>(() =>
    normalizeAndSortUnique([...SEED_CATEGORIES], true)
  );

  useEffect(() => {
    let rootCatDocs: string[] = [];

    const updateCombined = () => {
      const sorted = normalizeAndSortUnique([...SEED_CATEGORIES, ...rootCatDocs], true);
      setCategories(sorted);
      try {
        localStorage.setItem('riskcart_cache_categories', JSON.stringify(sorted));
      } catch (e) {}
    };

    const unsubCategories = onSnapshot(
      query(
        collection(db, 'categories'),
        where('storeId', '==', ACTIVE_STORE_ID),
        limit(100)
      ),
      (snapshot) => {
        rootCatDocs = [];
        const seenNorm = new Map<string, { id: string; ref: any; slug: string }>();

        snapshot.docs.forEach((d) => {
          const data = d.data();
          if (data.deleted === true || isFictitiousDoc(d.id, data)) {
            return;
          }
          const name = String(data.name || '').trim();
          if (!name || name.toLowerCase() === 'other' || /^cat_default_\d+$/i.test(name)) {
            return;
          }
          const normKey = normalizeCategoryKey(name);
          const slug = toCategorySlug(name);
          if (!normKey || !slug) return;

          if (!seenNorm.has(normKey)) {
            seenNorm.set(normKey, { id: d.id, ref: d.ref, slug });
            rootCatDocs.push(name);
          }
        });
        updateCombined();
      },
      (err) => {
        console.warn('useCategories listener notice:', err);
      }
    );

    const handleCategoriesSync = () => updateCombined();
    window.addEventListener('riskcart_categories_updated', handleCategoriesSync);

    return () => {
      unsubCategories();
      window.removeEventListener('riskcart_categories_updated', handleCategoriesSync);
    };
  }, []);

  return categories;
}

/**
 * Live hook returning sorted unique brands synchronized with /dashboard/kategori-produk
 */
export function useBrands(): string[] {
  const [brands, setBrands] = useState<string[]>([]);

  useEffect(() => {
    let rootBrandDocs: string[] = [];

    const updateCombined = () => {
      const sorted = normalizeAndSortUnique([...rootBrandDocs]);
      setBrands(sorted);
      try {
        localStorage.setItem('riskcart_cache_brands', JSON.stringify(sorted));
      } catch (e) {}
    };

    const unsubBrands = onSnapshot(
      query(
        collection(db, 'brands'),
        where('storeId', '==', ACTIVE_STORE_ID),
        limit(100)
      ),
      (snapshot) => {
        rootBrandDocs = [];
        snapshot.docs.forEach((d) => {
          const data = d.data();
          if (data.deleted === true || isFictitiousDoc(d.id, data)) return;
          const name = String(data.name || '').trim();
          if (name && !/^brand_default_\d+$/i.test(name)) {
            rootBrandDocs.push(name);
          }
        });
        updateCombined();
      },
      (err) => {
        console.warn('useBrands listener notice:', err);
      }
    );

    return () => {
      unsubBrands();
    };
  }, []);

  return brands;
}

/**
 * Live hook returning sorted storage location names from `storage_locations` collection.
 */
export function useStorageLocations(): string[] {
  const [locations, setLocations] = useState<string[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(
      query(
        collection(db, 'storage_locations'),
        where('storeId', '==', ACTIVE_STORE_ID),
        limit(100)
      ),
      (snapshot) => {
        const list = snapshot.docs
          .map((d) => String(d.data().name || '').trim())
          .filter(Boolean);
        setLocations(normalizeAndSortUnique(list));
      },
      (err) => {
        console.warn('useStorageLocations listener error:', err);
      }
    );
    return () => unsub();
  }, []);

  return locations;
}

/**
 * Add a new Brand to Firestore `brands` collection (sumber tunggal master Brand).
 * - Duplikat dicek HANYA ke koleksi `brands` (case-insensitive), BUKAN ke `products`.
 *   (Cek ke `products` dulu membuat brand yang sudah dipakai produk tidak bisa dibuat ulang.)
 * - Jika ada dokumen brand lama yang soft-deleted (deleted: true) dengan nama sama, dokumen itu dipulihkan.
 */
export async function addBrand(name: string): Promise<MasterDataDoc> {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    throw new Error('Nama brand wajib diisi.');
  }
  const lower = trimmed.toLowerCase();

  const brandsSnap = await getDocs(collection(db, 'brands'));
  const sameName = brandsSnap.docs.find(
    (d) => String(d.data().name || '').trim().toLowerCase() === lower
  );

  if (sameName && sameName.data().deleted !== true) {
    throw new Error(`Brand "${trimmed}" sudah ada.`);
  }

  const docRef = sameName ? doc(db, 'brands', sameName.id) : doc(collection(db, 'brands'));
  const nowISO = new Date().toISOString();
  const record: MasterDataDoc = {
    id: docRef.id,
    name: trimmed,
    storeId: ACTIVE_STORE_ID,
    createdAt: nowISO,
  };
  await setDoc(
    docRef,
    { ...record, createdBy: 'user', deleted: false, updatedAt: nowISO },
    { merge: true }
  );
  return record;
}

/**
 * Rename Brand + sinkronkan ke semua produk yang memakai brand lama
 * (`products` dan mirror `stores/{ACTIVE_STORE_ID}/products`).
 * Menggantikan pola lama "hapus lalu tambah" yang bisa menghilangkan brand jika langkah tambah gagal.
 */
export async function renameBrand(
  oldName: string,
  newName: string
): Promise<{ updatedProducts: number }> {
  const oldTrim = (oldName || '').trim();
  const newTrim = (newName || '').trim();
  if (!oldTrim) throw new Error('Brand lama tidak ditemukan.');
  if (!newTrim) throw new Error('Nama brand tidak boleh kosong.');
  if (oldTrim === newTrim) return { updatedProducts: 0 };

  const oldLower = oldTrim.toLowerCase();
  const newLower = newTrim.toLowerCase();

  const brandsSnap = await getDocs(collection(db, 'brands'));
  const activeBrands = brandsSnap.docs.filter((d) => d.data().deleted !== true);

  const clash = activeBrands.find((d) => {
    const n = String(d.data().name || '').trim().toLowerCase();
    return n === newLower && n !== oldLower;
  });
  if (clash) {
    throw new Error(`Brand "${newTrim}" sudah ada.`);
  }

  const nowISO = new Date().toISOString();
  const target = activeBrands.find(
    (d) => String(d.data().name || '').trim().toLowerCase() === oldLower
  );
  if (target) {
    await setDoc(doc(db, 'brands', target.id), { name: newTrim, updatedAt: nowISO }, { merge: true });
  } else {
    const ref = doc(collection(db, 'brands'));
    await setDoc(ref, {
      id: ref.id,
      name: newTrim,
      storeId: ACTIVE_STORE_ID,
      createdAt: nowISO,
      updatedAt: nowISO,
      deleted: false,
    });
  }

  // Juga perbarui di mirror stores/{ACTIVE_STORE_ID}/brands jika ada
  const storeBrandsSnap = await getDocs(collection(db, 'stores', ACTIVE_STORE_ID, 'brands')).catch(
    () => null
  );
  if (storeBrandsSnap) {
    await Promise.all(
      storeBrandsSnap.docs
        .filter((d) => String(d.data().name || '').trim().toLowerCase() === oldLower)
        .map((d) =>
          setDoc(
            doc(db, 'stores', ACTIVE_STORE_ID, 'brands', d.id),
            { name: newTrim, updatedAt: nowISO },
            { merge: true }
          ).catch(() => {})
        )
    );
  }

  // Propagasi nama brand baru ke semua dokumen produk yang memakai brand lama
  const [rootProducts, storeProducts] = await Promise.all([
    getDocs(query(collection(db, 'products'), where('brand', '==', oldTrim))),
    getDocs(
      query(collection(db, 'stores', ACTIVE_STORE_ID, 'products'), where('brand', '==', oldTrim))
    ).catch(() => null),
  ]);

  await Promise.all([
    ...rootProducts.docs.map((d) =>
      setDoc(doc(db, 'products', d.id), { brand: newTrim, updatedAt: nowISO }, { merge: true })
    ),
    ...(storeProducts?.docs || []).map((d) =>
      setDoc(
        doc(db, 'stores', ACTIVE_STORE_ID, 'products', d.id),
        { brand: newTrim, updatedAt: nowISO },
        { merge: true }
      ).catch(() => {})
    ),
  ]);

  return { updatedProducts: rootProducts.size };
}

/**
 * Pulihkan master Brand dari data produk: setiap `products.brand` yang belum ada
 * di koleksi `brands` dibuatkan dokumennya. Dipakai untuk memulihkan brand yang
 * terhapus oleh auto-wipe lama.
 */
export async function syncBrandsFromProducts(): Promise<{ created: string[] }> {
  const [brandsSnap, productsSnap] = await Promise.all([
    getDocs(collection(db, 'brands')),
    getDocs(collection(db, 'products')),
  ]);

  const existing = new Map<string, (typeof brandsSnap.docs)[number]>();
  brandsSnap.docs.forEach((d) => {
    const key = String(d.data().name || '').trim().toLowerCase();
    if (key) existing.set(key, d);
  });

  const toCreate = new Map<string, string>();
  productsSnap.docs.forEach((d) => {
    const data = d.data();
    if (data.deleted === true) return;
    const brandName = String(data.brand || '').trim();
    if (!brandName) return;
    const key = brandName.toLowerCase();
    const found = existing.get(key);
    if (found && found.data().deleted !== true) return;
    if (!toCreate.has(key)) toCreate.set(key, brandName);
  });

  const nowISO = new Date().toISOString();
  await Promise.all(
    Array.from(toCreate.entries()).map(([key, brandName]) => {
      const found = existing.get(key);
      const ref = found ? found.ref : doc(collection(db, 'brands'));
      return setDoc(
        ref,
        {
          id: ref.id,
          name: brandName,
          storeId: ACTIVE_STORE_ID,
          createdAt: nowISO,
          updatedAt: nowISO,
          deleted: false,
        },
        { merge: true }
      );
    })
  );

  return { created: Array.from(toCreate.values()) };
}

/**
 * Add a new Storage Location to Firestore `storage_locations` collection (trims & rejects case-insensitive duplicates).
 */
export async function addStorageLocation(name: string): Promise<MasterDataDoc> {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    throw new Error('Nama lokasi penyimpanan wajib diisi.');
  }
  const lower = trimmed.toLowerCase();

  const snap = await getDocs(collection(db, 'storage_locations'));
  const exists = snap.docs.some(
    (d) => String(d.data().name || '').trim().toLowerCase() === lower
  );
  if (exists) {
    throw new Error(`Lokasi penyimpanan "${trimmed}" sudah ada.`);
  }

  const docRef = doc(collection(db, 'storage_locations'));
  const record: MasterDataDoc = {
    id: docRef.id,
    name: trimmed,
    storeId: ACTIVE_STORE_ID,
    createdAt: new Date().toISOString(),
  };
  await setDoc(docRef, record);
  return record;
}

/**
 * Add a new Category to Firestore `categories` collection (trims & rejects case-insensitive duplicates).
 */
export async function addCategory(name: string, icon?: string): Promise<MasterDataDoc> {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    throw new Error('Nama kategori wajib diisi.');
  }
  const slug = toCategorySlug(trimmed);
  if (!slug) {
    throw new Error('Nama kategori tidak valid.');
  }

  unmarkCategoryDeleted(trimmed);

  const snap = await getDocs(collection(db, 'categories'));
  const matchingDocs = snap.docs.filter(
    (d) => toCategorySlug(String(d.data().name || d.id || '')) === slug
  );
  const activeExisting = matchingDocs.find((d) => d.data().deleted !== true);

  if (activeExisting) {
    throw new Error(`Kategori "${trimmed}" sudah ada.`);
  }

  const canonicalId = `cat_${slug}`;
  const nowISO = new Date().toISOString();
  const record: MasterDataDoc = {
    id: canonicalId,
    name: trimmed,
    storeId: ACTIVE_STORE_ID,
    createdAt: nowISO,
  };

  const payload = {
    ...record,
    slug,
    key: trimmed,
    icon: icon || '📦',
    createdBy: 'user',
    deleted: false,
    isActive: true,
    updatedAt: nowISO,
  };

  await setDoc(doc(db, 'categories', canonicalId), payload, { merge: true });
  await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'categories', canonicalId), payload, {
    merge: true,
  }).catch(() => {});

  // Clean up any stale non-canonical docs with the same slug
  await Promise.all(
    matchingDocs
      .filter((d) => d.id !== canonicalId)
      .map((d) => deleteDoc(d.ref).catch(() => {}))
  );

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('riskcart_categories_updated'));
  }

  return record;
}

/**
 * Update / Rename Category (Upsert + Cascade to Products + Clean Duplicate Category Docs)
 */
export async function updateMasterCategory(
  categoryId: string,
  oldName: string,
  newName: string,
  icon?: string
): Promise<{ success: boolean; newId: string; newName: string; updatedProducts: number }> {
  const cleanNewName = (newName || '').trim();
  const cleanOldName = (oldName || categoryId || '').trim();
  if (!cleanNewName) {
    throw new Error('Nama kategori tidak boleh kosong.');
  }

  const newSlug = toCategorySlug(cleanNewName);
  const oldSlug = toCategorySlug(cleanOldName);
  const idSlug = toCategorySlug(categoryId);
  const newDocId = `cat_${newSlug}`;
  const nowISO = new Date().toISOString();

  unmarkCategoryDeleted(cleanNewName);
  if (oldSlug && oldSlug !== newSlug) {
    markCategoryDeleted(cleanOldName);
  }
  if (idSlug && idSlug !== newSlug) {
    markCategoryDeleted(categoryId);
  }

  const [catSnap, storeCatSnap, rootProductsSnap, storeProductsSnap] = await Promise.all([
    getDocs(collection(db, 'categories')).catch(() => null),
    getDocs(collection(db, 'stores', ACTIVE_STORE_ID, 'categories')).catch(() => null),
    getDocs(collection(db, 'products')).catch(() => null),
    getDocs(collection(db, 'stores', ACTIVE_STORE_ID, 'products')).catch(() => null),
  ]);

  let resolvedIcon = icon || '📦';
  if (!icon && catSnap) {
    const foundOld = catSnap.docs.find(
      (d) =>
        d.id === categoryId ||
        toCategorySlug(String(d.data().name || '')) === oldSlug
    );
    if (foundOld?.data()?.icon) {
      resolvedIcon = foundOld.data().icon;
    }
  }

  const canonicalPayload = {
    id: newDocId,
    key: cleanNewName,
    name: cleanNewName,
    slug: newSlug,
    icon: resolvedIcon,
    createdBy: 'user',
    isActive: true,
    deleted: false,
    storeId: ACTIVE_STORE_ID,
    updatedAt: nowISO,
  };

  // 1. Upsert canonical doc in both root `categories` and `stores/{ACTIVE_STORE_ID}/categories`
  await setDoc(doc(db, 'categories', newDocId), canonicalPayload, { merge: true });
  await setDoc(
    doc(db, 'stores', ACTIVE_STORE_ID, 'categories', newDocId),
    canonicalPayload,
    { merge: true }
  ).catch(() => {});

  const isOldOrDuplicateCatDoc = (d: { id: string; data: () => any }) => {
    if (d.id === newDocId) return false;
    const dNameSlug = toCategorySlug(String(d.data().name || ''));
    const dIdSlug = toCategorySlug(d.id);
    return (
      d.id === categoryId ||
      (oldSlug && (dNameSlug === oldSlug || dIdSlug === oldSlug)) ||
      (idSlug && (dNameSlug === idSlug || dIdSlug === idSlug)) ||
      dNameSlug === newSlug ||
      dIdSlug === newSlug
    );
  };

  // 2. Delete all old/duplicate category documents in root and store collections
  if (catSnap) {
    await Promise.all(
      catSnap.docs
        .filter(isOldOrDuplicateCatDoc)
        .map((d) => deleteDoc(d.ref).catch(() => {}))
    );
  }
  if (storeCatSnap) {
    await Promise.all(
      storeCatSnap.docs
        .filter(isOldOrDuplicateCatDoc)
        .map((d) => deleteDoc(d.ref).catch(() => {}))
    );
  }

  // 3. Cascade update `category` field on all matching products
  const matchesOldCategory = (rawCat: unknown): boolean => {
    const c = String(rawCat || '').trim();
    if (!c) return false;
    const cSlug = toCategorySlug(c);
    return (
      (Boolean(oldSlug) && cSlug === oldSlug) ||
      (Boolean(idSlug) && cSlug === idSlug) ||
      c.toLowerCase() === cleanOldName.toLowerCase() ||
      c.toUpperCase() === categoryId.toUpperCase()
    );
  };

  let updatedProducts = 0;
  if (rootProductsSnap) {
    const docsToUpdate = rootProductsSnap.docs.filter((d) =>
      matchesOldCategory(d.data().category)
    );
    updatedProducts = docsToUpdate.length;
    await Promise.all(
      docsToUpdate.map((d) =>
        setDoc(
          d.ref,
          {
            category: cleanNewName,
            categoryId: newDocId,
            updatedAt: nowISO,
          },
          { merge: true }
        ).catch(() => {})
      )
    );
  }

  if (storeProductsSnap) {
    const storeDocsToUpdate = storeProductsSnap.docs.filter((d) =>
      matchesOldCategory(d.data().category)
    );
    await Promise.all(
      storeDocsToUpdate.map((d) =>
        setDoc(
          d.ref,
          {
            category: cleanNewName,
            categoryId: newDocId,
            updatedAt: nowISO,
          },
          { merge: true }
        ).catch(() => {})
      )
    );
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('riskcart_categories_updated'));
  }

  return { success: true, newId: newDocId, newName: cleanNewName, updatedProducts };
}

export async function renameCategory(
  oldNameOrId: string,
  newName: string,
  icon?: string
): Promise<{ updatedProducts: number; newId: string; newName: string }> {
  const res = await updateMasterCategory(oldNameOrId, oldNameOrId, newName, icon);
  return { updatedProducts: res.updatedProducts, newId: res.newId, newName: res.newName };
}

/**
 * Update category name in Firestore (supports both `(id, newName)` and `(id, oldName, newName, icon)`)
 */
export async function updateCategory(
  id: string,
  newNameOrOldName: string,
  maybeNewName?: string,
  icon?: string
): Promise<void> {
  if (typeof maybeNewName === 'string') {
    await updateMasterCategory(id, newNameOrOldName, maybeNewName, icon);
  } else {
    await updateMasterCategory(id, id, newNameOrOldName, icon);
  }
}

/**
 * Delete a category permanently from Firestore (`deleteDoc`) and record its slug in localStorage
 * so it never resurrects from seed or stale product strings.
 */
export async function deleteMasterCategory(
  categoryId: string,
  categoryName?: string
): Promise<boolean> {
  const rawId = (categoryId || '').trim();
  const rawName = (categoryName || categoryId || '').trim();
  if (!rawId && !rawName) return false;

  const nameSlug = toCategorySlug(rawName);
  const idSlug = toCategorySlug(rawId);
  const safeUpperKey = rawName.toUpperCase().replace(/[^A-Z0-9]/g, '_');

  if (rawName) markCategoryDeleted(rawName);
  if (rawId) markCategoryDeleted(rawId);

  const isTargetCategoryDoc = (d: { id: string; data: () => any }) => {
    const docName = String(d.data().name || '').trim();
    const docNameSlug = toCategorySlug(docName);
    const docIdSlug = toCategorySlug(d.id);
    return (
      d.id === rawId ||
      d.id === rawName ||
      d.id === safeUpperKey ||
      (Boolean(nameSlug) &&
        (d.id === `cat_${nameSlug}` || docNameSlug === nameSlug || docIdSlug === nameSlug)) ||
      (Boolean(idSlug) &&
        (d.id === `cat_${idSlug}` || docNameSlug === idSlug || docIdSlug === idSlug))
    );
  };

  try {
    const [rootSnap, storeSnap, rootProductsSnap, storeProductsSnap] = await Promise.all([
      getDocs(collection(db, 'categories')).catch(() => null),
      getDocs(collection(db, 'stores', ACTIVE_STORE_ID, 'categories')).catch(() => null),
      getDocs(collection(db, 'products')).catch(() => null),
      getDocs(collection(db, 'stores', ACTIVE_STORE_ID, 'products')).catch(() => null),
    ]);

    if (rootSnap) {
      await Promise.all(
        rootSnap.docs.filter(isTargetCategoryDoc).map((d) => deleteDoc(d.ref).catch(() => {}))
      );
    }
    if (storeSnap) {
      await Promise.all(
        storeSnap.docs.filter(isTargetCategoryDoc).map((d) => deleteDoc(d.ref).catch(() => {}))
      );
    }

    // Clear category string on products that still referenced this deleted category so it never resurrects
    const matchesDeletedCat = (rawCat: unknown): boolean => {
      const c = String(rawCat || '').trim();
      if (!c) return false;
      const cSlug = toCategorySlug(c);
      return (
        (Boolean(nameSlug) && cSlug === nameSlug) ||
        (Boolean(idSlug) && cSlug === idSlug) ||
        c.toLowerCase() === rawName.toLowerCase()
      );
    };

    const nowISO = new Date().toISOString();
    if (rootProductsSnap) {
      await Promise.all(
        rootProductsSnap.docs
          .filter((d) => matchesDeletedCat(d.data().category))
          .map((d) =>
            setDoc(d.ref, { category: '', updatedAt: nowISO }, { merge: true }).catch(() => {})
          )
      );
    }
    if (storeProductsSnap) {
      await Promise.all(
        storeProductsSnap.docs
          .filter((d) => matchesDeletedCat(d.data().category))
          .map((d) =>
            setDoc(d.ref, { category: '', updatedAt: nowISO }, { merge: true }).catch(() => {})
          )
      );
    }
  } catch (err) {
    console.warn('Error deleting category:', err);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('riskcart_categories_updated'));
  }

  return true;
}

export async function deleteCategory(idOrName: string, categoryName?: string): Promise<void> {
  await deleteMasterCategory(idOrName, categoryName || idOrName);
}

/**
 * One-click cleanup of duplicate/legacy category documents in Firestore.
 * Consolidates duplicates by `toCategorySlug(name)` into canonical `cat_${slug}` documents.
 */
export async function deduplicateCategories(): Promise<{
  removedCount: number;
  keptCount: number;
}> {
  const deletedSlugs = getDeletedCategorySlugs();
  let removedCount = 0;
  const canonicalBySlug = new Map<
    string,
    { name: string; icon: string; docs: Array<{ id: string; ref: any }> }
  >();

  const [rootSnap, storeSnap] = await Promise.all([
    getDocs(collection(db, 'categories')).catch(() => null),
    getDocs(collection(db, 'stores', ACTIVE_STORE_ID, 'categories')).catch(() => null),
  ]);

  const processSnap = async (snap: typeof rootSnap) => {
    if (!snap) return;
    for (const d of snap.docs) {
      const data = d.data();
      const rawName = String(data.name || '').trim();
      const slug = toCategorySlug(rawName);
      if (
        data.deleted === true ||
        !rawName ||
        !slug ||
        /^cat_default_\d+$/i.test(rawName) ||
        isCategorySlugDeleted(rawName, deletedSlugs)
      ) {
        await deleteDoc(d.ref).catch(() => {});
        removedCount++;
        continue;
      }

      const existing = canonicalBySlug.get(slug);
      if (!existing) {
        canonicalBySlug.set(slug, {
          name: rawName,
          icon: data.icon || '📦',
          docs: [{ id: d.id, ref: d.ref }],
        });
      } else {
        existing.docs.push({ id: d.id, ref: d.ref });
        if (d.id === `cat_${slug}`) {
          existing.name = rawName;
          existing.icon = data.icon || existing.icon;
        }
      }
    }
  };

  await processSnap(rootSnap);
  await processSnap(storeSnap);

  const nowISO = new Date().toISOString();
  for (const [slug, entry] of canonicalBySlug.entries()) {
    const canonicalId = `cat_${slug}`;
    const payload = {
      id: canonicalId,
      key: entry.name,
      name: entry.name,
      slug,
      icon: entry.icon || '📦',
      isActive: true,
      deleted: false,
      storeId: ACTIVE_STORE_ID,
      updatedAt: nowISO,
    };

    await setDoc(doc(db, 'categories', canonicalId), payload, { merge: true });
    await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'categories', canonicalId), payload, {
      merge: true,
    }).catch(() => {});

    for (const docItem of entry.docs) {
      if (docItem.id !== canonicalId) {
        await deleteDoc(docItem.ref).catch(() => {});
        removedCount++;
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('riskcart_categories_updated'));
  }

  return { removedCount, keptCount: canonicalBySlug.size };
}

/**
 * Delete a brand permanently from Firestore (`deleteDoc`)
 */
export async function deleteBrand(idOrName: string): Promise<void> {
  const trimmed = idOrName.trim();
  if (!trimmed) return;
  const lower = trimmed.toLowerCase();
  const isMatch = (d: { id: string; data: () => any }) =>
    d.id === trimmed || String(d.data().name || '').trim().toLowerCase() === lower;

  // Root `brands` (sumber utama): error TIDAK ditelan, agar toast menampilkan penyebab asli (mis. permission-denied)
  const rootSnap = await getDocs(collection(db, 'brands'));
  await Promise.all(rootSnap.docs.filter(isMatch).map((d) => deleteDoc(d.ref)));

  // Mirror `stores/{ACTIVE_STORE_ID}/brands` juga dibaca useBrands(), jadi ikut dibersihkan
  const storeSnap = await getDocs(collection(db, 'stores', ACTIVE_STORE_ID, 'brands')).catch(
    () => null
  );
  if (storeSnap) {
    await Promise.all(storeSnap.docs.filter(isMatch).map((d) => deleteDoc(d.ref).catch(() => {})));
  }
}

/**
 * Update brand name in Firestore
 */
export async function updateBrand(id: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error('Nama brand tidak boleh kosong.');
  await setDoc(
    doc(db, 'brands', id),
    { name: trimmed, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

/**
 * Factory Data Reset (Wipe All Data):
 * Deletes all documents in related Firestore collections, empties server-side stores via
 * POST /api/admin/reset-all-data, and clears browser localStorage/sessionStorage caches
 * while preserving OWNER and DEMO accounts.
 */
export async function executeFactoryDataReset(): Promise<{
  success: boolean;
  deletedCount: number;
}> {
  const { resetAllDatabaseData } = await import('./dataSeeder');
  return resetAllDatabaseData();
}

export { resetAllDatabaseData } from './dataSeeder';

