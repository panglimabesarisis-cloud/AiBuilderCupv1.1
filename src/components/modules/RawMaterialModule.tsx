import React, { useState, useMemo, useRef } from 'react';
import { checkAndRecordAiCooldown } from '../../utils/aiCooldown';
import {
  Boxes,
  Plus,
  Search,
  Edit3,
  Trash2,
  Truck,
  ClipboardList,
  ShoppingCart,
  FileText,
  AlertTriangle,
  CheckCircle2,
  ArrowDownCircle,
  ArrowUpCircle,
  RefreshCw,
  Brain,
  Sparkles,
  Package,
  Calendar,
  Layers,
  Upload,
  Image as ImageIcon,
  X,
  Save,
  ArrowLeft,
  Sun,
  Moon,
  Send,
  Phone,
  MapPin,
  DollarSign,
  TrendingDown,
  Activity,
  ExternalLink,
  Check,
  Filter,
} from 'lucide-react';
import {
  useRawMaterials,
  saveRawMaterialInDb,
  deleteRawMaterialFromDb,
  adjustRawMaterialStock,
  useRawMaterialSuppliers,
  saveRawMaterialSupplierInDb,
  deleteRawMaterialSupplierFromDb,
  useRawMaterialPOs,
  saveRawMaterialPOInDb,
  receiveRawMaterialPOInDb,
  useRawMaterialPRs,
  saveRawMaterialPRInDb,
  useRawMaterialMovements,
  deductRawMaterialsForProductBom,
  emitRawMaterialsUpdated,
  RawMaterialItem,
  RawMaterialSupplier,
  RawMaterialPurchaseOrder,
  RawMaterialPOItem,
  RawMaterialPurchaseRequest,
} from '../../services/rawMaterialService';
import { useAppData } from '../../context/AppDataContext';
import { useLanguage, USD_TO_IDR_RATE } from '../../context/LanguageContext';
import { AppLink, useAppNavigation } from '../../router';
import { compressImageFile } from '../../utils/imageCompress';
import { evaluateProductExpiry } from '../../utils/expiryUtils';
import {
  useCategories,
  useBrands,
  useStorageLocations,
  addCategory,
  addBrand,
  addStorageLocation,
} from '../../services/masterDataService';
import { saveProductDocToAllPaths } from '../../services/productService';
import { AiRunControlBar, useAiFeatureControl } from '../common/AiRunControlBar';

export type RawMaterialSubRoute =
  | 'list'
  | 'tambah'
  | 'edit'
  | 'kategori'
  | 'stok_masuk'
  | 'stok_keluar'
  | 'opname'
  | 'pergerakan'
  | 'kritis'
  | 'supplier'
  | 'pembelian'
  | 'po'
  | 'request'
  | 'ai';

interface RawMaterialModuleProps {
  subModule?: string;
  entityId?: string;
  actionMode?: 'list' | 'tambah' | 'edit' | 'detail';
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

const RM_MAIN_UNITS = ['Kg', 'Liter', 'Karung', 'Dus', 'Karton', 'Jerigen', 'Pack', 'Box', 'Pcs', 'Botol', 'Gram', 'Ml'];
const RM_SUB_UNITS = ['Gram', 'Ml', 'Kg', 'Liter', 'Pcs', 'Sachet', 'Cup', 'Botol', 'Unit'];

export const RawMaterialModule: React.FC<RawMaterialModuleProps> = ({
  subModule = 'list',
  entityId,
  actionMode = 'list',
  onNavigateTab,
}) => {
  const { tr, currencyMode } = useLanguage();
  const nav = useAppNavigation();
  const { products: allStoreProducts } = useAppData();

  const { rawMaterials, loading: loadingRm } = useRawMaterials();
  const { suppliers } = useRawMaterialSuppliers();
  const { purchaseOrders } = useRawMaterialPOs();
  const { purchaseRequests } = useRawMaterialPRs();
  const { movements } = useRawMaterialMovements();

  const masterCategories = useCategories();
  const masterBrands = useBrands();
  const masterStorages = useStorageLocations();

  const [isDark, setIsDark] = useState<boolean>(true);
  const [flashMsg, setFlashMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(
    null
  );
  const showFlash = (msg: string, type: 'success' | 'error' = 'success') => {
    setFlashMsg({ text: msg, type });
    setTimeout(() => setFlashMsg(null), 3500);
  };

  const [localViewOverride, setLocalViewOverride] = useState<RawMaterialSubRoute | null>(null);

  React.useEffect(() => {
    setLocalViewOverride(null);
  }, [subModule, actionMode, entityId]);

  const safeNavigate = (targetPath: string, fallbackView?: RawMaterialSubRoute) => {
    if (fallbackView) {
      setLocalViewOverride(fallbackView);
    }
    try {
      if (typeof nav?.navigateToPath === 'function') {
        nav.navigateToPath(targetPath);
        return;
      }
      if (typeof (nav as any)?.navigate === 'function') {
        (nav as any).navigate(targetPath);
        return;
      }
      if (typeof onNavigateTab === 'function') {
        onNavigateTab(targetPath);
      }
    } catch (err) {
      console.warn('[RawMaterialModule] Navigation fallback:', err);
    }
  };

  const formatMoney = (idrVal: number) => {
    const num = Number(idrVal) || 0;
    if (currencyMode === 'USD') {
      return `$ ${(num / USD_TO_IDR_RATE).toFixed(2)}`;
    }
    return `Rp ${Math.round(num).toLocaleString('id-ID')}`;
  };

  // Resolve current sub-view from URL subModule & actionMode (or immediate localViewOverride)
  const activeView: RawMaterialSubRoute = useMemo(() => {
    if (localViewOverride) return localViewOverride;
    const s = (subModule || 'list').toLowerCase().replace(/-/g, '_');
    if (actionMode === 'tambah' && (s === 'list' || s === 'tambah')) return 'tambah';
    if (actionMode === 'edit' && entityId) return 'edit';
    if (s === 'tambah' || s === 'add') return 'tambah';
    if (s === 'supplier' || s === 'daftar_supplier') return 'supplier';
    if (s === 'pembelian' || s === 'pembelian_bahan_baku') return 'pembelian';
    if (s === 'po' || s === 'daftar_pembelian') return 'po';
    if (s === 'request' || s === 'permintaan_pembelian' || s === 'request_pembelian') return 'request';
    if (s === 'kategori' || s === 'kategori_brand') return 'kategori';
    if (s === 'stok_masuk' || s === 'masuk') return 'stok_masuk';
    if (s === 'stok_keluar' || s === 'keluar') return 'stok_keluar';
    if (s === 'opname' || s === 'stok_opname') return 'opname';
    if (s === 'pergerakan' || s === 'kartu_stok') return 'pergerakan';
    if (s === 'kritis' || s === 'stok_minimum') return 'kritis';
    if (s === 'ai' || s === 'ai_bahan_baku') return 'ai';
    return 'list';
  }, [localViewOverride, subModule, actionMode, entityId]);

  // Map which products in `/dashboard/produk` use each raw material
  const productsUsingRmMap = useMemo(() => {
    const map = new Map<
      string,
      Array<{ productId: string; productName: string; qtyPerUnit: number; unit: string }>
    >();
    for (const p of allStoreProducts) {
      const raw = p as any;
      if (raw?.hasRawMaterials && Array.isArray(raw?.rawMaterialRecipe)) {
        for (const r of raw.rawMaterialRecipe) {
          if (!r?.rawMaterialId) continue;
          const list = map.get(r.rawMaterialId) || [];
          list.push({
            productId: p.id,
            productName: p.name,
            qtyPerUnit: Number(r.qtyPerUnit || 0),
            unit: r.unit || 'Kg',
          });
          map.set(r.rawMaterialId, list);
        }
      }
    }
    return map;
  }, [allStoreProducts]);

  // Summary KPIs
  const kpiStats = useMemo(() => {
    const totalItems = rawMaterials.length;
    const totalStockUnits = rawMaterials.reduce((s, r) => s + Number(r.stock || 0), 0);
    const totalAssetValue = rawMaterials.reduce(
      (s, r) => s + Number(r.stock || 0) * Number(r.costPrice || 0),
      0
    );
    const criticalCount = rawMaterials.filter((r) => Number(r.stock || 0) <= Number(r.minStock || 5)).length;
    const expiringCount = rawMaterials.filter((r) => {
      if (!r.expiryDate) return false;
      const ev = evaluateProductExpiry({
        category: r.category,
        productionDate: r.productionDate,
        expiryDate: r.expiryDate,
        stockInUnits: r.stock,
      });
      return ev.status === 'expired' || ev.status === 'critical' || ev.status === 'warning';
    }).length;
    const openPoCount = purchaseOrders.filter((p) => p.status === 'Ordered').length;
    const pendingPrCount = purchaseRequests.filter((p) => p.status === 'Pending').length;

    return {
      totalItems,
      totalStockUnits,
      totalAssetValue,
      criticalCount,
      expiringCount,
      openPoCount,
      pendingPrCount,
    };
  }, [rawMaterials, purchaseOrders, purchaseRequests]);

  // Search & Filter states for List Bahan Baku
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Form State for Add / Edit Bahan Baku (`/dashboard/bahan-baku/tambah` & `/:id/edit`)
  const editingTarget = useMemo(() => {
    if (activeView === 'edit' && entityId) {
      return rawMaterials.find((r) => r.id === entityId || r.sku === entityId) || null;
    }
    return null;
  }, [activeView, entityId, rawMaterials]);

  const [rmForm, setRmForm] = useState<{
    id?: string;
    sku: string;
    name: string;
    category: string;
    brand: string;
    supplierId: string;
    supplierName: string;
    mainUnit: string;
    subUnit: string;
    itemsPerCarton: number;
    stock: number;
    minStock: number;
    costPrice: number;
    weightMl: number;
    storageLocation: string;
    batchCode: string;
    productionDate: string;
    expiryDate: string;
    imageUrl: string;
    description: string;
    isActive: boolean;
    trackStockCard: boolean;
    sellByUnit: boolean;
  }>({
    sku: `BB-${Date.now().toString().slice(-5)}`,
    name: '',
    category: 'BAHAN BAKU UTAMA',
    brand: '',
    supplierId: '',
    supplierName: '',
    mainUnit: 'Kg',
    subUnit: 'Gram',
    itemsPerCarton: 1000,
    stock: 0,
    minStock: 5,
    costPrice: 0,
    weightMl: 1000,
    storageLocation: 'Gudang Bahan Baku',
    batchCode: `BATCH-BB-${new Date().toISOString().slice(0, 7).replace('-', '')}`,
    productionDate: new Date().toISOString().slice(0, 10),
    expiryDate: '',
    imageUrl: '',
    description: '',
    isActive: true,
    trackStockCard: true,
    sellByUnit: true,
  });

  // Populate form when entering edit mode
  React.useEffect(() => {
    if (editingTarget) {
      setRmForm({
        id: editingTarget.id,
        sku: editingTarget.sku,
        name: editingTarget.name,
        category: editingTarget.category,
        brand: editingTarget.brand || '',
        supplierId: editingTarget.supplierId || '',
        supplierName: editingTarget.supplierName || '',
        mainUnit: editingTarget.mainUnit || 'Kg',
        subUnit: editingTarget.subUnit || 'Gram',
        itemsPerCarton: editingTarget.itemsPerCarton || 1,
        stock: editingTarget.stock || 0,
        minStock: editingTarget.minStock || 5,
        costPrice: editingTarget.costPrice || 0,
        weightMl: editingTarget.weightMl || 0,
        storageLocation: editingTarget.storageLocation || 'Gudang Bahan Baku',
        batchCode: editingTarget.batchCode || '',
        productionDate: editingTarget.productionDate || '',
        expiryDate: editingTarget.expiryDate || '',
        imageUrl: editingTarget.imageUrl || '',
        description: editingTarget.description || '',
        isActive: editingTarget.isActive !== false,
        trackStockCard: editingTarget.trackStockCard !== false,
        sellByUnit: Boolean(editingTarget.sellByUnit),
      });
    } else if (activeView === 'tambah') {
      setRmForm((prev) => ({
        ...prev,
        id: undefined,
        sku: `BB-${Date.now().toString().slice(-5)}`,
        name: '',
        stock: 0,
        costPrice: 0,
      }));
    }
  }, [editingTarget, activeView]);

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 800, 0.7);
      setRmForm((prev) => ({ ...prev, imageUrl: compressed }));
      showFlash(`Foto "${file.name}" berhasil dikompres & diunggah!`, 'success');
    } catch {
      showFlash('Gagal memproses gambar bahan baku.', 'error');
    }
  };

  const handleSaveRmForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rmForm.name || !rmForm.name.trim()) {
      showFlash('Peringatan: Nama Bahan Baku wajib diisi!', 'error');
      return;
    }
    try {
      const saved = await saveRawMaterialInDb(rmForm);
      try {
        if (rmForm.brand && rmForm.brand.trim() && typeof addBrand === 'function') {
          Promise.resolve(addBrand(rmForm.brand.trim())).catch(() => {});
        }
        if (
          rmForm.storageLocation &&
          rmForm.storageLocation.trim() &&
          typeof addStorageLocation === 'function'
        ) {
          Promise.resolve(addStorageLocation(rmForm.storageLocation.trim())).catch(() => {});
        }
        if (rmForm.category && rmForm.category.trim() && typeof addCategory === 'function') {
          Promise.resolve(addCategory(rmForm.category.trim())).catch(() => {});
        }
      } catch {}
      emitRawMaterialsUpdated(saved);
      showFlash(`Bahan baku "${saved.name}" berhasil disimpan!`, 'success');
      safeNavigate('/dashboard/bahan-baku', 'list');
    } catch (err: any) {
      showFlash(err?.message || 'Gagal menyimpan bahan baku', 'error');
    }
  };

  // Stock Adjustment State (Stok Masuk, Stok Keluar, Opname)
  const [stockAdjustForm, setStockAdjustForm] = useState<{
    rawMaterialId: string;
    qty: number;
    batchCode: string;
    expiryDate: string;
    newBuyPrice: number;
    notes: string;
  }>({
    rawMaterialId: '',
    qty: 1,
    batchCode: '',
    expiryDate: '',
    newBuyPrice: 0,
    notes: '',
  });

  const handleExecuteStockAdjust = async (
    mode: 'inflow' | 'outflow' | 'opname'
  ) => {
    if (!stockAdjustForm.rawMaterialId) {
      showFlash('Pilih bahan baku terlebih dahulu!', 'error');
      return;
    }
    const target = rawMaterials.find((r) => r.id === stockAdjustForm.rawMaterialId);
    if (!target) {
      showFlash('Bahan baku tidak ditemukan!', 'error');
      return;
    }

    try {
      let delta = Number(stockAdjustForm.qty || 0);
      if (mode === 'outflow') delta = -Math.abs(delta);
      if (mode === 'opname') delta = Number(stockAdjustForm.qty || 0) - Number(target.stock || 0);

      await adjustRawMaterialStock({
        rawMaterialId: target.id,
        qtyDelta: delta,
        type: mode,
        batchCode: stockAdjustForm.batchCode || target.batchCode,
        expiryDate: stockAdjustForm.expiryDate || target.expiryDate,
        newBuyPrice: stockAdjustForm.newBuyPrice > 0 ? stockAdjustForm.newBuyPrice : undefined,
        notes:
          stockAdjustForm.notes ||
          (mode === 'inflow'
            ? 'Stok Masuk Bahan Baku Manual'
            : mode === 'outflow'
            ? 'Stok Keluar / Pemakaian Produksi'
            : 'Penyesuaian Fisik Stok Opname Bahan Baku'),
      });
      showFlash(`Stok bahan baku "${target.name}" berhasil diperbarui!`, 'success');
      setStockAdjustForm({
        rawMaterialId: '',
        qty: 1,
        batchCode: '',
        expiryDate: '',
        newBuyPrice: 0,
        notes: '',
      });
    } catch (err: any) {
      showFlash(err?.message || 'Gagal memperbarui stok bahan baku.', 'error');
    }
  };

  // Production / BOM Conversion Modal State (Convert Raw Materials -> Product Stock)
  const [produceModal, setProduceModal] = useState<{
    open: boolean;
    productId: string;
    qtyToProduce: number;
    isProcessing: boolean;
  }>({
    open: false,
    productId: '',
    qtyToProduce: 1,
    isProcessing: false,
  });

  const bomProducts = useMemo(() => {
    return allStoreProducts.filter(
      (p: any) => p.hasRawMaterials && Array.isArray(p.rawMaterialRecipe) && p.rawMaterialRecipe.length > 0
    );
  }, [allStoreProducts]);

  const handleProduceProductFromBom = async () => {
    const prod: any = bomProducts.find((p) => p.id === produceModal.productId);
    if (!prod || produceModal.qtyToProduce <= 0) return;
    setProduceModal((prev) => ({ ...prev, isProcessing: true }));
    try {
      await deductRawMaterialsForProductBom({
        productId: prod.id,
        productName: prod.name,
        productQtySoldOrProduced: produceModal.qtyToProduce,
        recipe: prod.rawMaterialRecipe,
        referenceId: `PROD-${Date.now()}`,
        operator: 'Produksi BOM Gudang',
      });
      const currentProdStock = Number(prod.stockInUnits ?? prod.stock ?? 0);
      const nextProdStock = currentProdStock + produceModal.qtyToProduce;
      await saveProductDocToAllPaths(prod.id, {
        ...prod,
        stock: nextProdStock,
        stockInUnits: nextProdStock,
      });
      showFlash(
        `Produksi berhasil! +${produceModal.qtyToProduce} ${prod.mainUnit || 'Produk'} "${prod.name}" ditambahkan & stok bahan baku otomatis dipotong.`,
        'success'
      );
      setProduceModal({ open: false, productId: '', qtyToProduce: 1, isProcessing: false });
    } catch (err: any) {
      showFlash(err?.message || 'Gagal memproses produksi BOM', 'error');
      setProduceModal((prev) => ({ ...prev, isProcessing: false }));
    }
  };

  // Supplier Form State (`/dashboard/bahan-baku/supplier`)
  const [supplierModal, setSupplierModal] = useState<{
    open: boolean;
    id?: string;
    code: string;
    name: string;
    contactPerson: string;
    phone: string;
    email: string;
    address: string;
    category: string;
    leadTimeDays: number;
    paymentTerms: RawMaterialSupplier['paymentTerms'];
    notes: string;
  }>({
    open: false,
    code: '',
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    category: 'Bahan Baku Utama',
    leadTimeDays: 2,
    paymentTerms: 'COD',
    notes: '',
  });

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierModal.name.trim()) {
      showFlash('Nama Supplier wajib diisi!', 'error');
      return;
    }
    try {
      const saved = await saveRawMaterialSupplierInDb(supplierModal);
      setSupplierModal((prev) => ({ ...prev, open: false }));
      showFlash(`Supplier "${saved.name}" berhasil disimpan!`, 'success');
    } catch (err: any) {
      showFlash(err?.message || 'Gagal menyimpan supplier bahan baku.', 'error');
    }
  };

  // Direct Procurement / Pembelian Bahan Baku (`/dashboard/bahan-baku/pembelian`) & PO (`/dashboard/bahan-baku/po`)
  const [poForm, setPoForm] = useState<{
    supplierId: string;
    supplierName: string;
    orderDate: string;
    expectedDate: string;
    paymentMethod: RawMaterialPurchaseOrder['paymentMethod'];
    directReceive: boolean;
    notes: string;
    items: RawMaterialPOItem[];
  }>({
    supplierId: '',
    supplierName: '',
    orderDate: new Date().toISOString().slice(0, 10),
    expectedDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'Cash',
    directReceive: true,
    notes: '',
    items: [],
  });

  const handleAddPoItem = () => {
    const firstRm = rawMaterials[0];
    setPoForm((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          rawMaterialId: firstRm?.id || '',
          rawMaterialName: firstRm?.name || '',
          sku: firstRm?.sku || '',
          qty: 10,
          unit: firstRm?.mainUnit || 'Kg',
          buyPrice: Number(firstRm?.costPrice || 0),
          subtotal: 10 * Number(firstRm?.costPrice || 0),
          batchCode: `BATCH-${Date.now().toString().slice(-4)}`,
          productionDate: new Date().toISOString().slice(0, 10),
          expiryDate: firstRm?.expiryDate || '',
        },
      ],
    }));
  };

  const handleSubmitPembelianOrPO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (poForm.items.length === 0) {
      showFlash('Tambahkan minimal 1 item bahan baku!', 'error');
      return;
    }
    try {
      const supName =
        poForm.supplierName.trim() ||
        suppliers.find((s) => s.id === poForm.supplierId)?.name ||
        'Supplier Bahan Baku';

      const createdPo = await saveRawMaterialPOInDb({
        supplierId: poForm.supplierId,
        supplierName: supName,
        orderDate: poForm.orderDate,
        expectedDate: poForm.expectedDate,
        paymentMethod: poForm.paymentMethod,
        status: 'Ordered',
        items: poForm.items,
        notes: poForm.notes,
      });

      if (poForm.directReceive) {
        await receiveRawMaterialPOInDb(createdPo, 'Pembelian Langsung Bahan Baku');
        showFlash(
          `Pembelian ${createdPo.poNumber} berhasil diterima! Stok gudang bahan baku & kas telah diperbarui.`,
          'success'
        );
      } else {
        showFlash(`Purchase Order (PO) ${createdPo.poNumber} berhasil diterbitkan!`, 'success');
      }

      setPoForm((prev) => ({ ...prev, items: [], notes: '' }));
    } catch (err: any) {
      showFlash(err?.message || 'Gagal memproses pembelian bahan baku.', 'error');
    }
  };

  // Purchase Request (PR) State (`/dashboard/bahan-baku/request`)
  const [prForm, setPrForm] = useState<{
    requestedBy: string;
    urgency: RawMaterialPurchaseRequest['urgency'];
    supplierName: string;
    notes: string;
    items: RawMaterialPurchaseRequest['items'];
  }>({
    requestedBy: 'Kepala Gudang / Produksi',
    urgency: 'High',
    supplierName: '',
    notes: '',
    items: [],
  });

  const handleAutoFillCriticalToPr = () => {
    const criticalList = rawMaterials.filter((r) => Number(r.stock || 0) <= Number(r.minStock || 5));
    const targetList = criticalList.length > 0 ? criticalList : rawMaterials.slice(0, 3);
    if (targetList.length === 0) {
      showFlash('Belum ada data bahan baku untuk dimasukkan ke PR.', 'error');
      return;
    }
    setPrForm((prev) => ({
      ...prev,
      items: targetList.map((r) => {
        const reqQty = Math.max(10, Number(r.minStock || 5) * 3 - Number(r.stock || 0));
        return {
          rawMaterialId: r.id,
          rawMaterialName: r.name,
          sku: r.sku,
          currentStock: r.stock,
          requestedQty: reqQty,
          unit: r.mainUnit,
          estimatedCost: r.costPrice,
          subtotal: reqQty * r.costPrice,
          reason: r.stock <= r.minStock ? 'Stok di bawah batas minimum' : 'Restock rutin produksi',
        };
      }),
    }));
    showFlash(
      `${targetList.length} bahan baku berhasil dimasukkan ke daftar Permintaan Pembelian!`,
      'success'
    );
  };

  const handleSubmitPR = async (e: React.FormEvent) => {
    e.preventDefault();
    if (prForm.items.length === 0) {
      showFlash('Tambahkan minimal 1 bahan baku ke daftar Permintaan Pembelian!', 'error');
      return;
    }
    try {
      const savedPr = await saveRawMaterialPRInDb({
        requestedBy: prForm.requestedBy,
        urgency: prForm.urgency,
        supplierName: prForm.supplierName || 'Supplier Utama',
        notes: prForm.notes,
        items: prForm.items,
        status: 'Pending',
      });
      setPrForm((prev) => ({ ...prev, items: [], notes: '' }));
      showFlash(`Permintaan Pembelian (PR) ${savedPr.prNumber} berhasil diajukan!`, 'success');
    } catch (err: any) {
      showFlash(err?.message || 'Gagal mengajukan Permintaan Pembelian (PR).', 'error');
    }
  };

  const handleConvertPrToPo = async (pr: RawMaterialPurchaseRequest) => {
    try {
      const createdPo = await saveRawMaterialPOInDb({
        supplierId: pr.supplierId || '',
        supplierName: pr.supplierName || 'Supplier Bahan Baku',
        status: 'Ordered',
        paymentMethod: 'Cash',
        notes: `Konversi dari Permintaan Pembelian ${pr.prNumber}. ${pr.notes || ''}`,
        items: pr.items.map((i) => ({
          rawMaterialId: i.rawMaterialId,
          rawMaterialName: i.rawMaterialName,
          sku: i.sku,
          qty: i.requestedQty,
          unit: i.unit,
          buyPrice: i.estimatedCost,
          subtotal: i.subtotal,
          batchCode: `BATCH-${pr.prNumber.slice(-4)}`,
          productionDate: new Date().toISOString().slice(0, 10),
        })),
      });

      await saveRawMaterialPRInDb({
        ...pr,
        status: 'Converted_PO',
        linkedPoNumber: createdPo.poNumber,
      });

      showFlash(
        `PR ${pr.prNumber} berhasil dikonversi menjadi PO Resmi ${createdPo.poNumber}!`,
        'success'
      );
    } catch (err: any) {
      showFlash(err?.message || 'Gagal mengonversi PR menjadi PO.', 'error');
    }
  };

  // AI Bahan Baku State (`/dashboard/bahan-baku/ai`)
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiReport, setAiReport] = useState<{
    summary: string;
    healthScore: number;
    recommendations: Array<{
      rawMaterialName: string;
      sku: string;
      currentStock: number;
      unit: string;
      suggestedOrderQty: number;
      estimatedCost: number;
      urgency: string;
      reason: string;
    }>;
    bomBottlenecks: Array<{
      productName: string;
      maxProducible: number;
      limitingRawMaterial: string;
      action: string;
    }>;
  } | null>(null);

  const handleRunAiBahanBaku = async (customQuestion?: string, signal?: AbortSignal) => {
    const cooldown = checkAndRecordAiCooldown('raw-materials-advisor');
    if (!cooldown.allowed) {
      showFlash(cooldown.message, 'error');
      return;
    }

    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/raw-materials-advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          manualTrigger: true,
          question: customQuestion || aiPrompt,
          rawMaterials: rawMaterials.map((r) => ({
            id: r.id,
            sku: r.sku,
            name: r.name,
            category: r.category,
            stock: r.stock,
            minStock: r.minStock,
            unit: r.mainUnit,
            costPrice: r.costPrice,
            expiryDate: r.expiryDate,
          })),
          bomProducts: bomProducts.map((p: any) => ({
            id: p.id,
            name: p.name,
            stock: p.stockInUnits ?? p.stock ?? 0,
            sellPrice: p.pricePerUnit ?? p.sellPrice ?? 0,
            recipe: p.rawMaterialRecipe,
          })),
          recentMovements: movements.slice(0, 25),
        }),
      });
      const data = await res.json();
      if (data && data.report) {
        setAiReport(data.report);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      showFlash('Gagal memuat analisis AI Bahan Baku.', 'error');
    } finally {
      setAiLoading(false);
    }
  };

  const aiBahanBakuControl = useAiFeatureControl({
    featureKey: 'ai_raw_materials_controller',
    onRun: async (signal) => {
      await handleRunAiBahanBaku(undefined, signal);
    },
  });

  const handleCreateAutoPrFromAi = async () => {
    if (!aiReport?.recommendations || aiReport.recommendations.length === 0) return;
    try {
      const savedPr = await saveRawMaterialPRInDb({
        requestedBy: 'AI Bahan Baku Controller',
        urgency: 'Critical',
        supplierName: suppliers[0]?.name || 'Supplier Utama Bahan Baku',
        source: 'AI_Bahan_Baku',
        notes: aiReport.summary,
        items: aiReport.recommendations.map((rec) => {
          const matched = rawMaterials.find(
            (r) => r.sku === rec.sku || r.name.toLowerCase() === rec.rawMaterialName.toLowerCase()
          );
          const qty = Math.max(1, Number(rec.suggestedOrderQty || 10));
          const cost = Number(matched?.costPrice || rec.estimatedCost / qty || 15000);
          return {
            rawMaterialId: matched?.id || rec.sku,
            rawMaterialName: rec.rawMaterialName,
            sku: rec.sku,
            currentStock: rec.currentStock,
            requestedQty: qty,
            unit: rec.unit || matched?.mainUnit || 'Kg',
            estimatedCost: cost,
            subtotal: qty * cost,
            reason: rec.reason,
          };
        }),
      });
      showFlash(
        `Otomatisasi AI berhasil! PR ${savedPr.prNumber} telah dibuat di Permintaan Pembelian.`,
        'success'
      );
      safeNavigate('/dashboard/bahan-baku/request', 'request');
    } catch (err: any) {
      showFlash(err?.message || 'Gagal membuat PR otomatis.', 'error');
    }
  };

  // Filtered list for table
  const filteredRawMaterials = useMemo(() => {
    return rawMaterials.filter((item) => {
      if (activeView === 'kritis' && Number(item.stock || 0) > Number(item.minStock || 5)) {
        return false;
      }
      if (
        selectedCategory !== 'ALL' &&
        (item.category || '').toLowerCase() !== selectedCategory.toLowerCase()
      ) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        (item.category || '').toLowerCase().includes(q) ||
        (item.brand || '').toLowerCase().includes(q) ||
        (item.supplierName || '').toLowerCase().includes(q)
      );
    });
  }, [rawMaterials, activeView, selectedCategory, searchQuery]);

  // Distinct categories in raw materials
  const rmCategoriesList = useMemo(() => {
    const set = new Set<string>(['BAHAN BAKU UTAMA', 'KEMASAN & BOTOL', 'BUMBU & PERASA']);
    masterCategories.forEach((c) => set.add(c));
    rawMaterials.forEach((r) => {
      if (r.category) set.add(r.category);
    });
    return Array.from(set);
  }, [masterCategories, rawMaterials]);

  const cardClass = `rounded-2xl border p-5 sm:p-6 transition-colors ${
    isDark
      ? 'bg-zinc-900/90 border-zinc-800 text-zinc-100'
      : 'bg-white border-slate-200 text-slate-800 shadow-xs'
  }`;

  const inputClass = `w-full px-3.5 py-2 rounded-xl border text-xs transition focus:outline-none focus:ring-2 focus:ring-amber-500 ${
    isDark
      ? 'bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-500'
      : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400'
  }`;

  const labelClass = `block text-xs font-semibold mb-1.5 ${
    isDark ? 'text-zinc-300' : 'text-slate-700'
  }`;

  // Primary navigation tabs matching all requested URLs + sub-features
  const navTabs = [
    {
      id: 'list',
      label: tr('Raw Material List', 'List Bahan Baku'),
      path: '/dashboard/bahan-baku',
      icon: <Boxes className="w-3.5 h-3.5" />,
      badge: rawMaterials.length,
    },
    {
      id: 'supplier',
      label: tr('Supplier Directory', 'Daftar Supplier'),
      path: '/dashboard/bahan-baku/supplier',
      icon: <Truck className="w-3.5 h-3.5" />,
      badge: suppliers.length,
    },
    {
      id: 'pembelian',
      label: tr('Raw Material Purchase', 'Pembelian Bahan Baku'),
      path: '/dashboard/bahan-baku/pembelian',
      icon: <ShoppingCart className="w-3.5 h-3.5" />,
    },
    {
      id: 'po',
      label: tr('Purchase Orders (PO)', 'Daftar Pembelian (PO)'),
      path: '/dashboard/bahan-baku/po',
      icon: <FileText className="w-3.5 h-3.5" />,
      badge: purchaseOrders.length,
    },
    {
      id: 'request',
      label: tr('Purchase Requests (PR)', 'Permintaan Pembelian'),
      path: '/dashboard/bahan-baku/request',
      icon: <ClipboardList className="w-3.5 h-3.5" />,
      badge: kpiStats.pendingPrCount || undefined,
    },
    {
      id: 'ai',
      label: tr('AI Raw Material Control', 'AI Bahan Baku'),
      path: '/dashboard/bahan-baku/ai',
      icon: <Brain className="w-3.5 h-3.5 text-purple-400" />,
      badge: 'AI',
    },
  ];

  // Sub-tabs under List Bahan Baku (matching `/dashboard/produk` sub-tabs)
  const catalogSubTabs = [
    { id: 'list', label: tr('All Raw Materials', 'Katalog Bahan Baku'), path: '/dashboard/bahan-baku' },
    { id: 'tambah', label: tr('+ Add Raw Material', '+ Tambah Bahan Baku'), path: '/dashboard/bahan-baku/tambah' },
    { id: 'kategori', label: tr('Categories & Brands', 'Kategori & Satuan'), path: '/dashboard/bahan-baku/kategori' },
    { id: 'stok_masuk', label: tr('Stock Inflow', 'Stok Masuk'), path: '/dashboard/bahan-baku/stok-masuk' },
    { id: 'stok_keluar', label: tr('Stock Outflow', 'Stok Keluar'), path: '/dashboard/bahan-baku/stok-keluar' },
    { id: 'opname', label: tr('Stock Opname', 'Stok Opname'), path: '/dashboard/bahan-baku/opname' },
    { id: 'pergerakan', label: tr('Stock Movements', 'Kartu Stok & Log'), path: '/dashboard/bahan-baku/pergerakan' },
    { id: 'kritis', label: tr('Critical Stock', 'Stok Kritis'), path: '/dashboard/bahan-baku/kritis' },
  ];

  const isCatalogSubView = [
    'list',
    'tambah',
    'edit',
    'kategori',
    'stok_masuk',
    'stok_keluar',
    'opname',
    'pergerakan',
    'kritis',
  ].includes(activeView);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Toast Notification */}
      {flashMsg && (
        <div
          className={`fixed top-20 right-6 z-50 text-white px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-bold ${
            flashMsg.type === 'error' ? 'bg-rose-600' : 'bg-emerald-600'
          }`}
        >
          {flashMsg.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          )}
          <span>{flashMsg.text}</span>
        </div>
      )}

      {/* Modal Produksi Produk dari Bahan Baku (BOM) */}
      {produceModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className={`w-full max-w-md ${cardClass} space-y-4`}>
            <div className="flex items-center justify-between border-b pb-3 border-zinc-800">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold">
                  {tr('Produce Product from Raw Materials (BOM)', 'Produksi Produk dari Bahan Baku (BOM)')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setProduceModal((prev) => ({ ...prev, open: false }))}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {bomProducts.length === 0 ? (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 space-y-2">
                <p>
                  Belum ada produk di <b>/dashboard/produk</b> yang mengaktifkan fitur{' '}
                  <b>Bahan Baku: ON</b>.
                </p>
                <AppLink
                  to="/dashboard/produk/tambah"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-black font-bold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Atur Resep Bahan Baku di Tambah Produk</span>
                </AppLink>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className={labelClass}>Pilih Produk (Resep BOM Aktif)</label>
                  <select
                    value={produceModal.productId}
                    onChange={(e) =>
                      setProduceModal((prev) => ({ ...prev, productId: e.target.value }))
                    }
                    className={inputClass}
                  >
                    <option value="">-- Pilih Produk --</option>
                    {bomProducts.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (Stok Produk: {p.stockInUnits ?? p.stock ?? 0}{' '}
                        {p.mainUnit || 'Dus'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Jumlah Produk yang Diproduksi</label>
                  <input
                    type="number"
                    min="1"
                    value={produceModal.qtyToProduce}
                    onChange={(e) =>
                      setProduceModal((prev) => ({
                        ...prev,
                        qtyToProduce: Math.max(1, Number(e.target.value) || 1),
                      }))
                    }
                    className={inputClass}
                  />
                </div>

                {produceModal.productId && (() => {
                  const selProd: any = bomProducts.find((p) => p.id === produceModal.productId);
                  if (!selProd || !Array.isArray(selProd.rawMaterialRecipe)) return null;
                  return (
                    <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5 text-xs">
                      <div className="font-bold text-amber-400">
                        Estimasi Pemotongan Bahan Baku:
                      </div>
                      {selProd.rawMaterialRecipe.map((r: any, idx: number) => (
                        <div key={idx} className="flex justify-between text-zinc-300">
                          <span>{r.rawMaterialName}</span>
                          <span className="font-mono font-bold text-rose-400">
                            -{(Number(r.qtyPerUnit || 0) * produceModal.qtyToProduce).toFixed(2)}{' '}
                            {r.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setProduceModal((prev) => ({ ...prev, open: false }))}
                    className="px-3.5 py-1.5 rounded-xl border border-zinc-700 text-xs font-semibold"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={!produceModal.productId || produceModal.isProcessing}
                    onClick={handleProduceProductFromBom}
                    className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    {produceModal.isProcessing ? 'Memproses...' : 'Konfirmasi Produksi'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TOP HEADER */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-sm">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1
                  className={`text-2xl font-black tracking-tight ${
                    isDark ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  {tr('RAW MATERIAL INVENTORY & PROCUREMENT', 'STOK BAHAN BAKU & PENGADAAN')}
                </h1>
                <span className="text-[10px] font-mono font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  LIVE FIRESTORE + BOM SYNC
                </span>
              </div>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                {tr(
                  'Integrated Raw Material Catalog, Supplier Directory, Purchase Orders (PO), Purchase Requests (PR), Product BOM Recipe Sync & AI Stock Controller.',
                  'Manajemen terpadu Katalog Bahan Baku, Supplier, Pembelian, PO, Permintaan Pembelian (PR), Sinkronisasi Resep Produk (/dashboard/produk/tambah) & AI Bahan Baku.'
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() =>
              setProduceModal({
                open: true,
                productId: bomProducts[0]?.id || '',
                qtyToProduce: 1,
                isProcessing: false,
              })
            }
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{tr('Produce BOM Product', 'Produksi dari Bahan Baku')}</span>
          </button>

          <AppLink
            to="/dashboard/produk/tambah"
            className="px-3.5 py-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-bold flex items-center gap-1.5 transition"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{tr('Link to Product BOM', 'Atur BOM di Tambah Produk')}</span>
          </AppLink>

          <AppLink
            to="/dashboard/bahan-baku/tambah"
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>{tr('+ Add Raw Material', '+ Tambah Bahan Baku')}</span>
          </AppLink>

          <div
            className={`flex items-center p-1 rounded-xl border ${
              isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setIsDark(true)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer ${
                isDark ? 'bg-zinc-800 text-white' : 'text-slate-500'
              }`}
            >
              <Moon className="w-3.5 h-3.5 text-blue-400" />
            </button>
            <button
              type="button"
              onClick={() => setIsDark(false)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer ${
                !isDark ? 'bg-slate-100 text-slate-900' : 'text-zinc-500'
              }`}
            >
              <Sun className="w-3.5 h-3.5 text-amber-500" />
            </button>
          </div>
        </div>
      </div>

      {/* KPI SUMMARY CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className={cardClass}>
          <div className="text-[11px] font-bold uppercase text-zinc-400">Total Jenis Bahan</div>
          <div className="text-xl font-black mt-1 text-amber-400">
            {kpiStats.totalItems.toLocaleString('id-ID')} SKU
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            Total Stok: {kpiStats.totalStockUnits.toLocaleString('id-ID')} Satuan
          </div>
        </div>

        <div className={cardClass}>
          <div className="text-[11px] font-bold uppercase text-zinc-400">Nilai Aset Bahan Baku</div>
          <div className="text-lg font-black mt-1 text-emerald-400 font-mono">
            {formatMoney(kpiStats.totalAssetValue)}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">Gudang Bahan Baku Aktif</div>
        </div>

        <div className={cardClass}>
          <div className="text-[11px] font-bold uppercase text-zinc-400">Stok Kritis / Habis</div>
          <div
            className={`text-xl font-black mt-1 ${
              kpiStats.criticalCount > 0 ? 'text-rose-400' : 'text-emerald-400'
            }`}
          >
            {kpiStats.criticalCount} Bahan
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">Perlu segera direstock</div>
        </div>

        <div className={cardClass}>
          <div className="text-[11px] font-bold uppercase text-zinc-400">Produk Pakai BOM</div>
          <div className="text-xl font-black mt-1 text-blue-400">
            {bomProducts.length} Produk
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">Tersinkron ke /dashboard/produk</div>
        </div>

        <div className={cardClass}>
          <div className="text-[11px] font-bold uppercase text-zinc-400">Supplier & PO Aktif</div>
          <div className="text-xl font-black mt-1 text-orange-400">
            {suppliers.length} Sup / {kpiStats.openPoCount} PO
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {kpiStats.pendingPrCount} PR Menunggu
          </div>
        </div>

        <div className={cardClass}>
          <div className="text-[11px] font-bold uppercase text-purple-400 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" /> AI Bahan Baku
          </div>
          <div className="text-xs font-bold mt-1.5">
            <AppLink
              to="/dashboard/bahan-baku/ai"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold transition"
            >
              <Brain className="w-3.5 h-3.5" />
              <span>Buka Kontrol AI</span>
            </AppLink>
          </div>
        </div>
      </div>

      {/* MAIN NAVIGATION TABS (5 URL Utama + AI Bahan Baku) */}
      <div className="flex flex-wrap items-center gap-2 border-b pb-3 border-zinc-800">
        {navTabs.map((tab) => {
          const isActive =
            (tab.id === 'list' && isCatalogSubView) || activeView === tab.id;
          return (
            <AppLink
              key={tab.id}
              to={tab.path}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 border transition ${
                isActive
                  ? 'bg-amber-500 text-black border-amber-400 shadow-sm'
                  : isDark
                  ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${
                    isActive
                      ? 'bg-black/20 text-black font-black'
                      : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </AppLink>
          );
        })}
      </div>

      {/* SUB-TABS FOR LIST BAHAN BAKU (Mirip /dashboard/produk) */}
      {isCatalogSubView && (
        <div className="flex flex-wrap items-center gap-1.5">
          {catalogSubTabs.map((st) => {
            const active =
              activeView === st.id ||
              (activeView === 'edit' && st.id === 'tambah');
            return (
              <AppLink
                key={st.id}
                to={st.path}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                  active
                    ? 'bg-blue-600 text-white border-blue-500'
                    : isDark
                    ? 'bg-zinc-900/70 border-zinc-800 text-zinc-400 hover:text-white'
                    : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900'
                }`}
              >
                {st.label}
              </AppLink>
            );
          })}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 1. VIEW: TAMBAH / EDIT BAHAN BAKU (/dashboard/bahan-baku/tambah)      */}
      {/* ===================================================================== */}
      {(activeView === 'tambah' || activeView === 'edit') && (
        <form onSubmit={handleSaveRmForm} className={`${cardClass} space-y-6`}>
          <div className="flex items-center justify-between border-b pb-4 border-zinc-800">
            <div className="flex items-center gap-2.5">
              <Boxes className="w-5 h-5 text-amber-400" />
              <div>
                <h2 className="text-base font-black">
                  {activeView === 'edit'
                    ? `Edit Bahan Baku: ${rmForm.name}`
                    : 'Tambah Bahan Baku Baru'}
                </h2>
                <p className="text-xs text-zinc-400">
                  Data bahan baku ini otomatis tampil pada pilihan Bahan Baku di halaman{' '}
                  <b>/dashboard/produk/tambah</b>.
                </p>
              </div>
            </div>
            <AppLink
              to="/dashboard/bahan-baku"
              className="px-3.5 py-1.5 rounded-xl border border-zinc-700 text-xs font-semibold flex items-center gap-1.5 hover:bg-zinc-800"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Kembali ke List Bahan Baku</span>
            </AppLink>
          </div>

          {/* Upload Foto Bahan Baku */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 p-4 rounded-xl border border-zinc-800 bg-zinc-950/50">
            <div className="w-24 h-24 rounded-xl border-2 border-dashed border-zinc-700 flex items-center justify-center overflow-hidden bg-zinc-900 shrink-0">
              {rmForm.imageUrl ? (
                <img
                  src={rmForm.imageUrl}
                  alt="Foto Bahan Baku"
                  className="w-full h-full object-cover"
                />
              ) : (
                <ImageIcon className="w-7 h-7 text-zinc-500" />
              )}
            </div>
            <div className="space-y-2 flex-1">
              <div className="text-xs font-bold">Foto / Gambar Bahan Baku</div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="hidden"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Gambar</span>
                </button>
                {rmForm.imageUrl && (
                  <button
                    type="button"
                    onClick={() => setRmForm((prev) => ({ ...prev, imageUrl: '' }))}
                    className="px-3 py-1.5 rounded-lg bg-rose-600/20 text-rose-400 text-xs font-bold cursor-pointer"
                  >
                    Hapus Foto
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Nama Bahan Baku *</label>
              <input
                type="text"
                required
                placeholder="Contoh: Biji Kopi Arabika / Susu UHT / Gula Aren"
                value={rmForm.name}
                onChange={(e) => setRmForm((prev) => ({ ...prev, name: e.target.value }))}
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Kode SKU / Barcode Bahan Baku</label>
              <input
                type="text"
                value={rmForm.sku}
                onChange={(e) => setRmForm((prev) => ({ ...prev, sku: e.target.value }))}
                className={`${inputClass} font-mono`}
              />
            </div>

            <div>
              <label className={labelClass}>Kategori Bahan Baku</label>
              <select
                value={rmForm.category}
                onChange={(e) => setRmForm((prev) => ({ ...prev, category: e.target.value }))}
                className={inputClass}
              >
                {rmCategoriesList.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Brand / Merek Bahan Baku</label>
              <input
                type="text"
                list="rm-brands-list"
                placeholder="Pilih atau ketik brand..."
                value={rmForm.brand}
                onChange={(e) => setRmForm((prev) => ({ ...prev, brand: e.target.value }))}
                className={inputClass}
              />
              <datalist id="rm-brands-list">
                {masterBrands.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>

            <div>
              <label className={labelClass}>Supplier Utama</label>
              <select
                value={rmForm.supplierId}
                onChange={(e) => {
                  const sup = suppliers.find((s) => s.id === e.target.value);
                  setRmForm((prev) => ({
                    ...prev,
                    supplierId: e.target.value,
                    supplierName: sup?.name || prev.supplierName,
                  }));
                }}
                className={inputClass}
              >
                <option value="">-- Pilih Supplier --</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Lokasi Penyimpanan Gudang</label>
              <input
                type="text"
                list="rm-storage-list"
                value={rmForm.storageLocation}
                onChange={(e) =>
                  setRmForm((prev) => ({ ...prev, storageLocation: e.target.value }))
                }
                className={inputClass}
              />
              <datalist id="rm-storage-list">
                <option value="Gudang Bahan Baku" />
                <option value="Chiller / Cold Storage" />
                <option value="Rak Bahan Kering" />
                {masterStorages.map((loc) => (
                  <option key={loc} value={loc} />
                ))}
              </datalist>
            </div>

            <div>
              <label className={labelClass}>Satuan Utama (Stok & Pembelian)</label>
              <select
                value={rmForm.mainUnit}
                onChange={(e) => setRmForm((prev) => ({ ...prev, mainUnit: e.target.value }))}
                className={inputClass}
              >
                {RM_MAIN_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Satuan Takaran Kecil (Sub-Unit)</label>
              <select
                value={rmForm.subUnit}
                onChange={(e) => setRmForm((prev) => ({ ...prev, subUnit: e.target.value }))}
                className={inputClass}
              >
                {RM_SUB_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>
                Isi Konversi (1 {rmForm.mainUnit} = berapa {rmForm.subUnit}?)
              </label>
              <input
                type="number"
                min="1"
                value={rmForm.itemsPerCarton}
                onChange={(e) =>
                  setRmForm((prev) => ({
                    ...prev,
                    itemsPerCarton: Math.max(1, Number(e.target.value) || 1),
                  }))
                }
                className={`${inputClass} font-mono`}
              />
            </div>

            <div>
              <label className={labelClass}>
                Stok Saat Ini ({rmForm.mainUnit})
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rmForm.stock}
                onChange={(e) =>
                  setRmForm((prev) => ({
                    ...prev,
                    stock: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className={`${inputClass} font-mono`}
              />
            </div>

            <div>
              <label className={labelClass}>
                Batas Stok Minimum / Alert ({rmForm.mainUnit})
              </label>
              <input
                type="number"
                min="0"
                value={rmForm.minStock}
                onChange={(e) =>
                  setRmForm((prev) => ({
                    ...prev,
                    minStock: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className={`${inputClass} font-mono`}
              />
            </div>

            <div>
              <label className={labelClass}>
                Harga Modal per 1 {rmForm.mainUnit} (Rp)
              </label>
              <input
                type="number"
                min="0"
                value={rmForm.costPrice}
                onChange={(e) =>
                  setRmForm((prev) => ({
                    ...prev,
                    costPrice: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className={`${inputClass} font-mono`}
              />
            </div>

            <div>
              <label className={labelClass}>Kode Batch FEFO</label>
              <input
                type="text"
                value={rmForm.batchCode}
                onChange={(e) => setRmForm((prev) => ({ ...prev, batchCode: e.target.value }))}
                className={`${inputClass} font-mono`}
              />
            </div>

            <div>
              <label className={labelClass}>Tanggal Produksi / Masuk</label>
              <input
                type="date"
                value={rmForm.productionDate}
                onChange={(e) =>
                  setRmForm((prev) => ({ ...prev, productionDate: e.target.value }))
                }
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Tanggal Kadaluarsa (Expired)</label>
              <input
                type="date"
                value={rmForm.expiryDate}
                onChange={(e) => setRmForm((prev) => ({ ...prev, expiryDate: e.target.value }))}
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-800">
            <AppLink
              to="/dashboard/bahan-baku"
              className="px-4 py-2 rounded-xl border border-zinc-700 text-xs font-semibold"
            >
              Batal
            </AppLink>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-extrabold flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Simpan Bahan Baku</span>
            </button>
          </div>
        </form>
      )}

      {/* ===================================================================== */}
      {/* 2. VIEW: LIST BAHAN BAKU & SUB-TABS (/dashboard/bahan-baku/)          */}
      {/* ===================================================================== */}
      {(activeView === 'list' || activeView === 'kritis') && (
        <div className={`${cardClass} space-y-4`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Cari nama bahan baku, SKU, kategori, supplier..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`${inputClass} pl-10`}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-zinc-400" />
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className={`${inputClass} w-auto`}
              >
                <option value="ALL">Semua Kategori ({rawMaterials.length})</option>
                {rmCategoriesList.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr
                  className={`border-b uppercase text-[11px] font-bold ${
                    isDark
                      ? 'border-zinc-800 text-zinc-400 bg-zinc-950/60'
                      : 'border-slate-200 text-slate-600 bg-slate-50'
                  }`}
                >
                  <th className="py-3 px-3">Bahan Baku</th>
                  <th className="py-3 px-3">Kategori & Supplier</th>
                  <th className="py-3 px-3">Stok Gudang</th>
                  <th className="py-3 px-3">Harga Modal / Unit</th>
                  <th className="py-3 px-3">Total Nilai Aset</th>
                  <th className="py-3 px-3">Digunakan di Produk (BOM)</th>
                  <th className="py-3 px-3">Batch & Expired</th>
                  <th className="py-3 px-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filteredRawMaterials.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-zinc-400">
                      <div className="flex flex-col items-center gap-2">
                        <Boxes className="w-8 h-8 text-zinc-600" />
                        <p className="font-semibold">
                          Belum ada data bahan baku yang sesuai filter.
                        </p>
                        <AppLink
                          to="/dashboard/bahan-baku/tambah"
                          className="px-4 py-2 rounded-xl bg-amber-500 text-black font-bold text-xs mt-1"
                        >
                          + Tambah Bahan Baku Pertama
                        </AppLink>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRawMaterials.map((rm) => {
                    const isCritical = Number(rm.stock || 0) <= Number(rm.minStock || 5);
                    const totalVal = Number(rm.stock || 0) * Number(rm.costPrice || 0);
                    const linkedProducts = productsUsingRmMap.get(rm.id) || [];

                    return (
                      <tr
                        key={rm.id}
                        className={`transition ${
                          isDark ? 'hover:bg-zinc-800/40' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-3">
                            {rm.imageUrl ? (
                              <img
                                src={rm.imageUrl}
                                alt={rm.name}
                                className="w-10 h-10 rounded-lg object-cover border border-zinc-700"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold">
                                {rm.name.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <div className="font-bold text-sm">{rm.name}</div>
                              <div className="text-[11px] font-mono text-zinc-400">
                                {rm.sku} • {rm.storageLocation}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded-md bg-zinc-800 text-amber-300 border border-zinc-700 text-[10px] font-bold">
                            {rm.category}
                          </span>
                          <div className="text-[11px] text-zinc-400 mt-1">
                            {rm.supplierName || rm.brand || '-'}
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`font-mono text-sm font-black ${
                                isCritical ? 'text-rose-400' : 'text-emerald-400'
                              }`}
                            >
                              {rm.stock.toLocaleString('id-ID')} {rm.mainUnit}
                            </span>
                            {isCritical && (
                              <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] font-bold">
                                KRITIS
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-500 font-mono">
                            Min: {rm.minStock} {rm.mainUnit} (
                            {(rm.stock * rm.itemsPerCarton).toLocaleString('id-ID')} {rm.subUnit})
                          </div>
                        </td>

                        <td className="py-3 px-3 font-mono font-bold">
                          {formatMoney(rm.costPrice)} / {rm.mainUnit}
                        </td>

                        <td className="py-3 px-3 font-mono font-bold text-emerald-400">
                          {formatMoney(totalVal)}
                        </td>

                        <td className="py-3 px-3">
                          {linkedProducts.length === 0 ? (
                            <span className="text-[11px] text-zinc-500">
                              Belum dihubungkan ke BOM
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {linkedProducts.map((lp, idx) => (
                                <span
                                  key={idx}
                                  className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 text-[10px] font-semibold"
                                >
                                  {lp.productName} ({lp.qtyPerUnit} {lp.unit})
                                </span>
                              ))}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          <div className="font-mono text-[11px] text-zinc-300">
                            {rm.batchCode || '-'}
                          </div>
                          {rm.expiryDate && (
                            <div className="text-[10px] text-amber-400">
                              Exp: {rm.expiryDate}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <AppLink
                              to={`/dashboard/bahan-baku/${encodeURIComponent(rm.id)}/edit`}
                              className="p-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white transition"
                              title="Edit Bahan Baku"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </AppLink>
                            <button
                              type="button"
                              onClick={async () => {
                                await deleteRawMaterialFromDb(rm.id);
                                showFlash(`Bahan baku "${rm.name}" dihapus.`);
                              }}
                              className="p-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white transition cursor-pointer"
                              title="Hapus Bahan Baku"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
      )}

      {/* ===================================================================== */}
      {/* 2B. SUB-VIEW: KATEGORI & SATUAN (/dashboard/bahan-baku/kategori)       */}
      {/* ===================================================================== */}
      {activeView === 'kategori' && (
        <div className={`${cardClass} space-y-4`}>
          <h2 className="text-sm font-black uppercase tracking-wider text-amber-400">
            Ringkasan Kategori Bahan Baku
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {rmCategoriesList.map((cat) => {
              const items = rawMaterials.filter(
                (r) => (r.category || '').toLowerCase() === cat.toLowerCase()
              );
              const totalVal = items.reduce((s, r) => s + r.stock * r.costPrice, 0);
              return (
                <div
                  key={cat}
                  className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/60 flex items-center justify-between"
                >
                  <div>
                    <div className="font-bold text-sm text-white">{cat}</div>
                    <div className="text-xs text-zinc-400 mt-0.5">
                      {items.length} Jenis Bahan Baku
                    </div>
                  </div>
                  <div className="text-right font-mono font-bold text-emerald-400 text-xs">
                    {formatMoney(totalVal)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 2C. SUB-VIEW: STOK MASUK / KELUAR / OPNAME                            */}
      {/* ===================================================================== */}
      {(activeView === 'stok_masuk' ||
        activeView === 'stok_keluar' ||
        activeView === 'opname') && (
        <div className={`${cardClass} space-y-4 max-w-2xl`}>
          <h2 className="text-base font-black flex items-center gap-2">
            {activeView === 'stok_masuk' && (
              <>
                <ArrowDownCircle className="w-5 h-5 text-emerald-400" />
                <span>Input Stok Masuk Bahan Baku</span>
              </>
            )}
            {activeView === 'stok_keluar' && (
              <>
                <ArrowUpCircle className="w-5 h-5 text-rose-400" />
                <span>Input Stok Keluar / Pemakaian Bahan Baku</span>
              </>
            )}
            {activeView === 'opname' && (
              <>
                <RefreshCw className="w-5 h-5 text-amber-400" />
                <span>Audit & Stok Opname Fisik Bahan Baku</span>
              </>
            )}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelClass}>Pilih Bahan Baku *</label>
              <select
                value={stockAdjustForm.rawMaterialId}
                onChange={(e) =>
                  setStockAdjustForm((prev) => ({
                    ...prev,
                    rawMaterialId: e.target.value,
                  }))
                }
                className={inputClass}
              >
                <option value="">-- Pilih Bahan Baku --</option>
                {rawMaterials.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.sku}) — Stok Saat Ini: {r.stock} {r.mainUnit}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>
                {activeView === 'opname'
                  ? 'Stok Fisik Aktual Hasil Hitung'
                  : 'Jumlah (Qty)'}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={stockAdjustForm.qty}
                onChange={(e) =>
                  setStockAdjustForm((prev) => ({
                    ...prev,
                    qty: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Kode Batch FEFO (Opsional)</label>
              <input
                type="text"
                value={stockAdjustForm.batchCode}
                onChange={(e) =>
                  setStockAdjustForm((prev) => ({
                    ...prev,
                    batchCode: e.target.value,
                  }))
                }
                className={inputClass}
              />
            </div>

            <div className="sm:col-span-2">
              <label className={labelClass}>Catatan / Keterangan</label>
              <input
                type="text"
                placeholder="Contoh: Penerimaan tambahan / Pemakaian dapur produksi..."
                value={stockAdjustForm.notes}
                onChange={(e) =>
                  setStockAdjustForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() =>
                handleExecuteStockAdjust(
                  activeView === 'stok_masuk'
                    ? 'inflow'
                    : activeView === 'stok_keluar'
                    ? 'outflow'
                    : 'opname'
                )
              }
              className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-extrabold cursor-pointer"
            >
              Simpan Perubahan Stok
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 2D. SUB-VIEW: KARTU STOK & LOG PERGERAKAN (/dashboard/bahan-baku/pergerakan) */}
      {/* ===================================================================== */}
      {activeView === 'pergerakan' && (
        <div className={`${cardClass} space-y-4`}>
          <h2 className="text-sm font-black uppercase tracking-wider text-amber-400">
            Kartu Stok & Riwayat Pergerakan Bahan Baku (Termasuk Pemotongan Otomatis BOM)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 uppercase text-[11px]">
                  <th className="py-2.5 px-3">Waktu</th>
                  <th className="py-2.5 px-3">Bahan Baku</th>
                  <th className="py-2.5 px-3">Tipe Mutasi</th>
                  <th className="py-2.5 px-3">Perubahan</th>
                  <th className="py-2.5 px-3">Stok Akhir</th>
                  <th className="py-2.5 px-3">Keterangan / Produk BOM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-zinc-500">
                      Belum ada riwayat pergerakan stok bahan baku.
                    </td>
                  </tr>
                ) : (
                  movements.map((m) => (
                    <tr key={m.id} className="hover:bg-zinc-800/30">
                      <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-400">
                        {new Date(m.createdAt).toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-3 font-bold">
                        {m.rawMaterialName}{' '}
                        <span className="text-zinc-500 font-mono text-[10px]">({m.sku})</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            m.qtyChange >= 0
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-rose-500/15 text-rose-400'
                          }`}
                        >
                          {m.type}
                        </span>
                      </td>
                      <td
                        className={`py-2.5 px-3 font-mono font-bold ${
                          m.qtyChange >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {m.qtyChange >= 0 ? `+${m.qtyChange}` : m.qtyChange} {m.unit}
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        {m.newStock} {m.unit}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-300">
                        {m.notes || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 3. VIEW: DAFTAR SUPPLIER (/dashboard/bahan-baku/supplier)             */}
      {/* ===================================================================== */}
      {activeView === 'supplier' && (
        <div className={`${cardClass} space-y-5`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4 border-zinc-800">
            <div>
              <h2 className="text-base font-black flex items-center gap-2">
                <Truck className="w-5 h-5 text-orange-400" />
                <span>Daftar Supplier Bahan Baku</span>
              </h2>
              <p className="text-xs text-zinc-400">
                Direktori mitra pemasok bahan baku, termin pembayaran (TOP/COD), dan lead-time pengiriman.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setSupplierModal({
                  open: true,
                  code: `SUP-BB-${Date.now().toString().slice(-4)}`,
                  name: '',
                  contactPerson: '',
                  phone: '',
                  email: '',
                  address: '',
                  category: 'Bahan Baku Utama',
                  leadTimeDays: 2,
                  paymentTerms: 'COD',
                  notes: '',
                })
              }
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Tambah Supplier Bahan Baku</span>
            </button>
          </div>

          {supplierModal.open && (
            <form
              onSubmit={handleSaveSupplier}
              className="p-4 rounded-xl border border-amber-500/30 bg-zinc-950/80 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase text-amber-400">
                  Form Data Supplier Bahan Baku
                </h3>
                <button
                  type="button"
                  onClick={() => setSupplierModal((prev) => ({ ...prev, open: false }))}
                  className="text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>Nama Perusahaan / Supplier *</label>
                  <input
                    type="text"
                    required
                    value={supplierModal.name}
                    onChange={(e) =>
                      setSupplierModal((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Nama Kontak (PIC)</label>
                  <input
                    type="text"
                    value={supplierModal.contactPerson}
                    onChange={(e) =>
                      setSupplierModal((prev) => ({
                        ...prev,
                        contactPerson: e.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>No. WhatsApp / Telepon</label>
                  <input
                    type="text"
                    value={supplierModal.phone}
                    onChange={(e) =>
                      setSupplierModal((prev) => ({ ...prev, phone: e.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Kategori Pasokan</label>
                  <input
                    type="text"
                    value={supplierModal.category}
                    onChange={(e) =>
                      setSupplierModal((prev) => ({ ...prev, category: e.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Termin Pembayaran</label>
                  <select
                    value={supplierModal.paymentTerms}
                    onChange={(e) =>
                      setSupplierModal((prev) => ({
                        ...prev,
                        paymentTerms: e.target.value as any,
                      }))
                    }
                    className={inputClass}
                  >
                    {['COD', 'Transfer', 'TOP 7 Hari', 'TOP 14 Hari', 'TOP 30 Hari'].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Alamat Lengkap</label>
                  <input
                    type="text"
                    value={supplierModal.address}
                    onChange={(e) =>
                      setSupplierModal((prev) => ({ ...prev, address: e.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-500 text-black text-xs font-bold cursor-pointer"
                >
                  Simpan Supplier
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 uppercase text-[11px]">
                  <th className="py-3 px-3">Kode & Nama Supplier</th>
                  <th className="py-3 px-3">PIC & Kontak</th>
                  <th className="py-3 px-3">Kategori</th>
                  <th className="py-3 px-3">Termin & Lead Time</th>
                  <th className="py-3 px-3">Alamat</th>
                  <th className="py-3 px-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {suppliers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-zinc-500">
                      Belum ada data supplier bahan baku. Klik "+ Tambah Supplier Bahan Baku".
                    </td>
                  </tr>
                ) : (
                  suppliers.map((sup) => (
                    <tr key={sup.id} className="hover:bg-zinc-800/30">
                      <td className="py-3 px-3">
                        <div className="font-bold text-sm">{sup.name}</div>
                        <div className="text-[10px] font-mono text-amber-400">{sup.code}</div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-semibold">{sup.contactPerson}</div>
                        <div className="text-[11px] text-zinc-400 flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {sup.phone}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[11px]">
                          {sup.category}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-emerald-400">{sup.paymentTerms}</div>
                        <div className="text-[10px] text-zinc-400">
                          Estimasi {sup.leadTimeDays} hari tiba
                        </div>
                      </td>
                      <td className="py-3 px-3 text-zinc-400">{sup.address}</td>
                      <td className="py-3 px-3 text-right">
                        <div className="inline-flex gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setSupplierModal({
                                open: true,
                                id: sup.id,
                                code: sup.code,
                                name: sup.name,
                                contactPerson: sup.contactPerson,
                                phone: sup.phone,
                                email: sup.email || '',
                                address: sup.address,
                                category: sup.category,
                                leadTimeDays: sup.leadTimeDays,
                                paymentTerms: sup.paymentTerms,
                                notes: sup.notes || '',
                              })
                            }
                            className="p-1.5 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteRawMaterialSupplierFromDb(sup.id)}
                            className="p-1.5 rounded-lg bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
      )}

      {/* ===================================================================== */}
      {/* 4. VIEW: PEMBELIAN BAHAN BAKU (/dashboard/bahan-baku/pembelian)       */}
      {/* ===================================================================== */}
      {activeView === 'pembelian' && (
        <div className={`${cardClass} space-y-5`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4 border-zinc-800">
            <div>
              <h2 className="text-base font-black flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-emerald-400" />
                <span>Pembelian & Pengadaan Bahan Baku</span>
              </h2>
              <p className="text-xs text-zinc-400">
                Catat pembelian bahan baku langsung ke stok gudang atau terbitkan sebagai Purchase Order (PO).
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddPoItem}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Tambah Baris Bahan Baku</span>
            </button>
          </div>

          <form onSubmit={handleSubmitPembelianOrPO} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className={labelClass}>Pilih Supplier</label>
                <select
                  value={poForm.supplierId}
                  onChange={(e) => {
                    const s = suppliers.find((sup) => sup.id === e.target.value);
                    setPoForm((prev) => ({
                      ...prev,
                      supplierId: e.target.value,
                      supplierName: s?.name || prev.supplierName,
                    }));
                  }}
                  className={inputClass}
                >
                  <option value="">-- Pilih Supplier --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>Tanggal Pembelian</label>
                <input
                  type="date"
                  value={poForm.orderDate}
                  onChange={(e) => setPoForm((prev) => ({ ...prev, orderDate: e.target.value }))}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Metode Pembayaran</label>
                <select
                  value={poForm.paymentMethod}
                  onChange={(e) =>
                    setPoForm((prev) => ({ ...prev, paymentMethod: e.target.value as any }))
                  }
                  className={inputClass}
                >
                  <option value="Cash">Cash / Tunai</option>
                  <option value="Transfer">Transfer Bank</option>
                  <option value="Hutang Tempo">Hutang Tempo Supplier</option>
                </select>
              </div>

              <div>
                <label className={labelClass}>Mode Penerimaan Stok</label>
                <select
                  value={poForm.directReceive ? 'DIRECT' : 'PO'}
                  onChange={(e) =>
                    setPoForm((prev) => ({
                      ...prev,
                      directReceive: e.target.value === 'DIRECT',
                    }))
                  }
                  className={inputClass}
                >
                  <option value="DIRECT">Langsung Masuk Stok Gudang Bahan Baku</option>
                  <option value="PO">Simpan Sebagai PO (Terima Nanti)</option>
                </select>
              </div>
            </div>

            {/* Item Rows */}
            <div className="space-y-3">
              {poForm.items.map((item, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/60 items-end"
                >
                  <div className="md:col-span-4">
                    <label className={labelClass}>Bahan Baku</label>
                    <select
                      value={item.rawMaterialId}
                      onChange={(e) => {
                        const found = rawMaterials.find((r) => r.id === e.target.value);
                        if (!found) return;
                        setPoForm((prev) => ({
                          ...prev,
                          items: prev.items.map((it, i) =>
                            i === idx
                              ? {
                                  ...it,
                                  rawMaterialId: found.id,
                                  rawMaterialName: found.name,
                                  sku: found.sku,
                                  unit: found.mainUnit,
                                  buyPrice: found.costPrice,
                                  subtotal: it.qty * found.costPrice,
                                }
                              : it
                          ),
                        }));
                      }}
                      className={inputClass}
                    >
                      <option value="">-- Pilih Bahan Baku --</option>
                      {rawMaterials.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.sku}) — Stok: {r.stock} {r.mainUnit}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className={labelClass}>Qty Beli ({item.unit})</label>
                    <input
                      type="number"
                      min="1"
                      value={item.qty}
                      onChange={(e) => {
                        const q = Math.max(1, Number(e.target.value) || 1);
                        setPoForm((prev) => ({
                          ...prev,
                          items: prev.items.map((it, i) =>
                            i === idx ? { ...it, qty: q, subtotal: q * it.buyPrice } : it
                          ),
                        }));
                      }}
                      className={inputClass}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className={labelClass}>Harga Beli / {item.unit}</label>
                    <input
                      type="number"
                      min="0"
                      value={item.buyPrice}
                      onChange={(e) => {
                        const bp = Math.max(0, Number(e.target.value) || 0);
                        setPoForm((prev) => ({
                          ...prev,
                          items: prev.items.map((it, i) =>
                            i === idx ? { ...it, buyPrice: bp, subtotal: it.qty * bp } : it
                          ),
                        }));
                      }}
                      className={inputClass}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className={labelClass}>Tgl Expired Batch</label>
                    <input
                      type="date"
                      value={item.expiryDate || ''}
                      onChange={(e) =>
                        setPoForm((prev) => ({
                          ...prev,
                          items: prev.items.map((it, i) =>
                            i === idx ? { ...it, expiryDate: e.target.value } : it
                          ),
                        }))
                      }
                      className={inputClass}
                    />
                  </div>

                  <div className="md:col-span-2 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] text-zinc-400">Subtotal</div>
                      <div className="font-mono font-bold text-emerald-400">
                        {formatMoney(item.subtotal)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setPoForm((prev) => ({
                          ...prev,
                          items: prev.items.filter((_, i) => i !== idx),
                        }))
                      }
                      className="p-2 rounded-lg bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-zinc-800">
              <div className="text-sm font-black">
                Total Pembelian:{' '}
                <span className="font-mono text-amber-400">
                  {formatMoney(poForm.items.reduce((s, i) => s + i.subtotal, 0))}
                </span>
              </div>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold cursor-pointer"
              >
                {poForm.directReceive
                  ? 'Proses Pembelian & Tambah Stok Bahan Baku'
                  : 'Terbitkan Purchase Order (PO)'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 5. VIEW: DAFTAR PEMBELIAN / PO (/dashboard/bahan-baku/po)             */}
      {/* ===================================================================== */}
      {activeView === 'po' && (
        <div className={`${cardClass} space-y-4`}>
          <div className="flex items-center justify-between border-b pb-4 border-zinc-800">
            <div>
              <h2 className="text-base font-black flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-400" />
                <span>Daftar Pembelian (PO) Bahan Baku</span>
              </h2>
              <p className="text-xs text-zinc-400">
                Kelola dokumen Purchase Order (PO), penerimaan barang masuk ke gudang bahan baku, dan status pembayaran.
              </p>
            </div>
            <AppLink
              to="/dashboard/bahan-baku/pembelian"
              className="px-4 py-2 rounded-xl bg-amber-500 text-black text-xs font-extrabold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>+ Buat PO Bahan Baku Baru</span>
            </AppLink>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 uppercase text-[11px]">
                  <th className="py-3 px-3">No. PO & Tanggal</th>
                  <th className="py-3 px-3">Supplier</th>
                  <th className="py-3 px-3">Rincian Bahan Baku</th>
                  <th className="py-3 px-3">Total Nilai</th>
                  <th className="py-3 px-3">Status Barang</th>
                  <th className="py-3 px-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {purchaseOrders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-zinc-500">
                      Belum ada dokumen Purchase Order (PO) Bahan Baku.
                    </td>
                  </tr>
                ) : (
                  purchaseOrders.map((po) => (
                    <tr key={po.id} className="hover:bg-zinc-800/30">
                      <td className="py-3 px-3">
                        <div className="font-mono font-bold text-amber-400">{po.poNumber}</div>
                        <div className="text-[11px] text-zinc-400">{po.orderDate}</div>
                      </td>
                      <td className="py-3 px-3 font-bold">{po.supplierName}</td>
                      <td className="py-3 px-3">
                        {po.items.map((it, idx) => (
                          <div key={idx} className="text-[11px] text-zinc-300">
                            • {it.rawMaterialName}: <b>{it.qty}</b> {it.unit}
                          </div>
                        ))}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-emerald-400">
                        {formatMoney(po.totalAmount)}
                        <div className="text-[10px] text-zinc-400">{po.paymentMethod}</div>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                            po.status === 'Received'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {po.status === 'Received' ? 'DITERIMA GUDANG' : 'MENUNGGU KEDATANGAN'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        {po.status !== 'Received' ? (
                          <button
                            type="button"
                            onClick={async () => {
                              await receiveRawMaterialPOInDb(po);
                              showFlash(
                                `PO ${po.poNumber} diterima! Stok bahan baku otomatis bertambah.`
                              );
                            }}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                          >
                            Terima Barang Masuk Stok
                          </button>
                        ) : (
                          <span className="text-[11px] text-emerald-400 font-semibold">
                            ✓ Sudah Masuk Stok ({po.receivedDate})
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 6. VIEW: PERMINTAAN PEMBELIAN / PR (/dashboard/bahan-baku/request)    */}
      {/* ===================================================================== */}
      {activeView === 'request' && (
        <div className="space-y-6">
          <div className={`${cardClass} space-y-4`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4 border-zinc-800">
              <div>
                <h2 className="text-base font-black flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-blue-400" />
                  <span>Permintaan Pembelian (Purchase Request / PR) Bahan Baku</span>
                </h2>
                <p className="text-xs text-zinc-400">
                  Ajukan permintaan pengadaan bahan baku dari tim dapur/gudang untuk disetujui menjadi PO resmi.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleAutoFillCriticalToPr}
                  className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Tarik Otomatis Bahan Baku Kritis</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const first = rawMaterials[0];
                    setPrForm((prev) => ({
                      ...prev,
                      items: [
                        ...prev.items,
                        {
                          rawMaterialId: first?.id || '',
                          rawMaterialName: first?.name || '',
                          sku: first?.sku || '',
                          currentStock: first?.stock || 0,
                          requestedQty: 15,
                          unit: first?.mainUnit || 'Kg',
                          estimatedCost: first?.costPrice || 0,
                          subtotal: 15 * (first?.costPrice || 0),
                          reason: 'Kebutuhan produksi mingguan',
                        },
                      ],
                    }));
                  }}
                  className="px-3.5 py-2 rounded-xl bg-amber-500 text-black text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Tambah Item PR</span>
                </button>
              </div>
            </div>

            {prForm.items.length > 0 && (
              <form onSubmit={handleSubmitPR} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className={labelClass}>Diajukan Oleh</label>
                    <input
                      type="text"
                      value={prForm.requestedBy}
                      onChange={(e) =>
                        setPrForm((prev) => ({ ...prev, requestedBy: e.target.value }))
                      }
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Tingkat Urgensi</label>
                    <select
                      value={prForm.urgency}
                      onChange={(e) =>
                        setPrForm((prev) => ({ ...prev, urgency: e.target.value as any }))
                      }
                      className={inputClass}
                    >
                      <option value="Normal">Normal</option>
                      <option value="High">High (Segera)</option>
                      <option value="Critical">Critical (Darurat Produksi)</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Rekomendasi Supplier</label>
                    <input
                      type="text"
                      placeholder="Nama supplier..."
                      value={prForm.supplierName}
                      onChange={(e) =>
                        setPrForm((prev) => ({ ...prev, supplierName: e.target.value }))
                      }
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  {prForm.items.map((it, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3 rounded-xl border border-zinc-800 bg-zinc-950/60 items-end"
                    >
                      <div className="md:col-span-4">
                        <label className={labelClass}>Bahan Baku</label>
                        <select
                          value={it.rawMaterialId}
                          onChange={(e) => {
                            const found = rawMaterials.find((r) => r.id === e.target.value);
                            if (!found) return;
                            setPrForm((prev) => ({
                              ...prev,
                              items: prev.items.map((row, i) =>
                                i === idx
                                  ? {
                                      ...row,
                                      rawMaterialId: found.id,
                                      rawMaterialName: found.name,
                                      sku: found.sku,
                                      currentStock: found.stock,
                                      unit: found.mainUnit,
                                      estimatedCost: found.costPrice,
                                      subtotal: row.requestedQty * found.costPrice,
                                    }
                                  : row
                              ),
                            }));
                          }}
                          className={inputClass}
                        >
                          <option value="">-- Pilih Bahan Baku --</option>
                          {rawMaterials.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} (Stok: {r.stock} {r.mainUnit})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-2">
                        <label className={labelClass}>Qty Diminta ({it.unit})</label>
                        <input
                          type="number"
                          min="1"
                          value={it.requestedQty}
                          onChange={(e) => {
                            const q = Math.max(1, Number(e.target.value) || 1);
                            setPrForm((prev) => ({
                              ...prev,
                              items: prev.items.map((row, i) =>
                                i === idx
                                  ? { ...row, requestedQty: q, subtotal: q * row.estimatedCost }
                                  : row
                              ),
                            }));
                          }}
                          className={inputClass}
                        />
                      </div>
                      <div className="md:col-span-4">
                        <label className={labelClass}>Alasan Permintaan</label>
                        <input
                          type="text"
                          value={it.reason || ''}
                          onChange={(e) =>
                            setPrForm((prev) => ({
                              ...prev,
                              items: prev.items.map((row, i) =>
                                i === idx ? { ...row, reason: e.target.value } : row
                              ),
                            }))
                          }
                          className={inputClass}
                        />
                      </div>
                      <div className="md:col-span-2 flex items-center justify-between">
                        <span className="font-mono font-bold text-amber-400">
                          {formatMoney(it.subtotal)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPrForm((prev) => ({
                              ...prev,
                              items: prev.items.filter((_, i) => i !== idx),
                            }))
                          }
                          className="p-1.5 rounded-lg bg-rose-600/20 text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold cursor-pointer"
                  >
                    Ajukan Permintaan Pembelian (PR)
                  </button>
                </div>
              </form>
            )}

            {/* Tabel Daftar PR */}
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 uppercase text-[11px]">
                    <th className="py-3 px-3">No. PR & Tanggal</th>
                    <th className="py-3 px-3">Pemohon & Urgensi</th>
                    <th className="py-3 px-3">Daftar Bahan Baku Diminta</th>
                    <th className="py-3 px-3">Estimasi Biaya</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {purchaseRequests.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-zinc-500">
                        Belum ada Permintaan Pembelian (PR) bahan baku.
                      </td>
                    </tr>
                  ) : (
                    purchaseRequests.map((pr) => (
                      <tr key={pr.id} className="hover:bg-zinc-800/30">
                        <td className="py-3 px-3">
                          <div className="font-mono font-bold text-blue-400">{pr.prNumber}</div>
                          <div className="text-[11px] text-zinc-400">{pr.requestDate}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-bold">{pr.requestedBy}</div>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                              pr.urgency === 'Critical'
                                ? 'bg-rose-500/20 text-rose-400'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {pr.urgency}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          {pr.items.map((i, idx) => (
                            <div key={idx} className="text-[11px]">
                              • {i.rawMaterialName}: <b>{i.requestedQty}</b> {i.unit}
                            </div>
                          ))}
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-amber-400">
                          {formatMoney(pr.totalEstimatedCost)}
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-[10px] font-bold">
                            {pr.status}
                          </span>
                          {pr.linkedPoNumber && (
                            <div className="text-[10px] font-mono text-emerald-400 mt-0.5">
                              {pr.linkedPoNumber}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right">
                          {pr.status !== 'Converted_PO' && (
                            <button
                              type="button"
                              onClick={() => handleConvertPrToPo(pr)}
                              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-extrabold cursor-pointer"
                            >
                              Konversi Jadi PO Resmi
                            </button>
                          )}
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

      {/* ===================================================================== */}
      {/* 7. VIEW: AI BAHAN BAKU CONTROLLER (/dashboard/bahan-baku/ai)          */}
      {/* ===================================================================== */}
      {activeView === 'ai' && (
        <div className="space-y-6">
          <div className={`${cardClass} border-purple-500/40 space-y-5`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4 border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
                  <Brain className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-white flex items-center gap-2">
                    <span>AI Bahan Baku & BOM Stock Controller</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      GEMINI AI ENGINE
                    </span>
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Mengontrol stok bahan baku secara cerdas: menganalisis bottleneck resep BOM produk, burn-rate harian, peringatan FEFO, dan membuat PR/PO otomatis.
                  </p>
                </div>
              </div>

              <AiRunControlBar
                featureLabel="AI Bahan Baku"
                enabled={aiBahanBakuControl.enabled}
                isRunning={aiBahanBakuControl.isRunning || aiLoading}
                onToggle={aiBahanBakuControl.toggleEnabled}
                onRun={() => void aiBahanBakuControl.runNow()}
              />
            </div>

            {/* Live BOM Production Capacity Matrix (Always Live from Firestore) */}
            <div className="space-y-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-amber-400">
                Matriks Kapasitas Produksi Produk Berdasarkan Stok Bahan Baku Saat Ini
              </h3>
              {bomProducts.length === 0 ? (
                <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/60 text-xs text-zinc-400">
                  Belum ada produk yang mengaktifkan toggle <b>Bahan Baku: ON</b> di{' '}
                  <AppLink to="/dashboard/produk/tambah" className="text-amber-400 underline">
                    /dashboard/produk/tambah
                  </AppLink>
                  .
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {bomProducts.map((p: any) => {
                    const recipe: any[] = Array.isArray(p.rawMaterialRecipe)
                      ? p.rawMaterialRecipe
                      : [];
                    let minCap = Infinity;
                    let limitingName = '-';
                    for (const r of recipe) {
                      const rm = rawMaterials.find((m) => m.id === r.rawMaterialId);
                      const avail = Number(rm?.stock ?? 0);
                      const req = Number(r.qtyPerUnit || 1);
                      const cap = req > 0 ? Math.floor(avail / req) : 0;
                      if (cap < minCap) {
                        minCap = cap;
                        limitingName = `${r.rawMaterialName} (Stok: ${avail} ${r.unit})`;
                      }
                    }
                    const finalCap = Number.isFinite(minCap) ? minCap : 0;
                    return (
                      <div
                        key={p.id}
                        className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/70 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sm text-white">{p.name}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                              finalCap > 10
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-rose-500/20 text-rose-400'
                            }`}
                          >
                            Maks Produksi: {finalCap} {p.mainUnit || 'Produk'}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-400">
                          Penentu / Bottleneck: <b className="text-amber-300">{limitingName}</b>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Interactive AI Copilot Input */}
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <input
                type="text"
                placeholder="Tanyakan ke AI Bahan Baku (misal: Bahan baku apa yang harus dibeli minggu ini agar produksi aman?)..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleRunAiBahanBaku(aiPrompt);
                  }
                }}
                className={inputClass}
              />
              <button
                type="button"
                disabled={aiLoading}
                onClick={() => handleRunAiBahanBaku(aiPrompt)}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Tanya AI</span>
              </button>
            </div>

            {/* Hasil Analisis AI */}
            {aiReport && (
              <div className="space-y-4 pt-4 border-t border-zinc-800">
                <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase text-purple-300">
                      Ringkasan Eksekutif AI Bahan Baku
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-mono font-bold">
                      Skor Kesehatan Stok: {aiReport.healthScore}/100
                    </span>
                  </div>
                  <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-line">
                    {aiReport.summary}
                  </p>
                </div>

                {Array.isArray(aiReport.recommendations) &&
                  aiReport.recommendations.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-black uppercase text-amber-400">
                          Rekomendasi Restock Bahan Baku oleh AI
                        </h4>
                        <button
                          type="button"
                          onClick={handleCreateAutoPrFromAi}
                          className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-extrabold cursor-pointer"
                        >
                          + Buat Permintaan Pembelian (PR) Otomatis dari Rekomendasi AI
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {aiReport.recommendations.map((rec, i) => (
                          <div
                            key={i}
                            className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/80 space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-sm text-white">
                                {rec.rawMaterialName}
                              </span>
                              <span className="text-xs font-mono font-bold text-amber-400">
                                Order +{rec.suggestedOrderQty} {rec.unit}
                              </span>
                            </div>
                            <div className="text-[11px] text-zinc-400">{rec.reason}</div>
                            <div className="text-[11px] font-mono text-emerald-400">
                              Estimasi Biaya: {formatMoney(rec.estimatedCost)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
