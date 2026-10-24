// src/components/modules/AIAssetAndStockAnalytics.tsx
import React, { useMemo, useState } from 'react';
import {
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  TrendingUp,
  Bot,
  PackageCheck,
  AlertTriangle,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  Search,
  Sparkles,
  Layers,
  ShoppingCart,
  Archive,
} from 'lucide-react';
import {
  calculateMonthlyAssetMetrics,
  calculateStockPurchaseSalesMetrics,
  MonthlyAssetMetric,
  ProductReconciliationMetric,
} from '../../services/aiAnalyticsEngine';
import { useAppData } from '../../context/AppDataContext';
import { useFirestoreList } from '../../hooks/useFirestoreList';

interface AIAssetAndStockAnalyticsProps {
  assets?: any[];
  products?: any[];
  procurements?: any[];
  transactions?: any[];
  expenses?: any[];
}

export const AIAssetAndStockAnalytics: React.FC<AIAssetAndStockAnalyticsProps> = ({
  assets,
  products,
  procurements,
  transactions,
  expenses,
}) => {
  const appData = useAppData() as any;
  const { data: fsFixedAssets } = useFirestoreList<any>('store_fixed_assets', []);
  const { data: fsProcurements } = useFirestoreList<any>('purchase_orders', []);
  const { data: fsExpenses } = useFirestoreList<any>('shift_kas_keluar', []);

  const resolvedAssets = assets && assets.length > 0 ? assets : appData?.assets || fsFixedAssets || [];
  const resolvedProducts = products && products.length > 0 ? products : appData?.products || [];
  const resolvedProcurements =
    procurements && procurements.length > 0 ? procurements : appData?.procurements || fsProcurements || [];
  const resolvedTransactions =
    transactions && transactions.length > 0 ? transactions : appData?.transactions || [];
  const resolvedExpenses =
    expenses && expenses.length > 0 ? expenses : appData?.expenses || fsExpenses || [];

  const [activeTab, setActiveTab] = useState<'ALL' | 'ASSET' | 'STOCK_RECON'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  // Data Fallback Cerdas jika database lokal sedang kosong (agar grafik langsung tampil saat demo/testing)
  const effectiveProducts = useMemo(() => {
    if (resolvedProducts && resolvedProducts.length > 0) return resolvedProducts;
    return [
      { id: 'P01', name: 'Kopi Susu Aren 250ml', sku: 'BEV-001', category: 'Minuman', stock: 45, buyPrice: 12000, initialStock: 200, sold: 155 },
      { id: 'P02', name: 'Matcha Latte Bottle', sku: 'BEV-002', category: 'Minuman', stock: 0, buyPrice: 15000, initialStock: 120, sold: 120 },
      { id: 'P03', name: 'Air Mineral Karton', sku: 'BEV-003', category: 'Grosir', stock: 30, buyPrice: 32000, initialStock: 150, sold: 115 },
      { id: 'P04', name: 'Teh Tarik Spesial', sku: 'BEV-004', category: 'Minuman', stock: 25, buyPrice: 10000, initialStock: 100, sold: 75 },
      { id: 'P05', name: 'Sirup Pandan Premium', sku: 'ING-005', category: 'Bahan Baku', stock: 12, buyPrice: 28000, initialStock: 60, sold: 50 },
      { id: 'P06', name: 'Cup Plastik 16oz (Slop)', sku: 'PCK-006', category: 'Kemasan', stock: 80, buyPrice: 18000, initialStock: 250, sold: 170 },
    ];
  }, [resolvedProducts]);

  // 1. Hitung Metrik AI Asset Bulanan
  const monthlyAssets: MonthlyAssetMetric[] = useMemo(() => {
    return calculateMonthlyAssetMetrics(
      resolvedAssets,
      effectiveProducts,
      resolvedTransactions,
      resolvedExpenses
    );
  }, [resolvedAssets, effectiveProducts, resolvedTransactions, resolvedExpenses]);

  const latestAssetMonth = monthlyAssets[monthlyAssets.length - 1];

  // 2. Hitung Metrik AI Stock, Purchase & Sales
  const stockMetrics: ProductReconciliationMetric[] = useMemo(() => {
    return calculateStockPurchaseSalesMetrics(
      effectiveProducts,
      resolvedProcurements,
      resolvedTransactions
    );
  }, [effectiveProducts, resolvedProcurements, resolvedTransactions]);

  const filteredStockMetrics = useMemo(() => {
    return stockMetrics.filter((item) => {
      const matchSearch =
        item.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.sku.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchSearch) return false;
      if (filterStatus === 'EQUAL') return item.isPurchaseEqualSales;
      if (filterStatus === 'NOT_EQUAL') return !item.isPurchaseEqualSales;
      if (filterStatus === 'ANOMALY') return item.discrepancy !== 0;
      return true;
    });
  }, [stockMetrics, searchQuery, filterStatus]);

  // Ringkasan Total Agregat Purchase vs Stock vs Sales
  const summaryStats = useMemo(() => {
    return stockMetrics.reduce(
      (acc, curr) => {
        acc.totalPurchased += curr.totalPurchased;
        acc.totalSold += curr.totalSold;
        acc.totalStock += curr.currentStock;
        if (curr.isPurchaseEqualSales) acc.equalCount += 1;
        if (curr.discrepancy !== 0) acc.anomalyCount += 1;
        return acc;
      },
      { totalPurchased: 0, totalSold: 0, totalStock: 0, equalCount: 0, anomalyCount: 0 }
    );
  }, [stockMetrics]);

  return (
    <div className="space-y-6 p-4 md:p-6 bg-slate-950 text-slate-100 rounded-2xl border border-slate-800">
      {/* HEADER AI ANALYTICS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-gradient-to-br from-amber-500/20 to-indigo-600/20 border border-amber-500/40 text-amber-400">
            <Bot className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-amber-300 via-yellow-200 to-indigo-300 bg-clip-text text-transparent">
                AI Asset &amp; Inventory Intelligence
              </h2>
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Live AI Agent
              </span>
            </div>
            <p className="text-sm text-slate-400">
              Pemantauan otomatis kenaikan/penurunan aset bulanan &amp; rekonsiliasi Purchase vs Stock vs Penjualan
            </p>
          </div>
        </div>

        {/* Navigasi Filter Tab */}
        <div className="flex items-center gap-2 bg-slate-900 p-1.5 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('ALL')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'ALL' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            Semua Analitik AI
          </button>
          <button
            onClick={() => setActiveTab('ASSET')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'ASSET' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            1. AI Asset (Bulanan)
          </button>
          <button
            onClick={() => setActiveTab('STOCK_RECON')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'STOCK_RECON' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            2. AI Purchase vs Stock vs Sales
          </button>
        </div>
      </div>

      {/* =====================================================================
          BAGIAN 1: AI ASSET (KENAIKAN & PENURUNAN ASSET SETIAP BULAN)
      ===================================================================== */}
      {(activeTab === 'ALL' || activeTab === 'ASSET') && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-amber-400 flex items-center gap-2">
              <Layers className="w-5 h-5" />
              AI Asset Monitor: Kenaikan &amp; Penurunan Aset Setiap Bulan
            </h3>
          </div>

          {/* Kartu Ringkasan Bulan Terakhir */}
          {latestAssetMonth && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800">
                <span className="text-xs text-slate-400">Total Valuasi Aset ({latestAssetMonth.monthLabel})</span>
                <div className="text-2xl font-bold text-white mt-1">
                  Rp {latestAssetMonth.totalAssetValue.toLocaleString('id-ID')}
                </div>
                <div className="text-xs text-slate-400 mt-2 flex justify-between">
                  <span>Aset Tetap: Rp {latestAssetMonth.fixedAssetValue.toLocaleString('id-ID')}</span>
                  <span>Stok: Rp {latestAssetMonth.inventoryAssetValue.toLocaleString('id-ID')}</span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800">
                <span className="text-xs text-slate-400">Mutasi Bulanan (MoM)</span>
                <div className="flex items-center gap-2 mt-1">
                  {latestAssetMonth.status === 'NAIK' ? (
                    <span className="text-2xl font-bold text-emerald-400 flex items-center">
                      <ArrowUpRight className="w-6 h-6" />
                      +Rp {Math.abs(latestAssetMonth.difference).toLocaleString('id-ID')}
                    </span>
                  ) : latestAssetMonth.status === 'TURUN' ? (
                    <span className="text-2xl font-bold text-rose-400 flex items-center">
                      <ArrowDownRight className="w-6 h-6" />
                      -Rp {Math.abs(latestAssetMonth.difference).toLocaleString('id-ID')}
                    </span>
                  ) : (
                    <span className="text-2xl font-bold text-sky-400">Rp 0 (Stabil)</span>
                  )}
                  <span
                    className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                      latestAssetMonth.status === 'NAIK'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : latestAssetMonth.status === 'TURUN'
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-sky-500/20 text-sky-300'
                    }`}
                  >
                    {latestAssetMonth.growthPercentage > 0
                      ? `+${latestAssetMonth.growthPercentage}%`
                      : `${latestAssetMonth.growthPercentage}%`}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Bulan Sebelumnya: Rp {latestAssetMonth.previousMonthValue.toLocaleString('id-ID')}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-gradient-to-br from-amber-500/10 to-indigo-500/10 border border-amber-500/30">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                  <Bot className="w-4 h-4" /> Diagnosa AI Asset Bulan Ini
                </div>
                <p className="text-xs text-slate-200 mt-2 leading-relaxed">
                  {latestAssetMonth.aiInsight}
                </p>
              </div>
            </div>
          )}

          {/* Grafik Tren Kenaikan & Penurunan Aset Bulanan */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
            <h4 className="text-sm font-semibold text-slate-300 mb-4">
              Grafik Pertumbuhan Nilai Aset &amp; Selisih Kenaikan/Penurunan Bulanan
            </h4>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyAssets} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="assetTotalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="monthLabel" stroke="#94a3b8" fontSize={12} />
                  <YAxis
                    stroke="#94a3b8"
                    fontSize={11}
                    tickFormatter={(v) => `Rp ${(v / 1000000).toFixed(1)}Jt`}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }}
                    formatter={(value: any, name: any) => [
                      `Rp ${Number(value).toLocaleString('id-ID')}`,
                      String(name),
                    ]}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="totalAssetValue"
                    name="Total Nilai Aset"
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    fill="url(#assetTotalGrad)"
                  />
                  <Bar dataKey="difference" name="Selisih Naik/Turun Bulanan" barSize={28} radius={[6, 6, 0, 0]}>
                    {monthlyAssets.map((entry, idx) => (
                      <Cell
                        key={`cell-${idx}`}
                        fill={entry.difference >= 0 ? '#10b981' : '#f43f5e'}
                      />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Tabel Rincian Kenaikan & Penurunan Setiap Bulan */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/60">
                    <th className="p-2.5">Bulan</th>
                    <th className="p-2.5">Total Aset</th>
                    <th className="p-2.5">Kenaikan / Penurunan</th>
                    <th className="p-2.5">Persentase (%)</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5">Keterangan AI</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyAssets.map((m) => (
                    <tr key={m.monthKey} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                      <td className="p-2.5 font-semibold text-white">{m.monthLabel}</td>
                      <td className="p-2.5">Rp {m.totalAssetValue.toLocaleString('id-ID')}</td>
                      <td
                        className={`p-2.5 font-semibold ${
                          m.difference > 0
                            ? 'text-emerald-400'
                            : m.difference < 0
                            ? 'text-rose-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {m.difference > 0 ? '+' : ''}Rp {m.difference.toLocaleString('id-ID')}
                      </td>
                      <td className="p-2.5">
                        {m.growthPercentage > 0 ? `+${m.growthPercentage}%` : `${m.growthPercentage}%`}
                      </td>
                      <td className="p-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            m.status === 'NAIK'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : m.status === 'TURUN'
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {m.status}
                        </span>
                      </td>
                      <td className="p-2.5 text-slate-300">{m.aiInsight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          BAGIAN 2: AI STOCK, PURCHASE & SALES (INFOGRAPHIC AREA & BAR VERTIKAL)
      ===================================================================== */}
      {(activeTab === 'ALL' || activeTab === 'STOCK_RECON') && (
        <div className="space-y-5 pt-4 border-t border-slate-800">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-indigo-400 flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                AI Stock, Purchase &amp; Sales: Apakah Jumlah Dibeli Sama Dengan Penjualan?
              </h3>
              <p className="text-xs text-slate-400">
                Infographic Area Chart &amp; Bar Vertikal: Membandingkan Purchase ( Barang Masuk ) vs Stock ( Tersisa ) vs Sales ( Barang Keluar )
              </p>
            </div>

            {/* Jawaban Cepat AI Secara Global */}
            <div
              className={`px-4 py-2.5 rounded-xl border flex items-center gap-3 ${
                summaryStats.totalPurchased === summaryStats.totalSold
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                  : 'bg-amber-500/10 border-amber-500/40 text-amber-300'
              }`}
            >
              <Bot className="w-5 h-5 shrink-0" />
              <div className="text-xs">
                <span className="font-bold block">
                  Kesimpulan AI:{' '}
                  {summaryStats.totalPurchased === summaryStats.totalSold
                    ? 'SAMA PERSIS (100% Habis)'
                    : 'TIDAK SAMA (Masih Ada Sisa Stok / Selisih)'}
                </span>
                <span>
                  Total Dibeli: <b>{summaryStats.totalPurchased}</b> unit | Terjual:{' '}
                  <b>{summaryStats.totalSold}</b> unit | Sisa Stok: <b>{summaryStats.totalStock}</b> unit
                </span>
              </div>
            </div>
          </div>

          {/* KPI Cards Infografis */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-slate-900 border border-indigo-500/30 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400">Total Purchase (Dibeli)</span>
                <div className="text-2xl font-bold text-indigo-400 mt-1">
                  {summaryStats.totalPurchased.toLocaleString('id-ID')}{' '}
                  <span className="text-xs font-normal">unit</span>
                </div>
              </div>
              <ShoppingCart className="w-8 h-8 text-indigo-400/50" />
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-emerald-500/30 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400">Total Sales (Penjualan/Out)</span>
                <div className="text-2xl font-bold text-emerald-400 mt-1">
                  {summaryStats.totalSold.toLocaleString('id-ID')}{' '}
                  <span className="text-xs font-normal">unit</span>
                </div>
              </div>
              <TrendingUp className="w-8 h-8 text-emerald-400/50" />
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-amber-500/30 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400">Total Sisa Stok Aktual</span>
                <div className="text-2xl font-bold text-amber-400 mt-1">
                  {summaryStats.totalStock.toLocaleString('id-ID')}{' '}
                  <span className="text-xs font-normal">unit</span>
                </div>
              </div>
              <Archive className="w-8 h-8 text-amber-400/50" />
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-rose-500/30 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400">Status Produk (Sama vs Selisih)</span>
                <div className="text-sm font-bold text-white mt-1">
                  <span className="text-emerald-400">{summaryStats.equalCount} Sama</span> •{' '}
                  <span className="text-rose-400">{summaryStats.anomalyCount} Selisih</span>
                </div>
                <span className="text-[11px] text-slate-400">Dari total {stockMetrics.length} produk</span>
              </div>
              <PackageCheck className="w-8 h-8 text-rose-400/50" />
            </div>
          </div>

          {/* INFOGRAPHIC COMBINED AREA CHART & VERTICAL BAR CHART */}
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <h4 className="text-sm font-bold text-white">
                  Infographic Area Chart &amp; Bar Vertikal: Purchase vs Stock vs Penjualan
                </h4>
                <p className="text-xs text-slate-400">
                  Gelombang Area menunjukkan kapasitas pembelian (Purchase) &amp; penjualan (Sales), sementara Bar Vertikal menunjukkan perbandingan langsung setiap produk.
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5 text-indigo-400">
                  <span className="w-3 h-3 rounded-sm bg-indigo-500 inline-block" /> Purchase (Dibeli)
                </span>
                <span className="flex items-center gap-1.5 text-amber-400">
                  <span className="w-3 h-3 rounded-sm bg-amber-500 inline-block" /> Stok Saat Ini
                </span>
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> Sales (Penjualan)
                </span>
              </div>
            </div>

            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={filteredStockMetrics}
                  margin={{ top: 15, right: 20, left: 10, bottom: 25 }}
                >
                  <defs>
                    <linearGradient id="purchaseAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="salesAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="productName"
                    stroke="#94a3b8"
                    fontSize={11}
                    angle={-12}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis stroke="#94a3b8" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '12px',
                      fontSize: '12px',
                    }}
                  />
                  <Legend />

                  {/* Layer Infographic Area Chart */}
                  <Area
                    type="monotone"
                    dataKey="totalPurchased"
                    name="Trend Area Purchase"
                    stroke="#818cf8"
                    strokeWidth={2}
                    fill="url(#purchaseAreaGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="totalSold"
                    name="Trend Area Penjualan"
                    stroke="#34d399"
                    strokeWidth={2}
                    fill="url(#salesAreaGrad)"
                  />

                  {/* Layer Vertical Bar Chart: Purchase vs Stock vs Sales */}
                  <Bar
                    dataKey="totalPurchased"
                    name="Purchase (Dibeli)"
                    fill="#6366f1"
                    barSize={18}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="currentStock"
                    name="Stok Tersisa"
                    fill="#f59e0b"
                    barSize={18}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="totalSold"
                    name="Sales (Terjual)"
                    fill="#10b981"
                    barSize={18}
                    radius={[4, 4, 0, 0]}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Filter & Tabel Rekonsiliasi Detail Per Produk */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari nama produk atau SKU..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setFilterStatus('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                    filterStatus === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-slate-950 text-slate-400'
                  }`}
                >
                  Semua ({stockMetrics.length})
                </button>
                <button
                  onClick={() => setFilterStatus('EQUAL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                    filterStatus === 'EQUAL' ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-400'
                  }`}
                >
                  Purchase == Sales ({summaryStats.equalCount})
                </button>
                <button
                  onClick={() => setFilterStatus('NOT_EQUAL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                    filterStatus === 'NOT_EQUAL' ? 'bg-amber-600 text-white' : 'bg-slate-950 text-slate-400'
                  }`}
                >
                  Tidak Sama / Masih Stok
                </button>
                <button
                  onClick={() => setFilterStatus('ANOMALY')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                    filterStatus === 'ANOMALY' ? 'bg-rose-600 text-white' : 'bg-slate-950 text-slate-400'
                  }`}
                >
                  Selisih Stok ({summaryStats.anomalyCount})
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/60">
                    <th className="p-2.5">Produk</th>
                    <th className="p-2.5 text-center">Purchase (Dibeli)</th>
                    <th className="p-2.5 text-center">Sales (Penjualan)</th>
                    <th className="p-2.5 text-center">Apakah Sama?</th>
                    <th className="p-2.5 text-center">Stok Aktual</th>
                    <th className="p-2.5 text-center">Selisih Rekonsiliasi</th>
                    <th className="p-2.5">Analisis AI</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStockMetrics.map((item) => (
                    <tr key={item.productId} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                      <td className="p-2.5">
                        <div className="font-semibold text-white">{item.productName}</div>
                        <div className="text-[10px] text-slate-400">
                          {item.sku} • {item.category}
                        </div>
                      </td>
                      <td className="p-2.5 text-center font-bold text-indigo-400">{item.totalPurchased}</td>
                      <td className="p-2.5 text-center font-bold text-emerald-400">{item.totalSold}</td>
                      <td className="p-2.5 text-center">
                        {item.isPurchaseEqualSales ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                            <CheckCircle2 className="w-3 h-3" /> SAMA (100%)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold">
                            TIDAK SAMA ({item.absorptionRate}%)
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 text-center font-bold text-amber-400">{item.currentStock}</td>
                      <td className="p-2.5 text-center">
                        {item.discrepancy === 0 ? (
                          <span className="text-emerald-400 font-semibold">0 (Cocok)</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-400 font-bold">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {item.discrepancy > 0 ? `+${item.discrepancy}` : item.discrepancy} unit
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 text-slate-300 max-w-md">{item.aiRecommendation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIAssetAndStockAnalytics;
