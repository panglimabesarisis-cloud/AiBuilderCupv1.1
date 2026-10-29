import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { ACTIVE_STORE_ID } from '../../config/store';
import { Product } from '../../types';
import { productToVariant, ProductVariantItem } from '../../services/productMapper';
import {
  Search,
  Plus,
  Minus,
  Calendar,
  ArrowUpDown,
  X,
  TrendingUp,
  DollarSign,
  ArrowDownRight,
  ArrowUpRight,
  Wallet,
  Activity,
  Layers,
  Eye,
  Edit2,
  Trash2,
  BarChart3,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  BarChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { useAppData } from '../../context/AppDataContext';
import { useLanguage } from '../../context/LanguageContext';
import { fmtMoney, calcTransactionModalAndProfit } from '../../utils/money';
import { openTransactionDetailModal } from '../common/GlobalModals';

interface VaultEntry {
  id: string;
  type: 'income' | 'expense';
  source: string; // e.g. 'Kas Awal Shift', 'Modal Tambahan', 'Operasional Toko'
  description: string; // e.g. 'Kas awal kasir (Admin)'
  amount: number;
  paymentMethod: string;
  date: string; // ISO string
  createdAt?: any;
}

interface CashBookRow {
  id: string;
  timestamp: number;
  dateStr: string;
  nota: string;
  customer: string;
  cashier: string;
  description: string;
  product: string;
  qty: number | '-';
  source: string;
  paymentMethod: string;
  masuk: number;
  keuntungan: number | '-';
  keluar: number;
  saldo: number;
  totalCost: number;
}

export const TransactionStoreDashboard: React.FC = () => {
  const { currencyMode } = useLanguage();
  const { products: ctxProducts, transactions: ctxTransactions } = useAppData();

  // 1. Data states from Firestore (initialized to [] & synced with AppDataContext)
  const [products, setProducts] = useState<ProductVariantItem[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>([]);

  useEffect(() => {
    setProducts(ctxProducts.map((p) => productToVariant(p)));
  }, [ctxProducts]);

  useEffect(() => {
    setTransactions(ctxTransactions);
  }, [ctxTransactions]);

  // 2. Modals state
  const [showIncomeModal, setShowIncomeModal] = useState<boolean>(false);
  const [showExpenseModal, setShowExpenseModal] = useState<boolean>(false);

  // Form states for Pemasukan
  const [incomeSource, setIncomeSource] = useState<string>('Kas Awal Shift');
  const [incomeDesc, setIncomeDesc] = useState<string>('');
  const [incomeAmount, setIncomeAmount] = useState<string>('');
  const [incomeMethod, setIncomeMethod] = useState<string>('Cash');

  // Form states for Pengeluaran
  const [expenseSource, setExpenseSource] = useState<string>('Operasional Toko');
  const [expenseDesc, setExpenseDesc] = useState<string>('');
  const [expenseAmount, setExpenseAmount] = useState<string>('');
  const [expenseMethod, setExpenseMethod] = useState<string>('Cash');

  // 3. Filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('2026-10-01');
  const [endDate, setEndDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [sortAsc, setSortAsc] = useState<boolean>(false); // false = Z-A (newest first)

  // 3b. Action Modals (Lihat Detail, Edit, Hapus)
  const [selectedDetailRow, setSelectedDetailRow] = useState<CashBookRow | null>(null);
  const [editingRow, setEditingRow] = useState<CashBookRow | null>(null);
  const [editDesc, setEditDesc] = useState<string>('');
  const [editAmount, setEditAmount] = useState<string>('');
  const [editMethod, setEditMethod] = useState<string>('Cash');
  const [editCustomer, setEditCustomer] = useState<string>('');

  const handleDeleteRow = async (row: CashBookRow) => {
    try {
      if (row.source === 'Penjualan') {
        await deleteDoc(doc(db, 'transactions', row.id)).catch(() => {});
        await deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', row.id)).catch(() => {});
      } else {
        await deleteDoc(doc(db, 'store_vault_entries', row.id)).catch(() => {});
        await deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'store_vault_entries', row.id)).catch(() => {});
      }
    } catch (e) {
      console.error('Delete row error:', e);
    }
  };

  const handleOpenEdit = (row: CashBookRow) => {
    setEditingRow(row);
    setEditDesc(row.description);
    setEditAmount(String(row.masuk > 0 ? row.masuk : row.keluar));
    setEditMethod(row.paymentMethod);
    setEditCustomer(row.customer !== '-' ? row.customer : '');
  };

  const handleSaveEditRow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRow) return;
    try {
      if (editingRow.source === 'Penjualan') {
        const updatePayload: any = {
          notes: editDesc,
          customerName: editCustomer || 'Umum',
          paymentMethod: editMethod,
          totalAmount: Number(editAmount) || editingRow.masuk,
          totalRevenue: Number(editAmount) || editingRow.masuk,
        };
        await updateDoc(doc(db, 'transactions', editingRow.id), updatePayload).catch(() => {});
        await updateDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', editingRow.id), updatePayload).catch(() => {});
      } else {
        const updatePayload: any = {
          description: editDesc,
          amount: Number(editAmount) || 0,
          paymentMethod: editMethod,
        };
        await updateDoc(doc(db, 'store_vault_entries', editingRow.id), updatePayload).catch(() => {});
        await updateDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'store_vault_entries', editingRow.id), updatePayload).catch(() => {});
      }
      setEditingRow(null);
    } catch (err) {
      console.error('Save edit error:', err);
    }
  };

  // 4. Fetch Products from Firestore and map via productToVariant
  useEffect(() => {
    let unsubRoot: (() => void) | null = null;
    const storeCol = collection(db, 'stores', ACTIVE_STORE_ID, 'products');

    const unsubStore = onSnapshot(
      storeCol,
      (snap) => {
        if (!snap.empty) {
          const list: ProductVariantItem[] = snap.docs.map((d) =>
            productToVariant({ id: d.id, ...d.data() } as Product)
          );
          setProducts(list);
        } else {
          // Fallback to root products with properly retained cleanup
          if (unsubRoot) unsubRoot();
          const rootCol = collection(db, 'products');
          unsubRoot = onSnapshot(
            rootCol,
            (rootSnap) => {
              const list: ProductVariantItem[] = rootSnap.docs.map((d) =>
                productToVariant({ id: d.id, ...d.data() } as Product)
              );
              setProducts(list);
            },
            (err) => console.warn('Root products listener notice:', err)
          );
        }
      },
      (err) => {
        console.warn('Store products subscription notice (retaining existing products):', err);
      }
    );

    return () => {
      unsubStore();
      if (unsubRoot) unsubRoot();
    };
  }, []);

  // Quick lookup map for products by ID, SKU, and lowercase Name
  const productLookup = useMemo(() => {
    const map = new Map<string, ProductVariantItem>();
    products.forEach((p) => {
      if (p.id) map.set(p.id, p);
      if (p.docId) map.set(p.docId, p);
      if (p.sku) map.set(p.sku.toLowerCase(), p);
      if (p.name) map.set(p.name.toLowerCase().trim(), p);
    });
    return map;
  }, [products]);

  // 5. Fetch Transactions from Firestore
  useEffect(() => {
    let unsubRootTx: (() => void) | null = null;
    const storeTxCol = collection(db, 'stores', ACTIVE_STORE_ID, 'transactions');

    const unsub = onSnapshot(
      storeTxCol,
      (snap) => {
        if (!snap.empty) {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setTransactions(list);
        } else {
          // Fallback to root transactions with properly retained cleanup
          if (unsubRootTx) unsubRootTx();
          const rootTxCol = collection(db, 'transactions');
          unsubRootTx = onSnapshot(
            rootTxCol,
            (rootSnap) => {
              const list = rootSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
              setTransactions(list);
            },
            (err) => console.warn('Root tx listener notice:', err)
          );
        }
      },
      (err) => {
        console.warn('Transactions subscription notice (retaining existing transactions):', err);
      }
    );

    return () => {
      unsub();
      if (unsubRootTx) unsubRootTx();
    };
  }, []);

  // 6. Fetch Vault Entries from Firestore (store_vault_entries)
  useEffect(() => {
    let unsubRootVault: (() => void) | null = null;
    const storeVaultCol = collection(db, 'stores', ACTIVE_STORE_ID, 'store_vault_entries');

    const unsub = onSnapshot(
      storeVaultCol,
      (snap) => {
        if (!snap.empty) {
          const list: VaultEntry[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as any),
          }));
          setVaultEntries(list);
        } else {
          if (unsubRootVault) unsubRootVault();
          const rootVaultCol = collection(db, 'store_vault_entries');
          unsubRootVault = onSnapshot(
            rootVaultCol,
            (rootSnap) => {
              const list: VaultEntry[] = rootSnap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as any),
              }));
              setVaultEntries(list);
            },
            (err) => console.warn('Root vault listener notice:', err)
          );
        }
      },
      (err) => {
        console.warn('Vault entries subscription notice (retaining existing entries):', err);
      }
    );

    return () => {
      unsub();
      if (unsubRootVault) unsubRootVault();
    };
  }, []);

  // 7. Save Pemasukan Handler
  const handleSaveIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(incomeAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    const payload = {
      storeId: ACTIVE_STORE_ID,
      type: 'income',
      source: incomeSource,
      description: incomeDesc.trim() || 'Pemasukan Kas',
      amount: amountNum,
      paymentMethod: incomeMethod,
      date: new Date().toISOString(),
      createdAt: serverTimestamp(),
    };

    try {
      await addDoc(collection(db, 'stores', ACTIVE_STORE_ID, 'store_vault_entries'), payload);
      try {
        await addDoc(collection(db, 'store_vault_entries'), payload);
      } catch {}
      setShowIncomeModal(false);
      setIncomeAmount('');
    } catch (err) {
      console.error('Failed to save income entry:', err);
    }
  };

  // 8. Save Pengeluaran Handler
  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(expenseAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    const payload = {
      storeId: ACTIVE_STORE_ID,
      type: 'expense',
      source: expenseSource,
      description: expenseDesc.trim() || 'Pengeluaran Toko',
      amount: amountNum,
      paymentMethod: expenseMethod,
      date: new Date().toISOString(),
      createdAt: serverTimestamp(),
    };

    try {
      await addDoc(collection(db, 'stores', ACTIVE_STORE_ID, 'store_vault_entries'), payload);
      try {
        await addDoc(collection(db, 'store_vault_entries'), payload);
      } catch {}
      setShowExpenseModal(false);
      setExpenseDesc('');
      setExpenseAmount('');
    } catch (err) {
      console.error('Failed to save expense entry:', err);
    }
  };

  // Helper date formatter: DD/MM/YYYY HH:mm
  const formatDateTime = (dateVal: any): string => {
    if (!dateVal) return '-';
    let d: Date;
    if (typeof dateVal === 'string') {
      d = new Date(dateVal);
    } else if (dateVal.toDate) {
      d = dateVal.toDate();
    } else if (dateVal.seconds) {
      d = new Date(dateVal.seconds * 1000);
    } else {
      d = new Date(dateVal);
    }
    if (isNaN(d.getTime())) return String(dateVal);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  };

  // 9. Build unified chronological list of transactions and vault entries
  const allChronologicalRows = useMemo(() => {
    const rawRows: {
      id: string;
      timestamp: number;
      dateStr: string;
      nota: string;
      customer: string;
      cashier: string;
      description: string;
      product: string;
      qty: number | '-';
      source: string;
      paymentMethod: string;
      masuk: number;
      keuntungan: number | '-';
      keluar: number;
      totalCost: number;
    }[] = [];

    // Process Sales Transactions
    transactions.forEach((tx) => {
      // Calculate timestamp
      let ts = Date.now();
      if (tx.createdAt) {
        if (typeof tx.createdAt === 'string') ts = new Date(tx.createdAt).getTime();
        else if (tx.createdAt.seconds) ts = tx.createdAt.seconds * 1000;
        else if (tx.createdAt.toDate) ts = tx.createdAt.toDate().getTime();
      }

      const totalRevenue = Number(tx.totalAmount || tx.subtotal || 0);

      // Compute exact total cost from product lookup
      let txTotalCost = 0;
      let totalQty = 0;
      const productNames: string[] = [];

      if (Array.isArray(tx.items) && tx.items.length > 0) {
        tx.items.forEach((item: any) => {
          const qty = Number(item.quantityOrdered || item.quantity || 1);
          totalQty += qty;

          // Lookup product
          const matchedProd =
            (item.productId && productLookup.get(item.productId)) ||
            (item.sku && productLookup.get(item.sku.toLowerCase())) ||
            (item.productName && productLookup.get(item.productName.toLowerCase().trim()));

          let unitCost = 0;
          if (item.packageType === 'carton') {
            unitCost =
              matchedProd?.costPerCarton ||
              (matchedProd?.costPrice ? matchedProd.costPrice * (matchedProd.itemsPerCarton || 1) : 0) ||
              item.unitCost ||
              0;
          } else {
            unitCost =
              matchedProd?.costPrice ||
              matchedProd?.costPerUnit ||
              item.unitCost ||
              0;
          }

          // If still zero, check if transaction stored unitCost or calculate standard margin
          if (unitCost === 0 && tx.totalCost && totalRevenue > 0) {
            unitCost = (Number(tx.totalCost) / totalRevenue) * (item.unitPrice || 0);
          }

          txTotalCost += unitCost * qty;
          if (item.productName) productNames.push(item.productName);
        });
      } else {
        totalQty = 1;
        productNames.push('Produk Retail');
        txTotalCost = Number(tx.totalCost || 0);
      }

      // If txTotalCost was recorded in tx doc and valid, consider that as well
      if (tx.totalCost && Number(tx.totalCost) > 0 && txTotalCost === 0) {
        txTotalCost = Number(tx.totalCost);
      }
      if (txTotalCost === 0 && ctxProducts.length > 0) {
        txTotalCost = calcTransactionModalAndProfit(tx, ctxProducts).modal;
      }

      // Exact Keuntungan = Total Nilai - Modal
      const keuntungan = totalRevenue - txTotalCost;

      const notaLabel = tx.id ? (tx.id.startsWith('POS') ? tx.id : `POS${tx.id.slice(-6).toUpperCase()}`) : 'POS-161026';
      const productNameSummary = productNames.length > 0 ? productNames[0] + (productNames.length > 1 ? ` (+${productNames.length - 1})` : '') : 'Produk Retail';

      rawRows.push({
        id: tx.id || `tx-${ts}`,
        timestamp: ts,
        dateStr: formatDateTime(tx.createdAt || ts),
        nota: notaLabel,
        customer: tx.customerName || 'Umum',
        cashier: tx.cashierName || (tx.channel === 'pwa' ? 'Client PWA' : 'Admin Utama (Owner)'),
        description: 'Penjualan',
        product: productNameSummary,
        qty: totalQty || 1,
        source: 'Penjualan',
        paymentMethod: (tx.paymentMethod || 'cash').toUpperCase(),
        masuk: totalRevenue,
        keuntungan: keuntungan,
        keluar: 0,
        totalCost: txTotalCost,
      });
    });

    // Process Vault Entries (Pemasukan & Pengeluaran)
    vaultEntries.forEach((entry) => {
      let ts = Date.now();
      if (entry.date) ts = new Date(entry.date).getTime();
      else if (entry.createdAt?.seconds) ts = entry.createdAt.seconds * 1000;

      const isIncome = entry.type === 'income';
      rawRows.push({
        id: entry.id,
        timestamp: ts,
        dateStr: formatDateTime(entry.date || ts),
        nota: '-',
        customer: '-',
        cashier: (entry as any).cashierName || 'Kasir / Admin',
        description: entry.description || (isIncome ? 'Pemasukan Kas' : 'Pengeluaran Toko'),
        product: '-',
        qty: '-',
        source: entry.source || (isIncome ? 'Kas Awal Shift' : 'Pengeluaran Toko'),
        paymentMethod: (entry.paymentMethod || 'cash').toUpperCase(),
        masuk: isIncome ? entry.amount : 0,
        keuntungan: '-',
        keluar: isIncome ? 0 : entry.amount,
        totalCost: 0,
      });
    });

    // Sort strictly chronological (oldest to newest) to compute Running Saldo
    rawRows.sort((a, b) => a.timestamp - b.timestamp);

    let running = 0;
    const computedRows: CashBookRow[] = rawRows.map((r) => {
      running += r.masuk - r.keluar;
      return {
        ...r,
        saldo: running,
      };
    });

    return computedRows;
  }, [transactions, vaultEntries, productLookup]);

  // 10. Filtered rows based on Search, Date range, and Sort
  const filteredRows = useMemo(() => {
    let result = allChronologicalRows.filter((row) => {
      // Date filtering
      if (startDate) {
        const startTs = new Date(startDate + 'T00:00:00').getTime();
        if (row.timestamp < startTs) return false;
      }
      if (endDate) {
        const endTs = new Date(endDate + 'T23:59:59').getTime();
        if (row.timestamp > endTs) return false;
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matches =
          row.nota.toLowerCase().includes(q) ||
          row.customer.toLowerCase().includes(q) ||
          row.cashier.toLowerCase().includes(q) ||
          row.description.toLowerCase().includes(q) ||
          row.product.toLowerCase().includes(q) ||
          row.source.toLowerCase().includes(q) ||
          row.paymentMethod.toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });

    // Sorting order
    if (!sortAsc) {
      // Newest first (Z - A)
      result = [...result].sort((a, b) => b.timestamp - a.timestamp);
    } else {
      // Oldest first (A - Z)
      result = [...result].sort((a, b) => a.timestamp - b.timestamp);
    }

    return result;
  }, [allChronologicalRows, searchQuery, startDate, endDate, sortAsc]);

  // 11. KPI Computations across current data
  const { totalSales, totalProfit, totalIncome, totalExpense, vaultBalance, totalKasAwal, totalModal } = useMemo(() => {
    let sales = 0;
    let profit = 0;
    let income = 0;
    let expense = 0;
    let kasAwal = 0;
    let cogs = 0;

    allChronologicalRows.forEach((r) => {
      if (r.source === 'Penjualan') {
        sales += r.masuk;
        if (typeof r.keuntungan === 'number') {
          profit += r.keuntungan;
        }
        cogs += r.totalCost;
      } else if (r.masuk > 0) {
        income += r.masuk;
        if (r.source === 'Kas Awal Shift' || r.description.toLowerCase().includes('kas awal')) {
          kasAwal += r.masuk;
        }
      }
      if (r.keluar > 0) {
        expense += r.keluar;
      }
    });

    const balance = sales + income - expense;
    return {
      totalSales: sales,
      totalProfit: profit,
      totalIncome: income,
      totalExpense: expense,
      vaultBalance: balance,
      totalKasAwal: kasAwal,
      totalModal: cogs,
    };
  }, [allChronologicalRows]);

  // Filtered Totals for Table Footer
  const footerTotals = useMemo(() => {
    let sumQty = 0;
    let sumModal = 0;
    let sumMasuk = 0;
    let sumKeuntungan = 0;
    let sumKeluar = 0;

    filteredRows.forEach((r) => {
      if (typeof r.qty === 'number') sumQty += r.qty;
      sumModal += r.totalCost || 0;
      sumMasuk += r.masuk;
      if (typeof r.keuntungan === 'number') sumKeuntungan += r.keuntungan;
      sumKeluar += r.keluar;
    });

    const finalSaldo = filteredRows.length > 0 ? filteredRows[0].saldo : vaultBalance;

    return {
      qty: sumQty,
      modal: sumModal,
      masuk: sumMasuk,
      keuntungan: sumKeuntungan,
      keluar: sumKeluar,
      saldo: finalSaldo,
    };
  }, [filteredRows, vaultBalance]);

  // 12. Chart Data Aggregation (grouped by date)
  const chartData = useMemo(() => {
    const dateMap = new Map<
      string,
      {
        dateStr: string;
        timestamp: number;
        penjualan: number;
        modal: number;
        pengeluaran: number;
        keuntungan: number;
        totalUang: number;
      }
    >();

    // Sort chronologically for running balance in chart
    const chronological = [...allChronologicalRows].sort((a, b) => a.timestamp - b.timestamp);

    chronological.forEach((row) => {
      const d = new Date(row.timestamp);
      const dateKey = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, {
          dateStr: dateKey,
          timestamp: row.timestamp,
          penjualan: 0,
          modal: 0,
          pengeluaran: 0,
          keuntungan: 0,
          totalUang: row.saldo,
        });
      }

      const entry = dateMap.get(dateKey)!;
      if (row.source === 'Penjualan') {
        entry.penjualan += row.masuk;
        if (typeof r_keuntungan(row.keuntungan)) {
          entry.keuntungan += Number(row.keuntungan);
        }
        entry.modal += row.totalCost;
      }
      if (row.keluar > 0) {
        entry.pengeluaran += row.keluar;
      }
      entry.totalUang = row.saldo; // End of day balance
    });

    function r_keuntungan(v: any): boolean {
      return typeof v === 'number';
    }

    const points = Array.from(dateMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    // If only 1 point, add baseline for visual rendering
    if (points.length === 1) {
      return points;
    }
    return points;
  }, [allChronologicalRows]);

  const [topChartMode, setTopChartMode] = useState<'area_bar' | 'area' | 'bar'>('area_bar');

  // Full-width Area & Bar Chart dataset (Total Nilai, Modal, Keuntungan)
  const areaBarChartData = useMemo(() => {
    if (chartData.length === 0) {
      const today = new Date();
      const label = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
      return [
        {
          dateStr: ' Awal',
          totalNilai: 0,
          modal: 0,
          keuntungan: 0,
        },
        {
          dateStr: label,
          totalNilai: totalSales,
          modal: totalModal,
          keuntungan: totalProfit,
        },
      ];
    }

    const mapped = chartData.map((pt) => ({
      dateStr: pt.dateStr,
      totalNilai: pt.penjualan,
      modal: pt.modal,
      keuntungan: pt.keuntungan,
    }));

    if (mapped.length === 1) {
      return [
        {
          dateStr: 'Awal',
          totalNilai: 0,
          modal: 0,
          keuntungan: 0,
        },
        ...mapped,
      ];
    }

    return mapped;
  }, [chartData, totalSales, totalModal, totalProfit]);

  // Max value for chart Y scaling
  const chartMaxVal = useMemo(() => {
    let max = 340000;
    chartData.forEach((p) => {
      max = Math.max(max, p.totalUang, p.penjualan, p.modal, p.pengeluaran, p.keuntungan);
    });
    return Math.ceil(max * 1.15);
  }, [chartData]);

  return (
    <div className="space-y-6">
      {/* 1. Header with Real-Time Feed Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-zinc-900">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-white tracking-tight">Transactions Store</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Real-Time Feed
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Real-time tracking, and automated carton conversion audit.
          </p>
        </div>
      </div>

      {/* 2. Main Brangkas Toko Container */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 sm:p-6 space-y-6 shadow-2xl">
        {/* Title & Action Buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">Brangkas Toko</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Kas awal kasir, seluruh transaksi POS &amp; PWA, pemasukan, dan pengeluaran toko.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowIncomeModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/40 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Pemasukan</span>
            </button>
            <button
              onClick={() => setShowExpenseModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold shadow-lg shadow-rose-950/40 transition cursor-pointer"
            >
              <Minus className="w-4 h-4" />
              <span>- Pengeluaran</span>
            </button>
          </div>
        </div>

        {/* 3. 6 KPI Cards: Modal | Keuntungan | Total Nilai | Pemasukan | Pengeluaran | Saldo */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-3.5 space-y-1">
            <span className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase block">
              MODAL
            </span>
            <div className="text-lg font-black text-zinc-200 font-mono">
              {fmtMoney(totalModal, currencyMode)}
            </div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-3.5 space-y-1">
            <span className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase block">
              KEUNTUNGAN
            </span>
            <div className="text-lg font-black text-emerald-400 font-mono">
              {fmtMoney(totalProfit, currencyMode)}
            </div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-3.5 space-y-1">
            <span className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase block">
              TOTAL NILAI
            </span>
            <div className="text-lg font-black text-white font-mono">
              {fmtMoney(totalSales, currencyMode)}
            </div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-3.5 space-y-1">
            <span className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase block">
              PEMASUKAN (KAS AWAL &amp; LAIN)
            </span>
            <div className="text-lg font-black text-white font-mono">
              {fmtMoney(totalIncome, currencyMode)}
            </div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-3.5 space-y-1">
            <span className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase block">
              PENGELUARAN
            </span>
            <div className="text-lg font-black text-white font-mono">
              {fmtMoney(totalExpense, currencyMode)}
            </div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-3.5 space-y-1">
            <span className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase block">
              SALDO BRANGKAS TOKO
            </span>
            <div className="text-lg font-black text-white font-mono">
              {fmtMoney(vaultBalance, currencyMode)}
            </div>
          </div>
        </div>

        {/* 3b. Full-Width Area & Bar Chart: Total Nilai, Modal, Keuntungan */}
        <div className="w-full bg-zinc-950/80 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-zinc-800/80 pb-3.5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                <BarChart3 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-black text-white tracking-tight">
                  Grafik Area &amp; Bar — Total Nilai, Modal &amp; Keuntungan
                </h3>
                <p className="text-[11px] text-zinc-400">
                  Perbandingan real-time Total Nilai Penjualan, HPP Modal, dan Keuntungan Bersih
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Summary Badges */}
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300">
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  <span className="text-zinc-400 font-sans">Total Nilai:</span>
                  <span className="font-bold text-white">{fmtMoney(totalSales, currencyMode)}</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-zinc-400 font-sans">Modal:</span>
                  <span className="font-bold text-amber-300">{fmtMoney(totalModal, currencyMode)}</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-zinc-400 font-sans">Keuntungan:</span>
                  <span className="font-bold text-emerald-400">{fmtMoney(totalProfit, currencyMode)}</span>
                </div>
              </div>

              {/* Mode Switcher: Area+Bar | Area | Bar */}
              <div className="inline-flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-0.5 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setTopChartMode('area_bar')}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                    topChartMode === 'area_bar'
                      ? 'bg-amber-500 text-zinc-950 shadow'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Area + Bar
                </button>
                <button
                  type="button"
                  onClick={() => setTopChartMode('area')}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                    topChartMode === 'area'
                      ? 'bg-amber-500 text-zinc-950 shadow'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Area
                </button>
                <button
                  type="button"
                  onClick={() => setTopChartMode('bar')}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                    topChartMode === 'bar'
                      ? 'bg-amber-500 text-zinc-950 shadow'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Bar
                </button>
              </div>
            </div>
          </div>

          <div className="w-full h-72 pt-1">
            <ResponsiveContainer width="100%" height="100%">
              {topChartMode === 'area' ? (
                <AreaChart data={areaBarChartData} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="txStoreTotalNilaiGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="txStoreModalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="txStoreKeuntunganGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis
                    dataKey="dateStr"
                    stroke="#71717a"
                    tick={{ fill: '#a1a1aa', fontSize: 11 }}
                    axisLine={{ stroke: '#3f3f46' }}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#71717a"
                    tick={{ fill: '#a1a1aa', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) =>
                      v >= 1000000
                        ? `${(v / 1000000).toFixed(1)}jt`
                        : v >= 1000
                        ? `${Math.round(v / 1000)}rb`
                        : String(v)
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#09090b',
                      borderColor: '#27272a',
                      borderRadius: '12px',
                      fontSize: '12px',
                      color: '#fff',
                    }}
                    formatter={(value: any, name: any) => [
                      fmtMoney(Number(value) || 0, currencyMode),
                      name,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                  <Area
                    type="monotone"
                    dataKey="totalNilai"
                    name="Total Nilai"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    fill="url(#txStoreTotalNilaiGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="modal"
                    name="Modal"
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    fill="url(#txStoreModalGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="keuntungan"
                    name="Keuntungan"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    fill="url(#txStoreKeuntunganGrad)"
                  />
                </AreaChart>
              ) : topChartMode === 'bar' ? (
                <BarChart data={areaBarChartData} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis
                    dataKey="dateStr"
                    stroke="#71717a"
                    tick={{ fill: '#a1a1aa', fontSize: 11 }}
                    axisLine={{ stroke: '#3f3f46' }}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#71717a"
                    tick={{ fill: '#a1a1aa', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) =>
                      v >= 1000000
                        ? `${(v / 1000000).toFixed(1)}jt`
                        : v >= 1000
                        ? `${Math.round(v / 1000)}rb`
                        : String(v)
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#09090b',
                      borderColor: '#27272a',
                      borderRadius: '12px',
                      fontSize: '12px',
                      color: '#fff',
                    }}
                    formatter={(value: any, name: any) => [
                      fmtMoney(Number(value) || 0, currencyMode),
                      name,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                  <Bar dataKey="totalNilai" name="Total Nilai" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={36} />
                  <Bar dataKey="modal" name="Modal" fill="#f59e0b" radius={[6, 6, 0, 0]} maxBarSize={36} />
                  <Bar dataKey="keuntungan" name="Keuntungan" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={36} />
                </BarChart>
              ) : (
                <ComposedChart data={areaBarChartData} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="txStoreCombinedTotalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="txStoreCombinedModalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="txStoreCombinedProfitGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis
                    dataKey="dateStr"
                    stroke="#71717a"
                    tick={{ fill: '#a1a1aa', fontSize: 11 }}
                    axisLine={{ stroke: '#3f3f46' }}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#71717a"
                    tick={{ fill: '#a1a1aa', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) =>
                      v >= 1000000
                        ? `${(v / 1000000).toFixed(1)}jt`
                        : v >= 1000
                        ? `${Math.round(v / 1000)}rb`
                        : String(v)
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#09090b',
                      borderColor: '#27272a',
                      borderRadius: '12px',
                      fontSize: '12px',
                      color: '#fff',
                    }}
                    formatter={(value: any, name: any) => [
                      fmtMoney(Number(value) || 0, currencyMode),
                      name,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                  <Bar
                    dataKey="totalNilai"
                    name="Total Nilai (Bar)"
                    fill="#3b82f6"
                    fillOpacity={0.45}
                    radius={[6, 6, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="modal"
                    name="Modal (Bar)"
                    fill="#f59e0b"
                    fillOpacity={0.45}
                    radius={[6, 6, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="keuntungan"
                    name="Keuntungan (Bar)"
                    fill="#10b981"
                    fillOpacity={0.45}
                    radius={[6, 6, 0, 0]}
                    maxBarSize={28}
                  />
                  <Area
                    type="monotone"
                    dataKey="totalNilai"
                    name="Total Nilai"
                    stroke="#60a5fa"
                    strokeWidth={2.5}
                    fill="url(#txStoreCombinedTotalGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="modal"
                    name="Modal"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    fill="url(#txStoreCombinedModalGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="keuntungan"
                    name="Keuntungan"
                    stroke="#34d399"
                    strokeWidth={2.5}
                    fill="url(#txStoreCombinedProfitGrad)"
                  />
                </ComposedChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        {/* 4. Filter Bar */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <input
              type="text"
              placeholder="Cari data..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-3 pr-8 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
            <Search className="w-4 h-4 text-zinc-500 absolute right-2.5 top-2.5 pointer-events-none" />
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5">
              <span className="text-[11px] text-zinc-500 font-semibold">Dari</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent text-white focus:outline-none text-xs [color-scheme:dark]"
              />
            </div>

            <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5">
              <span className="text-[11px] text-zinc-500 font-semibold">Sampai</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent text-white focus:outline-none text-xs [color-scheme:dark]"
              />
            </div>
          </div>

          {/* Sort Button */}
          <button
            onClick={() => setSortAsc((prev) => !prev)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-950/40 border border-blue-500/40 text-blue-400 font-bold hover:bg-blue-900/50 transition cursor-pointer"
            title="Toggle urutan tanggal"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            <span>{sortAsc ? 'A - Z' : 'Z - A'}</span>
          </button>
        </div>

        {/* 5. Unified Cash Book Table */}
        <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/60">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-3 font-semibold">Tanggal</th>
                  <th className="py-3 px-3 font-semibold">Nota</th>
                  <th className="py-3 px-3 font-semibold">Pelanggan</th>
                  <th className="py-3 px-3 font-semibold">Kasir</th>
                  <th className="py-3 px-3 font-semibold">Keterangan</th>
                  <th className="py-3 px-3 font-semibold">Produk</th>
                  <th className="py-3 px-3 font-semibold text-center">Qty</th>
                  <th className="py-3 px-3 font-semibold">Sumber</th>
                  <th className="py-3 px-3 font-semibold text-center">Metode</th>
                  <th className="py-3 px-3 font-semibold text-right">Modal</th>
                  <th className="py-3 px-3 font-semibold text-right">Keuntungan</th>
                  <th className="py-3 px-3 font-semibold text-right">Total Nilai</th>
                  <th className="py-3 px-3 font-semibold text-right">Keluar</th>
                  <th className="py-3 px-3 font-semibold text-right">Saldo</th>
                  <th className="py-3 px-3 font-semibold text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="py-8 text-center text-zinc-500">
                      Tidak ada transaksi ditemukan untuk filter ini.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const handleRowInspect = () => {
                      if (row.source === 'Penjualan') {
                        const fullTx = transactions.find((t) => t.id === row.id);
                        openTransactionDetailModal(fullTx || row, 'SALE');
                      } else if (row.keluar > 0) {
                        const fullVault = vaultEntries.find((v) => v.id === row.id);
                        openTransactionDetailModal({ ...row, ...(fullVault || {}), amount: row.keluar }, 'CASH_OUT');
                      } else {
                        const fullVault = vaultEntries.find((v) => v.id === row.id);
                        openTransactionDetailModal({ ...row, ...(fullVault || {}), amount: row.masuk }, 'CASH_IN');
                      }
                    };
                    return (
                    <tr key={row.id} onClick={handleRowInspect} className="hover:bg-zinc-900/50 transition cursor-pointer">
                      <td className="py-2.5 px-3 text-zinc-400 font-mono text-[11px]">{row.dateStr}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-amber-400 font-bold hover:underline">{row.nota}</td>
                      <td className="py-2.5 px-3 text-zinc-300">{row.customer}</td>
                      <td className="py-2.5 px-3 text-blue-400 font-semibold">{row.cashier}</td>
                      <td className="py-2.5 px-3 text-zinc-300">{row.description}</td>
                      <td className="py-2.5 px-3 text-white font-medium">{row.product}</td>
                      <td className="py-2.5 px-3 text-center font-mono">
                        {row.qty === '-' ? '-' : row.qty}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-zinc-200">{row.source}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800">
                          {row.paymentMethod}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-zinc-300 font-semibold">
                        {row.source === 'Penjualan' ? fmtMoney(row.totalCost || 0, currencyMode) : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-emerald-400 font-bold">
                        {typeof row.keuntungan === 'number'
                          ? fmtMoney(row.keuntungan, currencyMode)
                          : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-white font-bold">
                        {row.masuk > 0 ? fmtMoney(row.masuk, currencyMode) : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-rose-400 font-bold">
                        {row.keluar > 0 ? fmtMoney(row.keluar, currencyMode) : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-white font-bold">
                        {fmtMoney(row.saldo, currencyMode)}
                      </td>
                      <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={handleRowInspect}
                            className="p-1 rounded bg-amber-950/60 border border-amber-700/60 text-amber-400 hover:text-white hover:bg-amber-800 transition cursor-pointer"
                            title="Lihat Detail & Fulfillment"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleOpenEdit(row)}
                            className="p-1 rounded bg-amber-950/60 border border-amber-800 text-amber-400 hover:text-white hover:bg-amber-800 transition cursor-pointer"
                            title="Edit Data"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteRow(row)}
                            className="p-1 rounded bg-rose-950/60 border border-rose-800 text-rose-400 hover:text-white hover:bg-rose-800 transition cursor-pointer"
                            title="Hapus Data"
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
              {/* Footer Total */}
              <tfoot className="bg-zinc-950 text-white font-bold border-t-2 border-zinc-800">
                <tr>
                  <td colSpan={6} className="py-3 px-3 text-white">
                    Total
                  </td>
                  <td className="py-3 px-3 text-center font-mono text-white">
                    {footerTotals.qty}
                  </td>
                  <td colSpan={2} className="py-3 px-3" />
                  <td className="py-3 px-3 text-right font-mono text-zinc-300">
                    {fmtMoney(footerTotals.modal, currencyMode)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-emerald-400">
                    {fmtMoney(footerTotals.keuntungan, currencyMode)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-white">
                    {fmtMoney(footerTotals.masuk, currencyMode)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-rose-400">
                    {fmtMoney(footerTotals.keluar, currencyMode)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-white">
                    {fmtMoney(footerTotals.saldo, currencyMode)}
                  </td>
                  <td className="py-3 px-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 6. Bottom Section: 2 Columns (Rekapan & Grafik Brangkas Toko) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-2">
          {/* Left Column: Rekapan (approx 4 of 12 cols) */}
          <div className="lg:col-span-4 bg-zinc-950/80 border border-zinc-800 rounded-2xl p-5 space-y-4 flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">Rekapan</h3>
              <div className="space-y-3 pt-4 text-xs">
                <div className="flex items-center justify-between text-zinc-400">
                  <span>Kas Awal Shift</span>
                  <span className="font-mono text-white font-bold">
                    {fmtMoney(totalKasAwal, currencyMode)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-zinc-400">
                  <span>Modal</span>
                  <span className="font-mono text-zinc-200 font-bold">
                    {fmtMoney(totalModal, currencyMode)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-zinc-400">
                  <span>Keuntungan</span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {fmtMoney(totalProfit, currencyMode)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-zinc-400">
                  <span>Total Nilai</span>
                  <span className="font-mono text-white font-bold">
                    {fmtMoney(totalSales, currencyMode)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-zinc-400">
                  <span>Total Pengeluaran</span>
                  <span className="font-mono text-white font-bold">
                    {fmtMoney(totalExpense, currencyMode)}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-zinc-800/80 flex items-center justify-between">
              <span className="text-sm font-bold text-white">Total Uang</span>
              <span className="text-base font-black text-white font-mono">
                {fmtMoney(vaultBalance, currencyMode)}
              </span>
            </div>
          </div>

          {/* Right Column: Grafik Brangkas Toko (approx 8 of 12 cols) */}
          <div className="lg:col-span-8 bg-zinc-950/80 border border-zinc-800 rounded-2xl p-5 space-y-3 flex flex-col justify-between">
            <h3 className="text-sm font-bold text-white tracking-wide">Grafik Brangkas Toko</h3>

            {/* SVG Line / Scatter Chart */}
            <div className="w-full h-52 relative pt-2">
              <svg className="w-full h-full overflow-visible" viewBox="0 0 600 180" preserveAspectRatio="none">
                {/* Horizontal Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                  const y = 160 - ratio * 140;
                  const labelVal = Math.round((ratio * chartMaxVal) / 1000);
                  return (
                    <g key={idx}>
                      <line
                        x1="45"
                        y1={y}
                        x2="590"
                        y2={y}
                        stroke="#27272a"
                        strokeDasharray="4 4"
                        strokeWidth="1"
                      />
                      <text
                        x="38"
                        y={y + 3}
                        fill="#71717a"
                        fontSize="9"
                        textAnchor="end"
                        fontFamily="monospace"
                      >
                        {labelVal === 0 ? '0' : `${labelVal}rb`}
                      </text>
                    </g>
                  );
                })}

                {/* Vertical Date Grid / X-Axis */}
                <line x1="45" y1="160" x2="590" y2="160" stroke="#3f3f46" strokeWidth="1" />

                {/* Points & Lines for each date */}
                {chartData.map((pt, idx) => {
                  const totalCount = chartData.length;
                  const x = totalCount === 1 ? 317 : 70 + (idx / (totalCount - 1)) * 480;

                  const calcY = (val: number) => 160 - (val / (chartMaxVal || 1)) * 140;

                  const yPenjualan = calcY(pt.penjualan);
                  const yModal = calcY(pt.modal);
                  const yPengeluaran = calcY(pt.pengeluaran);
                  const yKeuntungan = calcY(pt.keuntungan);
                  const yTotalUang = calcY(pt.totalUang);

                  return (
                    <g key={pt.dateStr}>
                      {/* X Axis Label */}
                      <text
                        x={x}
                        y="174"
                        fill="#a1a1aa"
                        fontSize="9"
                        textAnchor="middle"
                        fontFamily="monospace"
                      >
                        {pt.dateStr}
                      </text>

                      {/* Total Uang (Purple) */}
                      <circle cx={x} cy={yTotalUang} r="3.5" fill="#a855f7" stroke="#3b0764" strokeWidth="1.5" />

                      {/* Total Penjualan (Teal/Emerald) */}
                      <circle cx={x} cy={yPenjualan} r="3" fill="#10b981" stroke="#064e3b" strokeWidth="1.5" />

                      {/* Total Modal (Amber) */}
                      <circle cx={x} cy={yModal} r="3" fill="#f59e0b" stroke="#78350f" strokeWidth="1.5" />

                      {/* Keuntungan (Blue) */}
                      <circle cx={x} cy={yKeuntungan} r="3" fill="#3b82f6" stroke="#1e3a8a" strokeWidth="1.5" />

                      {/* Pengeluaran (Rose) */}
                      <circle cx={x} cy={yPengeluaran} r="3" fill="#f43f5e" stroke="#881337" strokeWidth="1.5" />
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Legend at Bottom matching design */}
            <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] pt-3 border-t border-zinc-900">
              <div className="flex items-center gap-1.5 text-zinc-300">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                <span>Total Penjualan</span>
              </div>
              <div className="flex items-center gap-1.5 text-zinc-300">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                <span>Total Modal</span>
              </div>
              <div className="flex items-center gap-1.5 text-zinc-300">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                <span>Pengeluaran</span>
              </div>
              <div className="flex items-center gap-1.5 text-zinc-300">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                <span>Keuntungan</span>
              </div>
              <div className="flex items-center gap-1.5 text-zinc-300">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-500 inline-block" />
                <span>Total Uang</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL: Tambah Pemasukan (+ Pemasukan) */}
      {showIncomeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">Catat Pemasukan (Kas Awal / Lainnya)</h3>
              </div>
              <button
                onClick={() => setShowIncomeModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveIncome} className="space-y-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Kategori / Sumber</label>
                <select
                  value={incomeSource}
                  onChange={(e) => {
                    setIncomeSource(e.target.value);
                    if (e.target.value === 'Kas Awal Shift' && !incomeDesc) {
                      setIncomeDesc('Kas awal kasir (Admin)');
                    }
                  }}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="Kas Awal Shift">Kas Awal Shift</option>
                  <option value="Modal Tambahan">Modal Tambahan</option>
                  <option value="Pemasukan Lain-lain">Pemasukan Lain-lain</option>
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 font-bold mb-1">Keterangan / Catatan *</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Kas awal kasir (Admin)"
                  value={incomeDesc}
                  onChange={(e) => setIncomeDesc(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Jumlah (Rp) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    placeholder="0"
                    value={incomeAmount}
                    onChange={(e) => setIncomeAmount(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Metode</label>
                  <select
                    value={incomeMethod}
                    onChange={(e) => setIncomeMethod(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Transfer Bank">Transfer Bank</option>
                    <option value="QRIS">QRIS</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowIncomeModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow-lg shadow-emerald-950/40"
                >
                  Simpan Pemasukan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Catat Pengeluaran (- Pengeluaran) */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Minus className="w-5 h-5 text-rose-400" />
                <h3 className="text-base font-bold text-white">Catat Pengeluaran Toko</h3>
              </div>
              <button
                onClick={() => setShowExpenseModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveExpense} className="space-y-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Kategori Pengeluaran</label>
                <select
                  value={expenseSource}
                  onChange={(e) => setExpenseSource(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-rose-500"
                >
                  <option value="Operasional Toko">Operasional Toko</option>
                  <option value="Beli Perlengkapan">Beli Perlengkapan</option>
                  <option value="Biaya Listrik / Air">Biaya Listrik / Air</option>
                  <option value="Konsumsi Shift">Konsumsi Shift</option>
                  <option value="Lain-lain">Lain-lain</option>
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 font-bold mb-1">Keterangan / Keperluan *</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Beli kantong kresek & lakban"
                  value={expenseDesc}
                  onChange={(e) => setExpenseDesc(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Jumlah (Rp) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    placeholder="50000"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold focus:outline-none focus:border-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Metode</label>
                  <select
                    value={expenseMethod}
                    onChange={(e) => setExpenseMethod(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-rose-500"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Transfer Bank">Transfer Bank</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold transition shadow-lg shadow-rose-950/40"
                >
                  Simpan Pengeluaran
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DETAIL MODAL (LIHAT) */}
      {selectedDetailRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Eye className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-white text-base">Rincian Transaksi / Buku Kas</h3>
              </div>
              <button
                onClick={() => setSelectedDetailRow(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 bg-zinc-950 rounded-xl border border-zinc-800/80">
                <div>
                  <span className="text-zinc-500 block text-[11px]">Tanggal &amp; Waktu</span>
                  <span className="font-mono text-white font-bold">{selectedDetailRow.dateStr}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[11px]">Nomor Nota</span>
                  <span className="font-mono text-white font-bold">{selectedDetailRow.nota}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[11px]">Pelanggan</span>
                  <span className="text-white font-medium">{selectedDetailRow.customer}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[11px]">Metode Pembayaran</span>
                  <span className="text-emerald-400 font-bold">{selectedDetailRow.paymentMethod}</span>
                </div>
              </div>

              <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800/80 space-y-2">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Keterangan:</span>
                  <span className="text-white font-medium">{selectedDetailRow.description}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Produk Terkait:</span>
                  <span className="text-white font-medium">{selectedDetailRow.product}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Jumlah / Qty:</span>
                  <span className="text-white font-mono">{selectedDetailRow.qty}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Sumber Arus:</span>
                  <span className="text-blue-300 font-medium">{selectedDetailRow.source}</span>
                </div>
              </div>

              <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800/80 space-y-2">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Modal (HPP):</span>
                  <span className="font-mono font-bold text-zinc-200">
                    {selectedDetailRow.source === 'Penjualan'
                      ? fmtMoney(selectedDetailRow.totalCost || 0, currencyMode)
                      : '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Keuntungan (Margin):</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {typeof selectedDetailRow.keuntungan === 'number'
                      ? fmtMoney(selectedDetailRow.keuntungan, currencyMode)
                      : '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Total Nilai (Dana Masuk):</span>
                  <span className="font-mono font-bold text-white">
                    {fmtMoney(selectedDetailRow.masuk, currencyMode)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Dana Keluar (Pengeluaran):</span>
                  <span className="font-mono font-bold text-rose-400">
                    {fmtMoney(selectedDetailRow.keluar, currencyMode)}
                  </span>
                </div>
                <div className="flex justify-between pt-1 border-t border-zinc-800 text-sm">
                  <span className="font-bold text-white">Saldo Kumulatif:</span>
                  <span className="font-mono font-bold text-white">
                    {fmtMoney(selectedDetailRow.saldo, currencyMode)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-zinc-800">
              <button
                onClick={() => setSelectedDetailRow(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {editingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-base">Edit Data Pencatatan Kas</h3>
              </div>
              <button
                onClick={() => setEditingRow(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditRow} className="space-y-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Keterangan / Catatan</label>
                <input
                  type="text"
                  required
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              {editingRow.source === 'Penjualan' && (
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Nama Pelanggan</label>
                  <input
                    type="text"
                    value={editCustomer}
                    onChange={(e) => setEditCustomer(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              )}

              {editingRow.source !== 'Penjualan' && (
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Nominal (Rp)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold focus:outline-none focus:border-amber-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-zinc-400 font-bold mb-1">Metode Pembayaran</label>
                <select
                  value={editMethod}
                  onChange={(e) => setEditMethod(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="Cash">Cash / Tunai</option>
                  <option value="Transfer Bank">Transfer Bank</option>
                  <option value="QRIS">QRIS</option>
                  <option value="EDC / Kartu">EDC / Kartu</option>
                </select>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setEditingRow(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-bold transition shadow"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
