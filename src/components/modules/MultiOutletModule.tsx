import React, { useState, useEffect } from 'react';
import {
  Store,
  Warehouse,
  MapPin,
  Building2,
  Phone,
  DollarSign,
  TrendingUp,
  CreditCard,
  AlertTriangle,
  Boxes,
  Calendar,
  Filter,
  Plus,
  Eye,
  Edit2,
  Trash2,
  X,
  Check,
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, limit, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { Product, Transaction } from '../../types';
import { fmtMoney } from '../../utils/money';
import {
  computeReport,
  ReportPeriod,
  OutletFilterId,
  OutletItem,
  WarehouseItem,
} from './multiOutletReport';
import { ReportCharts, ReportDetailTarget } from './ReportCharts';
import { ReportDetailPanel } from './ReportDetailPanel';
import { useAppNavigation } from '../../router';
import { useAppData } from '../../context/AppDataContext';

interface MultiOutletModuleProps {
  subModule: 'lihat_outlet' | 'warehose';
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

export const MultiOutletModule: React.FC<MultiOutletModuleProps> = ({
  subModule,
  currencyMode = 'IDR',
  onNavigateTab,
}) => {
  const { route, navigateTab } = useAppNavigation();
  const activeSub = (
    route.activeTab === 'module_multi_outlet' ? route.activeSubModule : subModule
  ) as 'lihat_outlet' | 'warehose';
  const setActiveSub = (next: 'lihat_outlet' | 'warehose') => {
    navigateTab('module_multi_outlet', next);
  };
  const [period, setPeriod] = useState<ReportPeriod>('30d');
  const [outletIdFilter, setOutletIdFilter] = useState<OutletFilterId>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Centralized Global State from AppDataContext (0 duplicate Firestore reads for transactions & products)
  const {
    transactions,
    products,
    loadingTransactions: loading,
  } = useAppData();

  const [outlets, setOutlets] = useState<OutletItem[]>(() => {
    try {
      const raw = localStorage.getItem('riskcart_cache_outlets');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const [warehouses, setWarehouses] = useState<WarehouseItem[]>(() => {
    try {
      const raw = localStorage.getItem('riskcart_cache_warehouses');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  // Modals for CRUD
  const [showAddOutletModal, setShowAddOutletModal] = useState(false);
  const [editingOutlet, setEditingOutlet] = useState<OutletItem | null>(null);
  const [outletFormName, setOutletFormName] = useState('');
  const [outletFormCode, setOutletFormCode] = useState('');
  const [outletFormAddress, setOutletFormAddress] = useState('');
  const [outletFormPhone, setOutletFormPhone] = useState('');
  const [outletFormIsHq, setOutletFormIsHq] = useState(false);

  const [showAddWhModal, setShowAddWhModal] = useState(false);
  const [editingWh, setEditingWh] = useState<WarehouseItem | null>(null);
  const [whFormName, setWhFormName] = useState('');
  const [whFormCode, setWhFormCode] = useState('');
  const [whFormManager, setWhFormManager] = useState('');
  const [whFormAddress, setWhFormAddress] = useState('');

  // Detail Drawer state
  const [detail, setDetail] = useState<ReportDetailTarget | null>(null);

  // Read outlets & warehouses via bounded onSnapshot with localStorage cache fallback
  useEffect(() => {
    const unsubOutlets = onSnapshot(
      query(collection(db, 'outlets'), limit(25)),
      (snapshot) => {
        const docs: OutletItem[] = [];
        snapshot.forEach((docSnap) => {
          docs.push({ id: docSnap.id, ...docSnap.data() } as OutletItem);
        });
        setOutlets(docs);
        try {
          localStorage.setItem('riskcart_cache_outlets', JSON.stringify(docs));
        } catch {}
      },
      (err) => console.warn('Notice reading outlets (retaining cache):', err)
    );

    const unsubWhs = onSnapshot(
      query(collection(db, 'warehouses'), limit(25)),
      (snapshot) => {
        const docs: WarehouseItem[] = [];
        snapshot.forEach((docSnap) => {
          docs.push({ id: docSnap.id, ...docSnap.data() } as WarehouseItem);
        });
        setWarehouses(docs);
        try {
          localStorage.setItem('riskcart_cache_warehouses', JSON.stringify(docs));
        } catch {}
      },
      (err) => console.warn('Notice reading warehouses (retaining cache):', err)
    );

    return () => {
      unsubOutlets();
      unsubWhs();
    };
  }, []);

  // Compute report data using single authority function
  const report = computeReport(
    transactions,
    products,
    {
      period,
      outletId: outletIdFilter,
    },
    outlets,
    warehouses
  );

  const { kpi, daily, byOutlet, byPayment, byLocation, filteredTransactions } = report;

  // Map outlet metrics by ID for quick lookup
  const outletMetricMap = new Map(byOutlet.map((o) => [o.outletId, o]));

  // Map location metrics by ID for warehouses
  const locationMetricMap = new Map(byLocation.map((l) => [l.locationId, l]));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <Store className="w-6 h-6 text-blue-500" />
            <h1 className="text-2xl font-black text-white tracking-tight">
              MULTI OUTLET ECOSYSTEM
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Dashboard analitik laporan transaksi, valuasi stok cabang, dan pergudangan terpusat (*Central Warehouse*).
          </p>
        </div>

        {/* Sub-Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-zinc-900 border border-zinc-800 rounded-xl">
          <button
            onClick={() => setActiveSub('lihat_outlet')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeSub === 'lihat_outlet'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Lihat Outlet</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/30 font-mono">
              {outlets.length}
            </span>
          </button>
          <button
            onClick={() => setActiveSub('warehose')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeSub === 'warehose'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Warehouse className="w-3.5 h-3.5" />
            <span>Warehose</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/30 font-mono">
              {warehouses.length}
            </span>
          </button>
        </div>
      </div>

      {/* VIEW: LIHAT OUTLET */}
      {activeSub === 'lihat_outlet' && (
        <div className="space-y-6">
          {/* Controls: Periode & Outlet Filter */}
          <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-2xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            {/* Periode filter */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5 mr-1">
                <Calendar className="w-3.5 h-3.5 text-blue-400" />
                Periode:
              </span>
              {(
                [
                  { id: 'today', label: 'Hari ini' },
                  { id: '7d', label: '7 Hari' },
                  { id: '30d', label: '30 Hari' },
                  { id: 'month', label: 'Bulan ini' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPeriod(p.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    period === p.id
                      ? 'bg-blue-600 text-white font-bold shadow-xs'
                      : 'bg-zinc-950 text-zinc-400 border border-zinc-800 hover:text-white hover:border-zinc-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Outlet selector filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-zinc-400" />
              <label htmlFor="outlet-select" className="text-xs text-zinc-400 font-medium">
                Outlet:
              </label>
              <select
                id="outlet-select"
                value={outletIdFilter}
                onChange={(e) => setOutletIdFilter(e.target.value as OutletFilterId)}
                className="bg-zinc-950 border border-zinc-800 text-white text-xs rounded-xl px-3 py-1.5 focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="all">Semua Cabang Toko</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* SKELETON LOADING STATE */}
          {loading ? (
            <div className="space-y-6 animate-pulse">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-28 bg-zinc-900 border border-zinc-800 rounded-2xl p-4" />
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="h-64 bg-zinc-900 border border-zinc-800 rounded-2xl" />
                <div className="h-64 bg-zinc-900 border border-zinc-800 rounded-2xl" />
              </div>
            </div>
          ) : (
            <>
              {/* 5 KARTU KPI */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
                {/* 1. Revenue */}
                <div
                  onClick={() => setDetail({ kind: 'revenue' })}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setDetail({ kind: 'revenue' });
                    }
                  }}
                  className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 hover:border-blue-500/60 transition cursor-pointer flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex items-center justify-between text-zinc-400 mb-1">
                      <span className="text-xs font-semibold">Total Revenue</span>
                      <div className="w-6 h-6 rounded-md bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                        <DollarSign className="w-3.5 h-3.5" />
                      </div>
                    </div>
                    <div className="font-black text-lg text-emerald-400 font-mono tracking-tight">
                      {fmtMoney(kpi.totalRevenue, currencyMode)}
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[11px]">
                    <span className="text-zinc-500">Omzet sukses</span>
                    <span className="text-blue-400 group-hover:text-blue-300 font-medium">
                      Lihat detail ›
                    </span>
                  </div>
                </div>

                {/* 2. Transaksi */}
                <div
                  onClick={() => setDetail({ kind: 'transaksi' })}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setDetail({ kind: 'transaksi' });
                    }
                  }}
                  className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 hover:border-blue-500/60 transition cursor-pointer flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex items-center justify-between text-zinc-400 mb-1">
                      <span className="text-xs font-semibold">Transaksi</span>
                      <div className="w-6 h-6 rounded-md bg-blue-500/10 text-blue-400 flex items-center justify-center">
                        <CreditCard className="w-3.5 h-3.5" />
                      </div>
                    </div>
                    <div className="font-black text-lg text-white font-mono tracking-tight">
                      {kpi.transactionsCount} Tx
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-zinc-800/80">
                    <p className="text-[10px] text-zinc-400 truncate">
                      {kpi.completedCount} selesai · {kpi.fraudCount} fraud · {kpi.pendingCount} pending
                    </p>
                    <div className="flex justify-end text-[11px] text-blue-400 group-hover:text-blue-300 font-medium mt-0.5">
                      Lihat detail ›
                    </div>
                  </div>
                </div>

                {/* 3. Profit Estimasi */}
                <div
                  onClick={() => setDetail({ kind: 'profit' })}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setDetail({ kind: 'profit' });
                    }
                  }}
                  className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 hover:border-blue-500/60 transition cursor-pointer flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex items-center justify-between text-zinc-400 mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold">Profit</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-950/80 text-amber-400 border border-amber-800/60">
                          Estimasi
                        </span>
                      </div>
                      <div className="w-6 h-6 rounded-md bg-amber-500/10 text-amber-400 flex items-center justify-center">
                        <TrendingUp className="w-3.5 h-3.5" />
                      </div>
                    </div>
                    <div className="font-black text-lg text-amber-400 font-mono tracking-tight">
                      {fmtMoney(kpi.totalProfit, currencyMode)}
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[11px]">
                    <span className="text-zinc-500">Margin kotor</span>
                    <span className="text-blue-400 group-hover:text-blue-300 font-medium">
                      Lihat detail ›
                    </span>
                  </div>
                </div>

                {/* 4. Nilai Stok */}
                <div
                  onClick={() => setDetail({ kind: 'stok' })}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setDetail({ kind: 'stok' });
                    }
                  }}
                  className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 hover:border-blue-500/60 transition cursor-pointer flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex items-center justify-between text-zinc-400 mb-1">
                      <span className="text-xs font-semibold">Nilai Stok</span>
                      <div className="w-6 h-6 rounded-md bg-purple-500/10 text-purple-400 flex items-center justify-center">
                        <Boxes className="w-3.5 h-3.5" />
                      </div>
                    </div>
                    <div className="font-black text-lg text-white font-mono tracking-tight">
                      {fmtMoney(kpi.totalStockValue, currencyMode)}
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[11px]">
                    <span className="text-zinc-500">COGS valuasi</span>
                    <span className="text-blue-400 group-hover:text-blue-300 font-medium">
                      Lihat detail ›
                    </span>
                  </div>
                </div>

                {/* 5. Stok Kritis */}
                <div
                  onClick={() => setDetail({ kind: 'stok' })}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setDetail({ kind: 'stok' });
                    }
                  }}
                  className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 hover:border-blue-500/60 transition cursor-pointer flex flex-col justify-between group col-span-2 lg:col-span-1"
                >
                  <div>
                    <div className="flex items-center justify-between text-zinc-400 mb-1">
                      <span className="text-xs font-semibold">Stok Kritis</span>
                      <div className="w-6 h-6 rounded-md bg-rose-500/10 text-rose-400 flex items-center justify-center">
                        <AlertTriangle className="w-3.5 h-3.5" />
                      </div>
                    </div>
                    <div
                      className={`font-black text-lg font-mono tracking-tight ${
                        kpi.criticalStockCount > 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {kpi.criticalStockCount} SKU
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-zinc-800/80">
                    <p className="text-[10px] text-zinc-400 truncate">
                      {kpi.habisCount} habis · {kpi.menipisCount} menipis
                    </p>
                    <div className="flex justify-end text-[11px] text-blue-400 group-hover:text-blue-300 font-medium mt-0.5">
                      Lihat detail ›
                    </div>
                  </div>
                </div>
              </div>

              {/* Empty state notice if filteredTransactions is empty */}
              {filteredTransactions.length === 0 && (
                <div className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl text-center text-xs text-zinc-400">
                  Belum ada transaksi di periode ini
                </div>
              )}

              {/* 4 GRAFIK SVG */}
              <ReportCharts
                daily={daily}
                byOutlet={byOutlet}
                byPayment={byPayment}
                byLocation={byLocation}
                currencyMode={currencyMode}
                onSelectDetail={(tgt) => setDetail(tgt)}
              />

              {/* OUTLETS CARDS SECTION */}
              <div className="space-y-3 pt-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-white text-base">Performa Cabang Toko Fisik</h3>
                    <p className="text-xs text-zinc-400">Daftar cabang aktif yang terhubung ke database Firestore.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative w-full sm:w-56">
                      <input
                        type="text"
                        placeholder="Cari nama atau kode cabang..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <button
                      onClick={() => {
                        setEditingOutlet(null);
                        setOutletFormName('');
                        setOutletFormCode(`OUT-${Date.now().toString().slice(-3)}`);
                        setOutletFormAddress('');
                        setOutletFormPhone('');
                        setOutletFormIsHq(outlets.length === 0);
                        setShowAddOutletModal(true);
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah Outlet</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {outlets.length === 0 ? (
                    <div className="col-span-3 p-8 bg-zinc-900 border border-zinc-800 rounded-2xl text-center space-y-3">
                      <Building2 className="w-8 h-8 text-zinc-600 mx-auto" />
                      <p className="text-sm font-bold text-zinc-300">Belum ada cabang outlet yang terdaftar di database.</p>
                      <p className="text-xs text-zinc-500 max-w-sm mx-auto">Tambahkan cabang toko fisik pertama Anda untuk memantau performa penjualan, kasir, dan stok.</p>
                      <button
                        onClick={() => {
                          setEditingOutlet(null);
                          setOutletFormName('Outlet Utama (Pusat)');
                          setOutletFormCode('RC-01');
                          setOutletFormAddress('Jl. Boulevard Raya Blok QF1 No. 12, Jakarta');
                          setOutletFormPhone('(021) 4587-9922');
                          setOutletFormIsHq(true);
                          setShowAddOutletModal(true);
                        }}
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition cursor-pointer"
                      >
                        + Tambah Outlet Pertama
                      </button>
                    </div>
                  ) : (
                    outlets
                      .filter(
                        (o) =>
                          o.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (o.code || '').toLowerCase().includes(searchQuery.toLowerCase())
                      )
                      .map((outlet) => {
                        const metrics = outletMetricMap.get(outlet.id);
                        const calculatedRevenue = metrics ? metrics.revenue : 0;
                        const calculatedTxCount = metrics ? metrics.totalTransactions : 0;
                        const calculatedCompleted = metrics ? metrics.completedCount : 0;
                        const calculatedStockValue = metrics ? metrics.stockValue : 0;
                        const calculatedCritical = metrics ? metrics.criticalStockCount : 0;

                        return (
                          <div
                            key={outlet.id}
                            className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 hover:border-blue-500/60 transition flex flex-col justify-between group"
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2 mb-3">
                                <div>
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <span className="font-mono text-[10px] font-bold text-blue-400 bg-blue-950/60 border border-blue-800/60 px-1.5 py-0.5 rounded">
                                      {outlet.code || outlet.id}
                                    </span>
                                    {outlet.isHQ && (
                                      <span className="text-[10px] font-bold text-amber-400 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.5 rounded">
                                        HEADQUARTERS
                                      </span>
                                    )}
                                  </div>
                                  <h3 className="font-black text-white text-base leading-snug group-hover:text-blue-400 transition">
                                    {outlet.name}
                                  </h3>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => setDetail({ kind: 'outlet', id: outlet.id })}
                                    title="Lihat Detail Outlet"
                                    className="p-1 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-300 hover:text-blue-400 transition cursor-pointer"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingOutlet(outlet);
                                      setOutletFormName(outlet.name);
                                      setOutletFormCode(outlet.code || '');
                                      setOutletFormAddress(outlet.address || '');
                                      setOutletFormPhone(outlet.phone || '');
                                      setOutletFormIsHq(Boolean(outlet.isHQ));
                                      setShowAddOutletModal(true);
                                    }}
                                    title="Edit Outlet"
                                    className="p-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-blue-400 transition cursor-pointer"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (window.confirm(`Hapus outlet "${outlet.name}" dari database?`)) {
                                        await deleteDoc(doc(db, 'outlets', outlet.id));
                                      }
                                    }}
                                    title="Hapus Outlet"
                                    className="p-1 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              <p className="text-xs text-zinc-400 flex items-start gap-1.5 mb-4 line-clamp-2">
                                <MapPin className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />
                                <span>{outlet.address || '-'}</span>
                              </p>

                              <div className="space-y-2 pt-3 border-t border-zinc-800/80 text-xs">
                                <div className="flex justify-between text-zinc-400">
                                  <span>Revenue Periode:</span>
                                  <span className="font-mono font-bold text-emerald-400">
                                    {fmtMoney(calculatedRevenue, currencyMode)}
                                  </span>
                                </div>
                                <div className="flex justify-between text-zinc-400">
                                  <span>Transaksi:</span>
                                  <span className="font-mono font-bold text-white">
                                    {calculatedCompleted} Selesai ({calculatedTxCount} Total)
                                  </span>
                                </div>
                                <div className="flex justify-between text-zinc-400">
                                  <span>Valuasi Stok Toko:</span>
                                  <span className="font-mono font-bold text-zinc-200">
                                    {fmtMoney(calculatedStockValue, currencyMode)}
                                  </span>
                                </div>
                                <div className="flex justify-between text-zinc-400">
                                  <span>Stok Kritis:</span>
                                  <span
                                    className={`font-mono font-bold ${
                                      calculatedCritical > 0 ? 'text-rose-400' : 'text-zinc-300'
                                    }`}
                                  >
                                    {calculatedCritical} SKU
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="pt-4 mt-4 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                              <span className="text-[11px] text-zinc-500 flex items-center gap-1">
                                <Phone className="w-3 h-3" />
                                {outlet.phone || '-'}
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setDetail({ kind: 'outlet', id: outlet.id })}
                                  className="text-[11px] text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
                                >
                                  Lihat detail ›
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (onNavigateTab) onNavigateTab('pos_machine');
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-[11px] font-bold transition cursor-pointer"
                                >
                                  Buka POS
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* VIEW: WAREHOSE */}
      {activeSub === 'warehose' && (
        <div className="space-y-6">
          <div className="bg-purple-950/20 border border-purple-900/40 rounded-2xl p-5 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/40 text-purple-400 flex items-center justify-center shrink-0">
                <Warehouse className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">
                  Gudang Utama &amp; Pusat Distribusi Karton (Warehose)
                </h3>
                <p className="text-xs text-zinc-400">
                  Restock dus/karton dari supplier dibongkar muat di Central Warehouse sebelum didistribusikan ke outlet satelit.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setEditingWh(null);
                  setWhFormName('');
                  setWhFormCode(`WH-${Date.now().toString().slice(-3)}`);
                  setWhFormManager('Kepala Gudang');
                  setWhFormAddress('');
                  setShowAddWhModal(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold transition shadow-sm cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Gudang</span>
              </button>
              <button
                onClick={() => onNavigateTab && onNavigateTab('restock')}
                className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition shadow-sm cursor-pointer"
              >
                Lihat Rekomendasi Restock
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {warehouses.map((wh) => {
              const whMetrics = locationMetricMap.get(wh.id);
              const calculatedCartons = whMetrics ? whMetrics.cartonsStored : 0;
              const calculatedStockValue = whMetrics ? whMetrics.stockValue : 0;
              const calculatedCritical = whMetrics ? whMetrics.criticalCount : 0;

              return (
                <div
                  key={wh.id}
                  onClick={() => setDetail({ kind: 'gudang', id: wh.id })}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setDetail({ kind: 'gudang', id: wh.id });
                    }
                  }}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4 hover:border-blue-500/60 transition cursor-pointer group"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono text-[10px] font-bold text-purple-400 bg-purple-950/60 border border-purple-800/60 px-2 py-0.5 rounded">
                        {wh.code}
                      </span>
                      <h3 className="font-black text-white text-lg mt-1 group-hover:text-purple-400 transition">
                        {wh.name}
                      </h3>
                      <p className="text-xs text-zinc-400 flex items-center gap-1 mt-1">
                        <MapPin className="w-3.5 h-3.5 text-zinc-500" />
                        {wh.address}
                      </p>
                    </div>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 mr-1">
                        OPERASIONAL
                      </span>
                      <button
                        type="button"
                        onClick={() => setDetail({ kind: 'gudang', id: wh.id })}
                        title="Lihat Detail Gudang"
                        className="p-1 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-300 hover:text-blue-400 transition cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingWh(wh);
                          setWhFormName(wh.name);
                          setWhFormCode(wh.code || '');
                          setWhFormManager(wh.manager || '');
                          setWhFormAddress(wh.address || '');
                          setShowAddWhModal(true);
                        }}
                        title="Edit Gudang"
                        className="p-1 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-300 hover:text-amber-400 transition cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (window.confirm(`Hapus gudang "${wh.name}" dari database?`)) {
                            await deleteDoc(doc(db, 'warehouses', wh.id));
                          }
                        }}
                        title="Hapus Gudang"
                        className="p-1 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Capacity Bar (Master Data) */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Kapasitas Muat:</span>
                      <span className="font-mono font-bold text-white">{wh.capacityPct ?? 0}% Terisi</span>
                    </div>
                    <div className="w-full bg-zinc-950 rounded-full h-2 overflow-hidden border border-zinc-800">
                      <div
                        className={`h-full rounded-full ${
                          (wh.capacityPct ?? 0) > 85 ? 'bg-rose-500' : 'bg-purple-500'
                        }`}
                        style={{ width: `${wh.capacityPct ?? 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Computed Metrics */}
                  <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                    <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/60">
                      <span className="text-zinc-500 block text-[10px]">Stok Karton (Dus):</span>
                      <span className="font-mono font-bold text-white text-base">
                        {calculatedCartons.toLocaleString('id-ID')} Dus
                      </span>
                    </div>
                    <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/60">
                      <span className="text-zinc-500 block text-[10px]">Nilai Stok Gudang:</span>
                      <span className="font-mono font-bold text-emerald-400 text-sm">
                        {fmtMoney(calculatedStockValue, currencyMode)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/60">
                      <span className="text-zinc-500 block text-[10px]">Kepala Gudang:</span>
                      <span className="font-bold text-zinc-200 text-xs">{wh.manager}</span>
                    </div>
                    <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/60">
                      <span className="text-zinc-500 block text-[10px]">Produk Kritis:</span>
                      <span
                        className={`font-mono font-bold text-xs ${
                          calculatedCritical > 0 ? 'text-rose-400' : 'text-emerald-400'
                        }`}
                      >
                        {calculatedCritical} SKU
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-zinc-800 text-zinc-400">
                    <span>Kondisi Ruangan: {wh.temperature}</span>
                    <span className="text-blue-400 group-hover:text-blue-300 font-semibold text-[11px]">
                      Lihat detail ›
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* DETAIL DRAWER COMPONENT */}
      <ReportDetailPanel
        detail={detail}
        onClose={() => setDetail(null)}
        currencyMode={currencyMode}
        report={report}
        period={period}
        outletId={outletIdFilter}
        allTransactions={transactions}
        allProducts={products}
        onNavigateTab={onNavigateTab}
      />

      {/* MODAL: TAMBAH / EDIT OUTLET */}
      {showAddOutletModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-white text-base">
                {editingOutlet ? 'Edit Cabang Outlet' : 'Tambah Cabang Outlet Baru'}
              </h3>
              <button onClick={() => setShowAddOutletModal(false)} className="text-zinc-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!outletFormName.trim()) return;
                const id = editingOutlet?.id || `outlet_${Date.now()}`;
                await setDoc(
                  doc(db, 'outlets', id),
                  {
                    id,
                    name: outletFormName.trim(),
                    code: outletFormCode.trim() || 'OUT-01',
                    address: outletFormAddress.trim() || '-',
                    phone: outletFormPhone.trim() || '-',
                    isHQ: outletFormIsHq,
                  },
                  { merge: true }
                );
                setShowAddOutletModal(false);
                setEditingOutlet(null);
              }}
              className="space-y-3 text-xs"
            >
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Nama Outlet *</label>
                <input
                  type="text"
                  required
                  value={outletFormName}
                  onChange={(e) => setOutletFormName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Kode Cabang</label>
                <input
                  type="text"
                  value={outletFormCode}
                  onChange={(e) => setOutletFormCode(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Alamat Lengkap</label>
                <input
                  type="text"
                  value={outletFormAddress}
                  onChange={(e) => setOutletFormAddress(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">No. Telepon</label>
                <input
                  type="text"
                  value={outletFormPhone}
                  onChange={(e) => setOutletFormPhone(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <label className="flex items-center gap-2 pt-1 cursor-pointer text-zinc-300">
                <input
                  type="checkbox"
                  checked={outletFormIsHq}
                  onChange={(e) => setOutletFormIsHq(e.target.checked)}
                />
                <span>Jadikan sebagai Kantor Pusat (Headquarters)</span>
              </label>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowAddOutletModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold cursor-pointer"
                >
                  Simpan Outlet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: TAMBAH / EDIT WAREHOUSE */}
      {showAddWhModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-white text-base">
                {editingWh ? 'Edit Gudang Distribusi' : 'Tambah Gudang Baru'}
              </h3>
              <button onClick={() => setShowAddWhModal(false)} className="text-zinc-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!whFormName.trim()) return;
                const id = editingWh?.id || `wh_${Date.now()}`;
                await setDoc(
                  doc(db, 'warehouses', id),
                  {
                    id,
                    name: whFormName.trim(),
                    code: whFormCode.trim() || 'WH-01',
                    manager: whFormManager.trim() || 'Kepala Gudang',
                    address: whFormAddress.trim() || '-',
                    capacityPct: editingWh?.capacityPct ?? 65,
                    temperature: editingWh?.temperature ?? '24°C Normal',
                  },
                  { merge: true }
                );
                setShowAddWhModal(false);
                setEditingWh(null);
              }}
              className="space-y-3 text-xs"
            >
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Nama Gudang *</label>
                <input
                  type="text"
                  required
                  value={whFormName}
                  onChange={(e) => setWhFormName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Kode Gudang</label>
                <input
                  type="text"
                  value={whFormCode}
                  onChange={(e) => setWhFormCode(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Kepala Gudang</label>
                <input
                  type="text"
                  value={whFormManager}
                  onChange={(e) => setWhFormManager(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Alamat Gudang</label>
                <input
                  type="text"
                  value={whFormAddress}
                  onChange={(e) => setWhFormAddress(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowAddWhModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold cursor-pointer"
                >
                  Simpan Gudang
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default MultiOutletModule;
