import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { Product, Transaction } from '../../types';
import {
  TrendingUp,
  DollarSign,
  Package,
  PieChart,
  BarChart3,
  Layers,
  Calendar,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAppData } from '../../context/AppDataContext';
import { formatMoney } from '../../utils/money';
import { evaluateProductExpiry } from '../../utils/expiryUtils';

export const AssetFinancialDashboard: React.FC = () => {
  const { currencyMode: globalCurrencyMode } = useLanguage();
  const { products: contextProducts, transactions: contextTransactions } = useAppData();
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    const unsubProducts = onSnapshot(
      collection(db, 'products'),
      (snapshot) => {
        const prods: Product[] = [];
        snapshot.forEach((doc) => prods.push({ id: doc.id, ...(doc.data() as Omit<Product, 'id'>) }));
        setProducts(prods);
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'products')
    );

    const unsubTransactions = onSnapshot(
      collection(db, 'transactions'),
      (snapshot) => {
        const txs: Transaction[] = [];
        snapshot.forEach((doc) => txs.push({ id: doc.id, ...(doc.data() as Omit<Transaction, 'id'>) }));
        setTransactions(txs);
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'transactions')
    );

    return () => {
      unsubProducts();
      unsubTransactions();
    };
  }, []);

  const activeProducts = products.length > 0 ? products : contextProducts;
  const activeTransactions = transactions.length > 0 ? transactions : contextTransactions;
  const formatCurrency = (val: number) => formatMoney(val, globalCurrencyMode);

  // Compute Asset & Financial Metrics
  const totalInventoryCost = activeProducts.reduce((sum, p) => sum + (p.stockInUnits * (p.costPerUnit || 0)), 0);
  const totalInventoryRetail = activeProducts.reduce((sum, p) => sum + (p.stockInUnits * (p.pricePerUnit || 0)), 0);
  const projectedMargin = totalInventoryRetail - totalInventoryCost;
  const marginPercentage = totalInventoryCost > 0 ? ((projectedMargin / totalInventoryRetail) * 100).toFixed(1) : '0';

  const completedTx = activeTransactions.filter((t) => t.status === 'completed');
  const realizedRevenue = completedTx.reduce((sum, t) => sum + (t.totalAmount || 0), 0);
  const realizedCOGS = completedTx.reduce((sum, t) => sum + (t.totalCost || 0), 0);
  const netGrossProfit = realizedRevenue - realizedCOGS;

  const flaggedTx = activeTransactions.filter((t) => t.status === 'flagged_fraud' || t.fraudScore >= 70);
  const valueAtRisk = flaggedTx.reduce((sum, t) => sum + (t.totalAmount || 0), 0);

  const riskRatio = realizedRevenue + totalInventoryRetail > 0
    ? Math.min(100, Math.round((valueAtRisk / (realizedRevenue + totalInventoryRetail)) * 100 * 3.5))
    : 0;

  const radius = 80;
  const strokeWidth = 14;
  const normalizedValue = Math.min(100, Math.max(0, riskRatio));
  const circumference = Math.PI * radius;
  const strokeDashoffset = circumference - (normalizedValue / 100) * circumference;

  let gaugeColor = '#10b981';
  let gaugeLabel = 'Safe / Minimal Risk';
  if (normalizedValue > 60) {
    gaugeColor = '#f43f5e';
    gaugeLabel = 'High Fraud Exposure';
  } else if (normalizedValue > 25) {
    gaugeColor = '#f59e0b';
    gaugeLabel = 'Guarded / Moderate';
  }

  const totalCartonsEquivalent = activeProducts.reduce((sum, p) => {
    return sum + (p.piecesPerCarton > 0 ? p.stockInUnits / p.piecesPerCarton : 0);
  }, 0);

  const expiryEvaluatedProducts = useMemo(() => {
    return activeProducts
      .map((p) => {
        const evalRes = evaluateProductExpiry(p);
        const stockUnits = Number(p.stockInUnits || 0);
        const unitCost = Number(p.costPerUnit || 0);
        const unitPrice = Number(p.pricePerUnit || 0);
        const assetRetailVal = stockUnits * unitPrice;
        const potentialLossVal = stockUnits * (unitCost > 0 ? unitCost : unitPrice);
        return {
          ...p,
          expiryEval: evalRes,
          stockUnits,
          assetRetailVal,
          potentialLossVal,
        };
      })
      .sort((a, b) => {
        const aDays = a.expiryEval.daysUntilExpiry ?? 999999;
        const bDays = b.expiryEval.daysUntilExpiry ?? 999999;
        return aDays - bDays;
      });
  }, [activeProducts]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Financial &amp; Asset Valuation</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Real-time balance sheet valuation, inventory capital allocation, and anti-fraud financial risk gauge meter.
        </p>
      </div>

      {/* Top Grid: Financial Gauge Meter & Capital Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Financial Risk Gauge Meter Card */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 flex flex-col items-center justify-between text-center shadow-xl">
          <div className="w-full flex items-center justify-between text-xs text-zinc-400 font-medium mb-2">
            <span>Risk Exposure Gauge</span>
            <span className="font-mono uppercase">{gaugeLabel}</span>
          </div>

          <div className="relative flex flex-col items-center justify-center my-2">
            <svg width="200" height="115" viewBox="0 0 200 115" className="overflow-visible">
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke="#27272a"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
              />
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke={gaugeColor}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-700 ease-out"
              />
            </svg>

            <div className="absolute bottom-2 flex flex-col items-center">
              <span className="text-3xl font-black text-white">{normalizedValue}%</span>
              <span className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
                Risk Index
              </span>
            </div>
          </div>

          <div className="w-full bg-zinc-950 p-3 rounded-xl border border-zinc-800/80 text-xs text-zinc-400 flex items-center justify-between mt-2">
            <div className="text-left">
              <div className="text-zinc-500 text-[10px] uppercase font-bold">Value At Risk (VAR)</div>
              <div className="text-sm font-bold text-rose-400">{formatCurrency(valueAtRisk)}</div>
            </div>
            <div className="text-right">
              <div className="text-zinc-500 text-[10px] uppercase font-bold">Active Shield</div>
              <div className="text-sm font-bold text-emerald-400">100% Intercepted</div>
            </div>
          </div>
        </div>

        {/* Inventory Balance Sheet Card */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between shadow-xl">
          <div>
            <div className="flex items-center justify-between text-xs text-zinc-400 font-medium">
              <span>Inventory Asset Value</span>
              <Package className="w-4 h-4 text-blue-400" />
            </div>

            <div className="mt-4">
              <div className="text-xs text-zinc-500 uppercase font-semibold">Total Retail Value</div>
              <div className="text-3xl font-black text-white mt-1">{formatCurrency(totalInventoryRetail)}</div>
            </div>

            <div className="mt-4 pt-4 border-t border-zinc-800 grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-zinc-500 block">Wholesale Cost (COGS)</span>
                <span className="font-semibold text-zinc-300 font-mono">{formatCurrency(totalInventoryCost)}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Gross Margin Potential</span>
                <span className="font-semibold text-emerald-400 font-mono">
                  +{formatCurrency(projectedMargin)} ({marginPercentage}%)
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-400 shrink-0" />
            <span>
              Total Packaging Volume: <strong>{totalCartonsEquivalent.toFixed(1)} Whole Cartons</strong> (Dus)
              in warehouse stock.
            </span>
          </div>
        </div>

        {/* Realized Cash & Revenue Card */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between shadow-xl">
          <div>
            <div className="flex items-center justify-between text-xs text-zinc-400 font-medium">
              <span>Realized Cashflow</span>
              <DollarSign className="w-4 h-4 text-emerald-400" />
            </div>

            <div className="mt-4">
              <div className="text-xs text-zinc-500 uppercase font-semibold">Gross Realized Revenue</div>
              <div className="text-3xl font-black text-emerald-400 mt-1">{formatCurrency(realizedRevenue)}</div>
            </div>

            <div className="mt-4 pt-4 border-t border-zinc-800 grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-zinc-500 block">Realized COGS Cost</span>
                <span className="font-semibold text-zinc-300 font-mono">{formatCurrency(realizedCOGS)}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Net Gross Profit</span>
                <span className="font-semibold text-emerald-400 font-mono">+{formatCurrency(netGrossProfit)}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              High-Trust Transaction Rate:{' '}
              <strong>{activeTransactions.length > 0 ? (((completedTx.length) / activeTransactions.length) * 100).toFixed(0) : 100}%</strong>{' '}
              without chargeback risk.
            </span>
          </div>
        </div>
      </div>

      {/* Expired Date Produk Panel */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Calendar className="w-4 h-4 text-amber-400" />
            Expired Date Produk
          </h3>
          <span className="text-xs text-zinc-400 font-mono">
            Aturan Peringatan: Soda / Mineral / Teh / Kopi (30 Hari)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-300">
            <thead className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="py-3 px-4">Nama Produk &amp; Kategori</th>
                <th className="py-3 px-4">Tanggal Produksi</th>
                <th className="py-3 px-4">Tanggal Kadaluarsa</th>
                <th className="py-3 px-4 text-center">Sisa Waktu Kadaluarsa</th>
                <th className="py-3 px-4 text-center">Stok Saat Ini</th>
                <th className="py-3 px-4 text-right">Nilai Aset (Jual)</th>
                <th className="py-3 px-4 text-right">Potensi Kerugian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {expiryEvaluatedProducts.map((p) => {
                const ev = p.expiryEval;
                return (
                  <tr key={p.id} className="hover:bg-zinc-800/30 transition">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white text-xs">{p.name}</div>
                      <span className="inline-block mt-0.5 text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                        {p.category}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-zinc-300">{ev.productionDateFormatted}</td>
                    <td className="py-3 px-4 text-xs font-mono text-white font-semibold">{ev.expiryDateFormatted}</td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          ev.status === 'expired' || ev.status === 'critical'
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            : ev.status === 'warning'
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : ev.status === 'safe'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {ev.countdownLabel}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center text-xs font-mono text-white font-semibold">
                      {p.stockUnits} Dus
                    </td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-blue-400 font-semibold">
                      {formatCurrency(p.assetRetailVal)}
                    </td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-rose-400 font-semibold">
                      {ev.isNearExpiry || ev.isExpired ? formatCurrency(p.potentialLossVal) : formatCurrency(0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Breakdown by Product Category Asset Value */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-xl">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-zinc-400" />
          Product Asset Breakdown (Cartons vs Loose Units)
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-300">
            <thead className="bg-zinc-950/60 text-xs uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="py-3 px-4">Product Name</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Carton Packaging</th>
                <th className="py-3 px-4">Stock Breakdown</th>
                <th className="py-3 px-4">Asset Value (Cost)</th>
                <th className="py-3 px-4">Asset Value (Retail)</th>
                <th className="py-3 px-4 text-right">Potential Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {activeProducts.map((p) => {
                const cartons = p.piecesPerCarton > 0 ? (p.stockInUnits / p.piecesPerCarton).toFixed(1) : '0';
                const assetCost = p.stockInUnits * (p.costPerUnit || 0);
                const assetRetail = p.stockInUnits * (p.pricePerUnit || 0);
                const margin = assetRetail - assetCost;

                return (
                  <tr key={p.id} className="hover:bg-zinc-800/30 transition">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white text-xs">{p.name}</div>
                      <div className="text-[11px] font-mono text-zinc-500">{p.sku}</div>
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-400">{p.category}</td>
                    <td className="py-3 px-4 text-xs font-mono text-zinc-300">
                      {p.piecesPerCarton} pcs / dus
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <span className="font-semibold text-white">{p.stockInUnits} units</span>
                      <span className="text-zinc-500 ml-1.5 font-mono">({cartons} cartons)</span>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-zinc-300">{formatCurrency(assetCost)}</td>
                    <td className="py-3 px-4 text-xs font-mono text-white font-semibold">
                      {formatCurrency(assetRetail)}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-emerald-400 text-right font-semibold">
                      +{formatCurrency(margin)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

