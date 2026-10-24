import React, { useState, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { Transaction, TransactionStatus } from '../../types';
import { ACTIVE_STORE_ID } from '../../config/store';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Clock,
  DollarSign,
  Smartphone,
  Store as StoreIcon,
  Search,
  Filter,
  CheckCircle,
  XCircle,
  Eye,
  Edit2,
  Trash2,
  RefreshCw,
  Radio,
  MapPin,
  User,
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import { useLanguage } from '../../context/LanguageContext';
import { fmtMoney, calcTransactionModalAndProfit } from '../../utils/money';
import { openTransactionDetailModal } from '../common/GlobalModals';

export const TransactionDashboard: React.FC = () => {
  const { currencyMode } = useLanguage();
  const { transactions: ctxTransactions, products, loadingTransactions } = useAppData();
  const [transactions, setTransactions] = useState<Transaction[]>(ctxTransactions);
  const [loading, setLoading] = useState<boolean>(loadingTransactions);
  const [activeFilter, setActiveFilter] = useState<'all' | 'flagged' | 'pending' | 'completed'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCashierName, setEditCashierName] = useState('');
  const [editTotalAmount, setEditTotalAmount] = useState(0);
  const [newTxAlert, setNewTxAlert] = useState<string | null>(null);

  // Sync from centralized AppDataContext (0 extra Firestore reads on navigation)
  useEffect(() => {
    setTransactions(ctxTransactions);
    setLoading(loadingTransactions);
  }, [ctxTransactions, loadingTransactions]);

  // Helper to resolve cashier name for a transaction
  const getCashierDisplay = (tx: Transaction) => {
    if (tx.cashierName && tx.cashierName.trim()) return tx.cashierName;
    if (tx.channel === 'pwa') return 'Client PWA (Self-Order)';
    return 'Admin Utama (Owner)';
  };

  // Filter transactions
  const filteredTransactions = transactions.filter((tx) => {
    const matchesFilter =
      activeFilter === 'all'
        ? true
        : activeFilter === 'flagged'
        ? tx.status === 'flagged_fraud' || tx.fraudScore >= 70
        : activeFilter === 'pending'
        ? tx.status === 'pending_approval'
        : tx.status === 'completed';

    const cashierLabel = getCashierDisplay(tx).toLowerCase();
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      tx.id.toLowerCase().includes(q) ||
      (tx.customerName || '').toLowerCase().includes(q) ||
      cashierLabel.includes(q) ||
      (tx.cashierId && tx.cashierId.toLowerCase().includes(q)) ||
      (tx.customerPhone && tx.customerPhone.includes(searchTerm)) ||
      (tx.fraudFlags && tx.fraudFlags.some((f) => f.toLowerCase().includes(q)));

    return matchesFilter && matchesSearch;
  });

  // Calculate live KPI metrics
  const completedTransactions = transactions.filter((tx) => tx.status === 'completed');
  const totalVolume = completedTransactions.reduce((sum, tx) => sum + (tx.totalAmount || 0), 0);
  const totalModal = completedTransactions.reduce(
    (sum, tx) => sum + calcTransactionModalAndProfit(tx, products).modal,
    0
  );
  const totalKeuntungan = totalVolume - totalModal;
  const flaggedCount = transactions.filter(
    (tx) => tx.status === 'flagged_fraud' || tx.fraudScore >= 70
  ).length;
  const pendingCount = transactions.filter((tx) => tx.status === 'pending_approval').length;
  const fraudRate = transactions.length > 0 ? ((flaggedCount / transactions.length) * 100).toFixed(1) : '0';

  // Approve a transaction
  const handleApprove = async (txId: string) => {
    try {
      const payload = {
        status: 'completed' as TransactionStatus,
        reviewedBy: 'Store Manager',
        reviewedAt: new Date().toISOString(),
      };
      await updateDoc(doc(db, 'transactions', txId), payload).catch(() => {});
      await updateDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', txId), payload).catch(() => {});
      if (selectedTx && selectedTx.id === txId) {
        setSelectedTx({ ...selectedTx, status: 'completed' });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `transactions/${txId}`);
    }
  };

  // Reject a transaction
  const handleReject = async (txId: string) => {
    try {
      const payload = {
        status: 'rejected' as TransactionStatus,
        reviewedBy: 'Store Manager',
        reviewedAt: new Date().toISOString(),
      };
      await updateDoc(doc(db, 'transactions', txId), payload).catch(() => {});
      await updateDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', txId), payload).catch(() => {});
      if (selectedTx && selectedTx.id === txId) {
        setSelectedTx({ ...selectedTx, status: 'rejected' });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `transactions/${txId}`);
    }
  };


  return (
    <div className="space-y-6">
      {/* Top Banner alert on real-time arrival */}
      {newTxAlert && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 animate-pulse">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 animate-ping text-emerald-400" />
            <span className="font-semibold text-sm">{newTxAlert}</span>
          </div>
          <span className="text-xs text-emerald-300">Live Firestore Snapshot</span>
        </div>
      )}

      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Live Transactions</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Real-Time Feed
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Real-time anti-fraud monitoring, GPS geofence tracking, and automated carton conversion audit.
          </p>
        </div>
      </div>

      {/* KPI Stats Grid: Modal | Keuntungan | Total Nilai | Total Transactions | Fraud Flag Rate | Pending Review */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold uppercase tracking-wider">
            <span>Modal</span>
            <DollarSign className="w-4 h-4 text-zinc-400" />
          </div>
          <div className="mt-2 text-xl font-bold font-mono text-zinc-200">
            {fmtMoney(totalModal, currencyMode)}
          </div>
          <div className="text-xs text-zinc-500 mt-1">Total HPP transaksi selesai</div>
        </div>

        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold uppercase tracking-wider">
            <span>Keuntungan</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-xl font-bold font-mono text-emerald-400">
            {fmtMoney(totalKeuntungan, currencyMode)}
          </div>
          <div className="text-xs text-emerald-500/80 mt-1">Total Nilai - Modal</div>
        </div>

        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold uppercase tracking-wider">
            <span>Total Nilai</span>
            <DollarSign className="w-4 h-4 text-blue-400" />
          </div>
          <div className="mt-2 text-xl font-bold font-mono text-white">
            {fmtMoney(totalVolume, currencyMode)}
          </div>
          <div className="text-xs text-zinc-500 mt-1">Verified sales across POS &amp; PWA</div>
        </div>

        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold uppercase tracking-wider">
            <span>Total Transaksi</span>
            <Clock className="w-4 h-4 text-blue-400" />
          </div>
          <div className="mt-2 text-xl font-bold text-white">{transactions.length}</div>
          <div className="text-xs text-zinc-500 mt-1">Real-time synchronized records</div>
        </div>

        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold uppercase tracking-wider">
            <span>Rasio Indikasi Fraud</span>
            <ShieldAlert className="w-4 h-4 text-rose-400" />
          </div>
          <div className="mt-2 text-xl font-bold text-rose-400">{fraudRate}%</div>
          <div className="text-xs text-zinc-500 mt-1">{flaggedCount} high-risk interventions</div>
        </div>

        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold uppercase tracking-wider">
            <span>Menunggu Tinjauan</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 text-xl font-bold text-amber-400">{pendingCount}</div>
          <div className="text-xs text-zinc-500 mt-1">Awaiting cashier / manager sign-off</div>
        </div>
      </div>

      {/* Filters and Search Bar */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              activeFilter === 'all'
                ? 'bg-zinc-700 text-white'
                : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            All ({transactions.length})
          </button>
          <button
            onClick={() => setActiveFilter('flagged')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
              activeFilter === 'flagged'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            Flagged Fraud ({flaggedCount})
          </button>
          <button
            onClick={() => setActiveFilter('pending')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
              activeFilter === 'pending'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            Pending Approval ({pendingCount})
          </button>
          <button
            onClick={() => setActiveFilter('completed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
              activeFilter === 'completed'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            Completed
          </button>
        </div>

        {/* Search */}
        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Cari ID, pelanggan, kasir, telepon..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition"
          />
        </div>
      </div>

      {/* Transactions Table / List */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-12 text-zinc-500">
            <RefreshCw className="w-6 h-6 animate-spin mb-2" />
            <p className="text-sm">Connecting to Firestore real-time stream...</p>
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm font-medium">No transactions matched your current filters.</p>
            <p className="text-xs text-zinc-600 mt-1">Try switching filters or simulating a new transaction.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Transaksi / Saluran</th>
                  <th className="py-3 px-4">Waktu</th>
                  <th className="py-3 px-4">Pelanggan</th>
                  <th className="py-3 px-4">Kasir</th>
                  <th className="py-3 px-4 text-right">Modal</th>
                  <th className="py-3 px-4 text-right">Keuntungan</th>
                  <th className="py-3 px-4 text-right">Total Nilai</th>
                  <th className="py-3 px-4">Skor Risiko Fraud</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filteredTransactions.map((tx) => {
                  const isHighFraud = tx.fraudScore >= 70 || tx.status === 'flagged_fraud';
                  const isPending = tx.status === 'pending_approval';
                  const { modal, keuntungan, totalNilai } = calcTransactionModalAndProfit(tx, products);

                  return (
                    <tr
                      key={tx.id}
                      onClick={() => openTransactionDetailModal(tx, 'SALE')}
                      className={`hover:bg-zinc-800/40 transition cursor-pointer ${
                        isHighFraud ? 'bg-rose-950/10' : isPending ? 'bg-amber-950/10' : ''
                      }`}
                    >
                      {/* ID and Channel */}
                      <td className="py-3 px-4">
                        <div className="font-mono font-semibold text-amber-400 hover:underline text-xs">
                          #{tx.id.slice(-8)}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          {tx.channel === 'pos' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                              <StoreIcon className="w-3 h-3" />
                              POS Terminal
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                              <Smartphone className="w-3 h-3" />
                              Client PWA
                            </span>
                          )}
                          <span className="text-[11px] uppercase font-mono text-zinc-500">
                            {tx.paymentMethod}
                          </span>
                        </div>
                      </td>

                      {/* Timestamp */}
                      <td className="py-3 px-4 text-xs text-zinc-400">
                        <div>
                          {new Date(tx.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5">
                          {new Date(tx.createdAt).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </div>
                      </td>

                      {/* Pelanggan */}
                      <td className="py-3 px-4">
                        <div className="font-medium text-white text-xs">{tx.customerName}</div>
                        <div className="flex items-center gap-2 mt-1 text-[11px]">
                          {tx.distanceToStoreMeters !== undefined && (
                            <span
                              className={`flex items-center gap-1 ${
                                tx.distanceToStoreMeters > 500
                                  ? 'text-rose-400 font-medium'
                                  : 'text-zinc-400'
                              }`}
                            >
                              <MapPin className="w-3 h-3" />
                              {tx.distanceToStoreMeters > 1000
                                ? `${(tx.distanceToStoreMeters / 1000).toFixed(1)} km`
                                : `${tx.distanceToStoreMeters} m`}
                            </span>
                          )}
                          {tx.customerPhone && (
                            <span className="text-zinc-500 font-mono">{tx.customerPhone}</span>
                          )}
                        </div>
                      </td>

                      {/* Kasir */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="w-6 h-6 rounded-full bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
                            <User className="w-3.5 h-3.5" />
                          </span>
                          <div>
                            <div className="font-semibold text-white text-xs">
                              {getCashierDisplay(tx)}
                            </div>
                            <div className="text-[10px] text-zinc-500 font-mono">
                              {tx.cashierRole || (tx.channel === 'pwa' ? 'PWA Online' : 'Kasir POS')}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Modal */}
                      <td className="py-3 px-4 text-right font-mono text-zinc-300 text-sm whitespace-nowrap">
                        {fmtMoney(modal, currencyMode)}
                      </td>

                      {/* Keuntungan */}
                      <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-400 text-sm whitespace-nowrap">
                        {fmtMoney(keuntungan, currencyMode)}
                      </td>

                      {/* Total Nilai */}
                      <td className="py-3 px-4 text-right font-mono font-semibold text-white text-sm whitespace-nowrap">
                        {fmtMoney(totalNilai, currencyMode)}
                      </td>

                      {/* Fraud Score */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div
                            className={`px-2 py-0.5 rounded-full text-xs font-bold font-mono flex items-center gap-1 ${
                              tx.fraudScore >= 75
                                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                : tx.fraudScore >= 45
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            }`}
                          >
                            {tx.fraudScore >= 75 ? (
                              <ShieldAlert className="w-3 h-3 text-rose-400" />
                            ) : tx.fraudScore >= 45 ? (
                              <AlertTriangle className="w-3 h-3 text-amber-400" />
                            ) : (
                              <ShieldCheck className="w-3 h-3 text-emerald-400" />
                            )}
                            {tx.fraudScore}/100
                          </div>
                        </div>

                        {/* Top Flag */}
                        {tx.fraudFlags && tx.fraudFlags.length > 0 && (
                          <div className="text-[10px] text-zinc-500 mt-1 truncate max-w-[150px]">
                            {tx.fraudFlags[0]}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                            tx.status === 'completed'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : tx.status === 'flagged_fraud'
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              : tx.status === 'pending_approval'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-zinc-700/40 text-zinc-400'
                          }`}
                        >
                          {tx.status.replace('_', ' ')}
                        </span>
                      </td>

                      {/* Action buttons */}
                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openTransactionDetailModal(tx, 'SALE')}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950 text-amber-400 hover:text-amber-300 border border-amber-500/30 transition cursor-pointer"
                            title="Lihat Detail & Fulfillment"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingTx(tx);
                              setEditCustomerName(tx.customerName || '');
                              setEditCashierName(getCashierDisplay(tx));
                              setEditTotalAmount(tx.totalAmount || 0);
                            }}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950 text-zinc-300 hover:text-amber-400 transition cursor-pointer"
                            title="Edit Transaksi"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={async () => {
                              await deleteDoc(doc(db, 'transactions', tx.id)).catch(() => {});
                              await deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', tx.id)).catch(() => {});
                            }}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950 text-zinc-300 hover:text-rose-400 transition cursor-pointer"
                            title="Hapus Transaksi"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>

                          {(tx.status === 'pending_approval' || tx.status === 'flagged_fraud') && (
                            <>
                              <button
                                onClick={() => handleApprove(tx.id)}
                                className="p-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-500/30 transition"
                                title="Approve Transaction"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleReject(tx.id)}
                                className="p-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/40 text-rose-400 border border-rose-500/30 transition"
                                title="Reject Transaction"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Forensic AI Fraud Details Modal */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-mono text-zinc-500">Transaction Investigation</span>
                <h3 className="text-lg font-bold text-white mt-0.5">#{selectedTx.id}</h3>
              </div>
              <button
                onClick={() => setSelectedTx(null)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700"
              >
                ✕
              </button>
            </div>

            {/* Score & Risk Level */}
            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between">
              <div>
                <div className="text-xs text-zinc-400">Risk Assessment Score</div>
                <div className="text-2xl font-black mt-1 text-white">
                  {selectedTx.fraudScore}
                  <span className="text-sm font-normal text-zinc-500"> / 100</span>
                </div>
              </div>
              <div
                className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                  selectedTx.fraudScore >= 75
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    : selectedTx.fraudScore >= 45
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                }`}
              >
                {selectedTx.riskLevel} Risk
              </div>
            </div>

            {/* AI Forensic Rationale */}
            <div>
              <div className="text-xs font-semibold uppercase text-zinc-400 mb-1">
                Gemini Preventive AI Explanation
              </div>
              <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 leading-relaxed">
                {selectedTx.aiExplanation || 'No AI explanation generated.'}
              </div>
            </div>

            {/* Triggered Flags */}
            <div>
              <div className="text-xs font-semibold uppercase text-zinc-400 mb-1.5">
                Triggered Heuristic Flags
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedTx.fraudFlags && selectedTx.fraudFlags.length > 0 ? (
                  selectedTx.fraudFlags.map((flag, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700"
                    >
                      {flag}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-zinc-500">No flags triggered.</span>
                )}
              </div>
            </div>

            {/* Financial Breakdown: Modal | Keuntungan | Total Nilai */}
            {(() => {
              const { modal, keuntungan, totalNilai } = calcTransactionModalAndProfit(selectedTx, products);
              return (
                <div className="grid grid-cols-3 gap-3 text-xs bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                  <div>
                    <span className="text-zinc-500 block uppercase text-[10px] font-bold">Modal</span>
                    <span className="font-mono font-semibold text-zinc-200">
                      {fmtMoney(modal, currencyMode)}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block uppercase text-[10px] font-bold">Keuntungan</span>
                    <span className="font-mono font-semibold text-emerald-400">
                      {fmtMoney(keuntungan, currencyMode)}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block uppercase text-[10px] font-bold">Total Nilai</span>
                    <span className="font-mono font-semibold text-white">
                      {fmtMoney(totalNilai, currencyMode)}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* GPS Telemetry & Cashier Breakdown */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-zinc-950 p-3 rounded-lg border border-zinc-800">
              <div>
                <span className="text-zinc-500 block">Kasir Bertugas</span>
                <span className="font-semibold text-blue-400">
                  {getCashierDisplay(selectedTx)}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">Pelanggan</span>
                <span className="font-semibold text-white">
                  {selectedTx.customerName || 'Pelanggan Umum'}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">Distance to Storefront</span>
                <span
                  className={`font-semibold ${
                    (selectedTx.distanceToStoreMeters || 0) > 500
                      ? 'text-rose-400'
                      : 'text-zinc-200'
                  }`}
                >
                  {selectedTx.distanceToStoreMeters !== undefined
                    ? `${selectedTx.distanceToStoreMeters} meters`
                    : 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">GPS Sensor Accuracy</span>
                <span className="font-semibold text-zinc-200">
                  {selectedTx.gpsAccuracy !== undefined ? `±${selectedTx.gpsAccuracy}m` : 'POS Stationary'}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">Mock GPS Spoofing</span>
                <span
                  className={`font-semibold ${
                    selectedTx.isMockGpsSuspected ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {selectedTx.isMockGpsSuspected ? 'Suspected / Flagged' : 'Normal Hardware'}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">Current Status</span>
                <span className="font-semibold text-zinc-200 capitalize">
                  {selectedTx.status.replace('_', ' ')}
                </span>
              </div>
            </div>

            {/* Actions in Modal */}
            <div className="pt-2 flex items-center justify-end gap-2">
              {selectedTx.status !== 'completed' && (
                <button
                  onClick={() => handleApprove(selectedTx.id)}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
                >
                  Approve Transaction
                </button>
              )}
              {selectedTx.status !== 'rejected' && (
                <button
                  onClick={() => handleReject(selectedTx.id)}
                  className="px-4 py-2 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-semibold transition"
                >
                  Reject & Freeze
                </button>
              )}
              <button
                onClick={() => setSelectedTx(null)}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Transaction Modal */}
      {editingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-white">Edit Transaksi #{editingTx.id.slice(-8)}</h3>
              <button onClick={() => setEditingTx(null)} className="text-zinc-400 hover:text-white">✕</button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const payload = {
                  customerName: editCustomerName,
                  cashierName: editCashierName,
                  totalAmount: Number(editTotalAmount) || 0,
                };
                await updateDoc(doc(db, 'transactions', editingTx.id), payload).catch(() => {});
                await updateDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', editingTx.id), payload).catch(() => {});
                setEditingTx(null);
              }}
              className="space-y-3 text-xs"
            >
              <div>
                <label className="block text-zinc-400 mb-1">Nama Pelanggan</label>
                <input
                  type="text"
                  value={editCustomerName}
                  onChange={(e) => setEditCustomerName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Nama Kasir</label>
                <input
                  type="text"
                  value={editCashierName}
                  onChange={(e) => setEditCashierName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Total Nominal</label>
                <input
                  type="number"
                  step="any"
                  value={editTotalAmount}
                  onChange={(e) => setEditTotalAmount(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white font-mono"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditingTx(null)} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 font-bold">
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold">
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
