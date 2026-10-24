import React, { useState, useEffect, useMemo } from 'react';
import {
  Truck,
  FileText,
  FileCheck,
  ShoppingBag,
  BarChart3,
  Plus,
  Search,
  Phone,
  Mail,
  Building,
  CheckCircle,
  Clock,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  X,
  Edit2,
  Trash2,
  Eye,
  ChevronLeft,
  ChevronDown,
  Calendar,
  DollarSign,
  Package,
  Layers,
  CheckCircle2,
  Save,
  RotateCcw,
  Send,
  ArrowUpRight,
  ShieldCheck,
  Percent,
  Warehouse,
  FileSpreadsheet,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  addDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Product } from '../../types';
import { ACTIVE_STORE_ID } from '../../config/store';
import { useFirestoreList } from '../../hooks/useFirestoreList';
import { useAppNavigation } from '../../router';
import { formatMoney } from '../../utils/money';
import { openTransactionDetailModal } from '../common/GlobalModals';
import {
  generateAutoBatchCode,
  getDefaultProductionAndExpiryDates,
  mergeBatchIntoProduct,
  evaluateProductExpiry,
} from '../../utils/expiryUtils';

interface ProcurementModuleProps {
  subModule:
    | 'daftar_supplier'
    | 'daftar_pembelian'
    | 'request_pembelian'
    | 'pembelian_produk'
    | 'statistik_pembelian';
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

// 1. Direct Purchase Cart Item (Pembelian Barang Kasir / Retail - Multi-Batch FEFO)
export interface PurchaseCartItem {
  productId: string;
  productName: string;
  sku: string;
  barcode?: string;
  category?: string;
  currentStockInUnits: number;
  piecesPerCarton: number;
  unit: 'Pcs' | 'Karton';
  batchCode: string;
  productionDate: string;
  expiryDate: string;
  qty: number;
  buyPrice: number;
  subtotal: number;
}

// 2. Internal Purchase Requisition Item (PR)
export interface PrCartItem {
  productId: string;
  productName: string;
  sku: string;
  currentStock: number;
  minStock: number;
  piecesPerCarton: number;
  unit: 'Pcs' | 'Karton';
  qty: number;
  estimatedPrice: number;
  subtotal: number;
}

// 3. B2B Purchase Order Item (PO Resmi Kontrak Supplier)
export interface PoCartItem {
  productId: string;
  productName: string;
  sku: string;
  piecesPerCarton: number;
  unit: 'Karton' | 'Pcs';
  batchCode: string;
  productionDate: string;
  expiryDate: string;
  qty: number;
  contractPrice: number;
  discountPercent: number;
  subtotal: number;
}

const INITIAL_SUPPLIERS: any[] = [];
const INITIAL_PURCHASE_REQUESTS: any[] = [];

export const PO_PAYMENT_METHODS = [
  'Brangkas Toko',
  'Brangkas Modal',
  'Brangkas Untung',
  'Uang Mamang',
  'Uang Bapak',
  'Bonus',
  'Lainnya',
] as const;

export const ProcurementModule: React.FC<ProcurementModuleProps> = ({
  subModule,
  currencyMode = 'IDR',
  onNavigateTab,
}) => {
  const { route, navigateTab } = useAppNavigation();
  const activeSub = (
    route.activeTab === 'module_procurement' ? route.activeSubModule : subModule
  ) as
    | 'daftar_supplier'
    | 'daftar_pembelian'
    | 'request_pembelian'
    | 'pembelian_produk'
    | 'statistik_pembelian';

  const setActiveSub = (
    next:
      | 'daftar_supplier'
      | 'daftar_pembelian'
      | 'request_pembelian'
      | 'pembelian_produk'
      | 'statistik_pembelian'
  ) => {
    navigateTab('module_procurement', next);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Helper toast notification
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  // 1. Real-time Products list for "Cari Produk" auto-complete & stock update
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'products'),
      (snap) => {
        const list: Product[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          list.push({
            id: d.id,
            storeId: data.storeId || ACTIVE_STORE_ID,
            name: data.name || '',
            sku: data.sku || d.id,
            category: data.category || 'MINERAL',
            brand: data.brand || '',
            barcode: data.barcode || '',
            piecesPerCarton: Number(data.piecesPerCarton || 24),
            stockInUnits: Number(data.stockInUnits ?? data.stock ?? 0),
            costPerUnit: Number(data.costPerUnit ?? data.costPrice ?? 0),
            pricePerUnit: Number(data.pricePerUnit ?? data.price ?? 0),
            pricePerCarton: Number(data.pricePerCarton ?? data.price ?? 0),
            minStockAlert: Number(data.minStockAlert ?? 10),
            imageUrl: data.imageUrl || '',
            storageLocation: data.storageLocation || 'Rak Toko',
            productionDate: data.productionDate || data.tanggalProduksi || '',
            expiryDate: data.expiryDate || data.tanggalKadaluarsa || '',
            batches: Array.isArray(data.batches) ? data.batches : [],
          });
        });
        setProducts(list);
      },
      (err) => console.warn('Products sync warning in ProcurementModule:', err)
    );
    return () => unsub();
  }, []);

  // 2. Suppliers from Firestore via useFirestoreList
  const {
    data: suppliers,
    addItem: addSupplier,
    updateItem: updateSupplier,
    deleteItem: deleteSupplier,
  } = useFirestoreList('suppliers', INITIAL_SUPPLIERS);

  // 3. Purchase Requests (PR) from Firestore
  const {
    data: purchaseRequests,
    addItem: addPurchaseRequest,
    updateItem: updatePurchaseRequest,
    deleteItem: deletePurchaseRequest,
  } = useFirestoreList('purchase_requests', INITIAL_PURCHASE_REQUESTS);

  // 4. Purchase Orders (PO) from Firestore
  const {
    data: orders,
    addItem: addOrderDoc,
    updateItem: updateOrderDoc,
    deleteItem: deleteOrderDoc,
  } = useFirestoreList<any>('purchase_orders', []);

  // 5. Finance Mutations & Cash Flows from Firestore (with instant local cache sync)
  const { addItem: addFinanceMutation } = useFirestoreList<any>('finance_mutations', []);
  const { addItem: addCashFlow } = useFirestoreList<any>('cash_flows', []);

  // Default date helpers
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // =========================================================================
  // STATE A: Form "Pembelian Barang" (activeSub === 'pembelian_produk')
  // =========================================================================
  const defaultHeaderDates = useMemo(() => getDefaultProductionAndExpiryDates(), []);
  const [purchaseSupplier, setPurchaseSupplier] = useState<string>('');
  const [supplierSearchQuery, setSupplierSearchQuery] = useState<string>('');
  const [showSupplierDropdown, setShowSupplierDropdown] = useState<boolean>(false);
  const [purchaseDate, setPurchaseDate] = useState<string>(todayStr);
  const [purchaseProductionDate, setPurchaseProductionDate] = useState<string>(
    defaultHeaderDates.productionDate
  );
  const [purchaseExpiryDate, setPurchaseExpiryDate] = useState<string>(
    defaultHeaderDates.expiryDate
  );

  const [productSearchQuery, setProductSearchQuery] = useState<string>('');
  const [showProductDropdown, setShowProductDropdown] = useState<boolean>(false);
  const [cartItems, setCartItems] = useState<PurchaseCartItem[]>([]);

  const [purchaseNotes, setPurchaseNotes] = useState<string>('');
  const [addToStock, setAddToStock] = useState<boolean>(true); // Default: Ya

  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [selectedPaymentType, setSelectedPaymentType] = useState<string>('Tanpa Pemb');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('Brangkas Toko');
  const [isSubmittingOrder, setIsSubmittingOrder] = useState<boolean>(false);

  // =========================================================================
  // STATE B: Form "Request Pembelian (PR)" (activeSub === 'request_pembelian')
  // =========================================================================
  const [prRequester, setPrRequester] = useState<string>('Kasir Shift 1');
  const [prDepartment, setPrDepartment] = useState<string>('Etalase Toko Utama');
  const [prDate, setPrDate] = useState<string>(todayStr);
  const [prTargetDate, setPrTargetDate] = useState<string>(
    new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toISOString().slice(0, 10)
  );
  const [prUrgency, setPrUrgency] = useState<string>('Tinggi (Stok Kritis / Habis)');
  const [prApprover, setPrApprover] = useState<string>('Manager Operasional Toko');
  const [prNotifyManager, setPrNotifyManager] = useState<boolean>(true);

  const [prProductSearch, setPrProductSearch] = useState<string>('');
  const [showPrProductDropdown, setShowPrProductDropdown] = useState<boolean>(false);
  const [prCartItems, setPrCartItems] = useState<PrCartItem[]>([]);
  const [prNotes, setPrNotes] = useState<string>('');
  const [isSubmittingPr, setIsSubmittingPr] = useState<boolean>(false);

  // =========================================================================
  // STATE C: Form "Penerbitan PO Resmi Supplier" (activeSub === 'daftar_pembelian')
  // =========================================================================
  const [poSupplier, setPoSupplier] = useState<string>('');
  const [poSupplierSearch, setPoSupplierSearch] = useState<string>('');
  const [showPoSupplierDropdown, setShowPoSupplierDropdown] = useState<boolean>(false);
  const [poDocNumber, setPoDocNumber] = useState<string>(`PO-${Date.now().toString().slice(-6)}`);
  const [poDate, setPoDate] = useState<string>(todayStr);
  const [poProductionDate, setPoProductionDate] = useState<string>(
    defaultHeaderDates.productionDate
  );
  const [poExpiryDate, setPoExpiryDate] = useState<string>(
    defaultHeaderDates.expiryDate
  );
  const [poExpectedDate, setPoExpectedDate] = useState<string>(
    new Date(Date.now() + 1000 * 60 * 60 * 24 * 2).toISOString().slice(0, 10)
  );
  const [poPaymentTerms, setPoPaymentTerms] = useState<string>('Tempo 30 Hari');
  const [poWarehouse, setPoWarehouse] = useState<string>('Gudang Utama Toko');
  const [poProductSearch, setPoProductSearch] = useState<string>('');
  const [showPoProductDropdown, setShowPoProductDropdown] = useState<boolean>(false);
  const [poCartItems, setPoCartItems] = useState<PoCartItem[]>([]);
  const [poTaxRate, setPoTaxRate] = useState<number>(0); // 0 or 11%
  const [poShippingFee, setPoShippingFee] = useState<number>(0);
  const [poDpAmount, setPoDpAmount] = useState<number>(0);
  const [poDpPaymentMethod, setPoDpPaymentMethod] = useState<string>('Brangkas Toko');
  const [poVendorNotes, setPoVendorNotes] = useState<string>('');
  const [poIsOfficialActive, setPoIsOfficialActive] = useState<boolean>(true); // Ya / Draf
  const [isSubmittingPo, setIsSubmittingPo] = useState<boolean>(false);

  // Detail Modal State
  const [detailModal, setDetailModal] = useState<{
    title: string;
    data: Record<string, any>;
  } | null>(null);

  // PO Debt Payment Modal State (payPoModal & payPoMethod initialized to 'Brangkas Toko')
  const [payPoModal, setPayPoModal] = useState<{
    id: string;
    poNumber: string;
    supplierName: string;
    supplier: string;
    totalAmount: number;
    paidAmount: number;
    remainingDebt: number;
    paymentStatus?: string;
    po: any;
  } | null>(null);
  const [payPoAmount, setPayPoAmount] = useState<number>(0);
  const [payPoMethod, setPayPoMethod] = useState<string>('Brangkas Toko');

  const openPayPoModal = (po: any) => {
    const debt = Number(
      po.remainingDebt ??
        (po.paymentStatus?.toLowerCase().includes('tempo') ? po.totalAmount : 0) ??
        0
    );
    const paid = Number(
      po.paidAmount ??
        (po.paymentStatus?.toLowerCase().includes('tempo') ? 0 : po.totalAmount) ??
        0
    );
    const poNum = po.poNumber || po.id || 'PO';
    const supName = po.supplierName || po.supplier || 'Supplier Umum';
    setPayPoModal({
      id: po.id,
      poNumber: poNum,
      supplierName: supName,
      supplier: supName,
      totalAmount: Number(po.totalAmount || 0),
      paidAmount: paid,
      remainingDebt: debt,
      paymentStatus: po.paymentStatus,
      po,
    });
    setPayPoAmount(debt);
    setPayPoMethod('Brangkas Toko');
  };

  // Supplier modal states
  const [showAddSupplierModal, setShowAddSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<any | null>(null);
  const [newSupName, setNewSupName] = useState('');
  const [newSupCategory, setNewSupCategory] = useState('');
  const [newSupContact, setNewSupContact] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');
  const [newSupTerms, setNewSupTerms] = useState('Tempo 30 Hari');
  const [newSupLeadTime, setNewSupLeadTime] = useState<number>(2);
  const [newSupRating, setNewSupRating] = useState<number>(5.0);

  // =========================================================================
  // CALCULATIONS
  // =========================================================================

  // A. Pembelian Produk (Direct) Calculations
  const totalAmount = useMemo(() => {
    return cartItems.reduce((acc, item) => acc + item.subtotal, 0);
  }, [cartItems]);

  const totalQty = useMemo(() => {
    return cartItems.reduce((acc, item) => acc + item.qty, 0);
  }, [cartItems]);

  const remainingDebt = useMemo(() => {
    return Math.max(0, totalAmount - (Number(paidAmount) || 0));
  }, [totalAmount, paidAmount]);

  const handlePaymentTypeChange = (type: string) => {
    setSelectedPaymentType(type);
    if (type === 'Tanpa Pemb') {
      setPaidAmount(0);
    } else if (type === 'Bayar Penuh') {
      setPaidAmount(totalAmount);
    }
  };

  // B. Request Pembelian (PR) Calculations
  const totalPrBudget = useMemo(() => {
    return prCartItems.reduce((acc, item) => acc + item.subtotal, 0);
  }, [prCartItems]);

  const totalPrQty = useMemo(() => {
    return prCartItems.reduce((acc, item) => acc + item.qty, 0);
  }, [prCartItems]);

  // C. B2B Purchase Order (PO) Calculations
  const poSubtotal = useMemo(() => {
    return poCartItems.reduce((acc, item) => acc + item.subtotal, 0);
  }, [poCartItems]);

  const totalPoCartons = useMemo(() => {
    return poCartItems.reduce((acc, item) => acc + item.qty, 0);
  }, [poCartItems]);

  const poTaxAmount = useMemo(() => {
    return Math.round((poSubtotal * poTaxRate) / 100);
  }, [poSubtotal, poTaxRate]);

  const poGrandTotal = useMemo(() => {
    return poSubtotal + poTaxAmount + (Number(poShippingFee) || 0);
  }, [poSubtotal, poTaxAmount, poShippingFee]);

  const poRemainingDebt = useMemo(() => {
    return Math.max(0, poGrandTotal - (Number(poDpAmount) || 0));
  }, [poGrandTotal, poDpAmount]);

  // =========================================================================
  // AUTOCOMPLETE PRODUCT SEARCH
  // =========================================================================
  const matchedProducts = useMemo(() => {
    if (!productSearchQuery.trim()) return [];
    const q = productSearchQuery.toLowerCase().trim();
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q))
      )
      .slice(0, 10);
  }, [products, productSearchQuery]);

  const matchedPrProducts = useMemo(() => {
    if (!prProductSearch.trim()) return [];
    const q = prProductSearch.toLowerCase().trim();
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q))
      )
      .slice(0, 10);
  }, [products, prProductSearch]);

  const matchedPoProducts = useMemo(() => {
    if (!poProductSearch.trim()) return [];
    const q = poProductSearch.toLowerCase().trim();
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q))
      )
      .slice(0, 10);
  }, [products, poProductSearch]);

  // Suppliers autocomplete
  const matchedSuppliers = useMemo(() => {
    if (!supplierSearchQuery.trim()) return suppliers.slice(0, 8);
    const q = supplierSearchQuery.toLowerCase().trim();
    return suppliers.filter(
      (s) =>
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.category && s.category.toLowerCase().includes(q))
    );
  }, [suppliers, supplierSearchQuery]);

  const matchedPoSuppliers = useMemo(() => {
    if (!poSupplierSearch.trim()) return suppliers.slice(0, 8);
    const q = poSupplierSearch.toLowerCase().trim();
    return suppliers.filter(
      (s) =>
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.category && s.category.toLowerCase().includes(q))
    );
  }, [suppliers, poSupplierSearch]);

  // =========================================================================
  // CART HANDLERS
  // =========================================================================

  // Sync header Tanggal Produksi & Tanggal Expired to cartItems
  const handleChangeHeaderProductionDate = (val: string) => {
    setPurchaseProductionDate(val);
    setCartItems((prev) =>
      prev.map((item) => ({
        ...item,
        productionDate: val,
      }))
    );
  };

  const handleChangeHeaderExpiryDate = (val: string) => {
    setPurchaseExpiryDate(val);
    setCartItems((prev) =>
      prev.map((item) => ({
        ...item,
        expiryDate: val,
      }))
    );
  };

  // 1. Direct Purchase Cart (Multi-Batch FEFO)
  const handleAddProductToCart = (p: Product) => {
    const piecesPerCarton = p.piecesPerCarton || 24;
    const defaultCartonPrice =
      p.pricePerCarton || (p.costPerUnit ? p.costPerUnit * piecesPerCarton : 65000);
    const fallbackDates = getDefaultProductionAndExpiryDates(p);
    const productionDate = purchaseProductionDate || fallbackDates.productionDate;
    const expiryDate = purchaseExpiryDate || fallbackDates.expiryDate;
    const nextBatchIndex = cartItems.length + 1;
    const autoBatch = generateAutoBatchCode(nextBatchIndex, purchaseDate || todayStr);

    const newItem: PurchaseCartItem = {
      productId: p.id,
      productName: p.name,
      sku: p.sku,
      barcode: p.barcode,
      category: p.category,
      currentStockInUnits: Number(p.stockInUnits || 0),
      piecesPerCarton,
      unit: 'Karton',
      batchCode: autoBatch,
      productionDate,
      expiryDate,
      qty: 1,
      buyPrice: defaultCartonPrice,
      subtotal: 1 * defaultCartonPrice,
    };
    setCartItems((prev) => [...prev, newItem]);

    setProductSearchQuery('');
    setShowProductDropdown(false);
  };

  // Duplicate / Split a cart item into a new Batch Row (+ Pecah Batch)
  const handleSplitCartItemBatch = (index: number) => {
    setCartItems((prev) => {
      const target = prev[index];
      if (!target) return prev;
      const nextBatchIndex = prev.length + 1;
      const nextBatchCode = generateAutoBatchCode(nextBatchIndex, purchaseDate || todayStr);
      const splitRow: PurchaseCartItem = {
        ...target,
        batchCode: nextBatchCode,
        qty: 1,
        subtotal: 1 * target.buyPrice,
      };
      const nextList = [...prev];
      nextList.splice(index + 1, 0, splitRow);
      return nextList;
    });
    showToast('Baris batch baru ditambahkan! Sesuaikan Kode Batch & Tgl Expired untuk kardus kedua.');
  };

  const handleUpdateCartItem = (
    index: number,
    field: 'qty' | 'buyPrice' | 'unit' | 'batchCode' | 'productionDate' | 'expiryDate',
    value: any
  ) => {
    setCartItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const updated = { ...item };
        if (field === 'qty') {
          updated.qty = Math.max(1, Number(value) || 1);
        } else if (field === 'buyPrice') {
          updated.buyPrice = Math.max(0, Number(value) || 0);
        } else if (field === 'batchCode') {
          updated.batchCode = String(value);
        } else if (field === 'productionDate') {
          updated.productionDate = String(value);
        } else if (field === 'expiryDate') {
          updated.expiryDate = String(value);
        } else if (field === 'unit') {
          const nextUnit = value as 'Pcs' | 'Karton';
          if (nextUnit !== updated.unit) {
            const ratio = updated.piecesPerCarton || 24;
            if (nextUnit === 'Karton') {
              updated.buyPrice = updated.buyPrice * ratio;
            } else {
              updated.buyPrice = Math.round(updated.buyPrice / ratio);
            }
            updated.unit = nextUnit;
          }
        }
        updated.subtotal = updated.qty * updated.buyPrice;
        return updated;
      })
    );
  };

  const handleRemoveCartItem = (index: number) => {
    setCartItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  // 2. PR Cart
  const handleAddProductToPrCart = (p: Product) => {
    const existingIndex = prCartItems.findIndex((item) => item.productId === p.id);
    const defaultEstPrice = p.costPerUnit || p.pricePerUnit || 10000;

    if (existingIndex >= 0) {
      setPrCartItems((prev) =>
        prev.map((item, idx) => {
          if (idx === existingIndex) {
            const nextQty = item.qty + 1;
            return {
              ...item,
              qty: nextQty,
              subtotal: nextQty * item.estimatedPrice,
            };
          }
          return item;
        })
      );
    } else {
      const newItem: PrCartItem = {
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        currentStock: p.stockInUnits,
        minStock: p.minStockAlert,
        piecesPerCarton: p.piecesPerCarton || 24,
        unit: 'Pcs',
        qty: 1,
        estimatedPrice: defaultEstPrice,
        subtotal: 1 * defaultEstPrice,
      };
      setPrCartItems((prev) => [...prev, newItem]);
    }

    setPrProductSearch('');
    setShowPrProductDropdown(false);
  };

  const handleUpdatePrCartItem = (
    index: number,
    field: 'qty' | 'estimatedPrice' | 'unit',
    value: any
  ) => {
    setPrCartItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const updated = { ...item };
        if (field === 'qty') {
          updated.qty = Math.max(1, Number(value) || 1);
        } else if (field === 'estimatedPrice') {
          updated.estimatedPrice = Math.max(0, Number(value) || 0);
        } else if (field === 'unit') {
          const nextUnit = value as 'Pcs' | 'Karton';
          if (nextUnit !== updated.unit) {
            const ratio = updated.piecesPerCarton || 24;
            if (nextUnit === 'Karton') {
              updated.estimatedPrice = updated.estimatedPrice * ratio;
            } else {
              updated.estimatedPrice = Math.round(updated.estimatedPrice / ratio);
            }
            updated.unit = nextUnit;
          }
        }
        updated.subtotal = updated.qty * updated.estimatedPrice;
        return updated;
      })
    );
  };

  const handleRemovePrCartItem = (index: number) => {
    setPrCartItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  // 3. PO Cart
  const handleAddProductToPoCart = (p: Product) => {
    const existingIndex = poCartItems.findIndex((item) => item.productId === p.id);
    const defaultContractPrice =
      p.pricePerCarton || (p.costPerUnit ? p.costPerUnit * (p.piecesPerCarton || 24) : 75000);
    const fallbackDates = getDefaultProductionAndExpiryDates(p);
    const productionDate = poProductionDate || fallbackDates.productionDate;
    const expiryDate = poExpiryDate || fallbackDates.expiryDate;
    const autoBatch = generateAutoBatchCode(poCartItems.length + 1, poDate || todayStr);

    if (existingIndex >= 0) {
      setPoCartItems((prev) =>
        prev.map((item, idx) => {
          if (idx === existingIndex) {
            const nextQty = item.qty + 1;
            const gross = nextQty * item.contractPrice;
            const disc = (gross * item.discountPercent) / 100;
            return {
              ...item,
              qty: nextQty,
              subtotal: gross - disc,
            };
          }
          return item;
        })
      );
    } else {
      const newItem: PoCartItem = {
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        piecesPerCarton: p.piecesPerCarton || 24,
        unit: 'Karton',
        batchCode: autoBatch,
        productionDate,
        expiryDate,
        qty: 1,
        contractPrice: defaultContractPrice,
        discountPercent: 0,
        subtotal: 1 * defaultContractPrice,
      };
      setPoCartItems((prev) => [...prev, newItem]);
    }

    setPoProductSearch('');
    setShowPoProductDropdown(false);
  };

  const handleUpdatePoCartItem = (
    index: number,
    field: 'qty' | 'contractPrice' | 'discountPercent' | 'unit' | 'batchCode' | 'productionDate' | 'expiryDate',
    value: any
  ) => {
    setPoCartItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const updated = { ...item };
        if (field === 'qty') {
          updated.qty = Math.max(1, Number(value) || 1);
        } else if (field === 'contractPrice') {
          updated.contractPrice = Math.max(0, Number(value) || 0);
        } else if (field === 'discountPercent') {
          updated.discountPercent = Math.min(100, Math.max(0, Number(value) || 0));
        } else if (field === 'batchCode') {
          updated.batchCode = String(value);
        } else if (field === 'productionDate') {
          updated.productionDate = String(value);
        } else if (field === 'expiryDate') {
          updated.expiryDate = String(value);
        } else if (field === 'unit') {
          const nextUnit = value as 'Karton' | 'Pcs';
          if (nextUnit !== updated.unit) {
            const ratio = updated.piecesPerCarton || 24;
            if (nextUnit === 'Karton') {
              updated.contractPrice = updated.contractPrice * ratio;
            } else {
              updated.contractPrice = Math.round(updated.contractPrice / ratio);
            }
            updated.unit = nextUnit;
          }
        }
        const gross = updated.qty * updated.contractPrice;
        const discountVal = (gross * updated.discountPercent) / 100;
        updated.subtotal = gross - discountVal;
        return updated;
      })
    );
  };

  const handleRemovePoCartItem = (index: number) => {
    setPoCartItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  // =========================================================================
  // SUBMISSION LOGIC (DISTINCT DOMAIN MODELS)
  // =========================================================================

  // 1. Submit Direct Purchase (activeSub === 'pembelian_produk') with Multi-Batch FEFO
  const handleSavePurchaseOrder = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (cartItems.length === 0) {
      alert('Keranjang pembelian masih kosong! Tambahkan minimal 1 produk melalui kolom pencarian.');
      return;
    }

    // Validate expiry dates on all cart items
    for (const item of cartItems) {
      if (!item.expiryDate || !item.expiryDate.trim()) {
        alert(`Tanggal Expired wajib diisi untuk produk "${item.productName}" (Batch: ${item.batchCode})!`);
        return;
      }
    }

    setIsSubmittingOrder(true);
    try {
      const poId = `PO-${Date.now().toString().slice(-6)}`;
      const numericPaid = Number(paidAmount) || 0;
      const finalRemainingDebt = Math.max(0, totalAmount - numericPaid);
      const itemsCount = cartItems.reduce((acc, item) => acc + item.qty, 0);
      const totalUnits = cartItems.reduce(
        (acc, item) =>
          acc + (item.unit === 'Karton' ? item.qty * (item.piecesPerCarton || 1) : item.qty),
        0
      );
      const productSummary = cartItems
        .map(
          (item) =>
            `${item.productName} (${item.qty} ${item.unit === 'Karton' ? 'Dus' : 'Pcs'} | ${item.batchCode} | Exp: ${item.expiryDate})`
        )
        .join(', ');

      const paymentStatus =
        finalRemainingDebt > 0
          ? `Tempo / Hutang (Sisa Rp ${finalRemainingDebt.toLocaleString('id-ID')})`
          : `Lunas (${selectedPaymentMethod})`;

      const deliveryStatus = addToStock ? 'Diterima (Masuk Stok)' : 'Menunggu Pengiriman';
      const supplierName = purchaseSupplier.trim() || 'Supplier Umum';

      const orderPayload = {
        id: poId,
        poNumber: poId,
        date: purchaseDate,
        productionDate: purchaseProductionDate || todayStr,
        expiryDate: purchaseExpiryDate || todayStr,
        createdAt: new Date().toISOString(),
        supplier: supplierName,
        supplierName: supplierName,
        items: cartItems.map((item, idx) => ({
          productId: item.productId,
          productName: item.productName,
          sku: item.sku || '-',
          unit: item.unit,
          piecesPerCarton: item.piecesPerCarton || 1,
          batchCode: item.batchCode || generateAutoBatchCode(idx + 1, purchaseDate),
          productionDate: item.productionDate || purchaseProductionDate || todayStr,
          expiryDate: item.expiryDate || purchaseExpiryDate || todayStr,
          qty: item.qty,
          addedUnits: item.unit === 'Karton' ? item.qty * (item.piecesPerCarton || 1) : item.qty,
          buyPrice: item.buyPrice,
          subtotal: item.subtotal,
        })),
        productSummary,
        productName: cartItems[0]?.productName || 'Barang Pembelian',
        itemsCount,
        totalUnits,
        totalAmount,
        paidAmount: numericPaid,
        remainingDebt: finalRemainingDebt,
        paymentType: selectedPaymentType,
        paymentMethod: selectedPaymentMethod,
        paymentStatus,
        deliveryStatus,
        addToStock,
        notes: purchaseNotes.trim() || '-',
      };

      await addOrderDoc(orderPayload);

      // Sync direct purchase payment (> 0) to finance_mutations & cash_flows
      if (numericPaid > 0) {
        const nowIso = new Date().toISOString();
        const todayDateStr = nowIso.slice(0, 10);
        const nowJamStr = `${new Date().toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })} WIB`;
        const targetVault =
          selectedPaymentMethod === 'Brangkas Modal'
            ? 'brangkas-modal'
            : selectedPaymentMethod === 'Brangkas Untung'
            ? 'brangkas-untung'
            : 'brangkas-toko';
        const targetAlokasi =
          selectedPaymentMethod === 'Brangkas Modal'
            ? 'Brangkas Modal'
            : selectedPaymentMethod === 'Brangkas Untung'
            ? 'Brangkas Untung'
            : 'Brangkas Toko';
        const descText = `Pembayaran Hutang PO ${poId} - Supplier: ${supplierName} (${selectedPaymentMethod})`;

        await Promise.all([
          addFinanceMutation({
            vault: targetVault,
            direction: 'out',
            type: 'Kas Keluar',
            flowType: 'Kas Keluar',
            category: 'Pengeluaran',
            jenisJurnal: 'Pembayaran Hutang PO',
            from: selectedPaymentMethod,
            to: targetAlokasi,
            amount: numericPaid,
            typeName: selectedPaymentMethod,
            paymentMethod: selectedPaymentMethod,
            description: descText,
            note: descText,
            referenceId: poId,
            poNumber: poId,
            supplierName: supplierName,
            tanggal: todayDateStr,
            jam: nowJamStr,
            date: todayDateStr,
            createdAt: nowIso,
            createdBy: 'Admin / Kasir',
            actor: 'Admin / Kasir',
            staff: 'Admin / Kasir',
          }),
          addCashFlow({
            storeId: ACTIVE_STORE_ID,
            type: 'out',
            category: 'Pembayaran Pembelian / PO',
            source: 'PROCUREMENT',
            method: selectedPaymentMethod,
            paymentMethod: selectedPaymentMethod,
            amount: numericPaid,
            supplierName: supplierName,
            poNumber: poId,
            referenceId: poId,
            description: descText,
            note: descText,
            date: todayDateStr,
            createdAt: nowIso,
            updatedAt: nowIso,
          }),
        ]);
      }

      if (addToStock) {
        // Track running product states in case multiple batch rows belong to the same productId
        const productTracker = new Map<string, Product>();
        products.forEach((p) => productTracker.set(p.id, { ...p }));

        for (let idx = 0; idx < cartItems.length; idx++) {
          const item = cartItems[idx];
          const currentProd = productTracker.get(item.productId) || products.find((p) => p.id === item.productId);
          const currentStock = currentProd
            ? Number(currentProd.stockInUnits ?? (currentProd as any).stock ?? 0)
            : 0;
          const addedUnits =
            item.unit === 'Karton'
              ? item.qty * (item.piecesPerCarton || 1)
              : item.qty;
          const newCostPerUnit =
            item.unit === 'Karton'
              ? Math.round(item.buyPrice / (item.piecesPerCarton || 1))
              : item.buyPrice;
          const newStock = currentStock + addedUnits;
          const finalBatchCode = item.batchCode || generateAutoBatchCode(idx + 1, purchaseDate);
          const finalProdDate = item.productionDate || todayStr;
          const finalExpDate = item.expiryDate || todayStr;

          const baseProdForBatch: Product = currentProd || {
            id: item.productId,
            storeId: ACTIVE_STORE_ID,
            name: item.productName,
            sku: item.sku || item.productId,
            category: item.category || 'MINERAL',
            barcode: item.barcode || '',
            piecesPerCarton: item.piecesPerCarton || 24,
            stockInUnits: currentStock,
            costPerUnit: newCostPerUnit,
            pricePerUnit: newCostPerUnit,
            pricePerCarton: item.buyPrice,
            minStockAlert: 10,
            batches: [],
          };

          const mergedBatchResult = mergeBatchIntoProduct(baseProdForBatch, {
            batchCode: finalBatchCode,
            productionDate: finalProdDate,
            expiryDate: finalExpDate,
            qty: addedUnits,
            initialQty: addedUnits,
            buyPrice: newCostPerUnit,
            supplier: supplierName,
            poNumber: poId,
            receivedAt: new Date().toISOString(),
          });

          const updatePayload = {
            stockInUnits: newStock,
            stock: newStock,
            costPerUnit: newCostPerUnit,
            costPrice: newCostPerUnit,
            batches: mergedBatchResult.batches,
            productionDate: mergedBatchResult.earliestProductionDate,
            tanggalProduksi: mergedBatchResult.earliestProductionDate,
            expiryDate: mergedBatchResult.earliestExpiryDate,
            tanggalKadaluarsa: mergedBatchResult.earliestExpiryDate,
            updatedAt: new Date().toISOString(),
          };

          // Update running tracker so a 2nd split batch of the same product appends cleanly
          productTracker.set(item.productId, {
            ...baseProdForBatch,
            stockInUnits: newStock,
            costPerUnit: newCostPerUnit,
            batches: mergedBatchResult.batches,
            productionDate: mergedBatchResult.earliestProductionDate,
            expiryDate: mergedBatchResult.earliestExpiryDate,
          });

          await setDoc(doc(db, 'products', item.productId), updatePayload, { merge: true });
          await setDoc(
            doc(db, 'stores', ACTIVE_STORE_ID, 'products', item.productId),
            updatePayload,
            { merge: true }
          );

          await addDoc(collection(db, 'stock_mutations'), {
            date: new Date().toLocaleString('id-ID'),
            createdAt: new Date().toISOString(),
            productId: item.productId,
            productName: item.productName,
            sku: item.sku || '-',
            type: 'MASUK',
            qty: addedUnits,
            unit: item.unit === 'Karton' ? `${item.qty} Dus (${addedUnits} Pcs)` : `${addedUnits} Pcs`,
            batchCode: finalBatchCode,
            productionDate: finalProdDate,
            expiryDate: finalExpDate,
            buyPrice: newCostPerUnit,
            supplier: supplierName,
            beforeStock: currentStock,
            afterStock: newStock,
            reference: poId,
            reason: `Pembelian Barang (${supplierName}) — Batch ${finalBatchCode} (Exp: ${finalExpDate})`,
            actor: 'Purchasing',
          });
        }
      }

      setCartItems([]);
      setPurchaseNotes('');
      setPaidAmount(0);
      setSelectedPaymentType('Tanpa Pemb');
      setPurchaseSupplier('');
      setSupplierSearchQuery('');
      setProductSearchQuery('');

      showToast(
        `Pembelian ${poId} berhasil disimpan! ${
          addToStock ? 'Stok Multi-Batch FEFO di POS, MyAsset & Inventory otomatis diperbarui.' : ''
        }`
      );
    } catch (err: any) {
      console.error('Error saving purchase order:', err);
      alert('Gagal menyimpan pembelian barang: ' + err.message);
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  // 2. Submit Request Pembelian (PR) - Internal Requisition Workflow
  const handleSavePurchaseRequest = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (prCartItems.length === 0) {
      alert('Daftar barang pengajuan PR masih kosong! Cari dan pilih produk yang dibutuhkan toko.');
      return;
    }

    setIsSubmittingPr(true);
    try {
      const prId = `PR-${Date.now().toString().slice(-6)}`;
      const productSummary = prCartItems
        .map((item) => `${item.productName} (${item.qty} ${item.unit})`)
        .join(', ');

      const prPayload = {
        id: prId,
        prNumber: prId,
        date: prDate,
        targetDate: prTargetDate,
        createdAt: new Date().toISOString(),
        requester: prRequester.trim() || 'Staf Kasir',
        department: prDepartment,
        urgency: prUrgency,
        approver: prApprover,
        notifyManager: prNotifyManager,
        items: prCartItems.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          sku: item.sku || '-',
          unit: item.unit,
          qty: item.qty,
          estimatedPrice: item.estimatedPrice,
          subtotal: item.subtotal,
          currentStock: item.currentStock,
        })),
        product: prCartItems[0]?.productName || 'Pengajuan Restock',
        productSummary,
        requestedQty: `${totalPrQty} Item`,
        itemsCount: totalPrQty,
        estimatedCost: totalPrBudget,
        status: 'Menunggu Persetujuan',
        notes: prNotes.trim() || 'Pengajuan stok etalase rutin',
      };

      await addPurchaseRequest(prPayload);

      setPrCartItems([]);
      setPrNotes('');
      setPrProductSearch('');

      showToast(`Request Pembelian ${prId} berhasil diajukan dan diteruskan ke ${prApprover}!`);
    } catch (err: any) {
      console.error('Error submitting PR:', err);
      alert('Gagal mengajukan PR: ' + err.message);
    } finally {
      setIsSubmittingPr(false);
    }
  };

  // 3. Submit Official B2B Purchase Order (PO) to Vendor
  const handleSaveOfficialPo = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (poCartItems.length === 0) {
      alert('Daftar item kontrak PO masih kosong! Pilih produk yang akan dipesan ke pemasok.');
      return;
    }
    if (!poSupplier.trim()) {
      alert('Pilih pemasok / vendor tujuan terlebih dahulu.');
      return;
    }

    setIsSubmittingPo(true);
    try {
      const poId = poDocNumber.trim() || `PO-${Date.now().toString().slice(-6)}`;
      const itemsCount = poCartItems.reduce((acc, item) => acc + item.qty, 0);
      const totalUnits = poCartItems.reduce(
        (acc, item) =>
          acc + (item.unit === 'Karton' ? item.qty * (item.piecesPerCarton || 1) : item.qty),
        0
      );
      const productSummary = poCartItems
        .map((item) => `${item.productName} (${item.qty} ${item.unit})`)
        .join(', ');

      const numericDp = Number(poDpAmount) || 0;
      const finalRemainingDebt = Math.max(0, poGrandTotal - numericDp);

      const supName = poSupplier.trim();
      const orderPayload = {
        id: poId,
        poNumber: poId,
        date: poDate,
        expectedDate: poExpectedDate,
        createdAt: new Date().toISOString(),
        supplier: supName,
        supplierName: supName,
        warehouseLocation: poWarehouse,
        items: poCartItems.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          sku: item.sku || '-',
          unit: item.unit,
          piecesPerCarton: item.piecesPerCarton || 1,
          qty: item.qty,
          contractPrice: item.contractPrice,
          discountPercent: item.discountPercent,
          subtotal: item.subtotal,
        })),
        productSummary,
        productName: poCartItems[0]?.productName || 'Order Pemasok',
        itemsCount,
        totalUnits,
        subtotal: poSubtotal,
        taxPercent: poTaxRate,
        taxAmount: poTaxAmount,
        shippingFee: Number(poShippingFee) || 0,
        totalAmount: poGrandTotal,
        paidAmount: numericDp,
        remainingDebt: finalRemainingDebt,
        paymentType: poPaymentTerms,
        paymentMethod: numericDp > 0 ? poDpPaymentMethod : poPaymentTerms,
        paymentStatus:
          finalRemainingDebt > 0
            ? `${poPaymentTerms} (Sisa Rp ${finalRemainingDebt.toLocaleString('id-ID')})`
            : `Lunas (${poDpPaymentMethod})`,
        deliveryStatus: poIsOfficialActive ? 'Menunggu Pengiriman Vendor' : 'Draf Internal',
        addToStock: false, // Stock only added when confirmed received!
        notes: poVendorNotes.trim() || `Kontrak PO resmi ke ${supName}.`,
      };

      await addOrderDoc(orderPayload);

      // Sync PO Down Payment / Tunai (numericDp > 0) to finance_mutations & cash_flows
      if (numericDp > 0) {
        const nowIso = new Date().toISOString();
        const todayDateStr = nowIso.slice(0, 10);
        const nowJamStr = `${new Date().toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })} WIB`;
        const targetVault =
          poDpPaymentMethod === 'Brangkas Modal'
            ? 'brangkas-modal'
            : poDpPaymentMethod === 'Brangkas Untung'
            ? 'brangkas-untung'
            : 'brangkas-toko';
        const targetAlokasi =
          poDpPaymentMethod === 'Brangkas Modal'
            ? 'Brangkas Modal'
            : poDpPaymentMethod === 'Brangkas Untung'
            ? 'Brangkas Untung'
            : 'Brangkas Toko';
        const descText = `Pembayaran Hutang PO ${poId} - Supplier: ${supName} (${poDpPaymentMethod})`;

        await Promise.all([
          addFinanceMutation({
            vault: targetVault,
            direction: 'out',
            type: 'Kas Keluar',
            flowType: 'Kas Keluar',
            category: 'Pengeluaran',
            jenisJurnal: 'Pembayaran Hutang PO',
            from: poDpPaymentMethod,
            to: targetAlokasi,
            amount: numericDp,
            typeName: poDpPaymentMethod,
            paymentMethod: poDpPaymentMethod,
            description: descText,
            note: descText,
            referenceId: poId,
            poNumber: poId,
            supplierName: supName,
            tanggal: todayDateStr,
            jam: nowJamStr,
            date: todayDateStr,
            createdAt: nowIso,
            createdBy: 'Admin / Kasir',
            actor: 'Admin / Kasir',
            staff: 'Admin / Kasir',
          }),
          addCashFlow({
            storeId: ACTIVE_STORE_ID,
            type: 'out',
            category: 'Pembayaran DP / Hutang PO',
            source: 'PROCUREMENT',
            method: poDpPaymentMethod,
            paymentMethod: poDpPaymentMethod,
            amount: numericDp,
            supplierName: supName,
            poNumber: poId,
            referenceId: poId,
            description: descText,
            note: descText,
            date: todayDateStr,
            createdAt: nowIso,
            updatedAt: nowIso,
          }),
        ]);
      }

      setPoCartItems([]);
      setPoVendorNotes('');
      setPoDpAmount(0);
      setPoDpPaymentMethod('Brangkas Toko');
      setPoShippingFee(0);
      setPoTaxRate(0);
      setPoSupplier('');
      setPoSupplierSearch('');
      setPoProductSearch('');
      setPoDocNumber(`PO-${Date.now().toString().slice(-6)}`);

      showToast(`Purchase Order Resmi ${poId} berhasil diterbitkan ke ${poSupplier}!`);
    } catch (err: any) {
      console.error('Error creating official PO:', err);
      alert('Gagal menerbitkan PO: ' + err.message);
    } finally {
      setIsSubmittingPo(false);
    }
  };

  // Convert Approved PR to PO
  const handleConvertPrToPo = (pr: any) => {
    setPoSupplier(suppliers[0]?.name || 'Supplier Rekanan');
    setPoSupplierSearch(suppliers[0]?.name || '');

    const convertedItems: PoCartItem[] = (pr.items || []).map((item: any, idx: number) => {
      const matchedProd = products.find((p) => p.id === item.productId);
      const { productionDate, expiryDate } = getDefaultProductionAndExpiryDates(matchedProd);
      return {
        productId: item.productId,
        productName: item.productName,
        sku: item.sku || '-',
        piecesPerCarton: item.piecesPerCarton || 24,
        unit: item.unit === 'Karton' ? 'Karton' : 'Pcs',
        batchCode: generateAutoBatchCode(idx + 1, poDate || todayStr),
        productionDate,
        expiryDate,
        qty: item.qty || 1,
        contractPrice: item.estimatedPrice || 10000,
        discountPercent: 0,
        subtotal: (item.qty || 1) * (item.estimatedPrice || 10000),
      };
    });

    if (convertedItems.length === 0) {
      const fallbackProd = products.find((p) => p.name === pr.product) || products[0];
      if (fallbackProd) {
        const { productionDate, expiryDate } = getDefaultProductionAndExpiryDates(fallbackProd);
        convertedItems.push({
          productId: fallbackProd.id,
          productName: fallbackProd.name,
          sku: fallbackProd.sku,
          piecesPerCarton: fallbackProd.piecesPerCarton || 24,
          unit: 'Karton',
          batchCode: generateAutoBatchCode(1, poDate || todayStr),
          productionDate,
          expiryDate,
          qty: Number(parseInt(pr.requestedQty || '1')) || 1,
          contractPrice: fallbackProd.pricePerCarton || 75000,
          discountPercent: 0,
          subtotal: (Number(parseInt(pr.requestedQty || '1')) || 1) * (fallbackProd.pricePerCarton || 75000),
        });
      }
    }

    setPoCartItems(convertedItems);
    setPoVendorNotes(`Dikonversi dari pengajuan ${pr.id || pr.prNumber} (${pr.requester}).`);
    setActiveSub('daftar_pembelian');
    showToast(`Data pengajuan ${pr.id || pr.prNumber} berhasil disalin ke Form Penerbitan PO.`);
  };

  // Confirm PO Goods Received in Warehouse (Adds stock to products + Multi-Batch FEFO + stock_mutations)
  const handleConfirmPoGoodsReceived = async (po: any) => {
    try {
      const itemsList = po.items || [];
      if (Array.isArray(itemsList) && itemsList.length > 0) {
        const productTracker = new Map<string, Product>();
        products.forEach((p) => productTracker.set(p.id, { ...p }));

        for (let idx = 0; idx < itemsList.length; idx++) {
          const item = itemsList[idx];
          const currentProd = productTracker.get(item.productId) || products.find((p) => p.id === item.productId);
          const currentStock = currentProd
            ? Number(currentProd.stockInUnits ?? (currentProd as any).stock ?? 0)
            : 0;
          const addedUnits =
            item.unit === 'Karton'
              ? item.qty * (item.piecesPerCarton || 24)
              : item.qty;
          const newStock = currentStock + addedUnits;
          const unitCost =
            item.unit === 'Karton'
              ? Math.round((item.contractPrice || item.buyPrice || 0) / (item.piecesPerCarton || 24))
              : Number(item.contractPrice || item.buyPrice || currentProd?.costPerUnit || 0);

          const defaultDates = getDefaultProductionAndExpiryDates(currentProd);
          const finalBatchCode = item.batchCode || generateAutoBatchCode(idx + 1, po.date || todayStr);
          const finalProdDate = item.productionDate || defaultDates.productionDate;
          const finalExpDate = item.expiryDate || defaultDates.expiryDate;

          const baseProd: Product = currentProd || {
            id: item.productId,
            storeId: ACTIVE_STORE_ID,
            name: item.productName,
            sku: item.sku || item.productId,
            category: 'MINERAL',
            barcode: '',
            piecesPerCarton: item.piecesPerCarton || 24,
            stockInUnits: currentStock,
            costPerUnit: unitCost,
            pricePerUnit: unitCost,
            pricePerCarton: item.contractPrice || 0,
            minStockAlert: 10,
            batches: [],
          };

          const mergedBatch = mergeBatchIntoProduct(baseProd, {
            batchCode: finalBatchCode,
            productionDate: finalProdDate,
            expiryDate: finalExpDate,
            qty: addedUnits,
            initialQty: addedUnits,
            buyPrice: unitCost,
            supplier: po.supplier || 'Supplier PO',
            poNumber: po.id,
            receivedAt: new Date().toISOString(),
          });

          const updatePayload = {
            stockInUnits: newStock,
            stock: newStock,
            costPerUnit: unitCost > 0 ? unitCost : baseProd.costPerUnit,
            batches: mergedBatch.batches,
            productionDate: mergedBatch.earliestProductionDate,
            tanggalProduksi: mergedBatch.earliestProductionDate,
            expiryDate: mergedBatch.earliestExpiryDate,
            tanggalKadaluarsa: mergedBatch.earliestExpiryDate,
            updatedAt: new Date().toISOString(),
          };

          productTracker.set(item.productId, {
            ...baseProd,
            stockInUnits: newStock,
            batches: mergedBatch.batches,
            productionDate: mergedBatch.earliestProductionDate,
            expiryDate: mergedBatch.earliestExpiryDate,
          });

          await setDoc(doc(db, 'products', item.productId), updatePayload, { merge: true });
          await setDoc(
            doc(db, 'stores', ACTIVE_STORE_ID, 'products', item.productId),
            updatePayload,
            { merge: true }
          );

          await addDoc(collection(db, 'stock_mutations'), {
            date: new Date().toLocaleString('id-ID'),
            createdAt: new Date().toISOString(),
            productId: item.productId,
            productName: item.productName,
            sku: item.sku || '-',
            type: 'MASUK',
            qty: addedUnits,
            batchCode: finalBatchCode,
            productionDate: finalProdDate,
            expiryDate: finalExpDate,
            buyPrice: unitCost,
            supplier: po.supplier || 'Supplier PO',
            beforeStock: currentStock,
            afterStock: newStock,
            reference: po.id,
            reason: `Penerimaan Barang PO (${po.supplier}) — Batch ${finalBatchCode} (Exp: ${finalExpDate})`,
            actor: 'Gudang Penerima',
          });
        }
      }

      // 2. Update PO status
      await updateOrderDoc(po.id, {
        deliveryStatus: 'Diterima (Masuk Stok)',
        receivedDate: new Date().toLocaleDateString('id-ID'),
        addToStock: true,
      });

      showToast(`Barang PO ${po.id} telah diterima di gudang dan stok Multi-Batch FEFO bertambah!`);
    } catch (err: any) {
      console.error('Error confirming PO receipt:', err);
      alert('Gagal memproses penerimaan barang: ' + err.message);
    }
  };

  // Settle PO Debt & Sync to finance_mutations + cash_flows
  const handlePayPoDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(payPoAmount) || 0;
    if (!payPoModal || amount <= 0) return;

    const po = payPoModal.po;
    const poNumber = payPoModal.poNumber || po.poNumber || po.id;
    const supplierName = payPoModal.supplierName || po.supplierName || po.supplier || 'Supplier Umum';
    const currentPaid = Number(
      po.paidAmount ??
        (po.paymentStatus?.toLowerCase().includes('tempo') ? 0 : po.totalAmount) ??
        0
    );
    const newPaid = currentPaid + amount;
    const total = Number(po.totalAmount || 0);
    const newDebt = Math.max(0, total - newPaid);
    const newStatus =
      newDebt <= 0
        ? `Lunas (${payPoMethod})`
        : `Tempo / Hutang (Sisa Rp ${newDebt.toLocaleString('id-ID')})`;

    const nowIso = new Date().toISOString();
    const todayDateStr = nowIso.slice(0, 10);
    const nowJamStr = `${new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })} WIB`;
    const targetVault =
      payPoMethod === 'Brangkas Modal'
        ? 'brangkas-modal'
        : payPoMethod === 'Brangkas Untung'
        ? 'brangkas-untung'
        : 'brangkas-toko';
    const targetAlokasi =
      payPoMethod === 'Brangkas Modal'
        ? 'Brangkas Modal'
        : payPoMethod === 'Brangkas Untung'
        ? 'Brangkas Untung'
        : 'Brangkas Toko';
    const descText = `Pembayaran Hutang PO ${poNumber} - Supplier: ${supplierName} (${payPoMethod})`;

    try {
      await Promise.all([
        updateOrderDoc(payPoModal.id, {
          paidAmount: newPaid,
          remainingDebt: newDebt,
          paymentMethod: payPoMethod,
          paymentStatus: newStatus,
          lastPaymentDate: new Date().toLocaleDateString('id-ID'),
          updatedAt: nowIso,
        }),
        addFinanceMutation({
          vault: targetVault,
          direction: 'out', // Masuk sebagai Pengeluaran (Kas Keluar)
          type: 'Kas Keluar',
          flowType: 'Kas Keluar',
          category: 'Pengeluaran',
          jenisJurnal: 'Pembayaran Hutang PO',
          from: payPoMethod,
          to: targetAlokasi,
          amount: amount,
          typeName: payPoMethod, // 'Brangkas Toko' | 'Brangkas Modal' | 'Brangkas Untung' | 'Uang Mamang' | 'Uang Bapak' | 'Bonus' | 'Lainnya'
          paymentMethod: payPoMethod,
          description: descText,
          note: descText,
          referenceId: payPoModal.id,
          poNumber: poNumber,
          supplierName: supplierName,
          tanggal: todayDateStr,
          jam: nowJamStr,
          date: todayDateStr,
          createdAt: nowIso,
          createdBy: 'Admin / Kasir',
          actor: 'Admin / Kasir',
          staff: 'Admin / Kasir',
        }),
        addCashFlow({
          storeId: ACTIVE_STORE_ID,
          type: 'out',
          category: 'Pembayaran Hutang PO',
          source: 'PROCUREMENT',
          method: payPoMethod,
          paymentMethod: payPoMethod,
          amount: amount,
          supplierName: supplierName,
          poNumber: poNumber,
          referenceId: payPoModal.id,
          description: descText,
          note: descText,
          date: todayDateStr,
          createdAt: nowIso,
          updatedAt: nowIso,
        }),
      ]);

      setPayPoModal(null);
      showToast(
        `Pembayaran hutang PO ${poNumber} sebesar Rp ${amount.toLocaleString('id-ID')} (${payPoMethod}) berhasil dicatat ke Keuangan!`
      );
    } catch (err: any) {
      console.error('Error settling debt:', err);
      alert('Gagal mencatat pembayaran hutang: ' + err.message);
    }
  };
  const handleSettlePoDebt = handlePayPoDebt;

  // Supplier modal handlers
  const handleOpenAddSupplier = () => {
    setEditingSupplier(null);
    setNewSupName('');
    setNewSupCategory('');
    setNewSupContact('');
    setNewSupPhone('');
    setNewSupTerms('Tempo 30 Hari');
    setNewSupLeadTime(2);
    setNewSupRating(5.0);
    setShowAddSupplierModal(true);
  };

  const handleOpenEditSupplier = (sup: any) => {
    setEditingSupplier(sup);
    setNewSupName(sup.name || '');
    setNewSupCategory(sup.category || '');
    setNewSupContact(sup.contactPerson || '');
    setNewSupPhone(sup.phone || '');
    setNewSupTerms(sup.paymentTerms || 'Tempo 30 Hari');
    setNewSupLeadTime(typeof sup.leadTimeDays === 'number' ? sup.leadTimeDays : 2);
    setNewSupRating(typeof sup.rating === 'number' ? sup.rating : 5.0);
    setShowAddSupplierModal(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupName.trim()) return;

    const payload = {
      name: newSupName.trim(),
      category: newSupCategory.trim() || 'Sembako & Retail',
      contactPerson: newSupContact.trim() || '-',
      phone: newSupPhone.trim() || '-',
      email:
        editingSupplier?.email ||
        `${newSupName.toLowerCase().replace(/[^a-z0-9]/g, '')}@supplier.co.id`,
      paymentTerms: newSupTerms,
      leadTimeDays: Number(newSupLeadTime) || 2,
      totalOrders: editingSupplier?.totalOrders ?? 0,
      rating: Number(newSupRating) || 5.0,
      status: editingSupplier?.status || 'active',
    };

    if (editingSupplier) {
      await updateSupplier(editingSupplier.id, payload);
    } else {
      await addSupplier(payload);
    }

    setEditingSupplier(null);
    setNewSupName('');
    setShowAddSupplierModal(false);
    showToast('Data supplier berhasil disimpan.');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#120e07] border border-amber-500/60 text-amber-200 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4">
          <CheckCircle2 className="w-5 h-5 text-amber-400 shrink-0" />
          <span className="text-xs font-semibold">{toastMsg}</span>
          <button
            onClick={() => setToastMsg(null)}
            className="text-amber-400 hover:text-white ml-2 text-xs"
          >
            &times;
          </button>
        </div>
      )}

      {/* Header */}
      <div className="pb-4 border-b border-amber-500/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Truck className="w-6 h-6 text-amber-400" />
            <div>
              <h1 className="text-2xl font-black text-white tracking-tight">
                PEMBELIAN PRODUK &amp; PENGADAAN (MULTI-BATCH FEFO)
              </h1>
              <p className="text-xs text-zinc-400 mt-0.5">
                Manajemen rantai pasok terintegrasi: input pembelian langsung dengan Kode Batch, Tgl Produksi &amp; Tgl Expired (FEFO), dokumen PO resmi B2B, pengajuan restock (PR), dan direktori vendor.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-Tabs Nav */}
      <div className="flex items-center gap-1 p-1 bg-[#110e08] border border-amber-500/25 rounded-xl overflow-x-auto w-fit max-w-full">
        <button
          onClick={() => setActiveSub('pembelian_produk')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
            activeSub === 'pembelian_produk'
              ? 'bg-gradient-to-r from-amber-500 to-yellow-600 text-black shadow-sm font-black'
              : 'text-zinc-400 hover:text-amber-300'
          }`}
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          <span>Pembelian Barang</span>
        </button>
        <button
          onClick={() => setActiveSub('daftar_pembelian')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
            activeSub === 'daftar_pembelian'
              ? 'bg-gradient-to-r from-amber-500 to-yellow-600 text-black shadow-sm font-black'
              : 'text-zinc-400 hover:text-amber-300'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Daftar Pembelian (PO)</span>
        </button>
        <button
          onClick={() => setActiveSub('request_pembelian')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
            activeSub === 'request_pembelian'
              ? 'bg-gradient-to-r from-amber-500 to-yellow-600 text-black shadow-sm font-black'
              : 'text-zinc-400 hover:text-amber-300'
          }`}
        >
          <FileCheck className="w-3.5 h-3.5" />
          <span>Request Pembelian (PR)</span>
        </button>
        <button
          onClick={() => setActiveSub('statistik_pembelian')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
            activeSub === 'statistik_pembelian'
              ? 'bg-gradient-to-r from-amber-500 to-yellow-600 text-black shadow-sm font-black'
              : 'text-zinc-400 hover:text-amber-300'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          <span>Statistik Pembelian</span>
        </button>
        <button
          onClick={() => setActiveSub('daftar_supplier')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
            activeSub === 'daftar_supplier'
              ? 'bg-gradient-to-r from-amber-500 to-yellow-600 text-black shadow-sm font-black'
              : 'text-zinc-400 hover:text-amber-300'
          }`}
        >
          <Building className="w-3.5 h-3.5" />
          <span>Daftar Supplier</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 1. VIEW: PEMBELIAN BARANG (activeSub === 'pembelian_produk') */}
      {/* ========================================================================= */}
      {activeSub === 'pembelian_produk' && (
        <div className="space-y-8">
          <div className="space-y-4">
            {/* Header Box Form */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                  <span>Pembelian Barang (Multi-Batch FEFO)</span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500/15 text-amber-300 border border-amber-500/40">
                    FIRST EXPIRED, FIRST OUT
                  </span>
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Tambahkan pembelian barang beserta Kode Batch, Tanggal Produksi, dan Tanggal Expired untuk pelacakan FEFO otomatis di POS, Inventory &amp; MyAsset.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveSub('daftar_pembelian')}
                className="px-3.5 py-1.5 rounded-xl bg-[#110e08] border border-amber-500/30 hover:bg-amber-500/15 text-amber-300 hover:text-white text-xs font-bold transition flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Kembali</span>
              </button>
            </div>

            {/* 2-Column Form Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              {/* Kolom Kiri */}
              <div className="xl:col-span-9 bg-[#110e08] border border-amber-500/25 rounded-2xl p-5 space-y-4 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* Kolom Kiri Header: Pemasok & Tanggal Produksi dibawah Pemasok */}
                  <div className="space-y-3">
                    <div className="relative">
                      <label className="block text-amber-200/80 font-bold mb-1.5">Pemasok</label>
                      <div className="relative">
                        <Search className="w-4 h-4 text-amber-400/70 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Ketik nama pemasok / supplier..."
                          value={purchaseSupplier || supplierSearchQuery}
                          onChange={(e) => {
                            setPurchaseSupplier(e.target.value);
                            setSupplierSearchQuery(e.target.value);
                            setShowSupplierDropdown(true);
                          }}
                          onFocus={() => setShowSupplierDropdown(true)}
                          className="w-full bg-[#080705] border border-amber-500/30 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition"
                        />
                      </div>
                      {showSupplierDropdown && (
                        <div className="absolute left-0 right-0 mt-1 bg-[#080705] border border-amber-500/30 rounded-xl shadow-2xl z-30 max-h-48 overflow-y-auto divide-y divide-amber-500/10">
                          {matchedSuppliers.map((s) => (
                            <button
                              key={s.id || s.name}
                              type="button"
                              onClick={() => {
                                setPurchaseSupplier(s.name);
                                setSupplierSearchQuery(s.name);
                                setShowSupplierDropdown(false);
                              }}
                              className="w-full text-left px-3.5 py-2 hover:bg-amber-500/10 text-zinc-200 flex items-center justify-between transition cursor-pointer"
                            >
                              <span className="font-bold">{s.name}</span>
                              <span className="text-[10px] text-amber-400 font-mono">
                                {s.category || 'Retail'}
                              </span>
                            </button>
                          ))}
                          <div
                            onClick={() => setShowSupplierDropdown(false)}
                            className="p-1.5 text-center text-[10px] text-zinc-500 hover:text-amber-300 bg-[#110e08] cursor-pointer"
                          >
                            Tutup Saran
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Kolom Kanan Header: Tanggal Beli */}
                  <div>
                    <label className="block text-amber-200/80 font-bold mb-1.5">Tanggal Beli</label>
                    <input
                      type="date"
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                      className="w-full bg-[#080705] border border-amber-500/30 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500 transition [color-scheme:dark]"
                    />
                  </div>
                </div>

                <div className="relative text-xs">
                  <label className="block text-amber-200/80 font-bold mb-1.5">
                    Cari Produk (Otomatis Buat Kode Batch, Tgl Produksi &amp; Tgl Expired)
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-amber-400/70 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Ketik nama produk atau kode SKU / Barcode..."
                      value={productSearchQuery}
                      onChange={(e) => {
                        setProductSearchQuery(e.target.value);
                        setShowProductDropdown(true);
                      }}
                      onFocus={() => setShowProductDropdown(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && matchedProducts.length > 0) {
                          e.preventDefault();
                          handleAddProductToCart(matchedProducts[0]);
                        }
                      }}
                      className="w-full bg-[#080705] border border-amber-500/30 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition"
                    />
                  </div>

                  {showProductDropdown && productSearchQuery.trim() && (
                    <div className="absolute left-0 right-0 mt-1 bg-[#080705] border border-amber-500/40 rounded-xl shadow-2xl z-30 max-h-60 overflow-y-auto divide-y divide-amber-500/15">
                      {matchedProducts.map((p) => {
                        const ppc = p.piecesPerCarton || 24;
                        const cartonsCount = Math.floor((p.stockInUnits || 0) / ppc);
                        return (
                          <div
                            key={p.id}
                            onClick={() => handleAddProductToCart(p)}
                            className="p-3 hover:bg-amber-500/10 flex items-center justify-between cursor-pointer transition"
                          >
                            <div>
                              <div className="font-bold text-white text-xs">{p.name}</div>
                              <div className="text-[10px] text-zinc-400 flex items-center gap-2 mt-0.5">
                                <span className="font-mono bg-[#16120b] border border-amber-500/25 text-amber-300 px-1.5 rounded">
                                  SKU: {p.sku}
                                </span>
                                <span>
                                  Stok saat ini: <strong className="text-amber-300">{cartonsCount} Dus</strong> ({p.stockInUnits} pcs) | Isi 1 Dus: {ppc} pcs
                                </span>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="font-mono font-bold text-amber-400 text-xs block">
                                {formatMoney(p.pricePerCarton || (p.costPerUnit || 0) * ppc, currencyMode)} / Dus
                              </span>
                              <span className="text-[10px] text-amber-300 font-bold">+ Tambah Batch</span>
                            </div>
                          </div>
                        );
                      })}
                      <div
                        onClick={() => setShowProductDropdown(false)}
                        className="p-2 text-center text-[10px] text-zinc-500 hover:text-amber-300 bg-[#110e08] cursor-pointer"
                      >
                        Tutup Pencarian
                      </div>
                    </div>
                  )}
                </div>

                {/* 9-COLUMN MULTI-BATCH FEFO TABLE */}
                <div className="border border-amber-500/30 rounded-xl overflow-x-auto bg-[#080705]">
                  <table className="w-full text-left text-xs border-collapse min-w-[980px]">
                    <thead className="bg-[#16120b] text-amber-300 border-b border-amber-500/30 select-none">
                      <tr>
                        <th className="py-2.5 px-3 font-black uppercase tracking-wider text-[10px]">1. PRODUK</th>
                        <th className="py-2.5 px-2.5 font-black uppercase tracking-wider text-[10px] w-32">2. SATUAN</th>
                        <th className="py-2.5 px-2.5 font-black uppercase tracking-wider text-[10px] w-44">3. KODE BATCH (AUTO)</th>
                        <th className="py-2.5 px-2.5 font-black uppercase tracking-wider text-[10px] w-36">4. TGL PRODUKSI</th>
                        <th className="py-2.5 px-2.5 font-black uppercase tracking-wider text-[10px] w-40">5. TGL EXPIRED</th>
                        <th className="py-2.5 px-2.5 font-black uppercase tracking-wider text-[10px] w-24 text-center">6. QTY</th>
                        <th className="py-2.5 px-2.5 font-black uppercase tracking-wider text-[10px] w-32 text-right">7. HARGA BELI</th>
                        <th className="py-2.5 px-3 font-black uppercase tracking-wider text-[10px] w-36 text-right">8. SUBTOTAL</th>
                        <th className="py-2.5 px-2.5 font-black uppercase tracking-wider text-[10px] w-28 text-center">9. AKSI</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-500/15 text-zinc-200">
                      {cartItems.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-12 text-center text-zinc-500 text-xs">
                            Belum ada produk dalam nota pembelian. Gunakan pencarian di atas untuk menambah item beserta Kode Batch &amp; Tanggal Kadaluarsa (FEFO).
                          </td>
                        </tr>
                      ) : (
                        cartItems.map((item, idx) => {
                          const ppc = item.piecesPerCarton || 24;
                          const currentCartons = Math.floor((item.currentStockInUnits || 0) / ppc);
                          const addedUnits = item.unit === 'Karton' ? item.qty * ppc : item.qty;
                          const expEval = evaluateProductExpiry({
                            productionDate: item.productionDate,
                            expiryDate: item.expiryDate,
                            category: item.category,
                          });

                          return (
                            <tr key={`${item.productId}-${idx}`} className="hover:bg-[#141009] transition-colors align-top">
                              {/* 1. PRODUK */}
                              <td className="py-3 px-3">
                                <div className="font-bold text-white text-xs">{item.productName}</div>
                                <div className="font-mono text-[10px] text-amber-400/90 mt-0.5">{item.sku}</div>
                                <div className="text-[10px] text-zinc-400 mt-1">
                                  Stok saat ini: <strong className="text-amber-300">{currentCartons} Dus</strong> ({item.currentStockInUnits} pcs) | Isi 1 Dus: <strong className="text-white">{ppc} pcs</strong>
                                </div>
                              </td>

                              {/* 2. SATUAN */}
                              <td className="py-3 px-2.5">
                                <select
                                  value={item.unit}
                                  onChange={(e) => handleUpdateCartItem(idx, 'unit', e.target.value)}
                                  className="w-full bg-[#120e08] border border-amber-500/40 rounded-lg px-2 py-1.5 text-[11px] font-bold text-amber-200 focus:outline-none focus:border-amber-400 cursor-pointer"
                                >
                                  <option value="Karton">Dus / Karton ({ppc} pcs)</option>
                                  <option value="Pcs">Pcs / Eceran</option>
                                </select>
                                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                  +{addedUnits} Pcs Masuk
                                </span>
                              </td>

                              {/* 3. KODE BATCH (AUTO) */}
                              <td className="py-3 px-2.5">
                                <input
                                  type="text"
                                  value={item.batchCode}
                                  onChange={(e) => handleUpdateCartItem(idx, 'batchCode', e.target.value)}
                                  placeholder="BATCH-YYYYMMDD-01"
                                  className="w-full bg-[#120e08] border border-amber-500/60 rounded-lg px-2.5 py-1.5 text-[11px] font-mono font-bold text-amber-300 focus:outline-none focus:border-amber-400"
                                />
                                <span className="text-[9px] text-zinc-500 block mt-1">
                                  Otomatis / Ketik No. LOT Kardus
                                </span>
                              </td>

                              {/* 4. TGL PRODUKSI */}
                              <td className="py-3 px-2.5">
                                <input
                                  type="date"
                                  value={item.productionDate}
                                  onChange={(e) => handleUpdateCartItem(idx, 'productionDate', e.target.value)}
                                  className="w-full bg-[#120e08] border border-amber-500/35 rounded-lg px-2 py-1.5 text-[11px] font-mono text-white focus:outline-none focus:border-amber-400 [color-scheme:dark]"
                                />
                                <span className="text-[9px] text-zinc-500 block mt-1">
                                  MFG: {expEval.productionDateFormatted}
                                </span>
                              </td>

                              {/* 5. TGL EXPIRED */}
                              <td className="py-3 px-2.5">
                                <input
                                  type="date"
                                  required
                                  value={item.expiryDate}
                                  onChange={(e) => handleUpdateCartItem(idx, 'expiryDate', e.target.value)}
                                  className="w-full bg-[#120e08] border border-amber-500/60 rounded-lg px-2 py-1.5 text-[11px] font-mono font-bold text-amber-200 focus:outline-none focus:border-amber-400 [color-scheme:dark]"
                                />
                                <span
                                  className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                    expEval.status === 'expired' || expEval.status === 'critical'
                                      ? 'bg-rose-950/90 text-rose-300 border border-rose-700'
                                      : expEval.status === 'warning'
                                      ? 'bg-amber-950/90 text-amber-300 border border-amber-600'
                                      : 'bg-[#16120b] text-amber-300 border border-amber-500/30'
                                  }`}
                                >
                                  {expEval.countdownText} ({expEval.badgeLabel})
                                </span>
                              </td>

                              {/* 6. QTY */}
                              <td className="py-3 px-2.5 text-center">
                                <input
                                  type="number"
                                  min="1"
                                  value={item.qty}
                                  onChange={(e) => handleUpdateCartItem(idx, 'qty', e.target.value)}
                                  className="w-16 bg-[#120e08] border border-amber-500/40 rounded-lg px-2 py-1.5 text-center font-mono font-bold text-white text-xs focus:outline-none focus:border-amber-400"
                                />
                                <span className="block text-[9px] text-zinc-400 mt-1 font-mono">
                                  {item.qty} {item.unit === 'Karton' ? 'Dus' : 'Pcs'}
                                </span>
                              </td>

                              {/* 7. HARGA BELI */}
                              <td className="py-3 px-2.5 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  value={item.buyPrice}
                                  onChange={(e) => handleUpdateCartItem(idx, 'buyPrice', e.target.value)}
                                  className="w-28 bg-[#120e08] border border-amber-500/40 rounded-lg px-2 py-1.5 text-right font-mono text-white text-xs focus:outline-none focus:border-amber-400"
                                />
                                <span className="block text-[9px] text-zinc-500 mt-1 font-mono">
                                  HPP/Pcs: {formatMoney(item.unit === 'Karton' ? Math.round(item.buyPrice / ppc) : item.buyPrice, currencyMode)}
                                </span>
                              </td>

                              {/* 8. SUBTOTAL */}
                              <td className="py-3 px-3 text-right font-mono font-black text-amber-400 text-xs">
                                {formatMoney(item.subtotal, currencyMode)}
                              </td>

                              {/* 9. AKSI (+ Pecah Batch & Hapus) */}
                              <td className="py-3 px-2.5 text-center">
                                <div className="flex flex-col items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleSplitCartItemBatch(idx)}
                                    title="Pecah pembelian produk ini menjadi 2 baris Batch / Tanggal Expired berbeda"
                                    className="px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500 text-amber-300 hover:text-black border border-amber-500/40 text-[10px] font-black transition flex items-center gap-1 whitespace-nowrap cursor-pointer"
                                  >
                                    <Plus className="w-3 h-3" />
                                    <span>Pecah Batch</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveCartItem(idx)}
                                    title="Hapus baris ini"
                                    className="p-1 rounded-lg hover:bg-rose-950/80 text-zinc-500 hover:text-rose-400 transition cursor-pointer"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="text-xs">
                  <label className="block text-amber-200/80 font-bold mb-1.5">Catatan</label>
                  <textarea
                    rows={2}
                    placeholder="Catatan nota pembelian / kondisi segel kardus batch (opsional)"
                    value={purchaseNotes}
                    onChange={(e) => setPurchaseNotes(e.target.value)}
                    className="w-full bg-[#080705] border border-amber-500/30 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition resize-none"
                  />
                </div>

                <div className="p-3.5 bg-[#080705] border border-amber-500/30 rounded-xl flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-200">
                    Apakah langsung ditambahkan ke stok produk &amp; antrean Batch FEFO?
                  </span>
                  <div className="flex items-center gap-1 p-1 bg-[#110e08] border border-amber-500/30 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setAddToStock(true)}
                      className={`px-4 py-1.5 rounded-lg font-black transition text-xs cursor-pointer ${
                        addToStock
                          ? 'bg-gradient-to-r from-amber-500 to-yellow-600 text-black shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Ya
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddToStock(false)}
                      className={`px-4 py-1.5 rounded-lg font-bold transition text-xs cursor-pointer ${
                        !addToStock
                          ? 'bg-zinc-800 text-white shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      Tidak
                    </button>
                  </div>
                </div>
              </div>

              {/* Kolom Kanan */}
              <div className="xl:col-span-3 bg-[#110e08] border border-amber-500/25 rounded-2xl p-5 space-y-4 shadow-sm h-fit">
                <div className="space-y-3">
                  <h3 className="font-bold text-amber-300 text-sm">Ringkasan Nota</h3>
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Jumlah Baris Batch</span>
                    <span className="font-mono font-bold text-white">{cartItems.length} Batch</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Total Qty Kemasan</span>
                    <span className="font-mono font-bold text-white">{totalQty}</span>
                  </div>
                  <div className="p-3.5 bg-[#080705] border border-amber-500/30 rounded-xl flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-300">Total Pembelian</span>
                    <span className="font-mono font-black text-amber-400 text-base">
                      {formatMoney(totalAmount, currencyMode)}
                    </span>
                  </div>
                </div>

                <div className="space-y-3 pt-3 border-t border-amber-500/20 text-xs">
                  <h3 className="font-bold text-amber-300 text-sm">Pembayaran ke Supplier</h3>
                  <div>
                    <label className="block text-zinc-400 font-bold mb-1">Dibayar</label>
                    <input
                      type="number"
                      min="0"
                      value={paidAmount}
                      onChange={(e) => setPaidAmount(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full bg-[#080705] border border-amber-500/30 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono font-bold focus:outline-none focus:border-amber-500 transition"
                    />
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-bold mb-1">Tipe Pemb</label>
                    <select
                      value={selectedPaymentType}
                      onChange={(e) => handlePaymentTypeChange(e.target.value)}
                      className="w-full bg-[#080705] border border-amber-500/30 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500 cursor-pointer"
                    >
                      <option value="Tanpa Pemb">Tanpa Pemb (Tempo / Hutang)</option>
                      <option value="Bayar Penuh">Bayar Penuh (Lunas)</option>
                      <option value="Bayar Sebagian">Bayar Sebagian (DP)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-bold mb-1">Metode Pembayaran</label>
                    <select
                      value={selectedPaymentMethod}
                      onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                      className="w-full bg-[#080705] border border-amber-500/30 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500 cursor-pointer"
                    >
                      {PO_PAYMENT_METHODS.map((methodOpt) => (
                        <option key={methodOpt} value={methodOpt}>
                          {methodOpt}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="p-3.5 bg-[#080705] border border-amber-500/30 rounded-xl flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-300">Sisa / Hutang</span>
                    <span className="font-mono font-black text-rose-400 text-base">
                      {formatMoney(remainingDebt, currencyMode)}
                    </span>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleSavePurchaseOrder}
                    disabled={isSubmittingOrder || cartItems.length === 0}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-black font-black text-xs sm:text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40 cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{isSubmittingOrder ? 'Menyimpan...' : '✓ Simpan Pembelian & Batch FEFO'}</span>
                  </button>
                  <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
                    Stok baru otomatis disimpan sebagai Batch tersendiri dengan Tanggal Produksi &amp; Expired (FEFO).
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Tabel Riwayat Pembelian Produk */}
          <div className="bg-[#110e08] border border-amber-500/25 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-amber-400" />
                <h3 className="font-bold text-sm text-white uppercase tracking-wider">
                  Riwayat Pembelian Produk &amp; Kode Batch FEFO
                </h3>
              </div>
              <span className="text-xs font-mono font-bold text-amber-300">
                {orders.length} Transaksi Tercatat
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#080705] text-amber-300/90 border-b border-amber-500/25 select-none">
                  <tr>
                    <th className="py-2.5 px-3 font-bold">No. PO</th>
                    <th className="py-2.5 px-3 font-bold">Tanggal Beli</th>
                    <th className="py-2.5 px-3 font-bold">Supplier</th>
                    <th className="py-2.5 px-3 font-bold">Rincian Produk, Batch &amp; Expired</th>
                    <th className="py-2.5 px-3 font-bold text-center">Total Qty</th>
                    <th className="py-2.5 px-3 font-bold text-right">Total Pembelian</th>
                    <th className="py-2.5 px-3 font-bold text-right">Dibayar</th>
                    <th className="py-2.5 px-3 font-bold text-right">Sisa / Hutang</th>
                    <th className="py-2.5 px-3 font-bold text-center">Masuk Stok</th>
                    <th className="py-2.5 px-3 font-bold text-center">Status</th>
                    <th className="py-2.5 px-3 font-bold text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-500/15 text-zinc-300">
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-zinc-500">
                        Belum ada riwayat pembelian. Buat pembelian pertama di form atas.
                      </td>
                    </tr>
                  ) : (
                    orders.map((po) => {
                      const debtVal = Number(po.remainingDebt || 0);
                      const isStockAdded = po.addToStock !== false;
                      const poItems = Array.isArray(po.items) ? po.items : [];

                      return (
                        <tr
                          key={po.id}
                          onClick={() => openTransactionDetailModal(po, 'PURCHASE')}
                          className="hover:bg-amber-500/5 transition cursor-pointer"
                        >
                          <td className="py-2.5 px-3 font-mono font-bold text-amber-400 hover:underline">{po.id}</td>
                          <td className="py-2.5 px-3 text-zinc-400 whitespace-nowrap">{po.date}</td>
                          <td className="py-2.5 px-3 font-bold text-white">{po.supplier}</td>
                          <td className="py-2.5 px-3 max-w-md">
                            <div className="truncate font-semibold text-zinc-200" title={po.productSummary || po.productName}>
                              {po.productSummary || po.productName || '-'}
                            </div>
                            {poItems.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {poItems.slice(0, 3).map((it: any, i: number) => (
                                  <span
                                    key={i}
                                    className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[#16120b] text-amber-300 border border-amber-500/30"
                                  >
                                    {it.batchCode || 'BATCH-01'} {it.expiryDate ? `(Exp: ${it.expiryDate})` : ''}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono">{po.itemsCount || 1}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                            {formatMoney(Number(po.totalAmount || 0), currencyMode)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-amber-300">
                            {formatMoney(Number(po.paidAmount ?? po.totalAmount ?? 0), currencyMode)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold">
                            <span className={debtVal > 0 ? 'text-rose-400' : 'text-zinc-500'}>
                              {formatMoney(debtVal, currencyMode)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                isStockAdded
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  : 'bg-zinc-800 text-zinc-400'
                              }`}
                            >
                              {isStockAdded ? 'Ya (FEFO)' : 'Tidak'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                (po.paymentStatus || '').toLowerCase().includes('lunas')
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  : 'bg-rose-950 text-rose-300 border border-rose-800'
                              }`}
                            >
                              {(po.paymentStatus || '').toLowerCase().includes('lunas')
                                ? 'Lunas'
                                : 'Hutang / Tempo'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1.5">
                              {debtVal > 0 && (
                                <button
                                  type="button"
                                  onClick={() => openPayPoModal(po)}
                                  title="Bayar cicilan / pelunasan hutang supplier"
                                  className="px-2 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-[10px] font-bold transition flex items-center gap-1 cursor-pointer"
                                >
                                  <DollarSign className="w-3 h-3" />
                                  <span>Bayar</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openTransactionDetailModal(po, 'PURCHASE')}
                                title="Lihat Detail & Fulfillment PO"
                                className="p-1.5 rounded-lg bg-[#16120b] border border-amber-500/30 hover:bg-amber-500/20 text-amber-300 hover:text-white transition cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5 text-amber-400" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. VIEW: REQUEST PEMBELIAN (PR) (activeSub === 'request_pembelian') */}
      {/* Form 2 Kolom Sesuai Desain screenshot_1.png (Domain: Internal Requisition) */}
      {/* ========================================================================= */}
      {activeSub === 'request_pembelian' && (
        <div className="space-y-8">
          <div className="space-y-4">
            {/* Header Box Form */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                  <span>Request Pembelian (Purchase Requisition - PR)</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800">
                    INTERNAL WORKFLOW
                  </span>
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Formulir pengajuan kebutuhan stok internal staf toko sebelum diterbitkan Purchase Order resmi.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveSub('daftar_pembelian')}
                className="px-3.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-bold transition flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Ke Daftar PO</span>
              </button>
            </div>

            {/* 2-Column Form Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Kolom Kiri: Input Pengajuan, Cari Produk, Tabel Item PR, & Justifikasi */}
              <div className="lg:col-span-8 bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4 shadow-sm">
                {/* 1. Pemohon, Departemen & Tanggal Target */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="block text-zinc-400 font-bold mb-1.5">Pemohon / Staff</label>
                    <input
                      type="text"
                      placeholder="Nama staf pengaju..."
                      value={prRequester}
                      onChange={(e) => setPrRequester(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-purple-500 transition"
                    />
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-bold mb-1.5">Departemen / Outlet</label>
                    <select
                      value={prDepartment}
                      onChange={(e) => setPrDepartment(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-purple-500 transition cursor-pointer"
                    >
                      <option value="Etalase Toko Utama">Etalase Toko Utama</option>
                      <option value="Gudang Transit">Gudang Transit Pusat</option>
                      <option value="Kasir Depan">Area Terminal Kasir POS</option>
                      <option value="Dapur & Konsumsi">Operasional Toko</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-bold mb-1.5">Target Dibutuhkan</label>
                    <input
                      type="date"
                      value={prTargetDate}
                      onChange={(e) => setPrTargetDate(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-purple-500 transition [color-scheme:dark]"
                    />
                  </div>
                </div>

                {/* 2. Cari Produk yang Diajukan (Real-time Filter) */}
                <div className="relative text-xs">
                  <label className="block text-zinc-400 font-bold mb-1.5">
                    Cari Produk yang Diajukan
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Ketik nama produk atau barcode untuk menambah ke pengajuan PR..."
                      value={prProductSearch}
                      onChange={(e) => {
                        setPrProductSearch(e.target.value);
                        setShowPrProductDropdown(true);
                      }}
                      onFocus={() => setShowPrProductDropdown(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && matchedPrProducts.length > 0) {
                          e.preventDefault();
                          handleAddProductToPrCart(matchedPrProducts[0]);
                        }
                      }}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-purple-500 transition"
                    />
                  </div>

                  {showPrProductDropdown && prProductSearch.trim() && (
                    <div className="absolute left-0 right-0 mt-1 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl z-30 max-h-60 overflow-y-auto divide-y divide-zinc-800/60">
                      {matchedPrProducts.map((p) => {
                        const isLow = p.stockInUnits <= p.minStockAlert;
                        return (
                          <div
                            key={p.id}
                            onClick={() => handleAddProductToPrCart(p)}
                            className="p-3 hover:bg-zinc-800 flex items-center justify-between cursor-pointer transition"
                          >
                            <div>
                              <div className="font-bold text-white text-xs flex items-center gap-2">
                                <span>{p.name}</span>
                                {isLow && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-950 text-rose-400 border border-rose-800">
                                    Stok Menipis
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-zinc-400 flex items-center gap-2 mt-0.5">
                                <span className="font-mono bg-zinc-800 px-1 rounded">SKU: {p.sku}</span>
                                <span>Sisa Stok: <strong className={isLow ? 'text-rose-400' : 'text-zinc-200'}>{p.stockInUnits} unit</strong></span>
                                <span>Min. Alert: {p.minStockAlert} unit</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="font-mono font-bold text-purple-400 text-xs block">
                                Est: Rp {(p.costPerUnit || p.pricePerUnit || 0).toLocaleString('id-ID')}
                              </span>
                              <span className="text-[10px] text-purple-400 font-bold">+ Pilih Item</span>
                            </div>
                          </div>
                        );
                      })}
                      <div
                        onClick={() => setShowPrProductDropdown(false)}
                        className="p-2 text-center text-[10px] text-zinc-500 hover:text-zinc-300 bg-zinc-900 cursor-pointer"
                      >
                        Tutup Pencarian
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Tabel Item Request Pembelian (PR) */}
                <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/60">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800 select-none">
                      <tr>
                        <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px]">PRODUK &amp; STOK SISA</th>
                        <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] w-36">SATUAN</th>
                        <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] w-24 text-center">QTY MINTA</th>
                        <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] w-32 text-right">EST. HPP</th>
                        <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] w-36 text-right">EST. BIAYA</th>
                        <th className="py-2.5 px-2 w-10 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                      {prCartItems.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-zinc-500 text-xs">
                            Belum ada produk diajukan. Gunakan kolom pencarian di atas untuk memasukkan kebutuhan barang.
                          </td>
                        </tr>
                      ) : (
                        prCartItems.map((item, idx) => (
                          <tr key={`${item.productId}-${idx}`} className="hover:bg-zinc-900/60 transition-colors">
                            <td className="py-2.5 px-3">
                              <div className="font-bold text-white text-xs">{item.productName}</div>
                              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-400">
                                <span className="font-mono bg-zinc-800 px-1 rounded">{item.sku}</span>
                                <span>Sisa Fisik: {item.currentStock} unit</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <select
                                value={item.unit}
                                onChange={(e) => handleUpdatePrCartItem(idx, 'unit', e.target.value)}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                              >
                                <option value="Pcs">Pcs / Ecer</option>
                                <option value="Karton">Dus / Karton ({item.piecesPerCarton} Pcs)</option>
                              </select>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <input
                                type="number"
                                min="1"
                                value={item.qty}
                                onChange={(e) => handleUpdatePrCartItem(idx, 'qty', e.target.value)}
                                className="w-20 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-center font-mono font-bold text-white text-xs focus:outline-none focus:border-purple-500"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <input
                                type="number"
                                min="0"
                                value={item.estimatedPrice}
                                onChange={(e) => handleUpdatePrCartItem(idx, 'estimatedPrice', e.target.value)}
                                className="w-28 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-right font-mono text-white text-xs focus:outline-none focus:border-purple-500"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-purple-400 text-xs">
                              Rp {item.subtotal.toLocaleString('id-ID')}
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemovePrCartItem(idx)}
                                className="p-1 rounded-lg hover:bg-rose-950/80 text-zinc-500 hover:text-rose-400 transition cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* 4. Alasan Kebutuhan / Justifikasi */}
                <div className="text-xs">
                  <label className="block text-zinc-400 font-bold mb-1.5">
                    Alasan Kebutuhan / Justifikasi Pengajuan
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Contoh: Stok Aqua 600ml sisa 4 botol di rak etalase, lonjakan transaksi akhir pekan..."
                    value={prNotes}
                    onChange={(e) => setPrNotes(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-purple-500 transition resize-none"
                  />
                </div>

                {/* 5. Toggle Bar Notifikasi Approval */}
                <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-200">
                    Kirim notifikasi otomatis ke Manager / Owner untuk Approval?
                  </span>
                  <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setPrNotifyManager(true)}
                      className={`px-4 py-1.5 rounded-lg font-bold transition text-xs cursor-pointer ${
                        prNotifyManager
                          ? 'bg-purple-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Ya
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrNotifyManager(false)}
                      className={`px-4 py-1.5 rounded-lg font-bold transition text-xs cursor-pointer ${
                        !prNotifyManager
                          ? 'bg-zinc-800 text-white shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      Tidak
                    </button>
                  </div>
                </div>
              </div>

              {/* Kolom Kanan: Ringkasan Anggaran PR & Otorisasi Approval */}
              <div className="lg:col-span-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4 shadow-sm h-fit">
                <div className="space-y-3">
                  <h3 className="font-bold text-white text-sm">Ringkasan Anggaran PR</h3>
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Jumlah Item Produk</span>
                    <span className="font-mono font-bold text-white">{prCartItems.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Total Kuantitas Diminta</span>
                    <span className="font-mono font-bold text-white">{totalPrQty}</span>
                  </div>
                  <div className="p-3.5 bg-zinc-950 border border-zinc-800/80 rounded-xl flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-300">Estimasi Total Anggaran</span>
                    <span className="font-mono font-black text-purple-400 text-base">
                      Rp {totalPrBudget.toLocaleString('id-ID')}
                    </span>
                  </div>
                </div>

                <div className="space-y-3 pt-3 border-t border-zinc-800/80 text-xs">
                  <h3 className="font-bold text-white text-sm">Alur Persetujuan &amp; Prioritas</h3>
                  <div>
                    <label className="block text-zinc-400 font-bold mb-1">Tingkat Urgensi</label>
                    <select
                      value={prUrgency}
                      onChange={(e) => setPrUrgency(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                    >
                      <option value="Tinggi (Stok Kritis / Habis)">Tinggi (Stok Kritis / Habis)</option>
                      <option value="Sedang (Buffer Menipis)">Sedang (Buffer Menipis)</option>
                      <option value="Normal (Restock Rutin)">Normal (Restock Rutin)</option>
                      <option value="Rendah (Permintaan Khusus)">Rendah (Permintaan Khusus)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-bold mb-1">Ditujukan ke Approver</label>
                    <select
                      value={prApprover}
                      onChange={(e) => setPrApprover(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                    >
                      <option value="Manager Operasional Toko">Manager Operasional Toko</option>
                      <option value="Owner Toko (Pusat)">Owner Toko (Pusat)</option>
                      <option value="Supervisor Pembelian">Supervisor Pembelian</option>
                    </select>
                  </div>

                  <div className="p-3 bg-zinc-950 border border-zinc-800/80 rounded-xl flex items-center justify-between text-xs">
                    <span className="text-zinc-400">Status Awal PR:</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800">
                      Menunggu Persetujuan
                    </span>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleSavePurchaseRequest}
                    disabled={isSubmittingPr || prCartItems.length === 0}
                    className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs sm:text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-purple-950/40 cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    <span>{isSubmittingPr ? 'Mengirim Pengajuan...' : '✓ Ajukan Request Pembelian (PR)'}</span>
                  </button>
                  <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
                    Pengajuan PR akan masuk ke antrian verifikasi manajer. Setelah disetujui, dapat langsung dikonversi menjadi PO resmi.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Tabel Riwayat PR di Bawah Form */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-purple-400" />
                <h3 className="font-bold text-sm text-white uppercase tracking-wider">
                  Daftar Permintaan Restock (Purchase Requisition)
                </h3>
              </div>
              <span className="text-xs font-mono font-bold text-zinc-400">
                {purchaseRequests.length} Pengajuan Tercatat
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800 select-none">
                  <tr>
                    <th className="py-2.5 px-3 font-bold">No. PR</th>
                    <th className="py-2.5 px-3 font-bold">Tanggal</th>
                    <th className="py-2.5 px-3 font-bold">Pemohon / Outlet</th>
                    <th className="py-2.5 px-3 font-bold text-center">Prioritas</th>
                    <th className="py-2.5 px-3 font-bold">Rincian Produk</th>
                    <th className="py-2.5 px-3 font-bold text-center">Qty Minta</th>
                    <th className="py-2.5 px-3 font-bold text-right">Est. Biaya</th>
                    <th className="py-2.5 px-3 font-bold text-center">Status</th>
                    <th className="py-2.5 px-3 font-bold text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {purchaseRequests.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-zinc-500">
                        Belum ada pengajuan PR. Buat pengajuan baru di formulir atas.
                      </td>
                    </tr>
                  ) : (
                    purchaseRequests.map((pr) => (
                      <tr key={pr.id} className="hover:bg-zinc-800/40 transition">
                        <td className="py-2.5 px-3 font-mono font-bold text-purple-400">{pr.id}</td>
                        <td className="py-2.5 px-3 text-zinc-400 whitespace-nowrap">{pr.date}</td>
                        <td className="py-2.5 px-3">
                          <span className="font-bold text-white block">{pr.requester}</span>
                          <span className="text-[10px] text-zinc-500">{pr.department || 'Toko'}</span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              (pr.urgency || '').includes('Tinggi')
                                ? 'bg-rose-950 text-rose-400 border border-rose-800'
                                : (pr.urgency || '').includes('Sedang')
                                ? 'bg-amber-950 text-amber-400 border border-amber-800'
                                : 'bg-blue-950 text-blue-400 border border-blue-800'
                            }`}
                          >
                            {pr.urgency || 'Normal'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 max-w-xs truncate" title={pr.productSummary || pr.product}>
                          {pr.productSummary || pr.product || '-'}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono font-bold">
                          {pr.requestedQty || `${pr.itemsCount || 1} Item`}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-purple-400">
                          Rp {Number(pr.estimatedCost || 0).toLocaleString('id-ID')}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              (pr.status || '').toLowerCase().includes('setujui')
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : (pr.status || '').toLowerCase().includes('tolak')
                                ? 'bg-rose-950 text-rose-400 border border-rose-800'
                                : 'bg-blue-950 text-blue-300 border border-blue-800'
                            }`}
                          >
                            {pr.status || 'Pending'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {/* Tombol Konversi ke PO */}
                            <button
                              type="button"
                              onClick={() => handleConvertPrToPo(pr)}
                              title="Konversi pengajuan ini ke PO Resmi"
                              className="px-2 py-1 rounded-lg bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/30 text-[10px] font-bold transition flex items-center gap-1 cursor-pointer"
                            >
                              <ArrowUpRight className="w-3 h-3" />
                              <span>Buat PO</span>
                            </button>

                            {/* Tombol Setujui */}
                            {(pr.status || '').toLowerCase().includes('tunggu') && (
                              <>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await updatePurchaseRequest(pr.id, {
                                      status: 'Disetujui (Approved)',
                                    });
                                    showToast(`PR ${pr.id} telah disetujui.`);
                                  }}
                                  title="Setujui PR ini"
                                  className="p-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-800 transition cursor-pointer"
                                >
                                  <CheckCircle className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const reason = window.prompt('Masukkan alasan penolakan PR:');
                                    if (reason !== null) {
                                      await updatePurchaseRequest(pr.id, {
                                        status: `Ditolak (${reason.trim() || 'Budget Tidak Mencukupi'})`,
                                      });
                                      showToast(`PR ${pr.id} telah ditolak.`);
                                    }
                                  }}
                                  title="Tolak PR ini"
                                  className="p-1 rounded-lg bg-rose-950/80 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-800 transition cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}

                            {/* Tombol Detail */}
                            <button
                              type="button"
                              onClick={() =>
                                setDetailModal({
                                  title: `Detail Request Pembelian: ${pr.id}`,
                                  data: {
                                    'No. PR': pr.id,
                                    Tanggal: pr.date,
                                    'Target Dibutuhkan': pr.targetDate || '-',
                                    Pemohon: pr.requester,
                                    Departemen: pr.department || 'Toko',
                                    Prioritas: pr.urgency,
                                    'Produk Diajukan': pr.productSummary || pr.product || '-',
                                    'Total Qty': pr.requestedQty || `${pr.itemsCount || 1} Item`,
                                    'Estimasi Biaya': `Rp ${Number(pr.estimatedCost || 0).toLocaleString('id-ID')}`,
                                    Status: pr.status,
                                    Approver: pr.approver || '-',
                                    Justifikasi: pr.notes || '-',
                                  },
                                })
                              }
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5 text-purple-400" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. VIEW: DAFTAR PEMBELIAN (PO) (activeSub === 'daftar_pembelian') */}
      {/* Form 2 Kolom Sesuai Desain screenshot_1.png (Domain: B2B Official PO) */}
      {/* ========================================================================= */}
      {activeSub === 'daftar_pembelian' && (
        <div className="space-y-8">
          <div className="space-y-4">
            {/* Header Box Form */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                  <span>Penerbitan Purchase Order (PO) Resmi Supplier</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                    B2B PROCUREMENT
                  </span>
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Terbitkan dokumen komitmen pemesanan barang ke pemasok, lengkapi termin pembayaran tempo dan jadwal kirim gudang.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveSub('pembelian_produk')}
                className="px-3.5 py-1.5 rounded-xl bg-blue-600/20 border border-blue-500/40 hover:bg-blue-600 text-blue-300 hover:text-white text-xs font-bold transition flex items-center gap-1 cursor-pointer"
              >
                <ShoppingBag className="w-4 h-4" />
                <span>Form Pembelian Tunai / Kasir</span>
              </button>
            </div>

            {/* 2-Column Form Grid PO */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Kolom Kiri: Pemasok, Tanggal, Cari Produk, Tabel Item PO & Instruksi Vendor */}
              <div className="lg:col-span-8 bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  {/* Supplier Search */}
                  <div className="space-y-3">
                    <div className="relative">
                      <label className="block text-zinc-400 font-bold mb-1.5">Pemasok / Vendor Mitra</label>
                      <div className="relative">
                        <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Ketik nama vendor..."
                          value={poSupplier || poSupplierSearch}
                          onChange={(e) => {
                            setPoSupplier(e.target.value);
                            setPoSupplierSearch(e.target.value);
                            setShowPoSupplierDropdown(true);
                          }}
                          onFocus={() => setShowPoSupplierDropdown(true)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition"
                        />
                      </div>
                      {showPoSupplierDropdown && (
                        <div className="absolute left-0 right-0 mt-1 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl z-30 max-h-48 overflow-y-auto divide-y divide-zinc-800/60">
                          {matchedPoSuppliers.map((s) => (
                            <button
                              key={s.id || s.name}
                              type="button"
                              onClick={() => {
                                setPoSupplier(s.name);
                                setPoSupplierSearch(s.name);
                                if (s.paymentTerms) setPoPaymentTerms(s.paymentTerms);
                                setShowPoSupplierDropdown(false);
                              }}
                              className="w-full text-left px-3.5 py-2 hover:bg-zinc-800 text-zinc-200 flex items-center justify-between transition cursor-pointer"
                            >
                              <div>
                                <span className="font-bold block">{s.name}</span>
                                <span className="text-[10px] text-zinc-500">{s.paymentTerms || 'Tempo 30 Hari'}</span>
                              </div>
                              <span className="text-[10px] font-mono text-amber-400 font-bold">
                                ★ {s.rating || 5.0}
                              </span>
                            </button>
                          ))}
                          <div
                            onClick={() => setShowPoSupplierDropdown(false)}
                            className="p-1.5 text-center text-[10px] text-zinc-500 hover:text-zinc-300 bg-zinc-900 cursor-pointer"
                          >
                            Tutup Saran
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Tanggal Produksi dibawah Pemasok */}
                    <div>
                      <label className="block text-zinc-400 font-bold mb-1.5">Tanggal Produksi</label>
                      <input
                        type="date"
                        value={poProductionDate}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPoProductionDate(val);
                          setPoCartItems((prev) =>
                            prev.map((item) => ({ ...item, productionDate: val }))
                          );
                        }}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500 transition [color-scheme:dark]"
                      />
                    </div>
                  </div>

                  {/* Tanggal PO & Tanggal Produksi dibawah Tanggal Beli / PO */}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-zinc-400 font-bold mb-1.5">Tanggal Terbit PO</label>
                      <input
                        type="date"
                        value={poDate}
                        onChange={(e) => setPoDate(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500 transition [color-scheme:dark]"
                      />
                    </div>

                    <div>
                      <label className="block text-zinc-400 font-bold mb-1.5">Tanggal Produksi</label>
                      <input
                        type="date"
                        value={poProductionDate}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPoProductionDate(val);
                          setPoCartItems((prev) =>
                            prev.map((item) => ({ ...item, productionDate: val }))
                          );
                        }}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500 transition [color-scheme:dark]"
                      />
                    </div>
                  </div>

                  {/* Estimasi Kedatangan (ETA) & Tanggal Expired */}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-zinc-400 font-bold mb-1.5">Estimasi Kirim (ETA)</label>
                      <input
                        type="date"
                        value={poExpectedDate}
                        onChange={(e) => setPoExpectedDate(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500 transition [color-scheme:dark]"
                      />
                    </div>

                    <div>
                      <label className="block text-zinc-400 font-bold mb-1.5">Tanggal Expired</label>
                      <input
                        type="date"
                        value={poExpiryDate}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPoExpiryDate(val);
                          setPoCartItems((prev) =>
                            prev.map((item) => ({ ...item, expiryDate: val }))
                          );
                        }}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500 transition [color-scheme:dark]"
                      />
                    </div>
                  </div>
                </div>

                {/* Cari Produk Kontrak PO */}
                <div className="relative text-xs">
                  <label className="block text-zinc-400 font-bold mb-1.5">
                    Cari Produk Kontrak Pemesanan (PO)
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Ketik nama produk atau kode barang untuk dimasukkan ke PO..."
                      value={poProductSearch}
                      onChange={(e) => {
                        setPoProductSearch(e.target.value);
                        setShowPoProductDropdown(true);
                      }}
                      onFocus={() => setShowPoProductDropdown(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && matchedPoProducts.length > 0) {
                          e.preventDefault();
                          handleAddProductToPoCart(matchedPoProducts[0]);
                        }
                      }}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition"
                    />
                  </div>

                  {showPoProductDropdown && poProductSearch.trim() && (
                    <div className="absolute left-0 right-0 mt-1 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl z-30 max-h-60 overflow-y-auto divide-y divide-zinc-800/60">
                      {matchedPoProducts.map((p) => (
                        <div
                          key={p.id}
                          onClick={() => handleAddProductToPoCart(p)}
                          className="p-3 hover:bg-zinc-800 flex items-center justify-between cursor-pointer transition"
                        >
                          <div>
                            <div className="font-bold text-white text-xs">{p.name}</div>
                            <div className="text-[10px] text-zinc-400 flex items-center gap-2 mt-0.5">
                              <span className="font-mono bg-zinc-800 px-1 rounded">SKU: {p.sku}</span>
                              <span>1 Dus = {p.piecesPerCarton || 24} pcs</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="font-mono font-bold text-amber-400 text-xs block">
                              Harga Dus: Rp {(p.pricePerCarton || (p.costPerUnit || 1000) * 24).toLocaleString('id-ID')}
                            </span>
                            <span className="text-[10px] text-amber-400 font-bold">+ Tambah Item PO</span>
                          </div>
                        </div>
                      ))}
                      <div
                        onClick={() => setShowPoProductDropdown(false)}
                        className="p-2 text-center text-[10px] text-zinc-500 hover:text-zinc-300 bg-zinc-900 cursor-pointer"
                      >
                        Tutup Pencarian
                      </div>
                    </div>
                  )}
                </div>

                {/* Tabel Item Kontrak PO */}
                <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/60">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800 select-none">
                      <tr>
                        <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px]">PRODUK</th>
                        <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] w-32">SATUAN</th>
                        <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] w-24 text-center">QTY PO</th>
                        <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] w-28 text-right">HARGA KONTRAK</th>
                        <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] w-20 text-center">DISKON%</th>
                        <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] w-32 text-right">SUBTOTAL</th>
                        <th className="py-2.5 px-2 w-10 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                      {poCartItems.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-12 text-center text-zinc-500 text-xs">
                            Belum ada produk dalam kontrak PO. Gunakan pencarian di atas untuk memasukkan pesanan pemasok.
                          </td>
                        </tr>
                      ) : (
                        poCartItems.map((item, idx) => (
                          <tr key={`${item.productId}-${idx}`} className="hover:bg-zinc-900/60 transition-colors">
                            <td className="py-2.5 px-3">
                              <div className="font-bold text-white text-xs">{item.productName}</div>
                              <span className="font-mono text-[10px] text-zinc-400">{item.sku}</span>
                            </td>
                            <td className="py-2.5 px-3">
                              <select
                                value={item.unit}
                                onChange={(e) => handleUpdatePoCartItem(idx, 'unit', e.target.value)}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500 cursor-pointer"
                              >
                                <option value="Karton">Dus / Karton ({item.piecesPerCarton} Pcs)</option>
                                <option value="Pcs">Pcs / Unit</option>
                              </select>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <input
                                type="number"
                                min="1"
                                value={item.qty}
                                onChange={(e) => handleUpdatePoCartItem(idx, 'qty', e.target.value)}
                                className="w-16 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-center font-mono font-bold text-white text-xs focus:outline-none focus:border-amber-500"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <input
                                type="number"
                                min="0"
                                value={item.contractPrice}
                                onChange={(e) => handleUpdatePoCartItem(idx, 'contractPrice', e.target.value)}
                                className="w-24 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-right font-mono text-white text-xs focus:outline-none focus:border-amber-500"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={item.discountPercent}
                                onChange={(e) => handleUpdatePoCartItem(idx, 'discountPercent', e.target.value)}
                                className="w-14 bg-zinc-900 border border-zinc-800 rounded-lg px-1.5 py-1 text-center font-mono text-white text-xs focus:outline-none focus:border-amber-500"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-400 text-xs">
                              Rp {item.subtotal.toLocaleString('id-ID')}
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemovePoCartItem(idx)}
                                className="p-1 rounded-lg hover:bg-rose-950/80 text-zinc-500 hover:text-rose-400 transition cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Lokasi Gudang & Instruksi Pengiriman */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-zinc-400 font-bold mb-1.5">Gudang / Lokasi Penerima</label>
                    <select
                      value={poWarehouse}
                      onChange={(e) => setPoWarehouse(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500 cursor-pointer"
                    >
                      <option value="Gudang Utama Toko">Gudang Utama Toko (Sentral)</option>
                      <option value="Gudang Transit Pusat">Gudang Transit Logistik</option>
                      <option value="Rak Etalase Depan">Rak Etalase Toko Depan</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-zinc-400 font-bold mb-1.5">No. Dokumen Kontrak PO</label>
                    <input
                      type="text"
                      value={poDocNumber}
                      onChange={(e) => setPoDocNumber(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono font-bold focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="text-xs">
                  <label className="block text-zinc-400 font-bold mb-1.5">Instruksi Khusus Vendor / Pengiriman</label>
                  <textarea
                    rows={2}
                    placeholder="Instruksi pengantaran (misal: Pengiriman dengan armada pendingin, lampirkan faktur pajak asli)..."
                    value={poVendorNotes}
                    onChange={(e) => setPoVendorNotes(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition resize-none"
                  />
                </div>

                <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-200">
                    Terbitkan sebagai PO Resmi Aktif ke Vendor?
                  </span>
                  <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setPoIsOfficialActive(true)}
                      className={`px-4 py-1.5 rounded-lg font-bold transition text-xs cursor-pointer ${
                        poIsOfficialActive
                          ? 'bg-amber-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Ya (Resmi)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPoIsOfficialActive(false)}
                      className={`px-4 py-1.5 rounded-lg font-bold transition text-xs cursor-pointer ${
                        !poIsOfficialActive
                          ? 'bg-zinc-800 text-white shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      Draf Saja
                    </button>
                  </div>
                </div>
              </div>

              {/* Kolom Kanan: Finansial PO, PPN, Ongkir, & Uang Muka (DP) */}
              <div className="lg:col-span-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4 shadow-sm h-fit">
                <div className="space-y-3">
                  <h3 className="font-bold text-white text-sm">Kalkulasi Finansial PO</h3>
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Subtotal Produk</span>
                    <span className="font-mono font-bold text-white">
                      Rp {poSubtotal.toLocaleString('id-ID')}
                    </span>
                  </div>

                  {/* PPN */}
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Pajak PPN:</span>
                    <select
                      value={poTaxRate}
                      onChange={(e) => setPoTaxRate(Number(e.target.value))}
                      className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-0.5 text-xs text-white cursor-pointer"
                    >
                      <option value="0">Non-PPN (0%)</option>
                      <option value="11">PPN 11%</option>
                    </select>
                  </div>

                  {poTaxRate > 0 && (
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span>Nilai Pajak (11%)</span>
                      <span className="font-mono text-zinc-200">
                        +Rp {poTaxAmount.toLocaleString('id-ID')}
                      </span>
                    </div>
                  )}

                  {/* Ongkir */}
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Ongkos Kirim / Logistik (Rp):</span>
                    <input
                      type="number"
                      min="0"
                      value={poShippingFee}
                      onChange={(e) => setPoShippingFee(Math.max(0, Number(e.target.value) || 0))}
                      className="w-28 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-0.5 text-right font-mono text-xs text-white"
                    />
                  </div>

                  <div className="p-3.5 bg-zinc-950 border border-zinc-800/80 rounded-xl flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-300">Grand Total PO</span>
                    <span className="font-mono font-black text-amber-400 text-base">
                      Rp {poGrandTotal.toLocaleString('id-ID')}
                    </span>
                  </div>
                </div>

                <div className="space-y-3 pt-3 border-t border-zinc-800/80 text-xs">
                  <h3 className="font-bold text-white text-sm">Skema Termin &amp; Uang Muka (DP)</h3>
                  <div>
                    <label className="block text-zinc-400 font-bold mb-1">Termin Pembayaran B2B</label>
                    <select
                      value={poPaymentTerms}
                      onChange={(e) => setPoPaymentTerms(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500 cursor-pointer"
                    >
                      <option value="Tempo 30 Hari">Tempo 30 Hari (Net 30)</option>
                      <option value="Tempo 14 Hari">Tempo 14 Hari (Net 14)</option>
                      <option value="Cash On Delivery (COD)">Cash On Delivery (COD - Tiba)</option>
                      <option value="Uang Muka (DP 50%)">Uang Muka (DP 50% + Pelunasan)</option>
                      <option value="Transfer Bank Dimuka">Transfer Bank Dimuka (Lunas)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-bold mb-1">Uang Muka / DP Dibayar (Rp)</label>
                    <input
                      type="number"
                      min="0"
                      value={poDpAmount}
                      onChange={(e) => setPoDpAmount(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono font-bold focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-bold mb-1">Metode Pembayaran (DP / Tunai PO)</label>
                    <select
                      value={poDpPaymentMethod}
                      onChange={(e) => setPoDpPaymentMethod(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500 cursor-pointer"
                    >
                      {PO_PAYMENT_METHODS.map((methodOpt) => (
                        <option key={methodOpt} value={methodOpt}>
                          {methodOpt}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="p-3.5 bg-zinc-950 border border-zinc-800/80 rounded-xl flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-300">Sisa Kewajiban Hutang</span>
                    <span className="font-mono font-black text-rose-400 text-base">
                      Rp {poRemainingDebt.toLocaleString('id-ID')}
                    </span>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleSaveOfficialPo}
                    disabled={isSubmittingPo || poCartItems.length === 0}
                    className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs sm:text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40 cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isSubmittingPo ? 'Menerbitkan...' : '✓ Terbitkan Purchase Order Resmi (PO)'}</span>
                  </button>
                  <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
                    PO resmi akan tercatat di buku besar hutang dagang dan siap divalidasi saat barang fisik tiba di gudang.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Tabel Daftar PO di Bawah Form */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-400" />
                <h3 className="font-bold text-sm text-white uppercase tracking-wider">
                  Daftar Seluruh Purchase Order (PO) Aktif
                </h3>
              </div>
              <span className="text-xs font-mono font-bold text-zinc-400">
                {orders.length} Dokumen PO
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800 select-none">
                  <tr>
                    <th className="py-2.5 px-3 font-bold">No. PO</th>
                    <th className="py-2.5 px-3 font-bold">Tanggal Order</th>
                    <th className="py-2.5 px-3 font-bold">Supplier</th>
                    <th className="py-2.5 px-3 font-bold">Produk Dipesan</th>
                    <th className="py-2.5 px-3 font-bold text-center">Total Qty</th>
                    <th className="py-2.5 px-3 font-bold text-center">Status Kirim</th>
                    <th className="py-2.5 px-3 font-bold">Status Bayar</th>
                    <th className="py-2.5 px-3 font-bold text-right">Dibayar / DP</th>
                    <th className="py-2.5 px-3 font-bold text-right">Sisa Hutang</th>
                    <th className="py-2.5 px-3 font-bold text-right">Nilai Total</th>
                    <th className="py-2.5 px-3 font-bold text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-zinc-500">
                        Belum ada dokumen PO. Gunakan formulir penerbitan PO di atas.
                      </td>
                    </tr>
                  ) : (
                    orders.map((po) => {
                      const debt = Number(po.remainingDebt || 0);
                      const paid = Number(po.paidAmount ?? (po.paymentStatus?.toLowerCase().includes('tempo') ? 0 : po.totalAmount));
                      const isReceived = (po.deliveryStatus || '').toLowerCase().includes('diterima');

                      return (
                        <tr
                          key={po.id}
                          onClick={() => openTransactionDetailModal(po, 'PURCHASE')}
                          className="hover:bg-zinc-800/40 transition cursor-pointer"
                        >
                          <td className="py-2.5 px-3 font-mono font-bold text-amber-400 hover:underline">{po.id}</td>
                          <td className="py-2.5 px-3 text-zinc-400 whitespace-nowrap">{po.date}</td>
                          <td className="py-2.5 px-3 font-bold text-white">{po.supplier}</td>
                          <td className="py-2.5 px-3 max-w-xs truncate" title={po.productSummary || po.productName}>
                            {po.productSummary || po.productName || '-'}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono">{po.itemsCount || 1}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                isReceived
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : 'bg-amber-950 text-amber-400 border border-amber-800'
                              }`}
                            >
                              {po.deliveryStatus || 'Menunggu Pengiriman'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-zinc-300">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                (po.paymentStatus || '').toLowerCase().includes('lunas')
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : 'bg-rose-950 text-rose-400 border border-rose-800'
                              }`}
                            >
                              {po.paymentStatus || 'Tempo 30 Hari'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-emerald-400">
                            Rp {paid.toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold">
                            <span className={debt > 0 ? 'text-rose-400' : 'text-zinc-500'}>
                              Rp {debt.toLocaleString('id-ID')}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                            Rp {Number(po.totalAmount || 0).toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1.5">
                              {/* Tombol Terima Barang di Gudang */}
                              {!isReceived && (
                                <button
                                  type="button"
                                  onClick={() => handleConfirmPoGoodsReceived(po)}
                                  title="Konfirmasi barang fisik tiba & masukkan ke stok"
                                  className="px-2 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/30 text-[10px] font-bold transition flex items-center gap-1 cursor-pointer"
                                >
                                  <CheckCircle className="w-3 h-3" />
                                  <span>Terima Barang</span>
                                </button>
                              )}

                              {/* Tombol Bayar / Pelunasan Hutang PO */}
                              {debt > 0 && (
                                <button
                                  type="button"
                                  onClick={() => openPayPoModal(po)}
                                  title="Bayar cicilan / pelunasan hutang supplier"
                                  className="px-2 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-[10px] font-bold transition flex items-center gap-1 cursor-pointer"
                                >
                                  <DollarSign className="w-3 h-3" />
                                  <span>Bayar</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => openTransactionDetailModal(po, 'PURCHASE')}
                                title="Lihat Detail & Fulfillment PO"
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950 text-zinc-300 hover:text-white transition cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5 text-amber-400" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. VIEW: STATISTIK PEMBELIAN (activeSub === 'statistik_pembelian') */}
      {/* ========================================================================= */}
      {activeSub === 'statistik_pembelian' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-blue-500/50 transition">
              <span className="text-zinc-500 block text-[10px] uppercase font-bold">
                Total Pembelian (PO)
              </span>
              <span className="text-2xl font-mono font-black text-white mt-1 block">
                Rp{' '}
                {orders
                  .reduce((acc, o) => acc + Number(o.totalAmount || 0), 0)
                  .toLocaleString('id-ID')}
              </span>
              <span className="text-blue-400 text-[11px] font-bold flex items-center gap-1 mt-1">
                <TrendingUp className="w-3 h-3" />
                {orders.length} Purchase Order Tercatat
              </span>
            </div>

            <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-amber-500/50 transition">
              <span className="text-zinc-500 block text-[10px] uppercase font-bold">
                Volume Barang Diterima
              </span>
              <span className="text-2xl font-mono font-black text-amber-400 mt-1 block">
                {orders.reduce((acc, o) => acc + Number(o.itemsCount || 0), 0)} Dus / Qty
              </span>
              <span className="text-zinc-400 text-[11px] mt-1 block font-mono">
                {orders.reduce((acc, o) => acc + Number(o.totalUnits || o.itemsCount || 0), 0)} Total Unit
              </span>
            </div>

            <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-emerald-500/50 transition">
              <span className="text-zinc-500 block text-[10px] uppercase font-bold">
                Total Dibayar ke Supplier
              </span>
              <span className="text-2xl font-mono font-black text-emerald-400 mt-1 block">
                Rp{' '}
                {orders
                  .reduce(
                    (acc, o) =>
                      acc +
                      Number(
                        o.paidAmount ??
                          (o.paymentStatus?.toLowerCase().includes('tempo')
                            ? 0
                            : o.totalAmount) ??
                          0
                      ),
                    0
                  )
                  .toLocaleString('id-ID')}
              </span>
              <span className="text-zinc-400 text-[11px] mt-1 block">Kas &amp; Bank Keluar</span>
            </div>

            <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-rose-500/50 transition">
              <span className="text-zinc-500 block text-[10px] uppercase font-bold">
                Hutang Dagang Supplier (Tempo)
              </span>
              <span className="text-2xl font-mono font-black text-rose-400 mt-1 block">
                Rp{' '}
                {orders
                  .reduce(
                    (acc, o) =>
                      acc +
                      Number(
                        o.remainingDebt ??
                          (o.paymentStatus?.toLowerCase().includes('tempo')
                            ? o.totalAmount
                            : 0) ??
                          0
                      ),
                    0
                  )
                  .toLocaleString('id-ID')}
              </span>
              <span className="text-rose-400 text-[11px] mt-1 block font-semibold">
                Kewajiban Pembayaran Berjalan
              </span>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm text-white uppercase tracking-wider">
                  Tabel Statistik &amp; Rekap Pembelian Produk
                </h3>
              </div>
              <span className="text-xs text-zinc-400 font-mono">
                {orders.length} Dokumen PO
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800 select-none">
                  <tr>
                    <th className="py-2.5 px-3 font-bold">No. PO / Tanggal</th>
                    <th className="py-2.5 px-3 font-bold">Produk</th>
                    <th className="py-2.5 px-3 font-bold">Supplier</th>
                    <th className="py-2.5 px-3 font-bold text-center">Qty Masuk</th>
                    <th className="py-2.5 px-3 font-bold text-right">Harga Beli</th>
                    <th className="py-2.5 px-3 font-bold text-right">Total Belanja</th>
                    <th className="py-2.5 px-3 font-bold text-right">Dibayar</th>
                    <th className="py-2.5 px-3 font-bold text-right">Sisa Hutang</th>
                    <th className="py-2.5 px-3 font-bold text-center">Status Stok</th>
                    <th className="py-2.5 px-3 font-bold text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-zinc-500">
                        Belum ada data pengadaan untuk dianalisis.
                      </td>
                    </tr>
                  ) : (
                    orders.map((po) => {
                      const debt = Number(po.remainingDebt || 0);
                      const paid = Number(po.paidAmount ?? (po.paymentStatus?.toLowerCase().includes('tempo') ? 0 : po.totalAmount));

                      return (
                        <tr
                          key={po.id}
                          onClick={() => openTransactionDetailModal(po, 'PURCHASE')}
                          className="hover:bg-zinc-800/40 transition cursor-pointer"
                        >
                          <td className="py-2.5 px-3">
                            <span className="font-mono font-bold text-amber-400 hover:underline block">{po.id}</span>
                            <span className="text-[10px] text-zinc-500">{po.date}</span>
                          </td>
                          <td className="py-2.5 px-3 font-bold text-white max-w-xs truncate" title={po.productSummary || po.productName}>
                            {po.productSummary || po.productName || 'Pengadaan Supplier'}
                          </td>
                          <td className="py-2.5 px-3 text-zinc-300">{po.supplier}</td>
                          <td className="py-2.5 px-3 text-center font-mono font-bold text-amber-400">
                            +{po.itemsCount || 1}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">
                            Rp{' '}
                            {Math.round(
                              Number(po.totalAmount || 0) / Math.max(1, Number(po.itemsCount || 1))
                            ).toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                            Rp {Number(po.totalAmount || 0).toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-emerald-400">
                            Rp {paid.toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold">
                            <span className={debt > 0 ? 'text-rose-400' : 'text-zinc-500'}>
                              Rp {debt.toLocaleString('id-ID')}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                po.addToStock !== false
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : 'bg-zinc-800 text-zinc-400'
                              }`}
                            >
                              {po.addToStock !== false ? 'Masuk Stok' : 'Non-Stok'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => openTransactionDetailModal(po, 'PURCHASE')}
                              title="Lihat Detail & Fulfillment PO"
                              className="p-1 rounded-lg bg-zinc-800 hover:bg-amber-950 text-zinc-300 hover:text-white transition cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5 text-amber-400" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. VIEW: DAFTAR SUPPLIER (activeSub === 'daftar_supplier') */}
      {/* ========================================================================= */}
      {activeSub === 'daftar_supplier' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Cari nama supplier, kontak, kategori..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <button
              onClick={handleOpenAddSupplier}
              className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-md cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Supplier</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {suppliers
              .filter(
                (s) =>
                  !searchQuery ||
                  (s.name && s.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
                  (s.category && s.category.toLowerCase().includes(searchQuery.toLowerCase()))
              )
              .map((sup) => (
                <div
                  key={sup.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3 hover:border-zinc-700 transition"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-white text-sm">{sup.name}</h4>
                      <span className="text-[10px] text-zinc-500">{sup.category}</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-bold text-[10px] border border-amber-500/20">
                      ★ {sup.rating || 5.0}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-zinc-800/80">
                    <div>
                      <span className="text-zinc-500 block text-[10px]">Syarat Pembayaran:</span>
                      <span className="font-bold text-zinc-200">{sup.paymentTerms}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block text-[10px]">Lead Time:</span>
                      <span className="font-bold text-zinc-200">{sup.leadTimeDays} Hari</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-zinc-800/80 text-zinc-400">
                    <span className="flex items-center gap-1 text-[11px]">
                      <Phone className="w-3 h-3 text-zinc-500" />
                      {sup.phone}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleOpenEditSupplier(sup)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-amber-400 text-xs font-bold transition cursor-pointer"
                      >
                        <Edit2 className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => {
                          setPoSupplier(sup.name);
                          setPoSupplierSearch(sup.name);
                          setActiveSub('daftar_pembelian');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-amber-400 text-xs font-bold transition cursor-pointer"
                      >
                        + Buat PO
                      </button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Modal: Tambah / Edit Supplier */}
      {showAddSupplierModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">
                  {editingSupplier ? 'Edit Data Supplier' : 'Tambah Supplier Baru'}
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowAddSupplierModal(false);
                  setEditingSupplier(null);
                }}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveSupplier} className="space-y-4 pt-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Nama Perusahaan / Supplier *</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: PT Sumber Pangan Nusantara"
                  value={newSupName}
                  onChange={(e) => setNewSupName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Kategori Produk</label>
                  <input
                    type="text"
                    placeholder="Sembako / Minuman"
                    value={newSupCategory}
                    onChange={(e) => setNewSupCategory(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Term Pembayaran</label>
                  <select
                    value={newSupTerms}
                    onChange={(e) => setNewSupTerms(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="Cash On Delivery (COD)">COD (Bayar di Tempat)</option>
                    <option value="Tempo 14 Hari">Tempo 14 Hari</option>
                    <option value="Tempo 30 Hari">Tempo 30 Hari</option>
                    <option value="Transfer Dimuka">Transfer Dimuka</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Contact Person / PIC</label>
                  <input
                    type="text"
                    placeholder="Nama PIC"
                    value={newSupContact}
                    onChange={(e) => setNewSupContact(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">No. WhatsApp / HP</label>
                  <input
                    type="text"
                    placeholder="+62 8..."
                    value={newSupPhone}
                    onChange={(e) => setNewSupPhone(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddSupplierModal(false);
                    setEditingSupplier(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold transition shadow-lg cursor-pointer"
                >
                  {editingSupplier ? 'Simpan Perubahan' : 'Simpan Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Detail Item */}
      {detailModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-white">{detailModal.title}</h3>
              <button
                onClick={() => setDetailModal(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2.5 text-xs">
              {Object.entries(detailModal.data).map(([k, val]) => (
                <div key={k} className="flex justify-between py-1.5 border-b border-zinc-800/60 gap-4">
                  <span className="text-zinc-400">{k}:</span>
                  <span className="font-bold text-white text-right">{String(val ?? '-')}</span>
                </div>
              ))}
            </div>
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setDetailModal(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Bayar Cicilan / Pelunasan Hutang PO */}
      {payPoModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-rose-400" />
                <h3 className="text-base font-bold text-white">
                  Pembayaran Hutang PO: {payPoModal.poNumber}
                </h3>
              </div>
              <button
                onClick={() => setPayPoModal(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePayPoDebt} className="space-y-4 text-xs">
              <div className="p-3 bg-zinc-950 border border-zinc-800/80 rounded-xl space-y-1.5">
                <div className="flex justify-between text-zinc-400">
                  <span>Supplier:</span>
                  <span className="font-bold text-white">{payPoModal.supplierName}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Total Nilai PO:</span>
                  <span className="font-mono font-bold text-white">
                    Rp {Number(payPoModal.totalAmount || 0).toLocaleString('id-ID')}
                  </span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Sisa Hutang Berjalan:</span>
                  <span className="font-mono font-black text-rose-400">
                    Rp {Number(payPoModal.remainingDebt || 0).toLocaleString('id-ID')}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-zinc-400 font-bold mb-1.5">
                  Nominal Dibayarkan (Rp) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  max={Number(payPoModal.remainingDebt || 0)}
                  value={payPoAmount}
                  onChange={(e) => setPayPoAmount(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono font-bold focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-bold mb-1.5">Metode Pembayaran</label>
                <select
                  value={payPoMethod}
                  onChange={(e) => setPayPoMethod(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-rose-500 cursor-pointer"
                >
                  {PO_PAYMENT_METHODS.map((methodOpt) => (
                    <option key={methodOpt} value={methodOpt}>
                      {methodOpt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setPayPoModal(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold transition shadow-lg shadow-rose-950/40 cursor-pointer flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4" />
                  <span>Simpan Pembayaran</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
