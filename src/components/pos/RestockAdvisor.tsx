import React, { useState, useEffect, useRef } from 'react';
import {
  collection,
  onSnapshot,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { Product, Transaction, RestockRecommendation } from '../../types';
import {
  subscribeToStockSync,
  StockSyncSnapshot,
  updateSynchronizedProductStock,
} from '../../services/stockSyncService';
import confetti from 'canvas-confetti';
import {
  Sparkles,
  Boxes,
  TrendingDown,
  TrendingUp,
  RefreshCw,
  CheckCircle,
  AlertOctagon,
  ArrowRight,
  PackageCheck,
  DollarSign,
  Eye,
  X,
  Clock,
  Layers,
  ShieldAlert,
  AlertCircle,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAppData } from '../../context/AppDataContext';
import {
  AILayoutToggleBar,
  AILayoutColumnMode,
  getDynamicLayoutGridClass,
} from '../common/AIShortcutCharts';

export const RestockAdvisor: React.FC = () => {
  const { language, tr } = useLanguage();
  const { products, transactions } = useAppData();
  const [syncSnapshot, setSyncSnapshot] = useState<StockSyncSnapshot | null>(null);
  const [recommendations, setRecommendations] = useState<RestockRecommendation[]>([]);
  const [executiveSummary, setExecutiveSummary] = useState<string>('');
  const [loadingAi, setLoadingAi] = useState<boolean>(false);
  const [isFallback, setIsFallback] = useState<boolean>(false);
  const [restockedSuccess, setRestockedSuccess] = useState<string | null>(null);
  const [selectedRecModal, setSelectedRecModal] = useState<RestockRecommendation | null>(null);
  const [isOverviewModalOpen, setIsOverviewModalOpen] = useState<boolean>(false);
  const [layoutMode, setLayoutMode] = useState<AILayoutColumnMode>('auto');
  const [layoutPrompt, setLayoutPrompt] = useState<string>('');
  const lastFetchedTxIdRef = useRef<string | null>(null);
  const dynamicGridClass = getDynamicLayoutGridClass(layoutMode, layoutPrompt, 2);

  useEffect(() => {
    // Subscribe to centralized stock synchronization service (0 extra Firestore reads)
    const unsubSync = subscribeToStockSync((snapshot) => {
      setSyncSnapshot(snapshot);
    });

    return () => {
      unsubSync();
    };
  }, []);

  // Fetch or Refresh AI Restock Recommendations using reconciled POS + PWA stock & velocity metrics
  const fetchAiRestockPlan = async () => {
    if (products.length === 0) return;
    setLoadingAi(true);
    try {
      const reconciledMetrics = syncSnapshot?.productMetrics || {};

      // Compute 7-day sales velocity strictly from completed transactions as fallback if metric not yet populated
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recent7dCompletedTx = transactions.filter((t) => {
        const status = String(t.status || '').toLowerCase();
        const fulfillment = String(t.fulfillmentStatus || '').toLowerCase();
        const isCompleted = status === 'completed' || fulfillment === 'completed';
        const ts = t.createdAt ? new Date(t.createdAt).getTime() : 0;
        return isCompleted && ts >= sevenDaysAgo;
      });

      const unitsSold7dMap: Record<string, number> = {};
      recent7dCompletedTx.forEach((tx) => {
        if (Array.isArray(tx.items)) {
          tx.items.forEach((item: any) => {
            const pId = item.productId || item.id;
            const prod = products.find((p) => p.id === pId);
            const piecesPerCarton = Math.max(1, Number(prod?.piecesPerCarton ?? 1));
            const sellByUnit = prod?.sellByUnit !== undefined ? Boolean(prod.sellByUnit) : true;
            const qtyOrdered = Number(item.quantityOrdered ?? item.quantity ?? 1);
            const qty =
              Number(item.unitsDeducted) > 0
                ? Number(item.unitsDeducted)
                : item.packageType === 'carton' && sellByUnit
                ? qtyOrdered * piecesPerCarton
                : qtyOrdered;
            if (pId) {
              unitsSold7dMap[pId] = (unitsSold7dMap[pId] || 0) + Number(qty || 0);
            }
          });
        }
      });

      // Prepare current stock levels and 7-day velocity arrays from reconciled metrics
      const currentStockLevels = products.map((p) => {
        const m = reconciledMetrics[p.id];
        const sold7d = m !== undefined ? m.unitsSold7d : unitsSold7dMap[p.id] || 0;
        const dailyVel = m !== undefined ? m.dailyVelocity : Number((sold7d / 7).toFixed(1));
        const stockUnits = m !== undefined ? m.stockInUnits : p.stockInUnits;
        return {
          id: p.id,
          productId: p.id,
          name: p.name,
          sku: p.sku || '',
          category: p.category || '',
          currentStockUnits: stockUnits,
          piecesPerCarton: p.piecesPerCarton || 1,
          costPerUnit: p.costPerUnit || 0,
          pricePerUnit: p.pricePerUnit || 0,
          minStockAlert: p.minStockAlert || 10,
          salesVelocity7d: sold7d,
          dailyVelocity: dailyVel,
        };
      });

      const salesVelocity7d = currentStockLevels.map((p) => ({
        productId: p.id,
        productName: p.name,
        unitsSold7d: p.salesVelocity7d,
        dailyAverageVelocity: p.dailyVelocity,
      }));

      const res = await fetch('/api/ai/restock-advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentStockLevels,
          salesVelocity7d,
          products: currentStockLevels,
          salesVelocity: salesVelocity7d,
          recentTransactions: recent7dCompletedTx.slice(0, 30),
          language,
        }),
      });

      const data = await res.json();
      setIsFallback(Boolean(data.isFallback));
      if (data.recommendations && Array.isArray(data.recommendations)) {
        setRecommendations(data.recommendations);
        setExecutiveSummary(data.executiveSummary || '');
      }
    } catch (error) {
      console.warn('Notice fetching restock recommendations:', error);
      setIsFallback(true);
    } finally {
      setLoadingAi(false);
    }
  };

  // Initial load & automatic refresh when a new POS or PWA transaction completes reconciliation
  useEffect(() => {
    if (products.length === 0) {
      setRecommendations([]);
      setExecutiveSummary('');
      return;
    }
    if (products.length > 0 && recommendations.length === 0 && !loadingAi) {
      void fetchAiRestockPlan();
    }
  }, [products]);

  useEffect(() => {
    const completedTxId = syncSnapshot?.lastCompletedTxId || null;
    if (
      completedTxId &&
      completedTxId !== lastFetchedTxIdRef.current &&
      products.length > 0 &&
      !loadingAi
    ) {
      lastFetchedTxIdRef.current = completedTxId;
      void fetchAiRestockPlan();
    }
  }, [syncSnapshot?.lastCompletedTxId, products.length]);

  // Execute 1-Click Purchase Order for a recommended item (synchronized across POS & PWA collections)
  const handleApplyRestock = async (rec: RestockRecommendation) => {
    try {
      const prod = products.find((p) => p.id === rec.productId);
      if (!prod) return;

      const unitsToAdd = rec.suggestedCartons * (prod.piecesPerCarton || 1);
      const newStock = prod.stockInUnits + unitsToAdd;

      await updateSynchronizedProductStock(prod.id, newStock, 'restock_advisor');

      // Remove from active recommendations list
      setRecommendations((prev) => prev.filter((r) => r.productId !== rec.productId));
      if (selectedRecModal?.productId === rec.productId) {
        setSelectedRecModal(null);
      }

      // Trigger festive celebration
      try {
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.7 },
        });
      } catch (e) {}

      setRestockedSuccess(
        `Restocked +${rec.suggestedCartons} Cartons (${unitsToAdd} units) for ${prod.name}! New Balance: ${newStock} units.`
      );
      setTimeout(() => setRestockedSuccess(null), 4500);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `products/${rec.productId}`);
    }
  };

  const totalRestockBudget = recommendations.reduce((sum, r) => sum + (r.estimatedCost || 0), 0);
  const totalCartonsNeeded = recommendations.reduce((sum, r) => sum + (r.suggestedCartons || 0), 0);

  const categoryMarginRows = React.useMemo(() => {
    if (products.length === 0) return [];
    const grouped: Record<string, Product[]> = {};
    products.forEach((p) => {
      const cat = (p.category || 'Uncategorized').trim() || 'Uncategorized';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(p);
    });

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentTx = transactions.filter((t) => {
      const st = String(t.status || '').toLowerCase();
      const ts = t.createdAt ? new Date(t.createdAt).getTime() : 0;
      return st === 'completed' && ts >= sevenDaysAgo;
    });

    return Object.entries(grouped).map(([category, items]) => {
      const avgPieces = Math.round(
        items.reduce((s, p) => s + Math.max(1, Number(p.piecesPerCarton || 1)), 0) / items.length
      );
      const margins = items.map((p) => {
        const price = Number(p.pricePerCarton || (p.pricePerUnit || 0) * Math.max(1, Number(p.piecesPerCarton || 1)));
        const cost = Number(p.costPerCarton || (p.costPerUnit || 0) * Math.max(1, Number(p.piecesPerCarton || 1)));
        return price > 0 ? ((price - cost) / price) * 100 : 0;
      });
      const avgMargin = Number((margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(1));

      let soldUnits7d = 0;
      const itemIds = new Set(items.map((i) => i.id));
      recentTx.forEach((tx) => {
        if (Array.isArray(tx.items)) {
          tx.items.forEach((it: any) => {
            const pid = it.productId || it.id;
            if (itemIds.has(pid)) {
              soldUnits7d += Number(it.unitsDeducted || it.quantityOrdered || it.quantity || 1);
            }
          });
        }
      });

      const totalStock = items.reduce((s, p) => s + Math.max(0, Number(p.stockInUnits || 0)), 0);
      const dailyVel = soldUnits7d / 7;
      const turnoverDays = dailyVel > 0 ? Number((totalStock / dailyVel).toFixed(1)) : 0;

      const turnoverText =
        dailyVel <= 0
          ? 'Belum ada transaksi (0.0 days)'
          : turnoverDays <= 3
          ? `Sangat Tinggi (${turnoverDays} days)`
          : turnoverDays <= 7
          ? `Tinggi (${turnoverDays} days)`
          : `Sedang (${turnoverDays} days)`;

      const recommendation =
        avgMargin >= 20
          ? 'Pertahankan ketersediaan stok dus & dorong bundling grosir'
          : 'Jaga stok aman & batasi diskon grosir berlebih';

      return {
        category,
        packagingLabel: `Karton Dus (${avgPieces}x)`,
        avgMargin,
        turnoverText,
        recommendation,
      };
    });
  }, [products, transactions]);

  return (
    <div className="w-full max-w-none px-4 space-y-6">
      {/* Success Banner */}
      {restockedSuccess && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span>{restockedSuccess}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-white">{tr('AI Restock Advisor', 'AI Restock Advisor')}</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Gemini 2.5 Flash Demand Planning
            </span>
            {isFallback && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1 shadow-sm">
                <AlertCircle className="w-3 h-3 text-amber-400" />
                <span>{tr('Rule-based fallback', 'Cadangan berbasis aturan')}</span>
              </span>
            )}
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            {tr(
              'Intelligent inventory forecasting calculating 7-day sales velocity and wholesale carton replenishment.',
              'Forecasting inventaris cerdas menghitung kecepatan penjualan 7 hari dan pengadaan dus grosir.'
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <AILayoutToggleBar
            mode={layoutMode}
            onChange={setLayoutMode}
            promptText={layoutPrompt}
          />
          <input
            type="text"
            value={layoutPrompt}
            onChange={(e) => setLayoutPrompt(e.target.value)}
            placeholder="Ketik 'buat 2 kolom' / 'buat 4 kolom'..."
            className="px-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 w-48 focus:outline-none focus:border-amber-500"
          />
          {recommendations.length > 0 && (
            <button
              onClick={() => setIsOverviewModalOpen(true)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold border border-zinc-700 transition cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-blue-400" />
              {tr('Open AI Plan Modal', 'Buka Modal AI Plan')}
            </button>
          )}

          <button
            onClick={fetchAiRestockPlan}
            disabled={loadingAi || products.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold transition shadow-lg shadow-blue-600/20 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingAi ? 'animate-spin' : ''}`} />
            {loadingAi ? tr('Analyzing Demand...', 'Menganalisis Demand...') : tr('Recalculate AI Forecast', 'Hitung Ulang AI Forecast')}
          </button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className={dynamicGridClass}>
        <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-xl">
          <div className="text-xs text-zinc-400 font-medium">Restock Capital Required</div>
          <div className="text-2xl font-black text-white mt-1">
            Rp {Math.round(totalRestockBudget).toLocaleString('id-ID')}
          </div>
          <div className="text-xs text-zinc-500 mt-1">Projected wholesale PO amount</div>
        </div>

        <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-xl">
          <div className="text-xs text-zinc-400 font-medium">Total Bulk Cartons</div>
          <div className="text-2xl font-black text-blue-400 mt-1">{totalCartonsNeeded} Whole Cartons</div>
          <div className="text-xs text-zinc-500 mt-1">Packaged to avoid broken lots</div>
        </div>

        <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-xl">
          <div className="text-xs text-zinc-400 font-medium">Critical Action Items</div>
          <div className="text-2xl font-black text-amber-400 mt-1">
            {recommendations.filter((r) => r.urgency === 'urgent').length} Items
          </div>
          <div className="text-xs text-zinc-500 mt-1">Approaching imminent stockout</div>
        </div>
      </div>

      {/* Executive Summary Card */}
      {executiveSummary && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-blue-950/30 to-purple-950/20 border border-blue-800/40 text-xs text-zinc-300 leading-relaxed flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <strong className="text-white block mb-0.5">Gemini Executive Forecast:</strong>
            <p>{executiveSummary}</p>
          </div>
        </div>
      )}

      {/* Recommendations Cards List */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Boxes className="w-5 h-5 text-zinc-400" />
          Recommended Purchase Orders by Carton Multiplier
        </h2>

        {recommendations.length === 0 ? (
          <div className="p-12 text-center text-zinc-500 bg-zinc-900/60 rounded-2xl border border-zinc-800">
            <PackageCheck className="w-10 h-10 mx-auto mb-2 text-emerald-400 opacity-60" />
            <p className="text-sm font-semibold text-zinc-300">
              {products.length === 0
                ? 'Belum ada data produk & transaksi untuk dianalisis.'
                : 'Inventory Levels Fully Optimized'}
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              {products.length === 0
                ? 'Tambahkan produk terlebih dahulu di menu Master Produk untuk mendapatkan analisis pengadaan stok AI.'
                : 'All product lines maintain adequate safety stock buffers based on current runout velocity.'}
            </p>
          </div>
        ) : (
          <div className={dynamicGridClass}>
            {recommendations.map((rec) => {
              const isUrgent = rec.urgency === 'urgent';

              return (
                <div
                  key={rec.productId}
                  className={`p-5 rounded-2xl bg-zinc-900/90 border transition flex flex-col justify-between shadow-xl ${
                    isUrgent ? 'border-amber-500/40 bg-amber-950/5' : 'border-zinc-800'
                  }`}
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider mb-1 ${
                            isUrgent
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          }`}
                        >
                          {rec.urgency} Restock
                        </span>
                        <h3 className="text-base font-bold text-white">{rec.productName}</h3>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] uppercase font-semibold text-zinc-500 block">
                          Current Stock
                        </span>
                        <span className="text-sm font-bold text-white font-mono">
                          {rec.currentStockUnits} units
                        </span>
                      </div>
                    </div>

                    {/* Carton Box Recommendation */}
                    <div className="mt-4 p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] uppercase font-semibold text-zinc-500">
                          Recommended Order
                        </div>
                        <div className="text-xl font-black text-blue-400 mt-0.5">
                          +{rec.suggestedCartons} Cartons
                        </div>
                        <div className="text-[11px] text-zinc-400">
                          (= {rec.suggestedCartons * (rec.piecesPerCarton || 1)} loose units)
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[10px] uppercase font-semibold text-zinc-500">
                          Estimated Cost
                        </div>
                        <div className="text-lg font-bold text-white mt-0.5 font-mono">
                          Rp {Math.round(rec.estimatedCost || 0).toLocaleString('id-ID')}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          at wholesale COGS
                        </div>
                      </div>
                    </div>

                    {/* AI Rationale */}
                    <p className="mt-3 text-xs text-zinc-400 leading-relaxed italic bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-850">
                      &quot;{rec.aiRationale}&quot;
                    </p>
                  </div>

                  {/* Actions Bar */}
                  <div className="mt-5 pt-3 border-t border-zinc-800 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-500 truncate">
                      1 Dus = {rec.piecesPerCarton || 1} Pcs
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSelectedRecModal(rec)}
                        className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium border border-zinc-700 transition flex items-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5 text-blue-400" />
                        Detail Modal
                      </button>

                      <button
                        onClick={() => handleApplyRestock(rec)}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow-lg shadow-emerald-600/20"
                      >
                        <PackageCheck className="w-4 h-4" />
                        Approve PO
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Margin Analysis Breakdown Table */}
      <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4">
        <h3 className="font-bold text-white text-sm">Analisis Margin Laba per Kemasan (Dus vs Satuan)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-zinc-950 text-zinc-400 uppercase text-[10px]">
              <tr>
                <th className="p-3">Kategori Produk</th>
                <th className="p-3">Kemasan Wholesale</th>
                <th className="p-3">Margin Rata-rata</th>
                <th className="p-3">Perputaran Stok</th>
                <th className="p-3">Rekomendasi AI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 text-zinc-300">
              {categoryMarginRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-zinc-500 font-medium">
                    Belum ada data produk &amp; transaksi untuk dianalisis.
                  </td>
                </tr>
              ) : (
                categoryMarginRows.map((row, idx) => (
                  <tr key={`cat-margin-${row.category}-${idx}`} className="hover:bg-zinc-850/40 transition">
                    <td className="p-3 font-semibold text-white">{row.category}</td>
                    <td className="p-3 font-mono">{row.packagingLabel}</td>
                    <td
                      className={`p-3 font-bold ${
                        row.avgMargin >= 20
                          ? 'text-emerald-400'
                          : row.avgMargin >= 10
                          ? 'text-zinc-200'
                          : 'text-rose-400'
                      }`}
                    >
                      {row.avgMargin}%
                    </td>
                    <td className="p-3 text-emerald-400 font-semibold">{row.turnoverText}</td>
                    <td className="p-3 text-[11px] text-zinc-400">{row.recommendation}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* UI MODAL: Single Item Restock Detail Modal */}
      {selectedRecModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base leading-tight">
                    {selectedRecModal.productName}
                  </h3>
                  <span className="text-xs text-zinc-400">
                    AI Demand Planning & Whole-Carton Allocation
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedRecModal(null)}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 overflow-y-auto">
              {/* Urgency Badge & Status */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                <div className="flex items-center gap-2">
                  <ShieldAlert
                    className={`w-4 h-4 ${
                      selectedRecModal.urgency === 'urgent' ? 'text-amber-400' : 'text-blue-400'
                    }`}
                  />
                  <span className="text-xs font-medium text-zinc-300">Tingkat Urgensi:</span>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                    selectedRecModal.urgency === 'urgent'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  }`}
                >
                  {selectedRecModal.urgency}
                </span>
              </div>

              {/* Demand Metrics Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500 block">Stok Saat Ini</span>
                  <strong className="text-white text-sm font-mono mt-0.5 block">
                    {selectedRecModal.currentStockUnits} Units
                  </strong>
                </div>
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500 block">Kemasan Grosir</span>
                  <strong className="text-blue-400 text-sm font-mono mt-0.5 block">
                    1 Dus = {selectedRecModal.piecesPerCarton || 1} Pcs
                  </strong>
                </div>
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500 block">Rekomendasi Pembelian</span>
                  <strong className="text-emerald-400 text-sm font-mono mt-0.5 block">
                    +{selectedRecModal.suggestedCartons} Dus ({selectedRecModal.suggestedCartons * (selectedRecModal.piecesPerCarton || 1)} pcs)
                  </strong>
                </div>
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-500 block">Estimasi Modal HPP</span>
                  <strong className="text-white text-sm font-mono mt-0.5 block">
                    Rp {Math.round(selectedRecModal.estimatedCost || 0).toLocaleString('id-ID')}
                  </strong>
                </div>
              </div>

              {/* AI Explanation / Rationale */}
              <div className="p-4 rounded-xl bg-blue-950/20 border border-blue-900/40 space-y-1.5">
                <div className="flex items-center gap-1.5 text-blue-400 text-xs font-bold">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Justifikasi Gemini Demand Engine:</span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed italic">
                  &quot;{selectedRecModal.aiRationale}&quot;
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-zinc-800 bg-zinc-950/50 flex items-center justify-end gap-3">
              <button
                onClick={() => setSelectedRecModal(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition"
              >
                Tutup
              </button>
              <button
                onClick={() => handleApplyRestock(selectedRecModal)}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow-lg shadow-emerald-600/20"
              >
                <PackageCheck className="w-4 h-4" />
                Setujui & Buat Purchase Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UI MODAL: All AI Restock Recommendations Overview Modal */}
      {isOverviewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Boxes className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">
                    Ringkasan Matriks Restock AI
                  </h3>
                  <span className="text-xs text-zinc-400">
                    Daftar rekomendasi pengadaan dus grosir lengkap ({recommendations.length} produk)
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsOverviewModalOpen(false)}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="p-3.5 rounded-xl bg-blue-950/20 border border-blue-900/30 text-xs text-zinc-300">
                <strong className="text-white block mb-1">Executive Demand Summary:</strong>
                <p>{executiveSummary || 'Semua rekomendasi dioptimalkan untuk pencegahan kehabisan stok ritel.'}</p>
              </div>

              <div className="space-y-2">
                {recommendations.map((rec) => (
                  <div
                    key={rec.productId}
                    className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white truncate">{rec.productName}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase ${
                            rec.urgency === 'urgent'
                              ? 'bg-amber-500/20 text-amber-400'
                              : 'bg-blue-500/20 text-blue-400'
                          }`}
                        >
                          {rec.urgency}
                        </span>
                      </div>
                      <span className="text-zinc-500 text-[11px] block mt-0.5">
                        Stok: {rec.currentStockUnits} unit &bull; Order: +{rec.suggestedCartons} Dus
                      </span>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-mono text-emerald-400 font-bold">
                        Rp {Math.round(rec.estimatedCost || 0).toLocaleString('id-ID')}
                      </div>
                      <button
                        onClick={() => {
                          setIsOverviewModalOpen(false);
                          handleApplyRestock(rec);
                        }}
                        className="mt-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium"
                      >
                        Approve PO &rarr;
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-zinc-800 bg-zinc-950/50 flex items-center justify-between">
              <span className="text-xs text-zinc-400">
                Total Budget: <strong className="text-white">Rp {Math.round(totalRestockBudget).toLocaleString('id-ID')}</strong> ({totalCartonsNeeded} Dus)
              </span>
              <button
                onClick={() => setIsOverviewModalOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold"
              >
                Tutup Modal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

