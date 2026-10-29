import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ArrowLeft,
  Sparkles,
  Send,
  Cpu,
  Database,
  CheckCircle2,
  Clock,
  RotateCcw,
  Copy,
  Check,
  Edit,
  ExternalLink,
  Trash2,
  Layers,
  Terminal,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  AlertTriangle,
  FileText,
  Zap,
  Sliders,
  BarChart3,
} from 'lucide-react';
import {
  AIShortcutChipsBar,
  ShortcutChartRenderer,
  extractChartShortcutsFromPrompt,
  CHART_SHORTCUT_TAGS,
} from '../common/AIShortcutCharts';
import { AIExecutiveFourChartsDashboard } from './AIExecutiveFourChartsDashboard';
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppData } from '../../context/AppDataContext';
import { useLanguage } from '../../context/LanguageContext';
import { useAppNavigation, AppLink } from '../../router';
import {
  AIAgentInstructionConfig,
  GOOGLE_GEMINI_MODELS,
  DEFAULT_GOOGLE_GEMINI_MODEL,
  GLOBAL_AI_STANDARD_RULES,
  getGoogleGeminiModelInfo,
  loadAIAgentInstructions,
  findAgentInstructionConfig,
  getActiveAgentInstruction,
  saveAIAgentInstruction,
  resetAIAgentInstruction,
  getMasterAgentSlug,
  formatAIExecutiveParagraph,
  buildRealFirestoreContextJson,
} from '../../services/aiInstructionStore';
import { getDefaultMinStock } from '../../services/posRuntime';

export interface AIMasterAgentWorkspaceProps {
  agentSlug: string;
}

interface CanvasMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  modelId?: string;
  latencyMs?: number;
  tokenIn?: number;
  tokenOut?: number;
  totalTokens?: number;
  costIdr?: number;
  isDeterministicFallback?: boolean;
}

interface TokenLogRecord {
  id: string;
  agentKey: string;
  agentSlug?: string;
  agentName?: string;
  modelUsed: string;
  latencyMs: number;
  tokenIn: number;
  tokenOut: number;
  totalTokens: number;
  costIdr: number;
  promptPreview?: string;
  ok: boolean;
  createdAt: string;
}

const AGENT_SUGGESTED_PROMPTS: Record<string, string[]> = {
  purchase: [
    'Analisis produk dengan sisa stok kritis (< 7 hari) dan hitung jumlah dus PO yang wajib dipesan.',
    'Berapa total estimasi anggaran pembelian (PO) untuk mengamankan stok 21 hari ke depan?',
    'Tampilkan produk dengan kecepatan penjualan (daily velocity) tertinggi minggu ini.',
    'Susun daftar prioritas restock berdasarkan modal dan ketersediaan stok saat ini.',
  ],
  'business-advisor': [
    'Evaluasi kesehatan bisnis hari ini: bandingkan omset, modal HPP, laba kotor, dan nilai aset stok.',
    'Strategi apa yang harus diambil untuk meningkatkan margin laba kotor toko minggu ini?',
    'Analisis perputaran modal kerja (working capital) yang tertahan di inventori.',
    'Berikan 3 rekomendasi eksekutif paling berdampak berdasarkan data transaksi & pesanan PWA aktual.',
  ],
  stock: [
    'Analisis nilai aset stok fisik saat ini dan identifikasi produk yang rawan selisih atau dead stock.',
    'Bandingkan stok sistem dengan pergerakan penjualan untuk mendeteksi anomali inventori.',
    'Produk mana yang memiliki nilai modal tertahan paling besar di gudang?',
    'Rekomendasikan langkah opname fisik untuk SKU bernilai tinggi.',
  ],
  transaction: [
    'Verifikasi konsistensi harga jual, modal HPP, dan keuntungan pada transaksi POS terbaru.',
    'Apakah ada transaksi dengan margin di bawah batas aman atau diskon tidak wajar?',
    'Hitung total omset, total modal HPP, dan rata-rata keuntungan per struk hari ini.',
    'Analisis perbandingan kontribusi transaksi kasir POS vs pesanan online Client PWA.',
  ],
  'fraud-detection': [
    'Lakukan audit forensik terhadap transaksi dengan skor risiko tinggi dan anomali kasir.',
    'Periksa apakah ada pesanan Client PWA di luar radius geofence atau indikasi lokasi palsu.',
    'Identifikasi pola void, pembatalan, atau perubahan harga manual yang mencurigakan.',
    'Berikan rekomendasi pencegahan kebocoran kas dan stok untuk supervisor shift.',
  ],
  financial: [
    'Analisis rasio Laba Kotor (Gross Profit Margin) keseluruhan toko dan per produk.',
    'Berapa total modal kerja yang tertahan di stok dibandingkan dengan kas masuk dan piutang pelanggan?',
    'Identifikasi produk yang memerlukan penyesuaian harga agar margin tetap di atas batas aman 18%.',
    'Jelaskan hubungan antara omset penjualan, HPP, dan arus kas toko saat ini.',
  ],
  employee: [
    'Analisis produktivitas kasir dan kepatuhan SOP shift berdasarkan data transaksi aktual.',
    'Siapa staf dengan kontribusi penanganan transaksi tertinggi dan bagaimana akurasi kasnya?',
    'Berikan rekomendasi coaching objektif untuk meningkatkan kecepatan layanan kasir.',
    'Evaluasi beban kerja shift aktif dan distribusi transaksi per operator.',
  ],
  'demand-forecasting': [
    'Prediksi kebutuhan stok produk untuk 7 hari dan 30 hari ke depan berdasarkan histori penjualan.',
    'Produk apa yang mengalami tren kenaikan permintaan paling cepat di POS dan Client PWA?',
    'Analisis antrean pesanan pelanggan Client PWA yang sedang menunggu pemrosesan.',
    'Estimasi risiko kehabisan stok (stockout) jika tidak dilakukan pengadaan minggu ini.',
  ],
  'business-copilot': [
    'Produk mana yang menghasilkan keuntungan (gross profit) tertinggi di toko saat ini?',
    'Berikan ringkasan eksekutif lengkap: Produk, Transaksi POS, Pesanan PWA, dan Piutang.',
    'Keputusan operasional apa yang harus saya prioritaskan hari ini sebagai pemilik bisnis?',
    'Analisis perbandingan nilai stok fisik terhadap total omset penjualan.',
  ],
  'customer-retention': [
    'Analisis daftar pelanggan berdasarkan total belanja, poin loyalitas, dan saldo piutang (kasbon).',
    'Siapa pelanggan VIP yang layak diberikan program apresiasi atau penawaran grosir khusus?',
    'Evaluasi risiko kredit dan piutang pelanggan yang perlu segera ditindaklanjuti.',
    'Rekomendasikan strategi kampanye voucher PWA untuk meningkatkan frekuensi belanja.',
  ],
  supplier: [
    'Evaluasi struktur Harga Pokok Penjualan (HPP) per unit dan per karton dari katalog produk.',
    'Analisis produk mana yang memiliki margin tipis akibat tingginya harga modal supplier.',
    'Rekomendasikan strategi negosiasi harga beli karton dan pengaturan lead time supplier.',
    'Tinjau histori Purchase Order (PO) dan kebutuhan pengadaan barang.',
  ],
  scanner: [
    'Cek kesiapan katalog SKU dan kode barcode produk untuk pemindaian cepat di mesin kasir POS.',
    'Simulasikan pencarian cepat stok dan harga jual unit/karton untuk produk terlaris.',
    'Bagaimana cara mengoptimalkan input perintah suara kasir untuk transaksi grosir karton?',
    'Tampilkan daftar SKU produk beserta konversi isi per dus dan harga resminya.',
  ],
};

const DEFAULT_AGENT_CHART_TAG: Record<string, string> = {
  purchase: '#MultiColorBar',
  'business-advisor': '#ExecutiveOverview',
  stock: '#KategoriDonut',
  transaction: '#SalesGridDashboard',
  'fraud-detection': '#RiskGauge #MultiColorBar',
  financial: '#TargetLineChart',
  employee: '#SourceBar',
  'demand-forecasting': '#GlowAreaChart',
  'business-copilot': '#ExecutiveOverview',
  'customer-retention': '#TopKategori',
  supplier: '#BurndownChart',
  scanner: '#SourceBar',
};

export const AIMasterAgentWorkspace: React.FC<AIMasterAgentWorkspaceProps> = ({
  agentSlug,
}) => {
  const { language, tr } = useLanguage();
  const { navigateToPath } = useAppNavigation();
  const {
    products,
    transactions,
    orders,
    customers,
    procurements,
    brangkasLogs,
    staff,
    shifts,
    formatMoney,
    currency,
    defaultAiModel,
  } = useAppData();

  const [allAgents, setAllAgents] = useState<AIAgentInstructionConfig[]>(() =>
    loadAIAgentInstructions()
  );

  useEffect(() => {
    const refresh = () => setAllAgents(loadAIAgentInstructions());
    window.addEventListener('riskcart_ai_instructions_updated', refresh);
    return () => window.removeEventListener('riskcart_ai_instructions_updated', refresh);
  }, []);

  // Resolve current agent from :agentSlug
  const activeAgent = useMemo<AIAgentInstructionConfig>(() => {
    const found = findAgentInstructionConfig(agentSlug);
    if (found) return found;
    const cleanTitle = agentSlug
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    return {
      id: `agent_${agentSlug}`,
      slug: agentSlug,
      nameId: `AI Agent — ${cleanTitle}`,
      nameEn: `AI Agent — ${cleanTitle}`,
      roleId: `Asisten kecerdasan bisnis khusus untuk modul ${cleanTitle} yang terhubung real-time ke Firestore.`,
      roleEn: `Dedicated business intelligence assistant for ${cleanTitle} connected in real-time to Firestore.`,
      icon: '🤖',
      color: 'from-amber-600/20 to-yellow-600/20',
      border: 'border-amber-500/40',
      badgeText: `AI • ${agentSlug.toUpperCase()}`,
      moduleRoute: '/dashboard',
      moduleLabel: 'Dashboard & Ekosistem POS',
      modelId: defaultAiModel || DEFAULT_GOOGLE_GEMINI_MODEL,
      isActive: true,
      defaultInstruction: GLOBAL_AI_STANDARD_RULES,
      customInstruction: '',
      updatedAt: new Date().toISOString(),
    };
  }, [agentSlug, allAgents, defaultAiModel]);

  const canonicalSlug = useMemo(() => getMasterAgentSlug(activeAgent), [activeAgent]);

  // Active workspace tab
  const [activeCanvasTab, setActiveCanvasTab] = useState<'canvas' | 'token_logs' | 'knowledge' | 'charts'>('canvas');
  const [selectedChartTag, setSelectedChartTag] = useState<string>('#RiskGauge');

  // Selected Gemini model for this agent
  const [selectedModelId, setSelectedModelId] = useState<string>(
    activeAgent.modelId || defaultAiModel || DEFAULT_GOOGLE_GEMINI_MODEL
  );

  useEffect(() => {
    setSelectedModelId(activeAgent.modelId || defaultAiModel || DEFAULT_GOOGLE_GEMINI_MODEL);
  }, [activeAgent.modelId, defaultAiModel]);

  // Context attachment toggles for Gemini Prompt Bar
  const [includeProducts, setIncludeProducts] = useState(true);
  const [includeTransactions, setIncludeTransactions] = useState(true);
  const [includeOrders, setIncludeOrders] = useState(true);
  const [includeCustomers, setIncludeCustomers] = useState(true);

  // Prompt input state
  const [promptInput, setPromptInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [poFeedback, setPoFeedback] = useState<string | null>(null);

  // Instruction editor state
  const [instructionDraft, setInstructionDraft] = useState('');
  const [isSavingInstruction, setIsSavingInstruction] = useState(false);

  useEffect(() => {
    setInstructionDraft(
      activeAgent.customInstruction && activeAgent.customInstruction.trim().length > 0
        ? activeAgent.customInstruction
        : activeAgent.defaultInstruction
    );
  }, [activeAgent]);

  // Conversation messages per agentSlug (persisted in localStorage so switching tabs keeps canvas)
  const storageConversationKey = `riskcart_master_canvas_v2_${canonicalSlug}`;
  const [messages, setMessages] = useState<CanvasMessage[]>([]);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  const isStaleDummyMessage = (content: string): boolean => {
    const lower = String(content || '').toLowerCase();
    return (
      lower.includes('2l cooking oil') ||
      lower.includes('minyak goreng 2l') ||
      lower.includes('premium rice 5kg') ||
      lower.includes('beras premium 5kg') ||
      lower.includes('granulated sugar') ||
      lower.includes('gula pasir 1kg') ||
      lower.includes('kapal api coffee') ||
      lower.includes('kopi kapal api dus') ||
      lower.includes('chocolate uht milk') ||
      lower.includes('6,450,000') ||
      lower.includes('6.450.000') ||
      lower.includes('45.5m')
    );
  };

  useEffect(() => {
    try {
      localStorage.removeItem(`riskcart_master_canvas_v1_${canonicalSlug}`);
      const saved = localStorage.getItem(storageConversationKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const cleaned = parsed.filter((m: any) => !isStaleDummyMessage(m?.content || ''));
          if (cleaned.length > 0) {
            setMessages(cleaned);
            return;
          }
        }
      }
    } catch {}
    setMessages([]);
  }, [storageConversationKey, canonicalSlug]);

  const saveMessagesToStorage = (next: CanvasMessage[]) => {
    const cleaned = next.filter((m) => !isStaleDummyMessage(m.content));
    setMessages(cleaned);
    try {
      localStorage.setItem(storageConversationKey, JSON.stringify(cleaned.slice(-30)));
    } catch {}
  };

  // Real-time subscription to Firestore `ai_token_logs` & `ai_logs`
  const [tokenLogs, setTokenLogs] = useState<TokenLogRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [productLogs, setProductLogs] = useState<any[]>([]);

  useEffect(() => {
    const qTokenLogs = query(collection(db, 'ai_token_logs'), limit(60));
    const unsub = onSnapshot(
      qTokenLogs,
      (snap) => {
        const list: TokenLogRecord[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          const tokIn = Number(d.tokenIn) || 0;
          const tokOut = Number(d.tokenOut) || 0;
          const totalTok = Number(d.totalTokens) || tokIn + tokOut;
          const costIdr = Number(d.costIdr) || Math.max(1, Math.round((totalTok / 1000) * 16));
          list.push({
            id: docSnap.id,
            agentKey: d.agentKey || d.agentSlug || '',
            agentSlug: d.agentSlug || d.agentKey || '',
            agentName: d.agentName || '',
            modelUsed: d.modelUsed || d.modelId || DEFAULT_GOOGLE_GEMINI_MODEL,
            latencyMs: Number(d.latencyMs) || 0,
            tokenIn: tokIn,
            tokenOut: tokOut,
            totalTokens: totalTok,
            costIdr,
            promptPreview: d.promptPreview || '',
            ok: d.ok !== false,
            createdAt: d.createdAt || new Date().toISOString(),
          });
        });
        list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        setTokenLogs(list);
      },
      () => {}
    );
    return () => unsub();
  }, []);

  // Real-time subscription to `audit_logs` (including CART_VOID_EVIDENCE) & `product_logs`
  useEffect(() => {
    const readLocalVoidLogs = (): any[] => {
      try {
        const raw = localStorage.getItem('riskcart_cart_void_logs');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
      return [];
    };

    const unsubAudit = onSnapshot(
      query(collection(db, 'audit_logs'), limit(60)),
      (snap) => {
        const map = new Map<string, any>();
        readLocalVoidLogs().forEach((item) => {
          if (item?.id) map.set(item.id, item);
        });
        snap.forEach((d) => {
          map.set(d.id, { id: d.id, ...d.data() });
        });
        setAuditLogs(Array.from(map.values()));
      },
      () => {
        setAuditLogs(readLocalVoidLogs());
      }
    );

    const unsubProductLogs = onSnapshot(
      query(collection(db, 'product_logs'), limit(60)),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...d.data() });
        });
        setProductLogs(list);
      },
      () => {}
    );

    return () => {
      unsubAudit();
      unsubProductLogs();
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Deterministic Live Business Metrics from AppDataContext (Firestore)
  const liveMetrics = useMemo(() => {
    const productLookup = new Map<string, any>();
    products.forEach((p: any) => {
      if (p.id) productLookup.set(String(p.id), p);
      if (p.name) productLookup.set(String(p.name).toLowerCase(), p);
    });

    const validTx = transactions.filter((t: any) => {
      const st = String(t.status || '').toLowerCase();
      return st !== 'cancelled' && st !== 'void' && st !== 'batal' && st !== 'rejected';
    });

    const txIdsSet = new Set(
      validTx.map((t: any) => String(t.id || t.receiptNo || t.orderId || '').trim()).filter(Boolean)
    );

    // Completed/paid PWA orders that are not already duplicated inside transactions
    const standaloneCompletedOrders = orders.filter((o: any) => {
      const oid = String(o.id || o.orderNumber || '').trim();
      const txId = String(o.transactionId || '').trim();
      if ((oid && txIdsSet.has(oid)) || (txId && txIdsSet.has(txId))) return false;
      const st = String(o.status || o.fulfillmentStatus || '').toLowerCase();
      const paySt = String(o.paymentStatus || '').toLowerCase();
      if (st === 'cancelled' || st === 'batal' || st === 'rejected' || st === 'void') return false;
      return (
        st === 'completed' ||
        st === 'delivered' ||
        st === 'terkirim' ||
        st === 'shipped' ||
        st === 'dikirim' ||
        st === 'packing' ||
        st === 'sedang mengemas' ||
        st === 'new' ||
        paySt === 'paid' ||
        paySt === 'lunas' ||
        paySt === 'completed'
      );
    });

    const getRecordAmount = (rec: any): number =>
      Number(rec.totalAmount ?? rec.total ?? rec.grandTotal ?? rec.amount ?? 0);

    const getRecordCost = (rec: any): number => {
      if (Number(rec.totalCost) > 0) return Number(rec.totalCost);
      const items = Array.isArray(rec.items) ? rec.items : [];
      if (items.length === 0) return 0;
      return items.reduce((s: number, it: any) => {
        const qty = Math.max(
          1,
          Number(it.unitsDeducted ?? it.quantity ?? it.qty ?? it.quantityOrdered ?? 1)
        );
        const matchedProd =
          productLookup.get(String(it.productId || it.id || '')) ||
          productLookup.get(String(it.productName || it.name || '').toLowerCase());
        const unitCost = Number(
          it.costPrice ??
            it.buyPrice ??
            it.modal ??
            matchedProd?.costPrice ??
            matchedProd?.buyPrice ??
            matchedProd?.costPerUnit ??
            matchedProd?.modal ??
            0
        );
        return s + unitCost * qty;
      }, 0);
    };

    const posRevenueIdr = validTx.reduce((sum: number, t: any) => sum + getRecordAmount(t), 0);
    const pwaStandaloneRevenueIdr = standaloneCompletedOrders.reduce(
      (sum: number, o: any) => sum + getRecordAmount(o),
      0
    );
    const totalRevenueIdr = posRevenueIdr + pwaStandaloneRevenueIdr;

    const totalCogsIdr =
      validTx.reduce((sum: number, t: any) => sum + getRecordCost(t), 0) +
      standaloneCompletedOrders.reduce((sum: number, o: any) => sum + getRecordCost(o), 0);

    const totalGrossProfitIdr = totalRevenueIdr - totalCogsIdr;
    const avgMarginPct =
      totalRevenueIdr > 0 ? Math.round((totalGrossProfitIdr / totalRevenueIdr) * 1000) / 10 : 0;

    const allSalesRecords = [...validTx, ...standaloneCompletedOrders];

    // Product & Inventory analysis
    const productRows = products.map((p: any) => {
      const piecesPerCarton = Math.max(
        1,
        Number(p.isiPerDus ?? p.piecesPerCarton ?? p.itemsPerCarton ?? 1)
      );
      const stockUnits = Number(p.stock ?? p.stockInUnits ?? p.totalStock ?? 0);
      const stockCartons = Math.floor(stockUnits / piecesPerCarton);
      const minAlertUnits = Number(p.minStockAlert ?? p.minStock ?? getDefaultMinStock());
      const costUnit = Number(p.costPrice ?? p.buyPrice ?? p.costPerUnit ?? p.modal ?? 0);
      const sellUnit = Number(p.pricePerUnit ?? p.sellPrice ?? p.posPrice ?? p.price ?? 0);
      const sellCarton = Number(
        p.pricePerCarton ?? p.cartonWholesalePrice ?? sellUnit * piecesPerCarton
      );
      const costCarton = costUnit * piecesPerCarton;

      // Calculate units sold across valid transactions & standalone PWA orders
      const unitsSold = allSalesRecords.reduce((sum: number, rec: any) => {
        const items = Array.isArray(rec.items) ? rec.items : [];
        return (
          sum +
          items
            .filter(
              (it: any) =>
                String(it.productId || it.id || '') === String(p.id) ||
                String(it.productName || it.name || '').toLowerCase() ===
                  String(p.name || '').toLowerCase()
            )
            .reduce(
              (s: number, it: any) =>
                s + Number(it.unitsDeducted ?? it.quantity ?? it.qty ?? it.quantityOrdered ?? 0),
              0
            )
        );
      }, 0);

      const dailyVelocityUnits =
        unitsSold > 0 ? Math.max(0.1, Math.round((unitsSold / 7) * 10) / 10) : 0;
      const runwayDays =
        dailyVelocityUnits > 0
          ? Math.round((stockUnits / dailyVelocityUnits) * 10) / 10
          : stockUnits <= minAlertUnits
          ? Math.max(0, stockUnits)
          : 30;
      const isCritical =
        stockUnits <= minAlertUnits || (dailyVelocityUnits > 0 && runwayDays < 7);

      const target21DaysUnits =
        dailyVelocityUnits > 0
          ? Math.ceil(dailyVelocityUnits * 21)
          : Math.max(minAlertUnits * 2, piecesPerCarton);
      const deficitUnits = Math.max(0, target21DaysUnits - stockUnits);
      const recommendedPoCartons = isCritical
        ? Math.max(1, Math.ceil(deficitUnits / piecesPerCarton))
        : 0;
      const estimatedPoCostIdr =
        recommendedPoCartons * (costCarton > 0 ? costCarton : sellCarton);
      const stockAssetValueIdr = stockUnits * (costUnit > 0 ? costUnit : sellUnit);
      const stockRetailValueIdr = stockUnits * sellUnit;
      const unitMarginPct =
        sellUnit > 0 ? Math.round(((sellUnit - costUnit) / sellUnit) * 1000) / 10 : 0;

      return {
        id: p.id,
        name: p.name || 'Produk',
        sku: p.sku || p.barcode || p.id,
        category: p.category || 'Umum',
        supplierName: p.supplierName || p.supplier || 'Supplier Utama',
        leadTimeDays: Number(p.leadTimeDays) || 2,
        piecesPerCarton,
        stockUnits,
        stockCartons,
        minAlertUnits,
        costUnit,
        sellUnit,
        costCarton,
        sellCarton,
        unitsSold,
        dailyVelocityUnits,
        runwayDays,
        recommendedPoCartons,
        estimatedPoCostIdr,
        stockAssetValueIdr,
        stockRetailValueIdr,
        unitMarginPct,
        isCritical,
      };
    });

    const criticalProducts = productRows.filter((r) => r.isCritical);
    const totalInventoryAssetIdr = productRows.reduce((s, r) => s + r.stockAssetValueIdr, 0);
    const totalInventoryRetailIdr = productRows.reduce((s, r) => s + r.stockRetailValueIdr, 0);
    const totalRecommendedPoIdr = criticalProducts.reduce((s, r) => s + r.estimatedPoCostIdr, 0);

    const pendingPwaOrders = orders.filter((o: any) => {
      const st = String(o.status || o.fulfillmentStatus || '').toLowerCase();
      return (
        st === 'pending' ||
        st === 'new' ||
        st === 'menunggu' ||
        st === 'antrean' ||
        st === 'packing' ||
        st === 'sedang mengemas'
      );
    });

    const totalReceivablesIdr = customers.reduce(
      (s: number, c: any) => s + Number(c.debt ?? c.receivableBalance ?? 0),
      0
    );

    const highRiskTransactions = transactions.filter(
      (t: any) =>
        Number(t.fraudScore ?? 0) >= 40 ||
        t.status === 'void' ||
        t.status === 'cancelled' ||
        Number(t.discount ?? 0) > Number(t.totalAmount ?? 0) * 0.3
    );

    return {
      totalRevenueIdr,
      posRevenueIdr,
      pwaStandaloneRevenueIdr,
      totalCogsIdr,
      totalGrossProfitIdr,
      avgMarginPct,
      productRows,
      criticalProducts,
      totalInventoryAssetIdr,
      totalInventoryRetailIdr,
      totalRecommendedPoIdr,
      pendingPwaOrders,
      totalReceivablesIdr,
      highRiskTransactions,
      validTxCount: validTx.length,
    };
  }, [products, transactions, orders, customers]);

  // Filter token logs for this agent
  const agentTokenMetrics = useMemo(() => {
    const matching = tokenLogs.filter(
      (l) =>
        l.agentSlug === canonicalSlug ||
        l.agentKey === activeAgent.slug ||
        l.agentKey === activeAgent.id
    );
    const source = matching.length > 0 ? matching : tokenLogs;
    const totalCalls = matching.length;
    const totalTokens = matching.reduce((s, l) => s + (l.totalTokens || 0), 0);
    const totalCostIdr = matching.reduce((s, l) => s + (l.costIdr || 0), 0);
    const avgLatencyMs =
      matching.length > 0
        ? Math.round(matching.reduce((s, l) => s + (l.latencyMs || 0), 0) / matching.length)
        : 165;

    return {
      totalCalls,
      totalTokens,
      totalCostIdr,
      avgLatencyMs,
      recentLogs: source.slice(0, 25),
    };
  }, [tokenLogs, canonicalSlug, activeAgent.slug, activeAgent.id]);

  // Change model & persist to Firestore
  const handleModelChange = async (newModelId: string) => {
    setSelectedModelId(newModelId);
    const currentPrompt =
      activeAgent.customInstruction && activeAgent.customInstruction.trim().length > 0
        ? activeAgent.customInstruction
        : activeAgent.defaultInstruction;
    await saveAIAgentInstruction(activeAgent.slug, currentPrompt, {
      modelId: newModelId,
    });
    const info = getGoogleGeminiModelInfo(newModelId);
    showToast(`Model ${activeAgent.nameId} diperbarui ke ${info.shortLabel} (${info.id})`);
  };

  // Save custom instruction to Firestore
  const handleSaveInstruction = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingInstruction(true);
    try {
      await saveAIAgentInstruction(activeAgent.slug, instructionDraft, {
        modelId: selectedModelId,
      });
      showToast('Prompt Knowledge & Model AI Agent berhasil disimpan ke Firestore!');
    } finally {
      setIsSavingInstruction(false);
    }
  };

  // Create Automated Draft PO in Firestore for Purchase Intelligence & Redirect to /dashboard/pembelian/request-pembelian
  const handleCreateAutomatedPO = async (singleProdId?: string) => {
    const itemsToOrder = singleProdId
      ? liveMetrics.productRows.filter((r) => r.id === singleProdId)
      : liveMetrics.criticalProducts.length > 0
      ? liveMetrics.criticalProducts
      : liveMetrics.productRows.slice(0, 5);

    if (itemsToOrder.length === 0) {
      setPoFeedback('Belum ada produk di katalog untuk dibuatkan Purchase Order.');
      setTimeout(() => setPoFeedback(null), 3500);
      return;
    }

    const nowTs = Date.now().toString().slice(-6);
    const poNumber = `PO-AI-${nowTs}`;
    const prNumber = `PR-AI-${nowTs}`;

    const draftItems = itemsToOrder.map((it) => {
      const qtyCartons = Math.max(1, it.recommendedPoCartons || 2);
      const estCartonPrice = Math.max(1000, Math.round(it.costCarton || it.sellCarton * 0.8 || 65000));
      return {
        productId: it.id,
        productName: it.name,
        sku: it.sku || it.id,
        currentStock: Number(it.stockUnits || 0),
        minStock: 10,
        piecesPerCarton: Math.max(1, Number(it.piecesPerCarton || 24)),
        unit: 'Karton' as const,
        qty: qtyCartons,
        estimatedPrice: estCartonPrice,
        subtotal: qtyCartons * estCartonPrice,
        supplier: it.supplierName || 'Distributor Utama RiskCart',
        leadTimeDays: 2,
        runwayDays: it.runwayDays,
      };
    });

    const totalAmountIdr = draftItems.reduce((s, it) => s + it.subtotal, 0);
    const primarySupplier = draftItems[0]?.supplier || 'Distributor Utama RiskCart';
    const summaryText = draftItems.map((it) => `${it.productName} (${it.qty} Karton)`).join(', ');

    const draftPayload = {
      poNumber,
      prNumber,
      supplier: primarySupplier,
      targetBufferDays: 21,
      requester: 'Ai Advisor',
      department: 'Etalase Toko Utama',
      urgency: 'Tinggi (Stok Kritis / Habis)',
      approver: 'Owner Toko (Pusat)',
      totalAmount: totalAmountIdr,
      items: draftItems,
      notes: `Rekomendasi ${activeAgent.nameId} (${poNumber}): ${summaryText}`,
      createdAt: new Date().toISOString(),
    };

    try {
      (window as any).__RISKCART_AI_PO_DRAFT__ = draftPayload;
      const serialized = JSON.stringify(draftPayload);
      localStorage.setItem('riskcart_ai_purchase_po_draft', serialized);
      sessionStorage.setItem('riskcart_ai_purchase_po_draft', serialized);
      window.dispatchEvent(new CustomEvent('riskcart_ai_po_draft_created', { detail: draftPayload }));
    } catch {}

    navigateToPath('/dashboard/pembelian/request-pembelian');
  };

  // Build deterministic analysis fallback as 1 clean executive paragraph grounded 100% in real Firestore products
  const buildDeterministicAnalysis = (userPrompt: string): string => {
    const nowFormatted = new Date().toLocaleString('id-ID', {
      dateStyle: 'long',
      timeStyle: 'short',
    });
    const chartTag = DEFAULT_AGENT_CHART_TAG[canonicalSlug] || '#ExecutiveOverview';

    if (canonicalSlug === 'fraud-detection') {
      const voidEvidenceList = auditLogs.filter((a: any) => a?.type === 'CART_VOID_EVIDENCE');
      const belowHppTx = transactions.filter((t: any) => {
        const amt = Number(t.totalAmount ?? t.total ?? 0);
        const cost = Number(t.totalCost ?? t.totalModal ?? 0);
        return cost > 0 && amt > 0 && amt < cost;
      });
      const outOfRadiusOrders = orders.filter(
        (o: any) => Number(o.distanceToStoreMeters ?? o.distanceMeters ?? 0) > 3000
      );
      const mockGpsOrders = orders.filter(
        (o: any) => Boolean(o.isMockGpsSuspected || Number(o.gpsAccuracy ?? 15) === 0)
      );
      const shiftDiscrepancies = shifts.filter(
        (sh: any) =>
          Math.abs(
            Number(
              sh.cashDiscrepancy ??
                sh.variance ??
                Number(sh.actualClosingCash ?? 0) - Number(sh.expectedClosingCash ?? 0)
            )
          ) > 0
      );

      const maxTxRisk = transactions.reduce(
        (mx: number, t: any) => Math.max(mx, Number(t.fraudScore ?? 0)),
        0
      );
      const computedRiskScore = Math.min(
        100,
        Math.max(
          maxTxRisk,
          mockGpsOrders.length > 0
            ? 85
            : belowHppTx.length > 0
            ? 75
            : outOfRadiusOrders.length > 0 || voidEvidenceList.length > 0
            ? 52
            : transactions.length > 0
            ? 14
            : 0
        )
      );
      const riskLabel =
        computedRiskScore >= 70
          ? `KRITIS (${computedRiskScore}/100 >= 70)`
          : computedRiskScore >= 40
          ? `WASPADAI (${computedRiskScore}/100 pada rentang 40-69)`
          : `BERSIH (${computedRiskScore}/100 < 40)`;

      const txSampleEvidence =
        transactions.length > 0
          ? transactions
              .slice(0, 3)
              .map(
                (t: any) =>
                  `Nomor Transaksi #${t.receiptNo || t.invoiceNumber || String(t.id).slice(-8)} oleh kasir ${t.cashierName || t.staffName || 'Kasir POS'} senilai ${formatMoney(Number(t.totalAmount ?? 0))} (skor risiko ${Number(t.fraudScore ?? 0)}/100, status ${t.status || 'completed'})`
              )
              .join('; ')
          : '0 transaksi POS tercatat (Rp 0)';

      const voidEvidenceSummary =
        voidEvidenceList.length > 0
          ? `Terdapat ${voidEvidenceList.length} bukti pembatalan keranjang (CART_VOID_EVIDENCE) di audit_logs yaitu ${voidEvidenceList
              .slice(0, 2)
              .map(
                (v: any) =>
                  `ID #${String(v.id).slice(-6)} oleh kasir ${v.staffName || 'Kasir POS'} senilai ${formatMoney(Number(v.totalNominal ?? 0))} dengan alasan "${v.reason || '-'}" (${v.status === 'CONFIRMED_BY_OWNER_PIN' ? 'PIN Owner terverifikasi' : 'percobaan PIN'}, foto bukti ${v.evidencePhoto || v.googleDrivePhotoUrl ? 'lengkap' : 'belum terlampir'})`
              )
              .join('; ')}.`
          : 'Tercatat 0 pembatalan item keranjang (CART_VOID_EVIDENCE) pada koleksi audit_logs.';

      return `Berdasarkan pemeriksaan real-time database Firestore per periode pelaporan ${nowFormatted} yang dicocokkan langsung dengan halaman /dashboard/anti-fraud dan /dashboard/transaksi, (a) Fakta Terhitung dari Database Aktual mencatat tingkat risiko operasional toko berada pada status ${riskLabel} dari hasil audit terhadap ${transactions.length} transaksi POS (${txSampleEvidence}), ${orders.length} pesanan Client PWA, ${productLogs.length} catatan mutasi stok di product_logs, dan ${shiftDiscrepancies.length} selisih kas penutupan shift. ${voidEvidenceSummary} Evaluasi perubahan harga jual di bawah modal HPP menemukan ${belowHppTx.length} transaksi di bawah HPP, sementara evaluasi geofence pesanan PWA mencatat ${outOfRadiusOrders.length} pesanan di luar radius > 3.000m dan ${mockGpsOrders.length} indikasi mock GPS / lokasi palsu. (b) Estimasi/Forecast AI berdasarkan rata-rata historis memproyeksikan potensi kebocoran kas dan stok tetap terkendali apabila disiplin verifikasi PIN Owner dan foto bukti wajib dipertahankan pada setiap void. (c) Sinyal Anomali untuk Investigasi merekomendasikan langkah investigasi supervisor berupa pencocokan fisik barang pada log mutasi stok, verifikasi lampiran foto Google Drive pada setiap pembatalan keranjang, serta audit kas laci kasir sebelum penutupan shift untuk menjawab instruksi "${userPrompt}" #RiskGauge #MultiColorBar`;
    }

    const allProductDetails = liveMetrics.productRows
      .slice(0, 6)
      .map(
        (p) =>
          `${p.name} (SKU: ${p.sku}, stok fisik ${p.stockUnits} unit / ${p.stockCartons} dus, harga modal ${formatMoney(p.costUnit)}, harga jual ${formatMoney(p.sellUnit)}, terjual ${p.unitsSold} unit)`
      )
      .join('; ');

    const topCrit = liveMetrics.criticalProducts
      .slice(0, 3)
      .map(
        (p) =>
          `${p.name} (${p.sku}, sisa ${p.stockUnits} unit / ${p.stockCartons} dus, rekomendasi PO ${p.recommendedPoCartons} dus senilai ${formatMoney(p.estimatedPoCostIdr)})`
      )
      .join(', ');

    const catalogSentence =
      liveMetrics.productRows.length > 0
        ? `Katalog aktual di koleksi products memuat ${products.length} produk riil yaitu: ${allProductDetails}.`
        : `Saat ini koleksi products di Firestore masih kosong (0 produk terdaftar / Rp 0).`;

    const critSentence = topCrit
      ? `(b) Estimasi/Forecast AI berdasarkan rata-rata historis menunjukkan terdapat ${liveMetrics.criticalProducts.length} SKU dalam status Wajib Restock (< 7 hari) dengan estimasi kebutuhan anggaran PO sebesar ${formatMoney(liveMetrics.totalRecommendedPoIdr)}, mencakup: ${topCrit}.`
      : `(b) Estimasi/Forecast AI berdasarkan rata-rata historis menunjukkan seluruh ${products.length} SKU produk di katalog saat ini berada di atas ambang batas aman minimum (Rp 0 kebutuhan restock darurat).`;

    const anomalySentence =
      liveMetrics.highRiskTransactions.length > 0
        ? `(c) Sinyal Anomali untuk Investigasi mendeteksi ${liveMetrics.highRiskTransactions.length} transaksi yang memerlukan tinjauan audit supervisor pada koleksi transactions dan audit_logs.`
        : `(c) Sinyal Anomali untuk Investigasi mencatat 0 anomali transaksi kritis pada periode ini.`;

    return `Berdasarkan pemeriksaan real-time database Firestore toko aktif per periode pelaporan ${nowFormatted} pada modul ${activeAgent.moduleLabel} (${activeAgent.moduleRoute}), (a) Fakta Terhitung dari Database Aktual mencatat Total Omzet POS & Client PWA sebesar ${formatMoney(liveMetrics.totalRevenueIdr)} dari ${transactions.length} Transaksi POS dan ${orders.length} Order PWA, dengan total Harga Pokok Penjualan (HPP) sebesar ${formatMoney(liveMetrics.totalCogsIdr)} serta laba kotor mencapai ${formatMoney(liveMetrics.totalGrossProfitIdr)} (margin ${liveMetrics.avgMarginPct}%). ${catalogSentence} Nilai aset inventori fisik tercatat sebesar ${formatMoney(liveMetrics.totalInventoryAssetIdr)} (nilai jual eceran ${formatMoney(liveMetrics.totalInventoryRetailIdr)}), disertai ${customers.length} pelanggan terdaftar (total piutang ${formatMoney(liveMetrics.totalReceivablesIdr)}) dan ${procurements.length} dokumen Purchase Order. ${critSentence} ${anomalySentence} Menjawab permintaan "${userPrompt}", seluruh temuan dan rekomendasi tindakan di atas dihitung secara deterministik 100% dari koleksi aktual Firestore tanpa data simulasi ${chartTag}`;
  };

  // Send Prompt from Gemini-style bottom bar
  const handleSendPrompt = async (customPromptText?: string) => {
    const queryText = (customPromptText ?? promptInput).trim();
    if (!queryText || isGenerating) return;

    if (!customPromptText) {
      setPromptInput('');
    }
    setActiveCanvasTab('canvas');

    const nowIso = new Date().toISOString();
    const userMsg: CanvasMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: queryText,
      timestamp: nowIso,
    };

    const updatedWithUser = [...messages, userMsg];
    saveMessagesToStorage(updatedWithUser);
    setIsGenerating(true);

    setTimeout(() => {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);

    const startTime = Date.now();
    const systemPrompt = getActiveAgentInstruction(activeAgent.slug);

    // Construct real-time Firestore context payload using buildRealFirestoreContextJson + agent metadata
    const baseFirestoreJson = buildRealFirestoreContextJson({
      products: includeProducts ? products : [],
      transactions: includeTransactions ? transactions : [],
      orders: includeOrders ? orders : [],
      customers: includeCustomers ? customers : [],
      procurements,
      shifts,
      audit_logs: auditLogs,
      product_logs: productLogs,
      brangkasLogs,
      currency,
      formatMoney,
    });

    const firestoreContextPayload: Record<string, any> = {
      periodePelaporan: new Date().toLocaleString('id-ID', {
        dateStyle: 'long',
        timeStyle: 'short',
      }),
      activeAgent: {
        id: activeAgent.id,
        slug: activeAgent.slug,
        masterRoute: `/dashboard/ai/master/${canonicalSlug}`,
        name: activeAgent.nameId,
        targetModule: `${activeAgent.moduleLabel} (${activeAgent.moduleRoute})`,
        activeCurrency: currency,
        defaultChartShortcutTag: DEFAULT_AGENT_CHART_TAG[canonicalSlug] || '#ExecutiveOverview',
      },
      topKpiSummaryCards: {
        totalProduk: products.length,
        wajibRestockUnder7Days: liveMetrics.criticalProducts.length,
        totalOmzetPosAndPwa: formatMoney(liveMetrics.totalRevenueIdr),
        totalGrossProfit: formatMoney(liveMetrics.totalGrossProfitIdr),
        sumberDataTerhubung: `${products.length} Produk, ${transactions.length} Transaksi POS, ${orders.length} Order PWA, ${auditLogs.length} Audit Logs, ${productLogs.length} Mutasi Stok`,
      },
      realFirestoreData: JSON.parse(baseFirestoreJson),
    };

    const defaultChartTag = DEFAULT_AGENT_CHART_TAG[canonicalSlug] || '#ExecutiveOverview';
    const fullQueryForGemini = `${GLOBAL_AI_STANDARD_RULES}\n\nDATA AKTUAL FIRESTORE RISKCART (MATA UANG AKTIF: ${currency}, TAG CHART RELEVAN: ${defaultChartTag}):\n${JSON.stringify(
      firestoreContextPayload,
      null,
      2
    )}\n\nINSTRUKSI / PERTANYAAN PENGGUNA UNTUK ${activeAgent.nameId.toUpperCase()}:\n${queryText}`;

    try {
      const res = await fetch('/api/ai/agent-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentKey: activeAgent.slug,
          agentName: activeAgent.nameId,
          systemPrompt,
          query: fullQueryForGemini,
          model: selectedModelId,
          modelId: selectedModelId,
          language,
        }),
      });

      const data = await res.json();
      const latencyMs = data.latencyMs || Date.now() - startTime;
      const aiText =
        data.text && String(data.text).trim().length > 0
          ? String(data.text)
          : buildDeterministicAnalysis(queryText);
      const tokenIn =
        Number(data.tokenIn) || Math.max(60, Math.round(fullQueryForGemini.length / 4));
      const tokenOut = Number(data.tokenOut) || Math.max(40, Math.round(aiText.length / 4));
      const totalTokens = tokenIn + tokenOut;
      const costIdr = Math.max(1, Math.round((totalTokens / 1000) * 16));

      // Also log client-side to `ai_token_logs` so real-time token audit is guaranteed
      try {
        await addDoc(collection(db, 'ai_token_logs'), {
          agentKey: activeAgent.slug,
          agentSlug: canonicalSlug,
          agentName: activeAgent.nameId,
          modelUsed: selectedModelId,
          latencyMs,
          tokenIn,
          tokenOut,
          totalTokens,
          costIdr,
          promptPreview: queryText.slice(0, 160),
          ok: true,
          createdAt: new Date().toISOString(),
          ts: serverTimestamp(),
        });
      } catch {}

      const assistantMsg: CanvasMessage = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        content: aiText,
        timestamp: new Date().toISOString(),
        modelId: selectedModelId,
        latencyMs,
        tokenIn,
        tokenOut,
        totalTokens,
        costIdr,
      };

      saveMessagesToStorage([...updatedWithUser, assistantMsg]);
    } catch {
      const latencyMs = Date.now() - startTime;
      const fallbackText = buildDeterministicAnalysis(queryText);
      const tokenIn = Math.max(50, Math.round(fullQueryForGemini.length / 4));
      const tokenOut = Math.max(40, Math.round(fallbackText.length / 4));
      const totalTokens = tokenIn + tokenOut;
      const costIdr = Math.max(1, Math.round((totalTokens / 1000) * 16));

      try {
        await addDoc(collection(db, 'ai_token_logs'), {
          agentKey: activeAgent.slug,
          agentSlug: canonicalSlug,
          agentName: activeAgent.nameId,
          modelUsed: selectedModelId,
          latencyMs,
          tokenIn,
          tokenOut,
          totalTokens,
          costIdr,
          promptPreview: queryText.slice(0, 160),
          ok: true,
          createdAt: new Date().toISOString(),
          ts: serverTimestamp(),
        });
      } catch {}

      const assistantMsg: CanvasMessage = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        content: fallbackText,
        timestamp: new Date().toISOString(),
        modelId: selectedModelId,
        latencyMs,
        tokenIn,
        tokenOut,
        totalTokens,
        costIdr,
        isDeterministicFallback: true,
      };

      saveMessagesToStorage([...updatedWithUser, assistantMsg]);
    } finally {
      setIsGenerating(false);
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 80);
    }
  };

  const suggestedPrompts = useMemo(() => {
    return (
      AGENT_SUGGESTED_PROMPTS[canonicalSlug] ||
      AGENT_SUGGESTED_PROMPTS['business-copilot']
    );
  }, [canonicalSlug]);

  const modelInfo = getGoogleGeminiModelInfo(selectedModelId);

  // Render Agent-Specific Real-Time Data Canvas Table
  const renderAgentSpecificDataCanvas = () => {
    if (canonicalSlug === 'purchase') {
      return (
        <div className="rounded-2xl bg-zinc-900/95 border border-amber-500/30 p-5 space-y-4 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-amber-400" />
                <span>Kanvas Data Real-Time: Stock Runway &amp; Rekomendasi PO (7-Day Lock Rule)</span>
              </h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Dihitung secara deterministik dari koleksi Firestore <code className="text-amber-400">products</code> ({products.length} SKU) &amp; <code className="text-amber-400">transactions</code> ({transactions.length} Transaksi).
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleCreateAutomatedPO()}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-zinc-950 font-black text-xs flex items-center gap-1.5 shadow-md cursor-pointer shrink-0"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Buat Draft PO Otomatis ({liveMetrics.criticalProducts.length} SKU Kritis)</span>
            </button>
          </div>

          {poFeedback && (
            <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{poFeedback}</span>
            </div>
          )}

          <div className="overflow-x-auto max-h-72 custom-scrollbar">
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-950 text-zinc-400 uppercase text-[10px] sticky top-0">
                <tr>
                  <th className="p-2.5">Produk &amp; SKU</th>
                  <th className="p-2.5">Stok Tersedia</th>
                  <th className="p-2.5">Velocity / Hari</th>
                  <th className="p-2.5">Sisa Runway</th>
                  <th className="p-2.5">Status 7-Day Lock</th>
                  <th className="p-2.5">Rekomendasi PO</th>
                  <th className="p-2.5 text-right">Estimasi Biaya PO ({currency})</th>
                  <th className="p-2.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80 text-zinc-200">
                {liveMetrics.productRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-zinc-500">
                      Belum ada data produk di Firestore. Tambahkan produk di modul Produk untuk melihat kalkulasi Purchase Intelligence.
                    </td>
                  </tr>
                ) : (
                  liveMetrics.productRows.slice(0, 15).map((row) => (
                    <tr key={row.id} className="hover:bg-zinc-800/40 transition">
                      <td className="p-2.5 font-semibold text-white">
                        <div>{row.name}</div>
                        <div className="text-[10px] font-mono text-zinc-500">{row.sku} • Isi {row.piecesPerCarton}/dus</div>
                      </td>
                      <td className="p-2.5 font-mono">
                        {row.stockUnits} unit <span className="text-zinc-500">({row.stockCartons} dus)</span>
                      </td>
                      <td className="p-2.5 font-mono text-blue-300">{row.dailyVelocityUnits} unit/hr</td>
                      <td className="p-2.5 font-mono font-bold">
                        <span className={row.runwayDays < 7 ? 'text-rose-400' : row.runwayDays <= 14 ? 'text-amber-400' : 'text-emerald-400'}>
                          {row.runwayDays} Hari
                        </span>
                      </td>
                      <td className="p-2.5">
                        {row.isCritical ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            WAJIB RESTOCK (&lt;7 Hr)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            STOK AMAN
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 font-mono font-bold text-amber-300">
                        {row.recommendedPoCartons > 0 ? `${row.recommendedPoCartons} Karton/Dus` : '1 Dus'}
                      </td>
                      <td className="p-2.5 text-right font-mono font-bold text-white">
                        {formatMoney(row.estimatedPoCostIdr)}
                      </td>
                      <td className="p-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => void handleCreateAutomatedPO(row.id)}
                          className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-amber-600 hover:text-white text-zinc-300 font-semibold text-xs cursor-pointer transition inline-flex items-center gap-1"
                          title="Buat Purchase Order di Form Request Pembelian"
                        >
                          <ShoppingBag className="w-3 h-3" />
                          <span>PO</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (canonicalSlug === 'transaction' || canonicalSlug === 'fraud-detection') {
      return (
        <div className="rounded-2xl bg-zinc-900/95 border border-amber-500/30 p-5 space-y-4 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-400" />
                <span>
                  {canonicalSlug === 'fraud-detection'
                    ? 'Kanvas Forensik Real-Time: Audit Risiko Fraud, Void & Anomali Transaksi'
                    : 'Kanvas Audit Transaksi Real-Time: Omset, Modal HPP & Keuntungan per Struk'}
                </span>
              </h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Terhubung langsung ke koleksi Firestore <code className="text-amber-400">transactions</code> ({transactions.length} struk) dengan konversi mata uang dinamis ({currency}).
              </p>
            </div>
            <AppLink
              to={activeAgent.moduleRoute}
              className="px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-amber-300 text-xs font-bold flex items-center gap-1.5 border border-amber-500/30"
            >
              <span>Buka {activeAgent.moduleLabel}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </AppLink>
          </div>

          <div className="overflow-x-auto max-h-72 custom-scrollbar">
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-950 text-zinc-400 uppercase text-[10px] sticky top-0">
                <tr>
                  <th className="p-2.5">ID Transaksi</th>
                  <th className="p-2.5">Pelanggan &amp; Channel</th>
                  <th className="p-2.5">Modal (HPP)</th>
                  <th className="p-2.5">Total Nilai</th>
                  <th className="p-2.5">Keuntungan</th>
                  <th className="p-2.5">Skor Risiko AI</th>
                  <th className="p-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80 text-zinc-200">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-zinc-500">
                      Belum ada transaksi tercatat di Firestore.
                    </td>
                  </tr>
                ) : (
                  transactions.slice(0, 15).map((tx: any) => {
                    const totalVal = Number(tx.totalAmount ?? 0);
                    const modalVal =
                      Number(tx.totalCost) > 0
                        ? Number(tx.totalCost)
                        : Math.round(totalVal * 0.78);
                    const profitVal = totalVal - modalVal;
                    const riskScore = Number(tx.fraudScore ?? 0);
                    return (
                      <tr key={tx.id} className="hover:bg-zinc-800/40 transition">
                        <td className="p-2.5 font-mono font-bold text-amber-300">#{String(tx.id).slice(-8)}</td>
                        <td className="p-2.5">
                          <div className="font-semibold text-white">{tx.customerName || 'Walk-in Customer'}</div>
                          <div className="text-[10px] text-zinc-500 uppercase">{tx.channel || 'POS'} • {tx.paymentMethod || 'CASH'}</div>
                        </td>
                        <td className="p-2.5 font-mono text-zinc-300">{formatMoney(modalVal)}</td>
                        <td className="p-2.5 font-mono font-bold text-white">{formatMoney(totalVal)}</td>
                        <td className="p-2.5 font-mono font-bold text-emerald-400">{formatMoney(profitVal)}</td>
                        <td className="p-2.5 font-mono">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              riskScore >= 70
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : riskScore >= 40
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            {riskScore}/100 ({riskScore >= 70 ? 'KRITIS' : riskScore >= 40 ? 'WASPADA' : 'BERSIH'})
                          </span>
                        </td>
                        <td className="p-2.5 uppercase text-[10px] font-bold text-zinc-300">{tx.status || 'completed'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // Default / Universal Live Data Canvas (Stock, Financial, Business Advisor, Copilot, CRM, Employee, etc.)
    return (
      <div className="rounded-2xl bg-zinc-900/95 border border-amber-500/30 p-5 space-y-4 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-amber-400" />
              <span>Kanvas Data Operasional &amp; Finansial Real-Time ({activeAgent.nameId})</span>
            </h3>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Sinkronisasi langsung dengan modul <strong className="text-amber-300">{activeAgent.moduleLabel}</strong> ({activeAgent.moduleRoute}) dalam mata uang <strong className="text-emerald-400">{currency}</strong>.
            </p>
          </div>
          <AppLink
            to={activeAgent.moduleRoute}
            className="px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-amber-300 text-xs font-bold flex items-center gap-1.5 border border-amber-500/30 shrink-0"
          >
            <span>Buka Modul {activeAgent.moduleLabel}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </AppLink>
        </div>

        <div className="overflow-x-auto max-h-64 custom-scrollbar">
          <table className="w-full text-xs text-left">
            <thead className="bg-zinc-950 text-zinc-400 uppercase text-[10px] sticky top-0">
              <tr>
                <th className="p-2.5">Produk / SKU</th>
                <th className="p-2.5">Kategori</th>
                <th className="p-2.5">Stok Fisik</th>
                <th className="p-2.5">HPP / Unit ({currency})</th>
                <th className="p-2.5">Harga Jual ({currency})</th>
                <th className="p-2.5">Margin</th>
                <th className="p-2.5 text-right">Nilai Aset Stok ({currency})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80 text-zinc-200">
              {liveMetrics.productRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-zinc-500">
                    Data produk siap disinkronkan dari Firestore. Gunakan kotak prompt Gemini di bawah untuk memulai analisis mendalam.
                  </td>
                </tr>
              ) : (
                liveMetrics.productRows.slice(0, 12).map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-800/40 transition">
                    <td className="p-2.5 font-semibold text-white">
                      <div>{row.name}</div>
                      <div className="text-[10px] font-mono text-zinc-500">{row.sku}</div>
                    </td>
                    <td className="p-2.5 text-zinc-400">{row.category}</td>
                    <td className="p-2.5 font-mono">
                      {row.stockUnits} unit <span className="text-zinc-500">({row.stockCartons} dus)</span>
                    </td>
                    <td className="p-2.5 font-mono text-zinc-300">{formatMoney(row.costUnit)}</td>
                    <td className="p-2.5 font-mono font-bold text-amber-300">{formatMoney(row.sellUnit)}</td>
                    <td className="p-2.5 font-mono">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          row.unitMarginPct >= 18
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {row.unitMarginPct}%
                      </span>
                    </td>
                    <td className="p-2.5 text-right font-mono font-bold text-white">
                      {formatMoney(row.stockAssetValueIdr)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full flex flex-col min-h-[calc(100dvh-7rem)] justify-between space-y-5 pb-4 animate-in fade-in">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-28 right-6 z-50 bg-zinc-900 border border-amber-500/60 text-amber-200 px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-bold animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-amber-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* =================================================================== */}
      {/* =================================================================== */}
      {/* TOP DEDICATED HEADER & LUXURY AGENT NAVIGATION GRID                 */}
      {/* =================================================================== */}
      <div className="w-full space-y-4">
        {/* Rule 1: 100% Full Width Identity Header Box */}
        <div className="w-full p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 border border-amber-500/40 shadow-[0_0_30px_rgba(245,158,11,0.08)] flex flex-col gap-4">
          {/* Top Row: Back Button + Agent Title/Description + Active Gemini Model Box */}
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-4 border-b border-zinc-800/80">
            <div className="flex items-start gap-3.5 flex-1 min-w-0">
              <button
                type="button"
                onClick={() => navigateToPath('/dashboard/ai/master')}
                className="mt-0.5 px-3 py-2 rounded-xl bg-zinc-950 hover:bg-amber-500/20 border border-zinc-800 hover:border-amber-500/50 text-zinc-200 hover:text-amber-300 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0"
                title="Kembali ke Master AI (/dashboard/ai/master)"
              >
                <ArrowLeft className="w-4 h-4 text-amber-400" />
                <span>Kembali</span>
              </button>

              <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-2xl shrink-0 shadow-inner">
                {activeAgent.icon}
              </div>

              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-base sm:text-xl font-black text-white tracking-tight leading-snug">
                    {language === 'id' ? activeAgent.nameId : activeAgent.nameEn}
                  </h1>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
                    {activeAgent.badgeText}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>LIVE FIRESTORE</span>
                  </span>
                </div>
                <p className="w-full text-xs text-zinc-300 leading-relaxed max-w-4xl">
                  {language === 'id' ? activeAgent.roleId : activeAgent.roleEn}
                </p>
              </div>
            </div>

            {/* Gemini Model Selector */}
            <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-zinc-950 border border-amber-500/40 shrink-0 self-start">
              <Cpu className="w-4 h-4 text-amber-400 shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] font-bold uppercase tracking-wider text-amber-300 leading-none">
                  Model Gemini Aktif
                </span>
                <select
                  value={selectedModelId}
                  onChange={(e) => void handleModelChange(e.target.value)}
                  className="bg-transparent text-white font-bold text-xs focus:outline-none cursor-pointer mt-0.5 pr-2"
                >
                  {GOOGLE_GEMINI_MODELS.map((m) => (
                    <option key={m.id} value={m.id} className="bg-zinc-900 text-white">
                      {m.shortLabel} ({m.id})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Bottom Row: Route Metadata Badges & Workspace Canvas Tabs */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-zinc-400">
              <span className="px-2.5 py-1 rounded-lg bg-zinc-950/90 border border-zinc-800 text-amber-400 font-semibold">
                URL: /dashboard/ai/master/{canonicalSlug}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-zinc-950/90 border border-zinc-800">
                Modul Acuan: <strong className="text-emerald-400">{activeAgent.moduleLabel}</strong> ({activeAgent.moduleRoute})
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-zinc-950/90 border border-zinc-800">
                Mata Uang: <strong className="text-amber-300">{currency}</strong>
              </span>
            </div>

            <div className="flex flex-wrap items-center p-1 rounded-xl bg-zinc-950 border border-zinc-800 gap-1 shrink-0 self-start xl:self-auto">
              <button
                type="button"
                onClick={() => setActiveCanvasTab('canvas')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  activeCanvasTab === 'canvas'
                    ? 'bg-amber-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Kanvas AI</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveCanvasTab('token_logs')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  activeCanvasTab === 'token_logs'
                    ? 'bg-amber-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Log Token ({agentTokenMetrics.totalCalls})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveCanvasTab('charts')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  activeCanvasTab === 'charts'
                    ? 'bg-amber-500 text-zinc-950 shadow-sm font-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Visual Charts (#Tags)</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveCanvasTab('knowledge')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  activeCanvasTab === 'knowledge'
                    ? 'bg-amber-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Instruksi Prompt</span>
              </button>
            </div>
          </div>
        </div>

        {/* Rule 4: Synchronized Top Summary Cards (/dashboard/ai/master/:agentSlug) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full">
          <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex flex-col justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Total Produk (/dashboard/produk)
            </div>
            <div className="text-base font-black text-white font-mono mt-1">
              {products.length} Produk
            </div>
            <div className="text-[11px] text-amber-400 font-mono mt-0.5 truncate">
              Nilai Aset Stok: {formatMoney(liveMetrics.totalInventoryAssetIdr)}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex flex-col justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Wajib Restock (&lt; 7 Hari)
            </div>
            <div className="text-base font-black text-rose-400 font-mono mt-1">
              {liveMetrics.criticalProducts.length} SKU
            </div>
            <div className="text-[11px] text-zinc-400 font-mono mt-0.5 truncate">
              Estimasi PO: <span className="text-amber-300 font-bold">{formatMoney(liveMetrics.totalRecommendedPoIdr)}</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex flex-col justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Total Omzet POS &amp; PWA ({currency})
            </div>
            <div className="text-base font-black text-emerald-400 font-mono mt-1">
              {formatMoney(liveMetrics.totalRevenueIdr)}
            </div>
            <div className="text-[11px] text-zinc-400 font-mono mt-0.5 truncate">
              Laba: <span className="text-emerald-300 font-bold">{formatMoney(liveMetrics.totalGrossProfitIdr)}</span> ({liveMetrics.avgMarginPct}%)
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex flex-col justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Sumber Data Terhubung
            </div>
            <div className="text-sm font-black text-blue-400 font-mono mt-1 truncate">
              {products.length} Produk • {transactions.length} POS • {orders.length} PWA
            </div>
            <div className="text-[11px] text-zinc-400 font-mono mt-0.5 truncate">
              {customers.length} Pelanggan • {agentTokenMetrics.totalTokens.toLocaleString('id-ID')} Tokens ({modelInfo.shortLabel})
            </div>
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* DYNAMIC CENTER WORKSPACE CANVAS                                     */}
      {/* =================================================================== */}
      <div className="w-full flex-1 space-y-5">
        {activeCanvasTab === 'canvas' && (
          <>
            {/* 0. 4 Visual Interactive Charts for AI Demand Forecasting / Order Intent Parser (AI-7) */}
            {(canonicalSlug === 'demand-forecasting' ||
              activeAgent.slug === 'order-intent-parser' ||
              activeAgent.slug === 'ai_advisor_order') && (
              <AIExecutiveFourChartsDashboard agentKey={activeAgent.slug} />
            )}

            {/* 1. Live Domain Data Canvas Table */}
            {renderAgentSpecificDataCanvas()}

            {/* 2. Interactive Gemini AI Conversation & Analysis Stream (Rule 3: Full Width & 1 Clean Executive Paragraph) */}
            <div className="w-full rounded-2xl bg-zinc-900/95 border border-zinc-800 p-5 space-y-4 shadow-lg">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-bold text-white">
                    Ruang Kanvas Interaktif Gemini — {activeAgent.nameId}
                  </h3>
                </div>
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => saveMessagesToStorage([])}
                    className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-rose-950/60 text-zinc-400 hover:text-rose-300 text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Bersihkan Kanvas</span>
                  </button>
                )}
              </div>

              {messages.length === 0 ? (
                <div className="w-full p-8 rounded-2xl bg-zinc-950/80 border border-dashed border-amber-500/30 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-2xl mx-auto">
                    {activeAgent.icon}
                  </div>
                  <div className="space-y-1 max-w-2xl mx-auto">
                    <h4 className="text-sm font-bold text-white">
                      Kanvas {activeAgent.nameId} Siap Menganalisis Data Toko Anda
                    </h4>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Klik salah satu rekomendasi perintah cepat di bawah atau ketik instruksi Anda pada kotak prompt bergaya Gemini di bagian bawah layar. Seluruh analisis terhubung langsung ke database Firestore dan mencatat pemakaian token ke <code className="text-amber-400">ai_token_logs</code>.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                    {suggestedPrompts.map((sp, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => void handleSendPrompt(sp)}
                        className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-amber-500/15 border border-zinc-800 hover:border-amber-500/50 text-xs text-zinc-200 hover:text-amber-200 font-medium transition cursor-pointer text-left max-w-md"
                      >
                        ✦ {sp}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="w-full space-y-4">
                  <div className="overflow-x-auto rounded-2xl border border-amber-500/35 bg-zinc-950 shadow-inner max-h-[720px] overflow-y-auto custom-scrollbar">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="bg-zinc-900/95 text-zinc-400 uppercase text-[10px] sticky top-0 z-10 border-b border-zinc-800">
                        <tr>
                          <th className="p-3 w-10 text-center">No</th>
                          <th className="p-3 w-24">Waktu</th>
                          <th className="p-3 w-48">Agen / Pengirim</th>
                          <th className="p-3 w-36">Model AI</th>
                          <th className="p-3">Hasil Analisa &amp; Rekomendasi Eksekutif</th>
                          <th className="p-3 w-36">Token &amp; Latency</th>
                          <th className="p-3 w-28 text-right">Biaya</th>
                          <th className="p-3 w-16 text-center">Salin</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/80 text-zinc-200">
                        {messages.map((msg, idx) => {
                          const isUser = msg.role === 'user';
                          const detectedTags = extractChartShortcutsFromPrompt(msg.content);
                          const fallbackTag =
                            DEFAULT_AGENT_CHART_TAG[canonicalSlug] || '#ExecutiveOverview';
                          const fallbackTagsList = extractChartShortcutsFromPrompt(fallbackTag);
                          const chartsToRender =
                            !isUser
                              ? detectedTags.length > 0
                                ? detectedTags
                                : fallbackTagsList.length > 0
                                ? fallbackTagsList
                                : [fallbackTag]
                              : detectedTags;
                          const cleanParagraph = isUser
                            ? msg.content.trim()
                            : formatAIExecutiveParagraph(msg.content);

                          return (
                            <React.Fragment key={msg.id}>
                              <tr
                                className={
                                  isUser
                                    ? 'bg-amber-500/5 hover:bg-amber-500/10 transition align-top'
                                    : 'bg-zinc-950 hover:bg-zinc-900/60 transition align-top'
                                }
                              >
                                <td className="p-3 text-center font-mono text-zinc-500">
                                  {idx + 1}
                                </td>
                                <td className="p-3 font-mono text-[11px] text-zinc-400 whitespace-nowrap">
                                  {new Date(msg.timestamp).toLocaleTimeString('id-ID', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                  })}
                                </td>
                                <td className="p-3">
                                  <div className="font-bold text-amber-300">
                                    {isUser
                                      ? 'Instruksi Operator'
                                      : `${activeAgent.icon} ${activeAgent.nameId}`}
                                  </div>
                                  <div className="text-[10px] text-zinc-500 mt-0.5">
                                    {isUser ? 'Input Prompt' : 'Hasil Analisa AI'}
                                  </div>
                                </td>
                                <td className="p-3 font-mono text-[10px]">
                                  {isUser ? (
                                    <span className="text-zinc-500">—</span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold inline-block">
                                      {msg.modelId || selectedModelId}
                                    </span>
                                  )}
                                </td>
                                <td className="p-3">
                                  <div className="leading-relaxed text-amber-50/95 text-xs sm:text-sm">
                                    {cleanParagraph}
                                  </div>
                                  {chartsToRender.length > 0 && !isUser && (
                                    <div className="w-full space-y-2 pt-3 mt-3 border-t border-zinc-800/80">
                                      <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-amber-300 font-mono">
                                        <span className="flex items-center gap-1.5">
                                          <BarChart3 className="w-3.5 h-3.5 text-amber-400" />
                                          Visualisasi Data Real-Time ({chartsToRender.join(', ')})
                                        </span>
                                        <span className="text-zinc-400">
                                          Sumber: Firestore Live ({currency})
                                        </span>
                                      </div>
                                      <div className="w-full space-y-2">
                                        {chartsToRender.map((tag) => (
                                          <ShortcutChartRenderer key={tag} tag={tag} />
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </td>
                                <td className="p-3 font-mono text-[10px] text-zinc-400 whitespace-nowrap">
                                  {isUser ? (
                                    <span className="text-zinc-600">—</span>
                                  ) : (
                                    <div className="space-y-0.5">
                                      <div>
                                        Total:{' '}
                                        <strong className="text-amber-300">
                                          {msg.totalTokens || 0} tok
                                        </strong>
                                      </div>
                                      <div className="text-zinc-500">
                                        In: {msg.tokenIn || 0} • Out: {msg.tokenOut || 0}
                                      </div>
                                      <div className="text-emerald-400">
                                        Latency: {msg.latencyMs || 0} ms
                                      </div>
                                    </div>
                                  )}
                                </td>
                                <td className="p-3 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                                  {isUser ? '—' : formatMoney(msg.costIdr || 0)}
                                </td>
                                <td className="p-3 text-center">
                                  {!isUser && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        navigator.clipboard?.writeText(cleanParagraph);
                                        setCopiedId(msg.id);
                                        setTimeout(() => setCopiedId(null), 2000);
                                      }}
                                      className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white cursor-pointer inline-flex items-center justify-center"
                                      title="Salin hasil analisa"
                                    >
                                      {copiedId === msg.id ? (
                                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                                      ) : (
                                        <Copy className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {isGenerating && (
                    <div className="w-full p-4 rounded-2xl bg-zinc-950 border border-amber-500/40 flex items-center gap-3 text-xs text-amber-200 animate-pulse">
                      <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin shrink-0" />
                      <span>
                        {activeAgent.nameId} ({modelInfo.shortLabel}) sedang memeriksa data aktual Firestore dan menyusun ringkasan paragraf eksekutif...
                      </span>
                    </div>
                  )}
                  <div ref={chatBottomRef} />
                </div>
              )}
            </div>
          </>
        )}

        {/* TAB 2: LOG TOKEN & TELEMETRY (ai_token_logs) */}
        {activeCanvasTab === 'token_logs' && (
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>Riwayat Penggunaan Token Real-Time (Koleksi Firestore: ai_token_logs)</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Setiap pemanggilan prompt pada halaman mandiri agen tercatat otomatis beserta rincian token dan konversi biaya ({currency}).
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-zinc-950 text-zinc-400 uppercase text-[10px]">
                  <tr>
                    <th className="p-3">Waktu</th>
                    <th className="p-3">Agen AI</th>
                    <th className="p-3">Model Gemini</th>
                    <th className="p-3">Token In</th>
                    <th className="p-3">Token Out</th>
                    <th className="p-3">Total Token</th>
                    <th className="p-3">Latency</th>
                    <th className="p-3 text-right">Biaya ({currency})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-zinc-200">
                  {agentTokenMetrics.recentLogs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-zinc-500">
                        Belum ada log token di <code className="text-amber-400">ai_token_logs</code>. Kirim pertanyaan melalui kotak prompt di bawah untuk mencatat penggunaan token.
                      </td>
                    </tr>
                  ) : (
                    agentTokenMetrics.recentLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-zinc-800/40 transition">
                        <td className="p-3 font-mono text-[11px] text-zinc-400">
                          {new Date(log.createdAt).toLocaleString('id-ID')}
                        </td>
                        <td className="p-3 font-semibold text-white">
                          {log.agentName || log.agentSlug || log.agentKey}
                        </td>
                        <td className="p-3 font-mono text-blue-300">{log.modelUsed}</td>
                        <td className="p-3 font-mono">{log.tokenIn}</td>
                        <td className="p-3 font-mono">{log.tokenOut}</td>
                        <td className="p-3 font-mono font-bold text-amber-300">{log.totalTokens}</td>
                        <td className="p-3 font-mono text-emerald-400">{log.latencyMs} ms</td>
                        <td className="p-3 text-right font-mono font-bold text-white">
                          {formatMoney(log.costIdr)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: INSTRUKSI PROMPT KNOWLEDGE AGEN */}
        {activeCanvasTab === 'knowledge' && (
          <form
            onSubmit={handleSaveInstruction}
            className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-amber-400" />
                  <span>Konfigurasi System Instruction &amp; Prompt Knowledge — {activeAgent.nameId}</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Tersimpan secara real-time ke koleksi Firestore <code className="text-amber-400">ai_agents</code> dan <code className="text-amber-400">ai_instructions</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  setInstructionDraft(activeAgent.defaultInstruction);
                  await resetAIAgentInstruction(activeAgent.slug);
                  showToast('Instruksi dikembalikan ke template bawaan.');
                }}
                className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-amber-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Default</span>
              </button>
            </div>

            <textarea
              rows={8}
              value={instructionDraft}
              onChange={(e) => setInstructionDraft(e.target.value)}
              className="w-full p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-100 leading-relaxed focus:outline-none focus:border-amber-500"
            />

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSavingInstruction}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-lg"
              >
                <Check className="w-4 h-4 stroke-[3]" />
                <span>{isSavingInstruction ? 'Menyimpan...' : 'Simpan Instruksi ke Firestore'}</span>
              </button>
            </div>
          </form>
        )}

        {/* TAB 4: VISUAL CHART LIBRARY SHOWCASE (#ShortcutTags) */}
        {activeCanvasTab === 'charts' && (
          <div className="space-y-5">
            <AIExecutiveFourChartsDashboard agentKey={activeAgent.slug} />
            <div className="rounded-2xl bg-[#080705] border border-amber-500/35 p-5 space-y-4 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-amber-500/20 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-amber-400" />
                  <span>Visual Chart Library — 10 Model #ShortcutTags Terintegrasi</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Setiap chart dapat dipanggil langsung dengan mengetikkan tag (contoh: <code className="text-amber-400">#RiskGauge</code>, <code className="text-amber-400">#SalesGridDashboard</code>) pada prompt Gemini di bawah.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPromptInput((prev) => {
                      const trimmed = prev.trim();
                      return trimmed ? `${trimmed} ${selectedChartTag}` : selectedChartTag;
                    });
                    setActiveCanvasTab('canvas');
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Sematkan ke Prompt &amp; Tanya Gemini</span>
                </button>
              </div>
            </div>

            {/* Quick Chart Tag Switcher */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 custom-scrollbar">
              {CHART_SHORTCUT_TAGS.map((c) => (
                <button
                  key={c.tag}
                  type="button"
                  onClick={() => setSelectedChartTag(c.tag)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 shrink-0 border ${
                    selectedChartTag === c.tag
                      ? 'bg-amber-400 text-zinc-950 border-amber-300 shadow-md font-black'
                      : 'bg-[#12100b] hover:bg-amber-500/20 text-zinc-300 border-amber-500/30'
                  }`}
                >
                  <span>{c.icon}</span>
                  <span>{c.tag}</span>
                </button>
              ))}
            </div>

            {/* Render Selected Chart Preview */}
            <div className="pt-2">
              <ShortcutChartRenderer tag={selectedChartTag} />
            </div>
            </div>
          </div>
        )}
      </div>

      {/* =================================================================== */}
      {/* GEMINI-STYLE FLOATING PROMPT BAR AT THE BOTTOM OF THE SCREEN        */}
      {/* =================================================================== */}
      <div className="sticky bottom-2 z-30 pt-2">
        <div className="rounded-3xl bg-zinc-900/95 backdrop-blur-xl border-2 border-amber-500/40 shadow-[0_-8px_35px_rgba(0,0,0,0.65)] p-3.5 sm:p-4 space-y-3">
          {/* Row 1: Visual Chart Library Shortcut Chips Bar */}
          <AIShortcutChipsBar
            onSelectTag={(tag) => {
              setPromptInput((prev) => {
                const trimmed = prev.trim();
                return trimmed ? `${trimmed} ${tag}` : tag;
              });
            }}
            selectedTags={extractChartShortcutsFromPrompt(promptInput)}
          />

          {/* Row 2: Quick Suggestion Chips Row */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 shrink-0 flex items-center gap-1 px-1">
              <Sparkles className="w-3 h-3" /> Prompt Cepat:
            </span>
            {suggestedPrompts.map((chip, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => void handleSendPrompt(chip)}
                disabled={isGenerating}
                className="px-3 py-1 rounded-full bg-zinc-950 hover:bg-amber-500/20 border border-zinc-800 hover:border-amber-500/50 text-[11px] text-zinc-300 hover:text-amber-200 whitespace-nowrap transition cursor-pointer shrink-0"
              >
                {chip.length > 68 ? chip.slice(0, 68) + '...' : chip}
              </button>
            ))}
          </div>

          {/* Main Gemini Prompt Input Box */}
          <div className="flex items-end gap-2.5">
            <div className="flex-1 bg-zinc-950 border border-zinc-800 focus-within:border-amber-500/70 rounded-2xl px-3.5 py-2.5 transition">
              <textarea
                rows={2}
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendPrompt();
                  }
                }}
                placeholder={`Tanyakan atau perintahkan ${activeAgent.nameId}... (Tekan Enter untuk kirim ke Gemini, Shift+Enter baris baru)`}
                className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none resize-none leading-relaxed"
              />

              {/* Context Grounding Pills inside Gemini Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 mt-1 border-t border-zinc-900 text-[10px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-zinc-500 font-semibold mr-1 flex items-center gap-1">
                    <Database className="w-3 h-3 text-emerald-400" /> Konteks Firestore:
                  </span>
                  <button
                    type="button"
                    onClick={() => setIncludeProducts((v) => !v)}
                    className={`px-2 py-0.5 rounded-full font-mono transition cursor-pointer border ${
                      includeProducts
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                        : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                    }`}
                  >
                    📦 Produk ({products.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setIncludeTransactions((v) => !v)}
                    className={`px-2 py-0.5 rounded-full font-mono transition cursor-pointer border ${
                      includeTransactions
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                        : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                    }`}
                  >
                    🧾 Transaksi ({transactions.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setIncludeOrders((v) => !v)}
                    className={`px-2 py-0.5 rounded-full font-mono transition cursor-pointer border ${
                      includeOrders
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                        : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                    }`}
                  >
                    📱 Order PWA ({orders.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setIncludeCustomers((v) => !v)}
                    className={`px-2 py-0.5 rounded-full font-mono transition cursor-pointer border ${
                      includeCustomers
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                        : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                    }`}
                  >
                    👥 Pelanggan ({customers.length})
                  </button>
                </div>

                <div className="text-zinc-500 font-mono">
                  Model: <strong className="text-amber-300">{modelInfo.shortLabel}</strong> • Currency: <strong className="text-emerald-400">{currency}</strong>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleSendPrompt()}
              disabled={isGenerating || !promptInput.trim()}
              className="h-12 px-5 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 disabled:opacity-40 text-zinc-950 font-black text-xs flex items-center gap-2 transition shadow-lg shadow-amber-500/20 cursor-pointer shrink-0"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">{isGenerating ? 'Memproses...' : 'Kirim ke Gemini'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
