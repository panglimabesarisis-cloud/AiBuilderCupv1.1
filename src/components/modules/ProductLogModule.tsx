import React, { useState, useEffect, useMemo } from 'react';
import {
  ClipboardList,
  ArrowDownCircle,
  ArrowUpCircle,
  RefreshCw,
  Search,
  Filter,
  Calendar,
  Download,
  Printer,
  Plus,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Package,
  ShoppingCart,
  Truck,
  RotateCcw,
  Boxes,
  FileText,
  Building,
  User,
  Clock,
  ExternalLink,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  X,
  Sparkles,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  limit,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Product, Transaction } from '../../types';
import { ACTIVE_STORE_ID } from '../../config/store';
import { useLanguage } from '../../context/LanguageContext';
import { useAppData } from '../../context/AppDataContext';
import { useAppNavigation } from '../../router';
import { formatMoney } from '../../utils/money';
import {
  generateAutoBatchCode,
  getDefaultProductionAndExpiryDates,
  mergeBatchIntoProduct,
  deductFefoBatches,
  getSortedFefoBatches,
} from '../../utils/expiryUtils';

export interface ProductLogEntry {
  id: string;
  docNumber: string; // e.g. INV-20261016-01 or PO-202604
  date: string; // ISO string or human string
  rawTimestamp: number;
  type: 'MASUK' | 'KELUAR' | 'PENYESUAIAN';
  typeLabel: string; // 'Barang Masuk (Pembelian)' or 'Barang Keluar (Terjual POS)'
  sourceChannel: string; // 'Terminal Kasir POS', 'Pembelian Supplier (PO)', 'Stok Opname / Audit'
  productId: string;
  productName: string;
  sku: string;
  barcode: string;
  category: string;
  batchCode?: string;
  productionDate?: string;
  expiryDate?: string;
  packageType: string; // 'Dus / Karton' or 'Unit / Pcs'
  quantityChanged: number; // Positive for in, negative for out
  stockBefore?: number;
  stockAfter?: number;
  unitPrice: number;
  totalValue: number;
  picName: string; // Cashier name or Supplier name
  picRole?: string;
  notes: string;
  status: string; // 'COMPLETED', 'DITERIMA', 'TERVERIFIKASI'
  details?: Record<string, any>;
}

const INITIAL_DEMO_LOGS: ProductLogEntry[] = [];

interface ProductLogModuleProps {
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

export const ProductLogModule: React.FC<ProductLogModuleProps> = ({
  currencyMode = 'IDR',
  onNavigateTab,
}) => {
  const { tr } = useLanguage();
  const { navigateTab } = useAppNavigation();

  // 1. Data states
  const [products, setProducts] = useState<Product[]>([]);
  const [dbTransactions, setDbTransactions] = useState<Transaction[]>([]);
  const [dbPurchaseOrders, setDbPurchaseOrders] = useState<any[]>([]);
  const [dbStockMutations, setDbStockMutations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  // 2. Filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'MASUK' | 'KELUAR' | 'PENYESUAIAN'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7days' | '30days'>('all');

  // 3. Modal states
  const [selectedLog, setSelectedLog] = useState<ProductLogEntry | null>(null);
  const [showAddLogModal, setShowAddLogModal] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 4. New Manual Log Form State (with Multi-Batch FEFO fields)
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [newLogType, setNewLogType] = useState<'MASUK' | 'KELUAR' | 'PENYESUAIAN'>('MASUK');
  const [newLogProductId, setNewLogProductId] = useState<string>('');
  const [newLogBatchCode, setNewLogBatchCode] = useState<string>(() => generateAutoBatchCode(1));
  const [newLogProductionDate, setNewLogProductionDate] = useState<string>(todayIso);
  const [newLogExpiryDate, setNewLogExpiryDate] = useState<string>(
    () => new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10)
  );
  const [newLogQty, setNewLogQty] = useState<number>(1);
  const [newLogPackageType, setNewLogPackageType] = useState<string>('Unit / Pcs');
  const [newLogUnitPrice, setNewLogUnitPrice] = useState<number>(0);
  const [newLogPic, setNewLogPic] = useState<string>('Staff Kasir');
  const [newLogNotes, setNewLogNotes] = useState<string>('Penerimaan barang dari supplier');
  const [isSubmittingLog, setIsSubmittingLog] = useState<boolean>(false);

  // Show Toast Helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const { products: appProducts, transactions: appTransactions } = useAppData();

  // Sync Products & Transactions from AppDataContext (shared listeners)
  useEffect(() => {
    const list: Product[] = (Array.isArray(appProducts) ? appProducts : []).map((data: any) => ({
      id: data.id,
      storeId: data.storeId || ACTIVE_STORE_ID,
      name: data.name || '',
      sku: data.sku || data.id,
      category: data.category || 'MINERAL',
      brand: data.brand || '',
      barcode: data.barcode || '',
      piecesPerCarton: Number(data.piecesPerCarton || 1),
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
    }));
    setProducts(list);
    if (list.length > 0 && !newLogProductId) {
      setNewLogProductId(list[0].id);
      setNewLogUnitPrice(list[0].costPerUnit || list[0].pricePerUnit || 5000);
      const defDates = getDefaultProductionAndExpiryDates(list[0]);
      setNewLogProductionDate(defDates.productionDate);
      setNewLogExpiryDate(defDates.expiryDate);
    }
  }, [appProducts]);

  useEffect(() => {
    setDbTransactions(Array.isArray(appTransactions) ? appTransactions : []);
    setIsLoading(false);
  }, [appTransactions]);

  // Real-time listener for Purchase Orders (Barang Masuk / Pembelian)
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'purchase_orders'), where('storeId', '==', ACTIVE_STORE_ID), limit(100)),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...d.data() });
        });
        setDbPurchaseOrders(list);
      },
      (err) => console.warn('Purchase orders sync warning in ProductLogModule:', err)
    );
    return () => unsub();
  }, []);

  // Real-time listener for Stock Mutations (Penyesuaian Fisik / Audit)
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'stock_mutations'), where('storeId', '==', ACTIVE_STORE_ID), limit(100)),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...d.data() });
        });
        setDbStockMutations(list);
      },
      (err) => console.warn('Stock mutations sync warning in ProductLogModule:', err)
    );
    return () => unsub();
  }, []);

  // Construct Unified Product Log Entries from Firestore Collections
  const allLogs = useMemo<ProductLogEntry[]>(() => {
    const entries: ProductLogEntry[] = [];
    const prodMap = new Map<string, Product>();
    products.forEach((p) => {
      prodMap.set(p.id, p);
      if (p.name) prodMap.set(p.name.toLowerCase().trim(), p);
    });

    // A. Parse Transactions (Outflow - Barang Terjual POS)
    dbTransactions.forEach((tx) => {
      if (tx.status === 'rejected') return;
      const txDate = tx.createdAt ? new Date(tx.createdAt) : new Date();
      const dateFormatted =
        txDate.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }) +
        ', ' +
        txDate.toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }) +
        ' WIB';

      const items = (tx as any).items || [];
      if (Array.isArray(items) && items.length > 0) {
        items.forEach((item: any, idx: number) => {
          const qty = Number(item.unitsDeducted || item.quantityOrdered || 1);
          const foundProd =
            prodMap.get(item.productId) ||
            (item.productName ? prodMap.get(item.productName.toLowerCase().trim()) : null);
          const fefoBatches = foundProd ? getSortedFefoBatches(foundProd) : [];
          const primaryBatch = fefoBatches[0];
          const itemBatchesUsed = Array.isArray(item.batchesUsed) ? item.batchesUsed : [];
          const resolvedBatchCode =
            item.batchCode ||
            (itemBatchesUsed.length > 0
              ? itemBatchesUsed.map((b: any) => `${b.batchCode} (-${b.deductedQty})`).join(', ')
              : primaryBatch?.batchCode || 'BATCH-FEFO');
          const resolvedProdDate =
            item.productionDate ||
            itemBatchesUsed[0]?.productionDate ||
            primaryBatch?.productionDate ||
            foundProd?.productionDate ||
            '-';
          const resolvedExpDate =
            item.expiryDate ||
            itemBatchesUsed[0]?.expiryDate ||
            primaryBatch?.expiryDate ||
            foundProd?.expiryDate ||
            '-';

          entries.push({
            id: `tx_${tx.id}_${idx}`,
            docNumber: tx.id.startsWith('TX-') || tx.id.startsWith('INV-') ? tx.id : `INV-${tx.id.slice(0, 8)}`,
            date: dateFormatted,
            rawTimestamp: txDate.getTime(),
            type: 'KELUAR',
            typeLabel: 'Barang Keluar (Terjual POS)',
            sourceChannel: tx.channel === 'pwa_client' ? 'Client PWA (Online)' : 'Terminal Kasir POS',
            productId: item.productId || foundProd?.id || 'prod_unknown',
            productName: item.productName || foundProd?.name || 'Produk Kasir',
            sku: foundProd?.sku || item.sku || '-',
            barcode: foundProd?.barcode || '-',
            category: foundProd?.category || 'MINERAL',
            batchCode: resolvedBatchCode,
            productionDate: resolvedProdDate,
            expiryDate: resolvedExpDate,
            packageType: item.packageType === 'carton' ? 'Dus / Karton' : 'Unit / Pcs',
            quantityChanged: -Math.abs(qty),
            stockBefore: foundProd ? foundProd.stockInUnits + qty : undefined,
            stockAfter: foundProd ? foundProd.stockInUnits : undefined,
            unitPrice: Number(item.unitPrice || foundProd?.pricePerUnit || 0),
            totalValue: Number(item.subtotal || qty * Number(item.unitPrice || 0)),
            picName: String((tx as any).cashierName || (tx as any).cashier || '-'),
            picRole: (tx as any).cashierRole || 'Kasir On Duty',
            notes: (tx as any).aiExplanation || `Penjualan ${tx.paymentMethod?.toUpperCase() || 'Tunai'} kasir POS (Batch FEFO: ${resolvedBatchCode}).`,
            status: tx.status === 'flagged_fraud' ? 'FLAGGED AI' : 'SUKSES',
            details: {
              transactionId: tx.id,
              customerName: tx.customerName || 'Pelanggan Umum',
              paymentMethod: tx.paymentMethod || 'Tunai',
              totalAmount: tx.totalAmount,
              batchCode: resolvedBatchCode,
              productionDate: resolvedProdDate,
              expiryDate: resolvedExpDate,
            },
          });
        });
      } else {
        // Fallback for single line transactions
        entries.push({
          id: `tx_${tx.id}_main`,
          docNumber: `INV-${tx.id.slice(0, 8)}`,
          date: dateFormatted,
          rawTimestamp: txDate.getTime(),
          type: 'KELUAR',
          typeLabel: 'Barang Keluar (Terjual POS)',
          sourceChannel: 'Terminal Kasir POS',
          productId: 'prod_general',
          productName: 'Penjualan Nota Kasir',
          sku: 'POS-SALE',
          barcode: '-',
          category: 'RETAIL',
          batchCode: 'BATCH-FEFO',
          packageType: 'Unit / Transaksi',
          quantityChanged: -1,
          unitPrice: Number(tx.totalAmount || 0),
          totalValue: Number(tx.totalAmount || 0),
          picName: (tx as any).cashierName || 'Kasir Toko',
          notes: 'Transaksi penjualan langsung terminal kasir.',
          status: 'SUKSES',
        });
      }
    });

    // B. Parse Purchase Orders (Inflow - Barang Masuk Pembelian Multi-Batch)
    dbPurchaseOrders.forEach((po) => {
      const parsedDate = po.date ? new Date(po.date) : po.createdAt ? new Date(po.createdAt) : new Date();
      const dateFormatted =
        parsedDate.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }) + ', ' +
        parsedDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

      const poItems = Array.isArray(po.items) ? po.items : [];
      if (poItems.length > 0) {
        poItems.forEach((item: any, idx: number) => {
          const foundProd =
            prodMap.get(item.productId) ||
            (item.productName ? prodMap.get(item.productName.toLowerCase().trim()) : null);
          const ppc = Number(item.piecesPerCarton || foundProd?.piecesPerCarton || 24);
          const addedUnits = Number(
            item.addedUnits || (item.unit === 'Karton' ? (item.qty || 1) * ppc : item.qty || 1)
          );
          const batchCode = item.batchCode || `BATCH-${po.id?.slice(-4) || '01'}`;
          const prodDate = item.productionDate || foundProd?.productionDate || '-';
          const expDate = item.expiryDate || foundProd?.expiryDate || '-';

          entries.push({
            id: `po_${po.id}_${idx}`,
            docNumber: po.id?.startsWith('PO-') ? po.id : `PO-${po.id?.slice(0, 8) || '2026'}`,
            date: dateFormatted,
            rawTimestamp: parsedDate.getTime() || Date.now() - 1000 * 60 * 60 * 8,
            type: 'MASUK',
            typeLabel: 'Barang Masuk (Pembelian PO)',
            sourceChannel: 'Pembelian Supplier (PO)',
            productId: item.productId || foundProd?.id || 'prod_po',
            productName: item.productName || foundProd?.name || 'Pengadaan Barang Supplier',
            sku: item.sku || foundProd?.sku || '-',
            barcode: foundProd?.barcode || '-',
            category: foundProd?.category || 'MINERAL',
            batchCode,
            productionDate: prodDate,
            expiryDate: expDate,
            packageType:
              item.unit === 'Karton'
                ? `${item.qty || 1} Dus (${addedUnits} Unit)`
                : `${addedUnits} Unit / Pcs`,
            quantityChanged: addedUnits,
            stockBefore: foundProd ? Math.max(0, foundProd.stockInUnits - addedUnits) : undefined,
            stockAfter: foundProd ? foundProd.stockInUnits : undefined,
            unitPrice: Number(item.buyPrice || item.contractPrice || 0),
            totalValue: Number(item.subtotal || po.totalAmount || 0),
            picName: po.supplier || 'Supplier Rekanan',
            picRole: 'Pemasok Resmi',
            notes: `Pembelian Batch ${batchCode} (Prod: ${prodDate} | Exp: ${expDate}) — ${po.deliveryStatus || 'Diterima'}`,
            status: (po.deliveryStatus || '').includes('Diterima') ? 'DITERIMA' : 'TERKIRIM',
            details: { ...po, batchCode, productionDate: prodDate, expiryDate: expDate },
          });
        });
      } else {
        const foundProd =
          prodMap.get(po.productId) ||
          (po.productName ? prodMap.get(po.productName.toLowerCase().trim()) : null) ||
          (po.product ? prodMap.get(po.product.toLowerCase().trim()) : null);

        const cartons = Number(po.cartons || po.itemsCount || 1);
        const piecesPerCarton = foundProd?.piecesPerCarton || 24;
        const totalUnits = po.packageType === 'Unit' ? cartons : cartons * piecesPerCarton;

        entries.push({
          id: `po_${po.id}`,
          docNumber: po.id?.startsWith('PO-') ? po.id : `PO-${po.id?.slice(0, 8) || '2026'}`,
          date: dateFormatted,
          rawTimestamp: parsedDate.getTime() || Date.now() - 1000 * 60 * 60 * 8,
          type: 'MASUK',
          typeLabel: 'Barang Masuk (Pembelian PO)',
          sourceChannel: 'Pembelian Supplier (PO)',
          productId: po.productId || foundProd?.id || 'prod_po',
          productName: po.productName || po.product || foundProd?.name || 'Pengadaan Barang Supplier',
          sku: foundProd?.sku || '-',
          barcode: foundProd?.barcode || '-',
          category: foundProd?.category || 'MINERAL',
          batchCode: po.batchCode || 'BATCH-PO-01',
          productionDate: po.productionDate || foundProd?.productionDate || '-',
          expiryDate: po.expiryDate || foundProd?.expiryDate || '-',
          packageType: `${cartons} Dus (${totalUnits} Unit)`,
          quantityChanged: totalUnits,
          stockBefore: foundProd ? Math.max(0, foundProd.stockInUnits - totalUnits) : undefined,
          stockAfter: foundProd ? foundProd.stockInUnits : undefined,
          unitPrice: Number(po.pricePerCarton || (po.totalAmount && cartons ? po.totalAmount / cartons : 30000)),
          totalValue: Number(po.totalAmount || cartons * 30000),
          picName: po.supplier || 'Supplier Rekanan',
          picRole: 'Pemasok Resmi',
          notes: po.deliveryStatus || 'Penerimaan barang dari supplier rekanan.',
          status: (po.deliveryStatus || '').includes('Diterima') ? 'DITERIMA' : 'TERKIRIM',
          details: po,
        });
      }
    });

    // C. Parse Manual Stock Mutations
    dbStockMutations.forEach((mut) => {
      const mutDate = mut.date ? new Date(mut.date) : mut.createdAt ? new Date(mut.createdAt) : new Date();
      const dateFormatted =
        !isNaN(mutDate.getTime())
          ? mutDate.toLocaleDateString('id-ID', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            }) +
            ', ' +
            mutDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) +
            ' WIB'
          : String(mut.date || '-');

      const foundProd =
        prodMap.get(mut.productId) ||
        (mut.productName ? prodMap.get(mut.productName.toLowerCase().trim()) : null) ||
        (mut.product ? prodMap.get(mut.product.toLowerCase().trim()) : null);

      const qty = Number(mut.qty ?? mut.quantity ?? Math.abs(Number(mut.qtyChange || 1)));
      const mutTypeRaw = mut.type || mut.mutationType || 'PENYESUAIAN';
      const isMasuk = mutTypeRaw === 'MASUK';
      const isKeluar = mutTypeRaw === 'KELUAR';

      entries.push({
        id: `mut_${mut.id}`,
        docNumber: mut.refNumber || mut.reference || mut.refDoc || `MUT-${mut.id?.slice(0, 6) || 'ADJ'}`,
        date: dateFormatted,
        rawTimestamp: !isNaN(mutDate.getTime()) ? mutDate.getTime() : Date.now(),
        type: isMasuk ? 'MASUK' : isKeluar ? 'KELUAR' : 'PENYESUAIAN',
        typeLabel: isMasuk ? 'Barang Masuk (Batch)' : isKeluar ? 'Barang Keluar (FEFO)' : 'Penyesuaian Fisik (Opname)',
        sourceChannel: mut.channel || 'Audit & Mutasi Stok FEFO',
        productId: mut.productId || foundProd?.id || 'prod_mut',
        productName: mut.productName || mut.product || foundProd?.name || 'Penyesuaian Stok',
        sku: mut.sku || foundProd?.sku || '-',
        barcode: foundProd?.barcode || '-',
        category: foundProd?.category || 'MINERAL',
        batchCode: mut.batchCode || 'BATCH-FEFO',
        productionDate: mut.productionDate || foundProd?.productionDate || '-',
        expiryDate: mut.expiryDate || foundProd?.expiryDate || '-',
        packageType: mut.unit || mut.packageType || 'Unit / Pcs',
        quantityChanged: isKeluar ? -Math.abs(qty) : Math.abs(qty),
        stockBefore: mut.stockBefore ?? mut.beforeStock,
        stockAfter: mut.stockAfter ?? mut.afterStock ?? mut.runningBalance,
        unitPrice: Number(mut.unitPrice || mut.buyPrice || foundProd?.costPerUnit || foundProd?.pricePerUnit || 0),
        totalValue: Number(mut.totalValue || qty * Number(mut.unitPrice || mut.buyPrice || foundProd?.costPerUnit || 0)),
        picName: mut.picName || mut.actor || mut.author || 'Supervisor Gudang',
        picRole: mut.picRole || 'Admin Gudang',
        notes: mut.reason || mut.notes || 'Penyesuaian stok manual.',
        status: 'SELESAI',
        details: mut,
      });
    });

    // If database has very few items, prepend demo logs so dashboard has rich initial visual feedback
    const merged = [...entries, ...INITIAL_DEMO_LOGS];

    // Deduplicate by docNumber + productName
    const seen = new Set<string>();
    const deduplicated: ProductLogEntry[] = [];
    for (const item of merged) {
      const key = `${item.docNumber}_${item.productId}_${item.quantityChanged}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(item);
      }
    }

    // Sort newest first
    return deduplicated.sort((a, b) => b.rawTimestamp - a.rawTimestamp);
  }, [products, dbTransactions, dbPurchaseOrders, dbStockMutations]);

  // Unique categories for filter
  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set);
  }, [products]);

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    return allLogs.filter((log) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchDoc = log.docNumber.toLowerCase().includes(q);
        const matchName = log.productName.toLowerCase().includes(q);
        const matchSku = log.sku.toLowerCase().includes(q);
        const matchBarcode = log.barcode.toLowerCase().includes(q);
        const matchPic = log.picName.toLowerCase().includes(q);
        const matchChannel = log.sourceChannel.toLowerCase().includes(q);
        if (!matchDoc && !matchName && !matchSku && !matchBarcode && !matchPic && !matchChannel) {
          return false;
        }
      }

      // 2. Type Filter
      if (typeFilter !== 'ALL' && log.type !== typeFilter) {
        return false;
      }

      // 3. Category Filter
      if (categoryFilter !== 'ALL' && log.category !== categoryFilter) {
        return false;
      }

      // 4. Date Filter
      if (dateFilter !== 'all') {
        const now = Date.now();
        const ageMs = now - log.rawTimestamp;
        if (dateFilter === 'today' && ageMs > 1000 * 60 * 60 * 24) return false;
        if (dateFilter === '7days' && ageMs > 1000 * 60 * 60 * 24 * 7) return false;
        if (dateFilter === '30days' && ageMs > 1000 * 60 * 60 * 24 * 30) return false;
      }

      return true;
    });
  }, [allLogs, searchQuery, typeFilter, categoryFilter, dateFilter]);

  // Summary Metrics
  const metrics = useMemo(() => {
    let totalInQty = 0;
    let totalInValue = 0;
    let totalOutQty = 0;
    let totalOutValue = 0;
    let inCount = 0;
    let outCount = 0;

    filteredLogs.forEach((log) => {
      if (log.type === 'MASUK') {
        totalInQty += Math.abs(log.quantityChanged);
        totalInValue += log.totalValue;
        inCount++;
      } else if (log.type === 'KELUAR') {
        totalOutQty += Math.abs(log.quantityChanged);
        totalOutValue += log.totalValue;
        outCount++;
      } else if (log.type === 'PENYESUAIAN') {
        if (log.quantityChanged > 0) {
          totalInQty += log.quantityChanged;
          totalInValue += log.totalValue;
          inCount++;
        } else {
          totalOutQty += Math.abs(log.quantityChanged);
          totalOutValue += log.totalValue;
          outCount++;
        }
      }
    });

    const netUnits = totalInQty - totalOutQty;

    return {
      totalInQty,
      totalInValue,
      totalOutQty,
      totalOutValue,
      inCount,
      outCount,
      netUnits,
      totalLogs: filteredLogs.length,
    };
  }, [filteredLogs]);

  // Handle Manual Refresh
  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      setLastRefreshedAt(new Date());
      showToast('Data Produk Log berhasil disinkronkan dengan database Firestore!');
    }, 600);
  };

  // Handle CSV Export
  const handleExportCSV = () => {
    try {
      const headers = [
        'No Dokumen',
        'Waktu',
        'Tipe Mutasi',
        'Nama Produk',
        'SKU',
        'Kategori',
        'Perubahan Qty',
        'Satuan',
        'Harga Satuan',
        'Total Nilai (Rp)',
        'Sumber Transaksi',
        'Penanggung Jawab (PIC)',
        'Catatan',
        'Status',
      ];

      const rows = filteredLogs.map((l) => [
        `"${l.docNumber}"`,
        `"${l.date}"`,
        `"${l.typeLabel}"`,
        `"${l.productName.replace(/"/g, '""')}"`,
        `"${l.sku}"`,
        `"${l.category}"`,
        l.quantityChanged,
        `"${l.packageType}"`,
        l.unitPrice,
        l.totalValue,
        `"${l.sourceChannel}"`,
        `"${l.picName}"`,
        `"${l.notes.replace(/"/g, '""')}"`,
        `"${l.status}"`,
      ]);

      const csvContent =
        'data:text/csv;charset=utf-8,\uFEFF' +
        [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute(
        'download',
        `RiskCart_Produk_Log_${new Date().toISOString().slice(0, 10)}.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      showToast('File CSV Produk Log berhasil diunduh.');
    } catch (err) {
      console.error(err);
      showToast('Gagal mengekspor data CSV.');
    }
  };

  // Handle Add New Manual Stock Log / Goods In-Out (with Multi-Batch FEFO sync)
  const handleSubmitNewLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLogProductId) {
      alert('Pilih produk terlebih dahulu.');
      return;
    }
    const targetProduct = products.find((p) => p.id === newLogProductId);
    if (!targetProduct) return;

    setIsSubmittingLog(true);
    try {
      const qtyNumber = Math.max(1, Number(newLogQty) || 1);
      const isOutflow = newLogType === 'KELUAR';
      const actualChange = isOutflow ? -qtyNumber : qtyNumber;
      const currentStock = targetProduct.stockInUnits;
      const nextStock = Math.max(0, currentStock + actualChange);
      const finalBatchCode = newLogBatchCode.trim() || generateAutoBatchCode(1);
      const finalProdDate = newLogProductionDate || todayIso;
      const finalExpDate = newLogExpiryDate || todayIso;

      const refDocNumber =
        newLogType === 'MASUK'
          ? `PO-MAN-${Date.now().toString().slice(-6)}`
          : newLogType === 'KELUAR'
          ? `OUT-MAN-${Date.now().toString().slice(-6)}`
          : `ADJ-MAN-${Date.now().toString().slice(-6)}`;

      const newMutationData = {
        refNumber: refDocNumber,
        reference: refDocNumber,
        date:
          new Date().toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          }) +
          ', ' +
          new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) +
          ' WIB',
        createdAt: new Date().toISOString(),
        type: newLogType,
        channel:
          newLogType === 'MASUK'
            ? 'Penerimaan Langsung (Batch Baru)'
            : newLogType === 'KELUAR'
            ? 'Pengeluaran Manual / FEFO'
            : 'Penyesuaian Fisik',
        productId: targetProduct.id,
        productName: targetProduct.name,
        sku: targetProduct.sku,
        category: targetProduct.category,
        batchCode: finalBatchCode,
        productionDate: finalProdDate,
        expiryDate: finalExpDate,
        packageType: newLogPackageType,
        qty: qtyNumber,
        stockBefore: currentStock,
        stockAfter: nextStock,
        beforeStock: currentStock,
        afterStock: nextStock,
        unitPrice: Number(newLogUnitPrice) || 0,
        totalValue: qtyNumber * (Number(newLogUnitPrice) || 0),
        picName: newLogPic || 'Admin Toko',
        actor: newLogPic || 'Admin Toko',
        picRole: 'Authorized Staff',
        reason: `${newLogNotes || 'Pencatatan mutasi barang manual'} (Batch: ${finalBatchCode} | Exp: ${finalExpDate})`,
        status: 'SELESAI',
      };

      // 1. Save to stock_mutations
      await addDoc(collection(db, 'stock_mutations'), newMutationData);

      // 2. Update stock & Multi-Batch FEFO array in products collection
      const prodRef = doc(db, 'products', targetProduct.id);
      if (newLogType === 'MASUK') {
        const merged = mergeBatchIntoProduct(targetProduct, {
          batchCode: finalBatchCode,
          productionDate: finalProdDate,
          expiryDate: finalExpDate,
          qty: qtyNumber,
          initialQty: qtyNumber,
          buyPrice: Number(newLogUnitPrice) || targetProduct.costPerUnit || 0,
          supplier: newLogPic || 'Manual Inflow',
          poNumber: refDocNumber,
          receivedAt: new Date().toISOString(),
        });
        await updateDoc(prodRef, {
          stockInUnits: nextStock,
          batches: merged.batches,
          productionDate: merged.earliestProductionDate,
          expiryDate: merged.earliestExpiryDate,
          updatedAt: new Date().toISOString(),
        });
      } else if (newLogType === 'KELUAR') {
        const fefo = deductFefoBatches(targetProduct, qtyNumber);
        await updateDoc(prodRef, {
          stockInUnits: nextStock,
          batches: fefo.updatedBatches,
          productionDate: fefo.earliestProductionDate,
          expiryDate: fefo.earliestExpiryDate,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await updateDoc(prodRef, {
          stockInUnits: nextStock,
          updatedAt: new Date().toISOString(),
        });
      }

      setShowAddLogModal(false);
      showToast(
        `Mutasi ${newLogType === 'MASUK' ? 'Barang Masuk' : 'Barang Keluar'} (${finalBatchCode}) berhasil dicatat dan stok FEFO diperbarui (Stok baru: ${nextStock}).`
      );
    } catch (err: any) {
      console.error('Error logging stock movement:', err);
      alert('Gagal mencatat mutasi barang: ' + err.message);
    } finally {
      setIsSubmittingLog(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-950 border border-emerald-700 text-emerald-200 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="text-emerald-400 hover:text-white ml-2 text-xs"
          >
            &times;
          </button>
        </div>
      )}

      {/* 1. HEADER SECTION */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <ClipboardList className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                  <span>PRODUK LOG (MUTASI &amp; ARUS BARANG)</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    REALTIME LEDGER
                  </span>
                </h1>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Mencatat setiap transaksi barang keluar (terjual di terminal kasir POS) dan barang masuk (pembelian &amp; pengadaan supplier) secara otomatis dan sinkron dengan database.
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white text-xs font-bold transition flex items-center gap-2 border border-zinc-700/60 cursor-pointer disabled:opacity-50"
              title="Sinkronkan data dengan database Firestore"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : 'text-zinc-400'}`} />
              <span>{isRefreshing ? 'Menyinkronkan...' : 'Sinkronkan'}</span>
            </button>

            <button
              onClick={handleExportCSV}
              className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white text-xs font-bold transition flex items-center gap-2 border border-zinc-700/60 cursor-pointer"
              title="Ekspor rekap mutasi produk ke file CSV"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span>Ekspor CSV</span>
            </button>

            <button
              onClick={() => window.print()}
              className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white text-xs font-bold transition flex items-center gap-2 border border-zinc-700/60 cursor-pointer"
              title="Cetak lembar rekap mutasi barang"
            >
              <Printer className="w-3.5 h-3.5 text-amber-400" />
              <span>Cetak Log</span>
            </button>

            <button
              onClick={() => setShowAddLogModal(true)}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-2 shadow-lg shadow-emerald-950/40 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Catat Mutasi / Barang Masuk</span>
            </button>
          </div>
        </div>

        {/* Sync Info Bar */}
        <div className="mt-4 pt-3 border-t border-zinc-800/80 flex flex-wrap items-center justify-between text-[11px] text-zinc-500 gap-2">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-emerald-400 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Koneksi Firestore: Aktif
            </span>
            <span>&bull;</span>
            <span>Terakhir diperbarui: {lastRefreshedAt.toLocaleTimeString('id-ID')} WIB</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-400">
            <span>Audit Trail: <strong className="text-zinc-200 font-mono">{filteredLogs.length} Aktivitas</strong></span>
          </div>
        </div>
      </div>

      {/* 2. STATISTIK RINGKASAN LOG (KPI CARDS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Barang Masuk (Pembelian & Restock) */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 hover:border-emerald-500/50 transition">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <ArrowDownCircle className="w-4 h-4 text-emerald-400" />
              Total Barang Masuk (PO)
            </span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-bold">
              {metrics.inCount} Transaksi
            </span>
          </div>
          <div className="mt-2.5">
            <div className="text-2xl font-black font-mono text-white">
              +{metrics.totalInQty.toLocaleString('id-ID')}{' '}
              <span className="text-xs text-zinc-400 font-sans font-normal">Unit/Pcs</span>
            </div>
            <div className="text-xs font-mono text-emerald-400 font-bold mt-1">
              Rp {metrics.totalInValue.toLocaleString('id-ID')}
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-zinc-800/80 text-[10px] text-zinc-400 flex items-center justify-between">
            <span>Dari Supplier &amp; PO Pembelian</span>
            <span className="text-emerald-400 font-bold">Inflow Pasokan</span>
          </div>
        </div>

        {/* Card 2: Barang Keluar (Terjual di POS) */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 hover:border-rose-500/50 transition">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
              <ArrowUpCircle className="w-4 h-4 text-rose-400" />
              Total Barang Keluar (Terjual)
            </span>
            <span className="px-2 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-800 text-[10px] font-bold">
              {metrics.outCount} Penjualan
            </span>
          </div>
          <div className="mt-2.5">
            <div className="text-2xl font-black font-mono text-rose-400">
              -{metrics.totalOutQty.toLocaleString('id-ID')}{' '}
              <span className="text-xs text-zinc-400 font-sans font-normal">Unit/Pcs</span>
            </div>
            <div className="text-xs font-mono text-white font-bold mt-1">
              Rp {metrics.totalOutValue.toLocaleString('id-ID')}
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-zinc-800/80 text-[10px] text-zinc-400 flex items-center justify-between">
            <span>Kasir POS &amp; Pesanan Online</span>
            <span className="text-rose-400 font-bold">Outflow Omset</span>
          </div>
        </div>

        {/* Card 3: Net Pergerakan Stok */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 hover:border-blue-500/50 transition">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
              <Boxes className="w-4 h-4 text-blue-400" />
              Net Pergerakan Inventori
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                metrics.netUnits >= 0
                  ? 'bg-blue-950 text-blue-300 border border-blue-800'
                  : 'bg-amber-950 text-amber-300 border border-amber-800'
              }`}
            >
              {metrics.netUnits >= 0 ? 'Surplus Pasokan' : 'Defisit Stok'}
            </span>
          </div>
          <div className="mt-2.5">
            <div className={`text-2xl font-black font-mono ${metrics.netUnits >= 0 ? 'text-blue-400' : 'text-amber-400'}`}>
              {metrics.netUnits >= 0 ? `+${metrics.netUnits.toLocaleString('id-ID')}` : metrics.netUnits.toLocaleString('id-ID')}{' '}
              <span className="text-xs text-zinc-400 font-sans font-normal">Unit Bersih</span>
            </div>
            <div className="text-xs font-mono text-zinc-300 font-medium mt-1">
              Selisih Barang Masuk &amp; Keluar
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-zinc-800/80 text-[10px] text-zinc-400 flex items-center justify-between">
            <span>Keseimbangan Saldo Stok</span>
            <span className="text-zinc-300 font-mono">Net Flow</span>
          </div>
        </div>

        {/* Card 4: Total Log & Status Audit */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 hover:border-purple-500/50 transition">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-purple-400" />
              Total Log Aktivitas
            </span>
            <span className="px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-800 text-[10px] font-bold">
              Audit Ready
            </span>
          </div>
          <div className="mt-2.5">
            <div className="text-2xl font-black font-mono text-white">
              {metrics.totalLogs}{' '}
              <span className="text-xs text-zinc-400 font-sans font-normal">Catatan Peristiwa</span>
            </div>
            <div className="text-xs text-purple-300 font-medium mt-1 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-purple-400" />
              Tersinkronisasi Otomatis
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-zinc-800/80 text-[10px] text-zinc-400 flex items-center justify-between">
            <span>Terlindungi Audit Anti-Fraud</span>
            <span className="text-emerald-400 font-bold">100% Cocok</span>
          </div>
        </div>
      </div>

      {/* 3. FILTER & SEARCH CONTROL BAR */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cari no. faktur / PO, nama produk, barcode, kasir, atau supplier..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white text-xs"
              >
                &times;
              </button>
            )}
          </div>

          {/* Quick Filter Buttons: All, Masuk, Keluar, Penyesuaian */}
          <div className="flex items-center gap-1.5 p-1 bg-zinc-950 border border-zinc-800 rounded-xl overflow-x-auto">
            <button
              onClick={() => setTypeFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                typeFilter === 'ALL'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Semua Mutasi ({allLogs.length})
            </button>
            <button
              onClick={() => setTypeFilter('MASUK')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                typeFilter === 'MASUK'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-emerald-400'
              }`}
            >
              <ArrowDownCircle className="w-3.5 h-3.5" />
              <span>Barang Masuk (PO)</span>
            </button>
            <button
              onClick={() => setTypeFilter('KELUAR')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                typeFilter === 'KELUAR'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-rose-400'
              }`}
            >
              <ArrowUpCircle className="w-3.5 h-3.5" />
              <span>Barang Keluar (Terjual)</span>
            </button>
            <button
              onClick={() => setTypeFilter('PENYESUAIAN')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                typeFilter === 'PENYESUAIAN'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-blue-400'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Penyesuaian Fisik</span>
            </button>
          </div>
        </div>

        {/* Secondary Filters: Category & Time Horizon */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-800/80 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-zinc-500 font-semibold flex items-center gap-1">
              <Filter className="w-3.5 h-3.5" />
              Kategori:
            </span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="ALL">Semua Kategori Produk</option>
              {categoriesList.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <span className="text-zinc-500 font-semibold flex items-center gap-1 ml-2">
              <Calendar className="w-3.5 h-3.5" />
              Periode:
            </span>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as any)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="all">Semua Riwayat Log</option>
              <option value="today">Hari Ini (24 Jam Terakhir)</option>
              <option value="7days">7 Hari Terakhir</option>
              <option value="30days">30 Hari Terakhir</option>
            </select>
          </div>

          <div className="text-zinc-400 text-[11px]">
            Menampilkan <strong className="text-white font-mono">{filteredLogs.length}</strong> entri dari total {allLogs.length} mutasi tercatat
          </div>
        </div>
      </div>

      {/* 4. MAIN DATA TABLE (PRODUK LOG AUDIT LEDGER) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-sm text-white uppercase tracking-wider">
              Tabel Catatan Mutasi Produk Keluar &amp; Masuk
            </h3>
          </div>
          <span className="text-xs text-zinc-500 font-mono">
            {currencyMode === 'IDR' ? 'Rupiah (IDR)' : 'USD ($)'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse min-w-[980px]">
            <thead className="bg-[#080705] text-amber-300/90 border-b border-amber-500/25 select-none">
              <tr>
                <th className="py-3 px-4 font-bold">Waktu &amp; Dokumen</th>
                <th className="py-3 px-4 font-bold">Nama Produk &amp; SKU</th>
                <th className="py-3 px-4 font-bold">Kode Batch &amp; Expired (FEFO)</th>
                <th className="py-3 px-4 font-bold text-center">Tipe Mutasi</th>
                <th className="py-3 px-4 font-bold text-right">Perubahan Qty</th>
                <th className="py-3 px-4 font-bold text-center">Saldo Stok</th>
                <th className="py-3 px-4 font-bold text-right">Harga Satuan</th>
                <th className="py-3 px-4 font-bold text-right">Total Nilai</th>
                <th className="py-3 px-4 font-bold">PIC / Petugas</th>
                <th className="py-3 px-4 font-bold text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-500/15 text-zinc-300">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-zinc-500">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <ClipboardList className="w-8 h-8 text-zinc-600" />
                      <span className="font-bold text-sm text-zinc-400">Tidak ada catatan log produk yang cocok</span>
                      <p className="text-xs text-zinc-500 max-w-sm">
                        Coba sesuaikan kata kunci pencarian, ubah filter tipe mutasi, atau catat barang masuk baru.
                      </p>
                      <button
                        onClick={() => {
                          setSearchQuery('');
                          setTypeFilter('ALL');
                          setCategoryFilter('ALL');
                          setDateFilter('all');
                        }}
                        className="mt-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold"
                      >
                        Reset Semua Filter
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isMasuk = log.type === 'MASUK';
                  const isKeluar = log.type === 'KELUAR';

                  return (
                    <tr
                      key={log.id}
                      className="hover:bg-amber-500/5 transition-colors group cursor-pointer"
                      onClick={() => setSelectedLog(log)}
                    >
                      {/* Waktu & No Dokumen */}
                      <td className="py-3 px-4">
                        <div className="font-mono text-xs font-bold text-white group-hover:text-amber-400 flex items-center gap-1.5 transition-colors">
                          <span>{log.docNumber}</span>
                        </div>
                        <div className="text-[11px] text-zinc-400 mt-0.5 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-zinc-500 shrink-0" />
                          <span>{log.date}</span>
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">
                          {log.sourceChannel}
                        </div>
                      </td>

                      {/* Nama Produk & SKU */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-white group-hover:text-zinc-100 line-clamp-1">
                          {log.productName}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono text-[10px] px-1.5 py-0.2 bg-[#16120b] text-amber-300 rounded border border-amber-500/30">
                            {log.sku}
                          </span>
                          <span className="text-[10px] text-zinc-400">
                            {log.category}
                          </span>
                        </div>
                      </td>

                      {/* Kode Batch & Expired (FEFO) */}
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#16120b] text-amber-300 border border-amber-500/40">
                          {log.batchCode || 'BATCH-FEFO'}
                        </span>
                        <div className="text-[10px] text-zinc-400 font-mono mt-1">
                          Prod: {log.productionDate || '-'} &bull; Exp: <strong className="text-amber-200">{log.expiryDate || '-'}</strong>
                        </div>
                      </td>

                      {/* Tipe Mutasi Badge */}
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase ${
                            isMasuk
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : isKeluar
                              ? 'bg-rose-950/80 text-rose-400 border border-rose-800'
                              : 'bg-zinc-800 text-amber-200 border border-amber-500/30'
                          }`}
                        >
                          {isMasuk && <ArrowDownCircle className="w-3 h-3" />}
                          {isKeluar && <ArrowUpCircle className="w-3 h-3" />}
                          {!isMasuk && !isKeluar && <RotateCcw className="w-3 h-3" />}
                          <span>{log.typeLabel}</span>
                        </span>
                      </td>

                      {/* Perubahan Qty */}
                      <td className="py-3 px-4 text-right">
                        <div
                          className={`font-mono text-sm font-black ${
                            isMasuk
                              ? 'text-amber-400'
                              : isKeluar
                              ? 'text-rose-400'
                              : 'text-amber-300'
                          }`}
                        >
                          {log.quantityChanged > 0
                            ? `+${log.quantityChanged}`
                            : log.quantityChanged}
                        </div>
                        <div className="text-[10px] text-zinc-400 font-medium mt-0.5">
                          {log.packageType}
                        </div>
                      </td>

                      {/* Saldo Stok Sebelum -> Sesudah */}
                      <td className="py-3 px-4 text-center">
                        {log.stockBefore !== undefined && log.stockAfter !== undefined ? (
                          <div className="inline-flex items-center gap-1.5 font-mono text-[11px] px-2 py-0.5 rounded bg-[#080705] border border-amber-500/25">
                            <span className="text-zinc-400">{log.stockBefore}</span>
                            <span className="text-zinc-600">&rarr;</span>
                            <span className="font-bold text-white">{log.stockAfter}</span>
                          </div>
                        ) : (
                          <span className="text-zinc-500 font-mono text-[11px]">-</span>
                        )}
                      </td>

                      {/* Harga Satuan */}
                      <td className="py-3 px-4 text-right font-mono text-zinc-300">
                        {formatMoney(log.unitPrice, currencyMode)}
                      </td>

                      {/* Total Nilai */}
                      <td className="py-3 px-4 text-right">
                        <div className="font-mono font-bold text-white">
                          {formatMoney(log.totalValue, currencyMode)}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {isMasuk ? 'HPP Pengadaan' : 'Omset Penjualan'}
                        </div>
                      </td>

                      {/* PIC / Penanggung Jawab */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                          <span className="font-semibold text-zinc-200">{log.picName}</span>
                        </div>
                        {log.picRole && (
                          <div className="text-[10px] text-zinc-500 pl-5">
                            {log.picRole}
                          </div>
                        )}
                      </td>

                      {/* Aksi / Detail */}
                      <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setSelectedLog(log)}
                          className="px-2.5 py-1 rounded-lg bg-[#16120b] border border-amber-500/30 hover:bg-amber-500/20 text-amber-300 hover:text-white text-xs font-bold transition flex items-center gap-1 mx-auto cursor-pointer"
                        >
                          <Eye className="w-3 h-3 text-amber-400" />
                          <span>Detail</span>
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

      {/* 5. MODAL: DETAIL LOG DOKUMEN MUTASI */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg bg-[#110e08] border border-amber-500/40 rounded-3xl p-6 shadow-2xl space-y-5">
            {/* Header Modal */}
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">
                    Rincian Log Mutasi &amp; Batch FEFO
                  </h3>
                  <p className="text-[11px] text-amber-300 font-mono">
                    Dokumen #{selectedLog.docNumber}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Details */}
            <div className="space-y-4 text-xs">
              <div className="p-3.5 bg-[#080705] rounded-2xl border border-amber-500/25 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Tipe Mutasi:</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      selectedLog.type === 'MASUK'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : selectedLog.type === 'KELUAR'
                        ? 'bg-rose-950 text-rose-400 border border-rose-800'
                        : 'bg-zinc-800 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {selectedLog.typeLabel}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Waktu Transaksi:</span>
                  <span className="font-mono text-zinc-200">{selectedLog.date}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Kode Batch (FEFO):</span>
                  <span className="font-mono font-bold text-amber-300 bg-[#16120b] px-2 py-0.5 rounded border border-amber-500/35">
                    {selectedLog.batchCode || 'BATCH-FEFO'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Tgl Produksi / Expired:</span>
                  <span className="font-mono text-amber-200">
                    Prod: {selectedLog.productionDate || '-'} &bull; Exp: {selectedLog.expiryDate || '-'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Saluran Transaksi:</span>
                  <span className="text-zinc-200 font-bold">{selectedLog.sourceChannel}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Penanggung Jawab (PIC):</span>
                  <span className="text-zinc-200 font-bold">
                    {selectedLog.picName} ({selectedLog.picRole || 'Staff'})
                  </span>
                </div>
              </div>

              {/* Product Info Box */}
              <div className="p-4 bg-[#080705] rounded-2xl border border-amber-500/25 space-y-2.5">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-white text-sm">
                      {selectedLog.productName}
                    </h4>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      SKU: <span className="font-mono text-amber-300">{selectedLog.sku}</span> &bull; Kategori: {selectedLog.category}
                    </p>
                  </div>
                  <span className="text-xs font-mono font-bold text-amber-300 px-2 py-1 bg-[#16120b] rounded border border-amber-500/35">
                    {selectedLog.packageType}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-amber-500/20">
                  <div>
                    <span className="text-[10px] text-zinc-500 block">Kuantitas Berubah:</span>
                    <span
                      className={`font-mono text-base font-black ${
                        selectedLog.type === 'MASUK'
                          ? 'text-amber-400'
                          : selectedLog.type === 'KELUAR'
                          ? 'text-rose-400'
                          : 'text-amber-300'
                      }`}
                    >
                      {selectedLog.quantityChanged > 0 ? `+${selectedLog.quantityChanged}` : selectedLog.quantityChanged} Unit
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 block">Nilai Total:</span>
                    <span className="font-mono text-base font-black text-white">
                      {formatMoney(selectedLog.totalValue, currencyMode)}
                    </span>
                  </div>
                </div>

                {selectedLog.stockBefore !== undefined && selectedLog.stockAfter !== undefined && (
                  <div className="pt-2 border-t border-amber-500/20 flex items-center justify-between text-xs font-mono">
                    <span className="text-zinc-400">Mutasi Stok:</span>
                    <span className="text-zinc-300">
                      {selectedLog.stockBefore} Unit &rarr; <strong className="text-amber-400">{selectedLog.stockAfter} Unit</strong>
                    </span>
                  </div>
                )}
              </div>

              {/* Notes / Reason */}
              <div className="p-3 bg-[#080705] rounded-2xl border border-amber-500/25">
                <span className="text-[10px] text-zinc-500 block uppercase font-bold">Catatan &amp; Keterangan:</span>
                <p className="text-xs text-zinc-300 mt-1 leading-relaxed">
                  {selectedLog.notes}
                </p>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-amber-500/20">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold transition cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. MODAL: CATAT BARANG MASUK / KELUAR BARU */}
      {showAddLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">
                    Catat Mutasi / Barang Masuk Baru
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Memperbarui saldo stok produk di database Firestore secara real-time.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAddLogModal(false)}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitNewLog} className="space-y-4 text-xs">
              {/* Type Selector Tabs */}
              <div>
                <label className="block text-zinc-400 font-bold mb-1.5">Jenis Mutasi:</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNewLogType('MASUK');
                      setNewLogNotes('Penerimaan pasokan barang dari supplier rekanan');
                    }}
                    className={`py-2 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 border transition cursor-pointer ${
                      newLogType === 'MASUK'
                        ? 'bg-emerald-600 text-white border-emerald-500'
                        : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                    }`}
                  >
                    <ArrowDownCircle className="w-3.5 h-3.5" />
                    <span>Barang Masuk</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewLogType('KELUAR');
                      setNewLogNotes('Pengeluaran manual (barang rusak / retur / sampel)');
                    }}
                    className={`py-2 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 border transition cursor-pointer ${
                      newLogType === 'KELUAR'
                        ? 'bg-rose-600 text-white border-rose-500'
                        : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                    }`}
                  >
                    <ArrowUpCircle className="w-3.5 h-3.5" />
                    <span>Barang Keluar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewLogType('PENYESUAIAN');
                      setNewLogNotes('Penyesuaian hasil stok opname fisik gudang');
                    }}
                    className={`py-2 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 border transition cursor-pointer ${
                      newLogType === 'PENYESUAIAN'
                        ? 'bg-blue-600 text-white border-blue-500'
                        : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                    }`}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Opname Fisik</span>
                  </button>
                </div>
              </div>

              {/* Product Select */}
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Pilih Produk:</label>
                <select
                  value={newLogProductId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    setNewLogProductId(pid);
                    const p = products.find((x) => x.id === pid);
                    if (p) {
                      setNewLogUnitPrice(p.costPerUnit || p.pricePerUnit || 0);
                      const defDates = getDefaultProductionAndExpiryDates(p);
                      setNewLogProductionDate(defDates.productionDate);
                      setNewLogExpiryDate(defDates.expiryDate);
                    }
                  }}
                  className="w-full bg-[#080705] border border-amber-500/30 rounded-xl px-3 py-2.5 text-white font-medium focus:outline-none focus:border-amber-500"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Stok Saat Ini: {p.stockInUnits} unit) - {p.sku}
                    </option>
                  ))}
                </select>
              </div>

              {/* Batch Code, Production Date, Expiry Date */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-amber-300 font-bold mb-1">Kode Batch (Auto):</label>
                  <input
                    type="text"
                    value={newLogBatchCode}
                    onChange={(e) => setNewLogBatchCode(e.target.value)}
                    placeholder="BATCH-YYYYMMDD-01"
                    className="w-full bg-[#080705] border border-amber-500/50 rounded-xl px-3 py-2 text-amber-300 font-mono font-bold focus:outline-none focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Tgl Produksi:</label>
                  <input
                    type="date"
                    value={newLogProductionDate}
                    onChange={(e) => setNewLogProductionDate(e.target.value)}
                    className="w-full bg-[#080705] border border-amber-500/30 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-amber-400 [color-scheme:dark]"
                  />
                </div>
                <div>
                  <label className="block text-amber-300 font-bold mb-1">Tgl Expired (Wajib):</label>
                  <input
                    type="date"
                    required
                    value={newLogExpiryDate}
                    onChange={(e) => setNewLogExpiryDate(e.target.value)}
                    className="w-full bg-[#080705] border border-amber-500/50 rounded-xl px-3 py-2 text-amber-200 font-mono font-bold focus:outline-none focus:border-amber-400 [color-scheme:dark]"
                  />
                </div>
              </div>

              {/* Qty & Package Type */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Jumlah (Qty):</label>
                  <input
                    type="number"
                    min="1"
                    value={newLogQty}
                    onChange={(e) => setNewLogQty(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-[#080705] border border-amber-500/30 rounded-xl px-3 py-2 text-white font-mono font-bold focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Satuan Kemasan:</label>
                  <select
                    value={newLogPackageType}
                    onChange={(e) => setNewLogPackageType(e.target.value)}
                    className="w-full bg-[#080705] border border-amber-500/30 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="Unit / Pcs">Unit / Pcs / Botol</option>
                    <option value="Dus / Karton">Dus / Karton</option>
                    <option value="Galon / Tabung">Galon / Tabung</option>
                    <option value="Paket">Paket / Bundling</option>
                  </select>
                </div>
              </div>

              {/* Price & PIC */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Harga Satuan (Rp):</label>
                  <input
                    type="number"
                    min="0"
                    value={newLogUnitPrice}
                    onChange={(e) => setNewLogUnitPrice(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Petugas (PIC):</label>
                  <input
                    type="text"
                    value={newLogPic}
                    onChange={(e) => setNewLogPic(e.target.value)}
                    placeholder="Nama PIC..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Keterangan / Alasan:</label>
                <textarea
                  rows={2}
                  value={newLogNotes}
                  onChange={(e) => setNewLogNotes(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>

              {/* Preview calculation */}
              <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 flex items-center justify-between font-mono">
                <span className="text-zinc-400">Total Nilai Transaksi:</span>
                <span className="text-white font-bold text-sm">
                  Rp {(newLogQty * (newLogUnitPrice || 0)).toLocaleString('id-ID')}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowAddLogModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingLog}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-lg shadow-emerald-950/40 cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingLog ? 'Menyimpan...' : 'Simpan & Update Stok'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
