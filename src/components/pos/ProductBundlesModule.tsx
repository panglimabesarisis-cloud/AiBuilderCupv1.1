import React, { useState, useEffect, useMemo } from 'react';
import {
  Package,
  Plus,
  RefreshCw,
  Search,
  Calendar,
  Trash2,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertCircle,
  TrendingUp,
  Percent,
  Tag,
  DollarSign,
  Clock,
  Layers,
  ChevronRight,
  MoreVertical,
  Edit2,
  Power,
  Sparkles,
  Eye,
  X,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { ACTIVE_STORE_ID } from '../../config/store';
import { ProductBundle, BundleItem, Product } from '../../types';
import { useAppNavigation, AppLink } from '../../router';

interface ProductBundlesModuleProps {
  onBackToDirectory?: () => void;
  currencyMode?: 'IDR' | 'USD';
}

export const ProductBundlesModule: React.FC<ProductBundlesModuleProps> = ({
  currencyMode = 'IDR',
}) => {
  const { route, navigateToPath } = useAppNavigation();
  // Navigation view: 'directory' | 'add_bundle' derived from URL
  const view = route.bundleView;
  const setView = (nextView: 'directory' | 'add_bundle') => {
    navigateToPath(nextView === 'add_bundle' ? '/paket-produk/tambah' : '/paket-produk');
  };
  const [editingBundleId, setEditingBundleId] = useState<string | null>(route.bundleEditId || null);

  // Firestore bundles state
  const [bundles, setBundles] = useState<ProductBundle[]>([]);
  const [detailBundle, setDetailBundle] = useState<ProductBundle | null>(null);
  const [loadingBundles, setLoadingBundles] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Available products from Firestore collection 'stores/store_001/products' (with root 'products' fallback)
  const [productsList, setProductsList] = useState<Product[]>([]);

  // Directory filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [createdFromDate, setCreatedFromDate] = useState<string>('');
  const [createdToDate, setCreatedToDate] = useState<string>('');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Toast notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('success');

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Format currency helper
  const formatRupiah = (val: number) => {
    if (currencyMode === 'USD') {
      const usdVal = val / 15800;
      return `$${usdVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `Rp ${Math.round(val).toLocaleString('id-ID')}`;
  };

  // 1. Subscribe to bundles in Firestore ('stores/store_001/bundles')
  useEffect(() => {
    setLoadingBundles(true);
    const bundlesColRef = collection(db, 'stores', ACTIVE_STORE_ID, 'bundles');
    const unsub = onSnapshot(
      bundlesColRef,
      (snapshot) => {
        const fetched: ProductBundle[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          fetched.push({
            id: docSnap.id,
            storeId: data.storeId || ACTIVE_STORE_ID,
            bundleCode: data.bundleCode || `BUNDLE-${docSnap.id.substring(0, 4).toUpperCase()}`,
            name: data.name || 'Unnamed Bundle',
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
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
            updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : data.updatedAt,
          });
        });

        // Sort by createdAt descending
        fetched.sort((a, b) => {
          const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tB - tA;
        });

        setBundles(fetched);
        setLoadingBundles(false);
      },
      (error) => {
        console.warn('[ProductBundlesModule] Firestore bundles listener error:', error);
        setLoadingBundles(false);
      }
    );

    return () => unsub();
  }, []);

  // 2. Subscribe to live products list from Firestore 'products' collection
  useEffect(() => {
    const rootProductsRef = collection(db, 'products');
    const unsubRoot = onSnapshot(
      rootProductsRef,
      (rootSnap) => {
        const rootList: Product[] = [];
        rootSnap.forEach((d) => {
          const data = d.data();
          rootList.push({
            id: d.id,
            storeId: data.storeId || ACTIVE_STORE_ID,
            name: data.name || '',
            sku: data.sku || data.barcode || d.id,
            category: data.category || 'General',
            barcode: data.barcode || '',
            piecesPerCarton: data.piecesPerCarton || 1,
            stockInUnits: data.stockInUnits ?? data.stock ?? 0,
            costPerUnit: data.costPerUnit ?? data.costPrice ?? 0,
            pricePerUnit: data.pricePerUnit ?? data.price ?? data.sellPrice ?? 0,
            pricePerCarton: data.pricePerCarton ?? 0,
            minStockAlert: data.minStockAlert ?? 5,
            isActive: data.isActive !== false,
          });
        });
        setProductsList(rootList);
      },
      (error) => {
        console.warn('[ProductBundlesModule] Products listener error:', error);
      }
    );

    return () => unsubRoot();
  }, []);

  // Filtered bundles
  const filteredBundles = useMemo(() => {
    return bundles.filter((bundle) => {
      // Search by bundle name or bundle code
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchName = bundle.name.toLowerCase().includes(query);
        const matchCode = bundle.bundleCode.toLowerCase().includes(query);
        if (!matchName && !matchCode) return false;
      }

      // Date range filter based on bundle.createdAt or startDate
      if (createdFromDate) {
        const itemDate = bundle.createdAt
          ? bundle.createdAt.substring(0, 10)
          : bundle.startDate || '';
        if (itemDate && itemDate < createdFromDate) return false;
      }

      if (createdToDate) {
        const itemDate = bundle.createdAt
          ? bundle.createdAt.substring(0, 10)
          : bundle.startDate || '';
        if (itemDate && itemDate > createdToDate) return false;
      }

      return true;
    });
  }, [bundles, searchQuery, createdFromDate, createdToDate]);

  // Form State for Add / Edit Bundle
  const [formBundleCode, setFormBundleCode] = useState<string>('');
  const [formBundleName, setFormBundleName] = useState<string>('');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formStartDate, setFormStartDate] = useState<string>('');
  const [formEndDate, setFormEndDate] = useState<string>('');
  const [formQuota, setFormQuota] = useState<number>(50);
  const [formItems, setFormItems] = useState<
    Array<{
      productId: string;
      productName: string;
      sku: string;
      qty: number;
      promoPrice: number;
      costPrice: number;
      sellingPrice: number;
      unit: string;
    }>
  >([
    {
      productId: '',
      productName: '',
      sku: '',
      qty: 1,
      promoPrice: 0,
      costPrice: 0,
      sellingPrice: 0,
      unit: 'Pcs',
    },
  ]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Initialize new bundle form
  const handleOpenAddBundle = () => {
    setEditingBundleId(null);
    const autoNumber = String(bundles.length + 1).padStart(2, '0');
    setFormBundleCode(`BUNDLE-${autoNumber}`);
    setFormBundleName('');
    setFormDescription('');
    const today = new Date().toISOString().substring(0, 10);
    const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
    setFormStartDate(today);
    setFormEndDate(nextMonth);
    setFormQuota(50);
    setFormItems([
      {
        productId: '',
        productName: '',
        sku: '',
        qty: 1,
        promoPrice: 0,
        costPrice: 0,
        sellingPrice: 0,
        unit: 'Pcs',
      },
    ]);
    setView('add_bundle');
  };

  // Open edit bundle form
  const handleOpenEditBundle = (bundle: ProductBundle) => {
    setEditingBundleId(bundle.id || null);
    setFormBundleCode(bundle.bundleCode);
    setFormBundleName(bundle.name);
    setFormDescription(bundle.description || '');
    setFormStartDate(bundle.startDate || new Date().toISOString().substring(0, 10));
    setFormEndDate(bundle.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10));
    setFormQuota(bundle.quota || 0);

    if (bundle.items && bundle.items.length > 0) {
      setFormItems(
        bundle.items.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          sku: it.sku || '',
          qty: it.qty || 1,
          promoPrice: it.promoPrice || 0,
          costPrice: it.costPrice || 0,
          sellingPrice: it.sellingPrice || 0,
          unit: it.unit || 'Pcs',
        }))
      );
    } else {
      setFormItems([
        {
          productId: '',
          productName: '',
          sku: '',
          qty: 1,
          promoPrice: 0,
          costPrice: 0,
          sellingPrice: 0,
          unit: 'Pcs',
        },
      ]);
    }

    setActiveMenuId(null);
    if (bundle.id) {
      navigateToPath(`/paket-produk/${encodeURIComponent(bundle.id)}/edit`);
    } else {
      navigateToPath('/paket-produk/tambah');
    }
  };

  // Sync URL direct navigation for /paket-produk/tambah and /paket-produk/:id/edit
  useEffect(() => {
    if (route.bundleView === 'add_bundle') {
      if (route.bundleEditId) {
        const matched = bundles.find(
          (b) => b.id === route.bundleEditId || b.bundleCode.toLowerCase() === route.bundleEditId?.toLowerCase()
        );
        if (matched && editingBundleId !== matched.id) {
          setEditingBundleId(matched.id || null);
          setFormBundleCode(matched.bundleCode);
          setFormBundleName(matched.name);
          setFormDescription(matched.description || '');
          setFormStartDate(matched.startDate || new Date().toISOString().substring(0, 10));
          setFormEndDate(
            matched.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10)
          );
          setFormQuota(matched.quota || 0);
          if (matched.items && matched.items.length > 0) {
            setFormItems(
              matched.items.map((it) => ({
                productId: it.productId,
                productName: it.productName,
                sku: it.sku || '',
                qty: it.qty || 1,
                promoPrice: it.promoPrice || 0,
                costPrice: it.costPrice || 0,
                sellingPrice: it.sellingPrice || 0,
                unit: it.unit || 'Pcs',
              }))
            );
          }
        }
      } else if (!formBundleCode) {
        setEditingBundleId(null);
        const autoNumber = String(bundles.length + 1).padStart(2, '0');
        setFormBundleCode(`BUNDLE-${autoNumber}`);
        const today = new Date().toISOString().substring(0, 10);
        const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
        setFormStartDate(today);
        setFormEndDate(nextMonth);
      }
    } else {
      setEditingBundleId(null);
    }
  }, [route.bundleView, route.bundleEditId, bundles]);

  // Product selection change on an item card
  const handleProductSelect = (index: number, selectedProductId: string) => {
    const prod = productsList.find((p) => p.id === selectedProductId);
    setFormItems((prev) => {
      const updated = [...prev];
      if (prod) {
        const standardPrice = prod.pricePerUnit || 0;
        const costPrice = prod.costPerUnit || 0;
        // Default promo price to 90% of selling price or match standard price
        const promoPrice = updated[index].promoPrice > 0 ? updated[index].promoPrice : Math.round(standardPrice * 0.9);
        updated[index] = {
          ...updated[index],
          productId: prod.id,
          productName: prod.name,
          sku: prod.sku || prod.barcode || '',
          costPrice: costPrice,
          sellingPrice: standardPrice,
          promoPrice: promoPrice,
          unit: prod.piecesPerCarton > 1 ? 'Dus' : 'Pcs',
        };
      } else {
        updated[index] = {
          ...updated[index],
          productId: '',
          productName: '',
          sku: '',
          costPrice: 0,
          sellingPrice: 0,
          promoPrice: 0,
        };
      }
      return updated;
    });
  };

  // Item field changes (qty or promoPrice)
  const handleItemFieldChange = (
    index: number,
    field: 'qty' | 'promoPrice',
    value: number
  ) => {
    setFormItems((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        [field]: value >= 0 ? value : 0,
      };
      return updated;
    });
  };

  // Add another product row to bundle repeater
  const handleAddProductRow = () => {
    setFormItems((prev) => [
      ...prev,
      {
        productId: '',
        productName: '',
        sku: '',
        qty: 1,
        promoPrice: 0,
        costPrice: 0,
        sellingPrice: 0,
        unit: 'Pcs',
      },
    ]);
  };

  // Remove a product row
  const handleRemoveProductRow = (index: number) => {
    if (formItems.length <= 1) return;
    setFormItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Real-time financial calculations
  const totalCostPrice = useMemo(() => {
    return formItems.reduce((acc, it) => acc + (it.costPrice || 0) * (it.qty || 1), 0);
  }, [formItems]);

  const totalStandardPrice = useMemo(() => {
    return formItems.reduce((acc, it) => acc + (it.sellingPrice || 0) * (it.qty || 1), 0);
  }, [formItems]);

  const totalPromoPrice = useMemo(() => {
    return formItems.reduce((acc, it) => acc + (it.promoPrice || 0) * (it.qty || 1), 0);
  }, [formItems]);

  const totalDiscount = useMemo(() => {
    return Math.max(0, totalStandardPrice - totalPromoPrice);
  }, [totalStandardPrice, totalPromoPrice]);

  const bundleProfit = useMemo(() => {
    return totalPromoPrice - totalCostPrice;
  }, [totalPromoPrice, totalCostPrice]);

  const profitMarginPercent = useMemo(() => {
    if (totalPromoPrice <= 0) return 0;
    return Math.round((bundleProfit / totalPromoPrice) * 100);
  }, [bundleProfit, totalPromoPrice]);

  // Submit Bundle Form (Writes to Firestore 'stores/store_001/bundles')
  const handleSubmitBundle = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!formBundleName.trim()) {
      showToast('Please enter a Bundle Name', 'error');
      return;
    }
    if (!formBundleCode.trim()) {
      showToast('Please enter a Unique Bundle Code', 'error');
      return;
    }
    if (formItems.length === 0 || formItems.some((it) => !it.productId || !it.productName)) {
      showToast('Please select valid products for all bundle items', 'error');
      return;
    }
    if (formItems.some((it) => (it.qty || 0) <= 0)) {
      showToast('Each bundle item must have a quantity of at least 1', 'error');
      return;
    }

    try {
      setIsSubmitting(true);

      const computedItems: BundleItem[] = formItems.map((it) => ({
        productId: it.productId,
        productName: it.productName,
        sku: it.sku,
        qty: it.qty,
        promoPrice: it.promoPrice,
        costPrice: it.costPrice,
        sellingPrice: it.sellingPrice,
        discount: Math.max(0, it.sellingPrice - it.promoPrice),
        unit: it.unit || 'Pcs',
      }));

      const payload = {
        storeId: ACTIVE_STORE_ID,
        bundleCode: formBundleCode.trim().toUpperCase(),
        name: formBundleName.trim(),
        description: formDescription.trim(),
        startDate: formStartDate,
        endDate: formEndDate,
        quota: Number(formQuota) || 0,
        items: computedItems,
        totalCostPrice,
        totalStandardPrice,
        totalPromoPrice,
        totalDiscount,
        bundleProfit,
        status: 'active' as const,
        updatedAt: serverTimestamp(),
      };

      if (editingBundleId) {
        // Update document
        const bundleDocRef = doc(db, 'stores', ACTIVE_STORE_ID, 'bundles', editingBundleId);
        await updateDoc(bundleDocRef, payload);
        showToast(`Bundle "${formBundleName}" successfully updated!`, 'success');
      } else {
        // Add new document
        const bundlesColRef = collection(db, 'stores', ACTIVE_STORE_ID, 'bundles');
        await addDoc(bundlesColRef, {
          ...payload,
          soldCount: 0,
          createdAt: serverTimestamp(),
        });
        showToast(`Bundle "${formBundleName}" created successfully!`, 'success');
      }

      setIsSubmitting(false);
      setView('directory');
    } catch (err: any) {
      console.error('[ProductBundlesModule] Error saving bundle:', err);
      showToast(`Failed to save bundle: ${err.message || 'Unknown error'}`, 'error');
      setIsSubmitting(false);
    }
  };

  // Toggle bundle status (active <-> deactivated)
  const handleToggleStatus = async (bundle: ProductBundle) => {
    if (!bundle.id) return;
    try {
      const newStatus = bundle.status === 'active' ? 'deactivated' : 'active';
      const bundleDocRef = doc(db, 'stores', ACTIVE_STORE_ID, 'bundles', bundle.id);
      await updateDoc(bundleDocRef, {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
      showToast(`Bundle ${bundle.bundleCode} is now ${newStatus}`);
      setActiveMenuId(null);
    } catch (err: any) {
      console.error('Error updating status:', err);
      showToast('Failed to change status', 'error');
    }
  };

  // Delete bundle
  const handleDeleteBundle = async (bundle: ProductBundle) => {
    if (!bundle.id) return;

    try {
      setActiveMenuId(null);
      const bundleDocRef = doc(db, 'stores', ACTIVE_STORE_ID, 'bundles', bundle.id);
      await deleteDoc(bundleDocRef);
      setBundles((prev) => prev.filter((b) => b.id !== bundle.id));
      showToast(`Bundle "${bundle.name}" deleted successfully`, 'info');
    } catch (err: any) {
      console.error('Error deleting bundle:', err);
      showToast('Failed to delete bundle', 'error');
    }
  };

  // Trigger manual refresh
  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      showToast('Bundles directory refreshed', 'info');
    }, 500);
  };

  // Determine bundle status badge
  const getBundleStatus = (bundle: ProductBundle) => {
    if (bundle.status === 'deactivated') {
      return { label: 'Deactivated', color: 'bg-zinc-800 text-zinc-400 border-zinc-700' };
    }
    const today = new Date().toISOString().substring(0, 10);
    if (bundle.endDate && bundle.endDate < today) {
      return { label: 'Expired', color: 'bg-rose-500/20 text-rose-300 border-rose-500/30' };
    }
    return { label: 'Active', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' };
  };

  return (
    <div className="w-full text-zinc-100 min-h-screen">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
          <div
            className={`flex items-center gap-2 px-4 py-3 rounded-xl border shadow-xl text-sm font-semibold ${
              toastType === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
                : toastType === 'error'
                ? 'bg-rose-950/90 border-rose-500/50 text-rose-200'
                : 'bg-blue-950/90 border-blue-500/50 text-blue-200'
            }`}
          >
            {toastType === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {toastType === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
            {toastType === 'info' && <Sparkles className="w-4 h-4 text-blue-400 shrink-0" />}
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 1: PRODUCT BUNDLES DIRECTORY (PAKET PRODUK) */}
      {/* ========================================================================= */}
      {view === 'directory' && (
        <div className="space-y-6">
          {/* Breadcrumb & Title */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400 uppercase tracking-wider font-semibold">
              <span>ADMIN</span>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
              <span>PRODUCT MANAGEMENT</span>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
              <span className="text-blue-400">Product Bundles</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-2">
              <div>
                <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-400 flex items-center justify-center">
                    <Package className="w-5 h-5" />
                  </div>
                  <span>Product Bundles</span>
                </h1>
                <p className="text-xs text-zinc-400 mt-1">
                  Bundle products with promo pricing, quotas, and automated profit calculations.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                  title="Refresh Bundles"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
                  <span>Refresh</span>
                </button>
                <AppLink
                  to="/paket-produk/tambah"
                  onClick={handleOpenAddBundle}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-bold transition shadow-lg shadow-blue-600/20 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ Add Bundle</span>
                </AppLink>
              </div>
            </div>
          </div>

          {/* Action Bar (Search & Date Range Filters) */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 shadow-sm backdrop-blur-sm">
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
              {/* Search input */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search bundle name..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Date Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5">
                  <span className="text-[11px] text-zinc-400 whitespace-nowrap">Created from:</span>
                  <input
                    type="date"
                    value={createdFromDate}
                    onChange={(e) => setCreatedFromDate(e.target.value)}
                    className="bg-transparent text-xs text-white focus:outline-none cursor-pointer [color-scheme:dark]"
                  />
                </div>
                <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5">
                  <span className="text-[11px] text-zinc-400 whitespace-nowrap">To:</span>
                  <input
                    type="date"
                    value={createdToDate}
                    onChange={(e) => setCreatedToDate(e.target.value)}
                    className="bg-transparent text-xs text-white focus:outline-none cursor-pointer [color-scheme:dark]"
                  />
                </div>
                {(createdFromDate || createdToDate) && (
                  <button
                    type="button"
                    onClick={() => {
                      setCreatedFromDate('');
                      setCreatedToDate('');
                    }}
                    className="text-xs text-zinc-400 hover:text-rose-400 px-2 py-1.5 rounded-lg hover:bg-zinc-800 transition"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Table / Empty State Content */}
          {loadingBundles ? (
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-16 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-xs text-zinc-400 font-medium">Loading product bundles from Firestore...</p>
            </div>
          ) : filteredBundles.length === 0 ? (
            /* EMPTY STATE */
            <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-16 flex flex-col items-center justify-center text-center">
              <div className="w-20 h-20 rounded-full bg-zinc-950 border border-zinc-800 flex items-center justify-center mb-4 text-zinc-500 shadow-inner">
                <Package className="w-10 h-10 text-zinc-600" />
              </div>
              <h3 className="text-lg font-bold text-white tracking-tight">No bundles yet</h3>
              <p className="text-xs text-zinc-400 max-w-sm mt-1 mb-6">
                Create your first product bundle by clicking the Add Bundle button.
              </p>
              <AppLink
                to="/paket-produk/tambah"
                onClick={handleOpenAddBundle}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition shadow-lg shadow-blue-600/20 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Add Bundle</span>
              </AppLink>
            </div>
          ) : (
            /* POPULATED STATE TABLE */
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950/70 border-b border-zinc-800 text-zinc-400 uppercase tracking-wider text-[10px] font-bold">
                    <tr>
                      <th className="py-3.5 px-4">Bundle Code</th>
                      <th className="py-3.5 px-4">Bundle Name</th>
                      <th className="py-3.5 px-4">Items Included</th>
                      <th className="py-3.5 px-4">Schedule</th>
                      <th className="py-3.5 px-4 text-right">Promo Price</th>
                      <th className="py-3.5 px-4 text-right">Total Cost</th>
                      <th className="py-3.5 px-4 text-right">Profit / Margin</th>
                      <th className="py-3.5 px-4 text-center">Quota / Sold</th>
                      <th className="py-3.5 px-4 text-center">Status</th>
                      <th className="py-3.5 px-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 font-medium">
                    {filteredBundles.map((b) => {
                      const statusBadge = getBundleStatus(b);
                      const isMenuOpen = activeMenuId === b.id;

                      return (
                        <tr key={b.id} className="hover:bg-zinc-800/40 transition-colors">
                          {/* Bundle Code */}
                          <td className="py-3 px-4 font-mono font-bold text-blue-400 whitespace-nowrap">
                            <span className="bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 rounded-md">
                              {b.bundleCode}
                            </span>
                          </td>

                          {/* Bundle Name */}
                          <td className="py-3 px-4">
                            <div className="font-bold text-white text-sm">{b.name}</div>
                            {b.description && (
                              <div className="text-[11px] text-zinc-400 line-clamp-1 mt-0.5">{b.description}</div>
                            )}
                          </td>

                          {/* Items Included */}
                          <td className="py-3 px-4">
                            <div className="space-y-1 max-w-[220px]">
                              {b.items && b.items.length > 0 ? (
                                b.items.map((it, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between text-[11px] bg-zinc-950/60 px-2 py-1 rounded border border-zinc-800/80"
                                  >
                                    <span className="text-zinc-300 truncate max-w-[140px]" title={it.productName}>
                                      {it.productName}
                                    </span>
                                    <span className="font-bold text-amber-400 font-mono text-[10px] ml-1 shrink-0">
                                      {it.qty} {it.unit || 'Pcs'}
                                    </span>
                                  </div>
                                ))
                              ) : (
                                <span className="text-zinc-500 italic">No items</span>
                              )}
                            </div>
                          </td>

                          {/* Dates */}
                          <td className="py-3 px-4 text-[11px] text-zinc-300 whitespace-nowrap">
                            <div>
                              <span className="text-zinc-500">From: </span>
                              {b.startDate || 'Immediate'}
                            </div>
                            <div>
                              <span className="text-zinc-500">To: </span>
                              {b.endDate || 'No expiration'}
                            </div>
                          </td>

                          {/* Promo Price */}
                          <td className="py-3 px-4 text-right whitespace-nowrap font-mono font-bold text-emerald-400">
                            {formatRupiah(b.totalPromoPrice)}
                            {b.totalStandardPrice > b.totalPromoPrice && (
                              <div className="text-[10px] text-zinc-500 line-through">
                                {formatRupiah(b.totalStandardPrice)}
                              </div>
                            )}
                          </td>

                          {/* Total Cost */}
                          <td className="py-3 px-4 text-right whitespace-nowrap font-mono text-zinc-300">
                            {formatRupiah(b.totalCostPrice)}
                          </td>

                          {/* Profit / Margin */}
                          <td className="py-3 px-4 text-right whitespace-nowrap font-mono">
                            <span
                              className={`font-bold ${
                                b.bundleProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {formatRupiah(b.bundleProfit)}
                            </span>
                            <div className="text-[10px] text-zinc-400">
                              {b.totalPromoPrice > 0
                                ? `${Math.round((b.bundleProfit / b.totalPromoPrice) * 100)}% margin`
                                : '0%'}
                            </div>
                          </td>

                          {/* Quota / Sold */}
                          <td className="py-3 px-4 text-center whitespace-nowrap font-mono text-xs">
                            <span className="text-white font-bold">{b.soldCount || 0}</span>
                            <span className="text-zinc-500"> / {b.quota}</span>
                            <div className="w-16 bg-zinc-800 rounded-full h-1.5 mx-auto mt-1 overflow-hidden">
                              <div
                                className="bg-blue-500 h-1.5 rounded-full"
                                style={{
                                  width: `${Math.min(100, Math.round(((b.soldCount || 0) / (b.quota || 1)) * 100))}%`,
                                }}
                              />
                            </div>
                          </td>

                          {/* Status */}
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            <span
                              className={`px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase tracking-wider ${statusBadge.color}`}
                            >
                              {statusBadge.label}
                            </span>
                          </td>

                          {/* Action Menu */}
                          <td className="py-3 px-4 text-center relative">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setDetailBundle(b)}
                                title="Lihat Detail Paket"
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenEditBundle(b)}
                                title="Edit Paket"
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteBundle(b)}
                                title="Hapus Paket"
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 2: ADD / EDIT BUNDLE FORM (TAMBAH PAKET) */}
      {/* ========================================================================= */}
      {view === 'add_bundle' && (
        <form onSubmit={handleSubmitBundle} className="space-y-6">
          {/* Top Bar with Navigation */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-zinc-400 uppercase tracking-wider font-semibold">
                <span>ADMIN / PRODUCT MANAGEMENT</span>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
                <span className="text-blue-400">{editingBundleId ? 'Edit Bundle' : 'Add Bundle'}</span>
              </div>
              <h1 className="text-2xl font-black text-white tracking-tight mt-1 flex items-center gap-2">
                <Layers className="w-6 h-6 text-blue-400" />
                <span>{editingBundleId ? 'Edit Product Bundle' : 'Add New Bundle (Tambah Paket)'}</span>
              </h1>
              <p className="text-xs text-zinc-400 mt-1">
                Cost price and selling price automatically calculate from selected items.
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <AppLink
                to="/paket-produk"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-semibold transition cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back (Kembali)</span>
              </AppLink>
            </div>
          </div>

          {/* Bundle Meta Info Header (Name & Description) */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Tag className="w-4 h-4 text-blue-400" />
              <span>Bundle Information</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Bundle Name (Nama Paket) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formBundleName}
                  onChange={(e) => setFormBundleName(e.target.value)}
                  placeholder="e.g. Paket Sarapan Berdua, Paket Sembako Murah"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Bundle Description (Keterangan Promo)
                </label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="e.g. Spesial bundling hemat 15% setiap pembelian paket"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Dynamic Item List (Product Repeater) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Package className="w-4 h-4 text-amber-400" />
                  <span>Items Included in Bundle (Produk dalam Paket)</span>
                </h3>
                <p className="text-xs text-zinc-400">
                  Select products from inventory. Selling &amp; cost prices will populate automatically.
                </p>
              </div>

              <button
                type="button"
                onClick={handleAddProductRow}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-400 hover:bg-blue-600/30 hover:text-blue-300 text-xs font-bold transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Add Product (+ Tambah Produk)</span>
              </button>
            </div>

            {/* Repeater Cards */}
            <div className="space-y-3">
              {formItems.map((item, index) => {
                const discountPerProduct = Math.max(0, item.sellingPrice - item.promoPrice);

                return (
                  <div
                    key={index}
                    className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 transition-all hover:border-zinc-700 space-y-3"
                  >
                    {/* Item Card Header */}
                    <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-bold flex items-center justify-center font-mono">
                          {index + 1}
                        </span>
                        <span className="text-xs font-bold text-white">Product {index + 1}</span>
                        {item.sku && (
                          <span className="text-[10px] font-mono bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">
                            {item.sku}
                          </span>
                        )}
                      </div>

                      {formItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveProductRow(index)}
                          className="flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 px-2 py-1 rounded-lg hover:bg-rose-500/10 transition cursor-pointer"
                          title="Delete item row"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete (Hapus)</span>
                        </button>
                      )}
                    </div>

                    {/* Fields Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                      {/* Product Name (Dropdown / Combobox) */}
                      <div className="lg:col-span-2">
                        <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
                          Product Name <span className="text-rose-400">*</span>
                        </label>
                        <select
                          value={item.productId}
                          onChange={(e) => handleProductSelect(index, e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                        >
                          <option value="">-- Select Product --</option>
                          {productsList.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.sku || 'No SKU'}) - {formatRupiah(p.pricePerUnit)}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Qty */}
                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
                          Qty (Jumlah)
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={item.qty}
                          onChange={(e) =>
                            handleItemFieldChange(index, 'qty', parseInt(e.target.value) || 1)
                          }
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      {/* Promo Price (Harga Promo) */}
                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
                          Promo Price (Harga Promo)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={item.promoPrice}
                          onChange={(e) =>
                            handleItemFieldChange(
                              index,
                              'promoPrice',
                              parseFloat(e.target.value) || 0
                            )
                          }
                          placeholder="e.g. 15000"
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-emerald-400 font-mono font-bold focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      {/* Cost Price (Harga Modal) - Read Only */}
                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                          Cost Price (Modal)
                        </label>
                        <div className="w-full bg-zinc-950/60 border border-zinc-800/80 rounded-xl px-3 py-2 text-xs font-mono text-zinc-400">
                          {formatRupiah(item.costPrice)}
                        </div>
                      </div>

                      {/* Selling Price (Harga Jual Standard) - Read Only */}
                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                          Selling Price (Jual Standard)
                        </label>
                        <div className="w-full bg-zinc-950/60 border border-zinc-800/80 rounded-xl px-3 py-2 text-xs font-mono text-zinc-300">
                          {formatRupiah(item.sellingPrice)}
                        </div>
                      </div>
                    </div>

                    {/* Calculated Discount Info */}
                    <div className="flex items-center justify-between text-[11px] px-2 py-1 bg-zinc-950/50 rounded-lg border border-zinc-800/50">
                      <span className="text-zinc-400">
                        Discount / Product: <strong className="text-amber-400">{formatRupiah(discountPerProduct)}</strong> per item
                      </span>
                      <span className="text-zinc-400">
                        Subtotal Promo: <strong className="text-emerald-400 font-mono">{formatRupiah(item.promoPrice * item.qty)}</strong>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom Add Product Button */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleAddProductRow}
                className="w-full py-3 rounded-2xl border-2 border-dashed border-zinc-800 hover:border-blue-500/50 hover:bg-blue-500/5 text-zinc-400 hover:text-blue-400 text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Add Product (+ Tambah Produk)</span>
              </button>
            </div>
          </div>

          {/* Bundle Configuration & Financial Summary Grid (Bottom Container) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6">
            {/* Left Configuration Form (Columns: 7) */}
            <div className="lg:col-span-7 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-zinc-800 pb-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                <span>Bundle Configuration &amp; Schedule</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Unique Code */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    Unique Code (Kode Unik) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formBundleCode}
                    onChange={(e) => setFormBundleCode(e.target.value.toUpperCase())}
                    placeholder="e.g. BUNDLE-01 or PAKET-01"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-blue-400 font-mono font-bold focus:outline-none focus:border-blue-500 uppercase"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">
                    Unique identifier for POS barcode &amp; customer lookup.
                  </p>
                </div>

                {/* Quota */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    Quota (Kuota Maksimal) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={formQuota}
                    onChange={(e) => setFormQuota(parseInt(e.target.value) || 0)}
                    placeholder="e.g. 100"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">
                    Maximum bundle redemption limit.
                  </p>
                </div>

                {/* Start Date */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    Start Date (Mulai)
                  </label>
                  <input
                    type="date"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500 [color-scheme:dark] cursor-pointer"
                  />
                </div>

                {/* End Date */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    End Date (Berakhir)
                  </label>
                  <input
                    type="date"
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500 [color-scheme:dark] cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Right Financial Real-Time Metrics (Auto-calculated, Columns: 5) */}
            <div className="lg:col-span-5 bg-zinc-950 border border-zinc-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-zinc-800 pb-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <span>Financial Real-Time Metrics</span>
                </h3>

                <div className="space-y-3 pt-3 text-xs">
                  {/* Total Cost Price */}
                  <div className="flex items-center justify-between text-zinc-400">
                    <span>Total Cost Price (Total Modal):</span>
                    <span className="font-mono font-semibold text-zinc-200">
                      {formatRupiah(totalCostPrice)}
                    </span>
                  </div>

                  {/* Total Standard Price */}
                  <div className="flex items-center justify-between text-zinc-400">
                    <span>Total Standard Price (Harga Normal):</span>
                    <span className="font-mono text-zinc-400 line-through">
                      {formatRupiah(totalStandardPrice)}
                    </span>
                  </div>

                  {/* Total Promo Price */}
                  <div className="flex items-center justify-between text-zinc-300 font-medium">
                    <span>Total Promo Price (Harga Promo):</span>
                    <span className="font-mono font-bold text-emerald-400 text-sm">
                      {formatRupiah(totalPromoPrice)}
                    </span>
                  </div>

                  {/* Total Discount */}
                  <div className="flex items-center justify-between text-zinc-400">
                    <span>Total Discount (Total Hemat):</span>
                    <span className="font-mono font-semibold text-amber-400">
                      - {formatRupiah(totalDiscount)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Highlighted Metric Box: Bundle Profit */}
              <div
                className={`p-4 rounded-xl border flex flex-col gap-1 ${
                  bundleProfit >= 0
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="uppercase tracking-wider text-[10px]">Net Bundle Margin</span>
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-black/30 font-bold">
                    {profitMarginPercent}% Margin
                  </span>
                </div>
                <div className="text-lg font-black font-mono">
                  Bundle Profit: {formatRupiah(bundleProfit)}
                </div>
                <div className="text-[10px] text-zinc-400">
                  {bundleProfit >= 0
                    ? '✓ Positive estimated margin per bundle sold.'
                    : '⚠ Promo price is lower than combined inventory cost.'}
                </div>
              </div>
            </div>
          </div>

          {/* Footer Action */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setView('directory')}
              className="px-5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 text-xs font-semibold transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-bold transition shadow-lg shadow-blue-600/25 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Submit Bundle (Submit Paket)</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* MODAL: DETAIL BUNDLE */}
      {detailBundle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-white text-base">{detailBundle.name}</h3>
                <span className="text-xs font-mono text-blue-400">{detailBundle.bundleCode}</span>
              </div>
              <button
                onClick={() => setDetailBundle(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Harga Normal Gabungan:</span>
                <span className="font-mono text-zinc-400 line-through">
                  Rp {Number(detailBundle.totalStandardPrice || 0).toLocaleString('id-ID')}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Harga Promo Paket:</span>
                <span className="font-mono font-bold text-emerald-400 text-sm">
                  Rp {Number(detailBundle.totalPromoPrice || 0).toLocaleString('id-ID')}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Hemat Pelanggan:</span>
                <span className="font-mono font-bold text-amber-400">
                  Rp {Number(detailBundle.totalDiscount || 0).toLocaleString('id-ID')}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Estimasi Laba Paket:</span>
                <span className="font-mono font-bold text-blue-400">
                  Rp {Number(detailBundle.bundleProfit || 0).toLocaleString('id-ID')}
                </span>
              </div>
              <div className="pt-2">
                <span className="text-zinc-400 font-bold block mb-2">Komponen Produk dalam Paket:</span>
                <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-xl bg-zinc-950 overflow-hidden">
                  {(detailBundle.items || []).map((it, idx) => (
                    <div key={idx} className="p-2.5 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-white block">{it.productName}</span>
                        <span className="text-[10px] text-zinc-500">Qty: {it.qty} pcs</span>
                      </div>
                      <span className="font-mono text-zinc-300">
                        Rp {Number((it.promoPrice || it.sellingPrice || 0) * (it.qty || 1)).toLocaleString('id-ID')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => {
                  const b = detailBundle;
                  setDetailBundle(null);
                  handleOpenEditBundle(b);
                }}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold cursor-pointer"
              >
                Edit Paket
              </button>
              <button
                onClick={() => setDetailBundle(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold cursor-pointer"
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
