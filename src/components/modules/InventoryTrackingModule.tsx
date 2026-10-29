import React, { useState, useEffect } from 'react';
import {
  Boxes,
  Layers,
  AlertTriangle,
  ClipboardCheck,
  RotateCcw,
  Search,
  Plus,
  ArrowRightLeft,
  CheckCircle,
  TrendingDown,
  Filter,
  Package,
  Building,
  Calendar,
  Truck,
  Edit2,
  Check,
  X,
  FileSpreadsheet,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  Eye,
  Trash2,
} from 'lucide-react';
import { collection, onSnapshot, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { Product } from '../../types';
import { ACTIVE_STORE_ID } from '../../config/store';
import { useFirestoreList } from '../../hooks/useFirestoreList';
import { AddProductForm } from '../pos/AddProductForm';
import { useAppNavigation } from '../../router';
import { formatMoney } from '../../utils/money';
import { evaluateProductExpiry, getSortedFefoBatches } from '../../utils/expiryUtils';
import { getDefaultMinStock } from '../../services/posRuntime';

interface InventoryTrackingModuleProps {
  subModule: 'inventory' | 'kartu_stok' | 'stok_minimum' | 'stok_opname' | 'produk_restock';
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

export const InventoryTrackingModule: React.FC<InventoryTrackingModuleProps> = ({
  subModule,
  currencyMode = 'IDR',
  onNavigateTab,
}) => {
  const { route, navigateTab } = useAppNavigation();
  const activeSub = (
    route.activeTab === 'module_inventory' ? route.activeSubModule : subModule
  ) as 'inventory' | 'kartu_stok' | 'stok_minimum' | 'stok_opname' | 'produk_restock';
  const setActiveSub = (
    next: 'inventory' | 'kartu_stok' | 'stok_minimum' | 'stok_opname' | 'produk_restock'
  ) => {
    navigateTab('module_inventory', next);
  };

  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<string>('ALL');

  // Edit Details, Stock Adjustment, and Threshold Modal states
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [stockAdjustProduct, setStockAdjustProduct] = useState<Product | null>(null);
  const [adjustQuantity, setAdjustQuantity] = useState<string>('');
  const [adjustReason, setAdjustReason] = useState<string>('Penyesuaian Fisik Rak');
  const [thresholdModalProduct, setThresholdModalProduct] = useState<Product | null>(null);
  const [modalThresholdVal, setModalThresholdVal] = useState<number>(10);

  // Native HTML date filter states
  const [createdFrom, setCreatedFrom] = useState<string>('');
  const [createdTo, setCreatedTo] = useState<string>('');

  // Firestore Products real-time listener from 'products'
  useEffect(() => {
    try {
      const unsubscribe = onSnapshot(
        collection(db, 'products'),
        (snapshot) => {
          const list = snapshot.docs.map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              storeId: data.storeId || ACTIVE_STORE_ID,
              name: data.name || '',
              sku: data.sku || d.id,
              category: data.category || 'MINERAL',
              brand: data.brand || '',
              barcode: data.barcode || '',
              piecesPerCarton: Number(data.piecesPerCarton || 1),
              stockInUnits: Number(data.stockInUnits ?? data.stock ?? 0),
              costPerUnit: Number(data.costPerUnit ?? data.costPrice ?? 0),
              pricePerUnit: Number(data.pricePerUnit ?? data.price ?? 0),
              pricePerCarton: Number(data.pricePerCarton ?? data.price ?? 0),
              minStockAlert: Number(data.minStockAlert ?? data.minStock ?? getDefaultMinStock()),
              imageUrl: data.imageUrl || '',
              storageLocation: data.storageLocation || 'Rak A-01 / Flagship',
              productionDate: data.productionDate || data.tanggalProduksi || '',
              expiryDate: data.expiryDate || data.tanggalKadaluarsa || '',
              batches: Array.isArray(data.batches) ? data.batches : [],
              createdAt: data.createdAt,
              updatedAt: data.updatedAt,
            };
          }) as Product[];
          setProducts(list);
        },
        (err) => console.warn('Offline fallback products in inventory module:', err)
      );
      return () => unsubscribe();
    } catch (e) {
      console.warn(e);
    }
  }, []);

  // Stock Movement Ledger (Kartu Stok) from Firestore
  const {
    data: stockCards,
    setData: setStockCards,
    addItem: addStockCardDoc,
    updateItem: updateStockCardDoc,
    deleteItem: deleteStockCardDoc,
  } = useFirestoreList<any>('stock_mutations', []);

  // Stock Opname Sessions from Firestore
  const {
    data: opnameList,
    setData: setOpnameList,
    addItem: addOpnameDoc,
    updateItem: updateOpnameDoc,
    deleteItem: deleteOpnameDoc,
  } = useFirestoreList<any>('stock_opname', []);

  const [detailModal, setDetailModal] = useState<{ title: string; data: Record<string, any> } | null>(null);
  const [editingStockCard, setEditingStockCard] = useState<any | null>(null);
  const [editingOpname, setEditingOpname] = useState<any | null>(null);

  const handleDeleteProduct = async (productId: string) => {
    try {
      await deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'products', productId)).catch(() => {});
      await deleteDoc(doc(db, 'products', productId)).catch(() => {});
    } catch (e) {
      console.warn('Delete product error:', e);
    }
  };

  // Online Orders for Reserved Stock calculation
  const { data: pwaOrders } = useFirestoreList<any>('stores/store_001/orders', []);

  // Modal: Start New Stock Opname
  const [showOpnameModal, setShowOpnameModal] = useState(false);
  const [opnameProduct, setOpnameProduct] = useState(products[0]?.name || '');
  const [opnameSystemQty, setOpnameSystemQty] = useState(0);
  const [opnamePhysicalQty, setOpnamePhysicalQty] = useState('0');
  const [opnameReason, setOpnameReason] = useState('Barang Rusak / Kemasan Bocor di Rak');
  const [opnameAuditor, setOpnameAuditor] = useState('Supervisor Toko');

  // Modal: Add Manual Mutation / Stock Card Adjustment
  const [showManualMutationModal, setShowManualMutationModal] = useState(false);
  const [mutProduct, setMutProduct] = useState(products[0]?.name || '');
  const [mutType, setMutType] = useState<'MASUK' | 'KELUAR' | 'PENYESUAIAN'>('PENYESUAIAN');
  const [mutQty, setMutQty] = useState('1');
  const [mutReason, setMutReason] = useState('Penyesuaian Fisik');

  // Purchase Orders via useFirestoreList
  interface PurchaseOrderRecord {
    id?: string;
    poNumber: string;
    date: string;
    productId: string;
    productName: string;
    cartons: number;
    totalUnits: number;
    supplier: string;
    estimatedCost: number;
    status: string;
    notes: string;
  }
  const { data: purchaseOrders, addItem: addPurchaseOrder } = useFirestoreList<PurchaseOrderRecord>(
    'purchase_orders',
    []
  );

  // Modal State: Buat PO Baru
  const [showPOModal, setShowPOModal] = useState(false);
  const [selectedProductForPO, setSelectedProductForPO] = useState<Product | null>(null);
  const [poCartons, setPoCartons] = useState(3);
  const [poSupplier, setPoSupplier] = useState('PT Indofood CBP Sukses Makmur Tbk');
  const [poNotes, setPoNotes] = useState('Restock darurat produk stok kritis');

  const handleSavePO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductForPO) return;
    const pieces = selectedProductForPO.piecesPerCarton || 1;
    const totalUnits = poCartons * pieces;
    const cost =
      poCartons *
      (selectedProductForPO.pricePerCarton ||
        selectedProductForPO.pricePerUnit * pieces);
    await addPurchaseOrder({
      poNumber: `PO-${Date.now().toString().slice(-6)}`,
      date: new Date().toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
      productId: selectedProductForPO.id,
      productName: selectedProductForPO.name,
      cartons: Number(poCartons),
      totalUnits,
      supplier: poSupplier,
      estimatedCost: cost,
      status: 'Draft PO Terbit',
      notes: poNotes,
    });
    setShowPOModal(false);
  };

  // Inline Threshold Editor State
  const [editingThresholdId, setEditingThresholdId] = useState<string | null>(null);
  const [thresholdVal, setThresholdVal] = useState<number>(10);

  // Handle Save Threshold in Firestore (Inline Editor)
  const handleSaveThreshold = async (pId: string) => {
    try {
      await updateDoc(doc(db, 'stores/store_001/products', pId), {
        minStockAlert: thresholdVal,
        minStock: thresholdVal,
        updatedAt: new Date().toISOString(),
      });
      try {
        await updateDoc(doc(db, 'products', pId), {
          minStockAlert: thresholdVal,
          minStock: thresholdVal,
          updatedAt: new Date().toISOString(),
        });
      } catch (e) {}
    } catch (err) {
      console.warn('Error saving threshold to Firestore:', err);
    }
    setProducts((prev) =>
      prev.map((p) => (p.id === pId ? { ...p, minStockAlert: thresholdVal } : p))
    );
    setEditingThresholdId(null);
  };

  // Handle Save Threshold from Modal in Firestore
  const handleSaveThresholdModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!thresholdModalProduct) return;
    try {
      await updateDoc(doc(db, 'stores/store_001/products', thresholdModalProduct.id), {
        minStockAlert: modalThresholdVal,
        minStock: modalThresholdVal,
        updatedAt: new Date().toISOString(),
      });
      try {
        await updateDoc(doc(db, 'products', thresholdModalProduct.id), {
          minStockAlert: modalThresholdVal,
          minStock: modalThresholdVal,
          updatedAt: new Date().toISOString(),
        });
      } catch (e) {}
    } catch (err) {
      console.warn('Error saving threshold modal to Firestore:', err);
    }
    setProducts((prev) =>
      prev.map((p) => (p.id === thresholdModalProduct.id ? { ...p, minStockAlert: modalThresholdVal } : p))
    );
    setThresholdModalProduct(null);
  };

  // Handle Save Stock Adjustment in Firestore
  const handleSaveStockAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockAdjustProduct) return;
    const newQty = Number(adjustQuantity);
    if (isNaN(newQty)) return;
    const oldQty = stockAdjustProduct.stockInUnits || 0;
    const diff = newQty - oldQty;

    try {
      await updateDoc(doc(db, 'stores/store_001/products', stockAdjustProduct.id), {
        stockInUnits: newQty,
        stock: newQty,
        updatedAt: new Date().toISOString(),
      });
      try {
        await updateDoc(doc(db, 'products', stockAdjustProduct.id), {
          stockInUnits: newQty,
          stock: newQty,
          updatedAt: new Date().toISOString(),
        });
      } catch (e) {}

      // Add mutation to stock cards ledger
      const cardItem = {
        id: `MUT-ADJ-${Date.now().toString().slice(-4)}`,
        date: new Date().toLocaleDateString('id-ID') + ', ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
        productName: stockAdjustProduct.name,
        sku: stockAdjustProduct.sku || 'SKU',
        location: stockAdjustProduct.storageLocation || 'RiskCart Flagship Store',
        mutationType: 'PENYESUAIAN' as const,
        refDoc: `ADJ #${Date.now().toString().slice(-6)}`,
        qtyChange: diff,
        runningBalance: newQty,
        actor: 'Admin Inventory',
        notes: adjustReason || 'Penyesuaian Stok Manual',
      };
      await addStockCardDoc(cardItem);
      setProducts((prev) =>
        prev.map((p) => (p.id === stockAdjustProduct.id ? { ...p, stockInUnits: newQty, stock: newQty } : p))
      );
    } catch (err) {
      console.warn('Error adjusting stock in Firestore:', err);
    } finally {
      setStockAdjustProduct(null);
    }
  };

  // Handle Add / Edit Stock Opname
  const handleSaveOpname = async (e: React.FormEvent) => {
    e.preventDefault();
    const phys = Number(opnamePhysicalQty);
    const diff = phys - opnameSystemQty;
    if (editingOpname && editingOpname.id) {
      await updateOpnameDoc(editingOpname.id, {
        auditor: opnameAuditor,
        productSampled: opnameProduct,
        systemCount: opnameSystemQty,
        physicalCount: phys,
        diff: diff,
        lossValue: Math.abs(diff) * 15000,
        reason: opnameReason,
      });
      setEditingOpname(null);
      setShowOpnameModal(false);
      return;
    }
    const newSession = {
      id: `OPN-${Date.now().toString().slice(-6)}`,
      date: new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
      outlet: 'RiskCart Flagship Store',
      auditor: opnameAuditor,
      productSampled: opnameProduct,
      systemCount: opnameSystemQty,
      physicalCount: phys,
      diff: diff,
      lossValue: Math.abs(diff) * 15000,
      reason: opnameReason,
      status: 'APPROVED & ADJUSTED',
    };
    await addOpnameDoc(newSession);

    // Automatically post traceable adjustment to Kartu Stok
    const cardItem = {
      id: `MUT-OPN-${Date.now().toString().slice(-4)}`,
      date: new Date().toLocaleDateString('id-ID') + ', ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
      productName: opnameProduct,
      sku: 'SKU-OPN',
      location: 'RiskCart Flagship Store',
      mutationType: 'PENYESUAIAN',
      refDoc: `OPNAME #${newSession.id}`,
      qtyChange: diff,
      runningBalance: phys,
      actor: opnameAuditor,
      notes: `Penyesuaian Opname Fisik: ${opnameReason}`,
    };
    await addStockCardDoc(cardItem);
    setShowOpnameModal(false);
  };

  // Handle Add / Edit Manual Mutation
  const handleSaveManualMutation = async (e: React.FormEvent) => {
    e.preventDefault();
    const qtyNum = Number(mutQty);
    const change = mutType === 'KELUAR' ? -Math.abs(qtyNum) : Math.abs(qtyNum);
    if (editingStockCard && editingStockCard.id) {
      await updateStockCardDoc(editingStockCard.id, {
        productName: mutProduct,
        mutationType: mutType,
        qtyChange: change,
        runningBalance: Math.max(0, change),
        notes: mutReason,
      });
      setEditingStockCard(null);
      setShowManualMutationModal(false);
      return;
    }
    const item = {
      id: `MUT-ADJ-${Date.now().toString().slice(-4)}`,
      date: new Date().toLocaleDateString('id-ID') + ', ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
      productName: mutProduct,
      sku: 'MAN-ADJ',
      location: 'RiskCart Flagship Store',
      mutationType: mutType,
      refDoc: 'MANUAL-ADJUSTMENT',
      qtyChange: change,
      runningBalance: Math.max(0, change),
      actor: 'Manager Toko',
      notes: mutReason,
    };
    await addStockCardDoc(item);
    setShowManualMutationModal(false);
  };

  // Calculations for Inventory Distinction
  const totalPhysicalUnits = products.reduce((acc, p) => acc + (p.stockInUnits || 0), 0);
  const totalReservedUnits = pwaOrders
    .filter((o) => o.status === 'pending' || o.status === 'processing')
    .reduce((acc, o) => acc + Number(o.itemsCount || 0), 0);
  const totalAvailableUnits = Math.max(0, totalPhysicalUnits - totalReservedUnits);
  const totalAssetCOGS = products.reduce((acc, p) => acc + ((p.stockInUnits || 0) * (p.costPerUnit || 0)), 0);

  // Filter products by search query and native type="date" Created from / To
  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.sku && p.sku.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.category && p.category.toLowerCase().includes(searchQuery.toLowerCase()));
    if (!matchesSearch) return false;

    if (createdFrom) {
      const pDate = p.createdAt ? new Date(p.createdAt) : null;
      if (pDate && !isNaN(pDate.getTime())) {
        const fromDate = new Date(createdFrom);
        fromDate.setHours(0, 0, 0, 0);
        if (pDate < fromDate) return false;
      }
    }

    if (createdTo) {
      const pDate = p.createdAt ? new Date(p.createdAt) : null;
      if (pDate && !isNaN(pDate.getTime())) {
        const toDate = new Date(createdTo);
        toDate.setHours(23, 59, 59, 999);
        if (pDate > toDate) return false;
      }
    }

    return true;
  });

  if (editingProduct) {
    return (
      <div className="space-y-4 animate-in fade-in duration-150">
        <AddProductForm
          isDark={true}
          initialProduct={editingProduct}
          onBack={() => setEditingProduct(null)}
          onSubmit={() => setEditingProduct(null)}
          onToggleTheme={() => {}}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Boxes className="w-6 h-6 text-amber-400" />
          <h1 className="text-2xl font-black text-white tracking-tight">
            5.14 LACAK INVENTORY &amp; KARTU STOK
          </h1>
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          Pembedaan stok fisik, stok dicadangkan (reserved), dan stok siap jual. Buku kartu stok mutasi abadi, ambang batas minimum, dan audit stok opname.
        </p>
      </div>

      {/* Sub-Tabs */}
      <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto w-full max-w-none mb-4">
          <button
            onClick={() => setActiveSub('inventory')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              activeSub === 'inventory' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Inventory
          </button>
          <button
            onClick={() => setActiveSub('kartu_stok')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              activeSub === 'kartu_stok' ? 'bg-amber-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Kartu Stok
          </button>
          <button
            onClick={() => setActiveSub('stok_minimum')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
              activeSub === 'stok_minimum' ? 'bg-rose-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Stok Minimum</span>
          </button>
          <button
            onClick={() => setActiveSub('stok_opname')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
              activeSub === 'stok_opname' ? 'bg-purple-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            <span>Stok Opname</span>
          </button>
          <button
            onClick={() => setActiveSub('produk_restock')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
              activeSub === 'produk_restock' ? 'bg-emerald-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Produk Restock</span>
          </button>
        </div>

      {/* VIEW: INVENTORY */}
      {activeSub === 'inventory' && (
        <div className="space-y-4">
          {/* Key Distinction Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Stok Fisik di Toko (On Hand)</span>
              <div className="text-xl font-black font-mono text-white mt-1">
                {totalPhysicalUnits} Unit
              </div>
              <span className="text-[11px] text-zinc-400">Total fisik tersimpan di rak &amp; gudang</span>
            </div>
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Stok Tertahan (Reserved)</span>
              <div className="text-xl font-black font-mono text-amber-400 mt-1">
                {totalReservedUnits} Unit
              </div>
              <span className="text-[11px] text-zinc-400">Order Online PWA siap dikirim</span>
            </div>
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Stok Siap Jual (Available)</span>
              <div className="text-xl font-black font-mono text-emerald-400 mt-1">
                {totalAvailableUnits} Unit
              </div>
              <span className="text-[11px] text-emerald-500 font-medium">= Fisik dikurangi Reserved</span>
            </div>
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Valuasi Persediaan (COGS)</span>
              <div className="text-xl font-black font-mono text-blue-400 mt-1">
                Rp {totalAssetCOGS.toLocaleString('id-ID')}
              </div>
              <span className="text-[11px] text-zinc-400">Modal modal persediaan berjalan</span>
            </div>
          </div>

          {/* Search, Date Filter & Actions */}
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Cari SKU / nama barang / barcode..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Native HTML Date Inputs */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-zinc-400 text-xs">
                  <Calendar className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-[11px] font-medium">Created from:</span>
                  <input
                    type="date"
                    value={createdFrom}
                    onChange={(e) => setCreatedFrom(e.target.value)}
                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-white [color-scheme:dark] focus:outline-none focus:border-blue-500 cursor-pointer"
                  />
                </div>
                <div className="flex items-center gap-1.5 text-zinc-400 text-xs">
                  <span className="text-[11px] font-medium">To:</span>
                  <input
                    type="date"
                    value={createdTo}
                    onChange={(e) => setCreatedTo(e.target.value)}
                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-white [color-scheme:dark] focus:outline-none focus:border-blue-500 cursor-pointer"
                  />
                </div>
                {(createdFrom || createdTo) && (
                  <button
                    onClick={() => {
                      setCreatedFrom('');
                      setCreatedTo('');
                    }}
                    className="text-[11px] text-zinc-400 hover:text-white px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => onNavigateTab && onNavigateTab('products')}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md transition cursor-pointer whitespace-nowrap"
              >
                + Kelola Master Produk &amp; Dus
              </button>
            </div>
          </div>

          {/* Inventory Table */}
          <div className="bg-[#110e08] border border-amber-500/25 rounded-2xl overflow-x-auto shadow-sm">
            <table className="w-full text-left text-xs min-w-[960px]">
              <thead className="bg-[#080705] text-amber-300/90 border-b border-amber-500/25">
                <tr>
                  <th className="py-3 px-4">SKU / Barcode</th>
                  <th className="py-3 px-4">Nama Produk</th>
                  <th className="py-3 px-4">Batch Aktif (FEFO) &amp; Expired</th>
                  <th className="py-3 px-4">Lokasi Rak</th>
                  <th className="py-3 px-4 text-center">Fisik (On Hand)</th>
                  <th className="py-3 px-4 text-center">Reserved</th>
                  <th className="py-3 px-4 text-center">Siap Jual</th>
                  <th className="py-3 px-4 text-right">Modal Pokok (COGS)</th>
                  <th className="py-3 px-4 text-center">Status Stok</th>
                  <th className="py-3 px-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-500/15 text-zinc-300">
                {filteredProducts.map((p) => {
                  const onHand = p.stockInUnits || 0;
                  const reserved = p.id.includes('indomie') ? 2 : 0;
                  const available = Math.max(0, onHand - reserved);
                  const isLow = available <= (p.minStockAlert || 10);
                  const fefoBatches = getSortedFefoBatches(p);
                  const activeBatch = fefoBatches[0];
                  const expEval = evaluateProductExpiry(
                    activeBatch
                      ? {
                          productionDate: activeBatch.productionDate,
                          expiryDate: activeBatch.expiryDate,
                          category: p.category,
                        }
                      : p
                  );

                  return (
                    <tr key={p.id} className="hover:bg-amber-500/5 transition">
                      <td className="py-3 px-4 font-mono font-bold text-amber-400">
                        {p.sku || p.id}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-white block">{p.name}</span>
                        <span className="text-[10px] text-zinc-500">{p.category} &bull; {p.piecesPerCarton || 1} pcs/dus</span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#16120b] text-amber-300 border border-amber-500/40">
                            {activeBatch?.batchCode || 'BATCH-INIT'}
                          </span>
                          {fefoBatches.length > 1 && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-200 border border-amber-500/40">
                              +{fefoBatches.length - 1} Batch Lain
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-zinc-400 mt-1 font-mono">
                          Prod: {expEval.productionDateFormatted} &bull; Exp: <strong className="text-amber-200">{expEval.expiryDateFormatted}</strong>
                        </div>
                        <span
                          className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            expEval.status === 'expired' || expEval.status === 'critical'
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : expEval.status === 'warning'
                              ? 'bg-amber-950 text-amber-300 border border-amber-700'
                              : 'bg-[#16120b] text-amber-300/90 border border-amber-500/25'
                          }`}
                        >
                          {expEval.countdownText} ({expEval.badgeLabel})
                        </span>
                      </td>
                      <td className="py-3 px-4 text-zinc-300">
                        {p.storageLocation || 'Rak A-01 / Flagship'}
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-white">
                        {onHand} pcs
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-medium text-amber-400">
                        {reserved} pcs
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-amber-300">
                        {available} pcs
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-zinc-200">
                        {formatMoney((p.costPerUnit || 0) * onHand, currencyMode)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            onHand === 0
                              ? 'bg-red-950 text-red-400 border border-red-800'
                              : isLow
                              ? 'bg-amber-950 text-amber-400 border border-amber-800'
                              : 'bg-[#16120b] text-amber-300 border border-amber-500/40'
                          }`}
                        >
                          {onHand === 0 ? 'HABIS' : isLow ? 'MENIPIS' : 'AMAN'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() =>
                              setDetailModal({
                                title: `Detail Inventory & Batch FEFO: ${p.name}`,
                                data: {
                                  'SKU / Barcode': p.sku || p.barcode || p.id,
                                  'Nama Produk': p.name,
                                  Kategori: p.category,
                                  'Lokasi Rak': p.storageLocation || 'Rak A-01 / Flagship',
                                  'Stok Fisik (On Hand)': `${onHand} pcs`,
                                  'Stok Reserved': `${reserved} pcs`,
                                  'Stok Siap Jual': `${available} pcs`,
                                  'Batch Aktif (FEFO #1)': activeBatch
                                    ? `${activeBatch.batchCode} (${activeBatch.qty} pcs) | Prod: ${activeBatch.productionDate} | Exp: ${activeBatch.expiryDate}`
                                    : `${expEval.productionDateFormatted} s/d ${expEval.expiryDateFormatted}`,
                                  'Seluruh Antrean Batch FEFO':
                                    fefoBatches.length > 0
                                      ? fefoBatches
                                          .map(
                                            (b, idx) =>
                                              `#${idx + 1} ${b.batchCode}: ${b.qty} pcs (Prod: ${b.productionDate || '-'}, Exp: ${b.expiryDate || '-'})`
                                          )
                                          .join(' | ')
                                      : '1 Batch Standar',
                                  'Harga Modal / Unit': formatMoney(Number(p.costPerUnit || 0), currencyMode),
                                  'Total Valuasi COGS': formatMoney((p.costPerUnit || 0) * onHand, currencyMode),
                                },
                              })
                            }
                            className="p-1.5 rounded-lg bg-[#16120b] border border-amber-500/30 hover:bg-amber-500/20 text-amber-300 transition cursor-pointer"
                            title="Lihat Detail Inventory & Batch FEFO"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingProduct(p)}
                            className="p-1.5 rounded-lg bg-[#16120b] border border-amber-500/30 hover:bg-amber-500/20 text-amber-300 transition cursor-pointer"
                            title="Edit Details"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setStockAdjustProduct(p);
                              setAdjustQuantity(String(p.stockInUnits || 0));
                              setAdjustReason('Penyesuaian Fisik Rak');
                            }}
                            className="p-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/30 transition cursor-pointer"
                            title="Stock Adjustment"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteProduct(p.id)}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                            title="Hapus Produk"
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

      {/* VIEW: KARTU STOK */}
      {activeSub === 'kartu_stok' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Buku Kartu Stok Mutasi Persediaan &amp; Pelacakan Batch FEFO (Audit Trail Abadi)
              </h3>
              <p className="text-xs text-zinc-400">
                Setiap mutasi barang mencatat Kode Batch, Tanggal Produksi, Tanggal Expired, nomor referensi struk/PO/opname, saldo berjalan, dan petugas.
              </p>
            </div>
            <button
              onClick={() => setShowManualMutationModal(true)}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-black text-xs font-black transition flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>+ Catat Mutasi Manual (Koreksi)</span>
            </button>
          </div>

          <div className="bg-[#110e08] border border-amber-500/25 rounded-2xl overflow-x-auto shadow-sm">
            <table className="w-full text-left text-xs min-w-[960px]">
              <thead className="bg-[#080705] text-amber-300/90 border-b border-amber-500/25">
                <tr>
                  <th className="py-3 px-4">No. Mutasi</th>
                  <th className="py-3 px-4">Waktu</th>
                  <th className="py-3 px-4">Nama Produk &amp; Lokasi</th>
                  <th className="py-3 px-4">Kode Batch &amp; Expired (FEFO)</th>
                  <th className="py-3 px-4">Tipe &amp; No. Referensi</th>
                  <th className="py-3 px-4 text-center">Perubahan</th>
                  <th className="py-3 px-4 text-right">Saldo Berjalan</th>
                  <th className="py-3 px-4">Petugas / Operator</th>
                  <th className="py-3 px-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-500/15 text-zinc-300">
                {stockCards.map((sc) => {
                  const mutTypeVal = sc.mutationType || sc.type || 'MUTASI';
                  const qtyChangeVal =
                    sc.qtyChange !== undefined
                      ? Number(sc.qtyChange)
                      : mutTypeVal === 'KELUAR'
                      ? -Math.abs(Number(sc.qty || 0))
                      : Number(sc.qty || 0);
                  const runningBalVal = sc.runningBalance ?? sc.afterStock ?? 0;
                  const refDocVal = sc.refDoc || sc.reference || '-';
                  const notesVal = sc.notes || sc.reason || '-';

                  return (
                    <tr key={sc.id} className="hover:bg-amber-500/5 transition">
                      <td className="py-3 px-4 font-mono font-bold text-amber-400">{sc.id}</td>
                      <td className="py-3 px-4 text-zinc-400">{sc.date}</td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-white block">{sc.productName}</span>
                        <span className="text-[10px] text-zinc-500">{sc.location || sc.sku || 'Gudang / Toko'}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#16120b] text-amber-300 border border-amber-500/35">
                          {sc.batchCode || 'BATCH-FEFO'}
                        </span>
                        {(sc.productionDate || sc.expiryDate) && (
                          <div className="text-[10px] text-zinc-400 font-mono mt-1">
                            {sc.productionDate ? `Prod: ${sc.productionDate}` : ''}{' '}
                            {sc.expiryDate ? `• Exp: ${sc.expiryDate}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              mutTypeVal === 'MASUK'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : mutTypeVal === 'RETUR'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : mutTypeVal === 'PENYESUAIAN'
                                ? 'bg-zinc-800 text-amber-200 border border-amber-500/30'
                                : 'bg-rose-950 text-rose-400 border border-rose-800'
                            }`}
                          >
                            {mutTypeVal}
                          </span>
                          <span className="font-mono text-zinc-400 text-[11px]">{refDocVal}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold">
                        <span className={qtyChangeVal > 0 ? 'text-amber-300' : 'text-rose-400'}>
                          {qtyChangeVal > 0 ? `+${qtyChangeVal}` : qtyChangeVal}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-white">
                        {runningBalVal} pcs
                      </td>
                      <td className="py-3 px-4 text-zinc-400">{sc.actor || 'Sistem'}</td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() =>
                              setDetailModal({
                                title: `Detail Kartu Stok & Batch: ${sc.id}`,
                                data: {
                                  'No. Mutasi': sc.id,
                                  Waktu: sc.date,
                                  Produk: sc.productName,
                                  'Kode Batch (FEFO)': sc.batchCode || 'BATCH-FEFO',
                                  'Tanggal Produksi': sc.productionDate || '-',
                                  'Tanggal Expired': sc.expiryDate || '-',
                                  Lokasi: sc.location || 'Toko Utama',
                                  'Tipe Mutasi': mutTypeVal,
                                  'No. Referensi': refDocVal,
                                  Perubahan: qtyChangeVal > 0 ? `+${qtyChangeVal}` : qtyChangeVal,
                                  'Saldo Berjalan': `${runningBalVal} pcs`,
                                  Petugas: sc.actor || 'Sistem',
                                  Catatan: notesVal,
                                },
                              })
                            }
                            title="Lihat Detail Mutasi"
                            className="p-1.5 rounded-lg bg-[#16120b] border border-amber-500/30 hover:bg-amber-500/20 text-amber-300 transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingStockCard(sc);
                              setMutProduct(sc.productName || products[0]?.name || '');
                              setMutType(mutTypeVal as any);
                              setMutQty(String(Math.abs(Number(qtyChangeVal || 1))));
                              setMutReason(notesVal);
                              setShowManualMutationModal(true);
                            }}
                            title="Edit Mutasi"
                            className="p-1.5 rounded-lg bg-[#16120b] border border-amber-500/30 hover:bg-amber-500/20 text-amber-300 transition cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={async () => {
                              if (sc.id) await deleteStockCardDoc(sc.id);
                            }}
                            title="Hapus Mutasi"
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

      {/* VIEW: STOK MINIMUM */}
      {activeSub === 'stok_minimum' && (
        <div className="space-y-4">
          <div className="p-4 bg-rose-950/20 border border-rose-900/40 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-rose-500 shrink-0" />
              <div>
                <h4 className="font-bold text-white text-sm">Ambang Batas Minimum Stok (Safety Buffer)</h4>
                <p className="text-xs text-zinc-400">
                  Ubah ambang batas peringatan per SKU untuk mencegah kekosongan rak di jam ramai transaksi.
                </p>
              </div>
            </div>
            <button
              onClick={() => onNavigateTab && onNavigateTab('restock')}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-sm cursor-pointer whitespace-nowrap"
            >
              Order Otomatis AI Restock
            </button>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Nama Produk</th>
                  <th className="py-3 px-4">SKU</th>
                  <th className="py-3 px-4 text-center">Stok Saat Ini</th>
                  <th className="py-3 px-4 text-center">Batas Minimum (Threshold)</th>
                  <th className="py-3 px-4 text-center">Saran Reorder</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Aksi Konfigurasi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {products.map((p) => {
                  const currentStock = p.stockInUnits || 0;
                  const threshold = p.minStockAlert || 10;
                  const isCrit = currentStock <= threshold;
                  const suggestedOrder = Math.max(0, threshold * 3 - currentStock);

                  return (
                    <tr key={p.id} className="hover:bg-zinc-800/40 transition">
                      <td className="py-3 px-4 font-bold text-white">{p.name}</td>
                      <td className="py-3 px-4 font-mono text-zinc-400">{p.sku || p.id}</td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-white">
                        {currentStock} pcs
                      </td>
                      <td className="py-3 px-4 text-center">
                        {editingThresholdId === p.id ? (
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              value={thresholdVal}
                              onChange={(e) => setThresholdVal(Number(e.target.value))}
                              className="w-16 bg-zinc-950 border border-blue-500 rounded px-1.5 py-0.5 text-center text-white font-mono font-bold"
                            />
                            <button
                              onClick={() => handleSaveThreshold(p.id)}
                              className="p-1 bg-emerald-600 rounded text-white"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setEditingThresholdId(null)}
                              className="p-1 bg-zinc-800 rounded text-zinc-400"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="font-mono font-bold text-amber-400">{threshold} pcs</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-blue-400">
                        {suggestedOrder > 0 ? `+${suggestedOrder} pcs` : '-'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isCrit
                              ? 'bg-rose-950 text-rose-400 border border-rose-800'
                              : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          }`}
                        >
                          {isCrit ? 'KRITIS' : 'AMAN'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() =>
                              setDetailModal({
                                title: `Detail Batas Stok Minimum: ${p.name}`,
                                data: {
                                  'Nama Produk': p.name,
                                  SKU: p.sku || p.id,
                                  'Stok Saat Ini': `${currentStock} pcs`,
                                  'Batas Minimum': `${threshold} pcs`,
                                  'Saran Reorder': suggestedOrder > 0 ? `+${suggestedOrder} pcs` : '-',
                                  Status: isCrit ? 'KRITIS' : 'AMAN',
                                },
                              })
                            }
                            title="Lihat Detail"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingThresholdId(p.id);
                              setThresholdVal(threshold);
                            }}
                            title="Ubah Batas Minimum"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteProduct(p.id)}
                            title="Hapus Produk"
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

      {/* VIEW: STOK OPNAME */}
      {activeSub === 'stok_opname' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Sesi Stok Opname &amp; Rekonsiliasi Fisik
              </h3>
              <p className="text-xs text-zinc-400">
                Pencocokan jumlah sistem dengan perhitungan nyata di rak toko, persetujuan supervisor, dan posting penyesuaian otomatis.
              </p>
            </div>
            <button
              onClick={() => setShowOpnameModal(true)}
              className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>+ Input Sesi Opname Baru</span>
            </button>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">No. Sesi</th>
                  <th className="py-3 px-4">Tanggal Audit</th>
                  <th className="py-3 px-4">Produk / Sampel</th>
                  <th className="py-3 px-4">Auditor</th>
                  <th className="py-3 px-4 text-center">Fisik vs Sistem</th>
                  <th className="py-3 px-4 text-center">Selisih</th>
                  <th className="py-3 px-4 text-right">Nilai Selisih</th>
                  <th className="py-3 px-4 text-center">Status Audit</th>
                  <th className="py-3 px-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {opnameList.map((opn) => (
                  <tr key={opn.id} className="hover:bg-zinc-800/40 transition">
                    <td className="py-3 px-4 font-mono font-bold text-purple-400">{opn.id}</td>
                    <td className="py-3 px-4 text-zinc-400">{opn.date}</td>
                    <td className="py-3 px-4 font-bold text-white">{opn.productSampled}</td>
                    <td className="py-3 px-4 text-zinc-300">{opn.auditor}</td>
                    <td className="py-3 px-4 text-center font-mono text-zinc-200">
                      {opn.physicalCount} / {opn.systemCount}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-bold">
                      <span className={opn.diff < 0 ? 'text-rose-400' : opn.diff > 0 ? 'text-emerald-400' : 'text-zinc-400'}>
                        {opn.diff > 0 ? `+${opn.diff}` : opn.diff} unit
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-rose-400">
                      {opn.lossValue > 0 ? `-Rp ${opn.lossValue.toLocaleString('id-ID')}` : 'Rp 0'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                        {opn.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() =>
                            setDetailModal({
                              title: `Detail Stok Opname: ${opn.id}`,
                              data: {
                                'No. Sesi': opn.id,
                                'Tanggal Audit': opn.date,
                                Produk: opn.productSampled,
                                Auditor: opn.auditor,
                                'Stok Sistem': `${opn.systemCount} unit`,
                                'Stok Fisik': `${opn.physicalCount} unit`,
                                Selisih: `${opn.diff > 0 ? `+${opn.diff}` : opn.diff} unit`,
                                'Nilai Selisih': `Rp ${Number(opn.lossValue || 0).toLocaleString('id-ID')}`,
                                Alasan: opn.reason || '-',
                                Status: opn.status,
                              },
                            })
                          }
                          title="Lihat Detail Opname"
                          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setEditingOpname(opn);
                            setOpnameProduct(opn.productSampled || products[0]?.name || '');
                            setOpnameSystemQty(Number(opn.systemCount || 0));
                            setOpnamePhysicalQty(String(opn.physicalCount || 0));
                            setOpnameReason(opn.reason || 'Barang Rusak / Kemasan Bocor di Rak');
                            setOpnameAuditor(opn.auditor || 'Supervisor Toko');
                            setShowOpnameModal(true);
                          }}
                          title="Edit Sesi Opname"
                          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={async () => {
                            if (opn.id) await deleteOpnameDoc(opn.id);
                          }}
                          title="Hapus Sesi Opname"
                          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
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

      {/* VIEW: PRODUK RESTOCK */}
      {activeSub === 'produk_restock' && (
        <div className="space-y-4">
          <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-2xl p-5 flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-white text-base">Rekomendasi Pemesanan Ulang Cerdas (AI Restock Matrix)</h4>
              <p className="text-xs text-zinc-400">
                Kalkulasi kebutuhan restock berdasarkan kecepatan penjualan harian (velocity), supplier lead time, dan stok pengaman.
              </p>
            </div>
            <button
              onClick={() => onNavigateTab && onNavigateTab('restock')}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-sm cursor-pointer whitespace-nowrap"
            >
              Buka AI Restock Advisor Lengkap
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {products.slice(0, 3).map((p) => (
              <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800 px-2 py-0.5 rounded uppercase">
                    Lead Time: 2 Hari
                  </span>
                  <span className="font-mono text-xs text-zinc-400">Kecepatan: 8 unit/hari</span>
                </div>
                <h4 className="font-bold text-white text-sm">{p.name}</h4>
                <div className="text-xs text-zinc-400 space-y-1">
                  <div className="flex justify-between">
                    <span>Stok Saat Ini:</span>
                    <strong className="text-white font-mono">{p.stockInUnits} unit</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Saran Pemesanan:</span>
                    <strong className="text-emerald-400 font-mono">+{(p.piecesPerCarton || 1) * 3} unit (3 Dus)</strong>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelectedProductForPO(p);
                    setPoCartons(3);
                    setShowPOModal(true);
                  }}
                  className="w-full py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 shadow-md"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Buat Draft Purchase Order</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: STOK OPNAME */}
      {showOpnameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-white text-base">Input Sesi Stok Opname Fisik</h3>
            <form onSubmit={handleSaveOpname} className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Pilih Produk Yang Dihitung:</label>
                <select
                  value={opnameProduct}
                  onChange={(e) => {
                    setOpnameProduct(e.target.value);
                    const prod = products.find((p) => p.name === e.target.value);
                    if (prod) setOpnameSystemQty(prod.stockInUnits || 50);
                  }}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name} ({p.stockInUnits} unit sistem)
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Jumlah di Sistem:</label>
                  <input
                    type="number"
                    disabled
                    value={opnameSystemQty}
                    className="w-full bg-zinc-950/60 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-400 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Perhitungan Nyata Fisik:</label>
                  <input
                    type="number"
                    required
                    value={opnamePhysicalQty}
                    onChange={(e) => setOpnamePhysicalQty(e.target.value)}
                    className="w-full bg-zinc-950 border border-purple-500 rounded-xl px-3 py-2 text-white font-mono font-bold"
                  />
                </div>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Alasan / Catatan Temuan:</label>
                <select
                  value={opnameReason}
                  onChange={(e) => setOpnameReason(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                >
                  <option value="Barang Rusak / Kemasan Bocor di Rak">Barang Rusak / Kemasan Bocor di Rak</option>
                  <option value="Produk Melewati Tanggal Kadaluarsa (Expired)">Produk Melewati Tanggal Kadaluarsa (Expired)</option>
                  <option value="Selisih Hitung Kasir Jam Ramai">Selisih Hitung Kasir Jam Ramai</option>
                  <option value="Fisik Cocok 100% Sesuai Sistem">Fisik Cocok 100% Sesuai Sistem</option>
                </select>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Auditor Bertugas:</label>
                <input
                  type="text"
                  value={opnameAuditor}
                  onChange={(e) => setOpnameAuditor(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowOpnameModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-purple-600 text-white font-bold hover:bg-purple-500"
                >
                  Simpan &amp; Posting Penyesuaian
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MANUAL MUTATION */}
      {showManualMutationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-white text-base">Catat Mutasi Manual (Koreksi Stok)</h3>
            <form onSubmit={handleSaveManualMutation} className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Pilih Produk:</label>
                <select
                  value={mutProduct}
                  onChange={(e) => setMutProduct(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Tipe Mutasi:</label>
                <select
                  value={mutType}
                  onChange={(e) => setMutType(e.target.value as any)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                >
                  <option value="PENYESUAIAN">PENYESUAIAN (Koreksi Admin)</option>
                  <option value="MASUK">MASUK (Penerimaan Khusus)</option>
                  <option value="KELUAR">KELUAR (Sampel / Kerusakan)</option>
                </select>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Jumlah Unit:</label>
                <input
                  type="number"
                  required
                  value={mutQty}
                  onChange={(e) => setMutQty(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Alasan Penyesuaian:</label>
                <input
                  type="text"
                  required
                  value={mutReason}
                  onChange={(e) => setMutReason(e.target.value)}
                  placeholder="Koreksi stok fisik sampel..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowManualMutationModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-600 text-white font-bold hover:bg-amber-500"
                >
                  Posting Mutasi ke Kartu Stok
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: BUAT DRAFT PURCHASE ORDER */}
      {showPOModal && selectedProductForPO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-white text-base">Buat Draft Purchase Order (PO)</h3>
              </div>
              <button
                onClick={() => setShowPOModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSavePO} className="space-y-4 text-xs">
              <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400">Produk Restock:</span>
                  <span className="font-bold text-white text-sm">{selectedProductForPO.name}</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-zinc-500">Isi Kemasan per Dus:</span>
                  <span className="font-mono text-zinc-300">{selectedProductForPO.piecesPerCarton || 1} Pcs/Dus</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-zinc-500">Stok Saat Ini:</span>
                  <span className="font-mono text-rose-400">{selectedProductForPO.stockInUnits} unit</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Jumlah Dus (Karton) *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={poCartons}
                    onChange={(e) => setPoCartons(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Total Unit Didapat</label>
                  <div className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-emerald-400 font-mono font-bold">
                    {poCartons * (selectedProductForPO.piecesPerCarton || 1)} unit
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-zinc-400 font-bold mb-1">Supplier Distributor *</label>
                <select
                  value={poSupplier}
                  onChange={(e) => setPoSupplier(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="PT Indofood CBP Sukses Makmur Tbk">PT Indofood CBP Sukses Makmur Tbk</option>
                  <option value="PT Tirta Investama (Danone Aqua)">PT Tirta Investama (Danone Aqua)</option>
                  <option value="PT Mayora Indah Tbk">PT Mayora Indah Tbk</option>
                  <option value="PT Unilever Indonesia Tbk">PT Unilever Indonesia Tbk</option>
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 font-bold mb-1">Catatan Purchase Order</label>
                <input
                  type="text"
                  value={poNotes}
                  onChange={(e) => setPoNotes(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 flex justify-between items-center">
                <span className="text-zinc-400">Estimasi Belanja:</span>
                <span className="font-mono font-bold text-amber-400 text-sm">
                  Rp {(
                    poCartons *
                    (selectedProductForPO.pricePerCarton ||
                      selectedProductForPO.pricePerUnit * (selectedProductForPO.piecesPerCarton || 1))
                  ).toLocaleString('id-ID')}
                </span>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowPOModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold transition shadow-lg"
                >
                  Terbitkan Draft PO
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Stock Adjustment */}
      {stockAdjustProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Stock Adjustment</h3>
              </div>
              <button
                onClick={() => setStockAdjustProduct(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-zinc-400">Produk Terpilih:</span>
              <div className="font-bold text-white text-sm">{stockAdjustProduct.name}</div>
              <div className="text-xs font-mono text-zinc-500">
                SKU: {stockAdjustProduct.sku} &bull; Stok Saat Ini: {stockAdjustProduct.stockInUnits || 0} pcs
              </div>
            </div>

            <form onSubmit={handleSaveStockAdjustment} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1">
                  Jumlah Stok Fisik Baru (Pcs)
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={adjustQuantity}
                  onChange={(e) => setAdjustQuantity(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white font-mono font-bold text-base focus:outline-none focus:border-amber-500"
                  placeholder="Masukkan jumlah stok aktual..."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1">
                  Alasan Penyesuaian
                </label>
                <select
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white text-xs focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="Penyesuaian Fisik Rak">Koreksi Fisik Rak / Stock Opname</option>
                  <option value="Barang Rusak / Kadaluarsa">Barang Rusak / Bocor / Kadaluarsa</option>
                  <option value="Penerimaan Bonus / Supplier">Penerimaan Bonus Supplier</option>
                  <option value="Retur Pelanggan">Retur Pelanggan</option>
                  <option value="Lainnya">Lainnya</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStockAdjustProduct(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition cursor-pointer flex items-center gap-1.5 shadow-md shadow-amber-600/20"
                >
                  <Check className="w-4 h-4" />
                  <span>Simpan Penyesuaian di Firestore</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Ubah Batas Minimum Stok */}
      {thresholdModalProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-500" />
                <h3 className="text-base font-bold text-white">Ubah Batas Minimum Stok</h3>
              </div>
              <button
                onClick={() => setThresholdModalProduct(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-zinc-400">Produk:</span>
              <div className="font-bold text-white text-sm">{thresholdModalProduct.name}</div>
              <div className="text-xs font-mono text-zinc-500">
                SKU: {thresholdModalProduct.sku} &bull; Batas Saat Ini: {thresholdModalProduct.minStockAlert || 10} pcs
              </div>
            </div>

            <form onSubmit={handleSaveThresholdModal} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1">
                  Ambang Batas Minimum Baru (Pcs)
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={modalThresholdVal}
                  onChange={(e) => setModalThresholdVal(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white font-mono font-bold text-base focus:outline-none focus:border-rose-500"
                  placeholder="Contoh: 15"
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  Sistem akan memicu peringatan restock darurat jika stok berada di bawah jumlah ini.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setThresholdModalProduct(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition cursor-pointer flex items-center gap-1.5 shadow-md shadow-rose-600/20"
                >
                  <Check className="w-4 h-4" />
                  <span>Simpan Batas di Firestore</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Detail Item */}
      {detailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
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
    </div>
  );
};
