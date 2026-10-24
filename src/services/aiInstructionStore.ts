import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { getDefaultMinStock } from './posRuntime';

export type GoogleGeminiModelId =
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-flash-lite'
  | 'gemini-2.0-flash';

export interface GoogleGeminiModelOption {
  id: GoogleGeminiModelId;
  shortLabel: string;
  fullLabel: string;
  descriptionId: string;
  descriptionEn: string;
  badgeColor: string;
}

export const DEFAULT_GOOGLE_GEMINI_MODEL: GoogleGeminiModelId = 'gemini-2.5-flash';

export const GOOGLE_GEMINI_MODELS: GoogleGeminiModelOption[] = [
  {
    id: 'gemini-2.5-pro',
    shortLabel: 'Gemini 2.5 Pro',
    fullLabel:
      'gemini-2.5-pro — Google Gemini 2.5 Pro (Penalaran Mendalam, Analisis Strategi & Keuangan Kompleks)',
    descriptionId: 'Penalaran Mendalam, Analisis Strategi & Keuangan Kompleks',
    descriptionEn: 'Deep Reasoning, Complex Strategy & Financial Analysis',
    badgeColor: 'bg-purple-500/20 text-purple-200 border-purple-400/40',
  },
  {
    id: 'gemini-2.5-flash',
    shortLabel: 'Gemini 2.5 Flash',
    fullLabel:
      'gemini-2.5-flash — Google Gemini 2.5 Flash (Cepat, Akurat & Ideal untuk Operasional POS Real-time - Default)',
    descriptionId: 'Cepat, Akurat & Ideal untuk Operasional POS Real-time - Default',
    descriptionEn: 'Fast, Accurate & Ideal for Real-time POS Operations - Default',
    badgeColor: 'bg-blue-500/20 text-blue-200 border-blue-400/40',
  },
  {
    id: 'gemini-2.5-flash-lite',
    shortLabel: 'Gemini 2.5 Flash-Lite',
    fullLabel:
      'gemini-2.5-flash-lite — Google Gemini 2.5 Flash-Lite (Ekstra Cepat & Efisien untuk Cek Stok/Transaksi Harian)',
    descriptionId: 'Ekstra Cepat & Efisien untuk Cek Stok/Transaksi Harian',
    descriptionEn: 'Ultra-Fast & Efficient for Daily Stock/Transaction Checks',
    badgeColor: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40',
  },
  {
    id: 'gemini-2.0-flash',
    shortLabel: 'Gemini 2.0 Flash',
    fullLabel:
      'gemini-2.0-flash — Google Gemini 2.0 Flash (Stabil & Serbaguna untuk Multimodal/Tabel)',
    descriptionId: 'Stabil & Serbaguna untuk Multimodal/Tabel',
    descriptionEn: 'Stable & Versatile for Multimodal/Tables',
    badgeColor: 'bg-amber-500/20 text-amber-200 border-amber-400/40',
  },
];

export function getGoogleGeminiModelInfo(modelId?: string): GoogleGeminiModelOption {
  const found = GOOGLE_GEMINI_MODELS.find((m) => m.id === modelId);
  if (found) return found;
  return GOOGLE_GEMINI_MODELS[1]; // Default: gemini-2.5-flash
}

export interface AIAgentInstructionConfig {
  id: string;
  slug: string;
  nameId: string;
  nameEn: string;
  roleId: string;
  roleEn: string;
  icon: string;
  color: string;
  border: string;
  cardTheme?: string;
  customColorHex?: string;
  badgeText: string;
  moduleRoute: string;
  moduleLabel: string;
  masterRoute?: string;
  modelId: string;
  isActive?: boolean;
  defaultInstruction: string;
  customInstruction: string;
  globalRules?: string;
  syncStatusLabel?: string;
  connectedDataSources?: string;
  orderIndex?: number;
  sortOrder?: number;
  updatedAt: string;
}

const STORAGE_KEY = 'riskcart_ai_agent_instructions_v2';
const GLOBAL_MODEL_STORAGE_KEY = 'riskcart_global_ai_model_v1';
const DELETED_AGENTS_STORAGE_KEY = 'riskcart_deleted_ai_agents_v1';

export function getDeletedAgentIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DELETED_AGENTS_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export const GLOBAL_AI_STANDARD_RULES =
  '[Protected Server-Side Global Rules — Stored in ai_agents_private]';

export const DEFAULT_AI_AGENT_INSTRUCTIONS: AIAgentInstructionConfig[] = [
  {
    id: 'agent_purchase',
    slug: 'ai-advisor-purchase',
    nameId: 'AI 1 — Purchase Intelligence (7-Day Lead)',
    nameEn: 'AI 1 — Purchase Intelligence (7-Day Lead)',
    roleId:
      'Optimasi keputusan pembelian (PO) berdasarkan kecepatan penjualan harian/mingguan, sisa stok fisik, lead time supplier, dan aturan kunci 7 hari.',
    roleEn:
      'Optimize purchasing decisions based on sales velocity, available stock, supplier lead times, and 7-day stock coverage.',
    icon: '🛒',
    color: 'from-amber-600/20 to-orange-600/20',
    border: 'border-amber-500/30',
    badgeText: 'AI-1 • PURCHASE',
    moduleRoute: '/dashboard/pembelian',
    moduleLabel: 'Modul Pembelian & PO',
    modelId: 'gemini-2.5-pro',
    isActive: true,
    defaultInstruction: '[Protected Server-Side System Prompt — ai_agents_private/ai-advisor-purchase]',
    customInstruction: '',
    updatedAt: '2026-10-17T08:00:00.000Z',
  },
  {
    id: 'agent_3',
    slug: 'strategic-restock-advisor',
    nameId: 'AI 2 — Stock Intelligence & Restock Strategis',
    nameEn: 'AI 2 — Stock Intelligence & Strategic Restock',
    roleId:
      'Analisis pergerakan stok masuk/keluar, deteksi selisih stok opname yang tidak terjelaskan, serta optimasi nilai aset inventori.',
    roleEn:
      'Analyze inventory movements, compare system vs physical stock counts, and identify unexplained discrepancies.',
    icon: '📦',
    color: 'from-blue-600/20 to-cyan-600/20',
    border: 'border-blue-500/30',
    badgeText: 'AI-2 • STOCK',
    moduleRoute: '/dashboard/produk',
    moduleLabel: 'Modul Produk & Stok',
    modelId: 'gemini-2.5-flash',
    isActive: true,
    defaultInstruction: '[Protected Server-Side System Prompt — ai_agents_private/strategic-restock-advisor]',
    customInstruction: '',
    updatedAt: '2026-10-17T08:00:00.000Z',
  },
  {
    id: 'agent_7',
    slug: 'loss-prevention',
    nameId: 'AI 3 — Transaction & Loss Prevention AI',
    nameEn: 'AI 3 — Transaction Intelligence & Loss Prevention',
    roleId:
      'Verifikasi konsistensi setiap transaksi penjualan terhadap harga resmi produk, HPP/modal, keuntungan, diskon, dan potongan stok.',
    roleEn:
      'Analyze sales transactions and verify consistency with product pricing, HPP cost, gross profit, and inventory records.',
    icon: '🧾',
    color: 'from-emerald-600/20 to-teal-600/20',
    border: 'border-emerald-500/30',
    badgeText: 'AI-3 • TRANSACTION',
    moduleRoute: '/dashboard/transaksi',
    moduleLabel: 'Modul Transaksi & Kasir',
    modelId: 'gemini-2.5-flash',
    isActive: true,
    defaultInstruction: '[Protected Server-Side System Prompt — ai_agents_private/loss-prevention]',
    customInstruction: '',
    updatedAt: '2026-10-17T08:00:00.000Z',
  },
  {
    id: 'agent_1',
    slug: 'anti-fraud-sentinel',
    nameId: 'AI 4 — Fraud Detection & Anti-Fraud Sentinel',
    nameEn: 'AI 4 — Fraud Detection Sentinel AI',
    roleId:
      'Deteksi pola kecurangan operasional, pembatalan/void mencurigakan, manipulasi harga/diskon manual, dan anomali lokasi pesanan.',
    roleEn:
      'Identify potentially fraudulent behavior and suspicious operational patterns across sales, inventory, and staff activities.',
    icon: '🛡️',
    color: 'from-rose-600/20 to-red-600/20',
    border: 'border-rose-500/30',
    badgeText: 'AI-4 • ANTI-FRAUD',
    moduleRoute: '/dashboard/anti-fraud',
    moduleLabel: 'Modul Anti-Fraud & Audit',
    modelId: 'gemini-2.5-pro',
    isActive: true,
    defaultInstruction: '[Protected Server-Side System Prompt — ai_agents_private/anti-fraud-sentinel]',
    customInstruction: '',
    updatedAt: '2026-10-19T13:55:00.000Z',
  },
  {
    id: 'agent_5',
    slug: 'dynamic-pricing',
    nameId: 'AI 5 — Financial Intelligence & Margin Optimizer',
    nameEn: 'AI 5 — Financial Intelligence & Pricing Optimizer',
    roleId:
      'Analisis pendapatan, HPP, laba kotor, margin produk, modal kerja tertahan di stok, arus kas, piutang pelanggan, dan hutang supplier.',
    roleEn:
      'Analyze revenue, COGS, gross profit, profit margins, inventory asset value, receivables, payables, and cash flow health.',
    icon: '💰',
    color: 'from-purple-600/20 to-indigo-600/20',
    border: 'border-purple-500/30',
    badgeText: 'AI-5 • FINANCIAL',
    moduleRoute: '/dashboard/laporankas',
    moduleLabel: 'Laporan Kas & Aset Toko',
    modelId: 'gemini-2.5-pro',
    isActive: true,
    defaultInstruction: '[Protected Server-Side System Prompt — ai_agents_private/dynamic-pricing]',
    customInstruction: '',
    updatedAt: '2026-10-17T08:00:00.000Z',
  },
  {
    id: 'agent_9',
    slug: 'staff-kpi',
    nameId: 'AI 6 — Employee Intelligence & Staff KPI',
    nameEn: 'AI 6 — Employee Intelligence & Staff KPI',
    roleId:
      'Monitoring KPI karyawan secara objektif, produktivitas kasir, kepatuhan SOP shift, akurasi transaksi, dan rekomendasi coaching.',
    roleEn:
      'Monitor employee KPIs, sales productivity, transaction accuracy, shift compliance, and fair coaching recommendations.',
    icon: '👥',
    color: 'from-cyan-600/20 to-blue-600/20',
    border: 'border-cyan-500/30',
    badgeText: 'AI-6 • EMPLOYEE KPI',
    moduleRoute: '/dashboard/staff',
    moduleLabel: 'Modul Staff & Shift Kasir',
    modelId: 'gemini-2.5-flash',
    isActive: true,
    defaultInstruction: '[Protected Server-Side System Prompt — ai_agents_private/staff-kpi]',
    customInstruction: '',
    updatedAt: '2026-10-17T08:00:00.000Z',
  },
  {
    id: 'agent_2',
    slug: 'order-intent-parser',
    nameId: 'AI 7 — Demand Forecasting & Order Intent Parser',
    nameEn: 'AI 7 — Demand Forecasting & Order Parser',
    roleId:
      'Prediksi tren permintaan produk masa depan serta pemahaman pesanan pelanggan natural language & typo di Client PWA.',
    roleEn:
      'Estimate future product demand trends and parse natural-language or misspelled customer orders from Client PWA.',
    icon: '📈',
    color: 'from-indigo-600/20 to-violet-600/20',
    border: 'border-indigo-500/30',
    badgeText: 'AI-7 • FORECAST & ORDER',
    moduleRoute: '/dashboard/orders',
    moduleLabel: 'Modul Orders & Client PWA',
    modelId: 'gemini-2.5-flash',
    isActive: true,
    defaultInstruction: '[Protected Server-Side System Prompt — ai_agents_private/order-intent-parser]',
    customInstruction: '',
    updatedAt: '2026-10-17T08:00:00.000Z',
  },
  {
    id: 'agent_4',
    slug: 'business-copilot',
    nameId: 'AI 8 — Ask AI Business Copilot',
    nameEn: 'AI 8 — Ask AI Business Copilot',
    roleId:
      'Asisten kecerdasan bisnis bahasa alami untuk menjawab pertanyaan pemilik bisnis mengenai laba, risiko stok, kas, dan performa toko.',
    roleEn:
      'Natural-language AI assistant helping business owners understand store data, profit, stock risks, and actionable decisions.',
    icon: '🧠',
    color: 'from-fuchsia-600/20 to-purple-600/20',
    border: 'border-fuchsia-500/30',
    badgeText: 'AI-8 • BUSINESS COPILOT',
    moduleRoute: '/dashboard',
    moduleLabel: 'Dashboard Utama & Seluruh Modul',
    modelId: 'gemini-2.5-pro',
    isActive: true,
    defaultInstruction: '[Protected Server-Side System Prompt — ai_agents_private/business-copilot]',
    customInstruction: '',
    updatedAt: '2026-10-17T08:00:00.000Z',
  },
  {
    id: 'agent_6',
    slug: 'customer-retention',
    nameId: 'AI 9 — Customer Retention & Piutang CRM',
    nameEn: 'AI 9 — Customer Retention & Receivables AI',
    roleId:
      'Segmentasi RFM pelanggan grosir/eceran, deteksi risiko berhenti belanja (churn), serta pengawasan kolektibilitas piutang.',
    roleEn: 'RFM customer segmentation, churn detection, and customer receivables monitoring.',
    icon: '🤝',
    color: 'from-pink-600/20 to-rose-600/20',
    border: 'border-pink-500/30',
    badgeText: 'AI-9 • CRM & PIUTANG',
    moduleRoute: '/dashboard/pelanggan',
    moduleLabel: 'Modul Pelanggan & CRM',
    modelId: 'gemini-2.5-flash',
    isActive: true,
    defaultInstruction: '[Protected Server-Side System Prompt — ai_agents_private/customer-retention]',
    customInstruction: '',
    updatedAt: '2026-10-17T08:00:00.000Z',
  },
  {
    id: 'agent_8',
    slug: 'supplier-anomaly',
    nameId: 'AI 10 — Supplier Intelligence & Price Watchdog',
    nameEn: 'AI 10 — Supplier Intelligence & Price Anomaly AI',
    roleId:
      'Analisis kenaikan harga beli faktur supplier, ketepatan waktu pengiriman (lead time), dan riwayat pengadaan barang.',
    roleEn:
      'Analyze supplier purchase prices, lead times, delivery reliability, and invoice anomalies.',
    icon: '🚚',
    color: 'from-orange-600/20 to-amber-600/20',
    border: 'border-orange-500/30',
    badgeText: 'AI-10 • SUPPLIER INTEL',
    moduleRoute: '/dashboard/pembelian',
    moduleLabel: 'Modul Supplier & Pengadaan',
    modelId: 'gemini-2.5-flash',
    isActive: true,
    defaultInstruction: '[Protected Server-Side System Prompt — ai_agents_private/supplier-anomaly]',
    customInstruction: '',
    updatedAt: '2026-10-17T08:00:00.000Z',
  },
  {
    id: 'agent_10',
    slug: 'scanner-ai',
    nameId: 'AI 11 — Voice & Barcode Scanner AI',
    nameEn: 'AI 11 — Voice & Barcode Scanner AI',
    roleId:
      'Pemindaian barcode produk dan pengenalan perintah suara kasir untuk input transaksi POS dan cek stok cepat.',
    roleEn: 'Barcode recognition and voice-command parsing for rapid POS checkout and stock lookup.',
    icon: '🎙️',
    color: 'from-teal-600/20 to-emerald-600/20',
    border: 'border-teal-500/30',
    badgeText: 'AI-11 • VOICE & SCANNER',
    moduleRoute: '/pos',
    moduleLabel: 'Terminal Kasir POS',
    modelId: 'gemini-2.5-flash-lite',
    isActive: true,
    defaultInstruction: '[Protected Server-Side System Prompt — ai_agents_private/scanner-ai]',
    customInstruction: '',
    updatedAt: '2026-10-17T08:00:00.000Z',
  },
  {
    id: 'agent_business_advisor',
    slug: 'business-advisor',
    nameId: 'AI 12 — Business Advisor (Penasihat Strategi Bisnis)',
    nameEn: 'AI 12 — Business Advisor (Strategic Retail Advisor)',
    roleId:
      'Penasihat strategi bisnis menyeluruh untuk optimasi profitabilitas, ekspansi produk grosir/eceran, efisiensi modal kerja, dan mitigasi risiko operasional.',
    roleEn:
      'Comprehensive strategic business advisor for profitability optimization, wholesale/retail expansion, working capital efficiency, and risk mitigation.',
    icon: '🏆',
    color: 'from-amber-500/20 to-yellow-600/20',
    border: 'border-amber-500/40',
    badgeText: 'AI-12 • BUSINESS ADVISOR',
    moduleRoute: '/dashboard',
    moduleLabel: 'Executive Dashboard & Strategi',
    modelId: 'gemini-2.5-pro',
    isActive: true,
    defaultInstruction: '[Protected Server-Side System Prompt — ai_agents_private/business-advisor]',
    customInstruction: '',
    updatedAt: '2026-10-17T08:00:00.000Z',
  },
];

let memoryCache: AIAgentInstructionConfig[] | null = null;
let globalDefaultModelCache: string | null = null;
let firestoreListenerInitialized = false;

function normalizeGeminiModelId(rawModel?: string, fallbackModel?: string): string {
  if (!rawModel) return fallbackModel || DEFAULT_GOOGLE_GEMINI_MODEL;
  const trimmed = String(rawModel).trim();
  const validIds = new Set<string>(GOOGLE_GEMINI_MODELS.map((m) => m.id));
  if (validIds.has(trimmed)) return trimmed;
  if (trimmed.includes('pro')) return 'gemini-2.5-pro';
  if (trimmed.includes('lite')) return 'gemini-2.5-flash-lite';
  if (trimmed.includes('2.0')) return 'gemini-2.0-flash';
  return fallbackModel || DEFAULT_GOOGLE_GEMINI_MODEL;
}

export function loadGlobalDefaultAIModel(): string {
  initFirestoreAIAgentsSync();
  if (globalDefaultModelCache) return globalDefaultModelCache;
  try {
    const raw = localStorage.getItem(GLOBAL_MODEL_STORAGE_KEY);
    if (raw) {
      const normalized = normalizeGeminiModelId(raw, DEFAULT_GOOGLE_GEMINI_MODEL);
      globalDefaultModelCache = normalized;
      return normalized;
    }
  } catch {}
  globalDefaultModelCache = DEFAULT_GOOGLE_GEMINI_MODEL;
  return DEFAULT_GOOGLE_GEMINI_MODEL;
}

export async function saveGlobalDefaultAIModel(
  modelId: string,
  applyToAllAgents: boolean = true
): Promise<string> {
  const normalized = normalizeGeminiModelId(modelId, DEFAULT_GOOGLE_GEMINI_MODEL);
  globalDefaultModelCache = normalized;
  const nowIso = new Date().toISOString();

  try {
    localStorage.setItem(GLOBAL_MODEL_STORAGE_KEY, normalized);
  } catch {}

  if (applyToAllAgents) {
    const current = loadAIAgentInstructions();
    const updated = current.map((item) => ({
      ...item,
      modelId: normalized,
      updatedAt: nowIso,
    }));
    memoryCache = updated;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {}

    try {
      await Promise.all(
        updated.map((agent) =>
          Promise.all([
            setDoc(
              doc(db, 'ai_agents', agent.id),
              {
                id: agent.id,
                slug: agent.slug,
                model: normalized,
                modelId: normalized,
                updatedAt: nowIso,
              },
              { merge: true }
            ),
            setDoc(
              doc(db, 'ai_instructions', agent.slug),
              {
                id: agent.id,
                slug: agent.slug,
                model: normalized,
                modelId: normalized,
                updatedAt: nowIso,
              },
              { merge: true }
            ),
          ])
        )
      );
    } catch (err) {
      console.warn('[aiInstructionStore] Global model agent sync notice:', err);
    }
  }

  try {
    await Promise.all([
      setDoc(
        doc(db, 'ai_settings', 'global'),
        {
          defaultModelId: normalized,
          modelId: normalized,
          provider: 'Google Gemini (@google/genai)',
          updatedAt: nowIso,
        },
        { merge: true }
      ),
      setDoc(
        doc(db, 'settings', 'ai_model_config'),
        {
          defaultModelId: normalized,
          modelId: normalized,
          provider: 'Google Gemini (@google/genai)',
          updatedAt: nowIso,
        },
        { merge: true }
      ),
    ]);
  } catch (err) {
    console.warn('[aiInstructionStore] Global AI settings Firestore sync notice:', err);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('riskcart_ai_instructions_updated'));
  }

  return normalized;
}

function mergeWithDefaults(partialList: Partial<AIAgentInstructionConfig>[]): AIAgentInstructionConfig[] {
  const deletedIds = getDeletedAgentIds();
  const byKey = new Map<string, Partial<AIAgentInstructionConfig>>();
  partialList.forEach((item) => {
    if (item.slug) byKey.set(item.slug, item);
    if (item.id) byKey.set(item.id, item);
  });

  const mergedDefaults: AIAgentInstructionConfig[] = [];
  DEFAULT_AI_AGENT_INSTRUCTIONS.forEach((def, defIndex) => {
    if (deletedIds.has(def.id) || deletedIds.has(def.slug)) return;
    const found = byKey.get(def.slug) || byKey.get(def.id);
    if (!found) {
      mergedDefaults.push({
        ...def,
        orderIndex: typeof def.orderIndex === 'number' ? def.orderIndex : defIndex,
        sortOrder: typeof def.sortOrder === 'number' ? def.sortOrder : defIndex,
      });
      return;
    }
    const resolvedModelId = normalizeGeminiModelId(
      found.modelId || (found as any).model,
      def.modelId
    );
    const rawCustom =
      typeof found.customInstruction === 'string'
        ? found.customInstruction
        : typeof (found as any).systemPrompt === 'string' &&
          (found as any).systemPrompt !== def.defaultInstruction
        ? (found as any).systemPrompt
        : def.customInstruction;
    const isLegacyAi4Prompt =
      (def.id === 'agent_1' || def.slug === 'anti-fraud-sentinel') &&
      rawCustom.includes('[MODUL AI 4 — FRAUD DETECTION INTELLIGENCE]');

    mergedDefaults.push({
      ...def,
      nameId: found.nameId || def.nameId,
      nameEn: found.nameEn || found.nameId || def.nameEn,
      roleId: found.roleId || def.roleId,
      roleEn: found.roleEn || found.roleId || def.roleEn,
      icon: found.icon || def.icon,
      color: found.color || def.color,
      border: found.border || def.border,
      badgeText: found.badgeText || def.badgeText,
      moduleRoute: found.moduleRoute || def.moduleRoute,
      moduleLabel: found.moduleLabel || def.moduleLabel,
      modelId: resolvedModelId,
      isActive: found.isActive !== undefined ? found.isActive : def.isActive,
      customInstruction: isLegacyAi4Prompt ? '' : rawCustom,
      globalRules: found.globalRules || def.globalRules || GLOBAL_AI_STANDARD_RULES,
      syncStatusLabel: found.syncStatusLabel || def.syncStatusLabel || 'Firestore Synced',
      connectedDataSources:
        found.connectedDataSources || (found as any).connectedData || def.connectedDataSources,
      orderIndex: typeof found.orderIndex === 'number' ? found.orderIndex : defIndex,
      sortOrder: typeof found.sortOrder === 'number' ? found.sortOrder : defIndex,
      updatedAt: found.updatedAt || def.updatedAt,
    });
  });

  // Also include any custom user-created agents stored in Firestore/localStorage
  const defaultIds = new Set(DEFAULT_AI_AGENT_INSTRUCTIONS.map((d) => d.id));
  const defaultSlugs = new Set(DEFAULT_AI_AGENT_INSTRUCTIONS.map((d) => d.slug));
  const extras: AIAgentInstructionConfig[] = [];

  partialList.forEach((item, itemIdx) => {
    const id = item.id || item.slug || '';
    const slug = item.slug || item.id || '';
    if (
      id &&
      !defaultIds.has(id) &&
      !defaultSlugs.has(slug) &&
      !deletedIds.has(id) &&
      !deletedIds.has(slug) &&
      (item.nameId || (item as any).name)
    ) {
      const promptText =
        item.customInstruction ||
        item.defaultInstruction ||
        (item as any).systemPrompt ||
        'Agen AI Kustom RiskCart.';
      const resolvedModelId = normalizeGeminiModelId(
        item.modelId || (item as any).model,
        globalDefaultModelCache || DEFAULT_GOOGLE_GEMINI_MODEL
      );
      extras.push({
        id,
        slug,
        nameId: item.nameId || (item as any).name || 'AI Agent Baru',
        nameEn: item.nameEn || item.nameId || (item as any).name || 'New AI Agent',
        roleId: item.roleId || (item as any).role || 'Asisten analitik operasional khusus toko.',
        roleEn: item.roleEn || item.roleId || (item as any).role || 'Custom store operational AI assistant.',
        icon: item.icon || '🤖',
        color: item.color || 'from-blue-600/20 to-indigo-600/20',
        border: item.border || 'border-blue-500/30',
        badgeText: item.badgeText || 'AI CUSTOM',
        moduleRoute: item.moduleRoute || '/dashboard',
        moduleLabel: item.moduleLabel || 'Dashboard RiskCart',
        modelId: resolvedModelId,
        isActive: item.isActive !== false,
        defaultInstruction: item.defaultInstruction || promptText,
        customInstruction: item.customInstruction || promptText,
        globalRules: item.globalRules || GLOBAL_AI_STANDARD_RULES,
        syncStatusLabel: item.syncStatusLabel || 'Firestore Synced',
        connectedDataSources: item.connectedDataSources || (item as any).connectedData,
        orderIndex: typeof item.orderIndex === 'number' ? item.orderIndex : 50 + itemIdx,
        sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : 50 + itemIdx,
        updatedAt: item.updatedAt || new Date().toISOString(),
      });
    }
  });

  const combined = [...mergedDefaults, ...extras];
  combined.sort((a, b) => {
    const orderA = typeof a.orderIndex === 'number' ? a.orderIndex : 999;
    const orderB = typeof b.orderIndex === 'number' ? b.orderIndex : 999;
    return orderA - orderB;
  });
  return combined;
}

function initFirestoreAIAgentsSync() {
  if (firestoreListenerInitialized || typeof window === 'undefined') return;
  firestoreListenerInitialized = true;

  // 1. Listener for global AI settings (`ai_settings/global`)
  try {
    onSnapshot(
      doc(db, 'ai_settings', 'global'),
      (docSnap) => {
        if (!docSnap.exists()) return;
        const data = docSnap.data();
        const remoteModel = data?.defaultModelId || data?.modelId;
        if (remoteModel) {
          const normalized = normalizeGeminiModelId(remoteModel, DEFAULT_GOOGLE_GEMINI_MODEL);
          globalDefaultModelCache = normalized;
          try {
            localStorage.setItem(GLOBAL_MODEL_STORAGE_KEY, normalized);
          } catch {}
          window.dispatchEvent(new CustomEvent('riskcart_ai_instructions_updated'));
        }
      },
      () => {}
    );
  } catch {}

  // 2. Listener for deleted agents list (`ai_settings/deleted_agents`)
  try {
    onSnapshot(
      doc(db, 'ai_settings', 'deleted_agents'),
      (docSnap) => {
        if (!docSnap.exists()) return;
        const data = docSnap.data();
        if (Array.isArray(data?.ids)) {
          const currentDeleted = getDeletedAgentIds();
          data.ids.forEach((id: string) => currentDeleted.add(id));
          try {
            localStorage.setItem(
              DELETED_AGENTS_STORAGE_KEY,
              JSON.stringify(Array.from(currentDeleted))
            );
          } catch {}
          if (memoryCache) {
            memoryCache = memoryCache.filter(
              (a) => !currentDeleted.has(a.id) && !currentDeleted.has(a.slug)
            );
          }
          window.dispatchEvent(new CustomEvent('riskcart_ai_instructions_updated'));
        }
      },
      () => {}
    );
  } catch {}

  // 3. Listener for per-agent settings (`ai_agents`)
  try {
    onSnapshot(
      collection(db, 'ai_agents'),
      (snapshot) => {
        if (snapshot.empty) return;
        const deletedIds = getDeletedAgentIds();
        const remoteItems: Partial<AIAgentInstructionConfig>[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          const docId = d.id || docSnap.id;
          const docSlug = d.slug || docSnap.id;
          if (deletedIds.has(docId) || deletedIds.has(docSlug)) return;
          remoteItems.push({
            id: docId,
            slug: docSlug,
            nameId: d.nameId || d.name,
            nameEn: d.nameEn || d.name,
            roleId: d.roleId || d.description || d.role,
            roleEn: d.roleEn || d.description || d.role,
            icon: d.icon,
            color: d.color,
            border: d.border,
            badgeText: d.badgeText,
            moduleRoute: d.moduleRoute,
            moduleLabel: d.moduleLabel,
            modelId: d.modelId || d.model,
            isActive: d.status ? d.status === 'active' : d.isActive !== false,
            customInstruction:
              typeof d.customInstruction === 'string'
                ? d.customInstruction
                : typeof d.promptKnowledge === 'string'
                ? d.promptKnowledge
                : typeof d.systemPrompt === 'string'
                ? d.systemPrompt
                : '',
            globalRules: d.globalRules || d.systemRules,
            syncStatusLabel: d.syncStatusLabel,
            connectedDataSources: d.connectedDataSources || d.connectedData,
            orderIndex: typeof d.orderIndex === 'number' ? d.orderIndex : undefined,
            sortOrder: typeof d.sortOrder === 'number' ? d.sortOrder : undefined,
            updatedAt: d.updatedAt || new Date().toISOString(),
          });
        });

        // Merge with existing localStorage items so nothing is lost
        const currentLocal = loadFromLocalStorageOnly();
        const combinedMap = new Map<string, Partial<AIAgentInstructionConfig>>();
        currentLocal.forEach((c) => combinedMap.set(c.slug || c.id, c));
        remoteItems.forEach((r) => {
          const key = r.slug || r.id || '';
          if (!key) return;
          const prev = combinedMap.get(key) || {};
          combinedMap.set(key, { ...prev, ...r });
        });

        const merged = mergeWithDefaults(Array.from(combinedMap.values()));
        memoryCache = merged;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        } catch {}
        window.dispatchEvent(new CustomEvent('riskcart_ai_instructions_updated'));
      },
      (err) => {
        console.warn('[aiInstructionStore] Firestore listener fallback to local cache:', err);
      }
    );
  } catch (err) {
    console.warn('[aiInstructionStore] Failed to attach Firestore listener:', err);
  }
}

function loadFromLocalStorageOnly(): AIAgentInstructionConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return mergeWithDefaults([]);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return mergeWithDefaults([]);
    return mergeWithDefaults(parsed);
  } catch {
    return mergeWithDefaults([]);
  }
}

export function loadAIAgentInstructions(): AIAgentInstructionConfig[] {
  initFirestoreAIAgentsSync();
  if (memoryCache) return memoryCache;
  const loaded = loadFromLocalStorageOnly();
  memoryCache = loaded;
  return loaded;
}

export async function updateAIAgentsOrder(
  reorderedList: AIAgentInstructionConfig[]
): Promise<AIAgentInstructionConfig[]> {
  const updated = reorderedList.map((item, index) => ({
    ...item,
    orderIndex: index,
    sortOrder: index,
  }));
  memoryCache = updated;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('riskcart_ai_instructions_updated'));
  } catch {}

  try {
    await Promise.all(
      updated.map((agent, index) =>
        setDoc(
          doc(db, 'ai_agents', agent.id),
          { orderIndex: index, sortOrder: index, updatedAt: new Date().toISOString() },
          { merge: true }
        )
      )
    );
  } catch (err) {
    console.warn('[aiInstructionStore] updateAIAgentsOrder firestore notice:', err);
  }

  return updated;
}

export async function deleteAIAgentInStore(
  slugOrId: string
): Promise<AIAgentInstructionConfig[]> {
  const current = loadAIAgentInstructions();
  const target = current.find((a) => a.slug === slugOrId || a.id === slugOrId);
  const targetId = target?.id || slugOrId;
  const targetSlug = target?.slug || slugOrId;

  // Add to deleted IDs set
  const deletedSet = getDeletedAgentIds();
  deletedSet.add(targetId);
  deletedSet.add(targetSlug);
  try {
    localStorage.setItem(DELETED_AGENTS_STORAGE_KEY, JSON.stringify(Array.from(deletedSet)));
  } catch {}

  const updated = current.filter((a) => a.slug !== slugOrId && a.id !== slugOrId);
  memoryCache = updated;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('riskcart_ai_instructions_updated'));
  } catch {}

  try {
    await Promise.all([
      deleteDoc(doc(db, 'ai_agents', targetId)),
      deleteDoc(doc(db, 'ai_instructions', targetSlug)),
      setDoc(
        doc(db, 'ai_settings', 'deleted_agents'),
        { ids: Array.from(deletedSet), updatedAt: new Date().toISOString() },
        { merge: true }
      ),
    ]);
  } catch (err) {
    console.warn('[aiInstructionStore] deleteAIAgentInStore firestore notice:', err);
  }

  return updated;
}

export async function saveAIAgentInstruction(
  slugOrId: string,
  newInstruction: string,
  metadata?: {
    nameId?: string;
    roleId?: string;
    icon?: string;
    moduleRoute?: string;
    moduleLabel?: string;
    modelId?: string;
    isActive?: boolean;
    badgeText?: string;
    color?: string;
    border?: string;
    syncStatusLabel?: string;
    globalRules?: string;
    connectedDataSources?: string;
    newSlug?: string;
    orderIndex?: number;
  }
): Promise<AIAgentInstructionConfig[]> {
  const current = loadAIAgentInstructions();
  const nowIso = new Date().toISOString();
  const trimmedInstruction = newInstruction.trim();

  let targetAgent: AIAgentInstructionConfig | undefined;
  const oldSlug = slugOrId;

  const updated = current.map((item) => {
    if (item.slug === slugOrId || item.id === slugOrId) {
      const resolvedModelId = metadata?.modelId
        ? normalizeGeminiModelId(metadata.modelId, item.modelId)
        : item.modelId || loadGlobalDefaultAIModel();
      const nextSlug =
        metadata?.newSlug && metadata.newSlug.trim().length > 0
          ? metadata.newSlug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '')
          : item.slug;

      const nextItem: AIAgentInstructionConfig = {
        ...item,
        slug: nextSlug,
        nameId: metadata?.nameId?.trim() || item.nameId,
        nameEn: metadata?.nameId?.trim() || item.nameEn,
        roleId: metadata?.roleId?.trim() || item.roleId,
        roleEn: metadata?.roleId?.trim() || item.roleEn,
        icon: metadata?.icon || item.icon,
        moduleRoute: metadata?.moduleRoute || item.moduleRoute,
        moduleLabel: metadata?.moduleLabel || item.moduleLabel,
        modelId: resolvedModelId,
        isActive: metadata?.isActive !== undefined ? metadata.isActive : item.isActive,
        badgeText: metadata?.badgeText || item.badgeText,
        color: metadata?.color || item.color,
        border: metadata?.border || item.border,
        syncStatusLabel: metadata?.syncStatusLabel || item.syncStatusLabel || 'Firestore Synced',
        globalRules: metadata?.globalRules || item.globalRules || GLOBAL_AI_STANDARD_RULES,
        connectedDataSources:
          metadata?.connectedDataSources !== undefined
            ? metadata.connectedDataSources
            : item.connectedDataSources,
        orderIndex:
          typeof metadata?.orderIndex === 'number' ? metadata.orderIndex : item.orderIndex,
        customInstruction: trimmedInstruction,
        updatedAt: nowIso,
      };
      targetAgent = nextItem;
      return nextItem;
    }
    return item;
  });

  memoryCache = updated;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('riskcart_ai_instructions_updated'));
  } catch {}

  if (targetAgent) {
    const publicMetadataPayload = {
      id: targetAgent.id,
      slug: targetAgent.slug,
      name: targetAgent.nameId,
      nameId: targetAgent.nameId,
      nameEn: targetAgent.nameEn,
      role: targetAgent.roleId,
      description: targetAgent.roleId,
      roleId: targetAgent.roleId,
      roleEn: targetAgent.roleEn,
      icon: targetAgent.icon,
      color: targetAgent.color,
      border: targetAgent.border,
      badgeText: targetAgent.badgeText,
      moduleRoute: targetAgent.moduleRoute,
      moduleLabel: targetAgent.moduleLabel,
      model: targetAgent.modelId,
      modelId: targetAgent.modelId,
      provider: 'Google Gemini (@google/genai)',
      status: targetAgent.isActive !== false ? 'active' : 'standby',
      isActive: targetAgent.isActive !== false,
      syncStatusLabel: targetAgent.syncStatusLabel || 'Firestore Synced',
      connectedDataSources: targetAgent.connectedDataSources || '',
      orderIndex: typeof targetAgent.orderIndex === 'number' ? targetAgent.orderIndex : 0,
      sortOrder: typeof targetAgent.orderIndex === 'number' ? targetAgent.orderIndex : 0,
      updatedAt: nowIso,
    };

    try {
      const serverToken =
        typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('riskcart_server_token') : '';
      await fetch('/api/ai/agents/private', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(serverToken ? { Authorization: `Bearer ${serverToken}` } : {}),
        },
        body: JSON.stringify({
          id: targetAgent.id,
          slug: targetAgent.slug,
          oldSlug,
          customInstruction: trimmedInstruction,
          globalRules: metadata?.globalRules,
          modelId: targetAgent.modelId,
        }),
      }).catch(() => {});

      await setDoc(doc(db, 'ai_agents', targetAgent.id), publicMetadataPayload, { merge: true });
    } catch (err) {
      console.warn('[aiInstructionStore] Saved locally, Firestore sync notice:', err);
    }
  }

  return updated;
}

export async function createNewAIAgentInStore(params: {
  name: string;
  description: string;
  promptKnowledge: string;
  modelId?: string;
  icon?: string;
  badgeText?: string;
  moduleRoute?: string;
  moduleLabel?: string;
}): Promise<AIAgentInstructionConfig[]> {
  const current = loadAIAgentInstructions();
  const nowIso = new Date().toISOString();
  const id = `agent_${Date.now()}`;
  const slug =
    params.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || id;
  const resolvedModelId = normalizeGeminiModelId(params.modelId, loadGlobalDefaultAIModel());

  const newConfig: AIAgentInstructionConfig = {
    id,
    slug,
    nameId: params.name.trim(),
    nameEn: params.name.trim(),
    roleId: params.description.trim() || 'Asisten AI Kustom RiskCart terintegrasi database Firestore.',
    roleEn: params.description.trim() || 'Custom RiskCart AI Assistant integrated with Firestore.',
    icon: params.icon || '🤖',
    color: 'from-purple-600/20 to-indigo-600/20',
    border: 'border-purple-500/30',
    badgeText: params.badgeText || 'AI CUSTOM',
    moduleRoute: params.moduleRoute || '/dashboard',
    moduleLabel: params.moduleLabel || 'Dashboard & Ekosistem POS',
    modelId: resolvedModelId,
    isActive: true,
    defaultInstruction: params.promptKnowledge.trim(),
    customInstruction: params.promptKnowledge.trim(),
    updatedAt: nowIso,
  };

  const updated = [...current, newConfig];
  memoryCache = updated;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('riskcart_ai_instructions_updated'));
  } catch {}

  try {
    const payload = {
      ...newConfig,
      name: newConfig.nameId,
      role: newConfig.roleId,
      description: newConfig.roleId,
      model: newConfig.modelId,
      modelId: newConfig.modelId,
      provider: 'Google Gemini (@google/genai)',
      status: 'active',
      systemPrompt: newConfig.customInstruction,
      promptKnowledge: newConfig.customInstruction,
      instruction: newConfig.customInstruction,
      globalRules: GLOBAL_AI_STANDARD_RULES,
    };
    await Promise.all([
      setDoc(doc(db, 'ai_agents', id), payload, { merge: true }),
      setDoc(doc(db, 'ai_instructions', slug), payload, { merge: true }),
    ]);
  } catch (err) {
    console.warn('[aiInstructionStore] Custom agent saved locally, Firestore notice:', err);
  }

  return updated;
}

export async function resetAIAgentInstruction(slugOrId: string): Promise<AIAgentInstructionConfig[]> {
  return saveAIAgentInstruction(slugOrId, '');
}

export async function resetAllAIAgentInstructions(): Promise<AIAgentInstructionConfig[]> {
  memoryCache = DEFAULT_AI_AGENT_INSTRUCTIONS;
  globalDefaultModelCache = DEFAULT_GOOGLE_GEMINI_MODEL;
  try {
    localStorage.removeItem(DELETED_AGENTS_STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(GLOBAL_MODEL_STORAGE_KEY, DEFAULT_GOOGLE_GEMINI_MODEL);
    window.dispatchEvent(new CustomEvent('riskcart_ai_instructions_updated'));
  } catch {}

  try {
    await Promise.all([
      setDoc(
        doc(db, 'ai_settings', 'deleted_agents'),
        { ids: [], updatedAt: new Date().toISOString() },
        { merge: true }
      ),
      setDoc(
        doc(db, 'ai_settings', 'global'),
        {
          defaultModelId: DEFAULT_GOOGLE_GEMINI_MODEL,
          modelId: DEFAULT_GOOGLE_GEMINI_MODEL,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ),
      ...DEFAULT_AI_AGENT_INSTRUCTIONS.map((agent) =>
        setDoc(
          doc(db, 'ai_agents', agent.id),
          {
            id: agent.id,
            slug: agent.slug,
            name: agent.nameId,
            nameId: agent.nameId,
            role: agent.roleId,
            description: agent.roleId,
            roleId: agent.roleId,
            model: agent.modelId,
            modelId: agent.modelId,
            systemPrompt: agent.defaultInstruction,
            promptKnowledge: agent.defaultInstruction,
            customInstruction: '',
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        )
      ),
    ]);
  } catch {}

  return DEFAULT_AI_AGENT_INSTRUCTIONS;
}

const LEGACY_AGENT_KEY_MAP: Record<string, string> = {
  ai_advisor_purchase: 'ai-advisor-purchase',
  ai_advisor_order: 'order-intent-parser',
  ai_advisor_strategy: 'strategic-restock-advisor',
  tanya_ai: 'business-copilot',
  ai_preventif: 'loss-prevention',
  ai_fraud_transaction: 'anti-fraud-sentinel',
  purchase: 'ai-advisor-purchase',
  stock: 'strategic-restock-advisor',
  inventory: 'strategic-restock-advisor',
  transaction: 'loss-prevention',
  'fraud-detection': 'anti-fraud-sentinel',
  fraud: 'anti-fraud-sentinel',
  'anti-fraud': 'anti-fraud-sentinel',
  financial: 'dynamic-pricing',
  finance: 'dynamic-pricing',
  employee: 'staff-kpi',
  staff: 'staff-kpi',
  'demand-forecasting': 'order-intent-parser',
  forecast: 'order-intent-parser',
  'business-copilot': 'business-copilot',
  copilot: 'business-copilot',
  'business-advisor': 'business-advisor',
  'customer-retention': 'customer-retention',
  crm: 'customer-retention',
  supplier: 'supplier-anomaly',
  scanner: 'scanner-ai',
};

const CANONICAL_MASTER_SLUG_BY_AGENT: Record<string, string> = {
  'ai-advisor-purchase': 'purchase',
  agent_purchase: 'purchase',
  'strategic-restock-advisor': 'stock',
  agent_3: 'stock',
  'loss-prevention': 'transaction',
  agent_7: 'transaction',
  'anti-fraud-sentinel': 'fraud-detection',
  agent_1: 'fraud-detection',
  'dynamic-pricing': 'financial',
  agent_5: 'financial',
  'staff-kpi': 'employee',
  agent_9: 'employee',
  'order-intent-parser': 'demand-forecasting',
  agent_2: 'demand-forecasting',
  'business-copilot': 'business-copilot',
  agent_4: 'business-copilot',
  'business-advisor': 'business-advisor',
  agent_business_advisor: 'business-advisor',
  'customer-retention': 'customer-retention',
  agent_6: 'customer-retention',
  'supplier-anomaly': 'supplier',
  agent_8: 'supplier',
  'scanner-ai': 'scanner',
  agent_10: 'scanner',
};

/**
 * Returns the clean dedicated URL slug for `/dashboard/ai/master/:agentSlug`
 * e.g. "AI 1 — Purchase Intelligence (Advisor Pembelian)" -> "purchase"
 *      "Business Advisor" -> "business-advisor"
 *      "AI 2 — Stock Intelligence" -> "stock"
 */
export function getMasterAgentSlug(
  agentOrSlug:
    | { id?: string; slug?: string; name?: string; nameId?: string; nameEn?: string }
    | string
): string {
  if (typeof agentOrSlug === 'string') {
    const raw = agentOrSlug.trim().toLowerCase();
    if (CANONICAL_MASTER_SLUG_BY_AGENT[raw]) return CANONICAL_MASTER_SLUG_BY_AGENT[raw];
    const mapped = LEGACY_AGENT_KEY_MAP[raw];
    if (mapped && CANONICAL_MASTER_SLUG_BY_AGENT[mapped]) {
      return CANONICAL_MASTER_SLUG_BY_AGENT[mapped];
    }
    return raw.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'purchase';
  }

  const slugKey = String(agentOrSlug.slug || '').trim();
  const idKey = String(agentOrSlug.id || '').trim();
  if (slugKey && CANONICAL_MASTER_SLUG_BY_AGENT[slugKey]) {
    return CANONICAL_MASTER_SLUG_BY_AGENT[slugKey];
  }
  if (idKey && CANONICAL_MASTER_SLUG_BY_AGENT[idKey]) {
    return CANONICAL_MASTER_SLUG_BY_AGENT[idKey];
  }

  const title = String(agentOrSlug.nameId || agentOrSlug.name || agentOrSlug.nameEn || '').toLowerCase();
  if (title.includes('purchase') || title.includes('pembelian')) return 'purchase';
  if (title.includes('business advisor') || title.includes('penasihat strategi')) return 'business-advisor';
  if (title.includes('stock') || title.includes('stok') || title.includes('restock')) return 'stock';
  if (title.includes('transaction') || title.includes('transaksi') || title.includes('loss prevention')) return 'transaction';
  if (title.includes('fraud')) return 'fraud-detection';
  if (title.includes('financial') || title.includes('keuangan') || title.includes('margin') || title.includes('pricing')) return 'financial';
  if (title.includes('employee') || title.includes('staff') || title.includes('karyawan') || title.includes('kpi')) return 'employee';
  if (title.includes('demand') || title.includes('forecast') || title.includes('order intent')) return 'demand-forecasting';
  if (title.includes('copilot') || title.includes('tanya ai')) return 'business-copilot';
  if (title.includes('customer') || title.includes('pelanggan') || title.includes('retention') || title.includes('crm')) return 'customer-retention';
  if (title.includes('supplier') || title.includes('pemasok')) return 'supplier';
  if (title.includes('scanner') || title.includes('voice') || title.includes('barcode')) return 'scanner';

  const fallback = (slugKey || title || idKey || 'agent')
    .toLowerCase()
    .replace(/^ai[\s_-]*\d+[\s_—-]*/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return fallback || 'purchase';
}

export function findAgentInstructionConfig(slugOrId: string): AIAgentInstructionConfig | undefined {
  const cleanKey = String(slugOrId || '').trim().toLowerCase();
  const normalized = LEGACY_AGENT_KEY_MAP[cleanKey] || LEGACY_AGENT_KEY_MAP[slugOrId] || slugOrId;
  const list = loadAIAgentInstructions();
  return list.find(
    (a) =>
      a.slug === normalized ||
      a.id === normalized ||
      a.slug === slugOrId ||
      a.id === slugOrId ||
      getMasterAgentSlug(a) === cleanKey
  );
}

export function getActiveAgentInstruction(slugOrId: string): string {
  const found = findAgentInstructionConfig(slugOrId);
  if (!found) return GLOBAL_AI_STANDARD_RULES;
  const basePrompt =
    found.customInstruction && found.customInstruction.trim().length > 0
      ? found.customInstruction
      : found.defaultInstruction;
  return `${basePrompt}\n\n${GLOBAL_AI_STANDARD_RULES}`;
}

export function getActiveAgentModel(slugOrId?: string): string {
  if (slugOrId) {
    const found = findAgentInstructionConfig(slugOrId);
    if (found?.modelId) return found.modelId;
  }
  return loadGlobalDefaultAIModel();
}

/**
 * Cleans raw markdown symbols (###, **, *, -, numbered lists, fragmented line breaks)
 * and merges the entire AI explanation into 1 clean, cohesive executive paragraph
 * while preserving #ShortcutTags (#RiskGauge, #ExecutiveOverview, etc.).
 */
export function formatAIExecutiveParagraph(rawText: string): string {
  if (!rawText) return '';

  const lines = String(rawText)
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\r?\n/)
    .map((line) => {
      let cleaned = line
        // Strip markdown headers (#, ##, ###, etc. ONLY when followed by space, preserving #RiskGauge etc.)
        .replace(/^\s*#{1,6}\s+/g, '')
        // Strip blockquote markers
        .replace(/^\s*>\s*/g, '')
        // Strip bullet points and numbered list prefixes at start of line
        .replace(/^\s*(?:[-*•✦▸►+]|\d+\.|\([a-zA-Z0-9]+\))\s+/g, '')
        // Strip bold/italic/strikethrough/code markers
        .replace(/\*\*|__|~~|`/g, '')
        .replace(/(^|\s)\*([^\s*][^*]*?)\*(?=\s|[.,!?:;]|$)/g, '$1$2')
        .replace(/(^|\s)_([^\s_][^_]*?)_(?=\s|[.,!?:;]|$)/g, '$1$2')
        // Remove standalone horizontal rules
        .replace(/^\s*[-=_*]{3,}\s*$/g, '')
        .trim();

      if (!cleaned) return '';

      // Ensure each line fragment ends with proper punctuation before merging into 1 paragraph,
      // unless it ends with a #ShortcutTag
      if (!/[.!?:;]$/.test(cleaned) && !/#[A-Za-z0-9_]+$/.test(cleaned)) {
        cleaned += '.';
      }
      return cleaned;
    })
    .filter(Boolean);

  return lines
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.\s*\./g, '.')
    .replace(/:\s*\./g, ':')
    .replace(/(#[A-Za-z0-9_]+)\.$/g, '$1')
    .trim();
}

/**
 * Builds an authoritative JSON summary of real-time Firestore collections
 * (`products`, `transactions`, `orders`, `customers`, `procurements`)
 * to inject into Gemini AI prompts so the AI strictly references real store data.
 */
export function buildRealFirestoreContextJson(data: {
  products?: any[];
  transactions?: any[];
  orders?: any[];
  customers?: any[];
  procurements?: any[];
  shifts?: any[];
  audit_logs?: any[];
  auditLogs?: any[];
  product_logs?: any[];
  productLogs?: any[];
  brangkas_toko_logs?: any[];
  brangkasLogs?: any[];
  currency?: string;
  formatMoney?: (n: number) => string;
  [key: string]: any;
}): string {
  const products = Array.isArray(data.products) ? data.products : [];
  const transactions = Array.isArray(data.transactions) ? data.transactions : [];
  const orders = Array.isArray(data.orders) ? data.orders : [];
  const customers = Array.isArray(data.customers) ? data.customers : [];
  const procurements = Array.isArray(data.procurements) ? data.procurements : [];
  const shifts = Array.isArray(data.shifts) ? data.shifts : [];
  const auditLogs = Array.isArray(data.audit_logs)
    ? data.audit_logs
    : Array.isArray(data.auditLogs)
    ? data.auditLogs
    : [];
  const productLogs = Array.isArray(data.product_logs)
    ? data.product_logs
    : Array.isArray(data.productLogs)
    ? data.productLogs
    : [];

  const productList = products.slice(0, 50).map((p: any) => ({
    id: p.id,
    nama: p.name || 'Produk Tanpa Nama',
    sku: p.sku || '-',
    kategori: p.category || 'Umum',
    stok: Number(p.stock ?? p.stockUnits ?? p.stockInUnits ?? 0),
    minStok: Number(p.minStockAlert ?? p.minStock ?? getDefaultMinStock()),
    hargaModal: Number(p.costPrice ?? p.hargaModal ?? p.costPerUnit ?? 0),
    hargaJual: Number(p.posPrice ?? p.pricePerUnit ?? p.price ?? 0),
    supplier: p.supplierName || p.supplier || 'Supplier Umum',
  }));

  let totalOmzetPOS = 0;
  let totalProfitPOS = 0;
  const soldItemsSummary: Array<{ produk: string; qty: number; subtotal: number }> = [];
  const detailedTransactions = transactions.slice(0, 25).map((t: any) => {
    const amt = Number(t.totalAmount ?? t.total ?? 0);
    const cost = Number(t.totalCost ?? t.totalModal ?? 0);
    const discount = Number(t.discount ?? t.discountAmount ?? 0);
    const riskScore = Number(t.fraudScore ?? 0);
    return {
      idTransaksi: t.receiptNo || t.invoiceNumber || t.id,
      kasir: t.cashierName || t.staffName || t.operatorName || 'Kasir POS',
      pelanggan: t.customerName || 'Walk-in Customer',
      status: t.status || 'completed',
      metodeBayar: t.paymentMethod || 'cash',
      modalHPP: cost,
      totalNilai: amt,
      diskonManual: discount,
      keuntungan: amt - cost,
       dijualDiBawahHPP: cost > 0 && amt < cost,
      fraudScore: riskScore,
      kategoriRisiko: riskScore >= 70 ? 'KRITIS' : riskScore >= 40 ? 'WASPADAI' : 'BERSIH',
      fraudFlags: Array.isArray(t.fraudFlags) ? t.fraudFlags : [],
      waktu: t.createdAt || '-',
    };
  });

  transactions.forEach((t: any) => {
    const st = String(t.status || '').toLowerCase();
    if (st === 'void' || st === 'cancelled' || st === 'batal') return;
    const amt = Number(t.totalAmount ?? t.total ?? 0);
    const cost = Number(t.totalCost ?? t.totalModal ?? 0);
    const profit = Number(t.totalProfit ?? t.keuntungan ?? Math.max(0, amt - cost));
    totalOmzetPOS += amt;
    totalProfitPOS += profit;
    if (Array.isArray(t.items)) {
      t.items.forEach((it: any) => {
        soldItemsSummary.push({
          produk: String(it.productName || it.name || 'Item'),
          qty: Number(it.quantity ?? it.qty ?? it.quantityOrdered ?? 1),
          subtotal: Number(it.subtotal ?? it.total ?? it.price ?? 0),
        });
      });
    }
  });

  const totalNilaiOrderPWA = orders.reduce(
    (s: number, o: any) => s + Number(o.totalAmount ?? o.total ?? 0),
    0
  );

  const cartVoidEvidenceLogs = auditLogs
    .filter((a: any) => a?.type === 'CART_VOID_EVIDENCE')
    .slice(0, 20)
    .map((v: any) => ({
      id: v.id,
      tipe: v.type,
      statusPinOwner: v.status || 'CONFIRMED_BY_OWNER_PIN',
      namaKasir: v.staffName || 'Kasir POS',
      aksi: v.actionLabel || 'Pembatalan Keranjang',
      alasanPembatalan: v.reason || '-',
      totalNominalBatal: Number(v.totalNominal ?? 0),
      memilikiFotoBukti: Boolean(v.evidencePhoto || v.googleDrivePhotoUrl),
      googleDrivePhotoUrl: v.googleDrivePhotoUrl || '',
      googleDocUrl: v.googleDocUrl || '',
      itemDibatalkan: Array.isArray(v.cancelledItems)
        ? v.cancelledItems.map((ci: any) => `${ci.productName} (${ci.quantity}x)`)
        : [],
      waktu: v.createdAt || '-',
    }));

  const summaryPayload = {
    ringkasanDatabaseRealTime: {
      jumlahProduk: products.length,
      jumlahTransaksiTotal: transactions.length,
      totalOmzetPOS,
      totalProfitPOS,
      jumlahOrderPWA: orders.length,
      totalNilaiOrderPWA,
      jumlahPelanggan: customers.length,
      jumlahPurchaseOrderPO: procurements.length,
      jumlahBuktiVoidKeranjang: cartVoidEvidenceLogs.length,
      jumlahLogMutasiStok: productLogs.length,
      jumlahShiftKasir: shifts.length,
    },
    daftarProdukReal: productList,
    ringkasanTransaksiPOS: {
      jumlahTransaksi: transactions.length,
      totalOmzetPOS,
      totalProfitPOS,
      daftarTransaksiLengkap: detailedTransactions,
      daftarItemTerjual: soldItemsSummary.slice(0, 30),
    },
    ringkasanPesananPWA: {
      jumlahOrderPWA: orders.length,
      totalNilaiOrder: totalNilaiOrderPWA,
      daftarOrder: orders.slice(0, 20).map((o: any) => {
        const dist = Number(o.distanceToStoreMeters ?? o.distanceMeters ?? 0);
        const gpsAcc = Number(o.gpsAccuracy ?? 15);
        const isMockGps = Boolean(o.isMockGpsSuspected || gpsAcc === 0);
        return {
          id: o.orderNumber || o.id,
          pelanggan: o.customerName || 'Pelanggan PWA',
          statusOrder: o.status || o.fulfillmentStatus || 'New',
          total: Number(o.totalAmount ?? o.total ?? 0),
          radiusPengantaranMeter: dist,
          penaltiRadiusDiAtas3000m: dist > 3000,
          indikasiMockGps: isMockGps,
          fraudScore: Number(o.fraudScore ?? (isMockGps ? 85 : dist > 3000 ? 65 : 10)),
        };
      }),
    },
    buktiPembatalanKeranjangAuditLogs: cartVoidEvidenceLogs,
    mutasiStokProductLogs: productLogs.slice(0, 20).map((pl: any) => ({
      id: pl.id,
      tipe: pl.type || pl.action || 'STOCK_MOVEMENT',
      produk: pl.productName || pl.name || '-',
      qty: Number(pl.quantity ?? pl.qty ?? pl.delta ?? 0),
      petugas: pl.staffName || pl.actorName || pl.cashierName || '-',
      keterangan: pl.reason || pl.note || '-',
      waktu: pl.createdAt || '-',
    })),
    rekonsiliasiShiftKasir: shifts.slice(0, 10).map((sh: any) => ({
      idShift: sh.id,
      kasir: sh.cashierName || sh.staffName || 'Kasir',
      status: sh.status || '-',
      kasAwal: Number(sh.openingCash ?? sh.initialCash ?? 0),
      kasSistem: Number(sh.expectedClosingCash ?? sh.systemCash ?? 0),
      kasAktual: Number(sh.actualClosingCash ?? sh.closingCash ?? 0),
      selisihKas: Number(
        sh.cashDiscrepancy ??
          sh.variance ??
          Number(sh.actualClosingCash ?? 0) - Number(sh.expectedClosingCash ?? 0)
      ),
    })),
    ringkasanPembelianPO: procurements.slice(0, 15).map((po: any) => ({
      id: po.id,
      supplier: po.supplierName || po.supplier || '-',
      status: po.status || '-',
      total: Number(po.totalAmount ?? po.totalCost ?? 0),
    })),
    ringkasanPelanggan: customers.slice(0, 20).map((c: any) => ({
      id: c.id,
      nama: c.name || 'Pelanggan',
      piutang: Number(c.currentDebt ?? c.debt ?? 0),
      totalBelanja: Number(c.totalSpent ?? c.totalSpend ?? 0),
    })),
  };

  return JSON.stringify(summaryPayload, null, 2);
}
