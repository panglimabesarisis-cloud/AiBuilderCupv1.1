import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ACTIVE_STORE_ID } from '../config/store';
import {
  DEFAULT_CATEGORIES as SEED_CATEGORIES,
  DEFAULT_BRANDS as SEED_BRANDS,
} from './dataSeeder';

export const DEFAULT_CATEGORIES: string[] = [];
export const INITIAL_CATEGORIES: string[] = [];
export const FALLBACK_CATEGORIES: string[] = [];

export const DEFAULT_BRANDS: string[] = [];
export const INITIAL_BRANDS: string[] = [];
export const FALLBACK_BRANDS: string[] = [];

export interface MasterDataDoc {
  id: string;
  name: string;
  storeId: string;
  createdAt: string;
}

function normalizeAndSortUnique(names: string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of names) {
    const trimmed = (raw || '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, trimmed);
    }
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.localeCompare(b, 'id', { sensitivity: 'base' })
  );
}

/**
 * Live hook returning sorted unique categories synchronized with /dashboard/kategori-produk
 * from both root `categories` and `stores/store_001/categories`.
 */
export function useCategories(): string[] {
  const [categories, setCategories] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('riskcart_cache_categories');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  });

  useEffect(() => {
    let rootCatDocs: string[] = [];
    let storeCatDocs: string[] = [];

    const updateCombined = () => {
      const sorted = normalizeAndSortUnique([...storeCatDocs, ...rootCatDocs]);
      setCategories(sorted);
      try {
        localStorage.setItem('riskcart_cache_categories', JSON.stringify(sorted));
      } catch (e) {}
    };

    const unsubCategories = onSnapshot(
      collection(db, 'categories'),
      (snapshot) => {
        rootCatDocs = [];
        snapshot.docs.forEach((d) => {
          const data = d.data();
          if (data.deleted === true) return;
          const name = String(data.name || d.id || '').trim();
          if (name) {
            rootCatDocs.push(name);
          }
        });
        updateCombined();
      },
      (err) => {
        console.warn('useCategories listener notice:', err);
      }
    );

    const unsubStoreCategories = onSnapshot(
      collection(db, 'stores', ACTIVE_STORE_ID, 'categories'),
      (snapshot) => {
        storeCatDocs = [];
        snapshot.docs.forEach((d) => {
          const data = d.data();
          if (data.deleted === true) return;
          const name = String(data.name || d.id || '').trim();
          if (name) {
            storeCatDocs.push(name);
          }
        });
        updateCombined();
      },
      () => {}
    );

    return () => {
      unsubCategories();
      unsubStoreCategories();
    };
  }, []);

  return categories;
}

/**
 * Live hook returning sorted unique brands synchronized with /dashboard/kategori-produk
 * from both root `brands` and `stores/store_001/brands`.
 */
export function useBrands(): string[] {
  const [brands, setBrands] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('riskcart_cache_brands');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  });

  useEffect(() => {
    let rootBrandDocs: string[] = [];
    let storeBrandDocs: string[] = [];

    const updateCombined = () => {
      const sorted = normalizeAndSortUnique([...storeBrandDocs, ...rootBrandDocs]);
      setBrands(sorted);
      try {
        localStorage.setItem('riskcart_cache_brands', JSON.stringify(sorted));
      } catch (e) {}
    };

    const unsubBrands = onSnapshot(
      collection(db, 'brands'),
      (snapshot) => {
        rootBrandDocs = [];
        snapshot.docs.forEach((d) => {
          const data = d.data();
          if (data.deleted === true) return;
          const name = String(data.name || d.id || '').trim();
          if (name) {
            rootBrandDocs.push(name);
          }
        });
        updateCombined();
      },
      (err) => {
        console.warn('useBrands listener notice:', err);
      }
    );

    const unsubStoreBrands = onSnapshot(
      collection(db, 'stores', ACTIVE_STORE_ID, 'brands'),
      (snapshot) => {
        storeBrandDocs = [];
        snapshot.docs.forEach((d) => {
          const data = d.data();
          if (data.deleted === true) return;
          const name = String(data.name || d.id || '').trim();
          if (name) {
            storeBrandDocs.push(name);
          }
        });
        updateCombined();
      },
      () => {}
    );

    return () => {
      unsubBrands();
      unsubStoreBrands();
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
      collection(db, 'storage_locations'),
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
 * Add a new Brand to Firestore `brands` collection (trims & rejects case-insensitive duplicates).
 */
export async function addBrand(name: string): Promise<MasterDataDoc> {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    throw new Error('Nama brand wajib diisi.');
  }
  const lower = trimmed.toLowerCase();

  const [brandsSnap, productsSnap] = await Promise.all([
    getDocs(collection(db, 'brands')),
    getDocs(collection(db, 'products')),
  ]);

  const existsInBrands = brandsSnap.docs.some(
    (d) => !d.data().deleted && String(d.data().name || '').trim().toLowerCase() === lower
  );
  const existsInProducts = productsSnap.docs.some(
    (d) => String(d.data().brand || '').trim().toLowerCase() === lower
  );

  if (existsInBrands || existsInProducts) {
    throw new Error(`Brand "${trimmed}" sudah ada.`);
  }

  const docRef = doc(collection(db, 'brands'));
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
  const lower = trimmed.toLowerCase();

  const snap = await getDocs(collection(db, 'categories'));
  const existingDoc = snap.docs.find(
    (d) => String(d.data().name || d.id || '').trim().toLowerCase() === lower
  );

  const catKey =
    existingDoc?.id ||
    trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '_') ||
    `CAT_${Date.now()}`;

  if (existingDoc && !existingDoc.data().deleted) {
    throw new Error(`Kategori "${trimmed}" sudah ada.`);
  }

  const record: MasterDataDoc = {
    id: catKey,
    name: trimmed,
    storeId: ACTIVE_STORE_ID,
    createdAt: new Date().toISOString(),
  };

  await setDoc(
    doc(db, 'categories', catKey),
    {
      ...record,
      icon: icon || '📦',
      deleted: false,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  return record;
}

/**
 * Delete a category permanently from Firestore (`deleteDoc`)
 */
export async function deleteCategory(idOrName: string): Promise<void> {
  const catKey = idOrName.trim();
  if (!catKey) return;
  const safeDocKey = catKey.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  try {
    await deleteDoc(doc(db, 'categories', catKey)).catch(() => {});
    await deleteDoc(doc(db, 'categories', safeDocKey)).catch(() => {});
    const snap = await getDocs(collection(db, 'categories'));
    await Promise.all(
      snap.docs
        .filter(
          (d) =>
            d.id === catKey ||
            d.id === safeDocKey ||
            String(d.data().name || '').trim().toLowerCase() === catKey.toLowerCase()
        )
        .map((d) => deleteDoc(d.ref).catch(() => {}))
    );
  } catch (err) {
    console.warn('Error deleting category:', err);
  }
}

/**
 * Update category name in Firestore
 */
export async function updateCategory(id: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error('Nama kategori tidak boleh kosong.');
  await setDoc(
    doc(db, 'categories', id),
    { name: trimmed, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

/**
 * Delete a brand permanently from Firestore (`deleteDoc`)
 */
export async function deleteBrand(idOrName: string): Promise<void> {
  const trimmed = idOrName.trim();
  if (!trimmed) return;
  const safeDocKey = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  try {
    await deleteDoc(doc(db, 'brands', trimmed)).catch(() => {});
    if (safeDocKey) {
      await deleteDoc(doc(db, 'brands', safeDocKey)).catch(() => {});
    }
    const snap = await getDocs(collection(db, 'brands'));
    await Promise.all(
      snap.docs
        .filter(
          (d) =>
            d.id === trimmed ||
            d.id === safeDocKey ||
            String(d.data().name || '').trim().toLowerCase() === trimmed.toLowerCase()
        )
        .map((d) => deleteDoc(d.ref).catch(() => {}))
    );
  } catch (err) {
    console.warn('Error deleting brand:', err);
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
