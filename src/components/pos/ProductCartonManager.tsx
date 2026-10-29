import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Plus,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Package,
  Layers,
  ArrowUpRight,
  ArrowDownLeft,
  ClipboardList,
  Eye,
  Edit,
  Trash2,
  X,
  Check,
  Sparkles,
  Sun,
  Moon,
  Activity,
  ArrowUpDown,
  Filter,
  Boxes,
  Tag,
  Percent,
  DollarSign,
  TrendingUp,
  Grid,
  Store,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { ACTIVE_STORE_ID } from '../../config/store';
import {
  productsToGroups,
  variantToProduct,
  extractVariantsFromGroups,
  ProductGroupItem,
  ProductVariantItem,
} from '../../services/productMapper';
import {
  createProductGroupInDb,
  updateProductGroupInDb,
  updateVariantInDb,
  adjustProductStockInDb,
  deleteProductFromDb,
  deleteVariantFromDb,
} from '../../services/productService';
import { Product, CustomerType } from '../../types';
import {
  CLEAN_CATEGORIES_BRANDS_KEY,
  isCleanSlateDone,
  isDatabaseWipeInProgress,
  isFictitiousDoc,
  purgeFictitiousDatabaseEntries,
} from '../../services/dataSeeder';
import {
  useBrands,
  addBrand,
  deleteBrand,
  addCategory,
  deleteCategory,
  deleteMasterCategory,
  updateMasterCategory,
  deduplicateCategories,
  normalizeCategoryKey,
  toCategorySlug,
  getDeletedCategorySlugs,
  renameBrand,
  syncBrandsFromProducts,
} from '../../services/masterDataService';
import { AddProductForm } from './AddProductForm';
import { isPwaPriceLinked } from './ProductFormFields';
import { ProductBundlesModule } from './ProductBundlesModule';
import { DiscountPricingModule } from '../modules/DiscountPricingModule';
import { useLanguage } from '../../context/LanguageContext';
import { useAccessControl } from '../../context/AccessControlContext';
import { useAppNavigation, AppLink, getPathForProductSubTab } from '../../router';

export type ProductCartonTabType =
  | 'list'
  | 'paket'
  | 'kategori'
  | 'harga_diskon'
  | 'masuk'
  | 'keluar'
  | 'opname'
  | 'pergerakan'
  | 'kritis';

export type { ProductVariantItem, ProductGroupItem };

import {
  ARABIAN_FOOD_CATEGORIES,
  ARABIAN_FOOD_PRODUCTS,
  ensureArabianFoodMasterSynced,
} from '../../services/rawMaterialService';

export const INITIAL_MASTER_PRODUCTS: ProductGroupItem[] = productsToGroups(
  ARABIAN_FOOD_PRODUCTS as Product[]
);
export const DEFAULT_CATEGORIES: any[] = [...ARABIAN_FOOD_CATEGORIES];
export const INITIAL_CATEGORIES: any[] = [...ARABIAN_FOOD_CATEGORIES];
export const FALLBACK_CATEGORIES: any[] = [...ARABIAN_FOOD_CATEGORIES];
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


export interface ProductCartonManagerProps {
  initialSubTab?: ProductCartonTabType;
  initialViewMode?: 'table' | 'add_product';
}

export const ProductCartonManager: React.FC<ProductCartonManagerProps> = ({
  initialSubTab,
  initialViewMode,
}) => {
  const { language, t, tr, currencyMode, formatCurrency, translateCategory } = useLanguage();
  const { shouldHideHppAndMargin, canPerformModuleAction, requestSupervisorPin } = useAccessControl();
  const hideHpp = shouldHideHppAndMargin();
  const { route, navigateProductSubTab, navigateToPath } = useAppNavigation();
  const activeTab: ProductCartonTabType = route.productSubTab || initialSubTab || 'list';
  const setActiveTab = (nextTab: ProductCartonTabType) => {
    navigateProductSubTab(nextTab, 'table');
  };
  const [products, setProducts] = useState<ProductGroupItem[]>(() =>
    productsToGroups(ARABIAN_FOOD_PRODUCTS as Product[])
  );
  const [isLoadingProducts, setIsLoadingProducts] = useState<boolean>(true);
  const startDateInputRef = useRef<HTMLInputElement>(null);
  const endDateInputRef = useRef<HTMLInputElement>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToastType(type);
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 3500);
  };

  // Single Source of Truth: Listen to live Firestore 'products' collection without any dummy seeding
  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | null = null;

    const handleCleanSlate = () => {
      if (!isMounted) return;
      setProducts([]);
      setStockInRecords([]);
      setStockOutRecords([]);
      setCustomCategories([]);
    };
    window.addEventListener('riskcart_clean_slate_wiped', handleCleanSlate);

    const initLiveCatalog = () => {
      if (!isMounted) return;
      void ensureArabianFoodMasterSynced();

      const getDeletedProdSet = (): Set<string> => {
        try {
          const raw = localStorage.getItem('riskcart_deleted_fs_products_v1');
          return raw ? new Set(JSON.parse(raw).map(String)) : new Set();
        } catch {
          return new Set();
        }
      };

      const colRef = collection(db, 'products');
      unsubscribe = onSnapshot(
        colRef,
        (snapshot) => {
          if (!isMounted) return;
          if (isDatabaseWipeInProgress()) {
            snapshot.docs.forEach((docSnap) => {
              void deleteDoc(docSnap.ref).catch(() => {});
            });
            setProducts([]);
            setIsLoadingProducts(false);
            return;
          }
          const deletedSet = getDeletedProdSet();
          const mergedMap = new Map<string, Product>();

          for (const seedProd of ARABIAN_FOOD_PRODUCTS) {
            if (!deletedSet.has(seedProd.id) && !deletedSet.has(seedProd.sku)) {
              mergedMap.set(seedProd.id, seedProd as Product);
            }
          }

          snapshot.docs
            .filter((docSnap) => {
              const d = docSnap.data();
              if (d.deleted === true || isFictitiousDoc(docSnap.id, d)) {
                void deleteDoc(docSnap.ref).catch(() => {});
                return false;
              }
              return !deletedSet.has(docSnap.id) && !deletedSet.has(String(d.sku || ''));
            })
            .forEach((docSnap) => {
              const d = docSnap.data();
              const existing = mergedMap.get(docSnap.id);
              mergedMap.set(docSnap.id, {
                ...(existing || {}),
                ...d,
                id: docSnap.id,
              } as Product);
            });

          const firestoreProducts = Array.from(mergedMap.values());
          setProducts(productsToGroups(firestoreProducts));
          try {
            if (firestoreProducts.length > 0) {
              localStorage.setItem('riskcart_cache_products', JSON.stringify(firestoreProducts));
            }
          } catch (e) {}
          setIsLoadingProducts(false);
        },
        (error) => {
          console.warn('[ProductCartonManager] Products snapshot notice:', error);
          if (isMounted) {
            const deletedSet = getDeletedProdSet();
            const fallbackList = ARABIAN_FOOD_PRODUCTS.filter(
              (p) => !deletedSet.has(p.id) && !deletedSet.has(p.sku)
            ) as Product[];
            setProducts(productsToGroups(fallbackList));
            setIsLoadingProducts(false);
          }
        }
      );
    };

    initLiveCatalog();

    return () => {
      isMounted = false;
      window.removeEventListener('riskcart_clean_slate_wiped', handleCleanSlate);
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Theme State: 'dark' or 'light'
  const [tableTheme, setTableTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('riskcart_product_table_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    }
    return 'dark'; // Harmonizes with RiskCart POS dark styling
  });

  const handleSetTheme = (theme: 'dark' | 'light') => {
    setTableTheme(theme);
    if (typeof window !== 'undefined') {
      localStorage.setItem('riskcart_product_table_theme', theme);
    }
    showToast(`Switched to ${theme === 'dark' ? 'Dark' : 'Light'} theme`);
  };

  // View Mode: 'table' or 'add_product' derived directly from URL
  const viewMode: 'table' | 'add_product' = route.productViewMode || initialViewMode || 'table';
  const setViewMode = (nextMode: 'table' | 'add_product') => {
    navigateProductSubTab(activeTab, nextMode);
  };

  // Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);

  // Dynamic Inbound and Outbound Records (live, no dummy data)
  const [stockInRecords, setStockInRecords] = useState<
    Array<{ id: string; date: string; product: string; qty: number; supplier: string; status: string }>
  >([]);

  const [stockOutRecords, setStockOutRecords] = useState<
    Array<{ id: string; date: string; product: string; qty: number; dest: string; status: string }>
  >([]);

  // Interactive Modals State
  const [isStockInModalOpen, setIsStockInModalOpen] = useState(false);
  const [isStockOutModalOpen, setIsStockOutModalOpen] = useState(false);
  const [detailGroup, setDetailGroup] = useState<ProductGroupItem | null>(null);
  const [editingGroup, setEditingGroup] = useState<(ProductGroupItem & { editingVariantId?: string }) | null>(null);
  const [adjustingStockGroup, setAdjustingStockGroup] = useState<ProductGroupItem | null>(null);
  const [stockAdjustQty, setStockAdjustQty] = useState<number>(10);
  const [stockAdjustReason, setStockAdjustReason] = useState<string>('Penyesuaian Fisik Toko');
  const [detailMovement, setDetailMovement] = useState<any | null>(null);
  const [editingMovement, setEditingMovement] = useState<any | null>(null);

  // Package Modal State (Buat Paket Dus Baru)
  const [isPackageModalOpen, setIsPackageModalOpen] = useState(false);
  const [selectedPackageSku, setSelectedPackageSku] = useState<string>('');
  const [packagePiecesPerCarton, setPackagePiecesPerCarton] = useState<number>(24);
  const [packagePricePerCarton, setPackagePricePerCarton] = useState<number>(0);

  // Category Modal State (+ Tambah / Edit Kategori)
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
  const [editingCategoryKey, setEditingCategoryKey] = useState<string | null>(null);
  const [editingCategoryOldName, setEditingCategoryOldName] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState<string>('');
  const [newCategoryIcon, setNewCategoryIcon] = useState<string>('📦');
  const [isSavingCategory, setIsSavingCategory] = useState<boolean>(false);
  const [isCleaningCategories, setIsCleaningCategories] = useState<boolean>(false);
  const [customCategories, setCustomCategories] = useState<
    Array<{ key: string; slug?: string; name: string; icon: string; color: string; border: string }>
  >([]);

  // Brand Management State (Purely from Firestore `brands`)
  const brands = useBrands();
  const [isAddBrandModalOpen, setIsAddBrandModalOpen] = useState(false);
  const [editingBrandOldName, setEditingBrandOldName] = useState<string | null>(null);
  const [newBrandName, setNewBrandName] = useState<string>('');
  const [isSavingBrand, setIsSavingBrand] = useState(false);
  const [isSyncingBrands, setIsSyncingBrands] = useState(false);

  // Sync URL entity actions (/produk/:id/edit, /produk/:id/stok, /kategori-produk/tambah, etc.)
  useEffect(() => {
    if (route.productSubTab === 'kategori' && route.actionMode === 'tambah') {
      setIsAddCategoryModalOpen(true);
    }
    if (route.productSubTab === 'masuk' && route.actionMode === 'tambah') {
      setIsStockInModalOpen(true);
    }
    if (route.productSubTab === 'keluar' && route.actionMode === 'tambah') {
      setIsStockOutModalOpen(true);
    }
  }, [route.productSubTab, route.actionMode]);

  const openedEntityKeyRef = useRef<string | null>(null);

  const openEditModalForGroup = (group: ProductGroupItem, variant?: ProductVariantItem) => {
    setAdjustingStockGroup(null);
    setDetailGroup(null);
    const v = variant || group.variants?.[0];
    const resolvedIsi =
      group.itemsPerCarton ??
      group.piecesPerCarton ??
      v?.itemsPerCarton ??
      v?.piecesPerCarton ??
      1;

    if (group.hasVariants && (group.variants?.length ?? 0) > 0) {
      setEditingGroup({
        ...group,
        editingVariantId: variant ? variant.docId || variant.id || variant.sku : undefined,
        imageUrl: group.imageUrl || v?.imageUrl || '',
        galleryUrls: group.galleryUrls?.length ? group.galleryUrls : v?.galleryUrls || [],
        description: group.description || v?.description || '',
        batchCode: group.batchCode || v?.batchCode || '',
        productionDate: group.productionDate || v?.productionDate || '',
        expiryDate: group.expiryDate || v?.expiryDate || '',
      });
      return;
    }

    setEditingGroup({
      ...group,
      editingVariantId: variant ? variant.docId || variant.id || variant.sku : undefined,
      docId: variant?.docId || group.docId || group.id,
      name: variant ? variant.name : group.name,
      sku: (variant ? variant.sku || variant.id : group.sku || v?.sku || group.id) || '',
      category: (variant ? variant.category : group.category) || group.category,
      brand: (variant ? variant.brand : group.brand) || group.brand,
      costPrice: variant ? (variant.costPrice ?? 0) : (group.costPrice ?? v?.costPrice ?? 0),
      sellPrice: variant ? (variant.sellPrice ?? 0) : (group.sellPrice ?? v?.sellPrice ?? 0),
      posPrice: variant
        ? (variant.posPrice ?? variant.sellPrice ?? 0)
        : (group.posPrice ?? v?.posPrice ?? group.sellPrice ?? 0),
      pwaPrice: variant
        ? (variant.pwaPrice ?? variant.sellPrice ?? 0)
        : (group.pwaPrice ?? v?.pwaPrice ?? group.sellPrice ?? 0),
      totalStock: variant ? (variant.stock ?? 0) : (group.totalStock ?? v?.stock ?? 0),
      itemsPerCarton: variant
        ? (variant.itemsPerCarton ?? variant.piecesPerCarton ?? 1)
        : resolvedIsi,
      piecesPerCarton: variant
        ? (variant.piecesPerCarton ?? variant.itemsPerCarton ?? 1)
        : resolvedIsi,
      sellByUnit: variant
        ? variant.sellByUnit !== false
        : (group.sellByUnit ?? v?.sellByUnit) !== false,
      hasRawMaterials: Boolean(
        variant
          ? variant.hasRawMaterials || (variant.rawMaterialRecipe && variant.rawMaterialRecipe.length > 0)
          : group.hasRawMaterials ||
              v?.hasRawMaterials ||
              (group.rawMaterialRecipe && group.rawMaterialRecipe.length > 0) ||
              (v?.rawMaterialRecipe && v.rawMaterialRecipe.length > 0)
      ),
      autoDeductRawMaterial: variant
        ? variant.autoDeductRawMaterial !== false
        : (group.autoDeductRawMaterial ?? v?.autoDeductRawMaterial) !== false,
      rawMaterialRecipe:
        (variant?.rawMaterialRecipe?.length ? variant.rawMaterialRecipe : undefined) ||
        (group.rawMaterialRecipe?.length ? group.rawMaterialRecipe : undefined) ||
        v?.rawMaterialRecipe ||
        [],
      mainUnit: (variant ? variant.mainUnit : group.mainUnit) || v?.mainUnit || 'Porsi',
      subUnit: (variant ? variant.subUnit : group.subUnit) || v?.subUnit || 'Porsi',
      weightMl: variant ? (variant.weightMl ?? 600) : (group.weightMl ?? v?.weightMl ?? 600),
      totalBeratKg: variant
        ? (variant.totalBeratKg ?? Number(((variant.weightMl ?? 600) / 1000).toFixed(3)))
        : (group.totalBeratKg ?? v?.totalBeratKg ?? Number(((group.weightMl ?? 600) / 1000).toFixed(3))),
      isActive: variant ? variant.isActive !== false : group.isActive !== false,
      isPosVisible: variant ? variant.isPosVisible !== false : group.isPosVisible !== false,
      isPwaVisible: variant ? variant.isPwaVisible !== false : group.isPwaVisible !== false,
      imageUrl: (variant ? variant.imageUrl : group.imageUrl) || group.imageUrl || v?.imageUrl || '',
      galleryUrls:
        (variant?.galleryUrls?.length ? variant.galleryUrls : undefined) ||
        (group.galleryUrls?.length ? group.galleryUrls : undefined) ||
        v?.galleryUrls ||
        [],
      description: (variant ? variant.description : group.description) || v?.description || '',
      batchCode: (variant ? variant.batchCode : group.batchCode) || v?.batchCode || '',
      productionDate:
        (variant ? variant.productionDate : group.productionDate) || v?.productionDate || '',
      expiryDate: (variant ? variant.expiryDate : group.expiryDate) || v?.expiryDate || '',
    });
  };

  useEffect(() => {
    if (!route.productEntityId || products.length === 0) {
      if (!route.productEntityId) {
        openedEntityKeyRef.current = null;
        setEditingGroup(null);
        setAdjustingStockGroup(null);
      }
      return;
    }
    const entityKey = `${route.productEntityId.toLowerCase()}::${route.productAction || 'edit'}`;
    if (openedEntityKeyRef.current === entityKey) {
      return;
    }

    const targetId = route.productEntityId.toLowerCase();
    let matchedVariant: ProductVariantItem | undefined;
    const matchedGroup = products.find((g) => {
      if (g.variants) {
        const foundVar = g.variants.find(
          (v) =>
            v.id.toLowerCase() === targetId ||
            (v.docId && v.docId.toLowerCase() === targetId) ||
            v.sku.toLowerCase() === targetId
        );
        if (foundVar) {
          matchedVariant = foundVar;
          return true;
        }
      }
      if (
        g.id.toLowerCase() === targetId ||
        (g.docId && g.docId.toLowerCase() === targetId) ||
        (g.sku && g.sku.toLowerCase() === targetId)
      ) {
        return true;
      }
      return false;
    });
    if (!matchedGroup) return;

    openedEntityKeyRef.current = entityKey;
    if (route.productAction === 'stok') {
      setEditingGroup(null);
      setAdjustingStockGroup(matchedGroup);
    } else {
      openEditModalForGroup(matchedGroup, matchedVariant);
    }
  }, [route.productEntityId, route.productAction, products]);

  // Listen to Firestore 'categories' and 'stock_movements' collections
  useEffect(() => {
    // CATATAN: auto-wipe kategori & brand (flag localStorage 'riskcart_clean_categories_brands_v10')
    // DIHAPUS. Flag itu hilang setiap logout (localStorage.clear()), sehingga setiap login ulang
    // seluruh koleksi `brands` & `categories` di Firestore ikut terhapus.
    // Penghapusan master data kini HANYA lewat Factory Reset (executeFactoryDataReset).

    const handleCleanSlate = () => {
      setCustomCategories([]);
      setStockInRecords([]);
      setStockOutRecords([]);
    };
    window.addEventListener('riskcart_clean_slate_wiped', handleCleanSlate);

    const unsub = onSnapshot(
      collection(db, 'categories'),
      (snapshot) => {
        const deletedSlugs = getDeletedCategorySlugs();
        const uniqueMap = new Map<
          string,
          { key: string; slug: string; name: string; icon: string; color: string; border: string; ref?: any }
        >();
        const duplicateRefs: any[] = [];
        snapshot.docs.forEach((d) => {
          const data = d.data();
          if (data.deleted === true || isFictitiousDoc(d.id, data)) {
            duplicateRefs.push(d.ref);
            return;
          }
          const cleanName = String(data.name || '').trim();
          if (!cleanName || /^cat_default_\d+$/i.test(cleanName) || cleanName.toLowerCase() === 'other') return;
          const normKey = normalizeCategoryKey(cleanName);
          const slug = toCategorySlug(cleanName);
          if (
            !normKey ||
            !slug ||
            deletedSlugs.has(slug) ||
            deletedSlugs.has(normKey) ||
            deletedSlugs.has(cleanName.toLowerCase())
          ) {
            return;
          }
          const existing = uniqueMap.get(normKey);
          if (!existing) {
            uniqueMap.set(normKey, {
              key: d.id,
              slug,
              name: cleanName,
              icon: data.icon || '📦',
              color: 'from-purple-600/20 to-indigo-600/20',
              border: 'border-purple-500/30',
              ref: d.ref,
            });
          } else {
            // Prefer canonical `cat_${slug}` doc ID and batch-delete the duplicate Firestore doc
            if (d.id === `cat_${slug}` && existing.key !== `cat_${slug}`) {
              if (existing.ref) duplicateRefs.push(existing.ref);
              uniqueMap.set(normKey, {
                key: d.id,
                slug,
                name: cleanName,
                icon: data.icon || existing.icon || '📦',
                color: 'from-purple-600/20 to-indigo-600/20',
                border: 'border-purple-500/30',
                ref: d.ref,
              });
            } else {
              duplicateRefs.push(d.ref);
            }
          }
        });
        if (duplicateRefs.length > 0) {
          const batch = writeBatch(db);
          duplicateRefs.forEach((r) => batch.delete(r));
          void batch.commit().catch(() => {});
        }
        const sortedList = Array.from(uniqueMap.values())
          .map(({ ref: _ref, ...item }) => item)
          .sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
        setCustomCategories(sortedList);
      },
      (err) => {
        console.warn('[ProductCartonManager] categories snapshot error:', err);
      }
    );

    const unsubMov = onSnapshot(
      collection(db, 'stock_movements'),
      (snapshot) => {
        if (isDatabaseWipeInProgress()) {
          snapshot.docs.forEach((d) => void deleteDoc(d.ref).catch(() => {}));
          setStockInRecords([]);
          setStockOutRecords([]);
          return;
        }
        const inList: Array<{ id: string; date: string; product: string; qty: number; supplier: string; status: string }> = [];
        const outList: Array<{ id: string; date: string; product: string; qty: number; dest: string; status: string }> = [];
        snapshot.docs.forEach((d) => {
          const data = d.data();
          const mutType = (data.mutationType || data.type || '').toUpperCase();
          const qtyVal = Math.abs(Number(data.qty ?? data.qtyChange ?? 0));
          if (mutType === 'KELUAR' || mutType === 'OUT' || Number(data.qtyChange) < 0) {
            outList.push({
              id: d.id,
              date: data.date || '-',
              product: data.product || data.productName || '-',
              qty: qtyVal,
              dest: data.dest || data.notes || 'Store POS Sales',
              status: data.status || 'Dispensed',
            });
          } else {
            inList.push({
              id: d.id,
              date: data.date || '-',
              product: data.product || data.productName || '-',
              qty: qtyVal,
              supplier: data.supplier || data.notes || 'Distributor Resmi',
              status: data.status || 'Recorded',
            });
          }
        });
        setStockInRecords(inList);
        setStockOutRecords(outList);
      },
      (err) => {
        console.warn('[ProductCartonManager] stock_movements snapshot error:', err);
      }
    );
    return () => {
      window.removeEventListener('riskcart_clean_slate_wiped', handleCleanSlate);
      unsub();
      unsubMov();
    };
  }, []);

  // Stock In Form
  const [stockInForm, setStockInForm] = useState({
    productName: '',
    qty: 10,
    supplier: '',
  });

  // Stock Out Form
  const [stockOutForm, setStockOutForm] = useState({
    productName: '',
    qty: 5,
    dest: 'Store POS Sales',
  });

  // Simulator & Package Filter State
  const [simProductSku, setSimProductSku] = useState<string>('');
  const [simQty, setSimQty] = useState<number>(2);
  const [simUnitType, setSimUnitType] = useState<'carton' | 'unit'>('carton');
  const [simCustomerType, setSimCustomerType] = useState<string>('CUST-VIP');
  const [availableCustomerTypes, setAvailableCustomerTypes] = useState<CustomerType[]>([]);
  const [packageCategoryFilter, setPackageCategoryFilter] = useState<string>('ALL');

  // Real-time synchronization of customer_types for Harga Diskon simulator
  useEffect(() => {
    try {
      const typesColRef = collection(db, 'stores', ACTIVE_STORE_ID, 'customer_types');
      const unsub = onSnapshot(
        typesColRef,
        (snap) => {
          if (!snap.empty) {
            const typesList: CustomerType[] = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<CustomerType, 'id'>),
            }));
            setAvailableCustomerTypes(typesList);
          } else {
            setAvailableCustomerTypes([]);
          }
        },
        (err) => {
          console.warn('[ProductCartonManager] customer_types snapshot error:', err);
        }
      );
      return () => unsub();
    } catch (e) {
      console.warn('[ProductCartonManager] listener setup error:', e);
    }
  }, []);

  // New Product Form
  const [newProductForm, setNewProductForm] = useState({
    name: '',
    sku: 'P' + Math.floor(100 + Math.random() * 900),
    category: '',
    brand: '',
    costPrice: 0,
    sellPrice: 0,
    posPrice: 0,
    pwaPrice: 0,
    stock: 0,
    itemsPerCarton: 1,
    weightMl: 0,
  });

  // Handle Record Stock In Submit
  const handleRecordStockIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetGroup = products.find((p) => p.name === stockInForm.productName) || products[0];
    if (!targetGroup) {
      showToast('Pilih produk yang valid terlebih dahulu!', 'error');
      return;
    }
    const qtyToAdd = Number(stockInForm.qty) || 0;
    try {
      await adjustProductStockInDb(targetGroup, qtyToAdd);
      const newDo = editingMovement?.id || 'DO-' + Date.now().toString().slice(-6);
      const newRecord = {
        id: newDo,
        date:
          editingMovement?.date ||
          new Date().toLocaleDateString('id-ID') +
            ' ' +
            new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        product: targetGroup.name,
        productName: targetGroup.name,
        qty: qtyToAdd,
        qtyChange: qtyToAdd,
        mutationType: 'MASUK',
        supplier: stockInForm.supplier || 'Distributor Resmi',
        notes: stockInForm.supplier || 'Distributor Resmi',
        status: 'Recorded',
        storeId: ACTIVE_STORE_ID,
        createdAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'stock_movements', newDo), newRecord, { merge: true });
      setEditingMovement(null);
      setIsStockInModalOpen(false);
      showToast(`Inbound stock +${qtyToAdd} untuk "${targetGroup.name}" berhasil disimpan ke database!`);
    } catch (err: any) {
      showToast(`Gagal mencatat barang masuk: ${err.message || err}`, 'error');
    }
  };

  // Handle Record Stock Out Submit
  const handleRecordStockOut = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetGroup = products.find((p) => p.name === stockOutForm.productName) || products[0];
    if (!targetGroup) {
      showToast('Pilih produk yang valid terlebih dahulu!', 'error');
      return;
    }
    const qtyToRemove = Number(stockOutForm.qty) || 0;
    try {
      await adjustProductStockInDb(targetGroup, -qtyToRemove);
      const newSo = editingMovement?.id || 'OUT-' + Date.now().toString().slice(-6);
      const newRecord = {
        id: newSo,
        date:
          editingMovement?.date ||
          new Date().toLocaleDateString('id-ID') +
            ' ' +
            new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        product: targetGroup.name,
        productName: targetGroup.name,
        qty: qtyToRemove,
        qtyChange: -qtyToRemove,
        mutationType: 'KELUAR',
        dest: stockOutForm.dest || 'Toko Retail POS',
        notes: stockOutForm.dest || 'Toko Retail POS',
        status: 'Dispensed',
        storeId: ACTIVE_STORE_ID,
        createdAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'stock_movements', newSo), newRecord, { merge: true });
      setEditingMovement(null);
      setIsStockOutModalOpen(false);
      showToast(`Outbound stock -${qtyToRemove} untuk "${targetGroup.name}" berhasil disimpan ke database!`);
    } catch (err: any) {
      showToast(`Gagal mencatat pengeluaran stok: ${err.message || err}`, 'error');
    }
  };

  const handleDeleteMovement = async (movId: string) => {
    try {
      await deleteDoc(doc(db, 'stock_movements', movId));
      showToast(`Riwayat mutasi stok ${movId} berhasil dihapus dari database!`);
    } catch (err: any) {
      showToast(`Gagal menghapus riwayat mutasi: ${err.message || err}`, 'error');
    }
  };

  // Handle Save Edit Product (Live Firestore Update + Optimistic State Sync)
  const handleSaveEditProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGroup) return;

    if (!editingGroup.name.trim()) {
      showToast('Nama produk wajib diisi!', 'error');
      return;
    }

    const costPrice = Number(editingGroup.costPrice) || 0;
    const posPrice = Number(editingGroup.posPrice ?? editingGroup.sellPrice) || 0;
    const pwaPrice = Number(editingGroup.pwaPrice ?? editingGroup.sellPrice) || 0;
    const sellPrice = posPrice;
    const itemsPerCarton = Math.max(1, Number(editingGroup.itemsPerCarton) || 1);
    const stock = Math.max(0, Number(editingGroup.totalStock) || 0);
    const weightMl = Math.max(0, Number(editingGroup.weightMl) || 0);
    const totalBeratKg = Number(((weightMl * itemsPerCarton) / 1000).toFixed(3));
    const sellByUnit = editingGroup.sellByUnit !== false;
    const pricePerCarton = sellPrice;
    const costPerCarton = costPrice;

    if (costPrice < 0 || posPrice < 0 || pwaPrice < 0 || sellPrice < 0) {
      showToast('Harga dan modal tidak boleh bernilai negatif (≥ 0)!', 'error');
      return;
    }

    try {
      const targetVariantMatch =
        editingGroup.variants?.find(
          (v) =>
            (editingGroup.editingVariantId &&
              (v.id === editingGroup.editingVariantId ||
                v.docId === editingGroup.editingVariantId ||
                v.sku === editingGroup.editingVariantId)) ||
            (editingGroup.sku && v.sku === editingGroup.sku)
        ) || (editingGroup.editingVariantId ? undefined : undefined);

      if ((editingGroup.editingVariantId || targetVariantMatch) && editingGroup.variants) {
        const targetVar = targetVariantMatch;
        const resolvedVarId =
          targetVar?.docId ||
          targetVar?.id ||
          editingGroup.editingVariantId ||
          editingGroup.docId ||
          editingGroup.sku ||
          editingGroup.id;
        const updatedVar: ProductVariantItem = {
          ...(targetVar || {
            id: resolvedVarId,
            docId: resolvedVarId,
            sku: editingGroup.sku || resolvedVarId,
            name: editingGroup.name.trim(),
            category: editingGroup.category,
            brand: editingGroup.brand,
            costPrice,
            sellPrice,
            posPrice,
            pwaPrice,
            stock,
            itemsPerCarton,
            isiPerDus: itemsPerCarton,
            weightMl,
            beratPerItem: weightMl,
            totalBeratKg,
            isActive: editingGroup.isActive !== false,
            isPosVisible: editingGroup.isPosVisible !== false,
            isPwaVisible: editingGroup.isPwaVisible !== false,
          }),
          id: targetVar?.id || resolvedVarId,
          docId: targetVar?.docId || targetVar?.id || resolvedVarId,
          name: editingGroup.name.trim(),
          sku: (editingGroup.sku || targetVar?.sku || resolvedVarId).trim(),
          category: editingGroup.category,
          brand: (editingGroup.brand || targetVar?.brand || '').trim(),
          costPrice,
          costPerUnit: costPrice,
          sellPrice,
          pricePerUnit: sellPrice,
          posPrice,
          pwaPrice,
          pricePerCarton,
          cartonWholesalePrice: pricePerCarton,
          costPerCarton,
          stock,
          stockInUnits: stock,
          itemsPerCarton,
          piecesPerCarton: itemsPerCarton,
          isiPerDus: itemsPerCarton,
          sellByUnit,
          weightMl,
          beratPerItem: weightMl,
          totalBeratKg,
          isActive: editingGroup.isActive !== false,
          isPosVisible: editingGroup.isPosVisible !== false,
          isPwaVisible: editingGroup.isPwaVisible !== false,
        };
        await updateVariantInDb(updatedVar, updatedVar.docId || updatedVar.id);

        // Optimistically update local products state immediately
        setProducts((prev) =>
          prev.map((grp) => {
            if (grp.id !== editingGroup.id && grp.docId !== editingGroup.docId) return grp;
            const nextVariants = (grp.variants || []).map((v) =>
              v.id === updatedVar.id || v.docId === updatedVar.docId || v.sku === updatedVar.sku
                ? updatedVar
                : v
            );
            const nextTotalStock = nextVariants.reduce((sum, v) => sum + (v.stock || 0), 0);
            const sellPrices = nextVariants.map((v) => v.sellPrice ?? 0);
            const minSell = sellPrices.length ? Math.min(...sellPrices) : sellPrice;
            const maxSell = sellPrices.length ? Math.max(...sellPrices) : sellPrice;
            const sellPriceRange =
              minSell === maxSell
                ? `Rp ${minSell.toLocaleString('id-ID')}`
                : `Rp ${minSell.toLocaleString('id-ID')} - Rp ${maxSell.toLocaleString('id-ID')}`;
            return {
              ...grp,
              category: editingGroup.category || grp.category,
              brand: editingGroup.brand || grp.brand,
              totalStock: nextTotalStock,
              stockInUnits: nextTotalStock,
              itemsPerCarton,
              piecesPerCarton: itemsPerCarton,
              isiPerDus: itemsPerCarton,
              weightMl,
              beratPerItem: weightMl,
              totalBeratKg,
              sellPriceRange,
              variants: nextVariants,
            };
          })
        );
      } else {
        const updatedGroupPayload: ProductGroupItem = {
          ...editingGroup,
          name: editingGroup.name.trim(),
          sku: (editingGroup.sku || editingGroup.id).trim(),
          costPrice,
          costPerUnit: costPrice,
          sellPrice,
          pricePerUnit: sellPrice,
          posPrice,
          pwaPrice,
          pricePerCarton,
          cartonWholesalePrice: pricePerCarton,
          costPerCarton,
          totalStock: stock,
          stockInUnits: stock,
          itemsPerCarton,
          piecesPerCarton: itemsPerCarton,
          isiPerDus: itemsPerCarton,
          sellByUnit,
          weightMl,
          beratPerItem: weightMl,
          totalBeratKg,
          isActive: editingGroup.isActive !== false,
          isPosVisible: editingGroup.isPosVisible !== false,
          isPwaVisible: editingGroup.isPwaVisible !== false,
        };
        await updateProductGroupInDb(updatedGroupPayload);

        // Optimistically update local products state immediately
        setProducts((prev) =>
          prev.map((grp) =>
            grp.id === editingGroup.id || grp.docId === editingGroup.docId
              ? {
                  ...grp,
                  ...updatedGroupPayload,
                }
              : grp
          )
        );
      }

      const savedName = editingGroup.name;
      openedEntityKeyRef.current = null;
      setEditingGroup(null);
      if (route.productEntityId) navigateToPath('/produk');
      showToast(`Produk "${savedName}" berhasil diperbarui di database!`);
    } catch (err: any) {
      console.error('Error updating product in Firestore:', err);
      showToast(`Gagal memperbarui produk: ${err.message || err}`, 'error');
    }
  };

  // Handle Save Stock Adjustment (Live Firestore Update)
  const handleSaveStockAdjustment = async (delta: number, reason?: string) => {
    if (!adjustingStockGroup) return;

    const newStock = adjustingStockGroup.totalStock + delta;
    if (newStock < 0) {
      showToast('Stok tidak boleh kurang dari 0!', 'error');
      return;
    }

    const adjustmentReason = reason || stockAdjustReason || 'Penyesuaian Fisik Toko';

    try {
      await adjustProductStockInDb(adjustingStockGroup, delta);

      const targetDocId =
        adjustingStockGroup.docId ||
        adjustingStockGroup.sku ||
        adjustingStockGroup.variants?.[0]?.docId ||
        adjustingStockGroup.variants?.[0]?.id ||
        adjustingStockGroup.id;

      // Record stock movement in Firestore
      const movementRef = doc(collection(db, 'stock_movements'));
      await setDoc(movementRef, {
        id: `MUT-${Date.now().toString().slice(-6)}`,
        date: new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) + ' WIB',
        productName: adjustingStockGroup.name,
        sku: adjustingStockGroup.sku || targetDocId,
        location: 'RiskCart Flagship Store',
        mutationType: delta >= 0 ? 'MASUK' : 'KELUAR',
        refDoc: `ADJ #STK-${Date.now().toString().slice(-4)}`,
        qtyChange: delta,
        runningBalance: newStock,
        actor: 'Admin / Kasir',
        notes: adjustmentReason,
        storeId: ACTIVE_STORE_ID,
        createdAt: new Date().toISOString(),
      });

      showToast(`Stok "${adjustingStockGroup.name}" berhasil disesuaikan (${delta >= 0 ? '+' : ''}${delta} unit) di database!`);
      setAdjustingStockGroup(null);
      if (route.productEntityId) navigateToPath('/produk');
    } catch (err: any) {
      console.error('Error saving stock adjustment:', err);
      showToast(`Gagal menyesuaikan stok: ${err.message || err}`, 'error');
    }
  };

  // Handle Save Package (Buat Paket Dus Baru)
  const handleSavePackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPackageSku) {
      showToast('Pilih produk terlebih dahulu!', 'error');
      return;
    }
    try {
      const sellPerPiece = Number(packagePricePerCarton) || 0;
      const safeIsi = Math.max(1, Number(packagePiecesPerCarton) || 1);
      let matchedGroup: ProductGroupItem | undefined;
      let matchedVariant: ProductVariantItem | undefined;

      for (const grp of products) {
        if (grp.hasVariants && grp.variants) {
          const v = grp.variants.find(
            (item) => item.sku === selectedPackageSku || item.id === selectedPackageSku
          );
          if (v) {
            matchedGroup = grp;
            matchedVariant = v;
            break;
          }
        } else if (grp.sku === selectedPackageSku || grp.id === selectedPackageSku) {
          matchedGroup = grp;
          break;
        }
      }

      if (matchedVariant) {
        // Harga PWA hanya ikut berubah jika sebelumnya masih "ikut" Harga Jual (tidak di-custom)
        const pwaFollows = isPwaPriceLinked(
          matchedVariant.pwaPrice,
          matchedVariant.posPrice ?? matchedVariant.sellPrice
        );
        await updateVariantInDb(
          {
            ...matchedVariant,
            itemsPerCarton: safeIsi,
            isiPerDus: safeIsi,
            sellPrice: sellPerPiece || matchedVariant.sellPrice,
            posPrice: sellPerPiece || matchedVariant.posPrice,
            pwaPrice: sellPerPiece && pwaFollows ? sellPerPiece : matchedVariant.pwaPrice,
          },
          matchedVariant.docId || matchedVariant.id
        );
      } else if (matchedGroup) {
        const pwaFollows = isPwaPriceLinked(
          matchedGroup.pwaPrice,
          matchedGroup.posPrice ?? matchedGroup.sellPrice
        );
        await updateProductGroupInDb({
          ...matchedGroup,
          itemsPerCarton: safeIsi,
          isiPerDus: safeIsi,
          sellPrice: sellPerPiece || matchedGroup.sellPrice,
          posPrice: sellPerPiece || matchedGroup.posPrice,
          pwaPrice: sellPerPiece && pwaFollows ? sellPerPiece : matchedGroup.pwaPrice,
        });
      }

      showToast('Paket dus berhasil diperbarui di database!');
      setIsPackageModalOpen(false);
    } catch (err: any) {
      console.error('Error updating package in Firestore:', err);
      showToast(`Gagal menyimpan paket: ${err.message || err}`, 'error');
    }
  };

  // Handle Save New / Edit Category (+ Tambah / Edit Kategori)
  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingCategory) return;
    const cleanName = newCategoryName.trim();
    if (!cleanName) {
      showToast('Nama kategori wajib diisi!', 'error');
      return;
    }
    const newSlug = toCategorySlug(cleanName);
    if (!newSlug) {
      showToast('Nama kategori tidak valid!', 'error');
      return;
    }

    setIsSavingCategory(true);
    try {
      if (editingCategoryKey || editingCategoryOldName) {
        const targetId = editingCategoryKey || `cat_${toCategorySlug(editingCategoryOldName || cleanName)}`;
        const oldName = editingCategoryOldName || editingCategoryKey || cleanName;
        const oldSlug = toCategorySlug(oldName);

        const res = await updateMasterCategory(
          targetId,
          oldName,
          cleanName,
          newCategoryIcon || '📦'
        );

        // Immediately update local categories & products state so UI reflects rename without reload
        setCustomCategories((prev) => {
          const map = new Map<string, (typeof prev)[number]>();
          prev.forEach((c) => {
            const s = c.slug || toCategorySlug(c.name);
            if (s === oldSlug || c.key === targetId) return;
            map.set(s, c);
          });
          map.set(newSlug, {
            key: res.newId,
            slug: newSlug,
            name: cleanName,
            icon: newCategoryIcon || '📦',
            color: 'from-purple-600/20 to-indigo-600/20',
            border: 'border-purple-500/30',
          });
          return Array.from(map.values()).sort((a, b) =>
            a.name.localeCompare(b.name, 'id', { sensitivity: 'base' })
          );
        });

        setProducts((prev) =>
          prev.map((grp) => {
            const grpMatches = toCategorySlug(grp.category || '') === oldSlug;
            const nextVariants = grp.variants?.map((v) =>
              toCategorySlug(v.category || '') === oldSlug ? { ...v, category: cleanName } : v
            );
            if (!grpMatches && !nextVariants?.some((v, i) => v !== grp.variants?.[i])) {
              return grp;
            }
            return {
              ...grp,
              category: grpMatches ? cleanName : grp.category,
              variants: nextVariants,
            };
          })
        );

        showToast(
          res.updatedProducts > 0
            ? `Kategori "${oldName}" diubah menjadi "${cleanName}" (${res.updatedProducts} produk ikut diperbarui).`
            : `Kategori "${cleanName}" berhasil diperbarui!`
        );
      } else {
        const created = await addCategory(cleanName, newCategoryIcon || '📦');
        setCustomCategories((prev) => {
          const filtered = prev.filter((c) => (c.slug || toCategorySlug(c.name)) !== newSlug);
          return [
            ...filtered,
            {
              key: created.id,
              slug: newSlug,
              name: cleanName,
              icon: newCategoryIcon || '📦',
              color: 'from-purple-600/20 to-indigo-600/20',
              border: 'border-purple-500/30',
            },
          ].sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
        });
        showToast(`Kategori "${cleanName}" berhasil ditambahkan!`);
      }

      setNewCategoryName('');
      setEditingCategoryKey(null);
      setEditingCategoryOldName(null);
      setIsAddCategoryModalOpen(false);
    } catch (err: any) {
      console.error('Error saving category to Firestore:', err);
      showToast(err?.message || `Gagal menyimpan kategori: ${err}`, 'error');
    } finally {
      setIsSavingCategory(false);
    }
  };

  const handleSaveBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingBrand) return;
    const nextName = newBrandName.trim();
    if (!nextName) {
      showToast('Nama brand wajib diisi!', 'error');
      return;
    }
    setIsSavingBrand(true);
    try {
      if (editingBrandOldName) {
        // EDIT: rename di tempat + update semua produk yang memakai brand lama
        const { updatedProducts } = await renameBrand(editingBrandOldName, nextName);
        showToast(
          updatedProducts > 0
            ? `Brand "${editingBrandOldName}" diubah menjadi "${nextName}" (${updatedProducts} produk ikut diperbarui).`
            : `Brand "${nextName}" berhasil disimpan ke database!`
        );
      } else {
        // TAMBAH
        await addBrand(nextName);
        showToast(`Brand "${nextName}" berhasil disimpan ke database!`);
      }
      setNewBrandName('');
      setEditingBrandOldName(null);
      setIsAddBrandModalOpen(false);
    } catch (err: any) {
      showToast(err?.message || 'Gagal menyimpan brand', 'error');
    } finally {
      setIsSavingBrand(false);
    }
  };

  const handleDeleteBrand = async (brandName: string) => {
    try {
      await deleteBrand(brandName);
      const stillUsed = products.filter(
        (p) => (p.brand || '').trim().toLowerCase() === brandName.trim().toLowerCase()
      ).length;
      showToast(
        stillUsed > 0
          ? `Brand "${brandName}" dihapus. ${stillUsed} produk masih memakai nama brand ini.`
          : `Brand "${brandName}" berhasil dihapus.`
      );
    } catch (err: any) {
      showToast(err?.message || 'Gagal menghapus brand', 'error');
    }
  };

  // Pulihkan master Brand dari field `brand` di produk (untuk brand yang terhapus oleh auto-wipe lama)
  const handleSyncBrandsFromProducts = async () => {
    setIsSyncingBrands(true);
    try {
      const { created } = await syncBrandsFromProducts();
      showToast(
        created.length > 0
          ? `${created.length} brand dipulihkan dari data produk: ${created.join(', ')}`
          : 'Semua brand pada produk sudah terdaftar.'
      );
    } catch (err: any) {
      showToast(err?.message || 'Gagal menyinkronkan brand', 'error');
    } finally {
      setIsSyncingBrands(false);
    }
  };

  const handleDeleteCategory = async (catKey: string, catName: string) => {
    const targetSlug = toCategorySlug(catName || catKey);
    const keySlug = toCategorySlug(catKey);
    try {
      // Optimistically remove from UI state & clear on matching local products immediately
      setCustomCategories((prev) =>
        prev.filter((c) => {
          const s = c.slug || toCategorySlug(c.name);
          return s !== targetSlug && s !== keySlug && c.key !== catKey;
        })
      );
      setProducts((prev) =>
        prev.map((grp) => {
          const grpMatch =
            toCategorySlug(grp.category || '') === targetSlug ||
            toCategorySlug(grp.category || '') === keySlug;
          const nextVars = grp.variants?.map((v) =>
            toCategorySlug(v.category || '') === targetSlug ||
            toCategorySlug(v.category || '') === keySlug
              ? { ...v, category: '' }
              : v
          );
          if (!grpMatch && !nextVars?.some((v, i) => v !== grp.variants?.[i])) return grp;
          return {
            ...grp,
            category: grpMatch ? '' : grp.category,
            variants: nextVars,
          };
        })
      );

      await deleteMasterCategory(catKey, catName);
      showToast(`Kategori "${catName}" berhasil dihapus secara permanen.`);
    } catch (err: any) {
      showToast(err?.message || 'Gagal menghapus kategori', 'error');
    }
  };

  const handleDeduplicateCategories = async () => {
    if (isCleaningCategories) return;
    setIsCleaningCategories(true);
    try {
      const purgeRes = await purgeFictitiousDatabaseEntries({ removeUnusedCategoriesAndBrands: true });
      const { removedCount, keptCount } = await deduplicateCategories();
      const totalCleaned = purgeRes.deletedDocs + removedCount;
      showToast(
        totalCleaned > 0
          ? `Berhasil membersihkan ${totalCleaned} data fiktif & kategori duplikat (${keptCount} kategori asli tersimpan).`
          : `Database sudah murni (${keptCount} kategori asli, 0 data fiktif/duplikat).`
      );
    } catch (err: any) {
      showToast(err?.message || 'Gagal membersihkan data fiktif & duplikat', 'error');
    } finally {
      setIsCleaningCategories(false);
    }
  };

  // Dispatch Auto-Restock (Live Firestore Update)
  const handleDispatchRestock = async (productName: string, cartonsQty: number) => {
    const targetGroup = products.find((p) =>
      p.name.toLowerCase().includes(productName.toLowerCase().split(' ')[0])
    );
    if (!targetGroup) return;

    try {
      await adjustProductStockInDb(targetGroup, cartonsQty);
      const newDo = 'PO-' + Date.now().toString().slice(-5);
      setStockInRecords([
        {
          id: newDo,
          date:
            new Date().toLocaleDateString('id-ID') +
            ' ' +
            new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
          product: productName,
          qty: cartonsQty,
          supplier: 'Restock Gudang',
          status: 'Recorded',
        },
        ...stockInRecords,
      ]);
      showToast(`PO ${newDo} diterbitkan: +${cartonsQty} unit "${productName}" berhasil disimpan ke database!`);
    } catch (err: any) {
      showToast(`Gagal memproses restock: ${err.message || err}`, 'error');
    }
  };

  // Toggle variant dropdown accordion
  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  // Update POS price inline (persisted to Firestore)
  const handleUpdatePosPrice = async (groupId: string, variantId: string | null, newPrice: number) => {
    const targetGroup = products.find((g) => g.id === groupId);
    if (!targetGroup) return;

    try {
      let pwaFollowed = false;
      if (variantId && targetGroup.variants) {
        const targetVar = targetGroup.variants.find((v) => v.id === variantId);
        if (targetVar) {
          if (Number(targetVar.posPrice ?? targetVar.sellPrice) === newPrice) return;
          // Harga Jual PWA otomatis ikut jika sebelumnya belum di-custom
          pwaFollowed = isPwaPriceLinked(targetVar.pwaPrice, targetVar.posPrice ?? targetVar.sellPrice);
          await updateVariantInDb(
            {
              ...targetVar,
              posPrice: newPrice,
              sellPrice: newPrice,
              pwaPrice: pwaFollowed ? newPrice : targetVar.pwaPrice,
            },
            targetVar.docId || targetVar.id
          );
        }
      } else {
        if (Number(targetGroup.posPrice ?? targetGroup.sellPrice) === newPrice) return;
        pwaFollowed = isPwaPriceLinked(targetGroup.pwaPrice, targetGroup.posPrice ?? targetGroup.sellPrice);
        await updateProductGroupInDb({
          ...targetGroup,
          posPrice: newPrice,
          sellPrice: newPrice,
          pwaPrice: pwaFollowed ? newPrice : targetGroup.pwaPrice,
        });
      }
      showToast(
        pwaFollowed
          ? 'Harga Jual POS & Harga Jual PWA berhasil disimpan ke database!'
          : 'Harga kasir POS berhasil disimpan ke database!'
      );
    } catch (err: any) {
      showToast(`Gagal menyimpan harga POS: ${err.message || err}`, 'error');
    }
  };

  // Update PWA price inline (persisted to Firestore)
  const handleUpdatePwaPrice = async (groupId: string, variantId: string | null, newPrice: number) => {
    const targetGroup = products.find((g) => g.id === groupId);
    if (!targetGroup) return;

    try {
      if (variantId && targetGroup.variants) {
        const targetVar = targetGroup.variants.find((v) => v.id === variantId);
        if (targetVar) {
          // Kosong / 0 = kembali ikut Harga Jual 1 Produk
          const finalPwa = newPrice > 0 ? newPrice : Number(targetVar.posPrice ?? targetVar.sellPrice) || 0;
          if (Number(targetVar.pwaPrice) === finalPwa) return;
          await updateVariantInDb(
            { ...targetVar, pwaPrice: finalPwa },
            targetVar.docId || targetVar.id
          );
        }
      } else {
        const finalPwa = newPrice > 0 ? newPrice : Number(targetGroup.posPrice ?? targetGroup.sellPrice) || 0;
        if (Number(targetGroup.pwaPrice) === finalPwa) return;
        await updateProductGroupInDb({
          ...targetGroup,
          pwaPrice: finalPwa,
        });
      }
      showToast('Harga Jual PWA berhasil disimpan ke database!');
    } catch (err: any) {
      showToast(`Gagal menyimpan harga PWA: ${err.message || err}`, 'error');
    }
  };

  // Delete product or product group from Firestore and update UI immediately
  const handleDeleteProduct = async (groupId: string) => {
    const targetGroup = products.find(
      (p) =>
        p.id === groupId ||
        p.docId === groupId ||
        p.sku === groupId ||
        (p.docIds && p.docIds.includes(groupId))
    );

    const docIdsToDelete: string[] = [];
    const skusToDelete: string[] = [];

    if (targetGroup) {
      if (targetGroup.docId) docIdsToDelete.push(targetGroup.docId);
      if (targetGroup.docIds) docIdsToDelete.push(...targetGroup.docIds);
      if (!targetGroup.id.startsWith('grp_')) docIdsToDelete.push(targetGroup.id);
      if (targetGroup.sku) skusToDelete.push(targetGroup.sku);
      if (targetGroup.variants) {
        targetGroup.variants.forEach((v) => {
          if (v.docId) docIdsToDelete.push(v.docId);
          if (v.id) docIdsToDelete.push(v.id);
          if (v.sku) skusToDelete.push(v.sku);
        });
      }
    } else {
      docIdsToDelete.push(groupId);
    }

    try {
      setActiveDropdownId(null);
      await deleteProductFromDb({
        docIds: docIdsToDelete,
        skus: skusToDelete,
        variantGroupId: targetGroup?.variantGroupId,
      });

      // Immediately filter out from frontend state so table updates right away
      setProducts((prev) =>
        prev.filter(
          (p) =>
            p.id !== groupId &&
            p.docId !== groupId &&
            p.sku !== groupId &&
            !(p.docIds && p.docIds.includes(groupId))
        )
      );

      if (editingGroup && (editingGroup.id === groupId || editingGroup.docId === groupId)) {
        setEditingGroup(null);
      }
      if (route.productEntityId) {
        navigateToPath('/produk');
      }

      showToast(`Produk "${targetGroup?.name || groupId}" berhasil dihapus dari database!`);
    } catch (err: any) {
      console.error('Error deleting product from Firestore:', err);
      showToast(`Gagal menghapus produk: ${err.message || err}`, 'error');
    }
  };

  // Delete a single variant from Firestore and update UI immediately
  const handleDeleteVariant = async (group: ProductGroupItem, variant: ProductVariantItem) => {
    try {
      await deleteVariantFromDb(variant);

      setProducts((prev) =>
        prev
          .map((item) => {
            if (item.id !== group.id) return item;
            const remaining = (item.variants || []).filter(
              (v) => v.id !== variant.id && v.sku !== variant.sku
            );
            if (remaining.length === 0) return null;
            return {
              ...item,
              variants: remaining,
              totalStock: remaining.reduce((sum, v) => sum + v.stock, 0),
            };
          })
          .filter(Boolean) as ProductGroupItem[]
      );

      if (editingGroup?.editingVariantId === variant.id || editingGroup?.editingVariantId === variant.docId) {
        setEditingGroup(null);
      }
      if (route.productEntityId) {
        navigateToPath('/produk');
      }

      showToast(`Varian "${variant.name}" berhasil dihapus dari database!`);
    } catch (err: any) {
      console.error('Error deleting variant from Firestore:', err);
      showToast(`Gagal menghapus varian: ${err.message || err}`, 'error');
    }
  };

  // Quick Add Product (Live Firestore Create)
  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductForm.name.trim()) {
      showToast('Nama produk wajib diisi!', 'error');
      return;
    }

    const safeIsi = Math.max(1, Number(newProductForm.itemsPerCarton) || 1);
    const safeWeightMl = Math.max(0, Number(newProductForm.weightMl) || 0);
    const newGroup: ProductGroupItem = {
      id: 'prod_' + Date.now(),
      name: newProductForm.name.trim(),
      sku: newProductForm.sku.trim(),
      category: newProductForm.category,
      brand: newProductForm.brand.trim(),
      hasVariants: false,
      costPrice: Number(newProductForm.costPrice) || 0,
      sellPrice: Number(newProductForm.sellPrice) || 0,
      posPrice: Number(newProductForm.posPrice) || 0,
      pwaPrice: Number(newProductForm.pwaPrice) || 0,
      totalStock: Number(newProductForm.stock) || 0,
      itemsPerCarton: safeIsi,
      isiPerDus: safeIsi,
      weightMl: safeWeightMl,
      beratPerItem: safeWeightMl,
      totalBeratKg: Number(((safeWeightMl * safeIsi) / 1000).toFixed(3)),
      isActive: true,
      isPosVisible: true,
      isPwaVisible: true,
    };

    try {
      await createProductGroupInDb(newGroup);
      setIsAddModalOpen(false);
      showToast(`Produk "${newGroup.name}" berhasil disimpan ke database!`);
    } catch (err: any) {
      console.error('Error creating product in Firestore:', err);
      showToast(`Gagal menyimpan produk baru: ${err.message || err}`, 'error');
    }
  };

  // Refresh
  const handleRefresh = () => {
    showToast('Katalog produk tersinkronisasi secara live dengan database!');
  };

  const isDateRangeInvalid = Boolean(startDate && endDate && startDate > endDate);

  const checkDateMatch = (createdAt?: string): boolean => {
    if (!createdAt) return true; // tanpa createdAt selalu ikut
    if (isDateRangeInvalid) return true; // jika awal > akhir, jangan filter out
    const itemDate = createdAt.slice(0, 10);
    if (startDate && itemDate < startDate) return false;
    if (endDate && itemDate > endDate) return false;
    return true;
  };

  // Filtering
  const filteredProducts = products
    .map((group) => {
      if (group.hasVariants && group.variants) {
        const matchingVariants = group.variants.filter((v) => {
          if (!checkDateMatch(v.createdAt || group.createdAt)) return false;

          if (!searchTerm) return true;
          const term = searchTerm.toLowerCase();
          return (
            v.name.toLowerCase().includes(term) ||
            v.sku.toLowerCase().includes(term) ||
            v.category.toLowerCase().includes(term) ||
            v.brand.toLowerCase().includes(term) ||
            group.name.toLowerCase().includes(term)
          );
        });

        return {
          ...group,
          variants: matchingVariants,
        };
      }
      return group;
    })
    .filter((p) => {
      if (p.hasVariants) {
        if (!p.variants || p.variants.length === 0) return false;
        if (activeTab === 'kritis') {
          const remainingStock = p.variants.reduce((sum, v) => sum + v.stock, 0);
          return remainingStock <= 5;
        }
        return true;
      }

      // Standalone product
      if (!checkDateMatch(p.createdAt)) return false;

      const term = searchTerm.toLowerCase();
      const matchesSearch =
        !searchTerm ||
        p.name.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term) ||
        p.brand.toLowerCase().includes(term) ||
        (p.sku && p.sku.toLowerCase().includes(term));

      if (!matchesSearch) return false;

      if (activeTab === 'kritis') {
        if (p.hasRawMaterials) return false;
        return p.totalStock <= 5;
      }

      return true;
    });

  // Count total displayed products
  const totalCount = filteredProducts.reduce((acc, p) => acc + (p.hasVariants && p.variants ? p.variants.length : 1), 0);

  const isDark = tableTheme === 'dark';

  const handleSaveAddProductForm = async (newProduct: ProductGroupItem, addAnother = false) => {
    try {
      await createProductGroupInDb(newProduct);
      showToast(`Produk "${newProduct.name}" berhasil disimpan ke database!`);
      if (!addAnother) {
        setViewMode('table');
      }
    } catch (err: any) {
      console.error('Error saving product to Firestore:', err);
      const msg =
        err?.message === 'Ukuran foto terlalu besar, kurangi foto galeri'
          ? tr('Photo size is too large, please reduce gallery photos', 'Ukuran foto terlalu besar, kurangi foto galeri')
          : `${tr('Failed to save product', 'Gagal menyimpan produk')}: ${err.message || err}`;
      showToast(msg, 'error');
      throw err;
    }
  };

  const handleSaveEditProductForm = async (updatedProduct: ProductGroupItem) => {
    if (!editingGroup) return;
    try {
      await updateProductGroupInDb(updatedProduct);
      showToast(`Perubahan produk "${updatedProduct.name}" berhasil disimpan!`);
      setEditingGroup(null);
      if (route.productEntityId) {
        navigateToPath('/produk');
      }
    } catch (err: any) {
      console.error('Error updating product in Firestore:', err);
      const msg =
        err?.message === 'Ukuran foto terlalu besar, kurangi foto galeri'
          ? tr('Photo size is too large, please reduce gallery photos', 'Ukuran foto terlalu besar, kurangi foto galeri')
          : `${tr('Failed to update product', 'Gagal menyimpan perubahan produk')}: ${err.message || err}`;
      showToast(msg, 'error');
      throw err;
    }
  };

  if (viewMode === 'add_product') {
    return (
      <div className="w-full space-y-4 font-sans select-none pb-12">
        {toastMessage && (
          <div
            className={`fixed bottom-6 right-6 z-50 border px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold animate-in fade-in slide-in-from-bottom-2 ${
              toastType === 'error'
                ? 'bg-rose-950 border-rose-700 text-rose-100'
                : 'bg-zinc-900 border-zinc-700 text-white'
            }`}
          >
            {toastType === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            ) : (
              <CheckCircle className="w-4 h-4 text-emerald-400" />
            )}
            <span>{toastMessage}</span>
          </div>
        )}
        <AddProductForm
          isDark={isDark}
          onBack={() => setViewMode('table')}
          onToggleTheme={handleSetTheme}
          onSubmit={(newProduct) => handleSaveAddProductForm(newProduct, false)}
          onSaveAndAddAnother={(newProduct) => handleSaveAddProductForm(newProduct, true)}
        />
      </div>
    );
  }

  if (editingGroup) {
    return (
      <div className="w-full space-y-4 font-sans select-none pb-12">
        {toastMessage && (
          <div
            className={`fixed bottom-6 right-6 z-50 border px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold animate-in fade-in slide-in-from-bottom-2 ${
              toastType === 'error'
                ? 'bg-rose-950 border-rose-700 text-rose-100'
                : 'bg-zinc-900 border-zinc-700 text-white'
            }`}
          >
            {toastType === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            ) : (
              <CheckCircle className="w-4 h-4 text-emerald-400" />
            )}
            <span>{toastMessage}</span>
          </div>
        )}
        <AddProductForm
          key={`${editingGroup.id}_${editingGroup.editingVariantId || 'root'}`}
          isDark={isDark}
          initialProduct={editingGroup}
          onBack={() => {
            setEditingGroup(null);
            if (route.productEntityId) {
              navigateToPath('/produk');
            }
          }}
          onToggleTheme={handleSetTheme}
          onSubmit={(updatedProduct) => handleSaveEditProductForm(updatedProduct)}
        />
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 font-sans select-none pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 border px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold animate-in fade-in slide-in-from-bottom-2 ${
            toastType === 'error'
              ? 'bg-rose-950 border-rose-700 text-rose-100'
              : 'bg-zinc-900 border-zinc-700 text-white'
          }`}
        >
          {toastType === 'error' ? (
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          ) : (
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          )}
          <span>{toastMessage}</span>
        </div>
      )}

      {/* TOP HEADER - Title: Halaman Produk */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Package className="w-6 h-6 text-blue-500" />
            <span>{t('product_management', 'Halaman Produk')}</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            {language === 'en'
              ? 'Manage product catalog, carton/box packaging conversions, and pricing variants in real-time.'
              : 'Pusat kelola List Produk, Paket Produk (Dus/Karton), Kategori & Brand, serta Pengaturan Harga Diskon.'}
          </p>
        </div>

        {/* Action Controls & Light/Dark Theme Switcher */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Light / Dark Theme Switcher */}
          <div className="flex items-center p-1 rounded-xl bg-zinc-900 border border-zinc-800 shadow-sm">
            <button
              onClick={() => handleSetTheme('dark')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                isDark
                  ? 'bg-zinc-800 text-white shadow-sm font-bold border border-zinc-700/60'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Dark Theme"
              aria-label="Dark Theme"
            >
              <Moon className="w-3.5 h-3.5 text-blue-400" />
              <span>Dark</span>
            </button>
            <button
              onClick={() => handleSetTheme('light')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                !isDark
                  ? 'bg-white text-slate-900 shadow-sm font-bold border border-slate-200'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Light Theme"
              aria-label="Light Theme"
            >
              <Sun className="w-3.5 h-3.5 text-amber-500" />
              <span>Light</span>
            </button>
          </div>

          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#110e08] border border-amber-500/40 hover:bg-[#16120b] text-amber-200 text-xs font-semibold transition shadow-sm cursor-pointer"
            title="Refresh product data"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
            <span>Refresh</span>
          </button>

          <AppLink
            to="/produk/tambah"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 hover:brightness-110 text-black text-xs font-black transition border border-amber-300/60 shadow-[0_0_15px_rgba(245,158,11,0.35)] cursor-pointer"
          >
            <Plus className="w-4 h-4 text-black" />
            <span>{t('add_product', 'Tambah Produk')}</span>
          </AppLink>
        </div>
      </div>

      {/* HORIZONTAL SUB-NAVIGATION TABS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1 overflow-x-auto p-1.5 rounded-xl border text-xs transition-colors bg-[#110e08] border-amber-500/40 text-amber-200/70">
          {/* 1. Product List */}
          <AppLink
            to={getPathForProductSubTab('list')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition whitespace-nowrap cursor-pointer ${
              activeTab === 'list'
                ? 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 text-black font-black shadow-[0_0_15px_rgba(245,158,11,0.35)] border border-amber-300/60'
                : 'hover:text-amber-300 hover:bg-[#16120b]'
            }`}
          >
            <Boxes className="w-4 h-4" />
            <span>{tr('Product List', 'Daftar Produk')}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/25 text-amber-200 font-mono">
              {totalCount}
            </span>
          </AppLink>

          {/* 2. Product Bundles (Paket Produk) */}
          <AppLink
            to={getPathForProductSubTab('paket')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition whitespace-nowrap cursor-pointer ${
              activeTab === 'paket'
                ? 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 text-black font-black shadow-[0_0_15px_rgba(245,158,11,0.35)] border border-amber-300/60'
                : 'hover:text-amber-300 hover:bg-[#16120b]'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>{tr('Product Bundles', 'Paket Produk')}</span>
          </AppLink>

          {/* 3. Categories & Brands */}
          <AppLink
            to={getPathForProductSubTab('kategori')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition whitespace-nowrap cursor-pointer ${
              activeTab === 'kategori'
                ? 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 text-black font-black shadow-[0_0_15px_rgba(245,158,11,0.35)] border border-amber-300/60'
                : 'hover:text-amber-300 hover:bg-[#16120b]'
            }`}
          >
            <Tag className="w-4 h-4" />
            <span>{tr('Categories & Brands', 'Kategori & Brand')}</span>
          </AppLink>

          {/* 4. Discount Pricing */}
          <AppLink
            to={getPathForProductSubTab('harga_diskon')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition whitespace-nowrap cursor-pointer ${
              activeTab === 'harga_diskon'
                ? 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 text-black font-black shadow-[0_0_15px_rgba(245,158,11,0.35)] border border-amber-300/60'
                : 'hover:text-amber-300 hover:bg-[#16120b]'
            }`}
          >
            <Percent className="w-4 h-4" />
            <span>{tr('Discount Pricing', 'Harga Diskon')}</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                activeTab === 'harga_diskon'
                  ? 'bg-black/30 text-amber-200 border border-amber-400/30'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              }`}
            >
              Promo
            </span>
          </AppLink>
        </div>

        {/* Secondary Stock Audit Pills */}
        <div className="flex items-center gap-1 overflow-x-auto p-1 rounded-xl border text-[11px] bg-[#080705] border-amber-500/35 text-amber-200/70">
          <span className="px-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Log:</span>
          <AppLink
            to={getPathForProductSubTab('masuk')}
            className={`px-2.5 py-1.5 rounded-lg font-medium transition cursor-pointer ${
              activeTab === 'masuk' ? 'bg-zinc-800 text-white font-bold' : 'hover:text-white'
            }`}
          >
            {tr('Stock In', 'Barang Masuk')}
          </AppLink>
          <AppLink
            to={getPathForProductSubTab('keluar')}
            className={`px-2.5 py-1.5 rounded-lg font-medium transition cursor-pointer ${
              activeTab === 'keluar' ? 'bg-zinc-800 text-white font-bold' : 'hover:text-white'
            }`}
          >
            {tr('Stock Out', 'Barang Keluar')}
          </AppLink>
          <AppLink
            to={getPathForProductSubTab('opname')}
            className={`px-2.5 py-1.5 rounded-lg font-medium transition cursor-pointer ${
              activeTab === 'opname' ? 'bg-zinc-800 text-white font-bold' : 'hover:text-white'
            }`}
          >
            {tr('Stock Opname', 'Stok Opname')}
          </AppLink>
          <AppLink
            to={getPathForProductSubTab('pergerakan')}
            className={`px-2.5 py-1.5 rounded-lg font-medium transition cursor-pointer ${
              activeTab === 'pergerakan' ? 'bg-zinc-800 text-white font-bold' : 'hover:text-white'
            }`}
          >
            {tr('Movements', 'Pergerakan')}
          </AppLink>
          <AppLink
            to={getPathForProductSubTab('kritis')}
            className={`px-2.5 py-1.5 rounded-lg font-medium transition flex items-center gap-1 cursor-pointer ${
              activeTab === 'kritis' ? 'bg-rose-950 text-rose-300 font-bold border border-rose-800' : 'text-rose-400 hover:text-rose-300'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
            <span>{tr('Critical', 'Stok Kritis')}</span>
          </AppLink>
        </div>
      </div>

      {/* FILTER & SEARCH ROW */}
      <div
        className={`rounded-2xl p-3 border shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs transition-colors ${
          isDark
            ? 'bg-zinc-900/90 border-zinc-800 text-zinc-200'
            : 'bg-white border-slate-200/90 text-slate-800'
        }`}
      >
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-zinc-500' : 'text-slate-400'}`} />
          <input
            type="text"
            placeholder="Search product name or SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full pl-9 pr-4 py-2 rounded-xl border transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              isDark
                ? 'bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-500 focus:bg-zinc-900'
                : 'bg-slate-50 border-slate-200 text-slate-800 placeholder:text-slate-400 focus:bg-white'
            }`}
          />
        </div>

        {/* Date Filter & Counter */}
        <div className="flex flex-wrap items-center gap-3">
          <div className={`flex items-center gap-1.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
            <span className="text-[11px] font-medium">Created from</span>
            <div className="relative">
              <input
                ref={startDateInputRef}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={`w-32 px-2.5 py-1.5 rounded-lg border text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${
                  isDark
                    ? 'border-zinc-800 bg-zinc-950 text-zinc-200 [color-scheme:dark]'
                    : 'border-slate-200 bg-slate-50 text-slate-700 [color-scheme:light]'
                }`}
              />
              <button
                type="button"
                onClick={() => {
                  try {
                    startDateInputRef.current?.showPicker();
                  } catch {
                    startDateInputRef.current?.focus();
                  }
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-blue-400 cursor-pointer p-0.5"
                title="Pilih tanggal mulai"
              >
                <Calendar className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className={`flex items-center gap-1.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
            <span className="text-[11px] font-medium">To</span>
            <div className="relative">
              <input
                ref={endDateInputRef}
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={`w-32 px-2.5 py-1.5 rounded-lg border text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${
                  isDark
                    ? 'border-zinc-800 bg-zinc-950 text-zinc-200 [color-scheme:dark]'
                    : 'border-slate-200 bg-slate-50 text-slate-700 [color-scheme:light]'
                }`}
              />
              <button
                type="button"
                onClick={() => {
                  try {
                    endDateInputRef.current?.showPicker();
                  } catch {
                    endDateInputRef.current?.focus();
                  }
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-blue-400 cursor-pointer p-0.5"
                title="Pilih tanggal akhir"
              >
                <Calendar className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Tombol Reset */}
          <button
            type="button"
            onClick={() => {
              setStartDate('');
              setEndDate('');
            }}
            disabled={!startDate && !endDate}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              isDark
                ? 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700'
                : 'border-slate-200 bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
            title="Reset filter tanggal"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>

          {/* N Products Counter */}
          <div
            className={`px-3 py-1.5 rounded-lg border font-bold text-xs ${
              isDark
                ? 'bg-zinc-800 border-zinc-700 text-zinc-200'
                : 'bg-slate-100 border-slate-200 text-slate-700'
            }`}
          >
            {totalCount} products
          </div>

          {/* Pesan kecil bila awal > akhir */}
          {isDateRangeInvalid && (
            <span className="text-[11px] text-rose-400 font-medium">
              Tanggal awal tidak boleh lebih besar dari tanggal akhir
            </span>
          )}
        </div>
      </div>

      {/* PRODUCT DATA TABLE CONTAINER (Light & Dark Theme Adaptive) */}
      {activeTab === 'list' && (
        <div
          className={`rounded-2xl border shadow-sm overflow-hidden transition-colors ${
            isDark
              ? 'bg-zinc-900/95 border-zinc-800'
              : 'bg-white border-slate-200'
          }`}
        >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            {/* Table Header with theme styling */}
            <thead>
              <tr
                className={`border-b font-bold uppercase text-[10px] sm:text-[11px] tracking-wider whitespace-nowrap transition-colors ${
                  isDark
                    ? 'bg-zinc-950/90 border-zinc-800 text-zinc-300'
                    : 'bg-blue-50/90 border-blue-100/90 text-blue-950'
                }`}
              >
                <th className="py-3 px-4">{tr('Product Name', 'Nama Produk')}</th>
                <th className="py-3 px-3">{tr('Category', 'Kategori')}</th>
                <th className="py-3 px-3">{tr('Brand', 'Brand')}</th>
                <th className="py-3 px-3">{tr('Cost Price (1 Carton)', 'Harga Modal (1 Karton)')}</th>
                <th className="py-3 px-3">{tr('Selling Price (1 Product)', 'Harga Jual 1 Produk')}</th>
                <th className="py-3 px-3 text-center">{tr('POS Price (1 Carton)', 'Harga POS (1 Karton)')}</th>
                <th className="py-3 px-3 text-center">{tr('PWA Selling Price', 'Harga Jual PWA')}</th>
                <th className="py-3 px-3 text-center">{tr('Stock (Carton)', 'Stok (Karton)')}</th>
                <th className="py-3 px-3 text-center">{tr('Product (Qty)', 'Produk (Qty)')}</th>
                <th className="py-3 px-3 text-center">{tr('Total Weight (kg)', 'Total Berat ( kg )')}</th>
                <th className="py-3 px-3 text-center">{tr('Visibility', 'Visibilitas')}</th>
                <th className="py-3 px-4 text-right">{tr('Action', 'Aksi')}</th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody
              className={`divide-y transition-colors ${
                isDark ? 'divide-zinc-800/80 text-zinc-200' : 'divide-slate-100 text-slate-800'
              }`}
            >
              {isLoadingProducts ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-zinc-400 text-xs">
                    {tr('Loading product catalog from database...', 'Memuat katalog produk dari database...')}
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-14 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Package className="w-8 h-8 text-zinc-500 opacity-60" />
                      <p className={`text-sm font-bold ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                        {searchTerm || startDate || endDate
                          ? tr('No products matched your search filters', 'Tidak ada produk yang cocok dengan filter pencarian')
                          : tr('No products in the database catalog yet', 'Belum ada produk di katalog database')}
                      </p>
                      <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-slate-400'}`}>
                        {searchTerm || startDate || endDate
                          ? tr('Try changing your search keyword or resetting the date filter.', 'Coba ubah kata kunci pencarian atau reset filter tanggal.')
                          : tr('Click "+ Add Product" to add a new product to the database.', 'Klik tombol "+ Tambah Produk" untuk menambahkan produk baru ke database.')}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredProducts.map((group) => {
                  const isExpanded = !!expandedGroups[group.id];

                return (
                  <React.Fragment key={group.id}>
                    {/* Top Group Row */}
                    <tr
                      className={`transition-colors ${
                        isDark
                          ? `hover:bg-zinc-800/50 ${isExpanded ? 'bg-zinc-950/60' : 'bg-transparent'}`
                          : `hover:bg-blue-50/30 ${isExpanded ? 'bg-slate-50/60' : 'bg-white'}`
                      }`}
                    >
                      {/* 1. Product Name */}
                      <td className="py-3 px-4">
                        {group.hasVariants ? (
                          <div
                            onClick={() => toggleGroup(group.id)}
                            className="cursor-pointer group flex items-start gap-2"
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleGroup(group.id);
                              }}
                              className={`mt-0.5 transition ${
                                isDark
                                  ? 'text-zinc-500 group-hover:text-blue-400'
                                  : 'text-slate-400 group-hover:text-blue-600'
                              }`}
                              title="Toggle Variants"
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-blue-500" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>
                            <div>
                              <div className="flex flex-col items-start">
                                <span
                                  data-no-translate="true"
                                  className={`font-bold transition ${
                                    isDark
                                      ? 'text-zinc-100 group-hover:text-blue-400'
                                      : 'text-slate-900 group-hover:text-blue-600'
                                  }`}
                                >
                                  {group.name}
                                </span>
                                <span
                                  className={`text-[11px] font-medium mt-0.5 ${
                                    isDark
                                      ? 'text-zinc-400'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  {group.variants?.length || 0} {tr('variants', 'varian')}
                                </span>
                              </div>
                              <div
                                className={`text-[10px] mt-0.5 font-normal ${
                                  isDark ? 'text-zinc-500' : 'text-slate-400'
                                }`}
                              >
                                {tr('Click to view all variants', 'Klik untuk melihat semua varian')}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="pl-6">
                            <AppLink
                              to={`/produk/${encodeURIComponent(group.sku || group.id)}/edit`}
                              data-no-translate="true"
                              className="font-bold text-blue-500 hover:underline cursor-pointer block"
                            >
                              {group.name}
                            </AppLink>
                            <div
                              className={`text-[10px] font-mono mt-0.5 ${
                                isDark ? 'text-zinc-500' : 'text-slate-400'
                              }`}
                            >
                              {group.sku}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* 2. Category */}
                      <td
                        className={`py-3 px-3 font-medium uppercase text-[11px] ${
                          isDark ? 'text-zinc-400' : 'text-slate-500'
                        }`}
                      >
                        {translateCategory(group.category)}
                      </td>

                      {/* 3. Brand */}
                      <td
                        data-no-translate="true"
                        className={`py-3 px-3 font-medium text-[11px] ${
                          isDark ? 'text-zinc-300' : 'text-slate-600'
                        }`}
                      >
                        {group.brand}
                      </td>

                      {/* 4. Cost Price */}
                      <td
                        className={`py-3 px-3 font-mono text-[11px] ${
                          isDark ? 'text-zinc-400' : 'text-slate-600'
                        }`}
                      >
                        {hideHpp ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-900 border border-amber-500/30 text-amber-400 text-[10px] font-bold">
                            🔒 Rahasia
                          </span>
                        ) : group.hasVariants ? (
                          group.costPriceRange || '-'
                        ) : group.costPrice ? (
                          formatCurrency(group.costPrice)
                        ) : (
                          '-'
                        )}
                      </td>

                      {/* 5. Selling Price */}
                      <td
                        className={`py-3 px-3 font-mono text-[11px] font-semibold ${
                          isDark ? 'text-zinc-100' : 'text-slate-800'
                        }`}
                      >
                        {group.hasVariants
                          ? group.sellPriceRange || '-'
                          : group.sellPrice
                          ? formatCurrency(group.sellPrice)
                          : '-'}
                      </td>

                      {/* 6. POS Cashier Price */}
                      <td className="py-3 px-3 text-center">
                        {!group.hasVariants && group.posPrice !== undefined ? (
                          <input
                            type="number"
                            key={`pos-${group.id}-${group.posPrice}`}
                            defaultValue={group.posPrice}
                            onBlur={(e) =>
                              handleUpdatePosPrice(group.id, null, Number(e.target.value))
                            }
                            className={`w-20 px-2 py-1 text-center font-mono text-xs rounded-lg border transition focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-xs ${
                              isDark
                                ? 'bg-zinc-950 border-zinc-700 text-zinc-100'
                                : 'bg-white border-slate-200 text-slate-800'
                            }`}
                          />
                        ) : null}
                      </td>

                      {/* 7. PWA Online Price */}
                      <td className="py-3 px-3 text-center">
                        {!group.hasVariants && group.pwaPrice !== undefined ? (
                          <input
                            type="number"
                            key={`pwa-${group.id}-${group.pwaPrice}`}
                            defaultValue={group.pwaPrice}
                            onBlur={(e) =>
                              handleUpdatePwaPrice(group.id, null, Number(e.target.value))
                            }
                            className={`w-20 px-2 py-1 text-center font-mono text-xs rounded-lg border transition focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-xs ${
                              isDark
                                ? 'bg-zinc-950 border-zinc-700 text-zinc-100'
                                : 'bg-white border-slate-200 text-slate-800'
                            }`}
                          />
                        ) : null}
                      </td>

                      {/* 8. Stock (Carton) */}
                      <td className="py-3 px-3 text-center">
                        <div className="flex flex-col items-center">
                          {group.hasRawMaterials ? (
                            <span
                              className={`font-bold text-xs px-2 py-0.5 rounded-md border ${
                                isDark
                                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                                  : 'bg-emerald-50 border-emerald-300 text-emerald-700'
                              }`}
                            >
                              {tr('Always Available', 'Selalu Ada (Bahan Baku)')}
                            </span>
                          ) : (
                            <>
                              <span
                                className={`font-bold text-xs ${
                                  group.totalStock === 0
                                    ? 'text-rose-500 font-black'
                                    : group.totalStock <= 5
                                    ? 'text-amber-500'
                                    : isDark
                                    ? 'text-emerald-400'
                                    : 'text-slate-900'
                                }`}
                              >
                                {group.totalStock} {tr('Carton', 'Karton')}
                              </span>
                              {!group.hasVariants && (group.itemsPerCarton || 1) > 1 && (
                                <span className="text-[9px] font-mono text-zinc-500">
                                  ({group.totalStock * (group.itemsPerCarton || 1)} item)
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </td>

                      {/* 9. Items / Carton */}
                      <td
                        className={`py-3 px-3 text-center font-mono ${
                          isDark ? 'text-zinc-400' : 'text-slate-500'
                        }`}
                      >
                        {group.hasVariants ? '' : `${group.itemsPerCarton || 1} item`}
                      </td>

                      {/* 10. Total Weight */}
                      <td
                        className={`py-3 px-3 text-center font-mono ${
                          isDark ? 'text-zinc-400' : 'text-slate-500'
                        }`}
                      >
                        {group.hasVariants
                          ? ''
                          : `${
                              group.totalBeratKg !== undefined
                                ? group.totalBeratKg
                                : Number(
                                    (
                                      ((group.weightMl || 0) * (group.itemsPerCarton || 1)) /
                                      1000
                                    ).toFixed(3)
                                  )
                            } kg`}
                      </td>

                      {/* 11. Visibility */}
                      <td className="py-3 px-3 text-center">
                        {!group.hasVariants && (
                          <div className="flex items-center justify-center gap-1">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-600 text-white uppercase">
                              ACTIVE
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                                isDark
                                  ? 'bg-zinc-800 text-zinc-300 border-zinc-700'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}
                            >
                              POS
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                                isDark
                                  ? 'bg-zinc-800 text-zinc-300 border-zinc-700'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}
                            >
                              PWA
                            </span>
                          </div>
                        )}
                      </td>

                      {/* 12. Action Menu (Lihat, Edit, Hapus) */}
                      <td className="py-3 px-4 text-right relative">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setDetailGroup(group)}
                            className={`p-1.5 rounded-lg transition cursor-pointer ${
                              isDark
                                ? 'text-zinc-400 hover:text-blue-400 hover:bg-zinc-800'
                                : 'text-slate-400 hover:text-blue-600 hover:bg-slate-100'
                            }`}
                            title="Lihat Detail Produk"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModalForGroup(group)}
                            className={`p-1.5 rounded-lg transition cursor-pointer ${
                              isDark
                                ? 'text-zinc-400 hover:text-amber-400 hover:bg-zinc-800'
                                : 'text-slate-400 hover:text-amber-600 hover:bg-slate-100'
                            }`}
                            title="Edit Produk"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!canPerformModuleAction('mod_produk', 'delete')) {
                                requestSupervisorPin(
                                  `Hapus Produk: ${group.name}`,
                                  () => void handleDeleteProduct(group.id)
                                );
                                return;
                              }
                              void handleDeleteProduct(group.id);
                            }}
                            className={`p-1.5 rounded-lg transition cursor-pointer ${
                              isDark
                                ? 'text-zinc-400 hover:text-rose-400 hover:bg-rose-950/40'
                                : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                            }`}
                            title="Hapus Produk"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() =>
                              setActiveDropdownId(activeDropdownId === group.id ? null : group.id)
                            }
                            className={`p-1.5 rounded-lg transition cursor-pointer ${
                              isDark
                                ? 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                                : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                            }`}
                            title="Action Menu"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Dropdown Menu */}
                        {activeDropdownId === group.id && (
                          <div
                            className={`absolute right-4 top-10 w-44 rounded-xl border shadow-xl z-30 py-1 text-left text-xs animate-in fade-in ${
                              isDark
                                ? 'bg-zinc-900 border-zinc-700 text-zinc-200'
                                : 'bg-white border-slate-200 text-slate-700'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setActiveDropdownId(null);
                                setDetailGroup(group);
                              }}
                              className={`w-full px-3 py-2 flex items-center gap-2 cursor-pointer ${
                                isDark
                                  ? 'hover:bg-zinc-800 hover:text-blue-400'
                                  : 'hover:bg-blue-50 hover:text-blue-600'
                              }`}
                            >
                              <Eye className="w-3.5 h-3.5" />
                              {tr('View Details', 'Lihat Detail')}
                            </button>
                            <AppLink
                              to={`/produk/${encodeURIComponent(group.sku || group.id)}/edit`}
                              onClick={() => {
                                setActiveDropdownId(null);
                                openEditModalForGroup(group);
                              }}
                              className={`w-full px-3 py-2 flex items-center gap-2 cursor-pointer ${
                                isDark
                                  ? 'hover:bg-zinc-800 hover:text-blue-400'
                                  : 'hover:bg-blue-50 hover:text-blue-600'
                              }`}
                            >
                              <Edit className="w-3.5 h-3.5" />
                              {tr('Edit Details', 'Edit Detail')}
                            </AppLink>
                            <AppLink
                              to={`/produk/${encodeURIComponent(group.sku || group.id)}/stok`}
                              onClick={() => {
                                setActiveDropdownId(null);
                                setEditingGroup(null);
                                setAdjustingStockGroup(group);
                              }}
                              className={`w-full px-3 py-2 flex items-center gap-2 cursor-pointer ${
                                isDark
                                  ? 'hover:bg-zinc-800 hover:text-blue-400'
                                  : 'hover:bg-blue-50 hover:text-blue-600'
                              }`}
                            >
                              <Package className="w-3.5 h-3.5" />
                              {tr('Stock Adjustment', 'Penyesuaian Stok')}
                            </AppLink>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteProduct(group.id);
                              }}
                              className={`w-full px-3 py-2 flex items-center gap-2 text-rose-500 cursor-pointer ${
                                isDark ? 'hover:bg-rose-950/40' : 'hover:bg-rose-50'
                              }`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              {tr('Delete Product', 'Hapus Produk')}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* SUB-VARIANTS EXPANDED ROWS */}
                    {group.hasVariants &&
                      isExpanded &&
                      group.variants?.map((v) => (
                        <tr
                          key={v.id}
                          className={`text-xs transition-colors border-t ${
                            isDark
                              ? 'bg-zinc-950/70 border-zinc-800/80 hover:bg-zinc-800/40 text-zinc-300'
                              : 'bg-slate-50/70 border-slate-100 hover:bg-blue-50/20 text-slate-700'
                          }`}
                        >
                          {/* Variant Name & SKU */}
                          <td className="py-2.5 px-4 pl-12">
                            <div className="font-semibold flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                              <span
                                data-no-translate="true"
                                className={isDark ? 'text-zinc-200' : 'text-slate-800'}
                              >
                                {v.name}
                              </span>
                            </div>
                            <div
                              className={`text-[10px] font-mono mt-0.5 pl-3 ${
                                isDark ? 'text-zinc-500' : 'text-slate-400'
                              }`}
                            >
                              SKU: {v.sku}
                            </div>
                          </td>

                          {/* Category */}
                          <td
                            className={`py-2.5 px-3 uppercase text-[10px] ${
                              isDark ? 'text-zinc-400' : 'text-slate-400'
                            }`}
                          >
                            {translateCategory(v.category)}
                          </td>

                          {/* Brand */}
                          <td
                            data-no-translate="true"
                            className={`py-2.5 px-3 text-[10px] ${
                              isDark ? 'text-zinc-400' : 'text-slate-500'
                            }`}
                          >
                            {v.brand}
                          </td>

                          {/* Cost Price */}
                          <td
                            className={`py-2.5 px-3 font-mono text-[11px] ${
                              isDark ? 'text-zinc-400' : 'text-slate-600'
                            }`}
                          >
                            {hideHpp ? (
                              <span className="text-[10px] font-bold text-amber-400">🔒 Rahasia</span>
                            ) : (
                              formatCurrency(v.costPrice)
                            )}
                          </td>

                          {/* Selling Price */}
                          <td
                            className={`py-2.5 px-3 font-mono text-[11px] font-medium ${
                              isDark ? 'text-zinc-200' : 'text-slate-800'
                            }`}
                          >
                            {formatCurrency(v.sellPrice)}
                          </td>

                          {/* POS Price */}
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="number"
                              key={`pos-${v.id}-${v.posPrice}`}
                              defaultValue={v.posPrice}
                              onBlur={(e) =>
                                handleUpdatePosPrice(group.id, v.id, Number(e.target.value))
                              }
                              className={`w-20 px-2 py-1 text-center font-mono text-xs rounded-lg border transition focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-xs ${
                                isDark
                                  ? 'bg-zinc-950 border-zinc-700 text-zinc-100'
                                  : 'bg-white border-slate-200 text-slate-800'
                              }`}
                            />
                          </td>

                          {/* PWA Price */}
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="number"
                              key={`pwa-${v.id}-${v.pwaPrice}`}
                              defaultValue={v.pwaPrice}
                              onBlur={(e) =>
                                handleUpdatePwaPrice(group.id, v.id, Number(e.target.value))
                              }
                              className={`w-20 px-2 py-1 text-center font-mono text-xs rounded-lg border transition focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-xs ${
                                isDark
                                  ? 'bg-zinc-950 border-zinc-700 text-zinc-100'
                                  : 'bg-white border-slate-200 text-slate-800'
                              }`}
                            />
                          </td>

                          {/* Stock (Carton) */}
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex flex-col items-center">
                              <span
                                className={`font-bold text-xs ${
                                  v.stock === 0
                                    ? 'text-rose-500 font-black'
                                    : v.stock <= 5
                                    ? 'text-amber-500'
                                    : isDark
                                    ? 'text-emerald-400'
                                    : 'text-slate-800'
                                }`}
                              >
                                {v.stock} {tr('Carton', 'Karton')}
                              </span>
                              {(v.itemsPerCarton || 1) > 1 && (
                                <span className="text-[9px] font-mono text-zinc-500">
                                  ({v.stock * (v.itemsPerCarton || 1)} item)
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Items / Carton */}
                          <td
                            className={`py-2.5 px-3 text-center font-mono ${
                              isDark ? 'text-zinc-400' : 'text-slate-500'
                            }`}
                          >
                            {v.itemsPerCarton || 1} item
                          </td>

                          {/* Total Weight */}
                          <td
                            className={`py-2.5 px-3 text-center font-mono ${
                              isDark ? 'text-zinc-400' : 'text-slate-500'
                            }`}
                          >
                            {v.totalBeratKg !== undefined
                              ? v.totalBeratKg
                              : Number(
                                  (((v.weightMl || 0) * (v.itemsPerCarton || 1)) / 1000).toFixed(3)
                                )}{' '}
                            kg
                          </td>

                          {/* Visibility */}
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-600 text-white uppercase">
                                ACTIVE
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                                  isDark
                                    ? 'bg-zinc-800 text-zinc-300 border-zinc-700'
                                    : 'bg-slate-100 text-slate-600 border-slate-200'
                                }`}
                              >
                                POS
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                                  isDark
                                    ? 'bg-zinc-800 text-zinc-300 border-zinc-700'
                                    : 'bg-slate-100 text-slate-600 border-slate-200'
                                }`}
                              >
                                PWA
                              </span>
                            </div>
                          </td>

                          {/* Action */}
                          <td className="py-2.5 px-4 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setDetailGroup(group)}
                                className={`inline-flex p-1 rounded transition cursor-pointer ${
                                  isDark
                                    ? 'text-zinc-400 hover:text-blue-400 hover:bg-zinc-800'
                                    : 'text-slate-400 hover:text-blue-600 hover:bg-slate-100'
                                }`}
                                title="Lihat Detail Varian"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <AppLink
                                to={`/produk/${encodeURIComponent(v.sku || v.id)}/edit`}
                                onClick={() => {
                                  const varKey = (v.sku || v.id).toLowerCase();
                                  openedEntityKeyRef.current = `${varKey}::edit`;
                                  openEditModalForGroup(group, v);
                                }}
                                className={`inline-flex p-1 rounded transition cursor-pointer ${
                                  isDark
                                    ? 'text-zinc-400 hover:text-blue-400 hover:bg-zinc-800'
                                    : 'text-slate-400 hover:text-blue-600 hover:bg-slate-100'
                                }`}
                                title="Edit Variant"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </AppLink>
                              <button
                                type="button"
                                onClick={() => handleDeleteVariant(group, v)}
                                className={`inline-flex p-1 rounded transition cursor-pointer ${
                                  isDark
                                    ? 'text-zinc-400 hover:text-rose-400 hover:bg-rose-950/40'
                                    : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                                }`}
                                title="Delete Variant"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </React.Fragment>
                );
              })
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* ========================================================================= */}
      {/* 2. TAB: PAKET PRODUK (Product Bundles Directory & Add Bundle View)        */}
      {/* ========================================================================= */}
      {activeTab === 'paket' && (
        <div className="space-y-4 animate-in fade-in">
          <ProductBundlesModule currencyMode={currencyMode} />
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. TAB: KATEGORI DAN BRAND (Manajemen Kategori Barang, Produsen & Merek)   */}
      {/* ========================================================================= */}
      {activeTab === 'kategori' && (
        <div className="space-y-6 animate-in fade-in">
          {/* Section 1: Tabel Data Kategori */}
          <div
            className={`rounded-2xl p-6 border shadow-sm space-y-4 transition-colors ${
              isDark ? 'bg-zinc-900/95 border-zinc-800 text-zinc-200' : 'bg-white border-slate-200 text-slate-800'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 border-zinc-800/40">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <Tag className="w-5 h-5 text-purple-400" />
                  <span>Kategori</span>
                </h3>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                  Tabel data Kategori terhubung langsung ke katalog <span className="font-mono font-semibold">/dashboard/produk</span> (Nilai Asset = Harga Modal × Stock).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDeduplicateCategories}
                  disabled={isCleaningCategories}
                  title="Hapus permanen kategori bawaan/fiktif & dokumen duplikat di Firestore"
                  className="px-3.5 py-1.5 rounded-xl border border-rose-500/40 bg-rose-950/30 hover:bg-rose-900/40 text-rose-300 font-bold text-xs shadow-sm transition cursor-pointer disabled:opacity-50"
                >
                  {isCleaningCategories ? 'Membersihkan...' : 'Bersihkan Data Fiktif / Kategori Bawaan'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingCategoryKey(null);
                    setEditingCategoryOldName(null);
                    setNewCategoryName('');
                    setNewCategoryIcon('📦');
                    setIsAddCategoryModalOpen(true);
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-sm transition cursor-pointer"
                >
                  + Tambah Kategori
                </button>
              </div>
            </div>

            {(() => {
              const deletedSlugs = getDeletedCategorySlugs();

              // Peta master kategori berdasarkan normalizeCategoryKey ("air mineral" === "mineral water")
              const masterCatByNormKey = new Map<
                string,
                { key: string; slug: string; name: string; icon: string }
              >();
              customCategories.forEach((c) => {
                const cleanName = String(c.name || '').trim();
                if (!cleanName || /^cat_default_\d+$/i.test(cleanName) || cleanName.toLowerCase() === 'other') {
                  return;
                }
                const normKey = normalizeCategoryKey(cleanName);
                const slug = c.slug || toCategorySlug(cleanName);
                if (
                  !normKey ||
                  !slug ||
                  deletedSlugs.has(slug) ||
                  deletedSlugs.has(normKey) ||
                  deletedSlugs.has(cleanName.toLowerCase())
                ) {
                  return;
                }
                if (!masterCatByNormKey.has(normKey) || c.key === `cat_${slug}`) {
                  masterCatByNormKey.set(normKey, {
                    key: c.key || `cat_${slug}`,
                    slug,
                    name: cleanName,
                    icon: c.icon || '📦',
                  });
                }
              });

              const calcProductAsset = (
                group: ProductGroupItem
              ): { stock: number; costPriceLabel: string; assetValue: number } => {
                if (group.hasVariants && group.variants && group.variants.length > 0) {
                  const stock = group.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
                  const assetValue = group.variants.reduce(
                    (sum, v) =>
                      sum +
                      (Number(v.costPrice ?? group.costPrice ?? 0) || 0) * (Number(v.stock) || 0),
                    0
                  );
                  const costPriceLabel =
                    group.costPriceRange ||
                    formatCurrency(Number(group.variants[0]?.costPrice ?? group.costPrice ?? 0));
                  return { stock, costPriceLabel, assetValue };
                }
                const stock = Number(group.totalStock ?? group.stockInUnits ?? 0) || 0;
                const cost = Number(group.costPrice ?? group.costPerUnit ?? 0) || 0;
                return {
                  stock,
                  costPriceLabel: formatCurrency(cost),
                  assetValue: cost * stock,
                };
              };

              type CategoryProductEntry = {
                group: ProductGroupItem;
                stock: number;
                costPriceLabel: string;
                assetValue: number;
              };

              type CategoryTableRow = {
                rowKey: string;
                catKey: string;
                catSlug: string;
                catName: string;
                normalizedCategory: string;
                catIcon: string;
                products: CategoryProductEntry[];
                stock: number;
                assetValue: number;
                isEmptyCategory?: boolean;
              };

              // KUNCI MAP = normCatKey SAJA -> 1 kategori = 1 baris, berapapun jumlah produknya
              const rowMap = new Map<string, CategoryTableRow>();
              const seenProductKeys = new Set<string>();

              // 1. Kelompokkan produk ke dalam baris kategorinya (agregasi, BUKAN 1 baris per produk)
              products.forEach((prodGroup) => {
                const prodKey = String(prodGroup.name || prodGroup.id || '')
                  .trim()
                  .toLowerCase();
                if (!prodKey || seenProductKeys.has(prodKey)) return;
                seenProductKeys.add(prodKey);

                const rawCategory =
                  String(
                    prodGroup.category || prodGroup.variants?.[0]?.category || ''
                  ).trim() || 'Uncategorized';
                const normCatKey = normalizeCategoryKey(rawCategory) || 'uncategorized';
                const calc = calcProductAsset(prodGroup);

                let row = rowMap.get(normCatKey);
                if (!row) {
                  const masterMeta = masterCatByNormKey.get(normCatKey);
                  const resolvedSlug = masterMeta?.slug || toCategorySlug(rawCategory) || normCatKey;
                  row = {
                    rowKey: `cat__${normCatKey}`,
                    catKey: masterMeta?.key || `cat_${resolvedSlug}`,
                    catSlug: resolvedSlug,
                    catName: masterMeta?.name || rawCategory,
                    normalizedCategory: normCatKey,
                    catIcon: masterMeta?.icon || '📦',
                    products: [],
                    stock: 0,
                    assetValue: 0,
                  };
                  rowMap.set(normCatKey, row);
                }

                row.products.push({ group: prodGroup, ...calc });
                row.stock += calc.stock;
                row.assetValue += calc.assetValue;
              });

              // 2. Tambahkan kategori master yang belum punya produk (tetap 1 baris per kategori)
              masterCatByNormKey.forEach((catMeta, normKey) => {
                if (!normKey || rowMap.has(normKey)) return;
                rowMap.set(normKey, {
                  rowKey: `cat__${normKey}`,
                  catKey: catMeta.key,
                  catSlug: catMeta.slug,
                  catName: catMeta.name,
                  normalizedCategory: normKey,
                  catIcon: catMeta.icon,
                  products: [],
                  stock: 0,
                  assetValue: 0,
                  isEmptyCategory: true,
                });
              });

              const rows = Array.from(rowMap.values()).sort((a, b) =>
                a.catName.localeCompare(b.catName, 'id', { sensitivity: 'base' })
              );
              const totalCategoryStock = rows.reduce((sum, r) => sum + (Number(r.stock) || 0), 0);
              const totalCategoryAsset = rows.reduce((sum, r) => sum + (Number(r.assetValue) || 0), 0);

              return (
                <div className="overflow-x-auto rounded-xl border border-zinc-800/80">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr
                        className={`font-bold uppercase text-[11px] border-b ${
                          isDark
                            ? 'bg-zinc-950/80 text-zinc-400 border-zinc-800'
                            : 'bg-slate-50 text-slate-600 border-slate-200'
                        }`}
                      >
                        <th className="py-3 px-4">Kategori</th>
                        <th className="py-3 px-4">Produk</th>
                        <th className="py-3 px-4 text-center">Stock</th>
                        <th className="py-3 px-4 text-right">Nilai Asset</th>
                        <th className="py-3 px-4 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y ${
                        isDark ? 'divide-zinc-800/70 text-zinc-200' : 'divide-slate-100 text-slate-800'
                      }`}
                    >
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-10 text-center text-xs text-zinc-500">
                            Belum ada data Kategori atau Produk. Klik <strong>+ Tambah Kategori</strong> atau tambahkan produk di <strong>/dashboard/produk</strong>.
                          </td>
                        </tr>
                      ) : (
                        rows.map((row) => (
                          <tr
                            key={row.rowKey}
                            className={`transition-colors ${
                              isDark ? 'hover:bg-zinc-800/40' : 'hover:bg-slate-50'
                            }`}
                          >
                            {/* 1. Kategori */}
                            <td className="py-3 px-4 font-bold">
                              <div className="flex items-center gap-2">
                                <span className="text-base">{row.catIcon}</span>
                                <span
                                  translate="no"
                                  data-no-translate="true"
                                  data-raw-value={row.catName}
                                  className={`notranslate ${isDark ? 'text-purple-300' : 'text-purple-700'}`}
                                >
                                  {row.catName}
                                </span>
                              </div>
                            </td>

                            {/* 2. Produk dalam kategori ini (digabung dalam 1 baris kategori) */}
                            <td className="py-3 px-4">
                              {row.products.length > 0 ? (
                                <div className="space-y-1.5">
                                  <div className={`text-[11px] font-semibold ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                                    {row.products.length} produk
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {row.products.map(({ group, stock, costPriceLabel }) => (
                                      <button
                                        key={group.id}
                                        type="button"
                                        translate="no"
                                        data-no-translate="true"
                                        data-raw-value={group.name}
                                        onClick={() => {
                                          setSearchTerm(group.name || '');
                                          setActiveTab('list');
                                        }}
                                        title={`${group.hasVariants ? `${group.variants?.length || 0} varian` : `SKU: ${group.sku || '-'}`} • Stock: ${stock} • Harga Modal: ${hideHpp ? 'Rahasia' : costPriceLabel}`}
                                        className={`notranslate px-2 py-0.5 rounded-lg border font-bold text-blue-400 hover:underline cursor-pointer text-left ${
                                          isDark ? 'border-zinc-700/70 bg-zinc-800/60' : 'border-slate-200 bg-slate-50'
                                        }`}
                                      >
                                        {group.name}
                                        <span className="ml-1 font-mono font-normal text-[10px] text-zinc-400">
                                          ({stock})
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-zinc-500 italic">Belum ada produk di kategori ini</span>
                              )}
                            </td>

                            {/* 3. Stock */}
                            <td
                              translate="no"
                              className="notranslate py-3 px-4 text-center font-mono font-bold"
                            >
                              <span
                                className={
                                  row.stock === 0
                                    ? 'text-rose-400'
                                    : row.stock <= 5
                                    ? 'text-amber-400'
                                    : 'text-emerald-400'
                                }
                              >
                                {row.stock} {tr('Carton', 'Karton')}
                              </span>
                            </td>

                            {/* 4. Nilai Asset (Harga Modal x Stock) */}
                            <td
                              translate="no"
                              className="notranslate py-3 px-4 text-right font-mono font-bold"
                            >
                              {hideHpp ? (
                                <span className="text-amber-400 text-[11px]">🔒 Rahasia</span>
                              ) : (
                                <div>
                                  <div className={isDark ? 'text-emerald-400' : 'text-emerald-600'}>
                                    {formatCurrency(row.assetValue)}
                                  </div>
                                  {row.products.length > 0 && (
                                    <div className="text-[10px] text-zinc-500 font-normal">
                                      Total {row.products.length} produk
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* 5. Aksi */}
                            <td className="py-3 px-4 text-right">
                              <div className="inline-flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSearchTerm(row.catName);
                                    setActiveTab('list');
                                  }}
                                  title="Lihat di /dashboard/produk"
                                  className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-600 text-zinc-300 hover:text-white transition cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingCategoryKey(row.catKey);
                                    setEditingCategoryOldName(row.catName);
                                    setNewCategoryName(row.catName);
                                    setNewCategoryIcon(row.catIcon);
                                    setIsAddCategoryModalOpen(true);
                                  }}
                                  title="Edit Kategori"
                                  className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-600 text-zinc-300 hover:text-white transition cursor-pointer"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleDeleteCategory(row.catKey, row.catName);
                                  }}
                                  title="Hapus Kategori"
                                  className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-600 text-zinc-300 hover:text-white transition cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {rows.length > 0 && (
                      <tfoot>
                        <tr
                          className={`font-bold text-xs border-t ${
                            isDark
                              ? 'bg-zinc-950/90 text-zinc-200 border-zinc-800'
                              : 'bg-slate-100 text-slate-800 border-slate-200'
                          }`}
                        >
                          <td colSpan={2} className="py-3 px-4 text-right uppercase text-[11px] text-zinc-400">
                            Total Keseluruhan Kategori
                          </td>
                          <td
                            translate="no"
                            className="notranslate py-3 px-4 text-center font-mono text-emerald-400"
                          >
                            {totalCategoryStock} {tr('Carton', 'Karton')}
                          </td>
                          <td
                            translate="no"
                            className="notranslate py-3 px-4 text-right font-mono text-emerald-400"
                          >
                            {hideHpp ? '🔒 Rahasia' : formatCurrency(totalCategoryAsset)}
                          </td>
                          <td className="py-3 px-4" />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              );
            })()}
          </div>

          {/* Section 2: Tabel Data Brand */}
          <div
            className={`rounded-2xl p-6 border shadow-sm space-y-4 transition-colors ${
              isDark ? 'bg-zinc-900/95 border-zinc-800 text-zinc-200' : 'bg-white border-slate-200 text-slate-800'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 border-zinc-800/40">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <Store className="w-5 h-5 text-blue-400" />
                  <span>Brand</span>
                </h3>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                  Tabel data Brand terhubung langsung ke katalog <span className="font-mono font-semibold">/dashboard/produk</span> (Nilai Asset = Harga Modal × Stock).
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSyncBrandsFromProducts}
                  disabled={isSyncingBrands}
                  title="Buat ulang brand yang dipakai produk tetapi belum ada di daftar brand"
                  className="px-3.5 py-1.5 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs shadow-sm transition cursor-pointer disabled:opacity-50"
                >
                  {isSyncingBrands ? 'Menyinkronkan...' : 'Sinkronkan dari Produk'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingBrandOldName(null);
                    setNewBrandName('');
                    setIsAddBrandModalOpen(true);
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-sm transition cursor-pointer"
                >
                  + Tambah Brand
                </button>
              </div>
            </div>

            {(() => {
              const brandMap = new Map<string, string>();
              brands.forEach((b) => {
                const clean = String(b || '').trim();
                if (clean) brandMap.set(clean.toLowerCase(), clean);
              });

              // Pastikan semua brand yang ada pada produk di /dashboard/produk juga terhubung
              products.forEach((p) => {
                const pBrand = String(p.brand || '').trim();
                if (pBrand && !brandMap.has(pBrand.toLowerCase())) {
                  brandMap.set(pBrand.toLowerCase(), pBrand);
                }
                (p.variants || []).forEach((v) => {
                  const vBrand = String(v.brand || '').trim();
                  if (vBrand && !brandMap.has(vBrand.toLowerCase())) {
                    brandMap.set(vBrand.toLowerCase(), vBrand);
                  }
                });
              });

              const allBrands = Array.from(brandMap.values());

              const calcProductAssetForBrand = (
                group: ProductGroupItem,
                brandLower: string
              ): { stock: number; costPriceLabel: string; assetValue: number } => {
                if (group.hasVariants && group.variants && group.variants.length > 0) {
                  const matchingVars = group.variants.filter(
                    (v) =>
                      (v.brand || group.brand || '').trim().toLowerCase() === brandLower
                  );
                  const targetVars = matchingVars.length > 0 ? matchingVars : group.variants;
                  const stock = targetVars.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
                  const assetValue = targetVars.reduce(
                    (sum, v) =>
                      sum +
                      (Number(v.costPrice ?? group.costPrice ?? 0) || 0) * (Number(v.stock) || 0),
                    0
                  );
                  const costPriceLabel =
                    group.costPriceRange ||
                    formatCurrency(Number(targetVars[0]?.costPrice ?? group.costPrice ?? 0));
                  return { stock, costPriceLabel, assetValue };
                }
                const stock = Number(group.totalStock ?? group.stockInUnits ?? 0) || 0;
                const cost = Number(group.costPrice ?? group.costPerUnit ?? 0) || 0;
                return {
                  stock,
                  costPriceLabel: formatCurrency(cost),
                  assetValue: cost * stock,
                };
              };

              type BrandTableRow = {
                rowKey: string;
                brandName: string;
                product: ProductGroupItem | null;
                stock: number;
                costPriceLabel: string;
                assetValue: number;
              };

              const rows: BrandTableRow[] = [];
              allBrands.forEach((brandName) => {
                const brandLower = brandName.trim().toLowerCase();
                const matchedProducts = products.filter(
                  (p) =>
                    (p.brand || '').trim().toLowerCase() === brandLower ||
                    (p.variants || []).some(
                      (v) => (v.brand || '').trim().toLowerCase() === brandLower
                    )
                );

                if (matchedProducts.length === 0) {
                  rows.push({
                    rowKey: `brand-empty-${brandName}`,
                    brandName,
                    product: null,
                    stock: 0,
                    costPriceLabel: formatCurrency(0),
                    assetValue: 0,
                  });
                } else {
                  matchedProducts.forEach((prod) => {
                    const { stock, costPriceLabel, assetValue } = calcProductAssetForBrand(
                      prod,
                      brandLower
                    );
                    rows.push({
                      rowKey: `brand-${brandName}-${prod.id}`,
                      brandName,
                      product: prod,
                      stock,
                      costPriceLabel,
                      assetValue,
                    });
                  });
                }
              });

              const totalBrandStock = rows.reduce((sum, r) => sum + r.stock, 0);
              const totalBrandAsset = rows.reduce((sum, r) => sum + r.assetValue, 0);

              return (
                <div className="overflow-x-auto rounded-xl border border-zinc-800/80">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr
                        className={`font-bold uppercase text-[11px] border-b ${
                          isDark
                            ? 'bg-zinc-950/80 text-zinc-400 border-zinc-800'
                            : 'bg-slate-50 text-slate-600 border-slate-200'
                        }`}
                      >
                        <th className="py-3 px-4">Brand</th>
                        <th className="py-3 px-4">Nama Produk</th>
                        <th className="py-3 px-4 text-center">Stock</th>
                        <th className="py-3 px-4 text-right">Nilai Asset</th>
                        <th className="py-3 px-4 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y ${
                        isDark ? 'divide-zinc-800/70 text-zinc-200' : 'divide-slate-100 text-slate-800'
                      }`}
                    >
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-10 text-center text-xs text-zinc-500">
                            Belum ada data Brand atau Produk. Klik <strong>+ Tambah Brand</strong> atau tambahkan produk di <strong>/dashboard/produk</strong>.
                          </td>
                        </tr>
                      ) : (
                        rows.map((row) => (
                          <tr
                            key={row.rowKey}
                            className={`transition-colors ${
                              isDark ? 'hover:bg-zinc-800/40' : 'hover:bg-slate-50'
                            }`}
                          >
                            {/* 1. Brand */}
                            <td className="py-3 px-4 font-bold">
                              <span
                                translate="no"
                                data-no-translate="true"
                                data-raw-value={row.brandName}
                                className={`notranslate ${isDark ? 'text-blue-300' : 'text-blue-700'}`}
                              >
                                {row.brandName}
                              </span>
                            </td>

                            {/* 2. Nama Produk */}
                            <td className="py-3 px-4">
                              {row.product ? (
                                <div>
                                  <button
                                    type="button"
                                    translate="no"
                                    data-no-translate="true"
                                    data-raw-value={row.product.name}
                                    onClick={() => {
                                      setSearchTerm(row.product?.name || '');
                                      setActiveTab('list');
                                    }}
                                    className="notranslate font-bold text-blue-400 hover:underline cursor-pointer text-left"
                                  >
                                    {row.product.name}
                                  </button>
                                  <div className="text-[11px] text-zinc-400 mt-0.5 flex flex-wrap items-center gap-2">
                                    {row.product.hasVariants ? (
                                      <span>{row.product.variants?.length || 0} varian</span>
                                    ) : (
                                      <span translate="no" className="notranslate font-mono">
                                        SKU: {row.product.sku}
                                      </span>
                                    )}
                                    <span>•</span>
                                    <span translate="no" className="notranslate font-mono">
                                      Harga Modal: {hideHpp ? '🔒 Rahasia' : row.costPriceLabel}
                                    </span>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-zinc-500 italic">Belum ada produk di brand ini</span>
                              )}
                            </td>

                            {/* 3. Stock */}
                            <td
                              translate="no"
                              className="notranslate py-3 px-4 text-center font-mono font-bold"
                            >
                              <span
                                className={
                                  row.stock === 0
                                    ? 'text-rose-400'
                                    : row.stock <= 5
                                    ? 'text-amber-400'
                                    : 'text-emerald-400'
                                }
                              >
                                {row.stock} {tr('Carton', 'Karton')}
                              </span>
                            </td>

                            {/* 4. Nilai Asset (Harga Modal x Stock) */}
                            <td
                              translate="no"
                              className="notranslate py-3 px-4 text-right font-mono font-bold"
                            >
                              {hideHpp ? (
                                <span className="text-amber-400 text-[11px]">🔒 Rahasia</span>
                              ) : (
                                <div>
                                  <div className={isDark ? 'text-emerald-400' : 'text-emerald-600'}>
                                    {formatCurrency(row.assetValue)}
                                  </div>
                                  {row.product && (
                                    <div className="text-[10px] text-zinc-500 font-normal">
                                      {row.costPriceLabel} × {row.stock}
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* 5. Aksi */}
                            <td className="py-3 px-4 text-right">
                              <div className="inline-flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSearchTerm(row.product ? row.product.name : row.brandName);
                                    setActiveTab('list');
                                  }}
                                  title="Lihat di /dashboard/produk"
                                  className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-600 text-zinc-300 hover:text-white transition cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingBrandOldName(row.brandName);
                                    setNewBrandName(row.brandName);
                                    setIsAddBrandModalOpen(true);
                                  }}
                                  title="Edit Brand"
                                  className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-600 text-zinc-300 hover:text-white transition cursor-pointer"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteBrand(row.brandName)}
                                  title="Hapus Brand"
                                  className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-600 text-zinc-300 hover:text-white transition cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {rows.length > 0 && (
                      <tfoot>
                        <tr
                          className={`font-bold text-xs border-t ${
                            isDark
                              ? 'bg-zinc-950/90 text-zinc-200 border-zinc-800'
                              : 'bg-slate-100 text-slate-800 border-slate-200'
                          }`}
                        >
                          <td colSpan={2} className="py-3 px-4 text-right uppercase text-[11px] text-zinc-400">
                            Total Keseluruhan Brand
                          </td>
                          <td
                            translate="no"
                            className="notranslate py-3 px-4 text-center font-mono text-emerald-400"
                          >
                            {totalBrandStock} {tr('Carton', 'Karton')}
                          </td>
                          <td
                            translate="no"
                            className="notranslate py-3 px-4 text-right font-mono text-emerald-400"
                          >
                            {hideHpp ? '🔒 Rahasia' : formatCurrency(totalBrandAsset)}
                          </td>
                          <td className="py-3 px-4" />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. TAB: HARGA DISKON (Matriks Diskon Grosir, PWA Member & Simulasi Margin) */}
      {/* ========================================================================= */}
      {/* ========================================================================= */}
      {/* 4. TAB: HARGA DISKON (Discount Pricing Directory & Add Form)              */}
      {/* ========================================================================= */}
      {activeTab === 'harga_diskon' && (
        <div className="space-y-6 animate-in fade-in">
          <DiscountPricingModule currencyMode={currencyMode} />
        </div>
      )}

      {/* ADDITIONAL SUB-PANELS (STOCK IN, STOCK OUT, AUDIT, MOVEMENT, LOW STOCK) */}
      {activeTab === 'masuk' && (
        <div
          className={`rounded-2xl p-6 border shadow-sm space-y-4 transition-colors ${
            isDark
              ? 'bg-zinc-900/95 border-zinc-800 text-zinc-200'
              : 'bg-white border-slate-200 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between border-b border-zinc-800/40 pb-3">
            <div>
              <h3 className="font-bold text-base flex items-center gap-2">
                <ArrowDownLeft className="w-5 h-5 text-emerald-500" />
                Stock In Records (Inbound Supply)
              </h3>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                Receipt history from distributors / suppliers and carton breakdown.
              </p>
            </div>
            <button
              onClick={() => setIsStockInModalOpen(true)}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-sm cursor-pointer"
            >
              + Record Stock In
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr
                  className={`font-bold uppercase text-[10px] border-b ${
                    isDark
                      ? 'bg-zinc-950/60 text-zinc-400 border-zinc-800'
                      : 'bg-slate-50 text-slate-500 border-slate-200'
                  }`}
                >
                  <th className="py-2.5 px-3">Delivery Order No.</th>
                  <th className="py-2.5 px-3">Date &amp; Time</th>
                  <th className="py-2.5 px-3">Product / Carton</th>
                  <th className="py-2.5 px-3">Quantity In</th>
                  <th className="py-2.5 px-3">Supplier / Distributor</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-zinc-800/80' : 'divide-slate-100'}`}>
                {stockInRecords.map((rec) => (
                  <tr key={rec.id}>
                    <td className="py-2.5 px-3 font-mono font-bold text-blue-500">{rec.id}</td>
                    <td className={`py-2.5 px-3 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                      {rec.date}
                    </td>
                    <td className={`py-2.5 px-3 font-semibold ${isDark ? 'text-zinc-100' : 'text-slate-800'}`}>
                      {rec.product}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-emerald-500">+{rec.qty} Cartons</td>
                    <td className={`py-2.5 px-3 ${isDark ? 'text-zinc-300' : 'text-slate-600'}`}>
                      {rec.supplier}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
                        {rec.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => setDetailMovement({ ...rec, type: 'MASUK' })}
                          title="Lihat Detail Barang Masuk"
                          className="p-1 rounded-lg bg-zinc-800 hover:bg-blue-600 text-zinc-300 hover:text-white transition cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMovement(rec);
                            setStockInForm({
                              productName: rec.product,
                              qty: rec.qty,
                              supplier: rec.supplier,
                            });
                            setIsStockInModalOpen(true);
                          }}
                          title="Edit Barang Masuk"
                          className="p-1 rounded-lg bg-zinc-800 hover:bg-amber-600 text-zinc-300 hover:text-white transition cursor-pointer"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMovement(rec.id)}
                          title="Hapus Barang Masuk"
                          className="p-1 rounded-lg bg-zinc-800 hover:bg-rose-600 text-zinc-300 hover:text-white transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'keluar' && (
        <div
          className={`rounded-2xl p-6 border shadow-sm space-y-4 transition-colors ${
            isDark
              ? 'bg-zinc-900/95 border-zinc-800 text-zinc-200'
              : 'bg-white border-slate-200 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between border-b border-zinc-800/40 pb-3">
            <div>
              <h3 className="font-bold text-base flex items-center gap-2">
                <ArrowUpRight className="w-5 h-5 text-amber-500" />
                Stock Out Records (Outbound &amp; Dispensed)
              </h3>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                Logs of store carton dispatches, wholesale sales, and damaged units written off.
              </p>
            </div>
            <button
              onClick={() => {
                setEditingMovement(null);
                setIsStockOutModalOpen(true);
              }}
              className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-sm cursor-pointer"
            >
              + Record Stock Out
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr
                  className={`font-bold uppercase text-[10px] border-b ${
                    isDark
                      ? 'bg-zinc-950/60 text-zinc-400 border-zinc-800'
                      : 'bg-slate-50 text-slate-500 border-slate-200'
                  }`}
                >
                  <th className="py-2.5 px-3">Dispatch Code</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Product Item</th>
                  <th className="py-2.5 px-3">Quantity Out</th>
                  <th className="py-2.5 px-3">Destination / Reason</th>
                  <th className="py-2.5 px-3">Auditor</th>
                  <th className="py-2.5 px-3 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-zinc-800/80' : 'divide-slate-100'}`}>
                {stockOutRecords.map((rec) => (
                  <tr key={rec.id}>
                    <td className="py-2.5 px-3 font-mono font-bold text-amber-500">{rec.id}</td>
                    <td className={`py-2.5 px-3 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>{rec.date}</td>
                    <td className={`py-2.5 px-3 font-semibold ${isDark ? 'text-zinc-100' : 'text-slate-800'}`}>{rec.product}</td>
                    <td className="py-2.5 px-3 font-bold text-amber-500">-{rec.qty} Units</td>
                    <td className={`py-2.5 px-3 ${isDark ? 'text-zinc-300' : 'text-slate-600'}`}>{rec.dest}</td>
                    <td className="py-2.5 px-3">Petugas Gudang</td>
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => setDetailMovement({ ...rec, type: 'KELUAR' })}
                          title="Lihat Detail Barang Keluar"
                          className="p-1 rounded-lg bg-zinc-800 hover:bg-blue-600 text-zinc-300 hover:text-white transition cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMovement(rec);
                            setStockOutForm({
                              productName: rec.product,
                              qty: rec.qty,
                              dest: rec.dest,
                            });
                            setIsStockOutModalOpen(true);
                          }}
                          title="Edit Barang Keluar"
                          className="p-1 rounded-lg bg-zinc-800 hover:bg-amber-600 text-zinc-300 hover:text-white transition cursor-pointer"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMovement(rec.id)}
                          title="Hapus Barang Keluar"
                          className="p-1 rounded-lg bg-zinc-800 hover:bg-rose-600 text-zinc-300 hover:text-white transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'opname' && (
        <div
          className={`rounded-2xl p-6 border shadow-sm space-y-4 transition-colors ${
            isDark
              ? 'bg-zinc-900/95 border-zinc-800 text-zinc-200'
              : 'bg-white border-slate-200 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between border-b border-zinc-800/40 pb-3">
            <div>
              <h3 className="font-bold text-base flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-blue-500" />
                Physical Stock Audit & Opname
              </h3>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                System vs physical warehouse count reconciliation to prevent inventory shrinkage.
              </p>
            </div>
            <button
              onClick={() => showToast('New Stock Audit Session Started')}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-sm cursor-pointer"
            >
              + Start Stock Audit
            </button>
          </div>

          <div
            className={`p-4 rounded-xl border text-xs space-y-1 ${
              isDark
                ? 'bg-blue-950/30 border-blue-800/50 text-blue-200'
                : 'bg-blue-50/80 border-blue-100 text-blue-900'
            }`}
          >
            <div className="font-bold flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              Last Audit Status:
            </div>
            <p className={isDark ? 'text-blue-300' : 'text-blue-800'}>
              {totalCount === 0
                ? '0 produk di katalog database. Tambahkan produk terlebih dahulu untuk memulai Stok Opname.'
                : `Total ${totalCount} produk terdaftar di katalog database siap untuk rekonsiliasi fisik.`}
            </p>
          </div>
        </div>
      )}

      {activeTab === 'pergerakan' && (
        <div
          className={`rounded-2xl p-6 border shadow-sm space-y-4 transition-colors ${
            isDark
              ? 'bg-zinc-900/95 border-zinc-800 text-zinc-200'
              : 'bg-white border-slate-200 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between border-b border-zinc-800/40 pb-3">
            <div>
              <h3 className="font-bold text-base flex items-center gap-2">
                <Activity className="w-5 h-5 text-indigo-500" />
                Real-Time Stock Movement Log
              </h3>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                Comprehensive ledger of every carton and bottle moving in and out of the warehouse.
              </p>
            </div>
          </div>

          <div className="space-y-2 text-xs">
            {products.length === 0 ? (
              <div className="py-8 text-center text-zinc-500 border border-dashed border-zinc-800 rounded-xl">
                Belum ada riwayat pergerakan stok produk (0 data).
              </div>
            ) : (
              products.map((p, idx) => (
                <div
                  key={`mov-${p.id}-${idx}`}
                  className={`p-3 rounded-xl border flex items-center justify-between ${
                    isDark ? 'bg-zinc-950/60 border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div>
                    <span className="font-bold text-blue-400">{p.name}</span>
                    <div className={`text-[11px] mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                      Stock Balance: {p.totalStock} Units &bull; SKU: {p.sku || p.id}
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">
                    Active
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'kritis' && (
        <div
          className={`rounded-2xl p-6 border shadow-sm space-y-4 transition-colors ${
            isDark
              ? 'bg-zinc-900/95 border-zinc-800 text-zinc-200'
              : 'bg-white border-slate-200 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between border-b border-zinc-800/40 pb-3">
            <div>
              <h3 className="font-bold text-rose-500 text-base flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                Critical &amp; Out of Stock List (Restock Recommended)
              </h3>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                Products below minimum threshold (5 units / cartons) at risk of missed POS and PWA sales.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {products.filter((p) => p.totalStock <= 5).length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-xl">
                0 produk dengan stok kritis.
              </div>
            ) : (
              products
                .filter((p) => p.totalStock <= 5)
                .map((p, idx) => (
                  <div
                    key={`crit-${p.id}-${idx}`}
                    className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
                      isDark
                        ? 'border-rose-900/60 bg-rose-950/30'
                        : 'border-rose-200 bg-rose-50/50'
                    }`}
                  >
                    <div>
                      <span className="font-bold text-rose-400">
                        {p.name} (SKU: {p.sku || p.id})
                      </span>
                      <div className="text-[11px] text-rose-300 mt-0.5">
                        Current Stock: {p.totalStock} Units
                      </div>
                    </div>
                    <button
                      onClick={() => handleDispatchRestock(p.name, 20)}
                      className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold transition shadow-xs cursor-pointer"
                    >
                      + Order 20 Units
                    </button>
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {/* MODAL: ADD NEW PRODUCT */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div
            className={`w-full max-w-lg rounded-2xl border p-6 shadow-2xl space-y-4 text-xs ${
              isDark
                ? 'bg-zinc-900 border-zinc-800 text-zinc-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div
              className={`flex items-center justify-between border-b pb-3 ${
                isDark ? 'border-zinc-800' : 'border-slate-100'
              }`}
            >
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <Package className="w-4 h-4 text-blue-500" />
                  Add New Product
                </h3>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                  Product details will automatically synchronize with POS Terminal and Client PWA.
                </p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className={`p-1 rounded-lg transition cursor-pointer ${
                  isDark
                    ? 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                    : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                    Product Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Aqua Carton 330ml"
                    value={newProductForm.name}
                    onChange={(e) => setNewProductForm({ ...newProductForm, name: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border transition focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500'
                        : 'border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:bg-white'
                    }`}
                  />
                </div>

                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                    SKU Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={newProductForm.sku}
                    onChange={(e) => setNewProductForm({ ...newProductForm, sku: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border font-mono transition focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-950 text-zinc-100'
                        : 'border-slate-200 bg-slate-50 text-slate-800 focus:bg-white'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                    Category
                  </label>
                  <select
                    value={newProductForm.category}
                    onChange={(e) => setNewProductForm({ ...newProductForm, category: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border transition focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-950 text-zinc-100'
                        : 'border-slate-200 bg-slate-50 text-slate-800 focus:bg-white'
                    }`}
                  >
                    <option value="">-- Pilih Kategori --</option>
                    {customCategories.map((c, idx) => (
                      <option key={`new-cat-${c.key}-${idx}`} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                    Brand / Manufacturer
                  </label>
                  <input
                    type="text"
                    placeholder="Brand Name"
                    value={newProductForm.brand}
                    onChange={(e) => setNewProductForm({ ...newProductForm, brand: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border transition focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500'
                        : 'border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:bg-white'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                    Cost Price (Rp)
                  </label>
                  <input
                    type="number"
                    value={newProductForm.costPrice}
                    onChange={(e) => setNewProductForm({ ...newProductForm, costPrice: Number(e.target.value) })}
                    className={`w-full px-3 py-2 rounded-lg border font-mono transition focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-950 text-zinc-100'
                        : 'border-slate-200 bg-slate-50 text-slate-800 focus:bg-white'
                    }`}
                  />
                </div>

                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                    Standard Selling Price (Rp)
                  </label>
                  <input
                    type="number"
                    value={newProductForm.sellPrice}
                    onChange={(e) =>
                      setNewProductForm({
                        ...newProductForm,
                        sellPrice: Number(e.target.value),
                        posPrice: Number(e.target.value),
                        pwaPrice: Number(e.target.value),
                      })
                    }
                    className={`w-full px-3 py-2 rounded-lg border font-mono transition focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-950 text-zinc-100'
                        : 'border-slate-200 bg-slate-50 text-slate-800 focus:bg-white'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                    POS Cashier Price (Rp)
                  </label>
                  <input
                    type="number"
                    value={newProductForm.posPrice}
                    onChange={(e) => setNewProductForm({ ...newProductForm, posPrice: Number(e.target.value) })}
                    className={`w-full px-3 py-2 rounded-lg border font-mono transition focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-950 text-zinc-100'
                        : 'border-slate-200 bg-slate-50 text-slate-800 focus:bg-white'
                    }`}
                  />
                </div>

                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                    PWA Online Price (Rp)
                  </label>
                  <input
                    type="number"
                    value={newProductForm.pwaPrice}
                    onChange={(e) => setNewProductForm({ ...newProductForm, pwaPrice: Number(e.target.value) })}
                    className={`w-full px-3 py-2 rounded-lg border font-mono transition focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-950 text-zinc-100'
                        : 'border-slate-200 bg-slate-50 text-slate-800 focus:bg-white'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                    Initial Stock
                  </label>
                  <input
                    type="number"
                    value={newProductForm.stock}
                    onChange={(e) => setNewProductForm({ ...newProductForm, stock: Number(e.target.value) })}
                    className={`w-full px-3 py-2 rounded-lg border font-mono transition focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-950 text-zinc-100'
                        : 'border-slate-200 bg-slate-50 text-slate-800 focus:bg-white'
                    }`}
                  />
                </div>

                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                    Isi 1 Dus
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={newProductForm.itemsPerCarton}
                    onChange={(e) => setNewProductForm({ ...newProductForm, itemsPerCarton: Math.max(1, Number(e.target.value) || 1) })}
                    className={`w-full px-3 py-2 rounded-lg border font-mono transition focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-950 text-zinc-100'
                        : 'border-slate-200 bg-slate-50 text-slate-800 focus:bg-white'
                    }`}
                  />
                </div>

                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                    Berat/Item (ml)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={newProductForm.weightMl}
                    onChange={(e) => setNewProductForm({ ...newProductForm, weightMl: Math.max(0, Number(e.target.value) || 0) })}
                    className={`w-full px-3 py-2 rounded-lg border font-mono transition focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-950 text-zinc-100'
                        : 'border-slate-200 bg-slate-50 text-slate-800 focus:bg-white'
                    }`}
                  />
                </div>
              </div>

              <div className={`flex flex-wrap items-center justify-between gap-2 pt-2 border-t ${isDark ? 'border-zinc-800' : 'border-slate-100'}`}>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className={`px-4 py-2 rounded-xl font-semibold cursor-pointer ${
                    isDark
                      ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  Cancel
                </button>
                <div className="flex items-center gap-3">
                  <div className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 ${isDark ? 'bg-zinc-950 border-zinc-800 text-zinc-200' : 'bg-slate-50 border-slate-200 text-slate-800'}`}>
                    <span>Total Berat ( kg ) :</span>
                    <span className="font-mono text-blue-400">
                      {Number((((Number(newProductForm.weightMl) || 0) * Math.max(1, Number(newProductForm.itemsPerCarton) || 1)) / 1000).toFixed(3))} kg
                    </span>
                  </div>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-md shadow-blue-500/20 cursor-pointer"
                  >
                    Simpan Produk
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Full-page Edit Product view is rendered above via AddProductForm when editingGroup is active */}

      {/* ========================================================================= */}
      {/* MODAL: STOCK ADJUSTMENT (PENYESUAIAN STOK FISIK)                          */}
      {/* ========================================================================= */}
      {adjustingStockGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl space-y-4 text-xs ${
              isDark
                ? 'bg-zinc-900 border-zinc-800 text-zinc-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div
              className={`flex items-center justify-between border-b pb-3 ${
                isDark ? 'border-zinc-800' : 'border-slate-100'
              }`}
            >
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <Package className="w-5 h-5 text-blue-500" />
                  <span>Penyesuaian Stok Fisik</span>
                </h3>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                  {adjustingStockGroup.name}
                </p>
              </div>
              <button
                onClick={() => {
                  setAdjustingStockGroup(null);
                  if (route.productEntityId) navigateToPath('/produk');
                }}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800 flex items-center justify-between">
                <span className="text-zinc-400">Stok Sistem Saat Ini (Karton):</span>
                <span className="font-mono font-bold text-base text-emerald-400">
                  {adjustingStockGroup.totalStock} Karton
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                  Alasan Penyesuaian Stok *
                </label>
                <input
                  type="text"
                  value={stockAdjustReason}
                  onChange={(e) => setStockAdjustReason(e.target.value)}
                  placeholder="Contoh: Stok Opname Fisik, Barang Rusak, Koreksi Kasir"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-white text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-300 mb-1.5">
                  Pilih Cepat Penyesuaian (+/−)
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[-10, -5, 5, 10].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => {
                        handleSaveStockAdjustment(delta, stockAdjustReason);
                      }}
                      className={`py-2 rounded-xl font-mono font-bold cursor-pointer transition ${
                        delta > 0
                          ? 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white border border-emerald-500/30'
                          : 'bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white border border-rose-500/30'
                      }`}
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                  Atau Masukkan Perubahan Jumlah (Delta)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={stockAdjustQty}
                    onChange={(e) => setStockAdjustQty(Number(e.target.value))}
                    placeholder="Contoh: 15 atau -5"
                    className="flex-1 px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      handleSaveStockAdjustment(stockAdjustQty, stockAdjustReason);
                    }}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold cursor-pointer"
                  >
                    Terapkan
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: BUAT PAKET DUS BARU                                                */}
      {/* ========================================================================= */}
      {isPackageModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div
            className={`w-full max-w-lg rounded-2xl border p-6 shadow-2xl space-y-4 text-xs ${
              isDark ? 'bg-zinc-900 border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className={`flex items-center justify-between border-b pb-3 ${isDark ? 'border-zinc-800' : 'border-slate-100'}`}>
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <Layers className="w-5 h-5 text-amber-500" />
                  <span>Buat Paket Dus Baru</span>
                </h3>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                  Atur rasio isi per karton dan harga jual grosir paket produk.
                </p>
              </div>
              <button
                onClick={() => setIsPackageModalOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePackage} className="space-y-4">
              <div>
                <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                  Pilih Produk *
                </label>
                <select
                  required
                  value={selectedPackageSku}
                  onChange={(e) => {
                    const sku = e.target.value;
                    setSelectedPackageSku(sku);
                    const found = products.find(
                      (p) => p.sku === sku || p.id === sku || (p.variants && p.variants.some((v) => v.sku === sku))
                    );
                    if (found) {
                      const v = found.variants?.find((item) => item.sku === sku);
                      setPackagePiecesPerCarton(v?.itemsPerCarton || found.itemsPerCarton || 24);
                      setPackagePricePerCarton(found.sellPrice || 0);
                    }
                  }}
                  className={`w-full px-3 py-2 rounded-lg border font-semibold transition focus:outline-none focus:ring-1 focus:ring-amber-500 ${
                    isDark ? 'border-zinc-700 bg-zinc-950 text-zinc-100' : 'border-slate-200 bg-slate-50 text-slate-800'
                  }`}
                >
                  <option value="">-- Pilih Produk dari Katalog --</option>
                  {products.flatMap((p) =>
                    p.hasVariants && p.variants
                      ? p.variants.map((v) => (
                          <option key={v.sku} value={v.sku}>
                            [{v.sku}] {v.name}
                          </option>
                        ))
                      : [
                          <option key={p.sku || p.id} value={p.sku || p.id}>
                            [{p.sku || p.id}] {p.name}
                          </option>,
                        ]
                  )}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                    Isi Satuan per Dus (Pieces) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={packagePiecesPerCarton}
                    onChange={(e) => setPackagePiecesPerCarton(Math.max(1, Number(e.target.value)))}
                    className={`w-full px-3 py-2 rounded-lg border font-mono font-bold transition focus:outline-none focus:ring-1 focus:ring-amber-500 ${
                      isDark ? 'border-zinc-700 bg-zinc-950 text-zinc-100' : 'border-slate-200 bg-slate-50 text-slate-800'
                    }`}
                  />
                  <span className="text-[10px] text-zinc-400 mt-0.5 block">Contoh: 12, 24, 40 pcs/dus</span>
                </div>

                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                    Harga Jual per Dus / Karton (Rp) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={packagePricePerCarton}
                    onChange={(e) => setPackagePricePerCarton(Math.max(0, Number(e.target.value)))}
                    className={`w-full px-3 py-2 rounded-lg border font-mono font-bold text-amber-400 transition focus:outline-none focus:ring-1 focus:ring-amber-500 ${
                      isDark ? 'border-zinc-700 bg-zinc-950' : 'border-slate-200 bg-slate-50'
                    }`}
                  />
                  <span className="text-[10px] text-zinc-400 mt-0.5 block">Harga grosir 1 dus utuh</span>
                </div>
              </div>

              <div className={`flex items-center justify-end gap-2 pt-4 border-t ${isDark ? 'border-zinc-800' : 'border-slate-100'}`}>
                <button
                  type="button"
                  onClick={() => setIsPackageModalOpen(false)}
                  className={`px-4 py-2 rounded-xl font-semibold cursor-pointer ${
                    isDark ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold shadow-md shadow-amber-500/20 cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>Simpan Paket Dus</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: TAMBAH / EDIT KATEGORI PRODUK                                      */}
      {/* ========================================================================= */}
      {isAddCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl space-y-4 text-xs ${
              isDark ? 'bg-zinc-900 border-zinc-800 text-zinc-100' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className={`flex items-center justify-between border-b pb-3 ${isDark ? 'border-zinc-800' : 'border-slate-100'}`}>
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <Tag className="w-5 h-5 text-purple-400" />
                  <span>{editingCategoryKey || editingCategoryOldName ? 'Edit Kategori Produk' : 'Tambah Kategori Produk'}</span>
                </h3>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                  {editingCategoryKey || editingCategoryOldName
                    ? 'Perubahan nama kategori akan otomatis diperbarui ke seluruh produk terkait di /dashboard/produk.'
                    : 'Tambahkan kategori baru yang otomatis tersimpan ke Firestore `categories`.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAddCategoryModalOpen(false);
                  setEditingCategoryKey(null);
                  setEditingCategoryOldName(null);
                }}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCategory} className="space-y-4">
              <div>
                <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                  Nama Kategori *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Contoh: Frozen Food, Roti & Kue, Rokok"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border font-semibold transition focus:outline-none focus:ring-1 focus:ring-purple-500 ${
                    isDark ? 'border-zinc-700 bg-zinc-950 text-zinc-100' : 'border-slate-200 bg-slate-50 text-slate-800'
                  }`}
                />
              </div>

              <div>
                <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                  Ikon Emoji
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newCategoryIcon}
                    onChange={(e) => setNewCategoryIcon(e.target.value)}
                    className={`w-16 text-center text-xl px-2 py-1.5 rounded-lg border transition ${
                      isDark ? 'border-zinc-700 bg-zinc-950 text-white' : 'border-slate-200 bg-slate-50 text-slate-800'
                    }`}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {['🧊', '🥐', '🍫', '🍹', '🧴', '🧼', '📦', '🥫', '🍚', '🍞'].map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => setNewCategoryIcon(emoji)}
                        className={`w-8 h-8 rounded-lg border text-sm flex items-center justify-center transition cursor-pointer ${
                          newCategoryIcon === emoji
                            ? 'border-purple-500 bg-purple-500/20'
                            : 'border-zinc-800 hover:bg-zinc-800'
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className={`flex items-center justify-end gap-2 pt-4 border-t ${isDark ? 'border-zinc-800' : 'border-slate-100'}`}>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddCategoryModalOpen(false);
                    setEditingCategoryKey(null);
                    setEditingCategoryOldName(null);
                  }}
                  className={`px-4 py-2 rounded-xl font-semibold cursor-pointer ${
                    isDark ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSavingCategory}
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold shadow-md shadow-purple-500/20 cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>{isSavingCategory ? 'Menyimpan...' : 'Simpan Kategori'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: RECORD STOCK IN (INBOUND SUPPLY)                                   */}
      {/* ========================================================================= */}
      {isStockInModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div
            className={`w-full max-w-lg rounded-2xl border p-6 shadow-2xl space-y-4 text-xs ${
              isDark
                ? 'bg-zinc-900 border-zinc-800 text-zinc-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div
              className={`flex items-center justify-between border-b pb-3 ${
                isDark ? 'border-zinc-800' : 'border-slate-100'
              }`}
            >
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <ArrowDownLeft className="w-5 h-5 text-emerald-400" />
                  <span>Penerimaan Barang Masuk (Stock In)</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Catat pengiriman dus dari distributor dan tambah stok gudang secara otomatis.
                </p>
              </div>
              <button
                onClick={() => setIsStockInModalOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRecordStockIn} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                  Pilih Produk Masuk *
                </label>
                <select
                  value={stockInForm.productName}
                  onChange={(e) => setStockInForm({ ...stockInForm, productName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-white"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name} (Stok: {p.totalStock} Karton)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                    Jumlah Karton / Dus Masuk *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={stockInForm.qty}
                    onChange={(e) => setStockInForm({ ...stockInForm, qty: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-white font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                    Pemasok / Distributor *
                  </label>
                  <input
                    type="text"
                    required
                    value={stockInForm.supplier}
                    onChange={(e) => setStockInForm({ ...stockInForm, supplier: e.target.value })}
                    placeholder="e.g. PT Tirta Distribusi Jaya"
                    className="w-full px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-white"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsStockInModalOpen(false)}
                  className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
                >
                  Simpan Barang Masuk
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: RECORD STOCK OUT (OUTBOUND DISPATCH)                               */}
      {/* ========================================================================= */}
      {isStockOutModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div
            className={`w-full max-w-lg rounded-2xl border p-6 shadow-2xl space-y-4 text-xs ${
              isDark
                ? 'bg-zinc-900 border-zinc-800 text-zinc-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div
              className={`flex items-center justify-between border-b pb-3 ${
                isDark ? 'border-zinc-800' : 'border-slate-100'
              }`}
            >
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <ArrowUpRight className="w-5 h-5 text-amber-400" />
                  <span>Pengeluaran Stok (Stock Out)</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Catat pengeluaran stok untuk kasir POS, order grosir, atau retur barang.
                </p>
              </div>
              <button
                onClick={() => setIsStockOutModalOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRecordStockOut} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                  Pilih Produk Dikeluarkan *
                </label>
                <select
                  value={stockOutForm.productName}
                  onChange={(e) => setStockOutForm({ ...stockOutForm, productName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-white"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name} (Stok: {p.totalStock} Karton)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                    Jumlah Unit / Dus Keluar *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={stockOutForm.qty}
                    onChange={(e) => setStockOutForm({ ...stockOutForm, qty: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-white font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                    Tujuan Pengeluaran *
                  </label>
                  <select
                    value={stockOutForm.dest}
                    onChange={(e) => setStockOutForm({ ...stockOutForm, dest: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-white"
                  >
                    <option value="Store POS Sales">Store POS Sales</option>
                    <option value="PWA Client Wholesale">PWA Client Wholesale</option>
                    <option value="Transfer Antar Gudang">Transfer Antar Gudang</option>
                    <option value="Barang Rusak / Kadaluarsa">Barang Rusak / Kadaluarsa</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsStockOutModalOpen(false)}
                  className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold cursor-pointer"
                >
                  Simpan Pengeluaran
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: LIHAT DETAIL PRODUK */}
      {detailGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl space-y-4 text-xs text-zinc-100">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">{detailGroup.name}</h3>
                <span className="font-mono text-zinc-400 text-[11px]">{detailGroup.sku || detailGroup.id}</span>
              </div>
              <button onClick={() => setDetailGroup(null)} className="p-1 text-zinc-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Kategori:</span>
                <span className="font-bold text-white">{detailGroup.category}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Brand / Produsen:</span>
                <span className="font-bold text-blue-400">{detailGroup.brand || '-'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Harga Modal 1 Karton:</span>
                <span className="font-mono font-bold text-zinc-300">
                  {detailGroup.costPrice ? formatCurrency(detailGroup.costPrice) : detailGroup.costPriceRange || '-'}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Harga Jual 1 Produk (POS):</span>
                <span className="font-mono font-bold text-emerald-400">
                  {detailGroup.posPrice ? formatCurrency(detailGroup.posPrice) : detailGroup.sellPriceRange || '-'}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Harga Jual PWA:</span>
                <span className="font-mono font-bold text-cyan-400">
                  {detailGroup.pwaPrice ? formatCurrency(detailGroup.pwaPrice) : detailGroup.sellPriceRange || '-'}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Total Stok (Jumlah Karton):</span>
                <span className="font-mono font-bold text-white">
                  {detailGroup.totalStock} Karton ({detailGroup.totalStock * (detailGroup.itemsPerCarton || 1)} Item)
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Produk (Qty):</span>
                <span className="font-mono font-bold text-amber-400">{detailGroup.itemsPerCarton || 1} Qty</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Total Berat ( kg ):</span>
                <span className="font-mono font-bold text-blue-400">
                  {detailGroup.totalBeratKg !== undefined
                    ? detailGroup.totalBeratKg
                    : Number(
                        (
                          ((detailGroup.weightMl || 0) * (detailGroup.itemsPerCarton || 1)) /
                          1000
                        ).toFixed(3)
                      )}{' '}
                  kg
                </span>
              </div>
            </div>
            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const grp = detailGroup;
                  setDetailGroup(null);
                  openEditModalForGroup(grp);
                }}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold cursor-pointer"
              >
                Edit Produk
              </button>
              <button
                type="button"
                onClick={() => setDetailGroup(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: TAMBAH / EDIT BRAND */}
      {isAddBrandModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl space-y-4 text-xs text-zinc-100">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-white">
                {editingBrandOldName ? 'Edit Brand / Produsen' : 'Tambah Brand Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setIsAddBrandModalOpen(false)}
                className="p-1 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveBrand} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-zinc-300 mb-1">Nama Brand / Merek *</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newBrandName}
                  onChange={(e) => setNewBrandName(e.target.value)}
                  placeholder="Contoh: Unilever Indonesia, Mayora, Wings"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  disabled={isSavingBrand}
                  onClick={() => setIsAddBrandModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold cursor-pointer disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSavingBrand}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  {isSavingBrand ? 'Menyimpan...' : 'Simpan Brand'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DETAIL STOCK MOVEMENT */}
      {detailMovement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl space-y-4 text-xs text-zinc-100">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-white">Detail Mutasi Stok ({detailMovement.type})</h3>
              <button onClick={() => setDetailMovement(null)} className="p-1 text-zinc-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Kode Dokumen:</span>
                <span className="font-mono font-bold text-blue-400">{detailMovement.id}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Waktu:</span>
                <span className="text-zinc-300">{detailMovement.date}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Produk:</span>
                <span className="font-bold text-white">{detailMovement.product}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Jumlah Kuantitas:</span>
                <span className="font-mono font-bold text-emerald-400">{detailMovement.qty} Unit / Karton</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Keterangan / Mitra:</span>
                <span className="text-zinc-300">{detailMovement.supplier || detailMovement.dest || '-'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Status:</span>
                <span className="font-bold text-emerald-400">{detailMovement.status}</span>
              </div>
            </div>
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setDetailMovement(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
