import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  Product,
  StoreConfig,
  Transaction,
} from '../types';
import { ACTIVE_STORE_ID } from '../config/store';

export const DEMO_STORE_ID = ACTIVE_STORE_ID;

export const CLEAN_SLATE_STORAGE_KEY = 'CLEAN_DB_V3';
export const CLEAN_CATEGORIES_BRANDS_KEY = 'CLEAN_CATEGORIES_BRANDS_V6';

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

/**
 * Clean state: All dummy/seed arrays are permanently empty [].
 */
export const INITIAL_PRODUCTS: Omit<Product, 'createdAt' | 'updatedAt'>[] = [];
export const INITIAL_TRANSACTIONS: Transaction[] = [];
export const INITIAL_CATEGORIES: string[] = [];
export const DEFAULT_CATEGORIES: string[] = [];
export const FALLBACK_CATEGORIES: string[] = [];
export const INITIAL_BRANDS: string[] = [];
export const DEFAULT_BRANDS: string[] = [];

export const APP_INSTANCE_ID = '7692b7e9-2666-4a30-8855-b9fb3d913550';

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

let wipeInFlightPromise: Promise<{ success: boolean; deletedCount: number }> | null = null;
let isCurrentlyWiping = false;

export function isCleanSlateDone(): boolean {
  return true;
}

export function isDatabaseWipeInProgress(): boolean {
  return isCurrentlyWiping;
}

/**
 * Checks whether a staff/user document is the sole preserved Owner account (`panglimabesarisis@gmail.com`).
 */
export function isOwnerAccountDoc(data: any, docId?: string): boolean {
  if (!data || typeof data !== 'object') return false;
  const email = String(data.email || '').trim().toLowerCase();
  const role = String(data.role || '').trim().toLowerCase();
  if ((email === 'owner@riskcart.ai' || role === 'owner' || role === 'super admin') && docId === 'staff_001') {
    return true;
  }
  return false;
}

/**
 * Clears all localStorage and sessionStorage application data caches while preserving
 * the clean-slate flags (`CLEAN_DB_V3` and `CLEAN_CATEGORIES_BRANDS_V5`).
 */
export function clearAllBrowserDataCaches(preserveCleanSlateFlag: boolean = true): void {
  if (typeof window === 'undefined') return;
  try {
    const cleanDbVal = preserveCleanSlateFlag
      ? window.localStorage.getItem(CLEAN_SLATE_STORAGE_KEY)
      : null;
    const cleanCatVal = preserveCleanSlateFlag
      ? window.localStorage.getItem(CLEAN_CATEGORIES_BRANDS_KEY)
      : null;

    const explicitCategoryBrandKeys = [
      'riskcart_categories',
      'riskcart_brands',
      'pos_categories',
      'pos_brands',
      'riskcart_cache_categories',
      'riskcart_cache_brands',
      'riskcart_cache_products',
      'riskcart_cache_transactions',
      'riskcart_cache_orders',
      'riskcart_cache_customers',
    ];
    explicitCategoryBrandKeys.forEach((k) => {
      try {
        window.localStorage.removeItem(k);
      } catch {}
    });

    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (
        preserveCleanSlateFlag &&
        (k === CLEAN_SLATE_STORAGE_KEY || k === CLEAN_CATEGORIES_BRANDS_KEY)
      ) {
        continue;
      }
      keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => {
      try {
        window.localStorage.removeItem(k);
      } catch {}
    });

    if (preserveCleanSlateFlag && cleanDbVal === 'TRUE') {
      window.localStorage.setItem(CLEAN_SLATE_STORAGE_KEY, 'TRUE');
    }
    if (preserveCleanSlateFlag && cleanCatVal === 'TRUE') {
      window.localStorage.setItem(CLEAN_CATEGORIES_BRANDS_KEY, 'TRUE');
    }
  } catch {}

  try {
    window.sessionStorage.clear();
  } catch {}

  try {
    if ('caches' in window && window.caches) {
      void window.caches.keys().then((names) => {
        names.forEach((name) => {
          void window.caches.delete(name);
        });
      });
    }
  } catch {}
}

/**
 * Deletes every document in a collection one by one using `deleteDoc(doc(db, ...))`
 * so a single document error never aborts the rest of the collection wipe.
 */
async function deleteAllDocsInCollectionPath(
  colPathSegments: [string, ...string[]],
  options?: {
    preserveSingleOwner?: boolean;
    deleteNestedItemsSubcollection?: boolean;
  }
): Promise<number> {
  let deleted = 0;
  try {
    const colRef = collection(db, ...colPathSegments);
    const snapshot = await getDocs(colRef);
    if (snapshot.empty) return 0;

    let ownerKept = false;

    await Promise.all(
      snapshot.docs.map(async (docSnap) => {
        const data = docSnap.data();
        if (options?.preserveSingleOwner) {
          if (!ownerKept && isOwnerAccountDoc(data, docSnap.id)) {
            ownerKept = true;
            return;
          }
        }

        if (options?.deleteNestedItemsSubcollection) {
          try {
            const itemsRef = collection(db, ...colPathSegments, docSnap.id, 'items');
            const itemsSnap = await getDocs(itemsRef);
            await Promise.all(
              itemsSnap.docs.map(async (itemDoc) => {
                try {
                  await deleteDoc(doc(db, ...colPathSegments, docSnap.id, 'items', itemDoc.id));
                  deleted++;
                } catch {}
              })
            );
          } catch {}
        }

        try {
          await deleteDoc(doc(db, ...colPathSegments, docSnap.id));
          deleted++;
        } catch {
          try {
            await deleteDoc(docSnap.ref);
            deleted++;
          } catch {}
        }
      })
    );
  } catch (err) {
    console.warn(`[wipeAllFirestoreData] Warning wiping ${colPathSegments.join('/')}:`, err);
  }
  return deleted;
}

/**
 * Dedicated fast wipe for all Category & Brand collections, documents, and localStorage caches.
 */
export async function wipeAllCategoriesAndBrandsFromFirestore(): Promise<number> {
  let deleted = 0;

  // 1. Delete known legacy default category & brand document IDs directly
  const knownCategoryDocIds = [
    'MINERAL',
    'FLAVORED',
    'COLA',
    'GAS',
    'COFFEE',
    'SNACK',
    'DAIRY',
    'INSTANT_FOOD',
    'OTHER',
    'MINERAL_WATER___GALON',
    'MINUMAN_BERPERISA___TEH',
    'MINUMAN_SODA___KOLA',
    'LPG_3KG___GAS_MELON',
    'KOPI_SIAP_MINUM___BUBUK',
    'SNACKS___BISKUIT',
    'DAIRY___MILK_SUSU',
    'MIE_INSTAN___CEPAT_SAJI',
    'KATEGORI_LAINNYA',
  ];

  const categoryCollections = [
    'categories',
    'product_categories',
    'master_categories',
    'brands',
    'product_brands',
    'master_brands',
  ];

  await Promise.all([
    ...knownCategoryDocIds.flatMap((docId) => [
      deleteDoc(doc(db, 'categories', docId)).catch(() => {}),
      deleteDoc(doc(db, 'product_categories', docId)).catch(() => {}),
      deleteDoc(doc(db, 'master_categories', docId)).catch(() => {}),
      deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'categories', docId)).catch(() => {}),
    ]),
    deleteDoc(doc(db, 'settings', 'categories')).catch(() => {}),
    deleteDoc(doc(db, 'settings', 'brands')).catch(() => {}),
    deleteDoc(doc(db, 'master_data', 'categories')).catch(() => {}),
    deleteDoc(doc(db, 'master_data', 'brands')).catch(() => {}),
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
    } catch {}
  }

  return deleted;
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

/**
 * FUNGSI PENGHAPUS NYATA (`wipeAllFirestoreData`):
 * 1. Mengambil semua dokumen (`getDocs`) lalu menghapus satu per satu (`deleteDoc(doc(db, colName, d.id))`)
 *    pada seluruh collection root dan subcollection `stores/{storeId}/...`.
 * 2. Menghapus langsung berdasarkan `item.id` untuk seluruh item yang sedang aktif di state React.
 * 3. Menghapus semua dokumen di `staff` / `users` dan hanya menyisakan 1 akun Owner (`panglimabesarisis@gmail.com`).
 * 4. Mengosongkan `localStorage` dan `sessionStorage`.
 */
export async function wipeAllFirestoreData(
  forceRun: boolean = false,
  activeState?: ActiveStateItemsToWipe
): Promise<{ success: boolean; deletedCount: number }> {
  if (!forceRun) {
    return { success: true, deletedCount: 0 };
  }

  if (wipeInFlightPromise && !activeState) {
    return wipeInFlightPromise;
  }

  const runWipe = async (): Promise<{ success: boolean; deletedCount: number }> => {
    isCurrentlyWiping = true;
    let totalDeleted = 0;

    // 1. Immediately clear browser storage and notify all components to empty React state
    clearAllBrowserDataCaches(false);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('riskcart_clean_slate_wiped'));
    }

    try {
      // 2. Immediately wipe all Category & Brand collections + single docs first
      totalDeleted += await wipeAllCategoriesAndBrandsFromFirestore();

      // 3. Delete by active React state item IDs if provided (instant targeted deletion)
      if (activeState) {
        const directDeletePromises: Promise<any>[] = [];
        const addDelete = (colPath: [string, ...string[]], id?: string) => {
          const cleanId = String(id || '').trim();
          if (!cleanId) return;
          directDeletePromises.push(
            deleteDoc(doc(db, ...colPath, cleanId))
              .then(() => {
                totalDeleted++;
              })
              .catch(() => {})
          );
        };

        (activeState.products || []).forEach((p: any) => {
          const ids = [p?.id, p?.docId, p?.sku].filter(Boolean);
          ids.forEach((id) => {
            addDelete(['products'], id);
            addDelete(['stores', ACTIVE_STORE_ID, 'products'], id);
            addDelete(['product_cartons'], id);
          });
          if (Array.isArray(p?.docIds)) {
            p.docIds.forEach((id: string) => {
              addDelete(['products'], id);
              addDelete(['stores', ACTIVE_STORE_ID, 'products'], id);
            });
          }
          if (Array.isArray(p?.variants)) {
            p.variants.forEach((v: any) => {
              addDelete(['products'], v?.id || v?.docId);
              addDelete(['stores', ACTIVE_STORE_ID, 'products'], v?.id || v?.docId);
            });
          }
        });

        (activeState.orders || []).forEach((o: any) => {
          const ids = [o?.id, o?.orderId, o?.transactionId, o?.orderNumber].filter(Boolean);
          ids.forEach((id) => {
            addDelete(['orders'], id);
            addDelete(['stores', ACTIVE_STORE_ID, 'orders'], id);
            addDelete(['online_orders'], id);
            addDelete(['pwa_orders'], id);
            addDelete(['transactions'], id);
            addDelete(['stores', ACTIVE_STORE_ID, 'transactions'], id);
            addDelete(['pos_transactions'], id);
            addDelete(['sales_transactions'], id);
          });
        });

        (activeState.transactions || []).forEach((t: any) => {
          const ids = [t?.id, t?.transactionId, t?.orderId, t?.orderNumber].filter(Boolean);
          ids.forEach((id) => {
            addDelete(['transactions'], id);
            addDelete(['stores', ACTIVE_STORE_ID, 'transactions'], id);
            addDelete(['pos_transactions'], id);
            addDelete(['sales_transactions'], id);
            addDelete(['orders'], id);
            addDelete(['stores', ACTIVE_STORE_ID, 'orders'], id);
          });
        });

        (activeState.customers || []).forEach((c: any) => {
          addDelete(['customers'], c?.id);
          addDelete(['stores', ACTIVE_STORE_ID, 'customers'], c?.id);
        });

        (activeState.shifts || []).forEach((s: any) => {
          addDelete(['shifts'], s?.id);
          addDelete(['cashier_shifts'], s?.id);
          addDelete(['pos_shifts'], s?.id);
        });

        (activeState.cashLogs || []).forEach((cl: any) => {
          addDelete(['cash_logs'], cl?.id);
          addDelete(['cash_in'], cl?.id);
          addDelete(['cash_out'], cl?.id);
          addDelete(['cash_flows'], cl?.id);
        });

        (activeState.fixedAssets || []).forEach((fa: any) => {
          addDelete(['store_fixed_assets'], fa?.id);
        });

        (activeState.categories || []).forEach((cat: any) => {
          const id = typeof cat === 'string' ? cat : cat?.key || cat?.id || cat?.name;
          if (id) {
            addDelete(['categories'], id);
            addDelete(['categories'], String(id).toUpperCase().replace(/[^A-Z0-9]/g, '_'));
            addDelete(['product_categories'], id);
            addDelete(['master_categories'], id);
          }
        });

        (activeState.brands || []).forEach((b: any) => {
          const id = typeof b === 'string' ? b : b?.id || b?.name;
          if (id) {
            addDelete(['brands'], id);
            addDelete(['brands'], String(id).toUpperCase().replace(/[^A-Z0-9]/g, '_'));
            addDelete(['product_brands'], id);
            addDelete(['master_brands'], id);
          }
        });

        if (directDeletePromises.length > 0) {
          await Promise.all(directDeletePromises);
        }
      }

      // 4. Priority Tier 1: Immediately wipe the exact collections backing /dashboard/produk, /dashboard/kategori-produk, /dashboard/orders, and /dashboard/myasset
      const PRIORITY_COLLECTIONS = [
        'products',
        'product_bundles',
        'product_cartons',
        'categories',
        'product_categories',
        'master_categories',
        'brands',
        'product_brands',
        'master_brands',
        'discounts',
        'vouchers',
        'orders',
        'online_orders',
        'pwa_orders',
        'transactions',
        'pos_transactions',
        'sales_transactions',
        'store_fixed_assets',
        'safe_deposits',
        'cash_flows',
        'shift_kas_masuk',
        'shift_kas_keluar',
        'cash_in',
        'cash_out',
        'cash_logs',
        'brangkas_toko_logs',
        'store_vault_mutations',
        'store_vault_entries',
        'customers',
        'customer_types',
        'purchase_orders',
        'procurements',
        'suppliers',
        'shifts',
        'cashier_shifts',
        'product_logs',
        'stock_movements',
        'reward_claims',
        'point_logs',
        'ai_token_logs',
        'ai_logs',
        'audit_logs',
      ];

      const priorityCounts = await Promise.all([
        ...PRIORITY_COLLECTIONS.map((colName) =>
          deleteAllDocsInCollectionPath([colName], {
            deleteNestedItemsSubcollection:
              colName === 'transactions' ||
              colName === 'pos_transactions' ||
              colName === 'sales_transactions' ||
              colName === 'orders',
          })
        ),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'products']),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'categories']),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'brands']),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'orders']),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'transactions'], {
          deleteNestedItemsSubcollection: true,
        }),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'customers']),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'bundles']),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'discount_prices']),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'customer_types']),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'store_vault_entries']),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'vault_entries']),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'pwa_page_configs']),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'reward_claims']),
      ]);
      totalDeleted += priorityCounts.reduce((a, b) => a + b, 0);

      // 5. Also inspect all documents in `stores` collection and wipe any subcollections + the store docs themselves
      // so `openingCash` / `openingFloat` in MyAssetModule is 0.
      try {
        const storesSnap = await getDocs(collection(db, 'stores'));
        for (const storeDoc of storesSnap.docs) {
          const sid = storeDoc.id;
          const subCols = [
            'products',
            'categories',
            'brands',
            'orders',
            'transactions',
            'customers',
            'bundles',
            'discount_prices',
            'customer_types',
            'store_vault_entries',
            'vault_entries',
            'pwa_page_configs',
            'reward_claims',
          ];
          const subRes = await Promise.all(
            subCols.map((sc) =>
              deleteAllDocsInCollectionPath(['stores', sid, sc], {
                deleteNestedItemsSubcollection: sc === 'transactions',
              })
            )
          );
          totalDeleted += subRes.reduce((a, b) => a + b, 0);
          try {
            await deleteDoc(doc(db, 'stores', sid));
            totalDeleted++;
          } catch {}
        }
      } catch {}

      // 6. Tier 2: Wipe all remaining auxiliary operational & financial collections
      const SECONDARY_COLLECTIONS = [
        'storage_locations',
        'stock_mutations',
        'stock_opname',
        'stock_reconciliation_ledger',
        'purchase_requests',
        'shift_history',
        'pos_shifts',
        'brangkas_modal',
        'brangkas_untung',
        'journal_entries',
        'incomes',
        'expenses',
        'finances',
        'pos_incomes',
        'pos_expenses',
        'finance_accounts',
        'capital_vault_entries',
        'profit_vault_entries',
        'settlement_history',
        'backup_snapshots',
        'pwa_reward_claims',
        'rewards',
        'point_ledger',
        'point_rules',
        'subscriptions',
        'promo_targets',
        'marketing_targets',
        'marketing_banners',
        'promo_banners',
        'promo_info',
        'pwa_chats',
        'pwa_messages',
        'ai_chat_sessions',
        'fraud_logs',
        'restock_recommendations',
        'ai_strategies',
        'preventive_alerts',
        'ai_knowledge_docs',
        'scanner_logs',
        'financial_snapshots',
        'pwa_page_configs',
        'outlets',
        'warehouses',
        'seed',
        'meta',
      ];

      const secondaryCounts = await Promise.all(
        SECONDARY_COLLECTIONS.map((colName) => deleteAllDocsInCollectionPath([colName]))
      );
      totalDeleted += secondaryCounts.reduce((a, b) => a + b, 0);

      // 7. Staff & Users: Delete all staff (Niman, duplicates, etc.) and keep ONLY 1 Owner account
      const staffCollections = ['staff', 'users', 'employees', 'store_staff'];
      const staffCounts = await Promise.all([
        ...staffCollections.map((colName) =>
          deleteAllDocsInCollectionPath([colName], { preserveSingleOwner: true })
        ),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'staff'], {
          preserveSingleOwner: true,
        }),
      ]);
      totalDeleted += staffCounts.reduce((a, b) => a + b, 0);

      // Ensure the single Owner account document (`staff_001`) is clean with 0 counters
      const ownerPayload = {
        id: 'staff_001',
        name: 'Owner RiskCart',
        email: 'owner@riskcart.ai',
        role: 'Owner',
        outlet: 'Cabang Utama (Pusat)',
        phone: '-',
        shift: 'Full-Time / All Shift',
        kpiScore: 100,
        status: 'active',
        totalDeliveries: 0,
        totalDeliveryCommission: 0,
        updatedAt: new Date().toISOString(),
      };
      await Promise.all([
        setDoc(doc(db, 'staff', 'staff_001'), ownerPayload, { merge: true }).catch(() => {}),
        setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'staff', 'staff_001'), ownerPayload, {
          merge: true,
        }).catch(() => {}),
      ]);

      // 8. Second-pass verification on `products`, `categories`, `brands`, `orders`, `transactions`, `store_fixed_assets`
      await Promise.all([
        wipeAllCategoriesAndBrandsFromFirestore(),
        deleteAllDocsInCollectionPath(['products']),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'products']),
        deleteAllDocsInCollectionPath(['orders']),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'orders']),
        deleteAllDocsInCollectionPath(['transactions'], { deleteNestedItemsSubcollection: true }),
        deleteAllDocsInCollectionPath(['stores', ACTIVE_STORE_ID, 'transactions'], {
          deleteNestedItemsSubcollection: true,
        }),
        deleteAllDocsInCollectionPath(['store_fixed_assets']),
      ]);

      // 9. Clear browser caches again after all Firestore deletes complete and mark CLEAN_DB_V3 & CLEAN_CATEGORIES_BRANDS_V5 as TRUE
      clearAllBrowserDataCaches(false);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(CLEAN_SLATE_STORAGE_KEY, 'TRUE');
          window.localStorage.setItem(CLEAN_CATEGORIES_BRANDS_KEY, 'TRUE');
        } catch {}
        window.dispatchEvent(new CustomEvent('riskcart_clean_slate_wiped'));
      }

      return { success: true, deletedCount: totalDeleted };
    } catch (error) {
      console.warn('Notice during wipeAllFirestoreData:', error);
      return { success: false, deletedCount: totalDeleted };
    } finally {
      isCurrentlyWiping = false;
      wipeInFlightPromise = null;
    }
  };

  wipeInFlightPromise = runWipe();
  return wipeInFlightPromise;
}

export async function forceWipeAllDatabaseExceptOwner(
  forceRun: boolean = false,
  activeState?: ActiveStateItemsToWipe
): Promise<{ success: boolean; deletedCount: number }> {
  return wipeAllFirestoreData(forceRun, activeState);
}

/**
 * Disabled seeders — all return immediately without seeding any dummy data.
 */
export async function purgeLegacyMockOrdersFromFirestore(): Promise<void> {
  return;
}

export async function seedDemoDataIfEmpty(): Promise<boolean> {
  return false;
}

export async function seedReportDemoIfNeeded(): Promise<void> {
  return;
}

export async function resetAllDatabaseData(): Promise<{ success: boolean; deletedCount: number }> {
  return wipeAllFirestoreData(true);
}
