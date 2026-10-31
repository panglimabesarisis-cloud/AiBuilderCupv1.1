import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  Product,
  StoreConfig,
  Transaction,
} from '../types';
import { ACTIVE_STORE_ID } from '../config/store';
import {
  TRANSACTIONAL_COLLECTIONS,
  CATALOG_COLLECTIONS,
  PROTECTED_SYSTEM_COLLECTIONS,
  PROTECTED_CORE_COLLECTIONS,
  TRANSACTION_ONLY_COLLECTIONS,
  extractDocTimestamp,
  getTodayJakartaYmd,
  isDocFromTargetDateOrShift,
  purgeTodayShiftTransactions,
  purgeTransactionsBeforeDate,
  type PurgeResult,
  resetDemoSandbox,
} from '../utils/firestoreSandbox';
import { ensureSidebarMenuSeeded } from './sidebarMenuService';

export {
  TRANSACTIONAL_COLLECTIONS,
  CATALOG_COLLECTIONS,
  PROTECTED_SYSTEM_COLLECTIONS,
  PROTECTED_CORE_COLLECTIONS,
  TRANSACTION_ONLY_COLLECTIONS,
  extractDocTimestamp,
  getTodayJakartaYmd,
  isDocFromTargetDateOrShift,
  purgeTodayShiftTransactions,
  purgeTransactionsBeforeDate,
  type PurgeResult,
};

export const DEMO_STORE_ID = ACTIVE_STORE_ID;

export const CLEAN_SLATE_STORAGE_KEY = 'CLEAN_DB_V3';
export const CLEAN_CATEGORIES_BRANDS_KEY = 'CLEAN_CATEGORIES_BRANDS_V6';
export const FACTORY_RESET_STORAGE_KEY = 'CLEAN_SLATE_FACTORY_RESET_V3';

export const DEFAULT_STORE_CONFIG: StoreConfig = {
  id: ACTIVE_STORE_ID,
  name: 'RiskCart Flagship Mart (AI Cup 2026)',
  ownerEmail: 'owner@riskcart.ai',
  latitude: -6.2088,
  longitude: 106.8456,
  geofenceRadiusMeters: 500,
  fraudThresholdScore: 65,
  currency: 'IDR',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

import {
  ARABIAN_FOOD_CATEGORIES,
  ARABIAN_FOOD_PRODUCTS,
} from './rawMaterialService';

export const DEFAULT_CATEGORIES: string[] = [...ARABIAN_FOOD_CATEGORIES];
export const INITIAL_CATEGORIES: string[] = [...ARABIAN_FOOD_CATEGORIES];
export const FALLBACK_CATEGORIES: string[] = [...ARABIAN_FOOD_CATEGORIES];

export const DEFAULT_BRANDS: string[] = [
  'Al-Barakah Kitchen',
  'La Bella Italia Kitchen',
  'Merlion Singapore Kitchen',
  'Selera Nusantara Kitchen',
];
export const INITIAL_BRANDS: string[] = [
  'Al-Barakah Kitchen',
  'La Bella Italia Kitchen',
  'Merlion Singapore Kitchen',
  'Selera Nusantara Kitchen',
];

export const INITIAL_PRODUCTS: Omit<Product, 'createdAt' | 'updatedAt'>[] =
  ARABIAN_FOOD_PRODUCTS as any;
export const INITIAL_CUSTOMERS: any[] = [];
export const INITIAL_TRANSACTIONS: Transaction[] = [];

export const APP_INSTANCE_ID = '7692b7e9-2666-4a30-8855-b9fb3d913550';

const LEGACY_SEED_PRODUCT_IDS = new Set([
  'prod_aqua_600ml_dus',
  'prod_leminerale_600ml_dus',
  'prod_pucuk_350ml_dus',
  'prod_indomie_goreng_dus',
  'prod_ultramilk_250ml_dus',
]);

const LEGACY_SEED_CATEGORY_NAMES = new Set([
  'mineral water & galon',
  'minuman berperisa & teh',
  'minuman soda & kola',
  'kopi siap minum & bubuk',
  'dairy & milk (susu)',
  'mie instan & cepat saji',
  'snacks & biskuit',
  'lpg 3kg & gas melon',
  'kategori lainnya',
  'other',
]);

const LEGACY_SEED_BRAND_NAMES = new Set([
  'aqua',
  'le minerale',
  'teh pucuk harum',
  'coca-cola',
  'indomie',
  'kapal api',
  'ultra milk',
  'pertamina lpg',
]);

function normalizeSeedSlug(val: string): string {
  return String(val || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function isFictitiousDoc(docId: string, data: Record<string, any> | undefined): boolean {
  const idLower = String(docId || '').trim().toLowerCase();
  if (
    idLower.startsWith('seed_') ||
    idLower.startsWith('dummy_') ||
    idLower.startsWith('mock_') ||
    idLower.startsWith('sample_') ||
    idLower.startsWith('default_') ||
    idLower.startsWith('init_') ||
    idLower.startsWith('demo_') ||
    idLower.startsWith('cat_default_') ||
    idLower.startsWith('brand_default_') ||
    LEGACY_SEED_PRODUCT_IDS.has(idLower)
  ) {
    return true;
  }
  if (
    data?.isSeed === true ||
    data?.isDummy === true ||
    data?.isMock === true ||
    data?.isDemo === true ||
    data?.source === 'seeder'
  ) {
    return true;
  }
  return false;
}

/**
 * Menghapus semua data tambahan/fiktif dari Firestore dan LocalStorage,
 * serta membersihkan kategori/brand bawaan yang tidak dipakai oleh produk asli pengguna.
 */
export async function purgeFictitiousDatabaseEntries(
  options: { removeUnusedCategoriesAndBrands?: boolean } = { removeUnusedCategoriesAndBrands: true },
  onProgress?: (msg: string) => void
): Promise<{ deletedCount: number }> {
  let deletedCount = 0;

  // 1. Periksa produk asli pengguna di koleksi `products` dan `stores/{ACTIVE_STORE_ID}/products`
  onProgress?.('Memeriksa produk asli Anda...');
  const usedCategories = new Set<string>();
  const usedCategorySlugs = new Set<string>();
  const usedBrands = new Set<string>();

  for (const prodColPath of [['products'], ['stores', ACTIVE_STORE_ID, 'products']]) {
    try {
      const colRef =
        prodColPath.length === 1
          ? collection(db, prodColPath[0])
          : collection(db, prodColPath[0], prodColPath[1], prodColPath[2]);
      const prodSnap = await getDocs(colRef);
      const docsToDelete: any[] = [];

      prodSnap.docs.forEach((d) => {
        const data = d.data();
        if (isFictitiousDoc(d.id, data)) {
          docsToDelete.push(d.ref);
        } else {
          const catStr = String(data.category || '').trim();
          const catLower = catStr.toLowerCase();
          if (catStr && catLower !== 'other' && !/^cat_default_\d+$/i.test(catStr)) {
            usedCategories.add(catLower);
            const slug = normalizeSeedSlug(catStr);
            if (slug) usedCategorySlugs.add(slug);
          }
          const brandStr = String(data.brand || '').trim().toLowerCase();
          if (brandStr) {
            usedBrands.add(brandStr);
          }
        }
      });

      if (docsToDelete.length > 0) {
        await Promise.all(
          docsToDelete.map(async (ref) => {
            await deleteDoc(ref).catch(() => {});
            deletedCount++;
          })
        );
      }
    } catch (e) {
      console.warn('[purgeFictitiousDatabaseEntries] products check notice:', e);
    }
  }

  // 2. Bersihkan kategori fiktif / bawaan seeder / duplikat di `categories`, `product_categories`, `master_categories`, dan `stores/{ACTIVE_STORE_ID}/categories`
  const categoryPaths: string[][] = [
    ['categories'],
    ['product_categories'],
    ['master_categories'],
    ['stores', ACTIVE_STORE_ID, 'categories'],
  ];

  for (const catPath of categoryPaths) {
    try {
      onProgress?.(`Membersihkan data fiktif di ${catPath.join('/')}...`);
      const colRef =
        catPath.length === 1
          ? collection(db, catPath[0])
          : collection(db, catPath[0], catPath[1], catPath[2]);
      const snap = await getDocs(colRef);
      if (snap.empty) continue;

      const seenSlugs = new Set<string>();
      const refsToDelete: any[] = [];

      // Urutkan agar dokumen buatan user (`createdBy === 'user'`) atau `cat_<slug>` diprioritaskan
      const sortedDocs = [...snap.docs].sort((a, b) => {
        const aUser = a.data().createdBy === 'user' ? 1 : 0;
        const bUser = b.data().createdBy === 'user' ? 1 : 0;
        if (aUser !== bUser) return bUser - aUser;
        const aCanon = a.id.startsWith('cat_') && !a.id.startsWith('cat_default_') ? 1 : 0;
        const bCanon = b.id.startsWith('cat_') && !b.id.startsWith('cat_default_') ? 1 : 0;
        return bCanon - aCanon;
      });

      sortedDocs.forEach((d) => {
        const data = d.data();
        const rawName = String(data.name || data.title || '').trim();
        const nameKey = rawName.toLowerCase();
        const slug = normalizeSeedSlug(rawName);
        const isDummy = isFictitiousDoc(d.id, data) || /^cat_default_\d+$/i.test(rawName) || nameKey === 'other';
        const isDuplicate = slug ? seenSlugs.has(slug) : true;
        const isLegacySeedName = LEGACY_SEED_CATEGORY_NAMES.has(nameKey);
        const isUsedByRealProduct = usedCategories.has(nameKey) || (Boolean(slug) && usedCategorySlugs.has(slug));
        const isUnusedSeed =
          data.createdBy !== 'user' &&
          !isUsedByRealProduct &&
          (options.removeUnusedCategoriesAndBrands !== false || isLegacySeedName);

        if (isDummy || isDuplicate || isUnusedSeed || !nameKey || !slug) {
          refsToDelete.push(d.ref);
        } else {
          seenSlugs.add(slug);
        }
      });

      if (refsToDelete.length > 0) {
        await Promise.all(
          refsToDelete.map(async (ref) => {
            await deleteDoc(ref).catch(() => {});
            deletedCount++;
          })
        );
      }
    } catch (e) {
      console.warn(`Skip ${catPath.join('/')}:`, e);
    }
  }

  // 3. Bersihkan brand fiktif / duplikat di `brands`, `product_brands`, `master_brands`, dan `stores/{ACTIVE_STORE_ID}/brands`
  const brandPaths: string[][] = [
    ['brands'],
    ['product_brands'],
    ['master_brands'],
    ['stores', ACTIVE_STORE_ID, 'brands'],
  ];

  for (const bPath of brandPaths) {
    try {
      const colRef =
        bPath.length === 1
          ? collection(db, bPath[0])
          : collection(db, bPath[0], bPath[1], bPath[2]);
      const snap = await getDocs(colRef);
      if (snap.empty) continue;

      const seenBrands = new Set<string>();
      const refsToDelete: any[] = [];

      snap.docs.forEach((d) => {
        const data = d.data();
        const nameKey = String(data.name || '').trim().toLowerCase();
        const isDummy = isFictitiousDoc(d.id, data);
        const isDuplicate = nameKey ? seenBrands.has(nameKey) : true;
        const isLegacySeedBrand = LEGACY_SEED_BRAND_NAMES.has(nameKey);
        const isUnusedSeed =
          data.createdBy !== 'user' &&
          !usedBrands.has(nameKey) &&
          (options.removeUnusedCategoriesAndBrands !== false || isLegacySeedBrand);

        if (isDummy || isDuplicate || isUnusedSeed || !nameKey) {
          refsToDelete.push(d.ref);
        } else {
          seenBrands.add(nameKey);
        }
      });

      if (refsToDelete.length > 0) {
        await Promise.all(
          refsToDelete.map(async (ref) => {
            await deleteDoc(ref).catch(() => {});
            deletedCount++;
          })
        );
      }
    } catch {}
  }

  // 4. Bersihkan data fiktif di koleksi lainnya (customers, discounts, bundles, transactions, orders)
  const targetCollections = [
    'customers',
    'discounts',
    'discount_prices',
    'product_bundles',
    'bundles',
    'reward_targets',
    'transactions',
    'pos_transactions',
    'orders',
    'online_orders',
  ];

  for (const colName of targetCollections) {
    try {
      const snap = await getDocs(collection(db, colName));
      if (snap.empty) continue;

      const refsToDelete = snap.docs
        .filter((d) => isFictitiousDoc(d.id, d.data()) || isLegacyMockOrderOrTx(d.data(), d.id))
        .map((d) => d.ref);

      if (refsToDelete.length > 0) {
        await Promise.all(
          refsToDelete.map(async (ref) => {
            await deleteDoc(ref).catch(() => {});
            deletedCount++;
          })
        );
      }
    } catch {}
  }

  // 5. Hapus semua cache data fiktif/seed di localStorage
  if (typeof window !== 'undefined') {
    const dummyLocalKeys = [
      'riskcart_seeded',
      'is_seeded',
      'riskcart_master_categories',
      'riskcart_master_brands',
      'riskcart_dummy_data',
      'riskcart_categories',
      'riskcart_brands',
      'pos_categories',
      'pos_brands',
      'riskcart_cache_categories',
      'riskcart_cache_brands',
      'riskcart_fs_categories',
      'riskcart_fs_brands',
    ];
    dummyLocalKeys.forEach((k) => {
      try {
        window.localStorage.removeItem(k);
      } catch {}
    });
    window.dispatchEvent(new CustomEvent('riskcart_categories_updated'));
  }

  onProgress?.(`Selesai! ${deletedCount} data fiktif/tambahan berhasil dihapus permanen.`);
  return { deletedCount };
}

export const purgeAllFictitiousAndDummyData = purgeFictitiousDatabaseEntries;

export function isLegacyMockOrderOrTx(raw: any, id?: string): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const docId = String(id || raw.id || '').toLowerCase();
  if (
    docId.startsWith('mock_') ||
    docId.startsWith('demo_') ||
    docId.startsWith('tx_demo') ||
    docId.startsWith('ord_demo') ||
    docId.startsWith('seed_') ||
    raw.isMock === true ||
    raw.isDemo === true
  ) {
    return true;
  }
  return false;
}

let wipeInFlightPromise: Promise<{ success: boolean; deletedCount: number; mode?: string }> | null = null;
let isCurrentlyWiping = false;

export function isCleanSlateDone(): boolean {
  return true;
}

export function isDatabaseWipeInProgress(): boolean {
  return isCurrentlyWiping;
}

/**
 * Checks whether a staff/user document is a protected OWNER or DEMO account.
 */
export function isOwnerOrDemoAccountDoc(data: any, docId?: string): boolean {
  if (!data || typeof data !== 'object') return false;
  const idStr = String(docId || data.uid || data.id || '').trim().toLowerCase();
  const email = String(data.email || '').trim().toLowerCase();
  const role = String(data.role || data.roleKey || '').trim().toLowerCase();
  const username = String(data.username || data.name || '').trim().toLowerCase();

  if (
    role === 'owner' ||
    role === 'super admin' ||
    role === 'demo' ||
    data.isDemo === true ||
    data.isOwner === true ||
    idStr === 'staff_001' ||
    idStr === 'staff_demo' ||
    idStr.includes('owner') ||
    idStr.includes('demo') ||
    email === 'owner@riskcart.ai' ||
    email.includes('owner') ||
    email.includes('demo') ||
    username.includes('owner') ||
    username.includes('demo')
  ) {
    return true;
  }
  return false;
}

export function isOwnerAccountDoc(data: any, docId?: string): boolean {
  return isOwnerOrDemoAccountDoc(data, docId);
}

export interface FactoryResetOptions {
  mode: 'transactions_only' | 'full_with_reseed';
}

/**
 * Selective localStorage cleanup:
 * Preserves authentication, sidebar menu structure, system settings, and RBAC.
 * When mode === 'transactions_only', also preserves brands, categories, and products caches.
 */
export function clearAllBrowserDataCaches(
  preserveCleanSlateFlag: boolean = true,
  mode: 'transactions_only' | 'full_with_reseed' = 'transactions_only'
): void {
  if (typeof window === 'undefined') return;
  try {
    const protectedLocalStoragePrefixes = [
      'firebase:',
      'auth_',
      'riskcart_auth',
      'riskcart_sidebar',
      'riskcart_wp_sidebar_menu',
      'riskcart_settings',
      'riskcart_pos_settings',
      'riskcart_pwa_settings',
      'riskcart_active_cashier',
      'riskcart_server_token',
      'riskcart_rbac',
      'riskcart_demo_mode',
      'riskcart_theme_mode',
      'riskcart_language',
      'riskcart_currency_mode',
      'pos_settings_',
      'pwa_settings_',
    ];

    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;

      if (
        preserveCleanSlateFlag &&
        (key === CLEAN_SLATE_STORAGE_KEY ||
          key === CLEAN_CATEGORIES_BRANDS_KEY ||
          key === FACTORY_RESET_STORAGE_KEY ||
          key === 'CLEAN_SLATE_EMPTY_INIT_V2')
      ) {
        continue;
      }

      const isProtected = protectedLocalStoragePrefixes.some((prefix) => key.startsWith(prefix));
      if (isProtected) continue;

      if (mode === 'transactions_only') {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('brands') ||
          lowerKey.includes('categories') ||
          lowerKey.includes('products') ||
          lowerKey.includes('customer') ||
          lowerKey.includes('outlet') ||
          lowerKey.includes('staff')
        ) {
          continue;
        }
      }

      keysToRemove.push(key);
    }

    keysToRemove.forEach((k) => {
      try {
        window.localStorage.removeItem(k);
      } catch {}
    });

    // Selective sessionStorage cleanup: preserve login/auth & demo mode keys
    const sessionKeysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const sKey = window.sessionStorage.key(i);
      if (!sKey) continue;
      const isProtected = protectedLocalStoragePrefixes.some((prefix) => sKey.startsWith(prefix));
      if (!isProtected) {
        sessionKeysToRemove.push(sKey);
      }
    }
    sessionKeysToRemove.forEach((sk) => {
      try {
        window.sessionStorage.removeItem(sk);
      } catch {}
    });
  } catch (err) {
    console.warn('Selective storage cleanup notice:', err);
  }
}

/**
 * Deletes documents in a collection using writeBatch in chunks of 400 docs
 * while strictly skipping any collection in PROTECTED_SYSTEM_COLLECTIONS.
 */
async function deleteAllDocsInCollectionPath(
  colPathSegments: [string, ...string[]],
  options?: {
    deleteNestedItemsSubcollection?: boolean;
  }
): Promise<number> {
  const leafCollection = colPathSegments[colPathSegments.length - 1];
  if (PROTECTED_SYSTEM_COLLECTIONS.includes(leafCollection)) {
    console.warn(`[SafeReset] Blocked attempt to delete protected collection: ${colPathSegments.join('/')}`);
    return 0;
  }

  let deleted = 0;
  try {
    const colRef = collection(db, ...colPathSegments);
    const snapshot = await getDocs(colRef);
    if (snapshot.empty) return 0;

    if (options?.deleteNestedItemsSubcollection) {
      await Promise.all(
        snapshot.docs.map(async (docSnap) => {
          try {
            const itemsRef = collection(db, ...colPathSegments, docSnap.id, 'items');
            const itemsSnap = await getDocs(itemsRef);
            if (!itemsSnap.empty) {
              const itemChunks = [];
              for (let i = 0; i < itemsSnap.docs.length; i += 400) {
                itemChunks.push(itemsSnap.docs.slice(i, i + 400));
              }
              for (const chunk of itemChunks) {
                const batch = writeBatch(db);
                chunk.forEach((itemDoc) => batch.delete(itemDoc.ref));
                await batch.commit();
                deleted += chunk.length;
              }
            }
          } catch {}
        })
      );
    }

    const docs = snapshot.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const chunk = docs.slice(i, i + 400);
      try {
        const batch = writeBatch(db);
        chunk.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deleted += chunk.length;
      } catch {
        // Fallback individual delete if batch fails
        await Promise.all(
          chunk.map(async (d) => {
            try {
              await deleteDoc(d.ref);
              deleted++;
            } catch {}
          })
        );
      }
    }
  } catch (err) {
    console.warn(`[SafeReset] Warning wiping ${colPathSegments.join('/')}:`, err);
  }
  return deleted;
}

/**
 * Wipes Categories and Brands collections (ONLY used when mode === 'full_with_reseed' before re-seeding).
 */
export async function wipeAllCategoriesAndBrandsFromFirestore(): Promise<number> {
  let deleted = 0;
  const categoryCollections = [
    'categories',
    'product_categories',
    'master_categories',
    'brands',
    'product_brands',
    'master_brands',
  ];

  await Promise.all([
    ...categoryCollections.map(async (colName) => {
      const c = await deleteAllDocsInCollectionPath([colName]);
      deleted += c;
    }),
    deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'categories']).then((c) => {
      deleted += c;
    }),
    deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'brands']).then((c) => {
      deleted += c;
    }),
  ]);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem('riskcart_categories');
      window.localStorage.removeItem('riskcart_brands');
      window.localStorage.removeItem('pos_categories');
      window.localStorage.removeItem('pos_brands');
      window.localStorage.removeItem('riskcart_cache_categories');
      window.localStorage.removeItem('riskcart_cache_brands');
      window.localStorage.removeItem('riskcart_deleted_categories');
    } catch {}
  }

  return deleted;
}

/**
 * Seeds default Master Data (Categories, Brands, Products, Customer Types, Outlets, Sidebar Menus, Default Owner/Demo Staff)
 * WITHOUT deleting any existing documents.
 */
export async function seedInitialData(): Promise<{ restored: string[] }> {
  const restored: string[] = [];
  const nowIso = new Date().toISOString();

  // Clear legacy block flags that prevented categories/brands from loading
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(CLEAN_CATEGORIES_BRANDS_KEY);
      window.localStorage.removeItem(CLEAN_SLATE_STORAGE_KEY);
    } catch {}
  }

  // CATATAN: Suntikan otomatis Kategori, Brand, dan Produk contoh DIMATIKAN PERMANEN
  // agar database 100% murni hanya berisi data asli yang diinput pengguna.
  try {
    await ensureSidebarMenuSeeded();
  } catch (err) {
    console.warn('[seedInitialData] Sidebar menu check error:', err);
  }

  // 4. Customer Types
  try {
    const ctSnap = await getDocs(collection(db, 'customer_types'));
    if (ctSnap.empty) {
      const defaultCustomerTypes = [
        {
          id: 'ct_reguler',
          name: 'Pelanggan Reguler',
          code: 'REGULER',
          discountPercent: 0,
          minOrderCartons: 1,
          pointMultiplier: 1,
          description: 'Pelanggan ritel & walk-in standar',
          updatedAt: nowIso,
        },
        {
          id: 'ct_grosir',
          name: 'Agen / Grosir',
          code: 'GROSIR',
          discountPercent: 3,
          minOrderCartons: 10,
          pointMultiplier: 1.5,
          description: 'Pelanggan grosir & warung langganan',
          updatedAt: nowIso,
        },
        {
          id: 'ct_vip',
          name: 'Mitra VIP Prioritas',
          code: 'VIP',
          discountPercent: 5,
          minOrderCartons: 25,
          pointMultiplier: 2,
          description: 'Distributor & pelanggan prioritas volume besar',
          updatedAt: nowIso,
        },
      ];
      await Promise.all(
        defaultCustomerTypes.map((ct) =>
          setDoc(doc(db, 'customer_types', ct.id), ct, { merge: true })
        )
      );
      restored.push('Tipe Pelanggan (3)');
    }
  } catch (err) {
    console.warn('[seedInitialData] CustomerTypes check error:', err);
  }

  // 5. Outlets & Store Config
  try {
    const outletsSnap = await getDocs(collection(db, 'outlets'));
    if (outletsSnap.empty) {
      const mainOutlet = {
        id: 'pusat',
        code: 'OUT-PUSAT',
        name: 'Cabang Utama (Pusat)',
        address: 'Jl. Jenderal Sudirman No. 1, Jakarta Pusat',
        phone: '0811-1000-001',
        status: 'active',
        isMain: true,
        updatedAt: nowIso,
      };
      await setDoc(doc(db, 'outlets', 'pusat'), mainOutlet, { merge: true });
      restored.push('Outlet Pusat');
    }
    await setDoc(doc(db, 'stores', ACTIVE_STORE_ID), DEFAULT_STORE_CONFIG, { merge: true }).catch(
      () => {}
    );
  } catch (err) {
    console.warn('[seedInitialData] Outlets check error:', err);
  }

  // 6. Sidebar Menus
  try {
    const menuSeeded = await ensureSidebarMenuSeeded();
    if (menuSeeded) {
      restored.push('Menu Sidebar');
    }
  } catch (err) {
    console.warn('[seedInitialData] Sidebar menu check error:', err);
  }

  // 7. Ensure Default OWNER & DEMO Staff accounts exist without deleting any existing staff
  try {
    const ownerPayload = {
      id: 'staff_001',
      name: 'Owner',
      email: '',
      role: 'Owner',
      outlet: 'Cabang Utama (Pusat)',
      phone: '0811-1000-001',
      shift: 'Full-Time / All Shift',
      kpiScore: 100,
      status: 'active',
      updatedAt: nowIso,
    };
    const demoPayload = {
      id: 'staff_demo',
      name: 'Demo User (Sandbox)',
      email: 'demo@riskcart.ai',
      role: 'DEMO',
      isDemo: true,
      outlet: 'Cabang Utama (Pusat)',
      phone: '-',
      shift: 'Demo Sandbox',
      kpiScore: 100,
      status: 'active',
      updatedAt: nowIso,
    };
    await Promise.all([
      setDoc(doc(db, 'staff', 'staff_001'), ownerPayload, { merge: true }).catch(() => {}),
      setDoc(doc(db, 'staff', 'staff_demo'), demoPayload, { merge: true }).catch(() => {}),
      setDoc(doc(db, 'users', 'staff_001'), ownerPayload, { merge: true }).catch(() => {}),
      setDoc(doc(db, 'users', 'staff_demo'), demoPayload, { merge: true }).catch(() => {}),
    ]);
  } catch {}

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('riskcart_master_data_restored', { detail: { restored } }));
  }

  return { restored };
}

/**
 * Checks if critical Master Databases (Categories, Brands, Products, Sidebar Menus, Customer Types, Outlets)
 * are empty in Firestore (e.g., due to a previous wipe) and restores default data without deleting existing records.
 */
export async function restoreMissingMasterDatabase(): Promise<{ restored: string[] }> {
  return seedInitialData();
}

/**
 * Safe Factory Reset with 3 Protection Layers:
 * 1. Protected System Collections are NEVER deleted (users, staff, roles, hak_akses, settings, pos_settings, pwa_settings, sidebar_menus, payment_settings, ai_instructions, outlets, customer_types).
 * 2. Selective localStorage cleanup (never calls indiscriminate localStorage.clear()).
 * 3. Atomic Re-Seeding when mode === 'full_with_reseed' before returning.
 */
export async function performSafeFactoryReset(
  options: FactoryResetOptions = { mode: 'transactions_only' },
  reseedCallback?: () => Promise<void>
): Promise<{ success: boolean; deletedCount: number; mode: string }> {
  const mode = options?.mode || 'transactions_only';
  isCurrentlyWiping = true;
  let totalDeleted = 0;

  try {
    const targetCollections =
      mode === 'full_with_reseed'
        ? [...TRANSACTIONAL_COLLECTIONS, ...CATALOG_COLLECTIONS]
        : [...TRANSACTIONAL_COLLECTIONS];

    // Filter out any collection that belongs to PROTECTED_SYSTEM_COLLECTIONS
    const safeTargetCollections = targetCollections.filter(
      (col) => !PROTECTED_SYSTEM_COLLECTIONS.includes(col)
    );

    // Also include auxiliary operational logs that are purely transactional
    const operationalAuxiliaryCollections = [
      'sales_transactions',
      'pwa_orders',
      'cash_flows',
      'cashier_shifts',
      'shift_kas_masuk',
      'shift_kas_keluar',
      'cash_in',
      'cash_out',
      'cash_logs',
      'safe_deposits',
      'brangkas_toko_logs',
      'store_vault_mutations',
      'store_vault_entries',
      'stock_movements',
      'stock_mutations',
      'stock_opname',
      'stock_cards',
      'stock_reconciliation_ledger',
      'purchase_requests',
      'shift_history',
      'pos_shifts',
      'journal_entries',
      'incomes',
      'expenses',
      'finances',
      'pos_incomes',
      'pos_expenses',
      'capital_vault_entries',
      'profit_vault_entries',
      'settlement_history',
      'customer_order_history',
      'fraud_logs',
      'scanner_logs',
      'financial_snapshots',
    ].filter((col) => !PROTECTED_SYSTEM_COLLECTIONS.includes(col));

    const allCollectionsToWipe = Array.from(
      new Set([...safeTargetCollections, ...operationalAuxiliaryCollections])
    );

    // 1. Delete root collections
    for (const colName of allCollectionsToWipe) {
      if (PROTECTED_SYSTEM_COLLECTIONS.includes(colName)) continue;
      const count = await deleteAllDocsInCollectionPath([colName], {
        deleteNestedItemsSubcollection:
          colName === 'transactions' ||
          colName === 'pos_transactions' ||
          colName === 'sales_transactions' ||
          colName === 'orders' ||
          colName === 'online_orders',
      });
      totalDeleted += count;
    }

    // 2. Delete store-scoped transactional collections (and catalog subcollections only if full_with_reseed)
    const storeSubCollections =
      mode === 'full_with_reseed'
        ? ['orders', 'transactions', 'store_vault_entries', 'vault_entries', 'products', 'categories', 'brands', 'customers', 'bundles', 'discount_prices']
        : ['orders', 'transactions', 'store_vault_entries', 'vault_entries'];

    for (const subCol of storeSubCollections) {
      if (PROTECTED_SYSTEM_COLLECTIONS.includes(subCol)) continue;
      const count = await deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, subCol], {
        deleteNestedItemsSubcollection: subCol === 'transactions' || subCol === 'orders',
      });
      totalDeleted += count;
    }

    // 3. Reset server-side transactional memory store if available
    if (typeof window !== 'undefined') {
      try {
        const res = await fetch('/api/admin/reset-all-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        }).then((r) => r.json());
        if (res && typeof res.deletedCount === 'number') {
          totalDeleted += res.deletedCount;
        }
      } catch {}
    }

    // 4. Reset demo sandbox overlay according to mode
    resetDemoSandbox(mode);

    // 5. Selective localStorage cleanup (preserving auth, sidebar, settings, and master data in transactions_only mode)
    clearAllBrowserDataCaches(false, mode);

    // 6. Atomic Re-Seeding when full_with_reseed is selected
    if (mode === 'full_with_reseed') {
      if (reseedCallback) {
        await reseedCallback();
      } else {
        await seedInitialData();
      }
    } else {
      // Even in transactions_only mode, ensure sidebar_menus is intact
      await ensureSidebarMenuSeeded();
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('riskcart_clean_slate_wiped', { detail: { mode } }));
    }

    return { success: true, deletedCount: totalDeleted, mode };
  } catch (error) {
    console.error('[performSafeFactoryReset] Error during factory reset:', error);
    throw error;
  } finally {
    isCurrentlyWiping = false;
    wipeInFlightPromise = null;
  }
}

export interface ActiveStateItemsToWipe {
  products?: any[];
  orders?: any[];
  transactions?: any[];
  customers?: any[];
  shifts?: any[];
  cashLogs?: any[];
  fixedAssets?: any[];
  categories?: any[];
  brands?: any[];
}

export async function wipeAllFirestoreData(
  forceRun: boolean = false,
  _activeState?: ActiveStateItemsToWipe,
  mode: 'transactions_only' | 'full_with_reseed' = 'transactions_only'
): Promise<{ success: boolean; deletedCount: number }> {
  if (!forceRun) {
    return { success: true, deletedCount: 0 };
  }
  if (wipeInFlightPromise) {
    return wipeInFlightPromise;
  }
  wipeInFlightPromise = performSafeFactoryReset({ mode });
  return wipeInFlightPromise;
}

export async function forceWipeAllDatabaseExceptOwner(
  forceRun: boolean = false,
  activeState?: ActiveStateItemsToWipe
): Promise<{ success: boolean; deletedCount: number }> {
  return wipeAllFirestoreData(forceRun, activeState, 'transactions_only');
}

export async function purgeLegacyMockOrdersFromFirestore(): Promise<void> {
  return;
}

export async function seedDemoDataIfEmpty(): Promise<boolean> {
  return false;
}

export async function seedReportDemoIfNeeded(): Promise<void> {
  return;
}

export async function resetAllDatabaseData(
  mode: 'transactions_only' | 'full_with_reseed' = 'transactions_only'
): Promise<{ success: boolean; deletedCount: number; mode?: string }> {
  return performSafeFactoryReset({ mode });
}
