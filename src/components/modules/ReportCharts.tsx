import React, { useState } from 'react';
import {
  DailyReport,
  OutletMetric,
  PaymentMetric,
  LocationMetric,
} from './multiOutletReport';
import { fmtMoney } from '../../utils/money';
import { TrendingUp, BarChart3, PieChart, Boxes } from 'lucide-react';

export interface ReportDetailTarget {
  kind: 'revenue' | 'transaksi' | 'profit' | 'stok' | 'outlet' | 'gudang';
  id?: string;
  filter?: string;
}

interface ReportChartsProps {
  daily: DailyReport[];
  byOutlet: OutletMetric[];
  byPayment: PaymentMetric[];
  byLocation: LocationMetric[];
  currencyMode?: 'IDR' | 'USD';
  onSelectDetail: (target: ReportDetailTarget) => void;
}

import { useLanguage } from '../../context/LanguageContext';

export const ReportCharts: React.FC<ReportChartsProps> = ({
  daily,
  byOutlet,
  byPayment,
  byLocation,
  currencyMode: propCurrencyMode,
  onSelectDetail,
}) => {
  const { currencyMode: ctxCurrencyMode } = useLanguage();
  const currencyMode = propCurrencyMode || ctxCurrencyMode;
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);

  // 1. Line Chart calculations (Daily Revenue)
  const maxDailyRevenue = Math.max(...daily.map((d) => d.revenue), 10);
  const chartWidth = 560;
  const chartHeight = 180;
  const paddingX = 40;
  const paddingY = 24;
  const innerWidth = chartWidth - paddingX * 2;
  const innerHeight = chartHeight - paddingY * 2;

  const points = daily.map((d, index) => {
    const x =
      daily.length > 1
        ? paddingX + (index / (daily.length - 1)) * innerWidth
        : paddingX + innerWidth / 2;
    const y =
      paddingY + innerHeight - (d.revenue / maxDailyRevenue) * innerHeight;
    return { x, y, ...d };
  });

  const linePath = points.length
    ? points.reduce(
        (acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`,
        ''
      )
    : '';

  const areaPath = points.length
    ? `${linePath} L ${points[points.length - 1].x.toFixed(1)},${(paddingY + innerHeight).toFixed(
        1
      )} L ${points[0].x.toFixed(1)},${(paddingY + innerHeight).toFixed(1)} Z`
    : '';

  // 2. Bar Chart (Revenue by Outlet)
  const maxOutletRevenue = Math.max(...byOutlet.map((o) => o.revenue), 10);

  // 3. Donut Chart (Payment Methods)
  const totalPayment = byPayment.reduce((sum, p) => sum + p.amount, 0);
  const donutColors = ['#f59e0b', '#fbbf24', '#10b981', '#d97706', '#fcd34d', '#059669'];
  const donutRadius = 55;
  const donutCircumference = 2 * Math.PI * donutRadius;

  let accumulatedPercent = 0;
  const donutSlices = byPayment.map((p, idx) => {
    const percent = totalPayment > 0 ? p.amount / totalPayment : 0;
    const strokeDasharray = `${(percent * donutCircumference).toFixed(1)} ${(
      donutCircumference * (1 - percent)
    ).toFixed(1)}`;
    const strokeDashoffset = (-accumulatedPercent * donutCircumference).toFixed(1);
    accumulatedPercent += percent;
    return {
      ...p,
      color: donutColors[idx % donutColors.length],
      strokeDasharray,
      strokeDashoffset,
    };
  });

  // 4. Bar Chart (Stock Value by Location)
  const maxStockValue = Math.max(...byLocation.map((l) => l.stockValue), 10);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* CHART 1: Tren Revenue Harian (Garis) */}
      <div
        className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 hover:border-blue-500/60 transition flex flex-col justify-between"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Tren Revenue Harian</h3>
              <p className="text-[11px] text-zinc-400">Akumulasi penjualan sukses per tanggal</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelectDetail({ kind: 'revenue' })}
            className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer"
          >
            <span>Lihat detail ›</span>
          </button>
        </div>

        <div className="relative w-full h-52 flex items-center justify-center">
          {daily.length === 0 ? (
            <div className="text-xs text-zinc-500">Belum ada data grafik</div>
          ) : (
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="w-full h-full overflow-visible"
            >
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.38" />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid Horizontal */}
              {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
                const y = paddingY + innerHeight * (1 - pct);
                return (
                  <line
                    key={i}
                    x1={paddingX}
                    y1={y}
                    x2={chartWidth - paddingX}
                    y2={y}
                    stroke="#262013"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                  />
                );
              })}

              {/* Area */}
              {areaPath && (
                <path d={areaPath} fill="url(#revenueGradient)" />
              )}

              {/* Line */}
              {linePath && (
                <path
                  d={linePath}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Points */}
              {points.map((p, idx) => (
                <g key={idx}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={hoveredPoint === idx ? 6 : 4}
                    fill={hoveredPoint === idx ? '#fcd34d' : '#f59e0b'}
                    stroke="#070604"
                    strokeWidth="1.5"
                    className="cursor-pointer transition-all duration-150"
                    onMouseEnter={() => setHoveredPoint(idx)}
                    onMouseLeave={() => setHoveredPoint(null)}
                    onClick={() =>
                      onSelectDetail({ kind: 'revenue', filter: p.date })
                    }
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        onSelectDetail({ kind: 'revenue', filter: p.date });
                      }
                    }}
                  />
                  {/* Subtle date labels for key points */}
                  {(idx === 0 ||
                    idx === Math.floor(points.length / 2) ||
                    idx === points.length - 1) && (
                    <text
                      x={p.x}
                      y={chartHeight - 4}
                      fill="#9c8f7a"
                      fontSize="10"
                      textAnchor="middle"
                      fontFamily="monospace"
                    >
                      {p.label}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          )}

          {hoveredPoint !== null && points[hoveredPoint] && (
            <div
              role="tooltip"
              className="rc-tooltip-box absolute bg-[#12100b] border border-amber-500/40 rounded-lg px-2.5 py-1.5 shadow-xl text-left pointer-events-none text-[11px] z-20"
              style={{
                left: `${(points[hoveredPoint].x / chartWidth) * 100}%`,
                top: `${(points[hoveredPoint].y / chartHeight) * 100}%`,
                transform: 'translate(-50%, -120%)',
              }}
            >
              <div className="rc-tooltip-title font-mono font-semibold text-amber-300/80 text-[10px]">
                {points[hoveredPoint].label}
              </div>
              <div className="rc-tooltip-accent font-bold text-emerald-400 font-mono">
                {fmtMoney(points[hoveredPoint].revenue, currencyMode)}
              </div>
              <div className="rc-tooltip-label text-amber-200/60 text-[9px]">
                {points[hoveredPoint].transactionCount} transaksi
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CHART 2: Revenue per Outlet (Batang) */}
      <div
        className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 hover:border-blue-500/60 transition flex flex-col justify-between"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Revenue per Outlet</h3>
              <p className="text-[11px] text-zinc-400">Komparasi omzet antar cabang fisik</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelectDetail({ kind: 'outlet' })}
            className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer"
          >
            <span>Lihat detail ›</span>
          </button>
        </div>

        <div className="space-y-3.5 py-2">
          {byOutlet.map((outlet) => {
            const pct =
              maxOutletRevenue > 0
                ? Math.round((outlet.revenue / maxOutletRevenue) * 100)
                : 0;
            return (
              <div
                key={outlet.outletId}
                onClick={() => onSelectDetail({ kind: 'outlet', id: outlet.outletId })}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelectDetail({ kind: 'outlet', id: outlet.outletId });
                  }
                }}
                className="group p-2 -mx-2 rounded-xl hover:bg-zinc-800/40 cursor-pointer transition"
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                      {outlet.code}
                    </span>
                    <span className="font-bold text-zinc-200 group-hover:text-blue-400 transition truncate">
                      {outlet.name}
                    </span>
                  </div>
                  <span className="font-mono font-bold text-emerald-400 ml-2 shrink-0">
                    {fmtMoney(outlet.revenue, currencyMode)}
                  </span>
                </div>
                <div className="w-full bg-zinc-950 rounded-full h-2.5 overflow-hidden border border-zinc-800/80">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-600 to-emerald-500 transition-all duration-300 group-hover:brightness-110"
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
                  <span>{outlet.completedCount} transaksi sukses</span>
                  <span>{outlet.criticalStockCount} SKU kritis</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CHART 3: Metode Pembayaran (Donut) */}
      <div
        className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 hover:border-blue-500/60 transition flex flex-col justify-between"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center">
              <PieChart className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Metode Pembayaran</h3>
              <p className="text-[11px] text-zinc-400">Distribusi kanal kasir & QRIS</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelectDetail({ kind: 'transaksi' })}
            className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer"
          >
            <span>Lihat detail ›</span>
          </button>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-6 py-2">
          {/* Donut SVG */}
          <div className="relative w-36 h-36 shrink-0 flex items-center justify-center">
            {byPayment.length === 0 ? (
              <div className="text-[11px] text-zinc-500">Tidak ada data</div>
            ) : (
              <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
                <circle
                  cx="70"
                  cy="70"
                  r={donutRadius}
                  fill="none"
                  stroke="#27272a"
                  strokeWidth="16"
                />
                {donutSlices.map((slice, i) => (
                  <circle
                    key={i}
                    cx="70"
                    cy="70"
                    r={donutRadius}
                    fill="none"
                    stroke={slice.color}
                    strokeWidth="16"
                    strokeDasharray={slice.strokeDasharray}
                    strokeDashoffset={slice.strokeDashoffset}
                    className="cursor-pointer transition-all hover:opacity-85"
                    onClick={() =>
                      onSelectDetail({ kind: 'transaksi', filter: slice.method })
                    }
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        onSelectDetail({ kind: 'transaksi', filter: slice.method });
                      }
                    }}
                  />
                ))}
              </svg>
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">
                Total
              </span>
              <span className="text-xs font-mono font-bold text-white">
                {byPayment.reduce((s, p) => s + p.count, 0)} Tx
              </span>
            </div>
          </div>

          {/* Legend */}
          <div className="flex-1 w-full space-y-2">
            {donutSlices.slice(0, 4).map((slice) => (
              <div
                key={slice.method}
                onClick={() =>
                  onSelectDetail({ kind: 'transaksi', filter: slice.method })
                }
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelectDetail({ kind: 'transaksi', filter: slice.method });
                  }
                }}
                className="flex items-center justify-between text-xs p-1.5 rounded-lg hover:bg-zinc-800/40 cursor-pointer transition"
              >
                <div className="flex items-center gap-2 truncate">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="text-zinc-300 font-medium truncate">
                    {slice.label}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-mono text-zinc-200 font-bold block">
                    {fmtMoney(slice.amount, currencyMode)}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {slice.percentage.toFixed(1)}% ({slice.count} tx)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CHART 4: Nilai Stok per Lokasi (Batang) */}
      <div
        className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 hover:border-blue-500/60 transition flex flex-col justify-between"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center">
              <Boxes className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Nilai Stok per Lokasi</h3>
              <p className="text-[11px] text-zinc-400">Valuasi stok di toko dan gudang sentral</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelectDetail({ kind: 'stok' })}
            className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer"
          >
            <span>Lihat detail ›</span>
          </button>
        </div>

        <div className="space-y-3 py-1">
          {byLocation.map((loc) => {
            const pct =
              maxStockValue > 0
                ? Math.round((loc.stockValue / maxStockValue) * 100)
                : 0;
            const isWarehouse = loc.type === 'warehouse';

            return (
              <div
                key={loc.locationId}
                onClick={() =>
                  onSelectDetail({
                    kind: isWarehouse ? 'gudang' : 'outlet',
                    id: loc.locationId,
                  })
                }
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelectDetail({
                      kind: isWarehouse ? 'gudang' : 'outlet',
                      id: loc.locationId,
                    });
                  }
                }}
                className="group p-1.5 -mx-1.5 rounded-xl hover:bg-zinc-800/40 cursor-pointer transition"
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded font-mono ${
                        isWarehouse
                          ? 'bg-purple-950/70 text-purple-400 border border-purple-800/60'
                          : 'bg-blue-950/70 text-blue-400 border border-blue-800/60'
                      }`}
                    >
                      {isWarehouse ? 'GUDANG' : 'OUTLET'}
                    </span>
                    <span className="font-bold text-zinc-200 group-hover:text-purple-400 transition truncate">
                      {loc.name}
                    </span>
                  </div>
                  <span className="font-mono font-bold text-zinc-100 ml-2 shrink-0">
                    {fmtMoney(loc.stockValue, currencyMode)}
                  </span>
                </div>
                <div className="w-full bg-zinc-950 rounded-full h-2 overflow-hidden border border-zinc-800/80">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isWarehouse
                        ? 'bg-purple-500 group-hover:bg-purple-400'
                        : 'bg-blue-500 group-hover:bg-blue-400'
                    }`}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
                  <span>{loc.totalUnits.toLocaleString('id-ID')} unit terdaftar</span>
                  <span className={loc.criticalCount > 0 ? 'text-amber-400 font-medium' : ''}>
                    {loc.criticalCount} kritis
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
