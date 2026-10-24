import React, { useState, useEffect, useMemo } from 'react';
import {
  Tag,
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
  DollarSign,
  Clock,
  Layers,
  ChevronRight,
  MoreVertical,
  Edit2,
  Power,
  Sparkles,
  Users,
  Award,
  Wallet,
  Check,
  X,
  FileSpreadsheet,
  Eye,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { ACTIVE_STORE_ID } from '../../config/store';
import { DiscountPriceRule, CustomerType, Product } from '../../types';
import { useAppNavigation, AppLink } from '../../router';

interface DiscountPricingModuleProps {
  onBackToDirectory?: () => void;
  currencyMode?: 'IDR' | 'USD';
}

const DEFAULT_CUSTOMER_TYPES: any[] = [];

export const DiscountPricingModule: React.FC<DiscountPricingModuleProps> = ({
  currencyMode = 'IDR',
}) => {
  const { route, navigateToPath } = useAppNavigation();
  // Navigation view: 'directory' | 'add_form' derived from URL
  const view = route.discountView;
  const setView = (nextView: 'directory' | 'add_form') => {
    navigateToPath(nextView === 'add_form' ? '/harga-diskon/tambah' : '/harga-diskon');
  };
  const [editingRuleId, setEditingRuleId] = useState<string | null>(route.discountEditId || null);

  // Firestore rules state
  const [rules, setRules] = useState<DiscountPriceRule[]>([]);
  const [detailRule, setDetailRule] = useState<DiscountPriceRule | null>(null);
  const [loadingRules, setLoadingRules] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Products from Firestore 'stores/store_001/products'
  const [productsList, setProductsList] = useState<Product[]>([]);
  // Customer types from Firestore 'stores/store_001/customer_types'
  const [customerTypes, setCustomerTypes] = useState<CustomerType[]>([]);

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
    }, 4000);
  };

  // Form states for Add / Edit
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [productSearchInput, setProductSearchInput] = useState<string>('');
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState<boolean>(false);
  const [selectedCustomerTypeId, setSelectedCustomerTypeId] = useState<string>('TYPE-01');
  const [normalPrice, setNormalPrice] = useState<number>(0);
  const [costPrice, setCostPrice] = useState<number>(0);
  const [discountPriceInput, setDiscountPriceInput] = useState<string>('');
  const [minQtyInput, setMinQtyInput] = useState<string>('1');
  const [pointPercentInput, setPointPercentInput] = useState<string>('10');
  const [ruleStatus, setRuleStatus] = useState<'active' | 'inactive'>('active');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Currency Formatter
  const formatMoney = (val: number) => {
    if (currencyMode === 'USD') {
      return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `Rp ${Math.round(val).toLocaleString('id-ID')}`;
  };

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.action-menu-container')) {
        setActiveMenuId(null);
      }
      if (!target.closest('.product-combobox-container')) {
        setIsProductDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // 1. Listen to Firestore discount_prices in real time
  useEffect(() => {
    setLoadingRules(true);
    const storeDiscountPricesCol = collection(db, `stores/${ACTIVE_STORE_ID}/discount_prices`);
    const unsubscribe = onSnapshot(
      storeDiscountPricesCol,
      (snapshot) => {
        const loaded: DiscountPriceRule[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          loaded.push({
            id: d.id,
            storeId: data.storeId || ACTIVE_STORE_ID,
            productId: data.productId || '',
            productName: data.productName || 'Unknown Product',
            productSku: data.productSku || '',
            customerTypeId: data.customerTypeId || '',
            customerTypeName: data.customerTypeName || 'UMUM',
            customerTypeCode: data.customerTypeCode || '',
            normalPrice: Number(data.normalPrice || 0),
            costPrice: Number(data.costPrice || 0),
            discountPrice: Number(data.discountPrice || 0),
            minQty: Number(data.minQty || 1),
            marginProfit: Number(data.marginProfit || 0),
            pointPercent: Number(data.pointPercent || 0),
            pointsReward: Number(data.pointsReward || 0),
            status: data.status === 'inactive' ? 'inactive' : 'active',
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt || new Date().toISOString(),
            updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : data.updatedAt,
          });
        });

        // Sort by newest
        loaded.sort((a, b) => {
          const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tB - tA;
        });

        setRules(loaded);
        setLoadingRules(false);
      },
      (err) => {
        console.warn('Firestore discount_prices listener notice:', err);
        setLoadingRules(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // 2. Listen to live Products from 'products'
  useEffect(() => {
    const productsCol = collection(db, 'products');
    const unsub = onSnapshot(
      productsCol,
      (snapshot) => {
        const list: Product[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const prodObj: Product = {
            id: docSnap.id,
            storeId: data.storeId || ACTIVE_STORE_ID,
            name: data.name || 'Unnamed Product',
            sku: data.sku || docSnap.id.slice(0, 7).toUpperCase(),
            category: data.category || 'General',
            barcode: data.barcode || '',
            piecesPerCarton: Number(data.piecesPerCarton || 1),
            stockInUnits: Number(data.stockInUnits ?? data.stock ?? 0),
            costPerUnit: Number(data.costPerUnit ?? data.costPrice ?? 0),
            pricePerUnit: Number(data.pricePerUnit ?? data.price ?? 0),
            pricePerCarton: Number(data.pricePerCarton ?? data.price ?? 0),
            minStockAlert: Number(data.minStockAlert || 5),
            imageUrl: data.imageUrl,
            brand: data.brand,
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
            updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : data.updatedAt,
          };
          list.push(prodObj);
        });
        setProductsList(list);
      },
      (err) => console.warn('Products sync notice:', err)
    );

    return () => unsub();
  }, []);

  // 3. Listen to Customer Types from 'stores/store_001/customer_types'
  useEffect(() => {
    const custTypesCol = collection(db, `stores/${ACTIVE_STORE_ID}/customer_types`);
    const unsub = onSnapshot(
      custTypesCol,
      (snapshot) => {
        const list: CustomerType[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          list.push({
            id: docSnap.id,
            storeId: data.storeId || ACTIVE_STORE_ID,
            name: data.name || 'CUSTOMER TIER',
            code: data.code || 'CUST',
            discountRate: Number(data.discountRate || 0),
            pointMultiplier: Number(data.pointMultiplier || 1),
            status: data.status || 'active',
            description: data.description,
          });
        });

        if (list.length > 0) {
          setCustomerTypes(list);
        } else {
          setCustomerTypes(DEFAULT_CUSTOMER_TYPES as CustomerType[]);
        }
      },
      (err) => {
        console.warn('Customer types listener notice:', err);
        setCustomerTypes(DEFAULT_CUSTOMER_TYPES as CustomerType[]);
      }
    );

    return () => unsub();
  }, []);

  // Manual Refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      showToast('Discount prices synchronized with Firestore', 'info');
    }, 600);
  };

  // Filtered Rules
  const filteredRules = useMemo(() => {
    return rules.filter((r) => {
      // Search product name or customer type
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = r.productName.toLowerCase().includes(q);
        const matchType = r.customerTypeName.toLowerCase().includes(q);
        const matchSku = (r.productSku || '').toLowerCase().includes(q);
        if (!matchName && !matchType && !matchSku) return false;
      }

      // Date range filtering
      if (createdFromDate) {
        if (!r.createdAt) return false;
        const itemDate = new Date(r.createdAt).toISOString().split('T')[0];
        if (itemDate < createdFromDate) return false;
      }
      if (createdToDate) {
        if (!r.createdAt) return false;
        const itemDate = new Date(r.createdAt).toISOString().split('T')[0];
        if (itemDate > createdToDate) return false;
      }

      return true;
    });
  }, [rules, searchQuery, createdFromDate, createdToDate]);

  // Product Selection handler
  const handleSelectProduct = (prod: Product) => {
    setSelectedProductId(prod.id || '');
    setProductSearchInput(prod.name);
    setIsProductDropdownOpen(false);

    // Auto set normal price and cost price
    const retail = Number(prod.pricePerUnit || 0);
    const cost = Number(prod.costPerUnit || 0);
    setNormalPrice(retail);
    setCostPrice(cost);

    // Suggest discount price if not set
    if (!discountPriceInput) {
      const suggested = Math.round(retail * 0.9);
      setDiscountPriceInput(suggested.toString());
    }

    if (formErrors.product) {
      setFormErrors((prev) => ({ ...prev, product: '' }));
    }
  };

  // Calculated Metrics for the Form
  const discountPriceNum = parseFloat(discountPriceInput) || 0;
  const minQtyNum = parseInt(minQtyInput, 10) || 1;
  const pointPercentNum = parseFloat(pointPercentInput) || 0;

  const marginProfitPerUnit = discountPriceNum - costPrice;
  const calculatedPointsReward = useMemo(() => {
    if (marginProfitPerUnit <= 0 || pointPercentNum <= 0) return 0;
    // Formula: Margin * (PointPercent / 100), rounded to 1 decimal
    const pts = marginProfitPerUnit * (pointPercentNum / 100);
    return Math.round(pts);
  }, [marginProfitPerUnit, pointPercentNum]);

  // Reset Add/Edit Form
  const resetForm = () => {
    setSelectedProductId('');
    setProductSearchInput('');
    setIsProductDropdownOpen(false);
    setSelectedCustomerTypeId(customerTypes[0]?.id || 'TYPE-01');
    setNormalPrice(0);
    setCostPrice(0);
    setDiscountPriceInput('');
    setMinQtyInput('1');
    setPointPercentInput('10');
    setRuleStatus('active');
    setFormErrors({});
    setEditingRuleId(null);
  };

  // Open Form for Add
  const handleOpenAddForm = () => {
    resetForm();
    if (productsList.length > 0) {
      handleSelectProduct(productsList[0]);
    }
    setView('add_form');
  };

  // Open Form for Edit
  const handleOpenEditForm = (rule: DiscountPriceRule) => {
    setEditingRuleId(rule.id || null);
    setSelectedProductId(rule.productId);
    setProductSearchInput(rule.productName);
    setSelectedCustomerTypeId(rule.customerTypeId || customerTypes[0]?.id || 'TYPE-01');
    setNormalPrice(rule.normalPrice);
    setCostPrice(rule.costPrice);
    setDiscountPriceInput(rule.discountPrice.toString());
    setMinQtyInput(rule.minQty.toString());
    setPointPercentInput(rule.pointPercent.toString());
    setRuleStatus(rule.status);
    setFormErrors({});
    setActiveMenuId(null);
    if (rule.id) {
      navigateToPath(`/harga-diskon/${encodeURIComponent(rule.id)}/edit`);
    } else {
      navigateToPath('/harga-diskon/tambah');
    }
  };

  // Sync direct URL navigation for /harga-diskon/tambah and /harga-diskon/:id/edit
  useEffect(() => {
    if (route.discountView === 'add_form') {
      if (route.discountEditId) {
        const matched = rules.find((r) => r.id === route.discountEditId);
        if (matched && editingRuleId !== matched.id) {
          setEditingRuleId(matched.id || null);
          setSelectedProductId(matched.productId);
          setProductSearchInput(matched.productName);
          setSelectedCustomerTypeId(matched.customerTypeId || customerTypes[0]?.id || 'TYPE-01');
          setNormalPrice(matched.normalPrice);
          setCostPrice(matched.costPrice);
          setDiscountPriceInput(matched.discountPrice.toString());
          setMinQtyInput(matched.minQty.toString());
          setPointPercentInput(matched.pointPercent.toString());
          setRuleStatus(matched.status);
          setFormErrors({});
        }
      } else if (!selectedProductId && productsList.length > 0) {
        handleSelectProduct(productsList[0]);
      }
    } else {
      setEditingRuleId(null);
    }
  }, [route.discountView, route.discountEditId, rules, productsList]);

  // Toggle Status
  const handleToggleStatus = async (rule: DiscountPriceRule) => {
    if (!rule.id) return;
    try {
      const nextStatus = rule.status === 'active' ? 'inactive' : 'active';
      const ref = doc(db, `stores/${ACTIVE_STORE_ID}/discount_prices`, rule.id);
      await updateDoc(ref, {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      showToast(`Discount pricing rule marked as ${nextStatus}`, 'success');
    } catch (err: any) {
      console.error('Toggle status error:', err);
      showToast('Failed to update rule status: ' + err.message, 'error');
    }
    setActiveMenuId(null);
  };

  // Delete Rule
  const handleDeleteRule = async (ruleId: string) => {
    try {
      setActiveMenuId(null);
      const ref = doc(db, `stores/${ACTIVE_STORE_ID}/discount_prices`, ruleId);
      await deleteDoc(ref);
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      showToast('Discount price rule deleted', 'success');
    } catch (err: any) {
      console.error('Delete rule error:', err);
      showToast('Failed to delete rule: ' + err.message, 'error');
    }
  };

  // Submit Form (Add or Update)
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors: Record<string, string> = {};
    if (!selectedProductId) {
      errors.product = 'Please select a product from the list.';
    }
    if (!discountPriceNum || discountPriceNum <= 0) {
      errors.discountPrice = 'Discount price must be greater than 0.';
    }
    if (minQtyNum < 1) {
      errors.minQty = 'Minimum quantity must be at least 1.';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      const matchedProd = productsList.find((p) => p.id === selectedProductId);
      const matchedType = customerTypes.find((t) => t.id === selectedCustomerTypeId) || {
        id: selectedCustomerTypeId,
        name: 'UMUM',
        code: 'CUST-REG',
      };

      const ruleData = {
        storeId: ACTIVE_STORE_ID,
        productId: selectedProductId,
        productName: matchedProd?.name || productSearchInput,
        productSku: matchedProd?.sku || '',
        customerTypeId: matchedType.id || selectedCustomerTypeId,
        customerTypeName: matchedType.name,
        customerTypeCode: matchedType.code || '',
        normalPrice: normalPrice,
        costPrice: costPrice,
        discountPrice: discountPriceNum,
        minQty: minQtyNum,
        marginProfit: marginProfitPerUnit,
        pointPercent: pointPercentNum,
        pointsReward: calculatedPointsReward,
        status: ruleStatus,
        updatedAt: serverTimestamp(),
      };

      if (editingRuleId) {
        // Update existing document
        const ref = doc(db, `stores/${ACTIVE_STORE_ID}/discount_prices`, editingRuleId);
        await updateDoc(ref, ruleData);
        showToast('Discount pricing rule updated successfully!', 'success');
      } else {
        // Create new document
        const colRef = collection(db, `stores/${ACTIVE_STORE_ID}/discount_prices`);
        await addDoc(colRef, {
          ...ruleData,
          createdAt: serverTimestamp(),
        });
        showToast('Discount pricing rule created and synced to Firestore!', 'success');
      }

      resetForm();
      setView('directory');
    } catch (err: any) {
      console.error('Save discount price error:', err);
      showToast('Error saving discount price: ' + err.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered product suggestions for combobox
  const filteredProducts = useMemo(() => {
    if (!productSearchInput.trim()) return productsList.slice(0, 15);
    const q = productSearchInput.toLowerCase();
    return productsList
      .filter((p) => p.name.toLowerCase().includes(q) || (p.sku && p.sku.toLowerCase().includes(q)))
      .slice(0, 15);
  }, [productsList, productSearchInput]);

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 animate-in slide-in-from-top-4 duration-200">
          <div
            className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-xl text-xs font-semibold ${
              toastType === 'error'
                ? 'bg-rose-950/90 border-rose-800 text-rose-200 shadow-rose-950/50'
                : 'bg-[#110e08] border-amber-500/50 text-amber-200 shadow-[0_0_18px_rgba(245,158,11,0.2)]'
            }`}
          >
            {toastType === 'success' && <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />}
            {toastType === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
            {toastType === 'info' && <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />}
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 1: DIRECTORY (LIST OF DISCOUNT PRICES) */}
      {/* ========================================================================= */}
      {view === 'directory' && (
        <div className="space-y-6">
          {/* Header Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#110e08] border border-amber-500/40 shadow-[0_0_18px_rgba(245,158,11,0.12)]">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono tracking-widest uppercase text-amber-400 bg-amber-500/15 border border-amber-500/40 px-2 py-0.5 rounded-md">
                  ADMIN / PRODUCT MANAGEMENT &gt; DISCOUNT PRICING
                </span>
              </div>
              <h2 className="text-xl font-black text-amber-50 tracking-tight flex items-center gap-2.5">
                <Tag className="w-5 h-5 text-amber-400" />
                <span>Discount Pricing (Harga Diskon)</span>
              </h2>
              <p className="text-xs text-amber-200/70 max-w-2xl">
                Special prices per product for specific customer types and minimum quantities, with automatic profit-based points.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#080705] border border-amber-500/40 hover:bg-[#16120b] text-amber-200 hover:text-amber-100 text-xs font-semibold transition cursor-pointer"
                title="Refresh Discount Pricing list"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>

              <AppLink
                to="/harga-diskon/tambah"
                onClick={handleOpenAddForm}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 hover:brightness-110 text-black text-xs font-black border border-amber-300/60 shadow-[0_0_15px_rgba(245,158,11,0.35)] transition-all cursor-pointer active:scale-95"
              >
                <Plus className="w-4 h-4 text-black" />
                <span>+ Add Discount Price</span>
              </AppLink>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="p-4 rounded-2xl bg-[#110e08] border border-amber-500/40 shadow-[0_0_18px_rgba(245,158,11,0.1)]">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
              {/* Search Product */}
              <div className="md:col-span-6 relative">
                <Search className="w-4 h-4 text-amber-400/70 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search product name, SKU, or customer tier..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#080705] border border-amber-500/40 focus:border-amber-400 rounded-xl pl-9 pr-3 py-2 text-xs text-amber-50 placeholder-amber-200/35 focus:outline-none transition"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-400/70 hover:text-amber-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Created From */}
              <div className="md:col-span-3 flex items-center gap-2">
                <span className="text-[11px] font-semibold text-amber-200/70 shrink-0">From:</span>
                <input
                  type="date"
                  value={createdFromDate}
                  onChange={(e) => setCreatedFromDate(e.target.value)}
                  className="w-full bg-[#080705] border border-amber-500/40 focus:border-amber-400 rounded-xl px-2.5 py-1.5 text-xs text-amber-50 focus:outline-none transition [color-scheme:dark]"
                />
              </div>

              {/* Created To */}
              <div className="md:col-span-3 flex items-center gap-2">
                <span className="text-[11px] font-semibold text-amber-200/70 shrink-0">To:</span>
                <input
                  type="date"
                  value={createdToDate}
                  onChange={(e) => setCreatedToDate(e.target.value)}
                  className="w-full bg-[#080705] border border-amber-500/40 focus:border-amber-400 rounded-xl px-2.5 py-1.5 text-xs text-amber-50 focus:outline-none transition [color-scheme:dark]"
                />
                {(createdFromDate || createdToDate) && (
                  <button
                    onClick={() => {
                      setCreatedFromDate('');
                      setCreatedToDate('');
                    }}
                    className="p-1.5 rounded-lg bg-[#16120b] border border-amber-500/40 text-amber-300 hover:text-amber-100"
                    title="Reset date filter"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Main Content: Table or Empty State */}
          {loadingRules ? (
            <div className="p-12 text-center rounded-2xl bg-[#110e08] border border-amber-500/40">
              <RefreshCw className="w-8 h-8 text-amber-400 animate-spin mx-auto mb-3" />
              <p className="text-xs text-amber-200/70 font-semibold">Loading discount pricing matrix from Firestore...</p>
            </div>
          ) : filteredRules.length === 0 ? (
            /* Empty State */
            <div className="p-12 text-center rounded-2xl bg-[#110e08] border border-amber-500/40 shadow-[0_0_18px_rgba(245,158,11,0.12)] space-y-4">
              <div className="w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-400 flex items-center justify-center mx-auto shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                <Wallet className="w-8 h-8 text-amber-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-amber-50">No discount prices yet</h3>
                <p className="text-xs text-amber-200/70 max-w-md mx-auto">
                  {searchQuery || createdFromDate || createdToDate
                    ? 'No discount pricing rules matched your filter criteria. Try resetting search or dates.'
                    : 'Add your first discount pricing rule using the + Add Discount Price button.'}
                </p>
              </div>
              <AppLink
                to="/harga-diskon/tambah"
                onClick={handleOpenAddForm}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 hover:brightness-110 text-black text-xs font-black border border-amber-300/60 transition shadow-[0_0_15px_rgba(245,158,11,0.35)] cursor-pointer"
              >
                <Plus className="w-4 h-4 text-black" />
                <span>+ Add Discount Price</span>
              </AppLink>
            </div>
          ) : (
            /* Populated Table State */
            <div className="rounded-2xl bg-[#110e08] border border-amber-500/40 shadow-[0_0_18px_rgba(245,158,11,0.12)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-[#16120b] border-b border-amber-500/40 text-amber-300 uppercase text-[10px] tracking-wider whitespace-nowrap font-bold">
                      <th className="py-3 px-4">Product Name</th>
                      <th className="py-3 px-3">Customer Type</th>
                      <th className="py-3 px-3 text-center">Min Qty</th>
                      <th className="py-3 px-3 text-right">Normal Price</th>
                      <th className="py-3 px-3 text-right">Discount Price</th>
                      <th className="py-3 px-3 text-right">Margin / Unit</th>
                      <th className="py-3 px-3 text-center">Points (% of Profit)</th>
                      <th className="py-3 px-3 text-center">Status</th>
                      <th className="py-3 px-4 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-500/15 text-amber-100">
                    {filteredRules.map((r) => {
                      const isProfitPositive = r.marginProfit > 0;
                      return (
                        <tr
                          key={r.id}
                          className="hover:bg-amber-500/10 transition-colors group whitespace-nowrap"
                        >
                          {/* Product Name */}
                          <td className="py-3 px-4">
                            <div className="font-bold text-amber-50 group-hover:text-amber-300 transition-colors">
                              {r.productName}
                            </div>
                            {r.productSku && (
                              <div className="text-[10px] text-amber-200/50 font-mono">
                                SKU: {r.productSku}
                              </div>
                            )}
                          </td>

                          {/* Customer Type Badge */}
                          <td className="py-3 px-3">
                            <span className="px-2 py-0.5 rounded-full font-bold text-[10px] uppercase tracking-wide border bg-amber-500/15 border-amber-500/40 text-amber-300">
                              {r.customerTypeName}
                            </span>
                          </td>

                          {/* Min Qty */}
                          <td className="py-3 px-3 text-center font-mono font-bold text-amber-50">
                            &ge; {r.minQty}
                          </td>

                          {/* Normal Price */}
                          <td className="py-3 px-3 text-right font-mono text-amber-200/50 line-through">
                            {formatMoney(r.normalPrice)}
                          </td>

                          {/* Discount Price */}
                          <td className="py-3 px-3 text-right font-mono font-bold text-amber-400">
                            {formatMoney(r.discountPrice)}
                          </td>

                          {/* Margin / Profit */}
                          <td className="py-3 px-3 text-right font-mono font-bold">
                            <span className={isProfitPositive ? 'text-amber-300' : 'text-rose-400'}>
                              {formatMoney(r.marginProfit)}
                            </span>
                          </td>

                          {/* Points */}
                          <td className="py-3 px-3 text-center">
                            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-bold">
                              <Award className="w-3 h-3 text-amber-400" />
                              <span>{r.pointPercent}%</span>
                              <span className="text-amber-200/70">({r.pointsReward} pts)</span>
                            </div>
                          </td>

                          {/* Status */}
                          <td className="py-3 px-3 text-center">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] ${
                                r.status === 'active'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/45'
                                  : 'bg-[#16120b] text-amber-200/50 border border-amber-500/25'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  r.status === 'active' ? 'bg-amber-400 animate-pulse' : 'bg-amber-500/40'
                                }`}
                              />
                              <span className="capitalize">{r.status}</span>
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 text-center relative action-menu-container">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => setDetailRule(r)}
                                className="p-1.5 rounded-lg bg-[#080705] border border-amber-500/35 hover:bg-amber-500/20 text-amber-200 hover:text-amber-300 transition cursor-pointer"
                                title="Lihat Detail Harga Diskon"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleOpenEditForm(r)}
                                className="p-1.5 rounded-lg bg-[#080705] border border-amber-500/35 hover:bg-amber-500/20 text-amber-200 hover:text-amber-400 transition cursor-pointer"
                                title="Edit Discount Price"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteRule(r.id!)}
                                className="p-1.5 rounded-lg bg-[#080705] border border-amber-500/35 hover:bg-rose-950/60 hover:border-rose-800 text-amber-200/70 hover:text-rose-300 transition cursor-pointer"
                                title="Delete Rule"
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

              {/* Table Footer Count */}
              <div className="p-3 border-t border-amber-500/30 bg-[#080705] flex items-center justify-between text-[11px] text-amber-200/70 px-4">
                <span>
                  Showing <strong className="text-amber-300">{filteredRules.length}</strong> rule{filteredRules.length === 1 ? '' : 's'}
                </span>
                <span className="font-mono text-[10px] text-amber-200/50">Firestore: stores/store_001/discount_prices</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 2: ADD / EDIT DISCOUNT PRICE FORM */}
      {/* ========================================================================= */}
      {view === 'add_form' && (
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Form Header */}
          <div className="flex items-center justify-between p-5 rounded-2xl bg-[#110e08] border border-amber-500/40 shadow-[0_0_18px_rgba(245,158,11,0.12)]">
            <div className="space-y-1">
              <h2 className="text-xl font-black text-amber-50 tracking-tight flex items-center gap-2">
                <Tag className="w-5 h-5 text-amber-400" />
                <span>{editingRuleId ? 'Edit Discount Price' : 'Add Discount Price'}</span>
              </h2>
              <p className="text-xs text-amber-200/70">
                Configure special pricing tier rules. Profit margin and loyalty points calculate in real-time.
              </p>
            </div>

            <AppLink
              to="/harga-diskon"
              onClick={resetForm}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#080705] border border-amber-500/40 hover:bg-[#16120b] text-amber-200 hover:text-amber-100 text-xs font-semibold transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-amber-400" />
              <span>Back (Kembali)</span>
            </AppLink>
          </div>

          {/* Form Container */}
          <form
            onSubmit={handleSubmitForm}
            className="p-6 rounded-2xl bg-[#110e08] border border-amber-500/40 shadow-[0_0_18px_rgba(245,158,11,0.12)] space-y-6"
          >
            {/* 2-Column Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Col 1: Product Name Combobox */}
              <div className="space-y-1.5 relative product-combobox-container">
                <label className="block text-xs font-bold text-amber-100">
                  Product Name * <span className="text-amber-400">(Nama Produk *)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search or pick product..."
                    value={productSearchInput}
                    onFocus={() => setIsProductDropdownOpen(true)}
                    onChange={(e) => {
                      setProductSearchInput(e.target.value);
                      setIsProductDropdownOpen(true);
                    }}
                    className={`w-full bg-[#080705] border ${
                      formErrors.product ? 'border-rose-500' : 'border-amber-500/40 focus:border-amber-400'
                    } rounded-xl px-3 py-2 text-xs text-amber-50 placeholder-amber-200/35 focus:outline-none transition`}
                  />
                  <Search className="w-3.5 h-3.5 text-amber-400/70 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                {formErrors.product && (
                  <p className="text-[10px] text-rose-400">{formErrors.product}</p>
                )}

                {/* Combobox Dropdown */}
                {isProductDropdownOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 max-h-56 overflow-y-auto bg-[#080705] border border-amber-500/40 rounded-xl shadow-2xl z-30 divide-y divide-amber-500/15 custom-scrollbar">
                    {filteredProducts.length === 0 ? (
                      <div className="p-3 text-center text-xs text-amber-200/50">No products found</div>
                    ) : (
                      filteredProducts.map((p) => (
                        <div
                          key={p.id}
                          onClick={() => handleSelectProduct(p)}
                          className="p-2.5 hover:bg-amber-500/15 cursor-pointer transition-colors flex items-center justify-between text-xs"
                        >
                          <div>
                            <div className="font-bold text-amber-50">{p.name}</div>
                            <div className="text-[10px] text-amber-200/60">
                              SKU: {p.sku} &bull; Stock: {p.stockInUnits}
                            </div>
                          </div>
                          <div className="text-right font-mono">
                            <span className="text-amber-400 font-bold block">{formatMoney(p.pricePerUnit)}</span>
                            <span className="text-[10px] text-amber-200/60">
                              Modal: {formatMoney(p.costPerUnit)}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Col 2: Customer Type Dropdown */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-amber-100">
                  Customer Type <span className="text-amber-200/60">(Tipe Pelanggan)</span>
                </label>
                <select
                  value={selectedCustomerTypeId}
                  onChange={(e) => setSelectedCustomerTypeId(e.target.value)}
                  className="w-full bg-[#080705] border border-amber-500/40 focus:border-amber-400 rounded-xl px-3 py-2 text-xs text-amber-50 focus:outline-none transition [color-scheme:dark]"
                >
                  {customerTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.code}) &mdash; Diskon Dasar {t.discountRate}%
                    </option>
                  ))}
                </select>
              </div>

              {/* Col 1: Normal Price (Auto Read-only) */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-amber-200/80">
                  Normal Price (Auto) <span className="text-amber-200/50">(Harga Normal Otomatis)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    disabled
                    value={formatMoney(normalPrice)}
                    className="w-full bg-[#080705] border border-amber-500/30 rounded-xl px-3 py-2 text-xs text-amber-200/70 font-mono font-bold cursor-not-allowed"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-amber-400/70 uppercase font-mono">
                    Retail
                  </span>
                </div>
              </div>

              {/* Col 2: Discount Price Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-amber-100">
                  Discount Price * <span className="text-amber-400">(Harga Diskon Khusus *)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  placeholder="e.g. 22000"
                  value={discountPriceInput}
                  onChange={(e) => {
                    setDiscountPriceInput(e.target.value);
                    if (formErrors.discountPrice) {
                      setFormErrors((prev) => ({ ...prev, discountPrice: '' }));
                    }
                  }}
                  className={`w-full bg-[#080705] border ${
                    formErrors.discountPrice ? 'border-rose-500' : 'border-amber-500/40 focus:border-amber-400'
                  } rounded-xl px-3 py-2 text-xs text-amber-50 font-mono font-bold placeholder-amber-200/35 focus:outline-none transition`}
                />
                {formErrors.discountPrice && (
                  <p className="text-[10px] text-rose-400">{formErrors.discountPrice}</p>
                )}
              </div>

              {/* Col 1: Minimum Qty Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-amber-100">
                  Minimum Qty <span className="text-amber-200/60">(Minimal Pembelian)</span>
                </label>
                <input
                  type="number"
                  min="1"
                  value={minQtyInput}
                  onChange={(e) => {
                    setMinQtyInput(e.target.value);
                    if (formErrors.minQty) {
                      setFormErrors((prev) => ({ ...prev, minQty: '' }));
                    }
                  }}
                  className="w-full bg-[#080705] border border-amber-500/40 focus:border-amber-400 rounded-xl px-3 py-2 text-xs text-amber-50 font-mono font-bold focus:outline-none transition"
                />
              </div>

              {/* Col 2: Profit Margin (Auto Read-only) */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-amber-200/80">
                  Profit Margin (Auto) <span className="text-amber-200/50">(Keuntungan / Margin per Unit)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    disabled
                    value={formatMoney(marginProfitPerUnit)}
                    className={`w-full bg-[#080705] border border-amber-500/30 rounded-xl px-3 py-2 text-xs font-mono font-bold cursor-not-allowed ${
                      marginProfitPerUnit >= 0 ? 'text-amber-400' : 'text-rose-400'
                    }`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-amber-200/60 font-mono">
                    Modal: {formatMoney(costPrice)}
                  </span>
                </div>
              </div>

              {/* Col 1: Point Percent Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-amber-100">
                  Points Allocation (%) <span className="text-amber-200/60">(% Poin dari Keuntungan)</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={pointPercentInput}
                    onChange={(e) => setPointPercentInput(e.target.value)}
                    className="w-full bg-[#080705] border border-amber-500/40 focus:border-amber-400 rounded-xl px-3 py-2 text-xs text-amber-50 font-mono font-bold focus:outline-none transition"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-400 text-xs font-bold">
                    %
                  </span>
                </div>
              </div>

              {/* Col 2: Points Reward (Auto Calculated) */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-amber-200/80">
                  Points Reward (Auto) <span className="text-amber-200/50">(Poin per Transaksi Satuan)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    disabled
                    value={`${calculatedPointsReward} Points`}
                    className="w-full bg-[#080705] border border-amber-500/30 rounded-xl px-3 py-2 text-xs text-amber-400 font-mono font-bold cursor-not-allowed"
                  />
                  <Award className="w-3.5 h-3.5 text-amber-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Status Toggle */}
              <div className="space-y-1.5 md:col-span-2">
                <label className="block text-xs font-bold text-amber-100">
                  Rule Status <span className="text-amber-200/60">(Status Aktif)</span>
                </label>
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="status"
                      checked={ruleStatus === 'active'}
                      onChange={() => setRuleStatus('active')}
                      className="text-amber-500 focus:ring-0"
                    />
                    <span className="text-xs text-amber-300 font-semibold flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-400" />
                      Active (Berlaku di Kasir)
                    </span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer ml-4">
                    <input
                      type="radio"
                      name="status"
                      checked={ruleStatus === 'inactive'}
                      onChange={() => setRuleStatus('inactive')}
                      className="text-amber-500 focus:ring-0"
                    />
                    <span className="text-xs text-amber-200/60 font-semibold flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500/40" />
                      Inactive (Nonaktif)
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Financial Rule Summary Banner */}
            <div className="p-4 rounded-xl bg-gradient-to-r from-[#16120b] via-[#110e08] to-[#080705] border border-amber-500/45 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-[0_0_15px_rgba(245,158,11,0.1)]">
              <div className="space-y-0.5">
                <span className="font-bold text-amber-50 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Rule Simulation Summary</span>
                </span>
                <p className="text-[11px] text-amber-200/70">
                  Customer tier receives {formatMoney(normalPrice - discountPriceNum)} discount per unit at min {minQtyNum} units.
                </p>
              </div>

              <div className="flex items-center gap-4 text-xs font-mono">
                <div>
                  <span className="text-[10px] text-amber-200/60 block uppercase">Profit/Unit</span>
                  <span className={`font-bold ${marginProfitPerUnit >= 0 ? 'text-amber-400' : 'text-rose-400'}`}>
                    {formatMoney(marginProfitPerUnit)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-amber-200/60 block uppercase">Points</span>
                  <span className="font-bold text-amber-300">+{calculatedPointsReward} pts</span>
                </div>
              </div>
            </div>

            {/* Actions: Save / Cancel */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-amber-500/30">
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setView('directory');
                }}
                className="px-4 py-2 rounded-xl bg-[#080705] border border-amber-500/40 hover:bg-[#16120b] text-amber-200 hover:text-amber-100 text-xs font-semibold transition cursor-pointer"
              >
                Cancel (Batal)
              </button>

              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 hover:brightness-110 text-black text-xs font-black border border-amber-300/60 shadow-[0_0_15px_rgba(245,158,11,0.35)] transition-all cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-black" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5 text-black" />
                    <span>{editingRuleId ? 'Update Rule' : 'Save Discount Price'}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: DETAIL DISCOUNT RULE */}
      {detailRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#110e08] border border-amber-500/40 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-[0_0_24px_rgba(245,158,11,0.2)]">
            <div className="flex items-center justify-between border-b border-amber-500/30 pb-3">
              <div>
                <h3 className="font-bold text-amber-50 text-base">{detailRule.productName}</h3>
                <span className="text-xs font-mono text-amber-400">{detailRule.customerTypeName}</span>
              </div>
              <button
                onClick={() => setDetailRule(null)}
                className="p-1 rounded-lg text-amber-200/70 hover:text-amber-100 hover:bg-[#16120b] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1.5 border-b border-amber-500/20">
                <span className="text-amber-200/70">Minimal Kuantitas:</span>
                <span className="font-mono font-bold text-amber-50">{detailRule.minQty} pcs</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-amber-500/20">
                <span className="text-amber-200/70">Modal HPP per Unit:</span>
                <span className="font-mono text-amber-100">Rp {Number(detailRule.costPrice || 0).toLocaleString('id-ID')}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-amber-500/20">
                <span className="text-amber-200/70">Harga Jual Normal:</span>
                <span className="font-mono text-amber-200/50 line-through">Rp {Number(detailRule.normalPrice || 0).toLocaleString('id-ID')}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-amber-500/20">
                <span className="text-amber-200/70">Harga Diskon Tier:</span>
                <span className="font-mono font-bold text-amber-400 text-sm">
                  Rp {Number(detailRule.discountPrice || 0).toLocaleString('id-ID')}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-amber-500/20">
                <span className="text-amber-200/70">Margin Laba per Unit:</span>
                <span className="font-mono font-bold text-amber-300">
                  Rp {Number(detailRule.marginProfit || 0).toLocaleString('id-ID')} ({Number(detailRule.pointPercent || 0).toFixed(1)}% Poin)
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-amber-500/20">
                <span className="text-amber-200/70">Bonus Poin:</span>
                <span className="font-mono font-bold text-amber-400">{detailRule.pointsReward || 0} Pts</span>
              </div>
            </div>
            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => {
                  const r = detailRule;
                  setDetailRule(null);
                  handleOpenEditForm(r);
                }}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 text-black text-xs font-black cursor-pointer"
              >
                Edit Aturan
              </button>
              <button
                onClick={() => setDetailRule(null)}
                className="px-4 py-2 rounded-xl bg-[#16120b] border border-amber-500/40 hover:bg-amber-500/20 text-amber-100 text-xs font-bold cursor-pointer"
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
