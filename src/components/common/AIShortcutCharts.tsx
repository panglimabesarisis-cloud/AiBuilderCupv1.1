import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
} from 'recharts';
import {
  TrendingUp,
  ShoppingBag,
  DollarSign,
  Package,
  Layers,
  ArrowUpRight,
  Users,
  Calendar,
  Award,
  Clock,
  Zap,
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import { formatRupiah } from '../../utils/money';

// 10 Shortcut Tags Metadata & Definitions
export interface ChartShortcutDef {
  tag: string;
  aliases: string[];
  title: string;
  description: string;
  category: 'Risk' | 'Dashboard' | 'Performance' | 'Inventory' | 'Financial';
  icon: string;
}

export const CHART_SHORTCUT_TAGS: ChartShortcutDef[] = [
  {
    tag: '#RiskGauge',
    aliases: ['#InvoicePower', '#FraudRisk', '#GaugeChart'],
    title: 'Speedometer Risk Gauge (180° Semi-Arc)',
    description: 'Gauge speedometer risiko dengan busur gradasi Hijau -> Kuning -> Oranye -> Merah & jarum runcing.',
    category: 'Risk',
    icon: '⚡',
  },
  {
    tag: '#SalesGridDashboard',
    aliases: ['#FullDashboard', '#EnterpriseGrid', '#MasterDashboard'],
    title: 'Sales Grid Dashboard Lengkap',
    description: 'Dashboard eksekutif lengkap dengan 6 KPI cards, Heatmap waktu, Top 5 produk, dan Donut channel.',
    category: 'Dashboard',
    icon: '📊',
  },
  {
    tag: '#TargetLineChart',
    aliases: ['#ActualVsTarget', '#LineTarget', '#SalesTargetComparison'],
    title: 'Perbandingan Target vs Aktual Line Chart',
    description: '2 garis kurva: Solid Biru Terang (#0ea5e9) Aktual vs Putus-putus Oranye (#f97316) Target.',
    category: 'Performance',
    icon: '📈',
  },
  {
    tag: '#SourceBar',
    aliases: ['#HorizontalBar', '#ChannelBar', '#SourceRevenue'],
    title: 'Horizontal Multi-Color Source Bar',
    description: 'Grafik batang horizontal membulat dengan 5 warna (Biru, Sky Blue, Amber, Oranye, Cream) & nilai ujung.',
    category: 'Financial',
    icon: '📑',
  },
  {
    tag: '#ExecutiveOverview',
    aliases: ['#SparklineKPI', '#OverviewCards', '#ExecutiveKPI'],
    title: 'Executive Overview + Mini Sparkline KPIs',
    description: '6 Kartu KPI dengan icon box, persentase pertumbuhan, nilai besar, dan sparkline chart mini.',
    category: 'Dashboard',
    icon: '🏆',
  },
  {
    tag: '#KategoriDonut',
    aliases: ['#DonutChart', '#CategoryDonut', '#PieKategori'],
    title: 'Ring Doughnut Chart dengan Total Tengah',
    description: 'Doughnut chart 5 warna (Biru, Tosca, Ungu, Oranye, Pink) dengan total nilai besar di tengah.',
    category: 'Inventory',
    icon: '🍩',
  },
  {
    tag: '#TopKategori',
    aliases: ['#ProgressList', '#TopCategoryProgress', '#LeaderboardList'],
    title: 'Top Kategori Progress Bar List',
    description: 'Daftar peringkat 5 teratas dengan icon box, horizontal progress bar tipis, nominal Rp, dan % share.',
    category: 'Performance',
    icon: '🥇',
  },
  {
    tag: '#GlowAreaChart',
    aliases: ['#RevenueArea', '#GlowArea', '#NeonArea'],
    title: 'Glow Area Chart Biru Elektrik (#0066ff)',
    description: 'Smooth monotone area chart dengan glowing blue dots (drop-shadow neon) & gradasi transparan.',
    category: 'Financial',
    icon: '✨',
  },
  {
    tag: '#MultiColorBar',
    aliases: ['#AssetBar', '#VerticalMultiBar', '#TopBarChart'],
    title: 'Multi-Color Vertical Bar Chart',
    description: 'Bar chart vertikal dengan 5 warna elegan (Biru, Tosca, Ungu, Oranye, Pink) & label angka di atas batang.',
    category: 'Inventory',
    icon: '📊',
  },
  {
    tag: '#BurndownChart',
    aliases: ['#SalesTargetArea', '#IdealBurndown', '#TargetProjectionArea'],
    title: 'Burndown & Sales Target Area Chart',
    description: 'Area chart Biru-Indigo dengan titik glowing dikombinasikan garis lurus putus-putus target putih.',
    category: 'Performance',
    icon: '📉',
  },
];

/**
 * Normalizes input text to find which shortcut tags are present.
 */
export function extractChartShortcutsFromPrompt(promptText: string): string[] {
  if (!promptText) return [];
  const found: string[] = [];
  const lower = promptText.toLowerCase();

  CHART_SHORTCUT_TAGS.forEach((def) => {
    const mainKey = def.tag.toLowerCase();
    if (lower.includes(mainKey)) {
      found.push(def.tag);
      return;
    }
    for (const alias of def.aliases) {
      if (lower.includes(alias.toLowerCase())) {
        found.push(def.tag);
        return;
      }
    }
  });

  return Array.from(new Set(found));
}

/**
 * Shared real-time aggregation helper from AppDataContext (`products`, `transactions`, `orders`, `customers`, `procurements`, `shifts`, `brangkas_toko_logs`)
 */
function useRealTimeCanvasAnalytics() {
  const {
    products,
    transactions,
    orders,
    customers,
    procurements = [],
    shifts = [],
    brangkas_toko_logs = [],
    formatMoney,
    formatCompactMoney,
  } = useAppData();

  return useMemo(() => {
    const productById = new Map<string, any>();
    const productByName = new Map<string, any>();
    products.forEach((p: any) => {
      if (p.id) productById.set(String(p.id), p);
      if (p.name) productByName.set(String(p.name).trim().toLowerCase(), p);
    });

    // Identify unique transactions and standalone orders to prevent double counting
    const txIds = new Set<string>();
    let posTurnover = 0;
    let pwaTurnoverFromTx = 0;
    let totalCost = 0;
    let posReceiptsCount = 0;

    const validTransactions = transactions.filter((t: any) => {
      const st = String(t.status || '').toLowerCase();
      return st !== 'void' && st !== 'cancelled' && st !== 'batal';
    });

    validTransactions.forEach((t: any) => {
      txIds.add(String(t.id));
      const amt = Number(t.totalAmount ?? t.total ?? 0);
      const ch = String(t.channel || t.source || '').toLowerCase();
      const isPwa = ch.includes('pwa') || ch.includes('online');
      if (isPwa) {
        pwaTurnoverFromTx += amt;
      } else {
        posTurnover += amt;
        posReceiptsCount += 1;
      }

      // Compute cost from recorded totalCost or item-level costPrice
      let txCost = Number(t.totalCost ?? t.totalModal ?? 0);
      if (txCost <= 0 && Array.isArray(t.items)) {
        txCost = t.items.reduce((acc: number, it: any) => {
          const prod =
            productById.get(String(it.productId || it.id || '')) ||
            productByName.get(String(it.productName || it.name || '').trim().toLowerCase());
          const unitCost = Number(
            it.costPrice ?? it.cost ?? prod?.costPrice ?? prod?.hargaModal ?? prod?.costPerUnit ?? 0
          );
          const qty = Number(it.quantity ?? it.qty ?? it.quantityOrdered ?? 1);
          return acc + unitCost * qty;
        }, 0);
      }
      totalCost += txCost;
    });

    // Standalone orders not already merged into validTransactions
    let standaloneOrderTurnover = 0;
    let standaloneOrderCost = 0;
    const validOrders = orders.filter((o: any) => {
      const st = String(o.status || o.fulfillmentStatus || '').toLowerCase();
      return st !== 'cancelled' && st !== 'void' && st !== 'batal' && st !== 'rejected';
    });

    validOrders.forEach((o: any) => {
      const oid = String(o.id || '');
      const linkedTxId = String(o.transactionId || o.orderId || '');
      if (!txIds.has(oid) && (!linkedTxId || !txIds.has(linkedTxId))) {
        const amt = Number(o.totalAmount ?? o.total ?? 0);
        standaloneOrderTurnover += amt;
        if (Array.isArray(o.items)) {
          standaloneOrderCost += o.items.reduce((acc: number, it: any) => {
            const prod =
              productById.get(String(it.productId || it.id || '')) ||
              productByName.get(String(it.productName || it.name || '').trim().toLowerCase());
            const unitCost = Number(
              it.costPrice ?? it.cost ?? prod?.costPrice ?? prod?.hargaModal ?? prod?.costPerUnit ?? 0
            );
            const qty = Number(it.quantity ?? it.qty ?? it.quantityOrdered ?? 1);
            return acc + unitCost * qty;
          }, 0);
        }
      }
    });

    const totalTurnover = posTurnover + pwaTurnoverFromTx + standaloneOrderTurnover;
    const totalHpp = totalCost + standaloneOrderCost;
    const grossProfit = Math.max(0, totalTurnover - totalHpp);
    const totalTxAndOrdersCount = validTransactions.length;
    const avgPerTransaction =
      totalTxAndOrdersCount > 0 ? Math.round(totalTurnover / totalTxAndOrdersCount) : 0;

    // Total Inventory Asset Value from real products
    const stockAssetValue = products.reduce((sum: number, p: any) => {
      const units = Number(p.stock ?? p.stockUnits ?? p.stockInUnits ?? 0);
      const unitCost = Number(p.costPrice ?? p.hargaModal ?? p.costPerUnit ?? 0);
      const unitSell = Number(p.posPrice ?? p.pricePerUnit ?? p.price ?? 0);
      return sum + units * (unitCost > 0 ? unitCost : unitSell);
    }, 0);

    // Chart 1: Hourly Sales Trends (00:00 - 23:00 grouped into 2-hour operational slots or active hours)
    const hourSlots = ['00:00', '04:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];
    const hourlyBuckets = new Map<string, { jam: string; sales: number; target: number; count: number }>();
    hourSlots.forEach((h) => hourlyBuckets.set(h, { jam: h, sales: 0, target: 0, count: 0 }));

    validTransactions.forEach((t: any) => {
      const rawDate = t.createdAt || t.timestamp || t.orderDate || t.date;
      const d = rawDate ? new Date(rawDate) : new Date();
      const hr = Number.isNaN(d.getTime()) ? 12 : d.getHours();
      let slot = '22:00';
      if (hr < 4) slot = '00:00';
      else if (hr < 8) slot = '04:00';
      else if (hr < 10) slot = '08:00';
      else if (hr < 12) slot = '10:00';
      else if (hr < 14) slot = '12:00';
      else if (hr < 16) slot = '14:00';
      else if (hr < 18) slot = '16:00';
      else if (hr < 20) slot = '18:00';
      else if (hr < 22) slot = '20:00';
      const entry = hourlyBuckets.get(slot)!;
      const amt = Number(t.totalAmount ?? t.total ?? 0);
      entry.sales += amt;
      entry.target = Math.round(entry.sales * 1.1);
      entry.count += 1;
    });

    const hourlyLineData = Array.from(hourlyBuckets.values());

    // Chart 2: Sales / Stock Category Distribution from real products & transactions
    const palette = ['#007bff', '#0d9488', '#7c3aed', '#f59e0b', '#ec4899'];
    const categoryTotals = new Map<string, number>();

    validTransactions.forEach((t: any) => {
      if (Array.isArray(t.items) && t.items.length > 0) {
        t.items.forEach((it: any) => {
          const prod =
            productById.get(String(it.productId || it.id || '')) ||
            productByName.get(String(it.productName || it.name || '').trim().toLowerCase());
          const cat = String(it.category || prod?.category || 'Umum').trim() || 'Umum';
          const lineTotal =
            Number(it.subtotal ?? it.total ?? 0) ||
            Number(it.price ?? it.unitPrice ?? prod?.posPrice ?? 0) *
              Number(it.quantity ?? it.qty ?? it.quantityOrdered ?? 1);
          categoryTotals.set(cat, (categoryTotals.get(cat) || 0) + lineTotal);
        });
      } else {
        const amt = Number(t.totalAmount ?? t.total ?? 0);
        if (amt > 0) {
          const defaultCat = products[0]?.category || 'Penjualan Toko';
          categoryTotals.set(defaultCat, (categoryTotals.get(defaultCat) || 0) + amt);
        }
      }
    });

    // If no sales yet, compute distribution from real product stock value per category
    if (categoryTotals.size === 0 && products.length > 0) {
      products.forEach((p: any) => {
        const cat = String(p.category || 'Umum').trim() || 'Umum';
        const units = Number(p.stock ?? p.stockUnits ?? p.stockInUnits ?? 0);
        const price = Number(p.posPrice ?? p.pricePerUnit ?? p.costPrice ?? 0);
        categoryTotals.set(cat, (categoryTotals.get(cat) || 0) + Math.max(price, units * price));
      });
    }

    const totalCatSum = Array.from(categoryTotals.values()).reduce((a, b) => a + b, 0);
    const categoryDonutData =
      categoryTotals.size > 0
        ? Array.from(categoryTotals.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, nominal], idx) => ({
              name,
              nominal,
              value: totalCatSum > 0 ? Math.max(1, Math.round((nominal / totalCatSum) * 100)) : 0,
              color: palette[idx % palette.length],
            }))
        : [{ name: 'Belum Ada Data', nominal: 0, value: 100, color: '#27272a' }];

    // Chart 3: Revenue by Real Channel & Payment Method (POS Kasir, Client PWA, Cash/Tunai, QRIS, Transfer/DOKU)
    let channelPosCash = 0;
    let channelPosQris = 0;
    let channelPosTransfer = 0;
    let channelPwaOnline = pwaTurnoverFromTx + standaloneOrderTurnover;
    let channelWholesale = 0;

    validTransactions.forEach((t: any) => {
      const amt = Number(t.totalAmount ?? t.total ?? 0);
      const ch = String(t.channel || t.source || '').toLowerCase();
      const pm = String(t.paymentMethod || t.paymentMethodLabel || 'cash').toLowerCase();
      const isPwa = ch.includes('pwa') || ch.includes('online');
      const hasCarton =
        Array.isArray(t.items) &&
        t.items.some((i: any) =>
          String(i.unit || i.packageType || '').toLowerCase().match(/karton|dus|carton|box/)
        );

      if (hasCarton) {
        channelWholesale += amt;
      } else if (!isPwa) {
        if (pm.includes('qris')) channelPosQris += amt;
        else if (pm.includes('transfer') || pm.includes('doku') || pm.includes('bank'))
          channelPosTransfer += amt;
        else channelPosCash += amt;
      }
    });

    const channelBarData = [
      { name: 'POS Kasir (Tunai)', source: 'POS Kasir (Tunai)', value: channelPosCash, nominal: channelPosCash, fill: '#0066ff' },
      { name: 'Client PWA Online', source: 'Client PWA Online', value: channelPwaOnline, nominal: channelPwaOnline, fill: '#38bdf8' },
      { name: 'POS QRIS Digital', source: 'POS QRIS Digital', value: channelPosQris, nominal: channelPosQris, fill: '#f59e0b' },
      { name: 'Transfer / DOKU', source: 'Transfer / DOKU', value: channelPosTransfer, nominal: channelPosTransfer, fill: '#f97316' },
      { name: 'Grosir / B2B', source: 'Grosir / B2B', value: channelWholesale, nominal: channelWholesale, fill: '#fde68a' },
    ];

    // Chart 4: Time Slot Heatmap (Days Mon-Sun x 5 Time Slots from real transactions & orders)
    const days = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    const timeSlots = ['08-11', '11-14', '14-17', '17-20', '20-23'];
    const heatmapMatrix: number[][] = Array.from({ length: 7 }, () => [0, 0, 0, 0, 0]);

    validTransactions.forEach((t: any) => {
      const rawDate = t.createdAt || t.timestamp || t.orderDate || t.date;
      const d = rawDate ? new Date(rawDate) : null;
      if (!d || Number.isNaN(d.getTime())) return;
      // JS getDay(): 0 = Sun, 1 = Mon ... 6 = Sat -> convert to 0 = Sen ... 6 = Min
      const dayIdx = (d.getDay() + 6) % 7;
      const hr = d.getHours();
      let slotIdx = 0;
      if (hr < 11) slotIdx = 0;
      else if (hr < 14) slotIdx = 1;
      else if (hr < 17) slotIdx = 2;
      else if (hr < 20) slotIdx = 3;
      else slotIdx = 4;
      heatmapMatrix[dayIdx][slotIdx] = Math.min(5, heatmapMatrix[dayIdx][slotIdx] + 1);
    });

    // Chart 5: Top 5 Products from REAL `products` and `transactions`/`orders`
    const productSalesMap = new Map<
      string,
      { id: string; name: string; qty: number; revenue: number; stock: number; category: string }
    >();

    // Seed with real Firestore products first so real catalog items always appear
    products.forEach((p: any) => {
      const pid = String(p.id || p.name);
      productSalesMap.set(pid, {
        id: pid,
        name: String(p.name || 'Produk Tanpa Nama'),
        qty: 0,
        revenue: 0,
        stock: Number(p.stock ?? p.stockUnits ?? p.stockInUnits ?? 0),
        category: String(p.category || 'Umum'),
      });
    });

    validTransactions.forEach((t: any) => {
      if (Array.isArray(t.items)) {
        t.items.forEach((it: any) => {
          const prod =
            productById.get(String(it.productId || it.id || '')) ||
            productByName.get(String(it.productName || it.name || '').trim().toLowerCase());
          const key = String(prod?.id || it.productId || it.productName || it.name || 'item');
          const name = String(prod?.name || it.productName || it.name || 'Produk Transaksi');
          const qty = Number(it.quantity ?? it.qty ?? it.quantityOrdered ?? 1);
          const rev =
            Number(it.subtotal ?? it.total ?? 0) ||
            Number(it.price ?? it.unitPrice ?? prod?.posPrice ?? 0) * qty;
          const existing = productSalesMap.get(key) || {
            id: key,
            name,
            qty: 0,
            revenue: 0,
            stock: Number(prod?.stock ?? prod?.stockUnits ?? 0),
            category: String(prod?.category || it.category || 'Umum'),
          };
          existing.qty += qty;
          existing.revenue += rev;
          productSalesMap.set(key, existing);
        });
      }
    });

    const sortedProducts = Array.from(productSalesMap.values()).sort((a, b) => {
      if (b.qty !== a.qty) return b.qty - a.qty;
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      return b.stock - a.stock;
    });

    const totalSoldUnits = sortedProducts.reduce((s, p) => s + p.qty, 0);
    const totalCatalogStock = sortedProducts.reduce((s, p) => s + p.stock, 0);
    const barColors = ['bg-blue-500', 'bg-teal-500', 'bg-purple-500', 'bg-amber-500', 'bg-pink-500'];

    const top5Products = sortedProducts.slice(0, 5).map((p, idx) => {
      const share =
        totalSoldUnits > 0
          ? Math.round((p.qty / totalSoldUnits) * 100)
          : totalCatalogStock > 0
          ? Math.round((p.stock / totalCatalogStock) * 100)
          : 0;
      return {
        ...p,
        share: Math.min(100, Math.max(0, share)),
        color: barColors[idx % barColors.length],
        hexColor: palette[idx % palette.length],
      };
    });

    // Chart 6: POS vs PWA Channel Split
    const posTotalCount = posReceiptsCount;
    const pwaTotalCount = orders.length;
    const combinedChannelCount = posTotalCount + pwaTotalCount;
    const posSharePct =
      combinedChannelCount > 0 ? Math.round((posTotalCount / combinedChannelCount) * 100) : 0;
    const pwaSharePct = combinedChannelCount > 0 ? 100 - posSharePct : 0;

    // Daily aggregation for 7-day charts (Senin - Minggu)
    const dayLabels = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
    const dailyTotals = [0, 0, 0, 0, 0, 0, 0];
    validTransactions.forEach((t: any) => {
      const rawDate = t.createdAt || t.timestamp || t.orderDate || t.date;
      const d = rawDate ? new Date(rawDate) : null;
      if (!d || Number.isNaN(d.getTime())) return;
      const dayIdx = (d.getDay() + 6) % 7;
      dailyTotals[dayIdx] += Number(t.totalAmount ?? t.total ?? 0);
    });

    const dailyComparisonData = dayLabels.map((label, idx) => ({
      label,
      day: label.slice(0, 3),
      actual: dailyTotals[idx],
      revenue: dailyTotals[idx],
      target: dailyTotals[idx] > 0 ? Math.round(dailyTotals[idx] * 1.15) : 0,
    }));

    return {
      products,
      transactions: validTransactions,
      orders: validOrders,
      customers,
      procurements,
      shifts,
      brangkas_toko_logs,
      totalTurnover,
      totalHpp,
      grossProfit,
      avgPerTransaction,
      stockAssetValue,
      posReceiptsCount,
      pwaOrdersCount: orders.length,
      customersCount: customers.length,
      hourlyLineData,
      categoryDonutData,
      totalCatSum,
      channelBarData,
      days,
      timeSlots,
      heatmapMatrix,
      top5Products,
      posSharePct,
      pwaSharePct,
      dailyComparisonData,
      formatMoney,
      formatCompactMoney,
    };
  }, [
    products,
    transactions,
    orders,
    customers,
    procurements,
    shifts,
    brangkas_toko_logs,
    formatMoney,
    formatCompactMoney,
  ]);
}

// ============================================================================
// 1. #RiskGauge: Semi-circle Speedometer (180 deg) with Needle & Score
// ============================================================================
export interface RiskGaugeProps {
  score?: number; // 0 - 100
  title?: string;
  subtitle?: string;
  statusLabel?: string;
  statusLevel?: 'low' | 'medium' | 'high';
  showDetails?: boolean;
}

export const RiskGaugeChart: React.FC<RiskGaugeProps> = ({
  score: customScore,
  title = 'Skor Risiko & Integritas Transaksi (#RiskGauge)',
  subtitle = 'Analisis Forensik Anomali Transaksi POS, Void & Selisih Kas (Real-time Firestore)',
  statusLabel,
  statusLevel,
  showDetails = true,
}) => {
  const { transactions } = useAppData();

  const calculatedScore = useMemo(() => {
    if (typeof customScore === 'number') return Math.min(100, Math.max(0, customScore));
    if (!transactions || transactions.length === 0) return 0;

    let suspiciousCount = 0;
    transactions.forEach((tx: any) => {
      const isVoid = tx.status === 'void' || tx.status === 'cancelled';
      const isShort = Number(tx.fraudScore || 0) > 40;
      if (isVoid || isShort) suspiciousCount++;
    });

    if (suspiciousCount === 0) return 5;
    const ratio = (suspiciousCount / transactions.length) * 100;
    return Math.min(100, Math.round(ratio * 1.8 + 10));
  }, [customScore, transactions]);

  const resolvedLevel =
    statusLevel || (calculatedScore < 30 ? 'low' : calculatedScore < 70 ? 'medium' : 'high');
  const resolvedLabel =
    statusLabel ||
    (transactions.length === 0
      ? 'Belum Ada Transaksi • Risiko 0%'
      : resolvedLevel === 'low'
      ? 'Aman • Risiko Rendah'
      : resolvedLevel === 'medium'
      ? 'Perhatian • Risiko Menengah'
      : 'Waspada • Risiko Tinggi / Anomali Terdeteksi');

  const angle = -90 + (calculatedScore / 100) * 180;
  const needleRad = ((angle - 90) * Math.PI) / 180;
  const cx = 150;
  const cy = 135;
  const r = 90;
  const needleLength = 76;
  const nx = cx + needleLength * Math.cos(needleRad);
  const ny = cy + needleLength * Math.sin(needleRad);

  return (
    <div className="rounded-2xl bg-[#080705] border border-amber-500/35 p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.85)] relative overflow-hidden space-y-4">
      <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-500/20 pb-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
            <h3 className="text-sm font-bold text-white tracking-wide">{title}</h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              #RiskGauge
            </span>
          </div>
          <p className="text-[11px] text-zinc-400">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-bold font-mono border ${
              resolvedLevel === 'low'
                ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40'
                : resolvedLevel === 'medium'
                ? 'bg-amber-950/80 text-amber-400 border-amber-500/40'
                : 'bg-rose-950/80 text-rose-400 border-rose-500/40 animate-pulse'
            }`}
          >
            {resolvedLabel}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center pt-2">
        <div className="relative w-[300px] h-[160px] flex items-center justify-center">
          <svg viewBox="0 0 300 170" className="w-full h-full overflow-visible">
            <defs>
              <linearGradient id="riskGaugeGrad" x1="0%" y1="100%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="35%" stopColor="#eab308" />
                <stop offset="70%" stopColor="#f97316" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
              <filter id="needleGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#ffffff" floodOpacity="0.7" />
              </filter>
            </defs>

            <path
              d="M 40 135 A 110 110 0 0 1 260 135"
              fill="none"
              stroke="#1f1d18"
              strokeWidth="24"
              strokeLinecap="round"
            />

            <path
              d="M 40 135 A 110 110 0 0 1 260 135"
              fill="none"
              stroke="url(#riskGaugeGrad)"
              strokeWidth="22"
              strokeLinecap="round"
              strokeDasharray="346"
              strokeDashoffset="0"
            />

            <circle cx={cx} cy={cy} r={r - 12} fill="none" stroke="#2a241b" strokeWidth="1" strokeDasharray="3 5" />

            <text x="32" y="156" fill="#10b981" fontSize="11" fontWeight="bold" textAnchor="start">
              Low
            </text>
            <text x="150" y="24" fill="#eab308" fontSize="11" fontWeight="bold" textAnchor="middle">
              Medium
            </text>
            <text x="268" y="156" fill="#ef4444" fontSize="11" fontWeight="bold" textAnchor="end">
              High
            </text>

            <line
              x1={cx}
              y1={cy}
              x2={nx}
              y2={ny}
              stroke="#ffffff"
              strokeWidth="3.5"
              strokeLinecap="round"
              filter="url(#needleGlow)"
            />

            <circle cx={cx} cy={cy} r="10" fill="#f97316" stroke="#ffffff" strokeWidth="2.5" />
            <circle cx={cx} cy={cy} r="4" fill="#080705" />
          </svg>
        </div>

        <div className="text-center -mt-2">
          <div className="text-4xl sm:text-5xl font-black font-mono text-[#f97316] tracking-tight drop-shadow-[0_2px_12px_rgba(249,115,22,0.4)]">
            {calculatedScore}
            <span className="text-2xl text-zinc-500 font-sans font-bold">/100</span>
          </div>
          <div className="text-xs font-bold text-zinc-300 mt-1 uppercase tracking-wider">
            {resolvedLabel}
          </div>
        </div>
      </div>

      {showDetails && (
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-amber-500/20 text-center text-xs">
          <div className="p-2.5 rounded-xl bg-[#12100b] border border-amber-500/20">
            <span className="block text-[10px] text-zinc-400">Tingkat Fraud</span>
            <strong className="text-emerald-400 font-mono text-sm">
              {transactions.length === 0 ? '0%' : `${calculatedScore}%`}
            </strong>
          </div>
          <div className="p-2.5 rounded-xl bg-[#12100b] border border-amber-500/20">
            <span className="block text-[10px] text-zinc-400">Total Audit</span>
            <strong className="text-amber-300 font-mono text-sm">{transactions.length} Struk</strong>
          </div>
          <div className="p-2.5 rounded-xl bg-[#12100b] border border-amber-500/20">
            <span className="block text-[10px] text-zinc-400">Status Sumber</span>
            <strong className="text-blue-400 font-mono text-sm">Live Firestore</strong>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 2. #SalesGridDashboard: Full Layout with 6 Real-Time KPI Cards & 6 Live Charts
// ============================================================================
export const SalesGridDashboardChart: React.FC = () => {
  const analytics = useRealTimeCanvasAnalytics();

  return (
    <div className="rounded-2xl bg-[#080705] border border-amber-500/35 p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.85)] space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-500/20 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <h3 className="text-base font-black text-white tracking-wide">
              Executive Sales Grid Dashboard (#SalesGridDashboard)
            </h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              #FullDashboard
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Data Real-Time Firestore ({analytics.products.length} Produk, {analytics.posReceiptsCount} Struk POS, {analytics.pwaOrdersCount} Order PWA, {analytics.customersCount} Pelanggan)
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-amber-400">
          <Calendar className="w-3.5 h-3.5" />
          <span>Hari Ini: {new Date().toLocaleDateString('id-ID', { dateStyle: 'medium' })}</span>
        </div>
      </div>

      {/* Row 1: 6 Real-Time KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          {
            label: 'Total Omzet (Turnover)',
            val: analytics.formatMoney(analytics.totalTurnover),
            sub: `Rata-rata: ${analytics.formatMoney(analytics.avgPerTransaction)}`,
            icon: DollarSign,
            color: 'text-amber-400',
            bg: 'bg-amber-500/10',
          },
          {
            label: 'Total Profit / Laba',
            val: analytics.formatMoney(analytics.grossProfit),
            sub: `HPP: ${analytics.formatMoney(analytics.totalHpp)}`,
            icon: TrendingUp,
            color: 'text-emerald-400',
            bg: 'bg-emerald-500/10',
          },
          {
            label: 'Aset Inventori',
            val: analytics.formatMoney(analytics.stockAssetValue),
            sub: `${analytics.products.length} SKU Aktif`,
            icon: Package,
            color: 'text-blue-400',
            bg: 'bg-blue-500/10',
          },
          {
            label: 'Total Receipts (POS)',
            val: `${analytics.posReceiptsCount} Struk`,
            sub: 'Kasir POS Real-Time',
            icon: ShoppingBag,
            color: 'text-purple-400',
            bg: 'bg-purple-500/10',
          },
          {
            label: 'Total Orders PWA',
            val: `${analytics.pwaOrdersCount} Order`,
            sub: 'Client PWA Real-Time',
            icon: Layers,
            color: 'text-sky-400',
            bg: 'bg-sky-500/10',
          },
          {
            label: 'Total Pelanggan',
            val: `${analytics.customersCount} Orang`,
            sub: 'Database CRM Aktif',
            icon: Users,
            color: 'text-pink-400',
            bg: 'bg-pink-500/10',
          },
        ].map((card, i) => {
          const Icon = card.icon;
          return (
            <div key={i} className="rounded-xl bg-[#12100b] border border-amber-500/25 p-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <div className={`w-8 h-8 rounded-lg ${card.bg} ${card.color} flex items-center justify-center`}>
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-[10px] font-mono font-bold text-emerald-400 flex items-center gap-0.5">
                  <ArrowUpRight className="w-3 h-3" /> Live
                </span>
              </div>
              <div className="mt-2.5">
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider block">{card.label}</span>
                <span className="text-sm font-black font-mono text-white tracking-tight mt-0.5 block truncate">
                  {card.val}
                </span>
                <span className="text-[10px] font-mono text-zinc-500 block truncate mt-0.5">{card.sub}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Row 2: Chart 1 (Hourly Sales Trends), Chart 2 (Category Distribution), Chart 3 (Revenue by Channel Source) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart 1: Sales Trends Operating Hours */}
        <div className="rounded-xl bg-[#12100b] border border-amber-500/25 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white">Trend Penjualan Jam Operasional</span>
            <span className="text-[10px] text-emerald-400 font-mono">00:00 - 23:00</span>
          </div>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.hourlyLineData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#221e17" />
                <XAxis dataKey="jam" stroke="#71717a" fontSize={10} />
                <YAxis
                  stroke="#71717a"
                  fontSize={10}
                  tickFormatter={(v) =>
                    v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#080705', borderColor: '#d97706', fontSize: '11px', color: '#fff' }}
                  formatter={(v: any) => [formatRupiah(Number(v)), 'Nominal']}
                />
                <Line type="monotone" dataKey="sales" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4, fill: '#eab308' }} name="Aktual" />
                <Line type="monotone" dataKey="target" stroke="#f97316" strokeDasharray="5 5" strokeWidth={1.5} dot={false} name="Target" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Sales Category Distribution */}
        <div className="rounded-xl bg-[#12100b] border border-amber-500/25 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white">Distribusi Kategori Penjualan</span>
            <span className="text-[10px] text-amber-300 font-mono">
              {analytics.totalTurnover > 0 ? 'Penjualan Aktual' : 'Nilai Stok Kategori'}
            </span>
          </div>
          <div className="h-48 w-full relative flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={analytics.categoryDonutData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={4}
                >
                  {analytics.categoryDonutData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#080705', borderColor: '#d97706', fontSize: '11px', color: '#fff' }}
                  formatter={(v: any, _n: any, props: any) => [
                    `${v}% (${formatRupiah(Number(props?.payload?.nominal || 0))})`,
                    props?.payload?.name || 'Kategori',
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center Total Overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[10px] text-zinc-400 font-bold uppercase">
                {analytics.totalTurnover > 0 ? 'Total Omset' : 'Nilai Stok'}
              </span>
              <span className="text-xs font-black font-mono text-white">
                {analytics.formatCompactMoney(
                  analytics.totalTurnover > 0 ? analytics.totalTurnover : analytics.stockAssetValue
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Chart 3: Revenue by Channel Source */}
        <div className="rounded-xl bg-[#12100b] border border-amber-500/25 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white">Omset Berdasarkan Sumber Channel</span>
            <span className="text-[10px] text-blue-400 font-mono">POS &amp; PWA</span>
          </div>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={analytics.channelBarData} margin={{ top: 5, right: 65, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#221e17" horizontal={false} />
                <XAxis
                  type="number"
                  stroke="#71717a"
                  fontSize={10}
                  tickFormatter={(v) =>
                    v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                />
                <YAxis dataKey="name" type="category" stroke="#a1a1aa" fontSize={9.5} width={100} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#080705', borderColor: '#d97706', fontSize: '11px', color: '#fff' }}
                  formatter={(v: any) => [formatRupiah(Number(v)), 'Omset']}
                />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {analytics.channelBarData.map((entry, index) => (
                    <Cell key={`bar-${index}`} fill={entry.fill} />
                  ))}
                  <LabelList
                    dataKey="value"
                    position="right"
                    formatter={(v: any) => analytics.formatCompactMoney(Number(v))}
                    fill="#ffffff"
                    fontSize={10}
                    fontWeight="bold"
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Row 3: Chart 4 (Time Slot Heatmap), Chart 5 (Top 5 Real Products), Chart 6 (POS vs PWA Split) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart 4: Time Slot Heatmap Grid */}
        <div className="rounded-xl bg-[#12100b] border border-amber-500/25 p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" /> Time Slot Heatmap Transaksi
            </span>
            <span className="text-[10px] text-zinc-400">{analytics.transactions.length} Transaksi</span>
          </div>
          <div className="space-y-1 pt-1">
            <div className="grid grid-cols-6 gap-1 text-[10px] text-zinc-500 font-mono text-center">
              <span>Hari</span>
              {analytics.timeSlots.map((ts) => (
                <span key={ts}>{ts}</span>
              ))}
            </div>
            {analytics.days.map((day, dIdx) => (
              <div key={day} className="grid grid-cols-6 gap-1 items-center text-center">
                <span className="text-[10px] text-zinc-400 font-mono">{day}</span>
                {analytics.timeSlots.map((_, sIdx) => {
                  const val = analytics.heatmapMatrix[dIdx][sIdx];
                  const bg =
                    val >= 5
                      ? 'bg-amber-400'
                      : val === 4
                      ? 'bg-amber-500/80'
                      : val === 3
                      ? 'bg-amber-600/50'
                      : val === 2
                      ? 'bg-amber-700/40'
                      : val === 1
                      ? 'bg-amber-800/35'
                      : 'bg-zinc-900';
                  return (
                    <div
                      key={sIdx}
                      title={`${day} (${analytics.timeSlots[sIdx]}): ${val} transaksi`}
                      className={`h-5 rounded-md ${bg} transition hover:scale-105 cursor-pointer flex items-center justify-center text-[9px] font-mono text-white/80`}
                    >
                      {val > 0 ? val : ''}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1 border-t border-zinc-800">
            <span>0 Tx</span>
            <div className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-zinc-900" />
              <span className="w-2.5 h-2.5 rounded bg-amber-800/35" />
              <span className="w-2.5 h-2.5 rounded bg-amber-600/50" />
              <span className="w-2.5 h-2.5 rounded bg-amber-500/80" />
              <span className="w-2.5 h-2.5 rounded bg-amber-400" />
            </div>
            <span className="text-amber-400 font-bold">Padat Puncak</span>
          </div>
        </div>

        {/* Chart 5: Top 5 Best-Selling Products (100% Real Firestore Products) */}
        <div className="rounded-xl bg-[#12100b] border border-amber-500/25 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-amber-400" /> Top 5 Produk Terlaris
            </span>
            <span className="text-[10px] text-emerald-400 font-mono">
              {analytics.products.length} SKU di Database
            </span>
          </div>
          {analytics.top5Products.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center text-center text-xs text-zinc-500">
              <span>Belum ada produk di katalog Firestore.</span>
            </div>
          ) : (
            <div className="space-y-2.5 pt-1 text-xs">
              {analytics.top5Products.map((prod, idx) => (
                <div key={prod.id} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] gap-2">
                    <span className="font-medium text-white truncate">
                      {idx + 1}. {prod.name}
                    </span>
                    <span className="text-zinc-400 font-mono shrink-0">
                      {prod.qty} terjual • Stok: {prod.stock} ({prod.share}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-zinc-900 overflow-hidden">
                    <div
                      className={`h-full ${prod.color} rounded-full`}
                      style={{ width: `${Math.max(4, prod.share)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chart 6: POS vs PWA Channel Split */}
        <div className="rounded-xl bg-[#12100b] border border-amber-500/25 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white">Channel POS vs PWA</span>
            <span className="text-[10px] text-purple-400 font-mono">
              {analytics.posReceiptsCount} POS vs {analytics.pwaOrdersCount} PWA
            </span>
          </div>
          <div className="h-44 w-full relative flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={
                    analytics.posReceiptsCount + analytics.pwaOrdersCount > 0
                      ? [
                          { name: 'POS Kasir Fisik', value: analytics.posSharePct, color: '#0ea5e9' },
                          { name: 'PWA Online Web App', value: analytics.pwaSharePct, color: '#f59e0b' },
                        ]
                      : [
                          { name: 'POS Kasir Fisik', value: 50, color: '#1e293b' },
                          { name: 'PWA Online Web App', value: 50, color: '#27272a' },
                        ]
                  }
                  dataKey="value"
                  innerRadius={45}
                  outerRadius={68}
                  paddingAngle={5}
                >
                  <Cell fill="#0ea5e9" />
                  <Cell fill="#f59e0b" />
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#080705', borderColor: '#d97706', fontSize: '11px', color: '#fff' }}
                  formatter={(v: any) => [`${v}%`, 'Porsi']}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[9px] text-zinc-400 uppercase font-bold">Rasio</span>
              <span className="text-xs font-black font-mono text-white">
                {analytics.posSharePct}% : {analytics.pwaSharePct}%
              </span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-4 text-[11px] font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0ea5e9]" />
              <span className="text-zinc-300">
                POS: {analytics.posSharePct}% ({analytics.posReceiptsCount})
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" />
              <span className="text-zinc-300">
                PWA: {analytics.pwaSharePct}% ({analytics.pwaOrdersCount})
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 3. #TargetLineChart: Solid Bright Blue (#0ea5e9) vs Dashed Orange (#f97316)
// ============================================================================
export interface TargetLineChartProps {
  title?: string;
  data?: Array<{ label: string; actual: number; target: number }>;
}

export const TargetLineChart: React.FC<TargetLineChartProps> = ({
  title = 'Perbandingan Target vs Aktual (#TargetLineChart)',
  data: customData,
}) => {
  const analytics = useRealTimeCanvasAnalytics();
  const chartData = customData || analytics.dailyComparisonData;

  return (
    <div className="rounded-2xl bg-[#080705] border border-amber-500/35 p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.85)] space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-500/20 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#0ea5e9]" />
            <h3 className="text-sm font-bold text-white tracking-wide">{title}</h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              #TargetLineChart
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Realisasi Penjualan Aktual Firestore vs Target Harian
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-1 bg-[#0ea5e9] rounded" />
            <span className="text-zinc-200">Aktual ({analytics.formatMoney(analytics.totalTurnover)})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 border-t-2 border-dashed border-[#f97316]" />
            <span className="text-[#f97316]">Target</span>
          </div>
        </div>
      </div>

      <div className="h-64 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 15, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#221e17" />
            <XAxis dataKey="label" stroke="#71717a" fontSize={11} />
            <YAxis
              stroke="#71717a"
              fontSize={11}
              tickFormatter={(v) =>
                v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
              }
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#080705', borderColor: '#d97706', fontSize: '11px', color: '#fff', borderRadius: '0.75rem' }}
              formatter={(val: any, name: any) => [formatRupiah(Number(val)), name === 'actual' ? 'Aktual' : 'Target']}
            />
            <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px', color: '#a1a1aa' }} />
            <Line
              type="monotone"
              dataKey="actual"
              name="Aktual Real-Time"
              stroke="#0ea5e9"
              strokeWidth={3}
              dot={{ r: 5, fill: '#0ea5e9', stroke: '#ffffff', strokeWidth: 1.5 }}
              activeDot={{ r: 7, fill: '#0ea5e9', stroke: '#ffffff', strokeWidth: 2 }}
            />
            <Line
              type="monotone"
              dataKey="target"
              name="Target Rencana"
              stroke="#f97316"
              strokeDasharray="6 6"
              strokeWidth={2.5}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// ============================================================================
// 4. #SourceBar: Horizontal Bar with 5 Real Channels & Bold Values on Right
// ============================================================================
export const SourceBarChart: React.FC<{ title?: string }> = ({
  title = 'Distribusi Sumber Pendapatan (#SourceBar)',
}) => {
  const analytics = useRealTimeCanvasAnalytics();

  return (
    <div className="rounded-2xl bg-[#080705] border border-amber-500/35 p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.85)] space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-500/20 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#0066ff]" />
            <h3 className="text-sm font-bold text-white tracking-wide">{title}</h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              #SourceBar
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Omzet Aktual Berdasarkan Channel POS Kasir, Client PWA, QRIS, Transfer/DOKU &amp; Grosir
          </p>
        </div>
      </div>

      <div className="h-64 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={analytics.channelBarData} margin={{ top: 10, right: 90, left: 25, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#221e17" horizontal={false} />
            <XAxis
              type="number"
              stroke="#71717a"
              fontSize={10}
              tickFormatter={(v) =>
                v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
              }
            />
            <YAxis dataKey="source" type="category" stroke="#d4d4d8" fontSize={11} width={135} />
            <Tooltip
              contentStyle={{ backgroundColor: '#080705', borderColor: '#d97706', fontSize: '11px', color: '#fff', borderRadius: '0.75rem' }}
              formatter={(v: any) => [formatRupiah(Number(v)), 'Nominal']}
            />
            <Bar dataKey="nominal" radius={[0, 6, 6, 0]}>
              {analytics.channelBarData.map((entry, index) => (
                <Cell key={`source-bar-${index}`} fill={entry.fill} />
              ))}
              <LabelList
                dataKey="nominal"
                position="right"
                formatter={(v: any) => formatRupiah(Number(v))}
                fill="#ffffff"
                fontSize={11}
                fontWeight="bold"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// ============================================================================
// 5. #ExecutiveOverview: 6 Real-Time KPI Cards + Sparkline + Grid
// ============================================================================
export const ExecutiveOverviewChart: React.FC = () => {
  const analytics = useRealTimeCanvasAnalytics();
  const sparklineData = analytics.dailyComparisonData.map((d) => ({ v: d.actual }));
  const marginPct =
    analytics.totalTurnover > 0
      ? ((analytics.grossProfit / analytics.totalTurnover) * 100).toFixed(1)
      : '0.0';

  return (
    <div className="rounded-2xl bg-[#080705] border border-amber-500/35 p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.85)] space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-500/20 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <h3 className="text-base font-black text-white tracking-wide">
              Executive Overview &amp; Sparkline KPI (#ExecutiveOverview)
            </h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              #SparklineKPI
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Ringkasan Eksekutif Real-Time dari Koleksi Firestore
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          {
            label: 'Total Omzet',
            val: analytics.formatCompactMoney(analytics.totalTurnover),
            change: `${analytics.posReceiptsCount + analytics.pwaOrdersCount} Tx`,
            color: '#3b82f6',
            bg: 'bg-blue-500/15',
            stroke: '#3b82f6',
          },
          {
            label: 'Margin Laba',
            val: `${marginPct}%`,
            change: analytics.formatCompactMoney(analytics.grossProfit),
            color: '#f97316',
            bg: 'bg-orange-500/15',
            stroke: '#f97316',
          },
          {
            label: 'Rata-rata / Tx',
            val: analytics.formatCompactMoney(analytics.avgPerTransaction),
            change: 'Real-Time',
            color: '#10b981',
            bg: 'bg-emerald-500/15',
            stroke: '#10b981',
          },
          {
            label: 'Aset Gudang',
            val: analytics.formatCompactMoney(analytics.stockAssetValue),
            change: `${analytics.products.length} Produk`,
            color: '#8b5cf6',
            bg: 'bg-purple-500/15',
            stroke: '#8b5cf6',
          },
          {
            label: 'Orders PWA',
            val: `${analytics.pwaOrdersCount} Order`,
            change: `${analytics.pwaSharePct}% Share`,
            color: '#ef4444',
            bg: 'bg-rose-500/15',
            stroke: '#ef4444',
          },
          {
            label: 'Total Pelanggan',
            val: `${analytics.customersCount} Org`,
            change: 'CRM Aktif',
            color: '#eab308',
            bg: 'bg-amber-500/15',
            stroke: '#eab308',
          },
        ].map((kpi, idx) => (
          <div key={idx} className="rounded-xl bg-[#12100b] border border-amber-500/25 p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className={`w-7 h-7 rounded-lg ${kpi.bg} flex items-center justify-center font-bold`} style={{ color: kpi.color }}>
                ✦
              </div>
              <span className="text-[10px] font-mono font-bold text-emerald-400">{kpi.change}</span>
            </div>
            <div className="mt-2">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider block">{kpi.label}</span>
              <div className="flex items-end justify-between mt-1">
                <span className="text-sm font-black font-mono text-white">{kpi.val}</span>
                <div className="w-14 h-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sparklineData}>
                      <Line type="monotone" dataKey="v" stroke={kpi.stroke} strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TargetLineChart title="Perbandingan Target Eksekutif vs Realisasi" />
        <SourceBarChart title="Kontribusi Channel Pendapatan" />
      </div>
    </div>
  );
};

// ============================================================================
// 6. #KategoriDonut: Ring Doughnut with Real Center Total & Vertical Legend
// ============================================================================
export const KategoriDonutChart: React.FC<{ title?: string }> = ({
  title = 'Distribusi Kategori Produk (#KategoriDonut)',
}) => {
  const analytics = useRealTimeCanvasAnalytics();
  const centerTotal =
    analytics.totalTurnover > 0 ? analytics.totalTurnover : analytics.stockAssetValue;

  return (
    <div className="rounded-2xl bg-[#080705] border border-amber-500/35 p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.85)] space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-500/20 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#007bff]" />
            <h3 className="text-sm font-bold text-white tracking-wide">{title}</h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              #KategoriDonut
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Distribusi Kategori Real-Time dari Produk &amp; Transaksi Firestore
          </p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-2">
        <div className="relative w-64 h-64 flex items-center justify-center shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={analytics.categoryDonutData}
                dataKey="value"
                nameKey="name"
                innerRadius={68}
                outerRadius={98}
                paddingAngle={4}
              >
                {analytics.categoryDonutData.map((entry, index) => (
                  <Cell key={`kdonut-${index}`} fill={entry.color} stroke="#080705" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#080705', borderColor: '#d97706', fontSize: '11px', color: '#fff', borderRadius: '0.75rem' }}
                formatter={(v: any, _n: any, props: any) => [
                  `${v}% (${formatRupiah(Number(props?.payload?.nominal || 0))})`,
                  'Kontribusi Kategori',
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
            <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">
              {analytics.totalTurnover > 0 ? 'Total Omset' : 'Total Nilai Stok'}
            </span>
            <span className="text-xl font-black font-mono text-white mt-0.5">
              {analytics.formatCompactMoney(centerTotal)}
            </span>
            <span className="text-[10px] text-emerald-400 font-mono">100% Share</span>
          </div>
        </div>

        <div className="flex-1 w-full space-y-2.5">
          {analytics.categoryDonutData.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-3 rounded-xl bg-[#12100b] border border-amber-500/20"
            >
              <div className="flex items-center gap-2.5">
                <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                <span className="text-xs font-bold text-white">{item.name}</span>
              </div>
              <div className="flex items-center gap-3 font-mono text-xs">
                <span className="text-zinc-400">{formatRupiah(item.nominal)}</span>
                <span className="px-2 py-0.5 rounded bg-zinc-900 text-white font-bold">{item.value}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 7. #TopKategori: Top Products/Categories List Card with Thin Progress Bars
// ============================================================================
export const TopKategoriChart: React.FC<{ title?: string }> = ({
  title = 'Peringkat Produk & Kategori Teratas (#TopKategori)',
}) => {
  const analytics = useRealTimeCanvasAnalytics();

  return (
    <div className="rounded-2xl bg-[#080705] border border-amber-500/35 p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.85)] space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-500/20 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <h3 className="text-sm font-bold text-white tracking-wide">{title}</h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              #TopKategori
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Daftar Produk &amp; Kategori Real-Time dari Katalog Firestore ({analytics.products.length} Produk)
          </p>
        </div>
      </div>

      {analytics.top5Products.length === 0 ? (
        <div className="p-6 text-center text-xs text-zinc-500">
          Belum ada produk di database Firestore.
        </div>
      ) : (
        <div className="space-y-3 pt-1">
          {analytics.top5Products.map((item, idx) => (
            <div key={item.id} className="p-3.5 rounded-xl bg-[#12100b] border border-amber-500/20 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-base font-bold border border-white/10"
                    style={{ backgroundColor: `${item.hexColor}20`, color: item.hexColor }}
                  >
                    #{idx + 1}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">{item.name}</div>
                    <div className="text-[10px] text-zinc-400 font-mono">
                      Kategori: {item.category} • Stok: {item.stock} • Terjual: {item.qty}
                    </div>
                  </div>
                </div>
                <div className="text-right font-mono">
                  <div className="text-xs font-black text-white">{formatRupiah(item.revenue)}</div>
                  <div className="text-[10px] font-bold" style={{ color: item.hexColor }}>
                    {item.share}% Share
                  </div>
                </div>
              </div>
              <div className="w-full h-2 rounded-full bg-zinc-900 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(4, item.share)}%`, backgroundColor: item.hexColor }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 8. #GlowAreaChart: Smooth Electric Blue (#0066ff) Area Chart with Neon Dots
// ============================================================================
export const GlowAreaChart: React.FC<{ title?: string }> = ({
  title = 'Pertumbuhan Omset & Arus Kas (#GlowAreaChart)',
}) => {
  const analytics = useRealTimeCanvasAnalytics();

  return (
    <div className="rounded-2xl bg-[#080705] border border-amber-500/35 p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.85)] space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-500/20 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#0066ff] shadow-[0_0_10px_#0066ff]" />
            <h3 className="text-sm font-bold text-white tracking-wide">{title}</h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              #GlowAreaChart
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Grafik Area Penjualan Aktual Harian (Total: {analytics.formatMoney(analytics.totalTurnover)})
          </p>
        </div>
      </div>

      <div className="h-64 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={analytics.dailyComparisonData} margin={{ top: 15, right: 20, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="electricBlueGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0066ff" stopOpacity={0.65} />
                <stop offset="95%" stopColor="#0066ff" stopOpacity={0.0} />
              </linearGradient>
              <filter id="blueNeonGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#0066ff" floodOpacity="0.95" />
              </filter>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#221e17" />
            <XAxis dataKey="day" stroke="#71717a" fontSize={11} />
            <YAxis
              stroke="#71717a"
              fontSize={11}
              tickFormatter={(v) =>
                v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
              }
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#080705', borderColor: '#0066ff', fontSize: '11px', color: '#fff', borderRadius: '0.75rem' }}
              formatter={(v: any) => [formatRupiah(Number(v)), 'Revenue']}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#0066ff"
              strokeWidth={3.5}
              fillOpacity={1}
              fill="url(#electricBlueGrad)"
              filter="url(#blueNeonGlow)"
              dot={{ r: 5, fill: '#ffffff', stroke: '#0066ff', strokeWidth: 2.5 }}
              activeDot={{ r: 7, fill: '#ffffff', stroke: '#0066ff', strokeWidth: 3 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// ============================================================================
// 9. #MultiColorBar: Vertical Bar Chart of Real Products in Firestore
// ============================================================================
export const MultiColorBarChart: React.FC<{ title?: string }> = ({
  title = 'Perbandingan Nilai & Stok Produk Utama (#MultiColorBar)',
}) => {
  const analytics = useRealTimeCanvasAnalytics();

  const data = useMemo(() => {
    const colors = ['#007bff', '#0d9488', '#7c3aed', '#f59e0b', '#ec4899'];
    if (analytics.top5Products.length === 0) {
      return [{ name: 'Belum Ada Produk', val: 0, fill: '#27272a' }];
    }
    return analytics.top5Products.map((p, idx) => ({
      name: p.name.length > 18 ? p.name.slice(0, 18) + '…' : p.name,
      val: p.revenue > 0 ? p.revenue : p.stock,
      fill: colors[idx % colors.length],
    }));
  }, [analytics.top5Products]);

  return (
    <div className="rounded-2xl bg-[#080705] border border-amber-500/35 p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.85)] space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-500/20 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#7c3aed]" />
            <h3 className="text-sm font-bold text-white tracking-wide">{title}</h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              #MultiColorBar
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Grafik Batang Vertikal Produk Aktual di Database Firestore
          </p>
        </div>
      </div>

      <div className="h-64 w-full pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 24, right: 15, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#221e17" vertical={false} />
            <XAxis dataKey="name" stroke="#d4d4d8" fontSize={11} />
            <YAxis
              stroke="#71717a"
              fontSize={10}
              tickFormatter={(v) =>
                v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
              }
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#080705', borderColor: '#d97706', fontSize: '11px', color: '#fff', borderRadius: '0.75rem' }}
              formatter={(v: any) => [
                analytics.totalTurnover > 0 ? formatRupiah(Number(v)) : `${v} Unit`,
                analytics.totalTurnover > 0 ? 'Nilai Penjualan' : 'Stok Unit',
              ]}
            />
            <Bar dataKey="val" radius={[8, 8, 0, 0]} maxBarSize={54}>
              {data.map((entry, index) => (
                <Cell key={`vbar-${index}`} fill={entry.fill} />
              ))}
              <LabelList
                dataKey="val"
                position="top"
                formatter={(v: any) =>
                  Number(v) >= 1000 ? analytics.formatCompactMoney(Number(v)) : `${v}`
                }
                fill="#ffffff"
                fontSize={11}
                fontWeight="bold"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// ============================================================================
// 10. #BurndownChart: Blue-Indigo Area Chart with Glowing Dots & Target Line
// ============================================================================
export const BurndownAreaChart: React.FC<{ title?: string }> = ({
  title = 'Proyeksi Burndown Stok & Target Penjualan (#BurndownChart)',
}) => {
  const analytics = useRealTimeCanvasAnalytics();

  return (
    <div className="rounded-2xl bg-[#080705] border border-amber-500/35 p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.85)] space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-500/20 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
            <h3 className="text-sm font-bold text-white tracking-wide">{title}</h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              #BurndownChart
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Realisasi Aktual vs Target Harian dari Data Firestore
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-2 rounded bg-indigo-500" />
            <span className="text-zinc-200">Aktual</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 border-t-2 border-dashed border-white" />
            <span className="text-white">Target Ideal</span>
          </div>
        </div>
      </div>

      <div className="h-64 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={analytics.dailyComparisonData} margin={{ top: 15, right: 20, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="indigoBurndownGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.6} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#221e17" />
            <XAxis dataKey="day" stroke="#71717a" fontSize={11} />
            <YAxis
              stroke="#71717a"
              fontSize={11}
              tickFormatter={(v) =>
                v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
              }
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#080705', borderColor: '#6366f1', fontSize: '11px', color: '#fff', borderRadius: '0.75rem' }}
              formatter={(v: any, n: any) => [formatRupiah(Number(v)), n === 'actual' ? 'Aktual Realisasi' : 'Garis Target Ideal']}
            />
            <Area
              type="monotone"
              dataKey="actual"
              stroke="#6366f1"
              strokeWidth={3}
              fill="url(#indigoBurndownGrad)"
              dot={{ r: 5, fill: '#ffffff', stroke: '#6366f1', strokeWidth: 2.5 }}
            />
            <Line
              type="linear"
              dataKey="target"
              stroke="#ffffff"
              strokeDasharray="6 6"
              strokeWidth={2}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export const TopKategoriProgressList = TopKategoriChart;
export const BurndownChart = BurndownAreaChart;

// ============================================================================
// Universal Shortcut Renderer: Renders any matching #ShortcutTag
// ============================================================================
export const AIShortcutChartRenderer: React.FC<{
  shortcutTag?: string;
  tag?: string;
  customTitle?: string;
  riskScore?: number;
}> = ({ shortcutTag, tag, customTitle, riskScore }) => {
  const clean = String(shortcutTag || tag || '#SalesGridDashboard').trim().toLowerCase();

  if (clean === '#riskgauge' || clean === '#invoicepower' || clean === '#fraudrisk' || clean === '#gaugechart') {
    return <RiskGaugeChart score={riskScore} title={customTitle} />;
  }
  if (clean === '#salesgriddashboard' || clean === '#fulldashboard' || clean === '#enterprisegrid' || clean === '#masterdashboard') {
    return <SalesGridDashboardChart />;
  }
  if (clean === '#targetlinechart' || clean === '#actualvstarget' || clean === '#linetarget') {
    return <TargetLineChart title={customTitle} />;
  }
  if (clean === '#sourcebar' || clean === '#horizontalbar' || clean === '#channelbar') {
    return <SourceBarChart title={customTitle} />;
  }
  if (clean === '#executiveoverview' || clean === '#sparklinekpi' || clean === '#overviewcards') {
    return <ExecutiveOverviewChart />;
  }
  if (clean === '#kategoridonut' || clean === '#donutchart' || clean === '#categorydonut') {
    return <KategoriDonutChart title={customTitle} />;
  }
  if (clean === '#topkategori' || clean === '#progresslist' || clean === '#leaderboardlist') {
    return <TopKategoriChart title={customTitle} />;
  }
  if (clean === '#glowareachart' || clean === '#revenuearea' || clean === '#glowarea') {
    return <GlowAreaChart title={customTitle} />;
  }
  if (clean === '#multicolorbar' || clean === '#assetbar' || clean === '#verticalmultibar') {
    return <MultiColorBarChart title={customTitle} />;
  }
  if (clean === '#burndownchart' || clean === '#salestargetarea' || clean === '#idealburndown') {
    return <BurndownAreaChart title={customTitle} />;
  }

  return <SalesGridDashboardChart />;
};

export const ShortcutChartRenderer = AIShortcutChartRenderer;

export const AIShortcutChipsBar: React.FC<{
  onSelectTag: (tag: string) => void;
  selectedTags?: string[];
}> = ({ onSelectTag, selectedTags = [] }) => {
  const activeSet = new Set(selectedTags.map((t) => String(t || '').toLowerCase()));
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 shrink-0 flex items-center gap-1 px-1">
        <Zap className="w-3 h-3" /> Chart Shortcuts:
      </span>
      {CHART_SHORTCUT_TAGS.map((item) => {
        const isSelected = activeSet.has(item.tag.toLowerCase());
        return (
          <button
            key={item.tag}
            type="button"
            onClick={() => onSelectTag(item.tag)}
            title={item.description}
            className={`px-2.5 py-1 rounded-full text-[11px] font-mono font-bold whitespace-nowrap transition cursor-pointer shrink-0 flex items-center gap-1 border ${
              isSelected
                ? 'bg-amber-400 text-zinc-950 border-amber-300 shadow-sm'
                : 'bg-[#12100b] hover:bg-amber-500/20 text-amber-200 border-amber-500/30'
            }`}
          >
            <span>{item.icon}</span>
            <span>{item.tag}</span>
          </button>
        );
      })}
    </div>
  );
};

/**
 * Renders all shortcut charts detected inside a prompt or AI output string.
 */
export const PromptShortcutChartsFeed: React.FC<{
  text: string;
  defaultShowAll?: boolean;
}> = ({ text, defaultShowAll = false }) => {
  const matchedTags = useMemo(() => {
    if (defaultShowAll && (!text || extractChartShortcutsFromPrompt(text).length === 0)) {
      return CHART_SHORTCUT_TAGS.map((t) => t.tag);
    }
    return extractChartShortcutsFromPrompt(text);
  }, [text, defaultShowAll]);

  if (matchedTags.length === 0) return null;

  return (
    <div className="space-y-6 my-4 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30">
        <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
          <Zap className="w-4 h-4 text-amber-400" />
          <span>Visualisasi Kanvas AI Otomatis Terdeteksi ({matchedTags.length} Grafik Real-Time Firestore):</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {matchedTags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 rounded-md bg-[#080705] border border-amber-500/40 text-amber-300 font-mono text-[10px] font-bold"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {matchedTags.map((tag) => (
          <AIShortcutChartRenderer key={tag} shortcutTag={tag} />
        ))}
      </div>
    </div>
  );
};

export type AILayoutColumnMode = 'auto' | 1 | 2 | 3 | 4;

export function getDynamicLayoutGridClass(
  mode: AILayoutColumnMode = 'auto',
  promptText: string = '',
  defaultCols: 1 | 2 | 3 | 4 = 2
): string {
  let resolvedCols: 1 | 2 | 3 | 4 = defaultCols;
  if (mode !== 'auto') {
    resolvedCols = mode;
  } else if (promptText) {
    const lower = promptText.toLowerCase();
    if (lower.includes('4 kolom') || lower.includes('4 col')) resolvedCols = 4;
    else if (lower.includes('3 kolom') || lower.includes('3 col')) resolvedCols = 3;
    else if (lower.includes('2 kolom') || lower.includes('2 col')) resolvedCols = 2;
    else if (lower.includes('1 kolom') || lower.includes('1 col')) resolvedCols = 1;
  }
  switch (resolvedCols) {
    case 1:
      return 'grid grid-cols-1 gap-4';
    case 2:
      return 'grid grid-cols-1 md:grid-cols-2 gap-4';
    case 3:
      return 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4';
    case 4:
      return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4';
    default:
      return 'grid grid-cols-1 md:grid-cols-2 gap-4';
  }
}

export const AILayoutToggleBar: React.FC<{
  mode: AILayoutColumnMode;
  onChange: (mode: AILayoutColumnMode) => void;
  promptText?: string;
}> = ({ mode, onChange }) => {
  const options: { label: string; value: AILayoutColumnMode }[] = [
    { label: 'Auto', value: 'auto' },
    { label: '1 Kol', value: 1 },
    { label: '2 Kol', value: 2 },
    { label: '3 Kol', value: 3 },
    { label: '4 Kol', value: 4 },
  ];
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-zinc-900/90 border border-zinc-800 text-[11px]">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-2 py-1 rounded-lg font-bold transition cursor-pointer ${
            mode === opt.value
              ? 'bg-amber-500 text-zinc-950 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
};

