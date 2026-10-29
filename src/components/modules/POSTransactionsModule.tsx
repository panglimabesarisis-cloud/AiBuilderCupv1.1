import React, { useState, useEffect } from 'react';
import {
  ShoppingBag,
  TrendingUp,
  Receipt,
  ArrowDownRight,
  ArrowUpRight,
  Search,
  Filter,
  CheckCircle,
  AlertTriangle,
  FileSpreadsheet,
  Calendar,
  CreditCard,
  Banknote,
  QrCode,
  DollarSign,
  Plus,
  RefreshCw,
  Printer,
  Eye,
  Edit2,
  Trash2,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  X,
  FileText,
  UserCheck,
  Building,
  Tag,
} from 'lucide-react';
import { collection, query, orderBy, limit, onSnapshot, doc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { Transaction } from '../../types';
import { useAppNavigation } from '../../router';
import { useFirestoreList } from '../../hooks/useFirestoreList';

import { useAppData } from '../../context/AppDataContext';
import { useLanguage } from '../../context/LanguageContext';
import { fmtMoney, calcTransactionModalAndProfit } from '../../utils/money';
import { openTransactionDetailModal } from '../common/GlobalModals';
import { getPosSettings, dayKeyTz, logAudit } from '../../services/posRuntime';
import { printReceipt } from '../../services/receiptPrinter';
import { useApprovalPin } from '../pos/ApprovalPinModal';

interface POSTransactionsModuleProps {
  subModule: 'transaksi_penjualan' | 'pendapatan_masuk' | 'pengeluaran_toko';
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

export const POSTransactionsModule: React.FC<POSTransactionsModuleProps> = ({
  subModule,
  currencyMode,
  onNavigateTab,
}) => {
  const { currencyMode: ctxCurrencyMode } = useLanguage();
  const { requestApproval, approvalModal } = useApprovalPin();
  const activeCurrency = ctxCurrencyMode || currencyMode || 'IDR';
  const { route, navigateTab } = useAppNavigation();
  const { transactions: ctxTransactions, products, loadingTransactions, purgeTransactionsBefore } = useAppData();
  const activeSub = (
    route.activeTab === 'module_pos_transactions' ? route.activeSubModule : subModule
  ) as 'transaksi_penjualan' | 'pendapatan_masuk' | 'pengeluaran_toko';
  const setActiveSub = (next: 'transaksi_penjualan' | 'pendapatan_masuk' | 'pengeluaran_toko') => {
    navigateTab('module_pos_transactions', next);
  };
  const [transactions, setTransactions] = useState<Transaction[]>(ctxTransactions);
  const [loading, setLoading] = useState(loadingTransactions);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMethodFilter, setSelectedMethodFilter] = useState<string>('ALL');
  const [cutoffDateInput, setCutoffDateInput] = useState('2026-10-27');
  const [showCutoffPurgeModal, setShowCutoffPurgeModal] = useState(false);
  const [isPurgingCutoff, setIsPurgingCutoff] = useState(false);
  const [purgeProgressMsg, setPurgeProgressMsg] = useState('');
  const [purgeResultFeedback, setPurgeResultFeedback] = useState<string | null>(null);

  const handleExecuteCutoffPurge = async () => {
    setIsPurgingCutoff(true);
    setPurgeResultFeedback(null);
    setPurgeProgressMsg('Memulai pembersihan transaksi lama...');
    try {
      const isoCutoff = `${cutoffDateInput || '2026-10-27'}T00:00:00+07:00`;
      const res = await purgeTransactionsBefore(isoCutoff, (msg) => setPurgeProgressMsg(msg));
      setPurgeProgressMsg('');
      setPurgeResultFeedback(
        `Berhasil menghapus ${res.totalDeleted} dokumen transaksi sebelum ${cutoffDateInput} (${res.retainedCount} transaksi baru dipertahankan). Database Inti 100% utuh.`
      );
      setTimeout(() => {
        setShowCutoffPurgeModal(false);
      }, 1500);
    } catch (err: any) {
      setPurgeProgressMsg('');
      setPurgeResultFeedback(`Gagal membersihkan transaksi: ${err?.message || err}`);
    } finally {
      setIsPurgingCutoff(false);
    }
  };

  // Sync with centralized AppDataContext (merges root transactions + stores/store_001/transactions)
  useEffect(() => {
    setTransactions(ctxTransactions);
    setLoading(loadingTransactions);
  }, [ctxTransactions, loadingTransactions]);

  // Selected Transaction for Detail Modal / Receipt Preview / Refund / Edit
  const [selectedTrx, setSelectedTrx] = useState<Transaction | null>(null);
  const [editingTrx, setEditingTrx] = useState<Transaction | null>(null);
  const [editTrxCustomer, setEditTrxCustomer] = useState('');
  const [editTrxMethod, setEditTrxMethod] = useState('cash');
  const [editTrxAmount, setEditTrxAmount] = useState(0);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundReason, setRefundReason] = useState('Barang Rusak / Kemasan Cacat');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundSuccessMsg, setRefundSuccessMsg] = useState('');

  // Pendapatan Masuk Ledger from Firestore
  const {
    data: incomes,
    addItem: addIncomeDoc,
    updateItem: updateIncomeDoc,
    deleteItem: deleteIncomeDoc,
  } = useFirestoreList<any>('pos_incomes', []);
  const { data: customersList } = useFirestoreList<any>('stores/store_001/customers', []);
  const [detailIncome, setDetailIncome] = useState<any | null>(null);
  const [editingIncome, setEditingIncome] = useState<any | null>(null);

  // Modal Pelunasan Piutang (Debt Settlement - Separate from Sales Revenue)
  const [showDebtSettlementModal, setShowDebtSettlementModal] = useState(false);
  const [settlementCustomer, setSettlementCustomer] = useState('');
  const [settlementAmount, setSettlementAmount] = useState('');
  const [settlementAccount, setSettlementAccount] = useState('Kas Kasir Tunai');
  const [settlementNote, setSettlementNote] = useState('Pelunasan sisa nota kasbon');

  // Pengeluaran Toko Ledger from Firestore
  const {
    data: expenses,
    addItem: addExpenseDoc,
    updateItem: updateExpenseDoc,
    deleteItem: deleteExpenseDoc,
  } = useFirestoreList<any>('pos_expenses', []);
  const [detailExpense, setDetailExpense] = useState<any | null>(null);
  const [editingExpense, setEditingExpense] = useState<any | null>(null);

  // Dynamic Expense Categories & Payment Methods
  const DEFAULT_EXPENSE_CATEGORIES = [
    { id: 'cat-1', name: 'Operasional Toko' },
    { id: 'cat-2', name: 'Beban Listrik & Utilitas' },
    { id: 'cat-3', name: 'Perlengkapan Kasir (Thermal Paper / Ribbon)' },
    { id: 'cat-4', name: 'Bongkar Muat & Kebersihan' },
    { id: 'cat-5', name: 'Gaji & Uang Makan Staff' },
    { id: 'cat-6', name: 'Biaya Sewa Tempat' },
    { id: 'cat-7', name: 'Maintenance Mesin & Chiller' },
    { id: 'cat-8', name: 'Konsumsi & Lembur' },
  ];

  const DEFAULT_EXPENSE_METHODS = [
    { id: 'pay-1', name: 'Kas Kecil Kasir (Cash)' },
    { id: 'pay-2', name: 'Transfer Bank BCA Toko' },
    { id: 'pay-3', name: 'Petty Cash Manager' },
    { id: 'pay-4', name: 'Kas Brankas Toko' },
    { id: 'pay-5', name: 'Kartu Debit Toko' },
    { id: 'pay-6', name: 'QRIS Statis / Kas Toko' },
  ];

  const {
    data: expenseCategories,
    addItem: addExpenseCategoryDoc,
    deleteItem: deleteExpenseCategoryDoc,
  } = useFirestoreList<any>('pos_expense_categories', DEFAULT_EXPENSE_CATEGORIES);

  const {
    data: expensePaymentMethods,
    addItem: addExpensePaymentMethodDoc,
    deleteItem: deleteExpensePaymentMethodDoc,
  } = useFirestoreList<any>('pos_expense_payment_methods', DEFAULT_EXPENSE_METHODS);

  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');

  const [showPaymentMethodModal, setShowPaymentMethodModal] = useState(false);
  const [newPaymentMethodInput, setNewPaymentMethodInput] = useState('');

  // Modal State for New Expense
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [newExpAmount, setNewExpAmount] = useState('');
  const [newExpCategory, setNewExpCategory] = useState('Operasional Toko');
  const [newExpRecipient, setNewExpRecipient] = useState('');
  const [newExpMethod, setNewExpMethod] = useState('Kas Kecil Kasir (Cash)');
  const [newExpNote, setNewExpNote] = useState('');

  const handleSaveEditTrx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTrx?.id) return;
    await updateDoc(doc(db, 'transactions', editingTrx.id), {
      customerName: editTrxCustomer,
      paymentMethod: editTrxMethod,
      totalAmount: Number(editTrxAmount) || 0,
    });
    setEditingTrx(null);
  };

  // Handle Add / Edit Expense
  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number(newExpAmount);
    if (!val) return;
    if (editingExpense?.id) {
      await updateExpenseDoc(editingExpense.id, {
        category: newExpCategory,
        recipient: newExpRecipient || 'Pihak Terkait / Vendor',
        method: newExpMethod,
        amount: val,
        note: newExpNote || 'Pengeluaran operasional toko harian',
      });
    } else {
      const item = {
        id: `EXP-${Date.now().toString().slice(-6)}`,
        date: new Date().toLocaleDateString('id-ID') + ', ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
        category: newExpCategory,
        recipient: newExpRecipient || 'Pihak Terkait / Vendor',
        method: newExpMethod,
        amount: val,
        approvalStatus: 'APPROVED',
        approver: 'Manager Toko',
        hasReceiptAttachment: true,
        note: newExpNote || 'Pengeluaran operasional toko harian',
      };
      await addExpenseDoc(item);
    }
    setEditingExpense(null);
    setShowExpenseModal(false);
    setNewExpAmount('');
    setNewExpRecipient('');
    setNewExpNote('');
  };

  // Handle Debt Settlement (Add / Edit Income & sync with customer receivables + cash_logs)
  const handleRecordDebtSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number(settlementAmount);
    if (!val) return;
    const custName = settlementCustomer || 'Pelanggan Kasbon';
    const nowIso = new Date().toISOString();
    if (editingIncome?.id) {
      await updateIncomeDoc(editingIncome.id, {
        source: custName,
        method: settlementAccount,
        amount: val,
        note: settlementNote,
      });
    } else {
      const settleId = `INC-SETTLE-${Date.now().toString().slice(-5)}`;
      const dateStr =
        new Date().toLocaleDateString('id-ID') +
        ', ' +
        new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) +
        ' WIB';
      const item = {
        id: settleId,
        date: dateStr,
        createdAt: nowIso,
        category: 'Pelunasan Piutang / Hutang Pelanggan',
        source: custName,
        method: settlementAccount,
        amount: val,
        isReceivableSettlement: true,
        note:
          settlementNote ||
          `Pelunasan hutang/piutang oleh ${custName}. Masuk ke ${settlementAccount} tanpa menaikkan omzet penjualan ganda.`,
      };
      await addIncomeDoc(item);

      // Sync with cash_logs and cash_flows if paid to cash drawer
      await Promise.all([
        setDoc(
          doc(db, 'cash_logs', settleId),
          {
            id: settleId,
            type: 'in',
            category: 'Pelunasan Hutang Pelanggan',
            amount: val,
            source: custName,
            cashierName: 'Kasir POS',
            note: item.note,
            date: dateStr,
            createdAt: nowIso,
          },
          { merge: true }
        ).catch(() => {}),
        setDoc(
          doc(db, 'cash_flows', settleId),
          {
            id: settleId,
            storeId: 'store_001',
            type: 'in',
            category: 'Pelunasan Hutang Pelanggan',
            paymentMethod: settlementAccount.toLowerCase().includes('tunai') ? 'cash' : 'transfer',
            amount: val,
            customerName: custName,
            cashierName: 'Kasir POS',
            note: item.note,
            date: nowIso,
            createdAt: nowIso,
          },
          { merge: true }
        ).catch(() => {}),
      ]);

      // Reduce customer debtAmount in `customers` collection if matched
      const matchedCust = customersList.find(
        (c: any) => (c.name || '').trim().toLowerCase() === custName.trim().toLowerCase()
      );
      if (matchedCust?.id) {
        const nextDebt = Math.max(0, Number(matchedCust.debtAmount || 0) - val);
        await setDoc(
          doc(db, 'customers', matchedCust.id),
          {
            debtAmount: nextDebt,
            status: nextDebt <= 0 ? 'LUNAS' : matchedCust.status || 'LANCAR',
            updatedAt: nowIso,
          },
          { merge: true }
        ).catch(() => {});
      }
    }
    setEditingIncome(null);
    setShowDebtSettlementModal(false);
    setSettlementAmount('');
  };

  // Mark Unpaid COD / Hutang Transaction as Paid directly from Audit Modal
  const handleSettleTransactionDirectly = async (trx: any) => {
    if (!trx?.id) return;
    const nowIso = new Date().toISOString();
    const amountToSettle = Number(trx.remainingDebt ?? trx.totalAmount ?? 0);
    const pmLabel =
      String(trx.paymentMethod || '').toLowerCase() === 'cod' ? 'COD' : 'Hutang';
    const settleId = `CF-SETTLE-${trx.id}`;
    const formattedDate = new Date(nowIso).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

    await Promise.all([
      setDoc(
        doc(db, 'transactions', trx.id),
        {
          paymentStatus: 'paid',
          paidAmount: Number(trx.totalAmount || 0),
          remainingDebt: 0,
          fulfillmentStatus: 'completed',
          paidAt: nowIso,
          updatedAt: nowIso,
        },
        { merge: true }
      ).catch(() => {}),
      setDoc(
        doc(db, 'stores', 'store_001', 'transactions', trx.id),
        {
          paymentStatus: 'paid',
          paidAmount: Number(trx.totalAmount || 0),
          remainingDebt: 0,
          fulfillmentStatus: 'completed',
          paidAt: nowIso,
          updatedAt: nowIso,
        },
        { merge: true }
      ).catch(() => {}),
      setDoc(
        doc(db, 'orders', trx.id),
        {
          status: 'delivered',
          fulfillmentStatus: 'completed',
          paymentStatus: 'paid',
          paidAmount: Number(trx.totalAmount || 0),
          remainingDebt: 0,
          paidAt: nowIso,
          updatedAt: nowIso,
        },
        { merge: true }
      ).catch(() => {}),
      setDoc(
        doc(db, 'stores', 'store_001', 'orders', trx.id),
        {
          status: 'delivered',
          fulfillmentStatus: 'completed',
          paymentStatus: 'paid',
          paidAmount: Number(trx.totalAmount || 0),
          remainingDebt: 0,
          paidAt: nowIso,
          updatedAt: nowIso,
        },
        { merge: true }
      ).catch(() => {}),
      setDoc(
        doc(db, 'cash_flows', settleId),
        {
          id: settleId,
          storeId: 'store_001',
          transactionId: trx.id,
          type: 'in',
          category: `Pelunasan ${pmLabel} POS`,
          paymentMethod: 'cash',
          amount: amountToSettle,
          customerName: trx.customerName || 'Pelanggan POS',
          cashierName: trx.deliveryStaffName || trx.cashierName || 'Kasir POS',
          note: `Pelunasan ${pmLabel} Struk #${trx.id} (${trx.customerName || 'Pelanggan'})`,
          date: nowIso,
          createdAt: nowIso,
        },
        { merge: true }
      ).catch(() => {}),
      setDoc(
        doc(db, 'cash_logs', settleId),
        {
          id: settleId,
          type: 'in',
          category: `Setoran ${pmLabel}`,
          amount: amountToSettle,
          source: trx.customerName || 'Pelanggan POS',
          cashierName: trx.deliveryStaffName || trx.cashierName || 'Kasir POS',
          note: `Pelunasan ${pmLabel} Struk #${trx.id}`,
          date: formattedDate,
          createdAt: nowIso,
        },
        { merge: true }
      ).catch(() => {}),
      setDoc(
        doc(db, 'incomes', settleId),
        {
          id: settleId,
          date: formattedDate,
          createdAt: nowIso,
          category: `Pelunasan ${pmLabel}`,
          source: trx.customerName || 'Pelanggan POS',
          method: `Tunai (${pmLabel})`,
          amount: amountToSettle,
          isReceivableSettlement: pmLabel === 'Hutang',
          note: `Pelunasan ${pmLabel} Struk #${trx.id}`,
        },
        { merge: true }
      ).catch(() => {}),
    ]);

    setSelectedTrx((prev: any) =>
      prev ? { ...prev, paymentStatus: 'paid', remainingDebt: 0, fulfillmentStatus: 'completed' } : null
    );
  };

  // Handle Refund Process
  const handleProcessRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTrx) return;
    const refAmountNum = Number(refundAmount) || selectedTrx.totalAmount;
    
    // Add refund expense record
    const refundExpenseItem = {
      id: `REFUND-${selectedTrx.id}`,
      date: new Date().toLocaleDateString('id-ID') + ', ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
      category: 'Retur / Refund Penjualan',
      recipient: selectedTrx.customerName || 'Pelanggan',
      method: 'Kas Toko / Saldo Refund',
      amount: refAmountNum,
      approvalStatus: 'APPROVED',
      approver: 'Supervisor Toko',
      hasReceiptAttachment: true,
      note: `Retur struk #${selectedTrx.id}. Alasan: ${refundReason}. Stok dikembalikan ke inventory.`,
    };
    await addExpenseDoc(refundExpenseItem);

    setRefundSuccessMsg(`Refund senilai ${fmtMoney(refAmountNum, activeCurrency)} berhasil diproses! Referensi asli struk #${selectedTrx.id} tersimpan.`);
    setTimeout(() => {
      setShowRefundModal(false);
      setRefundSuccessMsg('');
      setShowDetailModal(false);
    }, 1800);
  };

  // Calculations
  const totalSalesRevenue = transactions.reduce((acc, t) => acc + (t.totalAmount || 0), 0);
  const totalSalesModal = transactions.reduce(
    (acc, t) => acc + calcTransactionModalAndProfit(t, products).modal,
    0
  );
  const totalSalesKeuntungan = totalSalesRevenue - totalSalesModal;
  const totalIncomeLedger = incomes.reduce((acc, inc) => acc + inc.amount, 0);
  const totalReceivablesCollected = incomes.filter(i => i.isReceivableSettlement).reduce((acc, inc) => acc + inc.amount, 0);
  const totalExpenseLedger = expenses.reduce((acc, exp) => acc + exp.amount, 0);

  // Filtered transactions
  const filteredTrx = transactions.filter((t) => {
    const q = searchQuery.toLowerCase();
    const cashierLabel = (t.cashierName || (t.channel === 'pwa' ? 'Client PWA' : 'Admin Utama (Owner)')).toLowerCase();
    const matchesSearch =
      t.id.toLowerCase().includes(q) ||
      (t.customerName && t.customerName.toLowerCase().includes(q)) ||
      cashierLabel.includes(q) ||
      (t.cashierId && t.cashierId.toLowerCase().includes(q));
    const matchesMethod = selectedMethodFilter === 'ALL' || t.paymentMethod?.toLowerCase() === selectedMethodFilter.toLowerCase();
    return matchesSearch && matchesMethod;
  });

  return (
    <div className="space-y-6">
      {approvalModal}
      {/* Header */}
      <div className="pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-6 h-6 text-blue-500" />
          <h1 className="text-2xl font-black text-white tracking-tight">
            5.13 TRANSAKSI POS &amp; BUKU KAS
          </h1>
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          Audit histori struk penjualan kasir, pelacakan arus pendapatan masuk (pemisahan omzet vs pelunasan piutang), dan pengeluaran operasional toko.
        </p>
      </div>

      {/* Sub-Tabs */}
      <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto w-full max-w-none mb-4">
          <button
            onClick={() => setActiveSub('transaksi_penjualan')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeSub === 'transaksi_penjualan' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Transaksi Penjualan</span>
          </button>
          <button
            onClick={() => setActiveSub('pendapatan_masuk')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeSub === 'pendapatan_masuk' ? 'bg-emerald-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <ArrowDownRight className="w-3.5 h-3.5" />
            <span>Pendapatan Masuk</span>
          </button>
          <button
            onClick={() => setActiveSub('pengeluaran_toko')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeSub === 'pengeluaran_toko' ? 'bg-rose-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Pengeluaran Toko</span>
          </button>
        </div>

      {/* VIEW: TRANSAKSI PENJUALAN */}
      {activeSub === 'transaksi_penjualan' && (
        <div className="space-y-4">
          {/* Top Metric Cards: Modal | Keuntungan | Total Nilai | Non-Tunai | Piutang | Fraud AI */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Modal</span>
              <div className="text-xl font-black font-mono text-zinc-200 mt-1">
                {fmtMoney(totalSalesModal, activeCurrency)}
              </div>
              <span className="text-[11px] text-zinc-400">Total HPP barang terjual</span>
            </div>
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Keuntungan</span>
              <div className="text-xl font-black font-mono text-emerald-400 mt-1">
                {fmtMoney(totalSalesKeuntungan, activeCurrency)}
              </div>
              <span className="text-[11px] text-emerald-500 font-medium">Total Nilai - Modal</span>
            </div>
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Total Nilai</span>
              <div className="text-xl font-black font-mono text-blue-400 mt-1">
                {fmtMoney(totalSalesRevenue, activeCurrency)}
              </div>
              <span className="text-[11px] text-zinc-400">Dari {transactions.length} transaksi tercatat</span>
            </div>
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Metode Non-Tunai &amp; QRIS</span>
              <div className="text-xl font-black font-mono text-emerald-400 mt-1">
                {fmtMoney(
                  transactions
                    .filter(t => t.paymentMethod === 'qris' || t.paymentMethod === 'card')
                    .reduce((a, b) => a + b.totalAmount, 0),
                  activeCurrency
                )}
              </div>
              <span className="text-[11px] text-emerald-500 font-medium">Auto-reconciled Xendit / Bank</span>
            </div>
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Piutang Hutang &amp; COD Aktif</span>
              <div className="text-xl font-black font-mono text-amber-400 mt-1">
                {fmtMoney(
                  transactions
                    .filter((t: any) => {
                      const pm = String(t.paymentMethod || '').toLowerCase();
                      const ps = String(t.paymentStatus || '').toLowerCase();
                      return (pm === 'debt' || pm === 'hutang' || pm === 'cod') && ps !== 'paid';
                    })
                    .reduce((a, b: any) => a + Number(b.remainingDebt ?? b.totalAmount ?? 0), 0),
                  activeCurrency
                )}
              </div>
              <span className="text-[11px] text-zinc-400">Tagihan Hutang &amp; COD belum lunas</span>
            </div>
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Status Proteksi Fraud AI</span>
              <div className="text-xl font-black font-mono text-teal-400 mt-1 flex items-center gap-1.5">
                <ShieldCheck className="w-5 h-5 text-teal-400" />
                <span>100% Checked</span>
              </div>
              <span className="text-[11px] text-zinc-400">Anti-fraud engine aktif real-time</span>
            </div>
          </div>

          {/* Action & Filter Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Cari ID struk / pelanggan / kasir..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Payment Method Filter */}
              <select
                value={selectedMethodFilter}
                onChange={(e) => setSelectedMethodFilter(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none"
              >
                <option value="ALL">Semua Pembayaran</option>
                <option value="cash">Tunai (Cash)</option>
                <option value="qris">QRIS</option>
                <option value="debt">Kasbon (Hutang)</option>
                <option value="cod">COD</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => onNavigateTab && onNavigateTab('pos_machine')}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md transition cursor-pointer flex items-center gap-1.5"
              >
                <ShoppingBag className="w-4 h-4" />
                <span>+ Buka Kasir POS</span>
              </button>
            </div>
          </div>

          {purgeResultFeedback && (
            <div className="p-3 rounded-xl bg-emerald-950/70 border border-emerald-700/70 text-emerald-300 text-xs font-bold flex items-center justify-between">
              <span>✓ {purgeResultFeedback}</span>
              <button
                onClick={() => setPurgeResultFeedback(null)}
                className="text-zinc-400 hover:text-white text-xs px-2 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {showCutoffPurgeModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
              <div className="bg-zinc-900 border border-[#C6A85E]/50 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
                <div className="flex items-center gap-2 text-[#E5C77A] pb-2 border-b border-zinc-800">
                  <Calendar className="w-5 h-5 shrink-0" />
                  <h3 className="font-bold text-white text-base">
                    Konfirmasi Pembersihan Transaksi Lama
                  </h3>
                </div>

                <div className="space-y-3 text-xs text-zinc-300 leading-relaxed">
                  <p className="font-semibold text-zinc-100">
                    Hapus semua riwayat transaksi, pesanan, kas, dan shift sebelum{' '}
                    <span className="text-[#E5C77A] font-bold">
                      {cutoffDateInput === '2026-10-27' ? '27 Oktober 2026' : cutoffDateInput}
                    </span>
                    ? (Produk, Brand, Kategori, Staf &amp; Pengaturan Inti 100% AMAN)
                  </p>

                  <div className="p-3 rounded-xl bg-zinc-950 border border-[#C6A85E]/30 space-y-2">
                    <label className="block text-[11px] font-bold text-[#E5C77A]">
                      Batas Tanggal Cutoff (Pukul 00:00:00 WIB):
                    </label>
                    <input
                      type="date"
                      value={cutoffDateInput}
                      onChange={(e) => setCutoffDateInput(e.target.value || '2026-10-27')}
                      className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-[#C6A85E]/40 text-xs text-white font-mono focus:outline-none focus:border-[#E5C77A]"
                    />
                    <div className="text-[11px] text-zinc-400">
                      Hanya dokumen transaksi dengan tanggal <strong>&lt; {cutoffDateInput} 00:00:00 WIB</strong> yang akan dihapus.
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 text-[11px] font-semibold">
                    ✓ Jaminan Database Inti 100% Aman: Katalog Produk, Kategori, Brand, Paket/Bundle, Pelanggan, Akun Staff/User, Hak Akses/Role, Menu Sidebar &amp; Pengaturan Sistem diblokir secara hardcode dari penghapusan.
                  </div>

                  {purgeProgressMsg && (
                    <div className="p-2.5 rounded-xl bg-[#2A2210] border border-[#C6A85E]/40 text-[#E5C77A] font-mono text-[11px]">
                      ⏳ {purgeProgressMsg}
                    </div>
                  )}

                  {purgeResultFeedback && (
                    <div className="p-2.5 rounded-xl bg-emerald-950/80 border border-emerald-700 text-emerald-300 font-bold">
                      {purgeResultFeedback}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-2 border-t border-zinc-800">
                  <button
                    disabled={isPurgingCutoff}
                    onClick={handleExecuteCutoffPurge}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-[#C6A85E] hover:bg-[#d4b76c] disabled:opacity-40 text-zinc-950 text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>
                      {isPurgingCutoff
                        ? 'Membersihkan Transaksi Lama...'
                        : `Ya, Bersihkan Sebelum ${cutoffDateInput}`}
                    </span>
                  </button>
                  <button
                    disabled={isPurgingCutoff}
                    onClick={() => setShowCutoffPurgeModal(false)}
                    className="py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition cursor-pointer"
                  >
                    Batal
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Transactions Table */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">No. Struk</th>
                  <th className="py-3 px-4">Waktu Transaksi</th>
                  <th className="py-3 px-4">Pelanggan</th>
                  <th className="py-3 px-4">Kasir</th>
                  <th className="py-3 px-4">Metode Bayar</th>
                  <th className="py-3 px-4 text-center">Status Fraud</th>
                  <th className="py-3 px-4 text-right">Modal</th>
                  <th className="py-3 px-4 text-right">Keuntungan</th>
                  <th className="py-3 px-4 text-right">Total Nilai</th>
                  <th className="py-3 px-4 text-center">Aksi Audit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {filteredTrx.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-zinc-500">
                      <p className="text-sm font-medium text-zinc-400">Belum ada transaksi tercatat.</p>
                      <p className="text-xs text-zinc-600 mt-1">Transaksi penjualan dari POS akan otomatis muncul di sini secara real-time.</p>
                      <button
                        onClick={() => onNavigateTab && onNavigateTab('pos_machine')}
                        className="mt-3 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition"
                      >
                        <ShoppingBag className="w-3.5 h-3.5" />
                        <span>Buka Mesin POS</span>
                      </button>
                    </td>
                  </tr>
                ) : (
                  filteredTrx.map((trx) => {
                    const { modal, keuntungan, totalNilai } = calcTransactionModalAndProfit(trx, products);
                    const cashierLabel = trx.cashierName || (trx.channel === 'pwa' ? 'Client PWA' : 'Admin Utama (Owner)');
                    return (
                      <tr
                        key={trx.id}
                        onClick={() => openTransactionDetailModal(trx, 'SALE')}
                        className="hover:bg-zinc-800/40 transition cursor-pointer"
                      >
                        <td className="py-3 px-4 font-mono font-bold text-blue-400">
                          {trx.id}
                        </td>
                        <td className="py-3 px-4 text-zinc-400">
                          {new Date(trx.createdAt).toLocaleDateString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-bold text-white block">{trx.customerName || 'Pelanggan Umum'}</span>
                          <span className="text-[10px] text-zinc-500 uppercase">{trx.channel || 'POS KASIR'}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-semibold text-blue-400 block">{cashierLabel}</span>
                          <span className="text-[10px] text-zinc-500 font-mono block">{trx.cashierRole || 'Kasir POS'}</span>
                          {(trx as any).deliveryStaffName && (
                            <span className="text-[10px] text-cyan-400 font-semibold block mt-0.5">
                              Pengirim: {(trx as any).deliveryStaffName}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {(() => {
                            const pm = String(trx.paymentMethod || 'cash').toLowerCase();
                            const ps = String(
                              (trx as any).paymentStatus ||
                                (pm === 'debt' || pm === 'hutang' || pm === 'cod' ? 'unpaid' : 'paid')
                            ).toLowerCase();
                            const label =
                              pm === 'debt' || pm === 'hutang'
                                ? ps === 'paid'
                                  ? 'HUTANG (LUNAS)'
                                  : 'HUTANG'
                                : pm === 'cod'
                                ? ps === 'paid'
                                  ? 'COD (LUNAS)'
                                  : 'COD (DIKIRIM)'
                                : pm === 'qris'
                                ? 'QRIS'
                                : 'TUNAI';
                            return (
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  pm === 'cash' || pm === 'tunai' || ps === 'paid'
                                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                    : pm === 'qris'
                                    ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                                    : pm === 'cod'
                                    ? 'bg-purple-950 text-purple-300 border border-purple-800'
                                    : 'bg-amber-950 text-amber-400 border border-amber-800'
                                }`}
                              >
                                {label}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              trx.riskLevel === 'clean'
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : trx.riskLevel === 'warning'
                                ? 'bg-amber-950 text-amber-400 border border-amber-800'
                                : 'bg-rose-950 text-rose-400 border border-rose-800'
                            }`}
                          >
                            {trx.riskLevel ? trx.riskLevel.toUpperCase() : 'CLEAN'} ({trx.riskScore ?? 0})
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-zinc-300 whitespace-nowrap">
                          {fmtMoney(modal, activeCurrency)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                          {fmtMoney(keuntungan, activeCurrency)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-white whitespace-nowrap">
                          {fmtMoney(totalNilai, activeCurrency)}
                        </td>
                        <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => {
                                openTransactionDetailModal(trx, 'SALE');
                              }}
                              title="Lihat Detail & Fulfillment"
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 cursor-pointer transition"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setEditingTrx(trx);
                                setEditTrxCustomer(trx.customerName || '');
                                setEditTrxMethod(trx.paymentMethod || 'cash');
                                setEditTrxAmount(trx.totalAmount || 0);
                              }}
                              title="Edit Transaksi"
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 cursor-pointer transition"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={async () => {
                                if (!trx.id) return;
                                try {
                                  for (const col of ['transactions', 'orders']) {
                                    const key = `riskcart_deleted_fs_${col}_v1`;
                                    const raw = localStorage.getItem(key);
                                    const set = new Set<string>(raw ? JSON.parse(raw) : []);
                                    set.add(String(trx.id));
                                    localStorage.setItem(key, JSON.stringify(Array.from(set)));
                                  }
                                } catch {}
                                await Promise.all([
                                  deleteDoc(doc(db, 'transactions', trx.id)).catch(() => {}),
                                  deleteDoc(
                                    doc(db, 'stores', 'store_001', 'transactions', trx.id)
                                  ).catch(() => {}),
                                  deleteDoc(doc(db, 'orders', trx.id)).catch(() => {}),
                                  deleteDoc(
                                    doc(db, 'stores', 'store_001', 'orders', trx.id)
                                  ).catch(() => {}),
                                ]);
                              }}
                              title="Hapus Transaksi"
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 cursor-pointer transition"
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

      {/* VIEW: PENDAPATAN MASUK */}
      {activeSub === 'pendapatan_masuk' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-zinc-500 block text-[10px] font-bold uppercase">Total Arus Pendapatan Masuk</span>
              <span className="text-2xl font-mono font-black text-emerald-400 mt-1 block">
                {fmtMoney(totalIncomeLedger, activeCurrency)}
              </span>
              <span className="text-[11px] text-zinc-400">Total penerimaan kas &amp; bank periode ini</span>
            </div>
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-zinc-500 block text-[10px] font-bold uppercase">Pelunasan Piutang Terkumpul</span>
              <span className="text-2xl font-mono font-black text-blue-400 mt-1 block">
                {fmtMoney(totalReceivablesCollected, activeCurrency)}
              </span>
              <span className="text-[11px] text-zinc-400">Pemisahan omzet: tidak mencatat omzet ganda</span>
            </div>
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col justify-between">
              <div>
                <span className="text-zinc-500 block text-[10px] font-bold uppercase">Aksi Buku Kas Masuk</span>
                <p className="text-xs text-zinc-400 mt-1">Catat pelunasan kasbon atau pemasukan non-penjualan</p>
              </div>
              <button
                onClick={() => setShowDebtSettlementModal(true)}
                className="mt-2 w-full py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Catat Pelunasan Piutang</span>
              </button>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">No. Reff</th>
                  <th className="py-3 px-4">Waktu</th>
                  <th className="py-3 px-4">Kategori Pendapatan</th>
                  <th className="py-3 px-4">Sumber / Asal</th>
                  <th className="py-3 px-4">Akun &amp; Metode</th>
                  <th className="py-3 px-4">Klasifikasi Audit</th>
                  <th className="py-3 px-4 text-right">Nominal Masuk</th>
                  <th className="py-3 px-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {incomes.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-zinc-500">
                      <p className="text-sm font-medium text-zinc-400">Belum ada catatan pendapatan kas masuk.</p>
                      <p className="text-xs text-zinc-600 mt-1">Data penerimaan kas harian akan tercatat di sini.</p>
                    </td>
                  </tr>
                ) : (
                  incomes.map((inc) => (
                    <tr
                      key={inc.id}
                      onClick={() => openTransactionDetailModal(inc, 'CASH_IN')}
                      className="hover:bg-zinc-800/40 cursor-pointer"
                    >
                      <td className="py-3 px-4 font-mono font-bold text-blue-400">{inc.id}</td>
                      <td className="py-3 px-4 text-zinc-400">{inc.date}</td>
                      <td className="py-3 px-4 font-bold text-white">{inc.category}</td>
                      <td className="py-3 px-4 text-zinc-300">{inc.source}</td>
                      <td className="py-3 px-4 text-zinc-400">{inc.method}</td>
                      <td className="py-3 px-4">
                        {inc.isReceivableSettlement ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800">
                            Pelunasan Piutang (Non-Sales)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                            Pendapatan Omzet Penjualan
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                        +{fmtMoney(inc.amount || 0, activeCurrency)}
                      </td>
                      <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => openTransactionDetailModal(inc, 'CASH_IN')}
                            title="Lihat Detail Pendapatan"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 cursor-pointer transition"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingIncome(inc);
                              setSettlementCustomer(inc.source || '');
                              setSettlementAmount(String(inc.amount || ''));
                              setSettlementAccount(inc.method || 'Kas Kasir Tunai');
                              setSettlementNote(inc.note || '');
                              setShowDebtSettlementModal(true);
                            }}
                            title="Edit Pendapatan"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 cursor-pointer transition"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={async () => {
                              if (inc.id) await deleteIncomeDoc(inc.id);
                            }}
                            title="Hapus Pendapatan"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 cursor-pointer transition"
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

      {/* VIEW: PENGELUARAN TOKO */}
      {activeSub === 'pengeluaran_toko' && (
        <div className="space-y-4">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl w-full lg:w-auto">
              <span className="text-zinc-500 block text-[10px] font-bold uppercase">Total Biaya Operasional Toko</span>
              <span className="text-2xl font-mono font-black text-rose-400 mt-1 block">
                {fmtMoney(totalExpenseLedger, activeCurrency)}
              </span>
              <span className="text-[11px] text-zinc-400">Seluruh beban operasional, perlengkapan, &amp; retur</span>
            </div>

            {/* Action Buttons: Kategori Biaya (kiri) | Pengeluaran (tengah) | Metode Pembayaran (kanan) */}
            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-end">
              {/* 3. Tombol di sebelah kirinya Pengeluaran > Kategori Biaya */}
              <button
                type="button"
                onClick={() => setShowCategoryModal(true)}
                className="px-4 py-2.5 rounded-xl bg-zinc-850 hover:bg-zinc-800 text-zinc-200 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border border-zinc-700 shadow-sm"
                title="Kelola Master Kategori Biaya Pengeluaran"
              >
                <Tag className="w-4 h-4 text-amber-400" />
                <span>Kategori Biaya</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 font-mono">
                  {expenseCategories.length}
                </span>
              </button>

              {/* 1. Button Pengeluaran (sebelumnya + Catatan Pengeluaran Baru) */}
              <button
                type="button"
                onClick={() => {
                  setEditingExpense(null);
                  setNewExpAmount('');
                  setNewExpRecipient('');
                  setNewExpNote('');
                  setShowExpenseModal(true);
                }}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-md"
                title="Catat Pengeluaran Toko"
              >
                <Plus className="w-4 h-4" />
                <span>Pengeluaran</span>
              </button>

              {/* 2. Tombol di sebelah kanannya Pengeluaran > Metode Pembayaran */}
              <button
                type="button"
                onClick={() => setShowPaymentMethodModal(true)}
                className="px-4 py-2.5 rounded-xl bg-zinc-850 hover:bg-zinc-800 text-zinc-200 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border border-zinc-700 shadow-sm"
                title="Kelola Master Metode Pembayaran Pengeluaran"
              >
                <CreditCard className="w-4 h-4 text-cyan-400" />
                <span>Metode Pembayaran</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300 font-mono">
                  {expensePaymentMethods.length}
                </span>
              </button>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">No. Voucher</th>
                  <th className="py-3 px-4">Waktu</th>
                  <th className="py-3 px-4">Kategori Beban</th>
                  <th className="py-3 px-4">Penerima / Vendor</th>
                  <th className="py-3 px-4">Metode Bayar</th>
                  <th className="py-3 px-4">Otorisasi &amp; Bukti</th>
                  <th className="py-3 px-4 text-right">Nominal Pengeluaran</th>
                  <th className="py-3 px-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-zinc-500">
                      <p className="text-sm font-medium text-zinc-400">Belum ada catatan pengeluaran operasional.</p>
                      <p className="text-xs text-zinc-600 mt-1">Gunakan tombol &quot;Pengeluaran&quot; untuk mencatat biaya operasional toko.</p>
                    </td>
                  </tr>
                ) : (
                  expenses.map((exp) => (
                    <tr
                      key={exp.id}
                      onClick={() => openTransactionDetailModal(exp, 'CASH_OUT')}
                      className="hover:bg-zinc-800/40 cursor-pointer"
                    >
                      <td className="py-3 px-4 font-mono font-bold text-rose-400">{exp.id}</td>
                      <td className="py-3 px-4 text-zinc-400">{exp.date}</td>
                      <td className="py-3 px-4 font-bold text-white">{exp.category}</td>
                      <td className="py-3 px-4 text-zinc-300">{exp.recipient}</td>
                      <td className="py-3 px-4 text-zinc-400">{exp.method}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-300">
                            {exp.approver || 'Otoritas Toko'}
                          </span>
                          {exp.hasReceiptAttachment && (
                            <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800">
                              Nota OK
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-rose-400">
                        -{fmtMoney(exp.amount || 0, activeCurrency)}
                      </td>
                      <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => openTransactionDetailModal(exp, 'CASH_OUT')}
                            title="Lihat Detail Pengeluaran"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 cursor-pointer transition"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingExpense(exp);
                              setNewExpCategory(exp.category || 'Operasional Toko');
                              setNewExpRecipient(exp.recipient || '');
                              setNewExpMethod(exp.method || 'Kas Kecil Kasir');
                              setNewExpAmount(String(exp.amount || ''));
                              setNewExpNote(exp.note || '');
                              setShowExpenseModal(true);
                            }}
                            title="Edit Pengeluaran"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 cursor-pointer transition"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={async () => {
                              if (exp.id) await deleteExpenseDoc(exp.id);
                            }}
                            title="Hapus Pengeluaran"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 cursor-pointer transition"
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

      {/* MODAL: DETAIL STRUK & RETUR (5.13 REFUND LOGIC) */}
      {showDetailModal && selectedTrx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-white text-base">Detail Struk Transaksi POS</h3>
              </div>
              <button
                onClick={() => setShowDetailModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {(() => {
                const { modal, keuntungan, totalNilai } = calcTransactionModalAndProfit(selectedTrx, products);
                return (
                  <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">ID Transaksi:</span>
                      <span className="font-mono font-bold text-blue-400">{selectedTrx.id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Waktu:</span>
                      <span className="text-zinc-300">{new Date(selectedTrx.createdAt).toLocaleString('id-ID')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Pelanggan:</span>
                      <span className="text-white font-bold">{selectedTrx.customerName || 'Pelanggan Umum'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Kasir Bertugas:</span>
                      <span className="text-blue-400 font-bold">
                        {selectedTrx.cashierName || (selectedTrx.channel === 'pwa' ? 'Client PWA' : 'Admin Utama (Owner)')}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Pengirim / Kurir:</span>
                      <span className="text-cyan-400 font-bold">
                        {(selectedTrx as any).deliveryStaffName
                          ? `${(selectedTrx as any).deliveryStaffName} (${(selectedTrx as any).deliveryStaffRole || 'Shipper'})`
                          : 'Ambil Sendiri di Toko'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-zinc-500">Metode &amp; Status Bayar:</span>
                      <div className="flex items-center gap-2">
                        <span className="uppercase text-amber-400 font-bold">
                          {(selectedTrx as any).paymentMethodLabel || selectedTrx.paymentMethod}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            (selectedTrx as any).paymentStatus === 'unpaid'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          }`}
                        >
                          {(selectedTrx as any).paymentStatus === 'unpaid' ? 'BELUM LUNAS' : 'LUNAS'}
                        </span>
                        {(selectedTrx as any).paymentStatus === 'unpaid' && (
                          <button
                            type="button"
                            onClick={() => handleSettleTransactionDirectly(selectedTrx)}
                            className="px-2.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition cursor-pointer"
                          >
                            Tandai Lunas
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Rincian Barang / Dus:</span>
                      <span className="text-zinc-300 text-right">{selectedTrx.cartonBreakdown || '1 Paket Belanja POS'}</span>
                    </div>
                    <div className="pt-2 border-t border-zinc-800 flex justify-between">
                      <span className="text-zinc-400">Modal (HPP):</span>
                      <span className="font-mono font-bold text-zinc-200">
                        {fmtMoney(modal, activeCurrency)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Keuntungan:</span>
                      <span className="font-mono font-bold text-emerald-400">
                        {fmtMoney(keuntungan, activeCurrency)}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-zinc-800 flex justify-between text-sm">
                      <span className="font-bold text-white">Total Nilai:</span>
                      <span className="font-mono font-black text-white">
                        {fmtMoney(totalNilai, activeCurrency)}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Anti Fraud Audit Tag */}
              <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 flex items-center justify-between">
                <span className="text-zinc-400">Audit Status Anti-Fraud AI:</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                  Bersih (Score: {selectedTrx.riskScore ?? 0})
                </span>
              </div>

              {/* Refund Notice or Trigger */}
              {!showRefundModal ? (
                <div className="pt-2 flex justify-between items-center gap-2">
                  <button
                    onClick={async () => {
                      // Hak Akses: cetak ulang struk hari sebelumnya wajib PIN; Printer Struk: format sesuai pengaturan
                      const st = getPosSettings();
                      const created = (selectedTrx as any).createdAt || (selectedTrx as any).timestamp;
                      if (st.requirePinForReprintOld && created && dayKeyTz(created) !== dayKeyTz(new Date())) {
                        const ok = await requestApproval('Cetak ulang struk dari hari sebelumnya', 'REPRINT_OLD_RECEIPT');
                        if (!ok) return;
                      }
                      try {
                        await printReceipt({ ...(selectedTrx as any), isReprint: true }, st);
                        void logAudit({
                          action: 'RECEIPT_REPRINT',
                          target: `Cetak ulang struk ${(selectedTrx as any).orderNumber || selectedTrx.id}`,
                        });
                      } catch (err: any) {
                        alert(`Gagal cetak: ${err?.message || err}`);
                      }
                    }}
                    className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 transition flex items-center gap-1.5"
                    title="Cetak Struk ke Printer Thermal"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Cetak Struk Ulang</span>
                  </button>

                  <button
                    onClick={() => setShowRefundModal(true)}
                    className="px-4 py-2 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-500 transition flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Proses Retur / Refund</span>
                  </button>
                </div>
              ) : (
                <form onSubmit={handleProcessRefund} className="p-4 bg-rose-950/20 border border-rose-900/40 rounded-xl space-y-3">
                  <h4 className="font-bold text-white text-xs flex items-center gap-1.5 text-rose-400">
                    <RotateCcw className="w-4 h-4" />
                    <span>Form Otorisasi Retur &amp; Penyesuaian Kas/Stok</span>
                  </h4>
                  <div>
                    <label className="block text-zinc-400 mb-1">Alasan Retur / Pembatalan:</label>
                    <select
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-white text-xs"
                    >
                      <option value="Barang Rusak / Kemasan Cacat">Barang Rusak / Kemasan Cacat</option>
                      <option value="Produk Melewati Expired Date">Produk Melewati Expired Date</option>
                      <option value="Salah Input Kasir / Batal Beli">Salah Input Kasir / Batal Beli</option>
                      <option value="Customer Komplain Rasa / Isi">Customer Komplain Rasa / Isi</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">Nominal Refund (Rp):</label>
                    <input
                      type="number"
                      required
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-white font-mono font-bold text-xs"
                    />
                  </div>
                  {refundSuccessMsg && (
                    <div className="p-2 bg-emerald-950 text-emerald-300 rounded border border-emerald-800 text-[11px]">
                      {refundSuccessMsg}
                    </div>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowRefundModal(false)}
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 font-bold"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-500"
                    >
                      Konfirmasi Retur &amp; Kembalikan Stok
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: RECORD DEBT SETTLEMENT (PELUNASAN PIUTANG) */}
      {showDebtSettlementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              <Banknote className="w-5 h-5 text-emerald-400" />
              <span>Catat Pelunasan Piutang Kasbon</span>
            </h3>
            <p className="text-xs text-zinc-400">
              Pencatatan ini akan menambah kas/bank dan mengurangi saldo piutang pelanggan <strong>tanpa menggandakan omzet penjualan asli</strong>.
            </p>
            <form onSubmit={handleRecordDebtSettlement} className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Pilih / Ketik Nama Pelanggan:</label>
                {customersList.length > 0 ? (
                  <select
                    value={settlementCustomer}
                    onChange={(e) => setSettlementCustomer(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="">-- Pilih Pelanggan --</option>
                    {customersList.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name} - Sisa Kasbon {fmtMoney(Number(c.debtAmount || 0), activeCurrency)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    placeholder="Masukkan nama pelanggan..."
                    value={settlementCustomer}
                    onChange={(e) => setSettlementCustomer(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                  />
                )}
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Nominal Pembayaran Pelunasan (Rp):</label>
                <input
                  type="number"
                  required
                  value={settlementAmount}
                  onChange={(e) => setSettlementAmount(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Masuk ke Akun Kas/Bank:</label>
                <select
                  value={settlementAccount}
                  onChange={(e) => setSettlementAccount(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                >
                  <option value="Kas Kasir Tunai (Laci Shift)">Kas Kasir Tunai (Laci Shift)</option>
                  <option value="Rekening Bank BCA Toko">Rekening Bank BCA Toko</option>
                  <option value="Rekening Bank Mandiri Toko">Rekening Bank Mandiri Toko</option>
                </select>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Catatan Referensi:</label>
                <input
                  type="text"
                  value={settlementNote}
                  onChange={(e) => setSettlementNote(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowDebtSettlementModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-500"
                >
                  Simpan Pelunasan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD EXPENSE */}
      {showExpenseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-white text-base">
                {editingExpense ? 'Edit Pengeluaran Toko' : 'Catat Pengeluaran Toko'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowExpenseModal(false);
                  setEditingExpense(null);
                }}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddExpense} className="space-y-3 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-zinc-400 font-bold">Kategori Biaya:</label>
                  <button
                    type="button"
                    onClick={() => setShowCategoryModal(true)}
                    className="text-amber-400 hover:text-amber-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Kelola Kategori</span>
                  </button>
                </div>
                <select
                  value={newExpCategory}
                  onChange={(e) => setNewExpCategory(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                >
                  {expenseCategories.map((cat: any) => (
                    <option key={cat.id} value={cat.name}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 font-bold mb-1">Penerima / Vendor:</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Toko Kertas Jaya / Petugas PLN"
                  value={newExpRecipient}
                  onChange={(e) => setNewExpRecipient(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-zinc-400 font-bold">Metode Pembayaran:</label>
                  <button
                    type="button"
                    onClick={() => setShowPaymentMethodModal(true)}
                    className="text-cyan-400 hover:text-cyan-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Kelola Metode</span>
                  </button>
                </div>
                <select
                  value={newExpMethod}
                  onChange={(e) => setNewExpMethod(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                >
                  {expensePaymentMethods.map((pay: any) => (
                    <option key={pay.id} value={pay.name}>
                      {pay.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 font-bold mb-1">Nominal (Rp):</label>
                <input
                  type="number"
                  required
                  placeholder="100000"
                  value={newExpAmount}
                  onChange={(e) => setNewExpAmount(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold text-sm focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-bold mb-1">Keterangan / Nomor Bukti Nota:</label>
                <input
                  type="text"
                  placeholder="Nota kwitansi #..."
                  value={newExpNote}
                  onChange={(e) => setNewExpNote(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowExpenseModal(false);
                    setEditingExpense(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-500 cursor-pointer shadow-md"
                >
                  {editingExpense ? 'Simpan Perubahan' : 'Simpan Biaya'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: KELOLA KATEGORI BIAYA */}
      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-base">Kelola Kategori Biaya Pengeluaran</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCategoryModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Input Form Tambah Kategori */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newCategoryInput.trim()) return;
                await addExpenseCategoryDoc({
                  name: newCategoryInput.trim(),
                  createdAt: new Date().toISOString(),
                });
                setNewExpCategory(newCategoryInput.trim());
                setNewCategoryInput('');
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                required
                placeholder="Nama kategori biaya baru..."
                value={newCategoryInput}
                onChange={(e) => setNewCategoryInput(e.target.value)}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer transition shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah</span>
              </button>
            </form>

            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
              <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                Daftar Kategori Aktif ({expenseCategories.length})
              </div>
              {expenseCategories.map((cat: any) => (
                <div
                  key={cat.id}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/70 border border-zinc-850 hover:border-zinc-700 transition text-xs"
                >
                  <div className="flex items-center gap-2 text-zinc-200">
                    <Tag className="w-3.5 h-3.5 text-amber-400" />
                    <span className="font-medium">{cat.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteExpenseCategoryDoc(cat.id)}
                    className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition cursor-pointer"
                    title="Hapus Kategori"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-zinc-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowCategoryModal(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold cursor-pointer"
              >
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: KELOLA METODE PEMBAYARAN */}
      {showPaymentMethodModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-cyan-400" />
                <h3 className="font-bold text-white text-base">Kelola Metode Pembayaran Pengeluaran</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPaymentMethodModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Input Form Tambah Metode Pembayaran */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newPaymentMethodInput.trim()) return;
                await addExpensePaymentMethodDoc({
                  name: newPaymentMethodInput.trim(),
                  createdAt: new Date().toISOString(),
                });
                setNewExpMethod(newPaymentMethodInput.trim());
                setNewPaymentMethodInput('');
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                required
                placeholder="Nama metode pembayaran baru..."
                value={newPaymentMethodInput}
                onChange={(e) => setNewPaymentMethodInput(e.target.value)}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer transition shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah</span>
              </button>
            </form>

            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
              <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                Daftar Metode Pembayaran Aktif ({expensePaymentMethods.length})
              </div>
              {expensePaymentMethods.map((pay: any) => (
                <div
                  key={pay.id}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/70 border border-zinc-855 hover:border-zinc-700 transition text-xs"
                >
                  <div className="flex items-center gap-2 text-zinc-200">
                    <CreditCard className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="font-medium">{pay.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteExpensePaymentMethodDoc(pay.id)}
                    className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition cursor-pointer"
                    title="Hapus Metode"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-zinc-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowPaymentMethodModal(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold cursor-pointer"
              >
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT TRANSACTION */}
      {editingTrx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-white text-base">Edit Transaksi #{editingTrx.id}</h3>
              <button onClick={() => setEditingTrx(null)} className="text-zinc-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEditTrx} className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Nama Pelanggan:</label>
                <input
                  type="text"
                  value={editTrxCustomer}
                  onChange={(e) => setEditTrxCustomer(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Metode Pembayaran:</label>
                <select
                  value={editTrxMethod}
                  onChange={(e) => setEditTrxMethod(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                >
                  <option value="cash">Tunai (Cash)</option>
                  <option value="qris">QRIS</option>
                  <option value="debt">Kasbon (Hutang)</option>
                  <option value="cod">COD</option>
                </select>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Total Transaksi (Rp):</label>
                <input
                  type="number"
                  value={editTrxAmount}
                  onChange={(e) => setEditTrxAmount(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button type="button" onClick={() => setEditingTrx(null)} className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold">
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-500">
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DETAIL INCOME / EXPENSE */}
      {(detailIncome || detailExpense) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-white text-base">
                {detailIncome ? 'Detail Pendapatan Masuk' : 'Detail Pengeluaran Toko'}
              </h3>
              <button
                onClick={() => {
                  setDetailIncome(null);
                  setDetailExpense(null);
                }}
                className="text-zinc-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">No. Referensi:</span>
                <span className="font-mono font-bold text-blue-400">{(detailIncome || detailExpense).id}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Waktu:</span>
                <span className="text-zinc-300">{(detailIncome || detailExpense).date}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Kategori:</span>
                <span className="font-bold text-white">{(detailIncome || detailExpense).category}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Pihak Terkait:</span>
                <span className="text-zinc-300">{(detailIncome || detailExpense).source || (detailIncome || detailExpense).recipient}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Nominal:</span>
                <span className="font-mono font-bold text-emerald-400">
                  {fmtMoney(Number((detailIncome || detailExpense).amount || 0), activeCurrency)}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Catatan:</span>
                <span className="text-zinc-300">{(detailIncome || detailExpense).note || '-'}</span>
              </div>
            </div>
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => {
                  setDetailIncome(null);
                  setDetailExpense(null);
                }}
                className="px-4 py-2 rounded-xl bg-zinc-800 text-white text-xs font-bold"
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
