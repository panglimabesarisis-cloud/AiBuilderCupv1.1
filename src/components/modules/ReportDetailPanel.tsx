import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  ChevronLeft,
  Calendar,
  Building2,
  TrendingUp,
  Receipt,
  Boxes,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldAlert,
  Loader2,
  Search,
  ArrowUpRight,
  MapPin,
  Phone,
  User,
  Clock,
  Info,
  Warehouse,
  ShoppingBag,
} from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Product,
  Transaction,
  TransactionItem,
} from '../../types';
import { fmtMoney } from '../../utils/money';
import {
  MultiOutletReportData,
  ReportPeriod,
  OutletFilterId,
  MASTER_OUTLETS,
  MASTER_WAREHOUSES,
  computeReport,
  ProductReportSubType,
  ProductReportComputedData,
} from './multiOutletReport';
import { ReportDetailTarget } from './ReportCharts';

// In-memory cache for transaction subcollection items
const txItemsCache = new Map<string, TransactionItem[]>();

interface ReportDetailPanelProps {
  detail: ReportDetailTarget | null;
  onClose: () => void;
  currencyMode?: 'IDR' | 'USD';
  report: MultiOutletReportData;
  period: ReportPeriod;
  outletId: OutletFilterId;
  allTransactions: Transaction[];
  allProducts: Product[];
  onNavigateTab?: (tab: string) => void;
}

import { useLanguage } from '../../context/LanguageContext';

export const ReportDetailPanel: React.FC<ReportDetailPanelProps> = ({
  detail,
  onClose,
  currencyMode: propCurrencyMode,
  report,
  period,
  outletId,
  allTransactions,
  allProducts,
  onNavigateTab,
}) => {
  const { currencyMode: ctxCurrencyMode } = useLanguage();
  const currencyMode = propCurrencyMode || ctxCurrencyMode;
  // Navigation level state
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Sub-tabs for kind: 'outlet' | 'gudang'
  const [outletSubTab, setOutletSubTab] = useState<'revenue' | 'transaksi' | 'stok'>('revenue');

  // Filters inside Transaksi view
  const [txStatusFilter, setTxStatusFilter] = useState<string>('all');
  const [txMethodFilter, setTxMethodFilter] = useState<string>('all');
  const [txSearch, setTxSearch] = useState('');

  // Filters inside Stok view
  const [stockStatusFilter, setStockStatusFilter] = useState<'all' | 'habis' | 'menipis' | 'aman'>('all');
  const [stockSearch, setStockSearch] = useState('');

  // Top 5 Products state (loaded on demand)
  const [topProducts, setTopProducts] = useState<
    { id: string; name: string; qty: number; revenue: number }[]
  >([]);
  const [topProductsLoading, setTopProductsLoading] = useState(false);
  const [topProductsTxCount, setTopProductsTxCount] = useState(0);

  // Receipt items loading for selectedTx
  const [receiptItems, setReceiptItems] = useState<TransactionItem[]>([]);
  const [receiptItemsLoading, setReceiptItemsLoading] = useState(false);

  // Initialize filters when detail target changes
  useEffect(() => {
    if (!detail) {
      setSelectedTx(null);
      setSelectedProduct(null);
      return;
    }
    setSelectedTx(null);
    setSelectedProduct(null);

    // Initial status or method filter if detail.filter was passed
    if (detail.kind === 'transaksi' && detail.filter) {
      const f = detail.filter.toLowerCase();
      if (['cash', 'qris', 'card', 'bank_transfer', 'debt', 'cod'].includes(f)) {
        setTxMethodFilter(f);
      } else if (['completed', 'flagged_fraud', 'pending_approval', 'pending'].includes(f)) {
        setTxStatusFilter(f);
      }
    } else {
      setTxStatusFilter('all');
      setTxMethodFilter('all');
    }

    if (detail.kind === 'outlet') {
      setOutletSubTab('revenue');
    } else if (detail.kind === 'gudang') {
      setOutletSubTab('stok');
    }
  }, [detail]);

  // Handle ESC key: back from level 2 first, or close if at level 1
  useEffect(() => {
    if (!detail) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedTx || selectedProduct) {
          setSelectedTx(null);
          setSelectedProduct(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [detail, selectedTx, selectedProduct, onClose]);

  // Determine effective dataset for the active panel view:
  // If viewing a specific outlet or warehouse, compute or filter data scoped to that location.
  const activeScopedReport = useMemo(() => {
    if (!detail) return report;
    if (detail.kind === 'outlet' && detail.id) {
      return computeReport(allTransactions, allProducts, {
        period,
        outletId: detail.id as OutletFilterId,
      });
    }
    if (detail.kind === 'gudang' && detail.id) {
      const gProducts = allProducts.filter((p) => (p.storageLocation ?? 'out_1') === detail.id);
      return {
        ...report,
        filteredProducts: gProducts,
      };
    }
    return report;
  }, [detail, report, allTransactions, allProducts, period]);

  // Fetch Top 5 Products on demand for kind 'revenue' (or outlet subTab 'revenue')
  useEffect(() => {
    const isRevenueMode =
      detail?.kind === 'revenue' || (detail?.kind === 'outlet' && outletSubTab === 'revenue');

    if (!isRevenueMode || !detail) return;

    let isMounted = true;
    const loadTopProducts = async () => {
      setTopProductsLoading(true);
      const completedTxs = activeScopedReport.filteredTransactions
        .filter((t) => t.status === 'completed')
        .slice(0, 60);

      setTopProductsTxCount(completedTxs.length);

      if (completedTxs.length === 0) {
        if (isMounted) {
          setTopProducts([]);
          setTopProductsLoading(false);
        }
        return;
      }

      try {
        const productAggMap = new Map<string, { id: string; name: string; qty: number; revenue: number }>();

        for (const tx of completedTxs) {
          const items: TransactionItem[] =
            tx.items && tx.items.length > 0
              ? tx.items
              : txItemsCache.get(tx.id) || [];

          for (const it of items) {
            const pid = it.productId || it.productName;
            const prev = productAggMap.get(pid) || {
              id: pid,
              name: it.productName,
              qty: 0,
              revenue: 0,
            };
            prev.qty += it.quantityOrdered || 1;
            prev.revenue += it.subtotal || 0;
            productAggMap.set(pid, prev);
          }
        }

        if (isMounted) {
          const sorted = Array.from(productAggMap.values())
            .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
            .slice(0, 5);
          setTopProducts(sorted);
        }
      } catch (err) {
        console.warn('Failed to calculate top products:', err);
      } finally {
        if (isMounted) setTopProductsLoading(false);
      }
    };

    loadTopProducts();

    return () => {
      isMounted = false;
    };
  }, [detail, outletSubTab, activeScopedReport]);

  // Fetch items for selectedTx level 2 receipt
  useEffect(() => {
    if (!selectedTx) {
      setReceiptItems([]);
      return;
    }

    if (selectedTx.items && selectedTx.items.length > 0) {
      setReceiptItems(selectedTx.items);
      return;
    }

    if (txItemsCache.has(selectedTx.id)) {
      setReceiptItems(txItemsCache.get(selectedTx.id)!);
      return;
    }

    let isMounted = true;
    setReceiptItemsLoading(true);

    getDocs(collection(db, 'transactions', selectedTx.id, 'items'))
      .then((snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TransactionItem));
        txItemsCache.set(selectedTx.id, items);
        if (isMounted) {
          setReceiptItems(items);
        }
      })
      .catch((err) => {
        console.warn('Error fetching receipt items:', err);
        if (isMounted) setReceiptItems([]);
      })
      .finally(() => {
        if (isMounted) setReceiptItemsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedTx]);

  if (!detail) return null;

  // Period label formatter
  const periodLabel =
    period === 'today'
      ? 'Hari Ini'
      : period === '7d'
      ? '7 Hari Terakhir'
      : period === '30d'
      ? '30 Hari Terakhir'
      : 'Bulan Ini';

  // Outlet label formatter
  const outletLabel =
    detail.kind === 'outlet' && detail.id
      ? MASTER_OUTLETS.find((o) => o.id === detail.id)?.name || detail.id
      : outletId === 'all'
      ? 'Semua Outlet'
      : MASTER_OUTLETS.find((o) => o.id === outletId)?.name || outletId;

  // Get dynamic panel title
  const getPanelTitle = () => {
    if (selectedTx) return `Struk Transaksi #${selectedTx.id.slice(0, 8)}`;
    if (selectedProduct) return `Rincian Produk: ${selectedProduct.name}`;

    switch (detail.kind) {
      case 'revenue':
        return 'Laporan Detail Revenue';
      case 'transaksi':
        return 'Daftar Audit Transaksi';
      case 'profit':
        return 'Laporan Margin & Profit';
      case 'stok':
        return 'Audit Inventori & Stok';
      case 'outlet': {
        const o = MASTER_OUTLETS.find((item) => item.id === detail.id);
        return o ? `Outlet: ${o.name}` : 'Detail Performa Cabang';
      }
      case 'gudang': {
        const w = MASTER_WAREHOUSES.find((item) => item.id === detail.id);
        return w ? `Gudang: ${w.name}` : 'Detail Central Warehouse';
      }
      default:
        return 'Detail Laporan';
    }
  };

  // Status Badge Helper
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800/80">
            Selesai
          </span>
        );
      case 'flagged_fraud':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-400 border border-rose-800/80 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Flagged Fraud
          </span>
        );
      case 'pending_approval':
      case 'pending':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-400 border border-amber-800/80">
            Pending
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-300">
            {status}
          </span>
        );
    }
  };

  // Stock Badge Helper
  const renderStockBadge = (p: Product) => {
    const units = p.stockInUnits ?? 0;
    const minAlert = p.minStockAlert ?? 10;
    if (units <= 0) {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-400 border border-rose-800">
          Habis
        </span>
      );
    }
    if (units <= minAlert) {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-400 border border-amber-800">
          Menipis
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
        Aman
      </span>
    );
  };

  // Location Name Helper
  const getLocationName = (locId?: string) => {
    if (!locId) return 'Toko Pusat (out_1)';
    const out = MASTER_OUTLETS.find((o) => o.id === locId);
    if (out) return out.name;
    const wh = MASTER_WAREHOUSES.find((w) => w.id === locId);
    if (wh) return wh.name;
    return locId;
  };

  // --------------------------------------------------------------------------
  // SECTION RENDERERS
  // --------------------------------------------------------------------------

  // 1. REVENUE VIEW
  const renderRevenueView = (scopedReport: MultiOutletReportData) => {
    const { daily, byChannel, byPayment, filteredTransactions } = scopedReport;
    const completedTxs = filteredTransactions.filter((t) => t.status === 'completed');
    const top5Transactions = [...completedTxs]
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 5);

    // SVG Line Chart calculations
    const maxDaily = Math.max(...daily.map((d) => d.revenue), 10);
    const chartW = 540;
    const chartH = 150;
    const pX = 30;
    const pY = 20;
    const innerW = chartW - pX * 2;
    const innerH = chartH - pY * 2;

    const points = daily.map((d, idx) => {
      const x = daily.length > 1 ? pX + (idx / (daily.length - 1)) * innerW : pX + innerW / 2;
      const y = pY + innerH - (d.revenue / maxDaily) * innerH;
      return { x, y, ...d };
    });

    const linePath = points.length
      ? points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`, '')
      : '';
    const areaPath = points.length
      ? `${linePath} L ${points[points.length - 1].x.toFixed(1)},${(pY + innerH).toFixed(1)} L ${points[0].x.toFixed(1)},${(pY + innerH).toFixed(1)} Z`
      : '';

    const totalChannelRevenue = byChannel.reduce((sum, c) => sum + c.amount, 0);
    const totalPaymentRevenue = byPayment.reduce((sum, p) => sum + p.amount, 0);

    return (
      <div className="space-y-6">
        {/* KPI Banner */}
        <div className="grid grid-cols-2 gap-3 p-4 bg-zinc-950/60 border border-zinc-800 rounded-2xl">
          <div>
            <span className="text-[11px] text-zinc-400 block font-medium">Total Omzet Sukses</span>
            <span className="text-xl font-black text-emerald-400 font-mono">
              {fmtMoney(scopedReport.kpi.totalRevenue, currencyMode)}
            </span>
          </div>
          <div>
            <span className="text-[11px] text-zinc-400 block font-medium">Transaksi Selesai</span>
            <span className="text-xl font-black text-white font-mono">
              {scopedReport.kpi.completedCount} <span className="text-xs text-zinc-400 font-normal">Tx</span>
            </span>
          </div>
        </div>

        {/* 1. Tren Harian (LineChart SVG) */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
              <span>Tren Revenue Harian</span>
            </h4>
            <span className="text-[10px] text-zinc-400 font-mono">
              Puncak: {fmtMoney(maxDaily, currencyMode)}
            </span>
          </div>
          <div className="w-full h-40 flex items-center justify-center">
            {daily.length === 0 ? (
              <span className="text-xs text-zinc-500">Tidak ada riwayat revenue harian</span>
            ) : (
              <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-full overflow-visible">
                <defs>
                  <linearGradient id="detailRevGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                {areaPath && <path d={areaPath} fill="url(#detailRevGrad)" />}
                {linePath && (
                  <path
                    d={linePath}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {points.map((p, idx) => (
                  <g key={idx}>
                    <circle cx={p.x} cy={p.y} r={3.5} fill="#60a5fa" stroke="#1e1b4b" strokeWidth="1" />
                    {(idx === 0 || idx === Math.floor(points.length / 2) || idx === points.length - 1) && (
                      <text x={p.x} y={chartH - 2} fill="#71717a" fontSize="9" textAnchor="middle" fontFamily="monospace">
                        {p.label}
                      </text>
                    )}
                  </g>
                ))}
              </svg>
            )}
          </div>
        </div>

        {/* 2. Tabel per Channel & per Metode Bayar */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Per Channel */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
            <h4 className="text-xs font-bold text-white">Distribusi per Kanal Penjualan</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-[10px] text-zinc-500 uppercase font-mono">
                    <th className="pb-2">Kanal</th>
                    <th className="pb-2 text-right">Tx</th>
                    <th className="pb-2 text-right">Revenue</th>
                    <th className="pb-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {byChannel.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-zinc-500">
                        Tidak ada data kanal
                      </td>
                    </tr>
                  ) : (
                    byChannel.map((c) => {
                      const pct = totalChannelRevenue > 0 ? (c.amount / totalChannelRevenue) * 100 : 0;
                      return (
                        <tr key={c.channel} className="text-zinc-300">
                          <td className="py-2 font-medium">{c.label}</td>
                          <td className="py-2 text-right font-mono text-zinc-400">{c.count}</td>
                          <td className="py-2 text-right font-mono font-bold text-white">
                            {fmtMoney(c.amount, currencyMode)}
                          </td>
                          <td className="py-2 text-right font-mono text-blue-400">{pct.toFixed(1)}%</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per Metode Bayar */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
            <h4 className="text-xs font-bold text-white">Distribusi per Metode Pembayaran</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-[10px] text-zinc-500 uppercase font-mono">
                    <th className="pb-2">Metode</th>
                    <th className="pb-2 text-right">Tx</th>
                    <th className="pb-2 text-right">Revenue</th>
                    <th className="pb-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {byPayment.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-zinc-500">
                        Tidak ada data metode
                      </td>
                    </tr>
                  ) : (
                    byPayment.map((p) => {
                      const pct = totalPaymentRevenue > 0 ? (p.amount / totalPaymentRevenue) * 100 : 0;
                      return (
                        <tr key={p.method} className="text-zinc-300">
                          <td className="py-2 font-medium">{p.label}</td>
                          <td className="py-2 text-right font-mono text-zinc-400">{p.count}</td>
                          <td className="py-2 text-right font-mono font-bold text-white">
                            {fmtMoney(p.amount, currencyMode)}
                          </td>
                          <td className="py-2 text-right font-mono text-emerald-400">{pct.toFixed(1)}%</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 3. 5 Transaksi Terbesar */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-white">5 Transaksi Terbesar</h4>
            <span className="text-[10px] text-zinc-400">Klik baris untuk buka struk</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] text-zinc-500 uppercase font-mono">
                  <th className="pb-2">ID</th>
                  <th className="pb-2">Waktu</th>
                  <th className="pb-2">Pelanggan</th>
                  <th className="pb-2">Kanal / Metode</th>
                  <th className="pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {top5Transactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-zinc-500">
                      Tidak ada transaksi tercatat
                    </td>
                  </tr>
                ) : (
                  top5Transactions.map((tx) => (
                    <tr
                      key={tx.id}
                      onClick={() => setSelectedTx(tx)}
                      className="hover:bg-zinc-800/50 cursor-pointer transition text-zinc-300 group"
                    >
                      <td className="py-2 font-mono text-[11px] text-blue-400 group-hover:underline">
                        #{tx.id.slice(0, 8)}
                      </td>
                      <td className="py-2 text-zinc-400 text-[11px]">
                        {tx.createdAt ? new Date(tx.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'}
                      </td>
                      <td className="py-2 font-medium">{tx.customerName || 'Pelanggan Umum'}</td>
                      <td className="py-2 text-zinc-400 capitalize">
                        {tx.channel} · {tx.paymentMethod}
                      </td>
                      <td className="py-2 text-right font-mono font-bold text-emerald-400">
                        {fmtMoney(tx.totalAmount, currencyMode)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. Top 5 Produk (Dimuat On-Demand) */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                <ShoppingBag className="w-3.5 h-3.5 text-amber-400" />
                <span>Top 5 Produk Terlaris</span>
              </h4>
              <p className="text-[10px] text-zinc-400">
                {topProductsLoading
                  ? 'Sedang mengagregasi data subkoleksi...'
                  : `Dihitung dari ${topProductsTxCount} transaksi terbaru`}
              </p>
            </div>
            {topProductsLoading && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] text-zinc-500 uppercase font-mono">
                  <th className="pb-2 w-8">#</th>
                  <th className="pb-2">Nama Produk</th>
                  <th className="pb-2 text-right">Kuantitas</th>
                  <th className="pb-2 text-right">Omzet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {topProductsLoading ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-zinc-500">
                      Memuat item produk...
                    </td>
                  </tr>
                ) : topProducts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-zinc-500">
                      Belum ada data item terjual
                    </td>
                  </tr>
                ) : (
                  topProducts.map((p, idx) => (
                    <tr key={p.id} className="text-zinc-300">
                      <td className="py-2.5 font-mono text-zinc-500 text-[11px] font-bold">
                        #{idx + 1}
                      </td>
                      <td className="py-2.5 font-semibold text-white">{p.name}</td>
                      <td className="py-2.5 text-right font-mono text-zinc-300">
                        {p.qty.toLocaleString('id-ID')} unit
                      </td>
                      <td className="py-2.5 text-right font-mono font-bold text-emerald-400">
                        {fmtMoney(p.revenue, currencyMode)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // 2. TRANSAKSI VIEW (Table + Filters)
  const renderTransaksiView = (scopedReport: MultiOutletReportData) => {
    const { filteredTransactions } = scopedReport;

    const filteredList = filteredTransactions.filter((tx) => {
      if (txStatusFilter !== 'all' && tx.status !== txStatusFilter) return false;
      if (txMethodFilter !== 'all' && (tx.paymentMethod || 'cash') !== txMethodFilter) return false;
      if (txSearch) {
        const q = txSearch.toLowerCase();
        const cName = (tx.customerName || '').toLowerCase();
        const idMatch = tx.id.toLowerCase().includes(q);
        const cashMatch = (tx.cashierId || '').toLowerCase().includes(q);
        if (!cName.includes(q) && !idMatch && !cashMatch) return false;
      }
      return true;
    });

    return (
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Cari pelanggan, ID, atau kasir..."
              value={txSearch}
              onChange={(e) => setTxSearch(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex gap-2">
            <select
              value={txStatusFilter}
              onChange={(e) => setTxStatusFilter(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-blue-500"
            >
              <option value="all">Semua Status</option>
              <option value="completed">Selesai</option>
              <option value="flagged_fraud">Flagged Fraud</option>
              <option value="pending_approval">Pending Approval</option>
            </select>

            <select
              value={txMethodFilter}
              onChange={(e) => setTxMethodFilter(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-blue-500"
            >
              <option value="all">Semua Metode</option>
              <option value="cash">Tunai (Cash)</option>
              <option value="qris">QRIS</option>
              <option value="card">Debit / Kartu</option>
              <option value="bank_transfer">Transfer Bank</option>
            </select>
          </div>
        </div>

        {/* Transactions Table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/60 text-[10px] text-zinc-500 uppercase font-mono">
                  <th className="py-2.5 px-3">Waktu</th>
                  <th className="py-2.5 px-3">Pelanggan</th>
                  <th className="py-2.5 px-3">Kasir</th>
                  <th className="py-2.5 px-3">Kanal</th>
                  <th className="py-2.5 px-3">Metode</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Total</th>
                  <th className="py-2.5 px-3 text-right">Skor Risiko</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filteredList.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-zinc-500">
                      Tidak ada transaksi yang cocok dengan filter
                    </td>
                  </tr>
                ) : (
                  filteredList.map((tx) => (
                    <tr
                      key={tx.id}
                      onClick={() => setSelectedTx(tx)}
                      className="hover:bg-zinc-800/60 cursor-pointer transition text-zinc-300 group"
                    >
                      <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-400">
                        {tx.createdAt
                          ? new Date(tx.createdAt).toLocaleDateString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '-'}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-white group-hover:text-blue-400 transition">
                        {tx.customerName || 'Pelanggan Walk-In'}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-400 font-mono text-[11px]">
                        {tx.cashierId || 'System'}
                      </td>
                      <td className="py-2.5 px-3 capitalize text-[11px]">{tx.channel}</td>
                      <td className="py-2.5 px-3 capitalize text-[11px]">{tx.paymentMethod}</td>
                      <td className="py-2.5 px-3">{renderStatusBadge(tx.status)}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                        {fmtMoney(tx.totalAmount, currencyMode)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        <span
                          className={`font-bold ${
                            tx.fraudScore >= 60
                              ? 'text-rose-400'
                              : tx.fraudScore >= 30
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {tx.fraudScore}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // 3. PROFIT VIEW
  const renderProfitView = (scopedReport: MultiOutletReportData) => {
    const { daily, byChannel, kpi } = scopedReport;
    const overallMargin = kpi.totalRevenue > 0 ? (kpi.totalProfit / kpi.totalRevenue) * 100 : 0;
    const overallCost = kpi.totalRevenue - kpi.totalProfit;

    return (
      <div className="space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-zinc-950/60 border border-zinc-800 rounded-2xl">
          <div>
            <span className="text-[11px] text-zinc-500 block">Total Penjualan</span>
            <span className="text-base font-black text-white font-mono">
              {fmtMoney(kpi.totalRevenue, currencyMode)}
            </span>
          </div>
          <div>
            <span className="text-[11px] text-zinc-500 block">Total HPP (COGS)</span>
            <span className="text-base font-black text-zinc-300 font-mono">
              {fmtMoney(overallCost, currencyMode)}
            </span>
          </div>
          <div>
            <span className="text-[11px] text-zinc-500 block">Profit Bersih</span>
            <span className="text-base font-black text-amber-400 font-mono">
              {fmtMoney(kpi.totalProfit, currencyMode)}
            </span>
          </div>
          <div>
            <span className="text-[11px] text-zinc-500 block">Rata-rata Margin</span>
            <span className="text-base font-black text-emerald-400 font-mono">
              {overallMargin.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Note / Disclaimer */}
        <div className="p-3 bg-amber-950/30 border border-amber-900/40 rounded-xl flex items-center gap-2 text-xs text-amber-300">
          <Info className="w-4 h-4 shrink-0 text-amber-400" />
          <span>Estimasi dari HPP tercatat (harga modal beli produk per unit/dus).</span>
        </div>

        {/* Tabel per Hari */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <h4 className="text-xs font-bold text-white">Profitabilitas per Hari</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] text-zinc-500 uppercase font-mono">
                  <th className="pb-2">Tanggal</th>
                  <th className="pb-2 text-right">Penjualan</th>
                  <th className="pb-2 text-right">HPP</th>
                  <th className="pb-2 text-right">Profit</th>
                  <th className="pb-2 text-right">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {daily.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-zinc-500">
                      Tidak ada data harian
                    </td>
                  </tr>
                ) : (
                  daily.map((d) => {
                    const hpp = d.revenue - d.profit;
                    const margin = d.revenue > 0 ? (d.profit / d.revenue) * 100 : 0;
                    return (
                      <tr key={d.date} className="text-zinc-300">
                        <td className="py-2 font-mono text-[11px] text-zinc-400">{d.label}</td>
                        <td className="py-2 text-right font-mono text-white">
                          {fmtMoney(d.revenue, currencyMode)}
                        </td>
                        <td className="py-2 text-right font-mono text-zinc-400">
                          {fmtMoney(hpp, currencyMode)}
                        </td>
                        <td className="py-2 text-right font-mono font-bold text-amber-400">
                          {fmtMoney(d.profit, currencyMode)}
                        </td>
                        <td className="py-2 text-right font-mono text-emerald-400">
                          {margin.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tabel per Channel */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <h4 className="text-xs font-bold text-white">Profitabilitas per Kanal</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] text-zinc-500 uppercase font-mono">
                  <th className="pb-2">Kanal</th>
                  <th className="pb-2 text-right">Penjualan</th>
                  <th className="pb-2 text-right">HPP</th>
                  <th className="pb-2 text-right">Profit</th>
                  <th className="pb-2 text-right">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {byChannel.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-zinc-500">
                      Tidak ada data kanal
                    </td>
                  </tr>
                ) : (
                  byChannel.map((c) => {
                    // Estimated HPP: approx 65% if not itemized
                    const hpp = c.amount * 0.65;
                    const profit = c.amount - hpp;
                    const margin = c.amount > 0 ? (profit / c.amount) * 100 : 0;
                    return (
                      <tr key={c.channel} className="text-zinc-300">
                        <td className="py-2 font-medium">{c.label}</td>
                        <td className="py-2 text-right font-mono text-white">
                          {fmtMoney(c.amount, currencyMode)}
                        </td>
                        <td className="py-2 text-right font-mono text-zinc-400">
                          {fmtMoney(hpp, currencyMode)}
                        </td>
                        <td className="py-2 text-right font-mono font-bold text-amber-400">
                          {fmtMoney(profit, currencyMode)}
                        </td>
                        <td className="py-2 text-right font-mono text-emerald-400">
                          {margin.toFixed(1)}%
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
    );
  };

  // 4. STOK VIEW (Table + Filters + Click to Level 2)
  const renderStokView = (scopedReport: MultiOutletReportData) => {
    const { filteredProducts } = scopedReport;

    const filtered = filteredProducts
      .filter((p) => {
        const units = p.stockInUnits ?? 0;
        const minAlert = p.minStockAlert ?? 10;
        if (stockStatusFilter === 'habis' && units > 0) return false;
        if (stockStatusFilter === 'menipis' && (units <= 0 || units > minAlert)) return false;
        if (stockStatusFilter === 'aman' && units <= minAlert) return false;

        if (stockSearch) {
          const q = stockSearch.toLowerCase();
          const nameMatch = (p.name || '').toLowerCase().includes(q);
          const skuMatch = (p.sku || '').toLowerCase().includes(q);
          const catMatch = (p.category || '').toLowerCase().includes(q);
          if (!nameMatch && !skuMatch && !catMatch) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Prioritize critical stock (Habis first, then Menipis, then Aman)
        const getPriority = (p: Product) => {
          const u = p.stockInUnits ?? 0;
          const m = p.minStockAlert ?? 10;
          if (u <= 0) return 0;
          if (u <= m) return 1;
          return 2;
        };
        const pA = getPriority(a);
        const pB = getPriority(b);
        if (pA !== pB) return pA - pB;
        return (a.stockInUnits ?? 0) - (b.stockInUnits ?? 0);
      });

    return (
      <div className="space-y-4">
        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Cari produk, SKU, atau kategori..."
              value={stockSearch}
              onChange={(e) => setStockSearch(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex gap-1.5 p-1 bg-zinc-950 border border-zinc-800 rounded-xl">
            {(
              [
                { id: 'all', label: 'Semua' },
                { id: 'habis', label: 'Habis' },
                { id: 'menipis', label: 'Menipis' },
                { id: 'aman', label: 'Aman' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                onClick={() => setStockStatusFilter(f.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  stockStatusFilter === f.id
                    ? 'bg-blue-600 text-white font-bold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/60 text-[10px] text-zinc-500 uppercase font-mono">
                  <th className="py-2.5 px-3">Produk</th>
                  <th className="py-2.5 px-3">Kategori</th>
                  <th className="py-2.5 px-3">Lokasi</th>
                  <th className="py-2.5 px-3 text-right">Stok Unit</th>
                  <th className="py-2.5 px-3 text-right">Setara Dus</th>
                  <th className="py-2.5 px-3 text-right">Nilai Stok</th>
                  <th className="py-2.5 px-3 text-right">Min Alert</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-zinc-500">
                      Tidak ada produk ditemukan
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => {
                    const units = p.stockInUnits ?? 0;
                    const pieces = Math.max(1, p.piecesPerCarton || 1);
                    const cartons = Math.floor(units / pieces);
                    const stockVal = units * (p.costPerUnit ?? 0);

                    return (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedProduct(p)}
                        className="hover:bg-zinc-800/60 cursor-pointer transition text-zinc-300 group"
                      >
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-white group-hover:text-blue-400 transition">
                            {p.name}
                          </div>
                          <span className="font-mono text-[10px] text-zinc-500">{p.sku}</span>
                        </td>
                        <td className="py-2.5 px-3 text-zinc-400">{p.category}</td>
                        <td className="py-2.5 px-3 text-zinc-400 text-[11px] truncate max-w-[120px]">
                          {getLocationName(p.storageLocation)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                          {units.toLocaleString('id-ID')}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-zinc-400">
                          {cartons} Dus
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                          {fmtMoney(stockVal, currencyMode)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-zinc-500">
                          {p.minStockAlert ?? 10}
                        </td>
                        <td className="py-2.5 px-3 text-center">{renderStockBadge(p)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // LEVEL 2 DETAIL VIEW: RECEIPT STRUK
  // --------------------------------------------------------------------------
  const renderTransactionDetailReceipt = (tx: Transaction) => {
    const isFraud = tx.status === 'flagged_fraud';
    const profit = tx.totalAmount - (tx.totalCost ?? tx.totalAmount * 0.65);
    const margin = tx.totalAmount > 0 ? (profit / tx.totalAmount) * 100 : 0;

    return (
      <div className="space-y-6">
        {/* Receipt Header Card */}
        <div className="p-5 bg-zinc-950/80 border border-zinc-800 rounded-2xl space-y-4">
          <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
            <div>
              <span className="font-mono text-[10px] text-zinc-500 uppercase block">STRUK TRANSAKSI</span>
              <h3 className="font-mono font-black text-lg text-white">#{tx.id}</h3>
              <p className="text-xs text-zinc-400 flex items-center gap-1.5 mt-0.5">
                <Clock className="w-3.5 h-3.5 text-zinc-500" />
                <span>
                  {tx.createdAt
                    ? new Date(tx.createdAt).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '-'}
                </span>
              </p>
            </div>
            <div>{renderStatusBadge(tx.status)}</div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-zinc-500 block text-[11px]">Nama Pelanggan:</span>
              <span className="font-semibold text-white">{tx.customerName || 'Pelanggan Umum'}</span>
              {tx.customerPhone && (
                <span className="text-[11px] text-zinc-400 block font-mono">{tx.customerPhone}</span>
              )}
            </div>
            <div>
              <span className="text-zinc-500 block text-[11px]">Kasir / Terminal:</span>
              <span className="font-mono text-zinc-300 font-semibold">{tx.cashierId || 'Terminal POS'}</span>
            </div>
            <div>
              <span className="text-zinc-500 block text-[11px]">Kanal Penjualan:</span>
              <span className="font-semibold text-zinc-200 capitalize">{tx.channel}</span>
            </div>
            <div>
              <span className="text-zinc-500 block text-[11px]">Metode Pembayaran:</span>
              <span className="font-semibold text-zinc-200 uppercase">{tx.paymentMethod}</span>
            </div>
          </div>
        </div>

        {/* Item List Table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <h4 className="text-xs font-bold text-white">Daftar Item Belanja</h4>
          {receiptItemsLoading ? (
            <div className="py-6 flex items-center justify-center gap-2 text-xs text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              <span>Memuat rincian item transaksi...</span>
            </div>
          ) : receiptItems.length === 0 ? (
            <div className="py-4 text-center text-xs text-zinc-500">
              Tidak ada data item tersimpan
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-[10px] text-zinc-500 uppercase font-mono">
                    <th className="pb-2">Nama Barang</th>
                    <th className="pb-2 text-center">Kemasan</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="pb-2 text-right">Harga</th>
                    <th className="pb-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {receiptItems.map((item, idx) => (
                    <tr key={item.id || idx} className="text-zinc-300">
                      <td className="py-2.5 font-medium text-white">{item.productName}</td>
                      <td className="py-2.5 text-center">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300">
                          {item.packageType || 'unit'}
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-mono text-zinc-300">
                        {item.quantityOrdered}
                      </td>
                      <td className="py-2.5 text-right font-mono text-zinc-400">
                        {fmtMoney(item.unitPrice, currencyMode)}
                      </td>
                      <td className="py-2.5 text-right font-mono font-bold text-white">
                        {fmtMoney(item.subtotal, currencyMode)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Receipt Financial Totals */}
          <div className="pt-3 border-t border-zinc-800 space-y-1.5 text-xs">
            <div className="flex justify-between text-zinc-400">
              <span>Subtotal:</span>
              <span className="font-mono text-white">
                {fmtMoney(tx.subtotal ?? tx.totalAmount, currencyMode)}
              </span>
            </div>
            {tx.discount ? (
              <div className="flex justify-between text-zinc-400">
                <span>Diskon:</span>
                <span className="font-mono text-rose-400">
                  -{fmtMoney(tx.discount, currencyMode)}
                </span>
              </div>
            ) : null}
            <div className="flex justify-between text-sm font-bold pt-2 border-t border-zinc-800">
              <span className="text-white">Total Bayar:</span>
              <span className="font-mono text-emerald-400">
                {fmtMoney(tx.totalAmount, currencyMode)}
              </span>
            </div>
            <div className="flex justify-between text-zinc-500 pt-1 text-[11px]">
              <span>Estimasi HPP:</span>
              <span className="font-mono">{fmtMoney(tx.totalCost ?? tx.totalAmount * 0.65, currencyMode)}</span>
            </div>
            <div className="flex justify-between text-zinc-400 text-[11px]">
              <span>Estimasi Profit Bersih:</span>
              <span className="font-mono text-amber-400 font-bold">
                {fmtMoney(profit, currencyMode)} ({margin.toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>

        {/* Risk & Anti-Fraud Assessment */}
        <div className="p-4 bg-zinc-950/80 border border-zinc-800 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <h4 className="text-xs font-bold text-white">Anti-Fraud &amp; Risk Assessment</h4>
            </div>
            <span
              className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${
                tx.fraudScore >= 60
                  ? 'bg-rose-950 text-rose-400 border border-rose-800'
                  : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
              }`}
            >
              Risk Score: {tx.fraudScore}/100
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between text-zinc-400">
              <span>Jarak ke Toko:</span>
              <span className="font-mono text-zinc-200">
                {tx.distanceToStoreMeters !== undefined ? `${tx.distanceToStoreMeters} meter` : 'Di dalam radius toko'}
              </span>
            </div>

            {tx.fraudFlags && tx.fraudFlags.length > 0 && (
              <div>
                <span className="text-zinc-500 block text-[11px] mb-1">Fraud Flags Terdeteksi:</span>
                <div className="flex flex-wrap gap-1">
                  {tx.fraudFlags.map((flag, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950/80 text-rose-300 border border-rose-900"
                    >
                      {flag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {tx.aiExplanation && (
              <div className="p-2.5 bg-zinc-900 rounded-xl border border-zinc-800 text-zinc-300 text-[11px]">
                <span className="text-zinc-500 block text-[10px] uppercase font-bold mb-0.5">Analisis AI RiskCart:</span>
                {tx.aiExplanation}
              </div>
            )}
          </div>

          {isFraud && onNavigateTab && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => onNavigateTab('anti_fraud')}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-md shadow-rose-600/20 cursor-pointer"
              >
                <ShieldAlert className="w-4 h-4" />
                <span>Buka AI Anti-Fraud</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // LEVEL 2 DETAIL VIEW: PRODUCT DETAIL
  // --------------------------------------------------------------------------
  const renderProductDetail = (p: Product) => {
    const units = p.stockInUnits ?? 0;
    const pieces = Math.max(1, p.piecesPerCarton || 1);
    const cartons = Math.floor(units / pieces);
    const remainder = units % pieces;
    const isCritical = units <= (p.minStockAlert ?? 10);
    const margin =
      p.pricePerUnit > 0 ? (((p.pricePerUnit - p.costPerUnit) / p.pricePerUnit) * 100).toFixed(1) : '0';

    return (
      <div className="space-y-6">
        {/* Header Product */}
        <div className="p-5 bg-zinc-950/80 border border-zinc-800 rounded-2xl space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-mono text-[10px] text-blue-400 bg-blue-950/60 border border-blue-800/60 px-2 py-0.5 rounded font-bold">
                {p.sku}
              </span>
              <h3 className="font-black text-lg text-white mt-1.5">{p.name}</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Kategori: {p.category} {p.brand ? `· Brand: ${p.brand}` : ''}
              </p>
            </div>
            <div>{renderStockBadge(p)}</div>
          </div>

          <div className="pt-3 border-t border-zinc-800 grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-zinc-500 block text-[11px]">Lokasi Penyimpanan:</span>
              <span className="font-semibold text-zinc-200">{getLocationName(p.storageLocation)}</span>
            </div>
            <div>
              <span className="text-zinc-500 block text-[11px]">Ambang Batas Minimum:</span>
              <span className="font-mono text-zinc-200">{p.minStockAlert ?? 10} Unit</span>
            </div>
          </div>
        </div>

        {/* Stock Breakdown */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
            <Boxes className="w-4 h-4 text-purple-400" />
            <span>Kondisi Stok &amp; Setara Dus</span>
          </h4>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800">
              <span className="text-zinc-500 block text-[11px]">Total Stok Fisik:</span>
              <span className="text-lg font-black text-white font-mono">
                {units.toLocaleString('id-ID')} <span className="text-xs font-normal text-zinc-400">Unit</span>
              </span>
            </div>
            <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800">
              <span className="text-zinc-500 block text-[11px]">Konversi Dus:</span>
              <span className="text-lg font-black text-purple-400 font-mono">
                {cartons} Dus {remainder > 0 ? `+ ${remainder} pcs` : ''}
              </span>
            </div>
          </div>

          <div className="p-3 bg-zinc-950/40 rounded-xl border border-zinc-800/80 text-xs text-zinc-400">
            Kemasannya: <strong className="text-zinc-200">{pieces} pcs</strong> per karton dus.
          </div>
        </div>

        {/* Pricing & Cost Structure */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
          <h4 className="text-xs font-bold text-white">Struktur Harga &amp; Profitabilitas</h4>
          <div className="space-y-2 text-xs divide-y divide-zinc-800/60">
            <div className="flex justify-between pt-1 text-zinc-400">
              <span>Harga Jual Eceran (Unit):</span>
              <span className="font-mono font-bold text-white">
                {fmtMoney(p.pricePerUnit, currencyMode)}
              </span>
            </div>
            <div className="flex justify-between pt-2 text-zinc-400">
              <span>Harga Grosir Dus ({pieces} pcs):</span>
              <span className="font-mono font-bold text-white">
                {fmtMoney(p.pricePerCarton, currencyMode)}
              </span>
            </div>
            <div className="flex justify-between pt-2 text-zinc-400">
              <span>HPP (Harga Pokok Pembelian):</span>
              <span className="font-mono text-zinc-300">
                {fmtMoney(p.costPerUnit, currencyMode)}
              </span>
            </div>
            <div className="flex justify-between pt-2 text-zinc-400">
              <span>Estimasi Margin Bersih:</span>
              <span className="font-mono font-bold text-emerald-400">
                {margin}% per unit
              </span>
            </div>
            <div className="flex justify-between pt-2 text-zinc-400">
              <span>Valuasi Total Stok Barang Ini:</span>
              <span className="font-mono font-bold text-white">
                {fmtMoney(units * (p.costPerUnit ?? 0), currencyMode)}
              </span>
            </div>
          </div>
        </div>

        {/* Action Button if Stock is Critical */}
        {isCritical && onNavigateTab && (
          <button
            type="button"
            onClick={() => onNavigateTab('restock')}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition shadow-md shadow-purple-600/20 cursor-pointer"
          >
            <Boxes className="w-4 h-4" />
            <span>Buka Restock Advisor</span>
          </button>
        )}
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // LEVEL 1: OUTLET / GUDANG MASTER CARD + TABS
  // --------------------------------------------------------------------------
  const renderOutletView = () => {
    const o = MASTER_OUTLETS.find((item) => item.id === detail.id) || MASTER_OUTLETS[0];

    return (
      <div className="space-y-6">
        {/* Master Info Card */}
        <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="font-mono text-[10px] font-bold text-blue-400 bg-blue-950/60 border border-blue-800/60 px-1.5 py-0.5 rounded">
                  {o.code}
                </span>
                {o.isHQ && (
                  <span className="text-[10px] font-bold text-amber-400 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.5 rounded">
                    HEADQUARTERS
                  </span>
                )}
              </div>
              <h3 className="font-black text-white text-base">{o.name}</h3>
              <p className="text-xs text-zinc-400 flex items-start gap-1 mt-1">
                <MapPin className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />
                <span>{o.address}</span>
              </p>
            </div>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse mt-1 shrink-0" />
          </div>

          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-zinc-800 text-xs">
            <div>
              <span className="text-zinc-500 text-[10px] block">Kasir Aktif</span>
              <span className="font-bold text-zinc-200">{o.cashierActive} POS</span>
            </div>
            <div>
              <span className="text-zinc-500 text-[10px] block">Geofence</span>
              <span className="font-bold text-zinc-200">{o.geofenceRadius}m</span>
            </div>
            <div>
              <span className="text-zinc-500 text-[10px] block">Kontak</span>
              <span className="font-bold text-zinc-300 truncate block">{o.phone}</span>
            </div>
          </div>
        </div>

        {/* Sub-tabs: Revenue | Transaksi | Stok */}
        <div className="flex items-center gap-1 p-1 bg-zinc-950 border border-zinc-800 rounded-xl">
          {(
            [
              { id: 'revenue', label: 'Revenue' },
              { id: 'transaksi', label: 'Transaksi' },
              { id: 'stok', label: 'Stok' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setOutletSubTab(tab.id)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                outletSubTab === tab.id
                  ? 'bg-blue-600 text-white font-bold shadow-xs'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {outletSubTab === 'revenue' && renderRevenueView(activeScopedReport)}
        {outletSubTab === 'transaksi' && renderTransaksiView(activeScopedReport)}
        {outletSubTab === 'stok' && renderStokView(activeScopedReport)}
      </div>
    );
  };

  const renderGudangView = () => {
    const w = MASTER_WAREHOUSES.find((item) => item.id === detail.id) || MASTER_WAREHOUSES[0];

    return (
      <div className="space-y-6">
        {/* Master Info Card */}
        <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-mono text-[10px] font-bold text-purple-400 bg-purple-950/60 border border-purple-800/60 px-2 py-0.5 rounded">
                {w.code}
              </span>
              <h3 className="font-black text-white text-base mt-1">{w.name}</h3>
              <p className="text-xs text-zinc-400 flex items-center gap-1 mt-1">
                <MapPin className="w-3.5 h-3.5 text-zinc-500" />
                {w.address}
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
              OPERASIONAL
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Kapasitas Muat:</span>
              <span className="font-mono font-bold text-white">{w.capacityPct ?? 0}% Terisi</span>
            </div>
            <div className="w-full bg-zinc-900 rounded-full h-2 overflow-hidden border border-zinc-800">
              <div
                className={`h-full rounded-full ${
                  (w.capacityPct ?? 0) > 85 ? 'bg-rose-500' : 'bg-purple-500'
                }`}
                style={{ width: `${w.capacityPct ?? 0}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
            <div>
              <span className="text-zinc-500 text-[10px] block">Kepala Gudang:</span>
              <span className="font-bold text-zinc-200">{w.manager}</span>
            </div>
            <div>
              <span className="text-zinc-500 text-[10px] block">Kondisi Ruangan:</span>
              <span className="font-bold text-zinc-200">{w.temperature}</span>
            </div>
          </div>
        </div>

        {/* Tab (Gudang: Hanya Stok) */}
        <div className="flex items-center gap-1 p-1 bg-zinc-950 border border-zinc-800 rounded-xl">
          <button
            className="flex-1 py-1.5 rounded-lg text-xs font-bold bg-purple-600 text-white shadow-xs cursor-default"
          >
            Stok Barang Gudang
          </button>
        </div>

        {renderStokView(activeScopedReport)}
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // MAIN BODY ROUTER
  // --------------------------------------------------------------------------
  const renderMainContent = () => {
    if (selectedTx) return renderTransactionDetailReceipt(selectedTx);
    if (selectedProduct) return renderProductDetail(selectedProduct);

    switch (detail.kind) {
      case 'revenue':
        return renderRevenueView(activeScopedReport);
      case 'transaksi':
        return renderTransaksiView(activeScopedReport);
      case 'profit':
        return renderProfitView(activeScopedReport);
      case 'stok':
        return renderStokView(activeScopedReport);
      case 'outlet':
        return renderOutletView();
      case 'gudang':
        return renderGudangView();
      default:
        return <div className="text-zinc-500 text-xs">Tidak ada data</div>;
    }
  };

  const isLevel2 = Boolean(selectedTx || selectedProduct);

  return (
    <>
      {/* Overlay Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs transition-opacity duration-200"
        aria-hidden="true"
      />

      {/* Drawer Container: Full screen on <sm, right-side sheet on sm+ */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-drawer-title"
        className="fixed inset-0 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-full sm:max-w-xl lg:max-w-2xl bg-zinc-900 border-l border-zinc-800 overflow-y-auto flex flex-col justify-between shadow-2xl z-50 animate-in slide-in-from-right duration-200"
      >
        {/* Sticky Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-800 flex items-center justify-between sticky top-0 bg-zinc-900/95 backdrop-blur-sm z-10">
          <div className="flex items-center gap-2">
            {isLevel2 && (
              <button
                type="button"
                onClick={() => {
                  setSelectedTx(null);
                  setSelectedProduct(null);
                }}
                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer flex items-center gap-1 text-xs font-semibold mr-1"
                aria-label="Kembali ke daftar"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Kembali</span>
              </button>
            )}

            <div>
              <h2
                id="report-drawer-title"
                className="font-black text-white text-base leading-tight truncate max-w-[240px] sm:max-w-md"
              >
                {getPanelTitle()}
              </h2>
              <div className="flex items-center gap-2 text-[11px] text-zinc-400 mt-0.5">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-blue-400" />
                  {periodLabel}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1 truncate max-w-[150px] sm:max-w-[200px]">
                  <Building2 className="w-3 h-3 text-purple-400" />
                  {outletLabel}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition cursor-pointer"
            aria-label="Tutup panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 flex-1 overflow-y-auto">{renderMainContent()}</div>

        {/* Footer */}
        <div className="p-3.5 border-t border-zinc-800 bg-zinc-950/50 flex items-center justify-between text-xs text-zinc-500">
          <span>RiskCart Multi Outlet Ecosystem • Read-Only Analytics</span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold transition cursor-pointer"
          >
            Tutup (Esc)
          </button>
        </div>
      </div>
    </>
  );
};

export interface ProductReportDetailViewProps {
  subReport: ProductReportSubType;
  data: ProductReportComputedData;
  periodLabel: string;
}

export const ProductReportDetailView: React.FC<ProductReportDetailViewProps> = ({
  subReport,
  data,
  periodLabel,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredOverall = useMemo(() => {
    if (!searchTerm.trim()) return data.overallRows;
    const q = searchTerm.toLowerCase().trim();
    return data.overallRows.filter(
      (r) =>
        r.produk.toLowerCase().includes(q) ||
        r.sku.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
    );
  }, [data.overallRows, searchTerm]);

  const filteredMasuk = useMemo(() => {
    if (!searchTerm.trim()) return data.masukRows;
    const q = searchTerm.toLowerCase().trim();
    return data.masukRows.filter(
      (r) =>
        r.produk.toLowerCase().includes(q) ||
        r.sku.toLowerCase().includes(q) ||
        r.docNumber.toLowerCase().includes(q) ||
        r.tanggal.toLowerCase().includes(q)
    );
  }, [data.masukRows, searchTerm]);

  const filteredKeluar = useMemo(() => {
    if (!searchTerm.trim()) return data.keluarRows;
    const q = searchTerm.toLowerCase().trim();
    return data.keluarRows.filter(
      (r) =>
        r.produk.toLowerCase().includes(q) ||
        r.sku.toLowerCase().includes(q) ||
        r.docNumber.toLowerCase().includes(q) ||
        r.tanggal.toLowerCase().includes(q)
    );
  }, [data.keluarRows, searchTerm]);

  const reportTitle =
    subReport === 'produk_keseluruhan'
      ? 'Laporan Keseluruhan Produk'
      : subReport === 'produk_masuk'
      ? 'Rincian Produk Masuk'
      : 'Rincian Produk Keluar';

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div>
          <h3 className="font-black text-white text-base flex items-center gap-2">
            <Boxes className="w-4 h-4 text-blue-400" />
            <span>{reportTitle}</span>
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Periode Aktif: <span className="font-mono text-zinc-200">{periodLabel}</span> &bull; Sinkron Real-Time Firestore
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5 pointer-events-none" />
          <input
            type="text"
            placeholder="Cari produk atau nomor dokumen..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* a. Sub-laporan 1: Laporan Keseluruhan Produk */}
      {subReport === 'produk_keseluruhan' && (
        <div className="overflow-x-auto bg-zinc-950/60 border border-zinc-800 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800 uppercase font-semibold tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Produk</th>
                <th className="py-3 px-4 text-center">Masuk</th>
                <th className="py-3 px-4 text-center">Penjualan</th>
                <th className="py-3 px-4 text-right">Stok Sistem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
              {filteredOverall.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-zinc-500">
                    Belum ada data produk pada periode ini.
                  </td>
                </tr>
              ) : (
                filteredOverall.map((row) => (
                  <tr key={row.productId} className="hover:bg-zinc-800/40 transition">
                    <td className="py-3 px-4">
                      <div className="font-bold text-white">{row.produk}</div>
                      <div className="text-[10px] font-mono text-zinc-500">
                        SKU: {row.sku} &bull; {row.category}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-cyan-400">
                      {row.masuk.toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-amber-400">
                      {row.penjualan.toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-black text-emerald-400">
                      {row.stokSistem.toLocaleString('id-ID')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="bg-zinc-950 font-bold border-t-2 border-zinc-700 text-white">
              <tr>
                <td className="py-3 px-4 uppercase tracking-wider text-[11px]">
                  TOTAL KESELURUHAN PRODUK ({filteredOverall.length} Item)
                </td>
                <td className="py-3 px-4 text-center font-mono text-cyan-400">
                  {filteredOverall.reduce((s, r) => s + r.masuk, 0).toLocaleString('id-ID')}
                </td>
                <td className="py-3 px-4 text-center font-mono text-amber-400">
                  {filteredOverall.reduce((s, r) => s + r.penjualan, 0).toLocaleString('id-ID')}
                </td>
                <td className="py-3 px-4 text-right font-mono text-emerald-400">
                  {filteredOverall.reduce((s, r) => s + r.stokSistem, 0).toLocaleString('id-ID')}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* b. Sub-laporan 2: Rincian Produk Masuk */}
      {subReport === 'produk_masuk' && (
        <div className="overflow-x-auto bg-zinc-950/60 border border-zinc-800 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800 uppercase font-semibold tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Tanggal</th>
                <th className="py-3 px-4">Produk</th>
                <th className="py-3 px-4 text-center">Masuk</th>
                <th className="py-3 px-4 text-center">Qty</th>
                <th className="py-3 px-4 text-right">Total Stok Masuk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
              {filteredMasuk.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500">
                    Belum ada riwayat barang masuk / pengadaan pada periode ini.
                  </td>
                </tr>
              ) : (
                filteredMasuk.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-800/40 transition">
                    <td className="py-3 px-4 font-mono text-zinc-300 whitespace-nowrap">
                      {row.tanggal}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-white">{row.produk}</div>
                      <div className="text-[10px] font-mono text-zinc-500">
                        {row.docNumber} {row.sourceLabel ? `• ${row.sourceLabel}` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-cyan-400">
                      +{row.masuk.toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-semibold text-white">
                      {row.qty.toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-black text-emerald-400">
                      {row.totalStokMasuk.toLocaleString('id-ID')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="bg-zinc-950 font-bold border-t-2 border-zinc-700 text-white">
              <tr>
                <td colSpan={2} className="py-3 px-4 uppercase tracking-wider text-[11px]">
                  TOTAL RINCIAN PRODUK MASUK ({filteredMasuk.length} Log)
                </td>
                <td className="py-3 px-4 text-center font-mono text-cyan-400">
                  +{filteredMasuk.reduce((s, r) => s + r.masuk, 0).toLocaleString('id-ID')}
                </td>
                <td className="py-3 px-4 text-center font-mono text-white">
                  {filteredMasuk.reduce((s, r) => s + r.qty, 0).toLocaleString('id-ID')}
                </td>
                <td className="py-3 px-4 text-right font-mono text-emerald-400">
                  {filteredMasuk.reduce((s, r) => s + r.masuk, 0).toLocaleString('id-ID')}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* c. Sub-laporan 3: Rincian Produk Keluar */}
      {subReport === 'produk_keluar' && (
        <div className="overflow-x-auto bg-zinc-950/60 border border-zinc-800 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800 uppercase font-semibold tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Tanggal</th>
                <th className="py-3 px-4">Produk</th>
                <th className="py-3 px-4 text-center">Masuk</th>
                <th className="py-3 px-4 text-center">Qty</th>
                <th className="py-3 px-4 text-right">Total Stok Masuk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
              {filteredKeluar.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500">
                    Belum ada riwayat barang keluar / penjualan pada periode ini.
                  </td>
                </tr>
              ) : (
                filteredKeluar.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-800/40 transition">
                    <td className="py-3 px-4 font-mono text-zinc-300 whitespace-nowrap">
                      {row.tanggal}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-white">{row.produk}</div>
                      <div className="text-[10px] font-mono text-zinc-500">
                        {row.docNumber} {row.sourceLabel ? `• ${row.sourceLabel}` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-cyan-400">
                      {row.masuk.toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-rose-400">
                      {row.qty.toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-black text-emerald-400">
                      {row.totalStokMasuk.toLocaleString('id-ID')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="bg-zinc-950 font-bold border-t-2 border-zinc-700 text-white">
              <tr>
                <td colSpan={2} className="py-3 px-4 uppercase tracking-wider text-[11px]">
                  TOTAL RINCIAN PRODUK KELUAR ({filteredKeluar.length} Log)
                </td>
                <td className="py-3 px-4 text-center font-mono text-cyan-400">
                  {data.totalMasukUnits.toLocaleString('id-ID')}
                </td>
                <td className="py-3 px-4 text-center font-mono text-rose-400">
                  {filteredKeluar.reduce((s, r) => s + r.qty, 0).toLocaleString('id-ID')}
                </td>
                <td className="py-3 px-4 text-right font-mono text-emerald-400">
                  {data.totalMasukUnits.toLocaleString('id-ID')}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};

export default ReportDetailPanel;

