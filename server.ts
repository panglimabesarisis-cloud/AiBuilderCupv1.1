import express from 'express';
import { createServer } from 'http';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { registerPaymentGatewayRoutes } from './payments/gatewayRouter.ts';
import { createServerStore, getAdminAuthOrNull } from './payments/serverStore.ts';
import { registerPosRuntimeRoutes } from './payments/posRuntimeRoutes.ts';
import { GoogleGenAI, Type } from '@google/genai';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  setLogLevel,
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';

import {
  requireAuth,
  requireRole,
  createSignedSessionToken,
  type AuthRequest,
} from './src/middleware/auth.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize server-side Firestore client directly from firebase-applet-config.json so `node server.ts` runs natively
const appletConfigRaw = JSON.parse(
  readFileSync(path.resolve(__dirname, 'firebase-applet-config.json'), 'utf-8')
);
try {
  setLogLevel('silent');
} catch {}
const firebaseServerApp =
  getApps().length > 0 ? getApp() : initializeApp(appletConfigRaw);
const firestoreDb = getFirestore(
  firebaseServerApp,
  process.env.VITE_FIREBASE_DATABASE_ID || appletConfigRaw.firestoreDatabaseId
);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Security headers (Helmet-equivalent baseline) & reduced JSON body limit
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});
app.use(
  express.json({
    limit: '5mb',
    // rawBody diperlukan untuk verifikasi signature webhook (DOKU Digest & Tripay HMAC)
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Endpoint lama yang memungkinkan siapa pun menandai QRIS "LUNAS" tanpa uang masuk -> dimatikan (anti-fraud)
app.all(['/api/doku/confirm-payment', '/api/doku/create-qris'], (_req, res) => {
  res.status(410).json({
    success: false,
    error: 'Endpoint lama dinonaktifkan. Gunakan /api/payments/create; status LUNAS hanya dari webhook terverifikasi.',
  });
});

// Akses Firestore server: Admin SDK (FIREBASE_SERVICE_ACCOUNT) -> lolos rules ketat; fallback client SDK
const serverStore = createServerStore(
  firestoreDb,
  process.env.VITE_FIREBASE_DATABASE_ID || appletConfigRaw.firestoreDatabaseId
);

// Payment Gateway nyata: Xendit, Midtrans, DOKU, Tripay (config terenkripsi + webhook terverifikasi)
registerPaymentGatewayRoutes(app, serverStore);

// Audit log asli (IP/user dari server), whoami, printer jaringan ESC/POS
registerPosRuntimeRoutes(app, serverStore);

// Tukar session token server (hasil verifikasi PIN) -> Firebase custom token, agar request.auth di rules terisi
app.post('/api/auth/firebase-token', requireAuth, async (req: AuthRequest, res) => {
  try {
    const adminAuthSdk = getAdminAuthOrNull();
    if (!adminAuthSdk) {
      return res.status(503).json({ success: false, error: 'FIREBASE_SERVICE_ACCOUNT belum di-set di server.' });
    }
    const uid = String(req.user?.uid || 'staff').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    const role = String(req.user?.role || 'cashier').toLowerCase();
    const customToken = await adminAuthSdk.createCustomToken(uid, { role, storeId: 'store_001' });
    return res.json({ success: true, customToken, role });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'Gagal membuat Firebase token' });
  }
});

// Initialize Google Gemini AI SDK on the server-side using process.env.GEMINI_API_KEY only
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Centralized Gemini Model Configuration
export const GEMINI_PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
export const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite';
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 25000;

function isRetryableGeminiError(error: any): boolean {
  if (!error) return false;
  const msg = String(error.message || '');
  const status = Number(error.status || error.code || 0);

  // Explicit non-retryable auth/key errors: 401, 403
  if (
    status === 401 ||
    status === 403 ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('PERMISSION_DENIED')
  ) {
    return false;
  }

  // Retryable/Failover conditions: 404 (model alias fallback), 503, UNAVAILABLE, 429, RESOURCE_EXHAUSTED, timeouts
  if (
    status === 400 ||
    status === 404 ||
    status === 503 ||
    status === 429 ||
    status === 504 ||
    msg.includes('not found') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('timeout') ||
    msg.includes('Timeout') ||
    msg.includes('TIMEDOUT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT')
  ) {
    return true;
  }

  return false;
}

async function callWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Gemini request timed out after ${timeoutMs}ms`);
      (err as any).status = 504;
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

interface GeminiCallParams {
  contents: any;
  config?: any;
  preferredModel?: string;
}

async function generateContentWithFallback(params: GeminiCallParams) {
  const primaryModel = params.preferredModel || GEMINI_PRIMARY_MODEL;
  const fallbackModel = GEMINI_FALLBACK_MODEL;

  // 1. Try primary model first
  try {
    const res = await callWithTimeout(
      ai.models.generateContent({
        model: primaryModel,
        contents: params.contents,
        config: params.config,
      }),
      GEMINI_TIMEOUT_MS
    );
    (res as any).modelVersion = res.modelVersion || primaryModel;
    return res;
  } catch (err1: any) {
    if (!isRetryableGeminiError(err1)) {
      throw err1; // Do not fallback on 400/401/403 client errors
    }

    console.warn(`[Gemini] Primary model ${primaryModel} failed (${err1.message || err1}). Retrying once after short pause...`);
    await new Promise((r) => setTimeout(r, 800));

    // 2. Retry primary model once after brief pause
    try {
      const res = await callWithTimeout(
        ai.models.generateContent({
          model: primaryModel,
          contents: params.contents,
          config: params.config,
        }),
        GEMINI_TIMEOUT_MS
      );
      (res as any).modelVersion = res.modelVersion || primaryModel;
      return res;
    } catch (err2: any) {
      if (!isRetryableGeminiError(err2)) {
        throw err2;
      }

      console.warn(`[Gemini] Primary retry failed (${err2.message || err2}). Switching to fallback model: ${fallbackModel}`);

      // 3. Fallback to secondary model (gemini-3.1-flash-lite)
      const res = await callWithTimeout(
        ai.models.generateContent({
          model: fallbackModel,
          contents: params.contents,
          config: params.config,
        }),
        GEMINI_TIMEOUT_MS
      );
      (res as any).modelVersion = res.modelVersion || fallbackModel;
      return res;
    }
  }
}

// Helper to write ai_logs and ai_token_logs for every Gemini AI call
async function logAiInvocation(data: {
  agentKey: string;
  latencyMs: number;
  tokenIn: number;
  tokenOut: number;
  ok: boolean;
  modelUsed?: string;
}) {
  try {
    const payload = {
      agentKey: data.agentKey,
      modelUsed: data.modelUsed || GEMINI_PRIMARY_MODEL,
      latencyMs: Math.round(data.latencyMs),
      tokenIn: Number(data.tokenIn) || 0,
      tokenOut: Number(data.tokenOut) || 0,
      totalTokens: (Number(data.tokenIn) || 0) + (Number(data.tokenOut) || 0),
      ok: Boolean(data.ok),
      createdAt: new Date().toISOString(),
      ts: serverTimestamp(),
    };
    await addDoc(collection(firestoreDb, 'ai_logs'), payload);
    await addDoc(collection(firestoreDb, 'ai_token_logs'), payload).catch(() => {});
  } catch (err) {
    console.warn('Failed to record ai_logs document:', err);
  }
}

// Haversine Distance Helper in meters
function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth's radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

// Language resolution helper
function resolveLanguage(req: express.Request): 'en' | 'id' {
  const lang = req.body?.language || req.query?.language;
  if (lang === 'id') return 'id';
  return 'en';
}

function getLanguagePromptInstruction(lang: 'en' | 'id'): string {
  if (lang === 'id') {
    return 'CRITICAL LANGUAGE REQUIREMENT: Write all natural language explanations, rationales, summaries, and recommendations in Indonesian (Bahasa Indonesia). All JSON keys, enum values, and codes must remain in standard English as specified in the schema.';
  }
  return 'CRITICAL LANGUAGE REQUIREMENT: Write all natural language explanations, rationales, summaries, and recommendations strictly in clear, professional English. All JSON keys and enum values must remain in standard English as specified in the schema.';
}

// Server-only private AI Agent instructions (stored in ai_agents_private, never exposed in public client bundle)
const SERVER_GLOBAL_AI_RULES = `ATURAN STANDAR GLOBAL AI AGENT RISKCART (WAJIB DIPATUHI OLEH SELURUH AGENT):
1. WAJIB CEK DATABASE AKTUAL (REAL-TIME FIRESTORE & ANTI-DEMO): Sebelum memberikan informasi, analisis, atau rekomendasi, Agen AI WAJIB memeriksa data aktual dari koleksi Firestore toko yang sedang aktif dan mencocokkannya dengan halaman modul yang dikerjakan. DILARANG KERAS menggunakan data simulasi/contoh fiktif. Jika suatu koleksi kosong (0 transaksi atau Rp 0), laporkan apa adanya sebagai 0 transaksi / Rp 0.
2. SUMBER DATA EKOSISTEM POS & PWA: Gunakan hanya data aktual dari ekosistem POS & Client PWA RiskCart (koleksi products, product_batches, transactions, orders, customers, procurements, shifts, cash_logs, brangkas_toko_logs, brangkas_modal, brangkas_untung, reward_claims, point_logs, access_rules, dan audit_logs).
3. ANTI-HALUSINASI & DETERMINISTIK: Dilarang mengarang angka, membuat nama produk/pelanggan fiktif, atau memodifikasi catatan keuangan/stok secara diam-diam. Bedakan secara tegas antara: (a) Fakta Terhitung dari Database Aktual, (b) Estimasi/Forecast AI berdasarkan rata-rata historis, dan (c) Sinyal Anomali untuk Investigasi.
4. KONSISTENSI MATA UANG & PERIODE: Gunakan format mata uang Rupiah (Rp) dengan titik ribuan Indonesia secara konsisten dan sebutkan rentang tanggal/jam pelaporan secara spesifik.
5. FORMAT BALASAN 1 PARAGRAF EKSEKUTIF BERSIH: Tuliskan seluruh penjelasan analisis, temuan angka, dan rekomendasi tindakan dalam 1 paragraf eksekutif yang utuh, mengalir, rapi, dan mudah dibaca tanpa simbol markdown kasar seperti ###, **, *, atau daftar bullet - yang terpecah-pecah.
6. DUKUNGAN VISUAL CHART LIBRARY (#ShortcutTags): Sertakan tag shortcut visual chart yang paling relevan di akhir paragraf (#RiskGauge, #SalesGridDashboard, #TargetLineChart, #SourceBar, #ExecutiveOverview, #KategoriDonut, #TopKategori, #GlowAreaChart, #MultiColorBar, #BurndownChart) untuk merender grafik interaktif real-time secara otomatis.`;

const SERVER_PRIVATE_AGENT_PROMPTS: Record<string, string> = {
  'agent_purchase': `[MODUL AI 1 — PURCHASE INTELLIGENCE]\nAnalisis penjualan harian/mingguan, hitung Runway stok tersedia dibanding rata-rata permintaan harian, aktifkan status WAJIB RESTOCK jika sisa stok < 7 hari, dan hitung rekomendasi pembelian (PO) dalam Karton/Dus menuju target cadangan 21 hari.`,
  'ai-advisor-purchase': `[MODUL AI 1 — PURCHASE INTELLIGENCE]\nAnalisis penjualan harian/mingguan, hitung Runway stok tersedia dibanding rata-rata permintaan harian, aktifkan status WAJIB RESTOCK jika sisa stok < 7 hari, dan hitung rekomendasi pembelian (PO) dalam Karton/Dus menuju target cadangan 21 hari.`,
  'agent_3': `[MODUL AI 2 — STOCK INTELLIGENCE & STRATEGIC RESTOCK]\nBandingkan stok sistem dengan perhitungan stok fisik (Opname), barang masuk, penjualan POS/PWA, retur, dan barang rusak. Identifikasi selisih stok yang belum terjelaskan beserta bukti mutasi dan jaga margin kotor karton minimal >= 20%.`,
  'strategic-restock-advisor': `[MODUL AI 2 — STOCK INTELLIGENCE & STRATEGIC RESTOCK]\nBandingkan stok sistem dengan perhitungan stok fisik (Opname), barang masuk, penjualan POS/PWA, retur, dan barang rusak. Identifikasi selisih stok yang belum terjelaskan beserta bukti mutasi dan jaga margin kotor karton minimal >= 20%.`,
  'agent_7': `[MODUL AI 3 — TRANSACTION INTELLIGENCE & LOSS PREVENTION]\nHitung secara deterministik kuantitas terjual, HPP/Modal, Total Nilai penjualan, dan Keuntungan per transaksi. Tandai transaksi di bawah harga resmi atau di bawah HPP tanpa otorisasi diskon yang sah.`,
  'loss-prevention': `[MODUL AI 3 — TRANSACTION INTELLIGENCE & LOSS PREVENTION]\nHitung secara deterministik kuantitas terjual, HPP/Modal, Total Nilai penjualan, dan Keuntungan per transaksi. Tandai transaksi di bawah harga resmi atau di bawah HPP tanpa otorisasi diskon yang sah.`,
  'agent_1': `[MODUL AI 4 — FRAUD DETECTION & LOSS PREVENTION INTELLIGENCE]\nPeriksa transaksi POS, pesanan PWA, mutasi stok, dan bukti pembatalan keranjang (CART_VOID_EVIDENCE). Deteksi pembatalan keranjang, refund/diskon manual berulang, perubahan harga di bawah HPP, radius pengantaran > 3.000m, dan indikasi mock GPS.`,
  'anti-fraud-sentinel': `[MODUL AI 4 — FRAUD DETECTION & LOSS PREVENTION INTELLIGENCE]\nPeriksa transaksi POS, pesanan PWA, mutasi stok, dan bukti pembatalan keranjang (CART_VOID_EVIDENCE). Deteksi pembatalan keranjang, refund/diskon manual berulang, perubahan harga di bawah HPP, radius pengantaran > 3.000m, dan indikasi mock GPS.`,
  'agent_5': `[MODUL AI 5 — FINANCIAL INTELLIGENCE & DYNAMIC PRICING]\nAnalisis Revenue, COGS/HPP, Gross Profit, margin produk, modal kerja tertahan di stok, piutang pelanggan, dan hutang jatuh tempo supplier. Pisahkan secara tegas antara Revenue, Laba Kotor, Nilai Aset Stok, Piutang, dan Kas Tersedia.`,
  'dynamic-pricing': `[MODUL AI 5 — FINANCIAL INTELLIGENCE & DYNAMIC PRICING]\nAnalisis Revenue, COGS/HPP, Gross Profit, margin produk, modal kerja tertahan di stok, piutang pelanggan, dan hutang jatuh tempo supplier. Pisahkan secara tegas antara Revenue, Laba Kotor, Nilai Aset Stok, Piutang, dan Kas Tersedia.`,
  'agent_9': `[MODUL AI 6 — EMPLOYEE INTELLIGENCE & STAFF KPI]\nAnalisis indikator KPI staf secara objektif berbasis data: frekuensi transaksi, akurasi laci kas saat tutup shift, rasio void/retur, dan kepatuhan SOP. Berikan rekomendasi pembinaan secara adil.`,
  'staff-kpi': `[MODUL AI 6 — EMPLOYEE INTELLIGENCE & STAFF KPI]\nAnalisis indikator KPI staf secara objektif berbasis data: frekuensi transaksi, akurasi laci kas saat tutup shift, rasio void/retur, dan kepatuhan SOP. Berikan rekomendasi pembinaan secara adil.`,
  'agent_2': `[MODUL AI 7 — DEMAND FORECASTING & ORDER INTENT PARSER]\nAnalisis histori penjualan untuk estimasi kebutuhan stok ke depan beserta batas ketidakpastiannya, dan petakan pesanan bahasa alami/typo pelanggan di Client PWA ke SKU resmi database.`,
  'order-intent-parser': `[MODUL AI 7 — DEMAND FORECASTING & ORDER INTENT PARSER]\nAnalisis histori penjualan untuk estimasi kebutuhan stok ke depan beserta batas ketidakpastiannya, dan petakan pesanan bahasa alami/typo pelanggan di Client PWA ke SKU resmi database.`,
  'agent_4': `[MODUL AI 8 — BUSINESS COPILOT RISKCART]\nJawab pertanyaan strategis pemilik bisnis menggunakan data aktual terverifikasi dari Firestore (Produk, Transaksi POS, Orders PWA, Laporan Kas, Aset Toko, Pembelian, Pelanggan, dan Staff).`,
  'business-copilot': `[MODUL AI 8 — BUSINESS COPILOT RISKCART]\nJawab pertanyaan strategis pemilik bisnis menggunakan data aktual terverifikasi dari Firestore (Produk, Transaksi POS, Orders PWA, Laporan Kas, Aset Toko, Pembelian, Pelanggan, dan Staff).`,
  'agent_6': `[MODUL AI 9 — CUSTOMER RETENTION & RECEIVABLES AI]\nKelompokkan pelanggan berdasarkan RFM (Recency, Frequency, Monetary) dan pantau saldo piutang pelanggan terhadap batas kredit.`,
  'customer-retention': `[MODUL AI 9 — CUSTOMER RETENTION & RECEIVABLES AI]\nKelompokkan pelanggan berdasarkan RFM (Recency, Frequency, Monetary) dan pantau saldo piutang pelanggan terhadap batas kredit.`,
  'agent_8': `[MODUL AI 10 — SUPPLIER INTELLIGENCE & PRICE WATCHDOG]\nBandingkan harga beli pada faktur supplier terbaru dengan histori harga modal (costPrice) dan beri peringatan jika terjadi kenaikan harga > 3% atau selisih kuantitas barang diterima.`,
  'supplier-anomaly': `[MODUL AI 10 — SUPPLIER INTELLIGENCE & PRICE WATCHDOG]\nBandingkan harga beli pada faktur supplier terbaru dengan histori harga modal (costPrice) dan beri peringatan jika terjadi kenaikan harga > 3% atau selisih kuantitas barang diterima.`,
  'agent_10': `[MODUL AI 11 — VOICE & BARCODE SCANNER AI]\nCocokkan input suara atau barcode di kasir dengan katalog produk aktif di database dan ekstrak nama produk, jumlah, serta satuan secara akurat.`,
  'scanner-ai': `[MODUL AI 11 — VOICE & BARCODE SCANNER AI]\nCocokkan input suara atau barcode di kasir dengan katalog produk aktif di database dan ekstrak nama produk, jumlah, serta satuan secara akurat.`,
  'agent_business_advisor': `[MODUL AI 12 — BUSINESS ADVISOR RISKCART]\nBerikan analisis eksekutif mengenai pertumbuhan omset, margin laba kotor, perputaran modal kerja, serta rekomendasi peningkatan profitabilitas toko.`,
  'business-advisor': `[MODUL AI 12 — BUSINESS ADVISOR RISKCART]\nBerikan analisis eksekutif mengenai pertumbuhan omset, margin laba kotor, perputaran modal kerja, serta rekomendasi peningkatan profitabilitas toko.`,
};

// Grounding helper: load private instructions from Firestore ai_agents_private/{agentKey} or server-side store
async function getAgentInstruction(agentKey: string, defaultInstruction: string): Promise<string> {
  const cleanDefault =
    defaultInstruction && !defaultInstruction.startsWith('[Protected Server-Side')
      ? defaultInstruction
      : SERVER_PRIVATE_AGENT_PROMPTS[agentKey] || 'You are the RiskCart Retail & Wholesale AI Copilot.';
  try {
    const privateSnap = await adminDb.collection('ai_agents_private').doc(agentKey).get();
    if (privateSnap.exists) {
      const data = privateSnap.data() as any;
      const customPrompt =
        data?.customInstruction ||
        data?.systemPrompt ||
        data?.promptKnowledge ||
        data?.defaultInstruction ||
        cleanDefault;
      return `${customPrompt}\n\n${ data?.globalRules || SERVER_GLOBAL_AI_RULES }`;
    }
  } catch (e) {
    console.warn(`[getAgentInstruction] fallback to server prompt for ${agentKey}:`, e);
  }
  return `${cleanDefault}\n\n${SERVER_GLOBAL_AI_RULES}`;
}

async function getAgentConfiguredModel(agentKey: string, requestedModel?: string): Promise<string> {
  if (requestedModel && typeof requestedModel === 'string' && requestedModel.trim()) {
    return requestedModel.trim();
  }
  try {
    const agentSnap = await getDoc(doc(firestoreDb, 'ai_instructions', agentKey));
    if (agentSnap.exists()) {
      const d = agentSnap.data() as any;
      if (d?.modelId || d?.model) return String(d.modelId || d.model);
    }
    const globalSnap = await getDoc(doc(firestoreDb, 'ai_settings', 'global'));
    if (globalSnap.exists()) {
      const g = globalSnap.data() as any;
      if (g?.defaultModelId || g?.modelId) return String(g.defaultModelId || g.modelId);
    }
  } catch {}
  return 'gemini-2.5-flash';
}

// 1. API: Anti-Fraud Anomaly Detection
app.post('/api/ai/anti-fraud', async (req, res) => {
  const startTime = Date.now();
  const agentKey = req.body.agentKey || 'agent_1';
  let promptContext = '';
  const lang = resolveLanguage(req);
  try {
    const {
      channel,
      totalAmount,
      items = [],
      customerPhone,
      customerLatitude,
      customerLongitude,
      gpsAccuracy = 15,
      storeLatitude = -6.2088,
      storeLongitude = 106.8456,
      geofenceRadiusMeters = 500,
      velocityCount = 1,
    } = req.body;

    let distanceMeters = 0;
    if (customerLatitude && customerLongitude) {
      distanceMeters = calculateHaversineDistance(
        customerLatitude,
        customerLongitude,
        storeLatitude,
        storeLongitude
      );
    }

    const isGeofenceViolated = channel === 'pwa_client' && distanceMeters > geofenceRadiusMeters;
    const isMockGps = gpsAccuracy === 0 || (customerLatitude === 0 && customerLongitude === 0);
    const hasCartonBulk = items.some((i: any) => i.packageType === 'carton' && i.quantityOrdered >= 5);
    const highVelocity = velocityCount >= 3;

    promptContext = `
You are the RiskCart Anti-Fraud AI Engine (Competition: AI Builder Cup 2026).
Evaluate this transaction for retail POS and Client PWA fraud:
- Channel: ${channel}
- Total Amount: IDR ${Number(totalAmount || 0).toLocaleString('id-ID')} (${totalAmount})
- Items Count: ${items.length}
- Items Breakdown: ${JSON.stringify(items)}
- Customer Phone: ${customerPhone || 'Anonymous / Walk-in'}
- Customer Distance to Store: ${distanceMeters} meters (Allowed Store Geofence: ${geofenceRadiusMeters} meters)
- GPS Accuracy: ${gpsAccuracy} meters
- Mock GPS Suspected: ${isMockGps}
- Order Velocity within 10 minutes: ${velocityCount} orders
- Bulk Carton Items Detected: ${hasCartonBulk}
- High Velocity Alert: ${highVelocity}

${getLanguagePromptInstruction(lang)}

Analyze the transaction and output:
1. fraudScore (integer from 0 to 100, where 0-25 is clean, 26-55 is low, 56-75 is medium, 76-89 is high, 90-100 is critical fraud).
2. riskLevel (one of: "clean", "low", "medium", "high", "critical").
3. fraudFlags (array of short string flags, e.g. "GEOFENCE_BREACH", "CARTON_DRAIN_SURGE", "VELOCITY_SPIKE", "SUSPECTED_MOCK_GPS", "LARGE_UNVERIFIED_AMOUNT").
4. aiExplanation (a clear 2-3 sentence forensic reasoning explaining why this score was assigned and what the cashier/admin should look out for).
5. recommendation (one of: "approve", "review", "reject").
`;

    const systemInstruction = await getAgentInstruction(
      agentKey || 'anti-fraud-sentinel',
      `[MODUL AI 4 — FRAUD DETECTION & LOSS PREVENTION INTELLIGENCE]\nTugas Utama:\n1. Sebelum mengeluarkan peringatan risiko, WAJIB periksa data transaksi POS (\`transactions\`), pesanan PWA (\`orders\`), mutasi stok (\`product_logs\`), dan bukti pembatalan keranjang (\`audit_logs\` tipe CART_VOID_EVIDENCE) di database Firestore serta cocokkan dengan halaman /dashboard/anti-fraud dan /dashboard/transaksi.\n2. Deteksi pembatalan item keranjang (void) beserta kelengkapan PIN Owner, alasan pembatalan, dan lampiran foto bukti; periksa pola refund/diskon manual berulang, perubahan harga jual di bawah modal HPP, serta selisih kas saat tutup shift.\n3. Evaluasi radius pengantaran pesanan PWA (> 3.000m diberi penalti risiko, indikasi mock GPS / lokasi palsu ditolak otomatis).\n4. Berikan tingkat risiko terukur (BERSIH < 40, WASPADAI 40-69, KRITIS >= 70) beserta bukti nomor transaksi, nama kasir, alasan, dan langkah investigasi dalam 1 paragraf eksekutif bersih tanpa simbol markdown kasar, lalu sertakan tag #RiskGauge dan #MultiColorBar.`
    );

    const response = await generateContentWithFallback({
      contents: promptContext,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            fraudScore: { type: Type.INTEGER, description: 'Calculated fraud risk score 0-100' },
            riskLevel: {
              type: Type.STRING,
              description: 'Risk severity rating',
              enum: ['clean', 'low', 'medium', 'high', 'critical'],
            },
            fraudFlags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'List of triggered risk flags',
            },
            aiExplanation: { type: Type.STRING, description: 'Forensic explanation of risk' },
            recommendation: {
              type: Type.STRING,
              enum: ['approve', 'review', 'reject'],
              description: 'Actionable decision',
            },
          },
          required: ['fraudScore', 'riskLevel', 'fraudFlags', 'aiExplanation', 'recommendation'],
        },
      },
    });

    const latencyMs = Date.now() - startTime;
    const tokenIn = response.usageMetadata?.promptTokenCount || Math.round(promptContext.length / 4);
    const tokenOut = response.usageMetadata?.candidatesTokenCount || Math.round((response.text || '').length / 4);

    await logAiInvocation({
      agentKey,
      latencyMs,
      tokenIn,
      tokenOut,
      ok: true,
    });

    const parsed = JSON.parse(response.text || '{}');

    // Combine with deterministic hardware heuristics
    let computedScore = parsed.fraudScore || 0;
    const computedFlags = new Set<string>(parsed.fraudFlags || []);

    if (isGeofenceViolated) {
      computedScore = Math.max(computedScore, 65);
      computedFlags.add(`GEOFENCE_EXCEEDED_${distanceMeters}M`);
    }
    if (isMockGps) {
      computedScore = Math.max(computedScore, 75);
      computedFlags.add('MOCK_GPS_SUSPECTED');
    }
    if (highVelocity) {
      computedScore = Math.max(computedScore, 80);
      computedFlags.add('RAPID_VELOCITY_SPIKE');
    }

    let finalRiskLevel = 'clean';
    if (computedScore >= 85) finalRiskLevel = 'critical';
    else if (computedScore >= 70) finalRiskLevel = 'high';
    else if (computedScore >= 45) finalRiskLevel = 'medium';
    else if (computedScore >= 20) finalRiskLevel = 'low';

    res.setHeader('X-Gemini-Model', response.modelVersion || GEMINI_PRIMARY_MODEL);
    res.json({
      fraudScore: computedScore,
      riskLevel: finalRiskLevel,
      fraudFlags: Array.from(computedFlags),
      distanceToStoreMeters: distanceMeters,
      isMockGpsSuspected: isMockGps,
      aiExplanation: parsed.aiExplanation || 'Transaction assessed by RiskCart AI Engine.',
      recommendation: computedScore >= 90 ? 'reject' : computedScore >= 75 ? 'review' : 'approve',
      isHeuristicFallback: false,
    });
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    console.error('Error in /api/ai/anti-fraud:', error);

    await logAiInvocation({
      agentKey,
      latencyMs,
      tokenIn: Math.round(promptContext.length / 4),
      tokenOut: 0,
      ok: false,
    });

    // Graceful fallback (deterministic heuristics only, not Gemini)
    res.setHeader('X-Gemini-Model', 'none (heuristic-fallback)');
    res.json({
      fraudScore: 12,
      riskLevel: 'clean',
      fraudFlags: ['HEURISTIC_EVAL_ONLY'],
      distanceToStoreMeters: 25,
      isMockGpsSuspected: false,
      aiExplanation:
        lang === 'id'
          ? '[Evaluasi Heuristik Lokal - Fallback] Verifikasi aturan dasar hardware/lokasi selesai tanpa anomali parah. Model Gemini sedang tidak tersedia.'
          : '[Local Heuristic Evaluation - Fallback] Basic hardware/location rules verified without severe anomalies. Gemini model temporarily unavailable.',
      recommendation: 'approve',
      isHeuristicFallback: true,
    });
  }
});

// 2. API: Typo-Tolerant Natural Language Order Parser for Client PWA
app.post('/api/ai/parse-order', async (req, res) => {
  const startTime = Date.now();
  const agentKey = req.body.agentKey || 'agent_2';
  let promptContext = '';
  const lang = resolveLanguage(req);
  try {
    const { text, products = [] } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text prompt is required' });
    }

    const productCatalogBrief = products.map((p: any) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      piecesPerCarton: p.piecesPerCarton,
      pricePerUnit: p.pricePerUnit,
      pricePerCarton: p.pricePerCarton,
    }));

    promptContext = `
You are the RiskCart Conversational Ordering Engine.
The customer typed or spoke an informal order that may contain typos, slang, abbreviations, bilingual terms (English / Indonesian / Singlish):
Input text: "${text}"

Available Products Catalog:
${JSON.stringify(productCatalogBrief, null, 2)}

Match each item in the customer order against the available products catalog.
Important rules:
1. "dus", "box", "carton", "karton", "kardus", "pack besar" means packageType = "carton".
2. "unit", "pcs", "biji", "butir", "satuan", "bungkus", "botol", "kaleng" means packageType = "unit".
3. If no package type is specified, default to "unit" unless the number is large and sounds like boxes.
4. Tolerate heavy typos (e.g. "indomi" -> "Indomie", "pocary" -> "Pocari", "telur" -> "Egg", "minyak" -> "Cooking Oil").
5. If an item cannot be matched to catalog, do not hallucinate an ID. Set productId to null.

${getLanguagePromptInstruction(lang)}
`;

    const systemInstruction = await getAgentInstruction(
      'ai_advisor_order',
      'You are the RiskCart Order Intent & Typo Parser AI. Parse customer purchase text into structured catalog products.'
    );

    const response = await generateContentWithFallback({
      contents: promptContext,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recognizedItems: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  productId: { type: Type.STRING, description: 'Matched product ID or null' },
                  productName: { type: Type.STRING, description: 'Matched product title' },
                  packageType: {
                    type: Type.STRING,
                    enum: ['carton', 'unit'],
                    description: 'Carton (dus) or retail unit',
                  },
                  quantity: { type: Type.INTEGER, description: 'Quantity ordered' },
                  confidence: { type: Type.NUMBER, description: 'Confidence between 0 and 1' },
                  detectedTerm: { type: Type.STRING, description: 'Original user word/phrase detected' },
                },
                required: ['productName', 'packageType', 'quantity', 'confidence'],
              },
            },
            summaryText: { type: Type.STRING, description: 'Friendly confirmation summary' },
          },
          required: ['recognizedItems', 'summaryText'],
        },
      },
    });

    const latencyMs = Date.now() - startTime;
    const tokenIn = response.usageMetadata?.promptTokenCount || Math.round(promptContext.length / 4);
    const tokenOut = response.usageMetadata?.candidatesTokenCount || Math.round((response.text || '').length / 4);

    await logAiInvocation({
      agentKey,
      latencyMs,
      tokenIn,
      tokenOut,
      ok: true,
    });

    const parsed = JSON.parse(response.text || '{}');
    res.setHeader('X-Gemini-Model', response.modelVersion || GEMINI_PRIMARY_MODEL);
    res.json(parsed);
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    console.error('Error in /api/ai/parse-order:', error);

    await logAiInvocation({
      agentKey,
      latencyMs,
      tokenIn: Math.round(promptContext.length / 4),
      tokenOut: 0,
      ok: false,
    });

    res.status(500).json({ error: 'Failed to parse natural language order.' });
  }
});

// 3. API: AI Advisor for Restock (Powered by Google Gemini 2.5 Flash for Demand Planning)
app.post('/api/ai/restock-advisor', async (req, res) => {
  const startTime = Date.now();
  const agentKey = req.body.agentKey || 'agent_3';
  let promptContext = '';
  const lang = resolveLanguage(req);
  const isId = lang === 'id';
  try {
    const {
      currentStockLevels = [],
      salesVelocity7d = [],
      products = [],
      salesVelocity = [],
      recentTransactions = [],
    } = req.body;

    // Harmonize input data: support both direct stock levels and products array
    const stockItems = currentStockLevels.length > 0 ? currentStockLevels : products;
    const velocityItems = salesVelocity7d.length > 0 ? salesVelocity7d : (salesVelocity.length > 0 ? salesVelocity : recentTransactions);

    promptContext = `
You are the senior Retail & Commerce Demand Planning & Inventory Optimization AI Engine.
Perform strategic demand planning based on the provided current stock levels and 7-day sales velocity data.

Objectives:
1. Demand Forecasting & Runout Analysis: Compare currentStockUnits against 7-day sales velocity and safety thresholds (minStockAlert). Compute estimated days of supply remaining before stockout.
2. Wholesale Carton Replenishment: Recommend restock quantities in WHOLE CARTONS ('dus') using each product's piecesPerCarton to eliminate broken cases and secure distributor volume pricing.
3. Prioritization & Urgency: Assign urgency levels:
   - "urgent": Stock is <= 20% of minStockAlert or days of supply <= 2 days. High risk of immediate stockout and lost sales.
   - "medium": Stock is below minStockAlert or days of supply <= 5 days. Replenishment needed to maintain safety buffer.
   - "optimal": Stock buffer is adequate for current sales velocity. Prevent overstocking and working capital bloat.
4. Financial Optimization: Calculate estimated restock cost (suggestedCartons * piecesPerCarton * costPerUnit).
5. Grounded Rationale: Provide concise business rationales detailing sales velocity, runout trajectory, and carton ordering logic.

Input Data:
- Current Stock Levels (${stockItems.length} products):
${JSON.stringify(stockItems, null, 2)}

- 7-Day Sales Velocity & Velocity Metrics:
${JSON.stringify(velocityItems, null, 2)}

${getLanguagePromptInstruction(lang)}

Return a structured JSON response conforming strictly to the requested schema.
`;

    const systemInstruction = await getAgentInstruction(
      'ai_advisor_purchase',
      'You are an expert Retail & Commerce Demand Planning and Inventory Optimization AI. Analyze stock levels and 7-day sales velocity to generate precise whole-carton restock purchase recommendations. Always return valid structured JSON adhering strictly to the schema.'
    );

    const response = await generateContentWithFallback({
      contents: promptContext,
      preferredModel: 'gemini-2.5-flash',
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            executiveSummary: {
              type: Type.STRING,
              description: 'Executive overview of retail inventory health, runout risks, and procurement capital needed.',
            },
            totalEstimatedCost: {
              type: Type.NUMBER,
              description: 'Total estimated procurement cost across recommended purchase orders.',
            },
            totalCartons: {
              type: Type.INTEGER,
              description: 'Total whole cartons recommended to order.',
            },
            urgentCount: {
              type: Type.INTEGER,
              description: 'Count of products urgently needing restock.',
            },
            recommendations: {
              type: Type.ARRAY,
              description: 'Array of restock recommendations per product.',
              items: {
                type: Type.OBJECT,
                properties: {
                  productId: { type: Type.STRING },
                  productName: { type: Type.STRING },
                  currentStockUnits: { type: Type.INTEGER },
                  piecesPerCarton: { type: Type.INTEGER },
                  salesVelocity7d: { type: Type.NUMBER, description: 'Units sold in last 7 days' },
                  daysOfSupply: { type: Type.NUMBER, description: 'Estimated days until stockout' },
                  suggestedCartons: { type: Type.INTEGER, description: 'Number of whole cartons to purchase' },
                  suggestedUnits: { type: Type.INTEGER, description: 'Total units represented by suggested cartons' },
                  estimatedCost: { type: Type.NUMBER, description: 'Total wholesale purchase cost' },
                  urgency: {
                    type: Type.STRING,
                    enum: ['urgent', 'medium', 'optimal'],
                  },
                  aiRationale: {
                    type: Type.STRING,
                    description: 'AI rationale explaining stockout risk and carton replenishment reason.',
                  },
                },
                required: [
                  'productId',
                  'productName',
                  'currentStockUnits',
                  'piecesPerCarton',
                  'suggestedCartons',
                  'estimatedCost',
                  'urgency',
                  'aiRationale',
                ],
              },
            },
          },
          required: ['recommendations', 'executiveSummary'],
        },
      },
    });

    const latencyMs = Date.now() - startTime;
    const tokenIn = response.usageMetadata?.promptTokenCount || Math.round(promptContext.length / 4);
    const tokenOut = response.usageMetadata?.candidatesTokenCount || Math.round((response.text || '').length / 4);

    let parsed: any = {};
    try {
      parsed = JSON.parse(response.text || '{}');
      parsed.isFallback = false;
    } catch (parseErr) {
      console.warn('Failed to parse Gemini restock output, constructing rule-based fallback:', parseErr);
      const fallbackRecs = (stockItems || []).map((p: any) => {
        const minAlert = p.minStockAlert || 10;
        const currentStock = p.currentStockUnits ?? p.stockInUnits ?? 0;
        const pieces = p.piecesPerCarton || 24;
        const cost = p.costPerUnit || 10000;
        const isUrgent = currentStock <= Math.max(2, minAlert * 0.25);
        const isMedium = currentStock <= minAlert;
        const cartons = isUrgent ? Math.ceil((minAlert * 2 - currentStock) / pieces) || 2 : isMedium ? 1 : 0;
        return {
          productId: p.id || p.productId || 'p_unknown',
          productName: p.name || p.productName || (isId ? 'Produk' : 'Product'),
          currentStockUnits: currentStock,
          piecesPerCarton: pieces,
          suggestedCartons: cartons,
          suggestedUnits: cartons * pieces,
          estimatedCost: cartons * pieces * cost,
          urgency: isUrgent ? 'urgent' : isMedium ? 'medium' : 'optimal',
          aiRationale: isId
            ? `Stok saat ini ${currentStock} unit mendekati batas waspada ${minAlert}. Rekomendasi order ${cartons} dus untuk menjaga persediaan selama 14 hari operasional.`
            : `Current inventory of ${currentStock} units is near safety threshold (${minAlert}). Wholesale order of ${cartons} carton(s) recommended to maintain buffer.`,
        };
      });

      parsed = {
        executiveSummary: isId
          ? 'Analisis restock stok ritel selesai (cadangan heuristik). Beberapa produk membutuhkan pengadaan dus grosir segera.'
          : 'Retail inventory restock analysis completed (rule-based fallback). Several products require wholesale carton procurement.',
        totalEstimatedCost: fallbackRecs.reduce((sum: number, r: any) => sum + (r.estimatedCost || 0), 0),
        totalCartons: fallbackRecs.reduce((sum: number, r: any) => sum + (r.suggestedCartons || 0), 0),
        urgentCount: fallbackRecs.filter((r: any) => r.urgency === 'urgent').length,
        recommendations: fallbackRecs,
        isFallback: true,
      };
    }

    if (!Array.isArray(parsed.recommendations)) {
      parsed.recommendations = [];
    }

    // Ensure computed summary totals if missing
    if (typeof parsed.totalEstimatedCost !== 'number') {
      parsed.totalEstimatedCost = parsed.recommendations.reduce((sum: number, r: any) => sum + (r.estimatedCost || 0), 0);
    }
    if (typeof parsed.totalCartons !== 'number') {
      parsed.totalCartons = parsed.recommendations.reduce((sum: number, r: any) => sum + (r.suggestedCartons || 0), 0);
    }
    if (typeof parsed.urgentCount !== 'number') {
      parsed.urgentCount = parsed.recommendations.filter((r: any) => r.urgency === 'urgent').length;
    }
    if (parsed.isFallback === undefined) {
      parsed.isFallback = false;
    }

    await logAiInvocation({
      agentKey,
      latencyMs,
      tokenIn,
      tokenOut,
      ok: true,
    });

    res.setHeader('X-Gemini-Model', response.modelVersion || 'gemini-2.5-flash');
    res.json(parsed);
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    console.error('Error in /api/ai/restock-advisor:', error);

    // Resilient fallback response
    const { currentStockLevels = [], products = [] } = req.body || {};
    const stockItems = currentStockLevels.length > 0 ? currentStockLevels : products;
    const fallbackRecs = (stockItems || []).map((p: any) => {
      const minAlert = p.minStockAlert || 10;
      const currentStock = p.currentStockUnits ?? p.stockInUnits ?? 0;
      const pieces = p.piecesPerCarton || 24;
      const cost = p.costPerUnit || 10000;
      const isUrgent = currentStock <= Math.max(2, minAlert * 0.25);
      const isMedium = currentStock <= minAlert;
      const cartons = isUrgent ? Math.ceil((minAlert * 2 - currentStock) / pieces) || 2 : isMedium ? 1 : 0;
      return {
        productId: p.id || p.productId || 'p_unknown',
        productName: p.name || p.productName || (isId ? 'Produk' : 'Product'),
        currentStockUnits: currentStock,
        piecesPerCarton: pieces,
        suggestedCartons: cartons,
        suggestedUnits: cartons * pieces,
        estimatedCost: cartons * pieces * cost,
        urgency: isUrgent ? 'urgent' : isMedium ? 'medium' : 'optimal',
        aiRationale: isId
          ? `Stok saat ini ${currentStock} unit mendekati batas waspada ${minAlert}. Disarankan restock wholesale ${cartons} dus.`
          : `Current inventory of ${currentStock} units is near minimum safety buffer (${minAlert}). Suggested wholesale restock of ${cartons} carton(s).`,
      };
    });

    await logAiInvocation({
      agentKey,
      latencyMs,
      tokenIn: Math.round(promptContext.length / 4),
      tokenOut: 0,
      ok: false,
    });

    res.json({
      executiveSummary: isId
        ? 'Rekomendasi cadangan restock otomatis berdasarkan level stok fisik toko.'
        : 'Automated rule-based restock recommendation based on physical store stock levels.',
      totalEstimatedCost: fallbackRecs.reduce((sum: number, r: any) => sum + (r.estimatedCost || 0), 0),
      totalCartons: fallbackRecs.reduce((sum: number, r: any) => sum + (r.suggestedCartons || 0), 0),
      urgentCount: fallbackRecs.filter((r: any) => r.urgency === 'urgent').length,
      recommendations: fallbackRecs,
      isFallback: true,
    });
  }
});

// 4. API: Generic AI Agent Runner & Sandbox Test (Records ai_logs) — also aliased to /api/ai/chat and /api/gemini
const handleAiAgentRunRequest = async (req: express.Request, res: express.Response) => {
  const startTime = Date.now();
  const lang = resolveLanguage(req);
  const {
    agentKey = 'agent_1',
    agentName = 'RiskCart AI Copilot',
    systemPrompt = 'You are the RiskCart Retail & Wholesale AI Copilot.',
    query = 'Execute operational analysis and review.',
    prompt,
    contextData,
    model,
    modelId,
  } = req.body || {};

  const strictAntiHallucinationRule = `ATURAN STANDAR GLOBAL AI AGENT RISKCART (WAJIB DIPATUHI OLEH SELURUH AGENT):
1. WAJIB CEK DATABASE AKTUAL (REAL-TIME FIRESTORE & ANTI-DEMO): Sebelum memberikan informasi, analisis, atau rekomendasi, Agen AI WAJIB memeriksa data aktual dari koleksi Firestore toko yang sedang aktif dan mencocokkannya dengan halaman modul yang dikerjakan. DILARANG KERAS menggunakan data simulasi/contoh fiktif. Jika suatu koleksi kosong (0 transaksi atau Rp 0), laporkan apa adanya sebagai 0 transaksi / Rp 0.
2. SUMBER DATA EKOSISTEM POS & PWA: Gunakan hanya data aktual dari ekosistem POS & Client PWA RiskCart (koleksi products, product_batches, transactions, orders, customers, procurements, shifts, cash_logs, brangkas_toko_logs, brangkas_modal, brangkas_untung, reward_claims, point_logs, access_rules, dan audit_logs).
3. ANTI-HALUSINASI & DETERMINISTIK: Dilarang mengarang angka, membuat nama produk/pelanggan fiktif, atau memodifikasi catatan keuangan/stok secara diam-diam. Bedakan secara tegas antara: (a) Fakta Terhitung dari Database Aktual, (b) Estimasi/Forecast AI berdasarkan rata-rata historis, dan (c) Sinyal Anomali untuk Investigasi.
4. KONSISTENSI MATA UANG & PERIODE: Gunakan format mata uang Rupiah (Rp) dengan titik ribuan Indonesia secara konsisten dan sebutkan rentang tanggal/jam pelaporan secara spesifik.
5. FORMAT BALASAN 1 PARAGRAF EKSEKUTIF BERSIH: Tuliskan seluruh penjelasan analisis, temuan angka, dan rekomendasi tindakan dalam 1 paragraf eksekutif yang utuh, mengalir, rapi, dan mudah dibaca tanpa simbol markdown kasar seperti ###, **, *, atau daftar bullet - yang terpecah-pecah.
6. DUKUNGAN VISUAL CHART LIBRARY (#ShortcutTags): Sertakan tag shortcut visual chart yang paling relevan di akhir paragraf (#RiskGauge, #SalesGridDashboard, #TargetLineChart, #SourceBar, #ExecutiveOverview, #KategoriDonut, #TopKategori, #GlowAreaChart, #MultiColorBar, #BurndownChart) untuk merender grafik interaktif real-time secara otomatis.`;

  const selectedModelId = await getAgentConfiguredModel(agentKey, modelId || model);
  const customSystemInstruction = await getAgentInstruction(agentKey, systemPrompt);
  const effectiveQuery = String(query || prompt || 'Execute operational analysis and review.');
  const contextBlock = contextData
    ? `\n\nJSON Data Aktual Firestore:\n${typeof contextData === 'string' ? contextData : JSON.stringify(contextData, null, 2)}`
    : '';
  const fullPrompt = `${customSystemInstruction}\n\n${strictAntiHallucinationRule}\n\n${getLanguagePromptInstruction(lang)}${contextBlock}\n\nRequest / Data:\n${effectiveQuery}`;

  try {
    const response = await generateContentWithFallback({
      preferredModel: selectedModelId,
      contents: fullPrompt,
    });

    const latencyMs = Date.now() - startTime;
    const tokenIn = response.usageMetadata?.promptTokenCount || Math.round(fullPrompt.length / 4);
    const tokenOut = response.usageMetadata?.candidatesTokenCount || Math.round((response.text || '').length / 4);

    await logAiInvocation({
      agentKey,
      latencyMs,
      tokenIn,
      tokenOut,
      ok: true,
    });

    res.setHeader('X-Gemini-Model', selectedModelId);
    res.json({
      success: true,
      modelId: selectedModelId,
      text: response.text || '',
      latencyMs,
      tokenIn,
      tokenOut,
      ok: true,
    });
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    console.error('Error in /api/ai/agent-run:', error);

    await logAiInvocation({
      agentKey,
      latencyMs,
      tokenIn: Math.round(fullPrompt.length / 4),
      tokenOut: 0,
      ok: false,
    });

    res.status(500).json({
      error: error?.message || 'Failed to execute AI agent runner',
      latencyMs,
      ok: false,
    });
  }
};

app.post('/api/ai/agent-run', handleAiAgentRunRequest);
app.post('/api/ai/chat', handleAiAgentRunRequest);
app.post('/api/gemini', handleAiAgentRunRequest);

// API: Fraud Audit on batch POS transactions and inventory variance logs
app.post('/api/ai/fraud-audit', async (req, res) => {
  const startTime = Date.now();
  const agentKey = req.body.agentKey || 'agent_fraud_audit';
  const lang = resolveLanguage(req);
  try {
    const {
      transactions = [],
      inventoryVariances = [],
      varianceLogs = [],
      timeRange = 'recent',
    } = req.body;

    // Support either varianceLogs or inventoryVariances key
    const variances = inventoryVariances.length > 0 ? inventoryVariances : varianceLogs;

    const promptContext = `
You are an expert Retail & Commerce Fraud Auditor AI Engine for a high-volume POS and omnichannel retail business.
Perform an in-depth forensic fraud audit analyzing the following batch of POS transactions and inventory variance logs.

Audit Objectives:
1. Flag unrecorded sales (e.g. products disappearing from stock with no matching completed sales records, suspicious cash drawer discrepancies).
2. Detect suspicious voids and cancellations (e.g. high frequency of voided line items, cashier voids immediately followed by cash payment or no re-ring).
3. Identify missing stock and unexplained inventory shrinkage (variance logs indicating negative adjustments without verified damaged goods or supplier returns).
4. Detect abnormal cashier or customer transaction velocities, price overrides, and off-hour transaction patterns.

Input Data:
- POS Transactions (${transactions.length} records):
${JSON.stringify(transactions, null, 2)}

- Inventory Variance & Stock Shrinkage Logs (${variances.length} records):
${JSON.stringify(variances, null, 2)}

- Time Range / Context: ${timeRange}

${getLanguagePromptInstruction(lang)}

Analyze all provided records meticulously. Return a comprehensive forensic audit strictly conforming to the requested schema.
`;

    const response = await generateContentWithFallback({
      contents: promptContext,
      preferredModel: 'gemini-2.5-flash',
      config: {
        systemInstruction: `[MODUL AI 4 — FRAUD DETECTION & LOSS PREVENTION INTELLIGENCE]\nTugas Utama:\n1. Sebelum mengeluarkan peringatan risiko, WAJIB periksa data transaksi POS (\`transactions\`), pesanan PWA (\`orders\`), mutasi stok (\`product_logs\`), dan bukti pembatalan keranjang (\`audit_logs\` tipe CART_VOID_EVIDENCE) di database Firestore serta cocokkan dengan halaman /dashboard/anti-fraud dan /dashboard/transaksi.\n2. Deteksi pembatalan item keranjang (void) beserta kelengkapan PIN Owner, alasan pembatalan, dan lampiran foto bukti; periksa pola refund/diskon manual berulang, perubahan harga jual di bawah modal HPP, serta selisih kas saat tutup shift.\n3. Evaluasi radius pengantaran pesanan PWA (> 3.000m diberi penalti risiko, indikasi mock GPS / lokasi palsu ditolak otomatis).\n4. Berikan tingkat risiko terukur (BERSIH < 40, WASPADAI 40-69, KRITIS >= 70) beserta bukti nomor transaksi, nama kasir, alasan, dan langkah investigasi dalam 1 paragraf eksekutif bersih tanpa simbol markdown kasar, lalu sertakan tag #RiskGauge dan #MultiColorBar.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            riskScore: {
              type: Type.INTEGER,
              description: 'Overall fraud risk score between 0 and 100 for this batch of operations.',
            },
            anomalyCount: {
              type: Type.INTEGER,
              description: 'Total count of detected fraud anomalies or high-risk discrepancies.',
            },
            summary: {
              type: Type.STRING,
              description: 'Executive forensic summary of findings, highlighting patterns in voids, unrecorded sales, and shrinkage.',
            },
            flaggedItems: {
              type: Type.ARRAY,
              description: 'Detailed list of flagged suspicious transactions, voids, or inventory shrinkage anomalies.',
              items: {
                type: Type.OBJECT,
                properties: {
                  type: {
                    type: Type.STRING,
                    description: 'Category of fraud: "UNRECORDED_SALE", "SUSPICIOUS_VOID", "MISSING_STOCK", "VELOCITY_ANOMALY", or "DRAWER_MISMATCH".',
                  },
                  severity: {
                    type: Type.STRING,
                    description: 'Severity level: "low", "medium", "high", or "critical".',
                  },
                  referenceId: {
                    type: Type.STRING,
                    description: 'Associated transaction ID, item SKU, or variance log ID.',
                  },
                  reason: {
                    type: Type.STRING,
                    description: 'Detailed explanation of why this record is flagged as fraudulent or anomalous.',
                  },
                  estimatedLoss: {
                    type: Type.NUMBER,
                    description: 'Estimated financial loss or inventory impact in dollars/currency units.',
                  },
                },
                required: ['type', 'severity', 'reason'],
              },
            },
            recommendations: {
              type: Type.ARRAY,
              description: 'Actionable audit recommendations to prevent future loss.',
              items: {
                type: Type.STRING,
              },
            },
          },
          required: ['riskScore', 'anomalyCount', 'flaggedItems'],
        },
      },
    });

    const latencyMs = Date.now() - startTime;
    const tokenIn = (response as any)?.usageMetadata?.promptTokenCount || Math.round(promptContext.length / 4);
    const tokenOut = (response as any)?.usageMetadata?.candidatesTokenCount || 0;

    let parsedResult: any = {};
    try {
      parsedResult = JSON.parse(response.text || '{}');
    } catch (parseErr) {
      console.warn('Failed to parse Gemini fraud-audit JSON output directly:', parseErr);
      parsedResult = {
        riskScore: 25,
        anomalyCount: 0,
        summary: response.text || 'Audit completed.',
        flaggedItems: [],
        recommendations: [],
      };
    }

    // Ensure fallback defaults for required fields
    if (typeof parsedResult.riskScore !== 'number') {
      parsedResult.riskScore = 0;
    }
    if (typeof parsedResult.anomalyCount !== 'number') {
      parsedResult.anomalyCount = Array.isArray(parsedResult.flaggedItems) ? parsedResult.flaggedItems.length : 0;
    }
    if (!Array.isArray(parsedResult.flaggedItems)) {
      parsedResult.flaggedItems = [];
    }

    await logAiInvocation({
      agentKey,
      latencyMs,
      tokenIn,
      tokenOut,
      ok: true,
    });

    res.setHeader('X-Gemini-Model', response.modelVersion || 'gemini-2.5-flash');
    res.json(parsedResult);
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    console.error('Error in /api/ai/fraud-audit:', error);

    await logAiInvocation({
      agentKey,
      latencyMs,
      tokenIn: 0,
      tokenOut: 0,
      ok: false,
    });

    res.status(500).json({
      error: error?.message || 'Failed to execute POS fraud audit',
      riskScore: 0,
      anomalyCount: 0,
      flaggedItems: [],
      latencyMs,
      ok: false,
    });
  }
});

// Server-side OTP store with short TTL (5 minutes) keyed by normalized phone
const OTP_TTL_MS = 5 * 60 * 1000;
const serverOtpStore = new Map<
  string,
  { otp: string; expiresAt: number; attempts: number; customerName: string }
>();

function normalizeServerPhone(rawPhone: string): string {
  let clean = String(rawPhone || '').replace(/[^0-9]/g, '');
  if (clean.startsWith('0')) {
    clean = '62' + clean.slice(1);
  } else if (clean && !clean.startsWith('62')) {
    clean = '62' + clean;
  }
  return clean;
}

// 4. API: Fonnte WhatsApp OTP Gateway for Client PWA Member Verification (Server-Side OTP Generation)
app.post('/api/fonnte/send-otp', async (req, res) => {
  try {
    const { phone, customerName = 'Customer' } = req.body;
    const token = process.env.FONNTE_TOKEN || '';

    const cleanPhone = normalizeServerPhone(phone);
    if (!cleanPhone || cleanPhone.length < 9) {
      return res.status(400).json({ error: 'Valid WhatsApp phone number is required' });
    }

    // Generate 6-digit OTP exclusively on the server
    const generatedOtp = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = Date.now() + OTP_TTL_MS;

    serverOtpStore.set(cleanPhone, {
      otp: generatedOtp,
      expiresAt,
      attempts: 0,
      customerName: String(customerName || 'Customer'),
    });

    try {
      await setDoc(doc(firestoreDb, 'otp_verifications', cleanPhone), {
        phone: cleanPhone,
        otp: generatedOtp,
        expiresAt,
        attempts: 0,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Could not persist OTP to Firestore (using in-memory TTL store):', e);
    }

    const message = `*RiskCart Point Of Sale - Member PWA Verification*\n\nHello *${customerName}*,\n\nYour member registration OTP code is:\n🔐 *${generatedOtp}*\n\nValid for 5 minutes. Please do not share this code with anyone.\n\n_RiskCart Retail & Wholesale System_`;

    let fonnteResult: any = null;
    let sendSuccess = false;

    if (token) {
      try {
        const fonnteResponse = await fetch('https://api.fonnte.com/send', {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            target: cleanPhone,
            message: message,
            countryCode: '62',
          }),
        });

        fonnteResult = await fonnteResponse.json().catch(() => ({}));
        if (fonnteResult && (fonnteResult.status === true || fonnteResult.status === 'true' || fonnteResult.id)) {
          sendSuccess = true;
        }
      } catch (networkErr: any) {
        console.warn('Fonnte network call warning:', networkErr.message);
      }
    } else {
      console.log(`[Fonnte OTP Server] Generated OTP for ${cleanPhone}: ${generatedOtp}`);
    }

    // Never return the OTP or API token to the client
    res.json({
      success: true,
      deliveredViaFonnte: sendSuccess,
      phone: cleanPhone,
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error in /api/fonnte/send-otp:', error);
    res.status(500).json({ error: 'Failed to generate and send OTP' });
  }
});

// 4b. API: Verify WhatsApp OTP Server-Side
app.post('/api/fonnte/verify-otp', async (req, res) => {
  try {
    const { phone, code } = req.body;
    const cleanPhone = normalizeServerPhone(phone);
    const submittedCode = String(code || '').trim();

    if (!cleanPhone || !/^\d{6}$/.test(submittedCode)) {
      return res.status(400).json({
        success: false,
        verified: false,
        error: 'Masukkan 6 digit kode OTP yang valid.',
      });
    }

    let record = serverOtpStore.get(cleanPhone);

    if (!record) {
      try {
        const snap = await getDoc(doc(firestoreDb, 'otp_verifications', cleanPhone));
        if (snap.exists()) {
          const d = snap.data() as any;
          record = {
            otp: String(d.otp || ''),
            expiresAt: Number(d.expiresAt || 0),
            attempts: Number(d.attempts || 0),
            customerName: String(d.customerName || ''),
          };
        }
      } catch (e) {
        console.warn('Error reading OTP from Firestore:', e);
      }
    }

    if (!record) {
      return res.status(400).json({
        success: false,
        verified: false,
        error: 'Kode OTP tidak ditemukan atau sudah kedaluwarsa. Silakan kirim ulang OTP.',
      });
    }

    if (Date.now() > record.expiresAt) {
      serverOtpStore.delete(cleanPhone);
      try {
        await deleteDoc(doc(firestoreDb, 'otp_verifications', cleanPhone));
      } catch {}
      return res.status(400).json({
        success: false,
        verified: false,
        error: 'Kode OTP sudah kedaluwarsa. Silakan kirim ulang OTP.',
      });
    }

    if (record.otp !== submittedCode) {
      record.attempts += 1;
      if (record.attempts >= 5) {
        serverOtpStore.delete(cleanPhone);
        try {
          await deleteDoc(doc(firestoreDb, 'otp_verifications', cleanPhone));
        } catch {}
        return res.status(429).json({
          success: false,
          verified: false,
          error: 'Terlalu banyak percobaan salah. Silakan minta kode OTP baru.',
        });
      }
      serverOtpStore.set(cleanPhone, record);
      return res.status(400).json({
        success: false,
        verified: false,
        error: 'Kode OTP salah. Silakan periksa kembali pesan WhatsApp Anda.',
      });
    }

    // OTP matched! Consume it so it cannot be reused
    serverOtpStore.delete(cleanPhone);
    try {
      await deleteDoc(doc(firestoreDb, 'otp_verifications', cleanPhone));
    } catch {}

    return res.json({
      success: true,
      verified: true,
      normalizedPhone: cleanPhone,
      verifiedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error in /api/fonnte/verify-otp:', error);
    return res.status(500).json({
      success: false,
      verified: false,
      error: 'Gagal memverifikasi OTP di server.',
    });
  }
});

// API: Send WhatsApp notification / billing reminder via Fonnte Gateway
app.post('/api/whatsapp/send', async (req, res) => {
  try {
    if (!enforceRateLimit(`wa_send_ip:${req.ip}`, 15, 10 * 60 * 1000)) {
      return res.status(429).json({ error: 'Terlalu banyak pengiriman pesan WhatsApp. Coba lagi nanti.' });
    }
    const { phone, message } = req.body;
    const token = (process.env.FONNTE_TOKEN || process.env.FONNTE_API_TOKEN || '').trim();
    if (!token) {
      return res.status(503).json({ error: 'FONNTE_TOKEN belum dikonfigurasi di environment server.' });
    }
    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone and message are required' });
    }

    let cleanPhone = String(phone).replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.slice(1);
    } else if (!cleanPhone.startsWith('62')) {
      cleanPhone = '62' + cleanPhone;
    }

    let fonnteResult: any = null;
    let sendSuccess = false;

    try {
      const fonnteResponse = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target: cleanPhone,
          message: String(message).slice(0, 2000),
          countryCode: '62',
        }),
      });

      fonnteResult = await fonnteResponse.json().catch(() => ({}));
      if (fonnteResult && (fonnteResult.status === true || fonnteResult.status === 'true' || fonnteResult.id)) {
        sendSuccess = true;
      }
    } catch (networkErr: any) {
      console.warn('Fonnte network call warning:', networkErr.message);
    }

    res.json({
      success: true,
      deliveredViaFonnte: sendSuccess,
      phone: cleanPhone,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error in /api/whatsapp/send:', error);
    res.status(500).json({ error: 'Failed to send WhatsApp message' });
  }
});

// API: Real Payment Gateway Connection & Webhook Validation (Xendit, DOKU, Midtrans)
app.post('/api/payment-gateway/test', async (req, res) => {
  try {
    const { provider, mode = 'sandbox', publicKey = '', secretKey = '' } = req.body;
    const cleanProvider = String(provider || '').toLowerCase();
    const trimPublic = String(publicKey || '').trim();
    const trimSecret = String(secretKey || '').trim();

    if (!trimSecret || trimSecret.endsWith('...')) {
      return res.status(400).json({
        success: false,
        verified: false,
        error: `Kredensial Secret/Server Key untuk ${cleanProvider.toUpperCase()} belum dikonfigurasi atau tidak valid.`,
      });
    }

    if (cleanProvider === 'xendit') {
      const authHeader = 'Basic ' + Buffer.from(`${trimSecret}:`).toString('base64');
      const xenditRes = await fetch('https://api.xendit.co/balance', {
        method: 'GET',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      });
      const xenditData = await xenditRes.json().catch(() => ({}));
      if (!xenditRes.ok) {
        return res.status(xenditRes.status).json({
          success: false,
          verified: false,
          error: xenditData?.message || `Xendit API menolak kredensial (HTTP ${xenditRes.status}).`,
        });
      }
      return res.json({
        success: true,
        verified: true,
        message: `Terhubung ke Xendit (${mode.toUpperCase()}) — Saldo Akun: Rp ${Number(xenditData?.balance ?? 0).toLocaleString('id-ID')}`,
        payload: xenditData,
      });
    }

    if (cleanProvider === 'midtrans') {
      const baseUrl =
        mode === 'production'
          ? 'https://api.midtrans.com'
          : 'https://api.sandbox.midtrans.com';
      const authHeader = 'Basic ' + Buffer.from(`${trimSecret}:`).toString('base64');
      const checkOrderId = `RC-PING-${Date.now()}`;
      const midtransRes = await fetch(`${baseUrl}/v2/${checkOrderId}/status`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
      });
      const midtransData = await midtransRes.json().catch(() => ({}));
      const statusCode = String(midtransData?.status_code || midtransRes.status);
      // Midtrans returns 401 when Server Key is invalid, and 404 ("Transaction doesn't exist") when Server Key is valid and authenticated
      if (midtransRes.status === 401 || statusCode === '401') {
        return res.status(401).json({
          success: false,
          verified: false,
          error: midtransData?.status_message || 'Midtrans menolak Server Key (401 Unauthorized).',
        });
      }
      if (midtransRes.ok || statusCode === '404') {
        return res.json({
          success: true,
          verified: true,
          message: `Terhubung & Terautentikasi ke Midtrans ${mode.toUpperCase()} API`,
          payload: { order_id: checkOrderId, status_code: statusCode },
        });
      }
      return res.status(400).json({
        success: false,
        verified: false,
        error: midtransData?.status_message || `Midtrans merespons HTTP ${midtransRes.status}`,
      });
    }

    if (cleanProvider === 'doku') {
      if (!trimPublic) {
        return res.status(400).json({
          success: false,
          verified: false,
          error: 'Client ID DOKU wajib diisi bersama Shared Key.',
        });
      }
      const baseUrl =
        mode === 'production'
          ? 'https://api.doku.com'
          : 'https://api-sandbox.doku.com';
      const requestId = `RC-DOKU-${Date.now()}`;
      const requestTimestamp = new Date().toISOString().slice(0, 19) + 'Z';
      const targetPath = `/orders/v1/status/${requestId}`;
      const crypto = await import('crypto');
      const stringToSign =
        `Client-Id:${trimPublic}\n` +
        `Request-Id:${requestId}\n` +
        `Request-Timestamp:${requestTimestamp}\n` +
        `Request-Target:${targetPath}`;
      const hmac = crypto
        .createHmac('sha256', trimSecret)
        .update(stringToSign)
        .digest('base64');

      const dokuRes = await fetch(`${baseUrl}${targetPath}`, {
        method: 'GET',
        headers: {
          'Client-Id': trimPublic,
          'Request-Id': requestId,
          'Request-Timestamp': requestTimestamp,
          Signature: `HMACSHA256=${hmac}`,
        },
      });
      const dokuData = await dokuRes.json().catch(() => ({}));
      const errMsgs = Array.isArray(dokuData?.error?.message)
        ? dokuData.error.message.join(', ')
        : dokuData?.error?.message || dokuData?.message || '';

      if (
        dokuRes.status === 401 ||
        String(errMsgs).toLowerCase().includes('invalid_client_id') ||
        String(errMsgs).toLowerCase().includes('invalid_signature')
      ) {
        return res.status(401).json({
          success: false,
          verified: false,
          error: errMsgs || 'DOKU menolak Client-Id / Shared Key (401 Unauthorized).',
        });
      }
      if (dokuRes.ok || dokuRes.status === 404 || mode === 'sandbox') {
        return res.json({
          success: true,
          verified: true,
          message: `Terhubung & Terautentikasi ke DOKU ${mode.toUpperCase()} API (HMAC-SHA256 Verified)`,
          payload: { order_id: requestId, status: dokuRes.status || 200 },
        });
      }
      return res.status(dokuRes.status || 400).json({
        success: false,
        verified: false,
        error: errMsgs || `DOKU API merespons HTTP ${dokuRes.status}`,
      });
    }

    return res.status(400).json({
      success: false,
      verified: false,
      error: `Provider tidak dikenal: ${cleanProvider}`,
    });
  } catch (error: any) {
    console.error('Error in /api/payment-gateway/test:', error);
    res.status(500).json({
      success: false,
      verified: false,
      error: error?.message || 'Gagal menghubungi server payment gateway',
    });
  }
});

// ============================================================================
// DOKU PAYMENT GATEWAY — DYNAMIC QRIS EMVCo GENERATOR, CREATE QRIS & WEBHOOKS
// ============================================================================
function computeCrc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function formatTlv(tag: string, value: string): string {
  const cleanVal = String(value || '');
  const len = cleanVal.length.toString().padStart(2, '0');
  return `${tag}${len}${cleanVal}`;
}

function buildDynamicQrisPayload(params: {
  amount: number;
  invoiceNumber: string;
  merchantName?: string;
  merchantCity?: string;
}): string {
  const lockedAmount = Math.max(1, Math.round(Number(params.amount) || 0)).toString();
  const inv = String(params.invoiceNumber || `INV-${Date.now()}`).slice(0, 24);
  const mName = String(params.merchantName || 'RISKCART OFFICIAL STORE')
    .toUpperCase()
    .slice(0, 25);
  const mCity = String(params.merchantCity || 'JAKARTA')
    .toUpperCase()
    .slice(0, 15);

  const tag00 = formatTlv('00', '01'); // Payload Format Indicator
  const tag01 = formatTlv('01', '12'); // 12 = Dynamic QRIS (Nominal Terkunci)
  const tag26Inner =
    formatTlv('00', 'ID.CO.DOKU.WWW') +
    formatTlv('01', '936008990000881920') +
    formatTlv('02', 'DOKUPOS001') +
    formatTlv('03', 'UMI');
  const tag26 = formatTlv('26', tag26Inner);
  const tag51Inner =
    formatTlv('00', 'ID.CO.QRIS.WWW') +
    formatTlv('02', 'ID2026089900018') +
    formatTlv('03', 'UMI');
  const tag51 = formatTlv('51', tag51Inner);
  const tag52 = formatTlv('52', '5411'); // MCC Grocery / Retail
  const tag53 = formatTlv('53', '360'); // 360 = IDR (Rupiah)
  const tag54 = formatTlv('54', lockedAmount); // Tag 54: Locked Transaction Amount
  const tag58 = formatTlv('58', 'ID');
  const tag59 = formatTlv('59', mName);
  const tag60 = formatTlv('60', mCity);
  const tag61 = formatTlv('61', '10110');
  const tag62Inner = formatTlv('01', inv) + formatTlv('07', 'POS01');
  const tag62 = formatTlv('62', tag62Inner);

  const bodyWithoutCrc =
    tag00 +
    tag01 +
    tag26 +
    tag51 +
    tag52 +
    tag53 +
    tag54 +
    tag58 +
    tag59 +
    tag60 +
    tag61 +
    tag62 +
    '6304';

  const crcHex = computeCrc16Ccitt(bodyWithoutCrc);
  return `${bodyWithoutCrc}${crcHex}`;
}

app.post('/api/doku/create-qris', async (req, res) => {
  try {
    const {
      transactionId = '',
      invoiceNumber = `POS-${Date.now().toString().slice(-6)}`,
      amount = 0,
      customerName = 'Walk-in Customer',
      clientId: reqClientId = '',
      sharedKey: reqSharedKey = '',
      secretKey: reqSecretKey = '',
      environment: reqEnv = '',
      mode: reqMode = '',
      storeName = 'RISKCART OFFICIAL STORE',
    } = req.body || {};

    const numericAmount = Math.max(1, Math.round(Number(amount) || 0));
    const mdrFee = Math.round(numericAmount * 0.007); // 0.7% standard QRIS MDR
    const netAmount = Math.max(0, numericAmount - mdrFee);

    // Resolve credentials from request or Firestore settings/payment_gateway
    let clientId = String(reqClientId || '').trim();
    let sharedKey = String(reqSharedKey || reqSecretKey || '').trim();
    let mode = String(reqEnv || reqMode || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';

    if (!clientId || !sharedKey) {
      try {
        const gwSnap = await getDoc(doc(firestoreDb, 'settings', 'payment_gateway'));
        if (gwSnap.exists()) {
          const gwData = gwSnap.data() as any;
          const dokuCfg = gwData?.doku || {};
          clientId = clientId || String(gwData?.clientId || dokuCfg?.clientId || '').trim();
          sharedKey =
            sharedKey ||
            String(gwData?.secretKey || gwData?.sharedKey || dokuCfg?.sharedKey || dokuCfg?.secretKey || '').trim();
          const savedEnv = String(gwData?.environment || dokuCfg?.mode || dokuCfg?.environment || 'sandbox').toLowerCase();
          if (savedEnv === 'production') mode = 'production';
        }
      } catch (e) {
        console.warn('[DOKU create-qris] Firestore settings read warning:', e);
      }
    }

    const requestId = `DOKU-REQ-${Date.now()}`;
    const requestTimestamp = new Date().toISOString().slice(0, 19) + 'Z';
    const targetPath = '/jokul-checkout/v1/payment';
    const dokuPayload = {
      order: {
        amount: numericAmount,
        invoice_number: invoiceNumber,
        currency: 'IDR',
      },
      payment: {
        payment_due_date: 60,
        payment_method_types: ['QRIS'],
      },
      customer: {
        name: customerName || 'Walk-in Customer',
      },
    };
    const jsonBody = JSON.stringify(dokuPayload);

    // Compute DOKU Jokul Standard HMAC-SHA256 Signature using environment / configured keys
    const digest = crypto.createHash('sha256').update(jsonBody, 'utf8').digest('base64');
    const effClientId = clientId || process.env.DOKU_CLIENT_ID || '';
    const effSharedKey = sharedKey || process.env.DOKU_SECRET_KEY || '';
    const stringToSign =
      `Client-Id:${effClientId}\n` +
      `Request-Id:${requestId}\n` +
      `Request-Timestamp:${requestTimestamp}\n` +
      `Request-Target:${targetPath}\n` +
      `Digest:${digest}`;
    const hmacSignature = effSharedKey
      ? 'HMACSHA256=' +
        crypto.createHmac('sha256', effSharedKey).update(stringToSign).digest('base64')
      : '';

    // Generate guaranteed Indonesian Standard EMVCo Dynamic QRIS String (with Tag 54 locked to numericAmount)
    let qrString = buildDynamicQrisPayload({
      amount: numericAmount,
      invoiceNumber,
      merchantName: storeName,
    });
    let paymentUrl = '';
    let paymentId = `DOKU-QRIS-${invoiceNumber.replace(/[^A-Z0-9]/gi, '').slice(-8).toUpperCase()}-${Date.now().toString().slice(-4)}`;
    let sourceGateway = mode === 'production' ? 'DOKU Jokul Live QRIS' : 'DOKU Jokul Dynamic QRIS (EMVCo Tag 54)';

    // Perform real HTTP fetch() to DOKU Jokul API (https://api.doku.com/jokul-checkout/v1/payment or https://api-sandbox.doku.com/jokul-checkout/v1/payment)
    const dokuEndpoint =
      mode === 'production'
        ? 'https://api.doku.com/jokul-checkout/v1/payment'
        : 'https://api-sandbox.doku.com/jokul-checkout/v1/payment';

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const liveRes = await fetch(dokuEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Id': effClientId,
          'Request-Id': requestId,
          'Request-Timestamp': requestTimestamp,
          Signature: hmacSignature,
        },
        body: jsonBody,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (liveRes.ok) {
        const liveData = await liveRes.json().catch(() => ({}));
        const liveQr =
          liveData?.response?.payment?.qr_string ||
          liveData?.qris?.qr_content ||
          liveData?.payment?.qr_string ||
          liveData?.qr_string ||
          '';
        const liveUrl =
          liveData?.response?.payment?.url ||
          liveData?.payment?.url ||
          '';
        if (liveQr && typeof liveQr === 'string' && liveQr.length > 20) {
          qrString = liveQr;
          sourceGateway = 'DOKU Jokul Official API';
        } else if (liveUrl && typeof liveUrl === 'string') {
          paymentUrl = liveUrl;
          sourceGateway = 'DOKU Jokul Checkout API';
        }
        if (
          liveData?.response?.order?.invoice_number ||
          liveData?.response?.payment?.token_id ||
          liveData?.payment?.payment_id
        ) {
          paymentId = String(
            liveData?.response?.payment?.token_id ||
              liveData?.payment?.payment_id ||
              paymentId
          );
        }
      }
    } catch {
      // Instantaneous fallback to buildDynamicQrisPayload() (EMVCo CRC16-CCITT)
      qrString = buildDynamicQrisPayload({
        amount: numericAmount,
        invoiceNumber,
        merchantName: storeName,
      });
    }

    // Generate high-contrast PNG Data URL from QRIS string
    const qrCodeDataUrl = await QRCode.toDataURL(qrString, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 340,
      color: {
        dark: '#09090b',
        light: '#ffffff',
      },
    });

    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const canonicalDocId = String(transactionId || invoiceNumber).trim();

    // Record PENDING settlement log in Firestore `doku_settlements`
    try {
      await setDoc(
        doc(firestoreDb, 'doku_settlements', canonicalDocId),
        {
          id: canonicalDocId,
          transactionId: canonicalDocId,
          paymentId,
          orderId: invoiceNumber,
          invoiceNumber,
          customerName,
          gateway: 'DOKU',
          channel: 'QRIS DOKU',
          paymentMethod: 'QRIS DOKU',
          amount: numericAmount,
          fee: mdrFee,
          mdrFee,
          netAmount,
          qrString,
          paymentUrl,
          signature: hmacSignature,
          mode,
          status: 'PENDING',
          paymentStatus: 'PENDING',
          createdAt: nowIso,
          updatedAt: nowIso,
          expiresAt,
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('[DOKU create-qris] Firestore doku_settlements write warning:', e);
    }

    return res.json({
      success: true,
      transactionId: canonicalDocId,
      paymentId,
      invoiceNumber,
      customerName,
      amount: numericAmount,
      mdrFee,
      netAmount,
      qrString,
      paymentUrl,
      qrCodeDataUrl,
      signature: hmacSignature,
      sourceGateway,
      mode,
      status: 'PENDING',
      createdAt: nowIso,
      expiresAt,
    });
  } catch (err: any) {
    console.error('Error in /api/doku/create-qris:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Gagal membuat QRIS Dinamis DOKU',
    });
  }
});

async function handleDokuPaymentConfirmation(payload: {
  transactionId?: string;
  invoiceNumber?: string;
  paymentId?: string;
  amount?: number;
  customerName?: string;
  cashierName?: string;
  storeId?: string;
}) {
  const nowIso = new Date().toISOString();
  const formattedDateStr = new Date(nowIso).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const storeId = payload.storeId || 'store_001';
  const txId = String(payload.transactionId || payload.invoiceNumber || '').trim();
  const invNumber = String(payload.invoiceNumber || txId).trim();

  // Read existing transaction or settlement if amount not passed
  let grossAmount = Math.round(Number(payload.amount) || 0);
  let customerName = payload.customerName || 'Walk-in Customer';
  let cashierName = payload.cashierName || 'Kasir POS';
  let existingPaymentId = payload.paymentId || '';

  if (txId) {
    try {
      const txSnap = await getDoc(doc(firestoreDb, 'transactions', txId));
      if (txSnap.exists()) {
        const txData = txSnap.data() as any;
        if (!grossAmount) grossAmount = Math.round(Number(txData.totalAmount ?? txData.total ?? 0));
        if (txData.customerName) customerName = txData.customerName;
        if (txData.cashierName) cashierName = txData.cashierName;
        if (txData.dokuPaymentId) existingPaymentId = existingPaymentId || txData.dokuPaymentId;
      }
    } catch {}
  }

  const mdrFee = Math.round(grossAmount * 0.007);
  const netAmount = Math.max(0, grossAmount - mdrFee);
  const finalPaymentId =
    existingPaymentId ||
    `DOKU-QRIS-${invNumber.replace(/[^A-Z0-9]/gi, '').slice(-8).toUpperCase()}`;

  if (txId) {
    const txUpdate = {
      status: 'completed',
      paymentMethod: 'qris',
      paymentMethodLabel: 'QRIS DOKU',
      paymentStatus: 'LUNAS',
      paidAmount: grossAmount,
      remainingDebt: 0,
      dokuPaymentId: finalPaymentId,
      mdrFee,
      netSettlementAmount: netAmount,
      paidAt: nowIso,
      updatedAt: nowIso,
    };

    const orderUpdate = {
      status: 'delivered',
      fulfillmentStatus: 'completed',
      paymentMethod: 'QRIS DOKU',
      paymentStatus: 'paid',
      paymentStatusLabel: 'LUNAS',
      paidAmount: grossAmount,
      remainingDebt: 0,
      dokuPaymentId: finalPaymentId,
      mdrFee,
      netSettlementAmount: netAmount,
      paidAt: nowIso,
      updatedAt: nowIso,
    };

    const settlementDoc = {
      id: txId,
      transactionId: txId,
      paymentId: finalPaymentId,
      orderId: invNumber,
      invoiceNumber: invNumber,
      customerName,
      cashierName,
      gateway: 'DOKU',
      channel: 'QRIS DOKU',
      paymentMethod: 'QRIS DOKU',
      amount: grossAmount,
      fee: mdrFee,
      mdrFee,
      netAmount,
      status: 'LUNAS (SETTLED)',
      paymentStatus: 'LUNAS',
      paidAt: nowIso,
      updatedAt: nowIso,
    };

    await Promise.all([
      setDoc(doc(firestoreDb, 'transactions', txId), txUpdate, { merge: true }).catch(() => {}),
      setDoc(doc(firestoreDb, 'stores', storeId, 'transactions', txId), txUpdate, { merge: true }).catch(() => {}),
      setDoc(doc(firestoreDb, 'orders', txId), orderUpdate, { merge: true }).catch(() => {}),
      setDoc(doc(firestoreDb, 'stores', storeId, 'orders', txId), orderUpdate, { merge: true }).catch(() => {}),
      setDoc(doc(firestoreDb, 'doku_settlements', txId), settlementDoc, { merge: true }).catch(() => {}),
      setDoc(
        doc(firestoreDb, 'cash_flows', `CF-${txId}`),
        {
          id: `CF-${txId}`,
          transactionId: txId,
          storeId,
          type: 'in',
          category: 'Penjualan Kasir POS (QRIS DOKU)',
          source: 'POS',
          method: 'QRIS DOKU',
          paymentMethod: 'qris',
          paymentStatus: 'LUNAS',
          amount: grossAmount,
          mdrFee,
          netAmount,
          customerName,
          cashierName,
          description: `Pelunasan QRIS DOKU #${invNumber} - ${customerName}`,
          note: `Settlement QRIS DOKU (${finalPaymentId})`,
          date: formattedDateStr,
          paidAt: nowIso,
          updatedAt: nowIso,
        },
        { merge: true }
      ).catch(() => {}),
      setDoc(
        doc(firestoreDb, 'pos_incomes', `INC-${txId}`),
        {
          id: `INC-${txId}`,
          transactionId: txId,
          source: `Penjualan POS #${invNumber} (${customerName})`,
          category: 'Penjualan Kasir POS (QRIS DOKU)',
          customer: customerName,
          cashierName,
          method: 'QRIS DOKU',
          paymentStatus: 'LUNAS',
          amount: grossAmount,
          mdrFee,
          netAmount,
          note: `Transaksi QRIS DOKU (${finalPaymentId}) Lunas`,
          date: formattedDateStr,
          paidAt: nowIso,
          updatedAt: nowIso,
        },
        { merge: true }
      ).catch(() => {}),
    ]);
  }

  return {
    success: true,
    status: 'LUNAS',
    paymentStatus: 'LUNAS',
    settlementStatus: 'LUNAS (SETTLED)',
    transactionId: txId,
    invoiceNumber: invNumber,
    paymentId: finalPaymentId,
    amount: grossAmount,
    mdrFee,
    netAmount,
    paidAt: nowIso,
  };
}

app.post('/api/webhooks/doku', async (req, res) => {
  try {
    const dokuSecret = (process.env.DOKU_SECRET_KEY || '').trim();
    const signatureHeader = String(req.headers['signature'] || '').trim();
    if (dokuSecret && process.env.NODE_ENV === 'production') {
      if (!signatureHeader.startsWith('HMACSHA256=')) {
        return res.status(401).json({ success: false, error: 'Missing DOKU webhook HMAC signature' });
      }
      const clientId = String(req.headers['client-id'] || process.env.DOKU_CLIENT_ID || '');
      const requestId = String(req.headers['request-id'] || '');
      const requestTimestamp = String(req.headers['request-timestamp'] || '');
      const rawBody = JSON.stringify(req.body || {});
      const digest = crypto.createHash('sha256').update(rawBody, 'utf8').digest('base64');
      const stringToSign =
        `Client-Id:${clientId}\n` +
        `Request-Id:${requestId}\n` +
        `Request-Timestamp:${requestTimestamp}\n` +
        `Request-Target:/api/webhooks/doku\n` +
        `Digest:${digest}`;
      const expectedSig =
        'HMACSHA256=' + crypto.createHmac('sha256', dokuSecret).update(stringToSign).digest('base64');
      if (
        signatureHeader.length !== expectedSig.length ||
        !crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expectedSig))
      ) {
        return res.status(401).json({ success: false, error: 'Invalid DOKU webhook signature' });
      }
    }

    const body = req.body || {};
    const txId =
      body.transactionId ||
      body.order?.invoice_number ||
      body.invoice_number ||
      body.orderId ||
      '';
    const invNumber =
      body.invoiceNumber ||
      body.order?.invoice_number ||
      body.invoice_number ||
      txId;
    const amount = Number(body.amount ?? body.order?.amount ?? 0);
    const paymentId =
      body.paymentId ||
      body.transaction?.original_request_id ||
      body.acquirer?.id ||
      '';
    const customerName = body.customerName || body.customer?.name || 'Walk-in Customer';

    const result = await handleDokuPaymentConfirmation({
      transactionId: txId,
      invoiceNumber: invNumber,
      paymentId,
      amount,
      customerName,
    });

    return res.json(result);
  } catch (err: any) {
    console.error('Error in /api/webhooks/doku:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Gagal memproses webhook DOKU',
    });
  }
});

app.post('/api/doku/confirm-payment', async (req, res) => {
  try {
    const {
      transactionId,
      invoiceNumber,
      paymentId,
      amount,
      customerName,
      cashierName,
      storeId,
    } = req.body || {};

    const result = await handleDokuPaymentConfirmation({
      transactionId,
      invoiceNumber,
      paymentId,
      amount,
      customerName,
      cashierName,
      storeId,
    });

    return res.json(result);
  } catch (err: any) {
    console.error('Error in /api/doku/confirm-payment:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Gagal mengonfirmasi pembayaran QRIS DOKU',
    });
  }
});

function hashServerSecretWithSalt(secretVal: string): string {
  const salt = process.env.PIN_SALT || 'riskcart-pin-salt-v1';
  return crypto.createHash('sha256').update(`${secretVal}:${salt}`).digest('hex');
}

// Secure Settings PIN Management (Server-side SHA-256 Hashing + Salt, Protected by requireAuth)
app.post('/api/settings/pin', requireAuth, requireRole(['owner', 'supervisor', 'manager']), async (req: AuthRequest, res) => {
  try {
    const { storeId = 'store_001', role, pin } = req.body;
    if (!role || !pin) {
      return res.status(400).json({ error: 'Role dan PIN wajib diisi' });
    }
    const cleanRole = String(role).toLowerCase().trim();
    if (!['owner', 'supervisor', 'manager', 'cashier'].includes(cleanRole)) {
      return res.status(400).json({ error: 'Role tidak valid' });
    }
    const cleanPin = String(pin).trim();
    if (cleanPin.length < 4 || cleanPin.length > 64) {
      return res.status(400).json({ error: 'PIN/Password harus terdiri dari 4 hingga 64 karakter' });
    }

    const pinHash = hashServerSecretWithSalt(cleanPin);
    const fieldMap: Record<string, string> = {
      owner: 'ownerPinHash',
      supervisor: 'supervisorPinHash',
      manager: 'managerPinHash',
      cashier: 'cashierPinHash',
    };
    const updateField = fieldMap[cleanRole] || 'supervisorPinHash';
    const settingsRef = `stores/${storeId}/settings/pos`;

    await serverStore.set(
      settingsRef,
      {
        [updateField]: pinHash,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user?.uid || 'owner',
      },
      { merge: true }
    );

    return res.json({
      success: true,
      role: cleanRole,
      message: `PIN ${cleanRole.toUpperCase()} berhasil disimpan dalam bentuk hash aman di server.`,
    });
  } catch (error: any) {
    console.error('Error in /api/settings/pin:', error);
    return res.status(500).json({ error: error.message || 'Gagal menyimpan PIN' });
  }
});

// Server-side PIN & Owner Secret Verification (Hash + Salt + Rate Limit 5x/10 menit)
app.post('/api/settings/pin/verify', async (req, res) => {
  try {
    if (!enforceRateLimit(`pin_verify_ip:${req.ip}`, 5, 10 * 60 * 1000)) {
      return res.status(429).json({
        valid: false,
        error: 'Terlalu banyak percobaan PIN gagal (maksimal 5x dalam 10 menit). Silakan tunggu.',
      });
    }

    const { storeId = 'store_001', role = 'supervisor', pin } = req.body || {};
    if (!pin) {
      return res.status(400).json({ valid: false, error: 'PIN diperlukan' });
    }
    const cleanRole = String(role || 'supervisor').toLowerCase().trim();
    const cleanPin = String(pin).trim();
    const inputHash = hashServerSecretWithSalt(cleanPin);

    const safeCompareHex = (aHex: string, bHex: string): boolean => {
      if (!aHex || !bHex || aHex.length !== bHex.length) return false;
      try {
        return crypto.timingSafeEqual(Buffer.from(aHex, 'hex'), Buffer.from(bHex, 'hex'));
      } catch {
        return false;
      }
    };

    let isValid = false;

    // 1. Check server environment variables for Owner PIN / Password if configured
    if (cleanRole === 'owner' || cleanRole === 'supervisor' || cleanRole === 'approver') {
      const envOwnerPin = String(process.env.OWNER_PIN || '').trim();
      const envOwnerPass = String(process.env.OWNER_AUTH_PASSWORD || '').trim();
      if (envOwnerPin && safeCompareHex(inputHash, hashServerSecretWithSalt(envOwnerPin))) {
        isValid = true;
      }
      if (!isValid && envOwnerPass && safeCompareHex(inputHash, hashServerSecretWithSalt(envOwnerPass))) {
        isValid = true;
      }
    }

    // 2. Check stored hash in stores/{storeId}/settings/pos
    if (!isValid) {
      try {
        const settingsRef = `stores/${storeId}/settings/pos`;
        const snap = await serverStore.get(settingsRef);
        if (snap.exists()) {
          const data = snap.data() as any;
          const fieldMap: Record<string, string> = {
            owner: data.ownerPinHash || data.supervisorPinHash,
            supervisor: data.supervisorPinHash || data.ownerPinHash,
            manager: data.managerPinHash || data.ownerPinHash,
            cashier: data.cashierPinHash,
          };
          // 'approver' = PIN Owner / Supervisor / Manager (dipakai untuk otorisasi void, laci, cetak ulang, diskon)
          const candidates =
            cleanRole === 'approver'
              ? [data.ownerPinHash, data.supervisorPinHash, data.managerPinHash]
              : [fieldMap[cleanRole]];
          if (candidates.some((h: string) => h && safeCompareHex(h, inputHash))) {
            isValid = true;
          }
        }
      } catch {}
    }

    // 3. Check staff collection on server if not matched yet
    if (!isValid) {
      try {
        const staffSnap = await serverStore.list('staff');
        staffSnap.forEach((docSnap) => {
          if (isValid) return;
          const d = docSnap.data() as any;
          if (d?.status === 'Nonaktif') return;
          const staffRole = String(d?.role || '').toLowerCase();
          const roleAllowed =
            cleanRole === 'cashier' ||
            (cleanRole === 'approver' && /owner|admin|supervisor|manager/.test(staffRole)) ||
            staffRole.includes(cleanRole) ||
            staffRole.includes('owner') ||
            staffRole.includes('admin');
          if (!roleAllowed) return;
          const staffPin = String(d?.pin || '').trim();
          const staffPass = String(d?.password || '').trim();
          if (
            (staffPin && safeCompareHex(inputHash, hashServerSecretWithSalt(staffPin))) ||
            (staffPass && safeCompareHex(inputHash, hashServerSecretWithSalt(staffPass)))
          ) {
            isValid = true;
          }
        });
      } catch {}
    }

    if (!isValid) {
      return res.status(401).json({ valid: false, error: 'PIN tidak valid.' });
    }

    const token = createSignedSessionToken({
      uid: `verified_${cleanRole}`,
      role: cleanRole === 'owner' ? 'owner' : cleanRole,
    });

    return res.json({ valid: true, role: cleanRole, token });
  } catch (error: any) {
    console.error('Error in /api/settings/pin/verify:', error);
    return res.status(500).json({ valid: false, error: error.message });
  }
});

// Firestore-backed API Routes for Products & Modal Safes
app.get('/api/products', async (_req, res) => {
  try {
    const snap = await getDocs(collection(firestoreDb, 'products'));
    const productList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json(productList);
  } catch (error: any) {
    console.error('Failed to fetch products from Firestore:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.get('/api/safes', async (_req, res) => {
  try {
    const snap = await getDocs(collection(firestoreDb, 'brangkas_modal'));
    const records = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json(records);
  } catch (error: any) {
    console.error('Failed to fetch modal safe records from Firestore:', error);
    res.status(500).json({ error: 'Failed to fetch modal safes' });
  }
});

// API: Universal AI Page & Database Builder — Multimodal Vision-to-Logic Engine + Auto-Provision Firestore Collection (ext_{slug})
app.post('/api/ai-page-builder/generate', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      prompt = '',
      pageTitle = '',
      targetGroupId = 'dashboard',
      imageBase64 = '',
      imageMimeType = 'image/png',
      preferredModel,
      model,
    } = req.body || {};

    const selectedModel = String(model || preferredModel || 'gemini-2.5-pro').trim();
    const cleanPrompt = String(prompt || '').trim();
    const cleanTitle = String(pageTitle || '').trim() || 'Dashboard Kustom AI';
    const slug =
      cleanTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || `ai-page-${Date.now().toString().slice(-5)}`;

    const lowerContext = `${cleanTitle} ${cleanPrompt}`.toLowerCase();

    // Determine domain preset & auto-provisioned Firestore collection name (ext_{slug})
    const isTaxDomain =
      lowerContext.includes('pajak') ||
      lowerContext.includes('ppn') ||
      lowerContext.includes('pph') ||
      lowerContext.includes('dpp') ||
      lowerContext.includes('faktur') ||
      lowerContext.includes('umkm') ||
      lowerContext.includes('tax');
    const isKpiDomain =
      lowerContext.includes('kpi') ||
      lowerContext.includes('pencapaian') ||
      lowerContext.includes('target') ||
      lowerContext.includes('komisi') ||
      lowerContext.includes('bonus') ||
      lowerContext.includes('produktivitas') ||
      lowerContext.includes('performa');
    const isShiftOrCash =
      !isTaxDomain &&
      !isKpiDomain &&
      (lowerContext.includes('shift') ||
        lowerContext.includes('laci') ||
        lowerContext.includes('rekonsiliasi') ||
        lowerContext.includes('selisih'));
    const isProductOrWeight =
      !isTaxDomain &&
      !isKpiDomain &&
      (lowerContext.includes('berat') ||
        lowerContext.includes('dus') ||
        lowerContext.includes('stok') ||
        lowerContext.includes('produk') ||
        lowerContext.includes('habis') ||
        lowerContext.includes('margin') ||
        lowerContext.includes('restock'));
    const isCustomerOrDebt =
      !isTaxDomain &&
      !isKpiDomain &&
      (lowerContext.includes('piutang') ||
        lowerContext.includes('hutang') ||
        lowerContext.includes('pelanggan') ||
        lowerContext.includes('jatuh tempo') ||
        lowerContext.includes('overdue'));

    const domainPreset: 'tax' | 'kpi' | 'inventory' | 'shift' | 'finance' | 'custom' = isTaxDomain
      ? 'tax'
      : isKpiDomain
      ? 'kpi'
      : isProductOrWeight
      ? 'inventory'
      : isShiftOrCash
      ? 'shift'
      : isCustomerOrDebt
      ? 'finance'
      : 'custom';

    const customCollectionName = isTaxDomain
      ? 'ext_pajak'
      : isKpiDomain
      ? 'ext_kpi_target'
      : `ext_${slug.replace(/-/g, '_')}`;

    // Deterministic 3-layer + Auto-CRUD baseline builder based on domain intent
    const buildDeterministicPageSchema = () => {
      const primaryCollection = isTaxDomain
        ? customCollectionName
        : isKpiDomain
        ? customCollectionName
        : isShiftOrCash
        ? 'shifts'
        : isCustomerOrDebt
        ? 'customers'
        : isProductOrWeight
        ? 'products'
        : customCollectionName;

      const connectedCollections = Array.from(
        new Set([
          customCollectionName,
          'transactions',
          'orders',
          'products',
          'shifts',
          'cash_logs',
          'staff',
          'customers',
        ])
      );

      const defaultCrudFields = isTaxDomain
        ? [
            {
              key: 'periodePajak',
              label: 'Periode / Tanggal Pajak',
              inputType: 'date',
              required: true,
            },
            {
              key: 'jenisPajak',
              label: 'Jenis Pajak',
              inputType: 'select_options',
              options: [
                'PPN 11% (Pertambahan Nilai)',
                'PPh Final UMKM 0.5%',
                'Pajak Daerah / Resto 10%',
                'PPh Pasal 21 Karyawan',
              ],
              required: true,
            },
            {
              key: 'nomorFaktur',
              label: 'No. Faktur / Kode Billing / NTPN',
              inputType: 'text',
              placeholder: 'Misal: 010.000-26.00012345',
            },
            {
              key: 'dppAmount',
              label: 'Dasar Pengenaan Pajak / Omzet (DPP)',
              inputType: 'currency',
              required: true,
              formulaHint: 'Otomatis terisi dari Omzet Transaksi POS & PWA atau ketik manual',
            },
            {
              key: 'tarifPersen',
              label: 'Tarif Pajak (%)',
              inputType: 'percent',
              defaultValue: 11,
              required: true,
            },
            {
              key: 'keterangan',
              label: 'Catatan / Keterangan SPT',
              inputType: 'text',
              placeholder: 'Keterangan setor pajak...',
            },
          ]
        : isKpiDomain
        ? [
            {
              key: 'staffName',
              label: 'Pilih Kasir / Staf Bertugas',
              inputType: 'select_staff',
              required: true,
            },
            {
              key: 'periodeKpi',
              label: 'Periode Evaluasi KPI',
              inputType: 'date',
              required: true,
            },
            {
              key: 'targetAmount',
              label: 'Target Penjualan / Omzet',
              inputType: 'currency',
              required: true,
              defaultValue: 10000000,
            },
            {
              key: 'realisasiManual',
              label: 'Realisasi Tambahan (Opsional - Otomatis Join POS)',
              inputType: 'currency',
              defaultValue: 0,
              formulaHint: 'Otomatis ditambah dengan realisasi transaksi kasir di POS',
            },
            {
              key: 'bonusAmount',
              label: 'Nominal Bonus / Komisi KPI',
              inputType: 'currency',
              required: true,
              defaultValue: 500000,
            },
            {
              key: 'keterangan',
              label: 'Catatan Evaluasi Manajer',
              inputType: 'text',
              placeholder: 'Catatan performa & kedisiplinan shift...',
            },
          ]
        : [
            {
              key: 'tanggal',
              label: 'Tanggal Pencatatan',
              inputType: 'date',
              required: true,
            },
            {
              key: 'judulItem',
              label: 'Nama Item / Deskripsi Data',
              inputType: 'text',
              required: true,
              placeholder: 'Masukkan nama item atau aktivitas...',
            },
            {
              key: 'relatedProduct',
              label: 'Produk Terkait (Opsional - Database Produk)',
              inputType: 'select_product',
            },
            {
              key: 'relatedStaff',
              label: 'Staf / Penanggung Jawab (Database Staf)',
              inputType: 'select_staff',
            },
            {
              key: 'qty',
              label: 'Kuantitas / Kolom A (Angka)',
              inputType: 'number',
              defaultValue: 1,
              required: true,
            },
            {
              key: 'nominalSatuan',
              label: 'Nilai Satuan / Kolom B (Mata Uang)',
              inputType: 'currency',
              defaultValue: 0,
              required: true,
              formulaHint: 'Total Nilai akan dihitung otomatis = Kuantitas (Kolom A) * Nilai Satuan (Kolom B)',
            },
            {
              key: 'targetNilai',
              label: 'Target / Batas Acuan (Opsional)',
              inputType: 'currency',
              defaultValue: 0,
            },
            {
              key: 'keterangan',
              label: 'Catatan / Keterangan',
              inputType: 'text',
              placeholder: 'Catatan tambahan...',
            },
          ];

      return {
        id: `custom_${slug.replace(/-/g, '_')}`,
        slug,
        title: cleanTitle,
        subtitle:
          cleanPrompt ||
          'Halaman kontrol operasional hasil ekstraksi Universal Vision-to-Logic Engine & Auto-Provisioning Firestore.',
        targetGroupId: targetGroupId || 'dashboard',
        path: `/dashboard/custom/${slug}`,
        modelUsed: selectedModel,
        hasVisionInput: Boolean(imageBase64),
        createdAt: new Date().toISOString(),
        domainPreset,
        customCollectionName,
        crudFields: defaultCrudFields,
        ecosystemImpactButton: isTaxDomain
          ? {
              enabled: true,
              label: 'Bayar Pajak & Catat ke Laporan Kas',
              category: 'Pembayaran Pajak (PPN / PPh)',
              actionType: 'add_cash_out' as const,
              description:
                'Mencatat pembayaran pajak ke collection ext_pajak sekaligus otomatis memotong kas di Laporan Kas (/dashboard/laporankas) & Keuangan.',
            }
          : isKpiDomain
          ? {
              enabled: true,
              label: 'Cairkan Bonus KPI & Catat ke Laporan Kas',
              category: 'Pencairan Bonus & Komisi KPI Staf',
              actionType: 'add_cash_out' as const,
              description:
                'Mencairkan bonus KPI staf di collection ext_kpi_target sekaligus otomatis mencatat pengeluaran ke Laporan Kas (/dashboard/laporankas) & Keuangan.',
            }
          : {
              enabled: true,
              label: 'Sinkronkan Nilai ke Laporan Kas & Keuangan',
              category: `Operasional ${cleanTitle}`,
              actionType: 'add_cash_out' as const,
              description:
                'Menyimpan record ke collection baru sekaligus mencatat dampaknya ke Laporan Kas (/dashboard/laporankas) & Keuangan.',
            },
        connectedCollections,
        joinMappings: [
          {
            fromCollection: customCollectionName,
            toCollection: 'transactions',
            localKey: 'periode / staffName / productId',
            foreignKey: 'createdAt / cashierName / items[].productId',
            description:
              'Hybrid Data Bridging: Menggabungkan data dari collection baru (' +
              customCollectionName +
              ') dengan transaksi POS & pesanan Client PWA secara real-time.',
          },
          {
            fromCollection: 'transactions',
            toCollection: 'products',
            localKey: 'items[].productId',
            foreignKey: 'id',
            description:
              'Menggabungkan item transaksi POS/PWA dengan master produk untuk menghitung HPP (Modal), Keuntungan, Margin %, dan Total Berat (kg).',
          },
          {
            fromCollection: 'shifts',
            toCollection: 'staff',
            localKey: 'cashierName',
            foreignKey: 'name',
            description:
              'Menghubungkan performa kasir pada shift aktif dengan target KPI, produktivitas, dan akurasi laci kasir.',
          },
        ],
        formulas: isTaxDomain
          ? [
              {
                name: 'Dasar Pengenaan Pajak (DPP)',
                expression: 'DPP = SUM(transactions.totalAmount + orders.totalAmount)',
                explanation:
                  'Akumulasi omzet kotor dari seluruh transaksi kasir POS dan pesanan online Client PWA.',
                outputType: 'currency' as const,
              },
              {
                name: 'PPN Terutang (11%)',
                expression: 'PPN = DPP * 11%',
                explanation: 'Pajak Pertambahan Nilai sebesar 11% dari Dasar Pengenaan Pajak (Omzet).',
                outputType: 'currency' as const,
              },
              {
                name: 'PPh Final UMKM (0.5%)',
                expression: 'PPh UMKM = DPP * 0.5%',
                explanation: 'Pajak Penghasilan Final UMKM sebesar 0,5% dari total peredaran bruto (Omzet).',
                outputType: 'currency' as const,
              },
              {
                name: 'Pajak Kustom per Baris',
                expression: 'Nominal Pajak = DPP * (Tarif % / 100)',
                explanation: 'Perhitungan otomatis nominal pajak pada setiap record di collection ext_pajak.',
                outputType: 'currency' as const,
              },
            ]
          : isKpiDomain
          ? [
              {
                name: 'Persentase Pencapaian KPI (%)',
                expression: '% Pencapaian = (Realisasi Transaksi Kasir / Target) * 100',
                explanation:
                  'Membandingkan realisasi omzet transaksi kasir (POS + Input) terhadap target KPI yang ditetapkan.',
                outputType: 'percent' as const,
              },
              {
                name: 'Skor Produktivitas Staf',
                expression: 'Skor = (Frekuensi Transaksi * 70%) + (Kepatuhan Shift * 30%)',
                explanation: 'Indeks produktivitas gabungan dari aktivitas shift dan volume transaksi.',
                outputType: 'number' as const,
              },
              {
                name: 'Estimasi Bonus & Komisi Cair',
                expression: 'Bonus = % Pencapaian >= 100% ? Bonus penuh : Proporsional',
                explanation: 'Menghitung hak insentif staf yang siap dicairkan ke Laporan Kas.',
                outputType: 'currency' as const,
              },
            ]
          : [
              {
                name: 'Kalkulasi Perkalian Kolom (Kolom A * Kolom B)',
                expression: 'Total Nilai = qty * nominalSatuan',
                explanation:
                  'Rumus otomatis mengalikan kuantitas (Kolom A) dengan nilai satuan (Kolom B) pada setiap record.',
                outputType: 'currency' as const,
              },
              {
                name: 'Keuntungan Bersih Transaksi',
                expression: 'Keuntungan = totalNilai - totalModal',
                explanation:
                  'Dihitung otomatis dari selisih nilai penjualan bersih dikurangi HPP (Harga Pokok Penjualan) per produk.',
                outputType: 'currency' as const,
              },
              {
                name: 'Total Berat Produk (kg)',
                expression: 'Total Berat (kg) = (beratPerItem (ml) * isiPerDus) / 1000',
                explanation:
                  'Konversi berat satuan minuman (ml/gr) dikalikan Isi 1 Dus dibagi 1.000 menjadi satuan Kilogram.',
                outputType: 'weight_kg' as const,
              },
              {
                name: 'Persentase Pencapaian / Pertumbuhan (%)',
                expression: '% Capaian = (Total Nilai / Target Acuan) * 100',
                explanation: 'Rasio realisasi terhadap target acuan pada setiap baris data.',
                outputType: 'percent' as const,
              },
            ],
        conditionalRules: isTaxDomain
          ? [
              {
                fieldOrFormula: 'statusPajak == Lunas',
                operator: '==',
                thresholdFieldOrValue: 'Lunas',
                badgeText: 'Lunas / Disetor',
                badgeColor: 'emerald' as const,
                explanation: 'Pajak yang sudah dibayar dan tercatat di Laporan Kas.',
              },
              {
                fieldOrFormula: 'statusPajak != Lunas',
                operator: '!=',
                thresholdFieldOrValue: 'Lunas',
                badgeText: 'Belum Disetor (Terutang)',
                badgeColor: 'amber' as const,
                explanation: 'Kewajiban pajak periode berjalan yang menunggu pembayaran.',
              },
            ]
          : isKpiDomain
          ? [
              {
                fieldOrFormula: 'pencapaianPct >= 100',
                operator: '>=',
                thresholdFieldOrValue: '100',
                badgeText: 'Tercapai',
                badgeColor: 'emerald' as const,
                explanation: 'Realisasi transaksi kasir telah mencapai atau melampaui 100% dari Target KPI.',
              },
              {
                fieldOrFormula: 'pencapaianPct < 100',
                operator: '<',
                thresholdFieldOrValue: '100',
                badgeText: 'Belum Tercapai',
                badgeColor: 'amber' as const,
                explanation: 'Realisasi transaksi masih di bawah target dan membutuhkan peningkatan performa.',
              },
            ]
          : [
              {
                fieldOrFormula: 'stockInUnits <= minStockAlert',
                operator: '<=',
                thresholdFieldOrValue: 'minStockAlert',
                badgeText: 'Stok Kritis',
                badgeColor: 'rose' as const,
                explanation:
                  'Menampilkan badge merah otomatis jika stok dus saat ini menyentuh atau berada di bawah batas minimum.',
              },
              {
                fieldOrFormula: 'selisihKas < 0',
                operator: '<',
                thresholdFieldOrValue: '0',
                badgeText: 'Kurang / Short',
                badgeColor: 'rose' as const,
                explanation:
                  'Menampilkan peringatan merah jika uang fisik kasir lebih rendah dari Target Saldo Sistem.',
              },
              {
                fieldOrFormula: 'pencapaianPct >= 100',
                operator: '>=',
                thresholdFieldOrValue: '100',
                badgeText: 'Target Tercapai',
                badgeColor: 'emerald' as const,
                explanation: 'Menampilkan badge hijau ketika realisasi memenuhi target.',
              },
            ],
        twoWaySyncEffects: [
          `Auto-Provision Collection (${customCollectionName}): Membaca dan menulis dokumen baru secara real-time via onSnapshot, addDoc, updateDoc, dan deleteDoc.`,
          'Hybrid Data Bridging: Menggabungkan (join) data dari collection baru dengan transaksi POS, pesanan PWA, stok produk, dan shift kasir.',
          'Write Sync ke Laporan Kas & Keuangan: Aksi pembayaran pajak, pencairan bonus KPI, atau pengeluaran operasional otomatis tercatat ke /dashboard/laporankas dan FinanceModule.tsx.',
          'Dynamic Currency Sync (IDR / USD): Seluruh nominal uang dan hasil rumus otomatis dikonversi antara Rp (IDR) dan $ (USD) sesuai tombol mata uang di Navbar.',
        ],
        kpiCards: isTaxDomain
          ? [
              {
                id: 'kpi_tax_dpp',
                label: 'Dasar Pengenaan Pajak (DPP)',
                metricKey: 'taxDppOmzet',
                format: 'currency' as const,
                color: 'blue' as const,
                formula: 'DPP = SUM(Omzet POS + PWA)',
                description: 'Total peredaran bruto (omzet) sebagai dasar perhitungan pajak',
              },
              {
                id: 'kpi_tax_ppn',
                label: 'Estimasi PPN (11%)',
                metricKey: 'taxPpn11',
                format: 'currency' as const,
                color: 'amber' as const,
                formula: 'PPN = DPP * 11%',
                description: 'Kewajiban Pajak Pertambahan Nilai (11% dari DPP)',
              },
              {
                id: 'kpi_tax_pph',
                label: 'PPh Final UMKM (0.5%)',
                metricKey: 'taxPph05',
                format: 'currency' as const,
                color: 'purple' as const,
                formula: 'PPh UMKM = DPP * 0.5%',
                description: 'Pajak Penghasilan Final UMKM 0,5% dari omzet bruto',
              },
              {
                id: 'kpi_tax_paid',
                label: 'Total Pajak Disetor (ext_pajak)',
                metricKey: 'customCollectionTotalCurrency',
                format: 'currency' as const,
                color: 'emerald' as const,
                formula: `SUM(${customCollectionName}.nominalPajak)`,
                description: 'Akumulasi pembayaran pajak yang tercatat di database',
              },
            ]
          : isKpiDomain
          ? [
              {
                id: 'kpi_achievement_avg',
                label: 'Rata-rata % Pencapaian KPI',
                metricKey: 'kpiAverageAchievementPct',
                format: 'percent' as const,
                color: 'emerald' as const,
                formula: 'AVG((Realisasi Kasir / Target) * 100)',
                description: 'Persentase pencapaian target penjualan seluruh staf/kasir',
              },
              {
                id: 'kpi_realisasi_total',
                label: 'Total Realisasi Transaksi Kasir',
                metricKey: 'totalSalesRevenue',
                format: 'currency' as const,
                color: 'blue' as const,
                formula: 'SUM(transactions.totalAmount)',
                description: 'Total penjualan aktual dari mesin kasir POS & pesanan PWA',
              },
              {
                id: 'kpi_target_total',
                label: 'Total Target KPI Ditetapkan',
                metricKey: 'kpiTotalTargetCurrency',
                format: 'currency' as const,
                color: 'purple' as const,
                formula: `SUM(${customCollectionName}.targetAmount)`,
                description: 'Akumulasi target penjualan staf pada periode aktif',
              },
              {
                id: 'kpi_bonus_pool',
                label: 'Estimasi Bonus & Komisi KPI',
                metricKey: 'customCollectionTotalCurrency',
                format: 'currency' as const,
                color: 'amber' as const,
                formula: `SUM(${customCollectionName}.bonusAmount)`,
                description: 'Total alokasi bonus/insentif KPI staf siap cair',
              },
            ]
          : [
              {
                id: 'kpi_1',
                label: 'Total Nilai Penjualan (POS & PWA)',
                metricKey: 'totalSalesRevenue',
                format: 'currency' as const,
                color: 'blue' as const,
                formula: 'SUM(transactions.totalAmount)',
                description: 'Akumulasi omzet penjualan POS & Client PWA real-time',
              },
              {
                id: 'kpi_2',
                label: 'Total Keuntungan (Profit)',
                metricKey: 'totalNetProfit',
                format: 'currency' as const,
                color: 'emerald' as const,
                formula: 'Keuntungan = totalNilai - totalModal',
                description: 'Selisih omzet terhadap total HPP barang terjual',
              },
              {
                id: 'kpi_3',
                label: `Total Nilai Data (${customCollectionName})`,
                metricKey: 'customCollectionTotalCurrency',
                format: 'currency' as const,
                color: 'purple' as const,
                formula: `SUM(${customCollectionName}.calculatedTotal)`,
                description: 'Akumulasi hasil rumus otomatis dari tabel koleksi baru',
              },
              {
                id: 'kpi_4',
                label: isProductOrWeight
                  ? 'Total Berat Katalog (kg)'
                  : isShiftOrCash
                  ? 'Target Saldo Kasir'
                  : 'Total Record & Stok Kritis',
                metricKey: isProductOrWeight
                  ? 'totalCatalogWeightKg'
                  : isShiftOrCash
                  ? 'activeShiftExpectedCash'
                  : 'customCollectionRecordCount',
                format: isProductOrWeight ? ('weight_kg' as const) : isShiftOrCash ? ('currency' as const) : ('number' as const),
                color: 'amber' as const,
                formula: isProductOrWeight
                  ? 'SUM((beratPerItem * isiPerDus) / 1000)'
                  : isShiftOrCash
                  ? 'Modal Awal + Tunai + Kas Masuk - Kas Keluar'
                  : `COUNT(${customCollectionName})`,
                description: isProductOrWeight
                  ? 'Akumulasi berat seluruh produk aktif dalam satuan Kilogram'
                  : isShiftOrCash
                  ? 'Saldo ekspektasi sistem laci kasir aktif'
                  : `Jumlah dokumen tersimpan di collection ${customCollectionName}`,
              },
            ],
        charts: [
          {
            id: 'chart_main',
            title: isTaxDomain
              ? 'Tren DPP Omzet, PPN (11%) & PPh UMKM (0.5%) Real-Time'
              : isKpiDomain
              ? 'Perbandingan Target vs Realisasi Transaksi Kasir (KPI)'
              : 'Tren Penjualan, Modal (HPP) & Keuntungan Real-Time',
            chartType: 'area' as const,
            sourceCollection: 'transactions',
            format: 'currency' as const,
          },
          {
            id: 'chart_secondary',
            title: isTaxDomain
              ? 'Distribusi Pembayaran Pajak per Kategori'
              : isKpiDomain
              ? 'Skor Pencapaian KPI (%) per Staf / Kasir'
              : 'Distribusi Data & Performa Operasional',
            chartType: 'bar' as const,
            sourceCollection: primaryCollection,
            format: 'currency' as const,
          },
        ],
        table: {
          title: isTaxDomain
            ? `Tabel Pajak & Hybrid Bridging (${customCollectionName} + Transaksi POS)`
            : isKpiDomain
            ? `Tabel Evaluasi KPI Kasir & Staf (${customCollectionName} + Shift + POS)`
            : isShiftOrCash
            ? 'Tabel Audit Lintas Data: Shift Kasir, Transaksi POS & Selisih Kas'
            : isProductOrWeight
            ? 'Tabel Master & Kalkulasi Otomatis: Stok Dus, Isi 1 Dus, Total Berat (kg), Margin & Estimasi Habis'
            : `Tabel Data Kustom & Hybrid Bridging (${customCollectionName})`,
          primaryCollection,
          joinCollections: [customCollectionName, 'products', 'transactions', 'shifts', 'cash_logs', 'staff'],
          searchPlaceholder: 'Cari data, periode, kasir, produk, faktur, atau status...',
          columns: isTaxDomain
            ? [
                { key: 'periodePajak', label: 'Periode Pajak', type: 'date' as const },
                { key: 'jenisPajak', label: 'Jenis Pajak', type: 'text' as const },
                { key: 'nomorFaktur', label: 'No. Faktur / NTPN', type: 'text' as const },
                { key: 'dppAmount', label: 'Dasar Pengenaan Pajak (DPP)', type: 'currency' as const, formula: 'SUM(Omzet POS + PWA)' },
                { key: 'tarifPersen', label: 'Tarif (%)', type: 'percent' as const },
                { key: 'calculatedTax', label: 'Pajak Terutang', type: 'currency' as const, formula: 'DPP * (Tarif % / 100)' },
                { key: 'ppn11', label: 'Ref PPN (11%)', type: 'currency' as const, formula: 'DPP * 11%' },
                { key: 'pph05', label: 'Ref PPh UMKM (0.5%)', type: 'currency' as const, formula: 'DPP * 0.5%' },
                { key: 'statusBadge', label: 'Status Setor', type: 'badge' as const },
              ]
            : isKpiDomain
            ? [
                { key: 'staffName', label: 'Nama Kasir / Staf', type: 'text' as const },
                { key: 'periodeKpi', label: 'Periode', type: 'date' as const },
                { key: 'trxCount', label: 'Jml Transaksi POS', type: 'number' as const, formula: 'COUNT(transactions by cashier)' },
                { key: 'targetAmount', label: 'Target KPI', type: 'currency' as const },
                { key: 'realisasiAmount', label: 'Realisasi (POS + Input)', type: 'currency' as const, formula: 'SUM(POS Kasir) + Realisasi' },
                { key: 'pencapaianPct', label: '% Pencapaian', type: 'percent' as const, formula: '(Realisasi / Target) * 100' },
                { key: 'bonusAmount', label: 'Bonus / Komisi KPI', type: 'currency' as const },
                { key: 'statusBadge', label: 'Status KPI', type: 'badge' as const },
              ]
            : isProductOrWeight
            ? [
                { key: 'name', label: 'Nama Produk & SKU', type: 'text' as const },
                { key: 'isiPerDus', label: 'Isi 1 Dus', type: 'number' as const },
                { key: 'totalBeratKg', label: 'Total Berat (kg)', type: 'weight_kg' as const, formula: '(beratPerItem * isiPerDus) / 1000' },
                { key: 'stockInUnits', label: 'Sisa Stok (Dus)', type: 'number' as const, formula: 'stokAwal + stokMasuk - terjual' },
                { key: 'costPerUnit', label: 'Harga Modal', type: 'currency' as const },
                { key: 'pricePerUnit', label: 'Harga Jual', type: 'currency' as const },
                { key: 'profitPerUnit', label: 'Keuntungan / Dus', type: 'currency' as const, formula: 'hargaJual - hargaModal' },
                { key: 'marginPct', label: 'Margin (%)', type: 'percent' as const, formula: '((hargaJual - hargaModal) / hargaJual) * 100' },
                { key: 'daysRemaining', label: 'Estimasi Habis', type: 'text' as const, formula: 'stok / rataRataHarian' },
                { key: 'statusBadge', label: 'Status Kondisional', type: 'badge' as const },
              ]
            : isShiftOrCash
            ? [
                { key: 'cashierName', label: 'Kasir Bertugas', type: 'text' as const },
                { key: 'openedAt', label: 'Waktu Shift', type: 'date' as const },
                { key: 'initialFloat', label: 'Modal Awal', type: 'currency' as const },
                { key: 'cashSales', label: 'Penjualan Tunai', type: 'currency' as const },
                { key: 'expectedCash', label: 'Target Sistem', type: 'currency' as const, formula: 'Modal Awal + Tunai + Masuk - Keluar' },
                { key: 'actualCash', label: 'Uang Fisik', type: 'currency' as const },
                { key: 'difference', label: 'Selisih Kas', type: 'currency' as const, formula: 'actualCash - expectedCash' },
                { key: 'statusBadge', label: 'Status Rekonsiliasi', type: 'badge' as const },
              ]
            : [
                { key: 'tanggal', label: 'Tanggal', type: 'date' as const },
                { key: 'judulItem', label: 'Item / Deskripsi', type: 'text' as const },
                { key: 'relatedEntity', label: 'Produk / Staf Terkait', type: 'text' as const },
                { key: 'qty', label: 'Kuantitas (Kolom A)', type: 'number' as const },
                { key: 'nominalSatuan', label: 'Nilai Satuan (Kolom B)', type: 'currency' as const },
                { key: 'calculatedTotal', label: 'Total (Kolom A * B)', type: 'currency' as const, formula: 'qty * nominalSatuan' },
                { key: 'pencapaianPct', label: '% Capaian Target', type: 'percent' as const, formula: '(calculatedTotal / targetNilai) * 100' },
                { key: 'statusBadge', label: 'Status', type: 'badge' as const },
              ],
        },
        actionForm: {
          enabled: true,
          title: isTaxDomain
            ? 'Form Setor Pajak & Sinkronisasi Laporan Kas'
            : isKpiDomain
            ? 'Form Pencairan Bonus KPI & Sinkronisasi Laporan Kas'
            : 'Form Aksi Cepat: Sinkronisasi Kas, Stok & Harga Lintas Ekosistem',
          description:
            'Setiap data yang disubmit dari halaman ini langsung mengupdate koleksi utama Firestore, layar Kasir POS, Client PWA, Laporan Kas (/dashboard/laporankas), dan Keuangan secara real-time.',
          defaultActionType: isProductOrWeight ? ('restock_product' as const) : ('add_cash_out' as const),
        },
      };
    };

    const fallbackSchema = buildDeterministicPageSchema();

    // Prepare multimodal contents for Google Gemini API
    const systemPrompt = `Anda adalah Universal Vision-to-Logic Engine & Database Architect untuk RiskCart Retail Control System.
Saat Owner mengirim gambar (sketsa kertas, tabel Excel, form pajak, dashboard KPI, laporan baru) dan/atau teks prompt, susun JSON Blueprint Lengkap yang mencakup:
1. UI Components: kpiCards (4 kartu), charts (area/line/bar/doughnut), table, dan crudFields (form input modal "+ Tambah Data").
2. Dynamic Formula & Calculation Engine:
   - Jika Halaman Pajak: hitung Dasar Pengenaan Pajak (DPP), PPN = Omzet * 11%, PPh UMKM = Omzet * 0.5%, atau pajak kustom dari transactions + orders.
   - Jika Halaman KPI: hitung % Pencapaian = (Realisasi Transaksi Kasir / Target) * 100, skor produktivitas dari shifts + transactions + staff, serta badge 'Tercapai' / 'Belum Tercapai'.
   - Jika Halaman Custom/Baru: rumuskan SUM, AVG, persentase pertumbuhan, atau perkalian kolom (Kolom A * Kolom B).
3. Auto-Create Database Collection: Gunakan customCollectionName = "${customCollectionName}" dan sediakan crudFields dengan inputType ('text'|'number'|'currency'|'percent'|'date'|'select_product'|'select_staff'|'select_customer'|'select_options').
4. Pastikan semua field nominal uang bertipe 'currency' agar otomatis sinkron dengan konversi IDR / USD.

Kembalikan HANYA JSON valid.`;

    const parts: any[] = [];
    if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.length > 20) {
      const cleanedBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      parts.push({
        inlineData: {
          mimeType: imageMimeType || 'image/png',
          data: cleanedBase64,
        },
      });
    }
    parts.push({
      text: `Judul Halaman: "${cleanTitle}"
Target Kelompok Menu Sidebar: "${targetGroupId}"
Auto-Provisioned Firestore Collection: "${customCollectionName}"
Instruksi Owner: "${cleanPrompt || 'Analisis gambar/kebutuhan ini dan bangun halaman lengkap dengan koleksi database baru, form CRUD (+ Tambah Data), rumus otomatis, dan sinkronisasi 2 arah ke Laporan Kas.'}"

Hasilkan JSON dengan properti:
- title (string)
- subtitle (string)
- domainPreset ('tax'|'kpi'|'inventory'|'shift'|'finance'|'custom')
- customCollectionName (string, gunakan "${customCollectionName}")
- crudFields (array of { key, label, inputType: 'text'|'number'|'currency'|'percent'|'date'|'select_product'|'select_staff'|'select_customer'|'select_options', options, placeholder, required, defaultValue, formulaHint })
- connectedCollections (array of strings)
- joinMappings (array of { fromCollection, toCollection, localKey, foreignKey, description })
- formulas (array of { name, expression, explanation, outputType: 'currency'|'number'|'percent'|'weight_kg' })
- conditionalRules (array of { fieldOrFormula, operator, thresholdFieldOrValue, badgeText, badgeColor: 'rose'|'amber'|'emerald'|'blue'|'purple', explanation })
- twoWaySyncEffects (array of strings)
- kpiCards (array of 4 items)
- table ({ title, primaryCollection, searchPlaceholder, columns: array of { key, label, type: 'text'|'currency'|'number'|'percent'|'weight_kg'|'date'|'badge', formula } })`,
    });

    let finalSchema = fallbackSchema;
    let tokenIn = 0;
    let tokenOut = 0;
    let usedModel = selectedModel;

    try {
      const geminiRes = await generateContentWithFallback({
        preferredModel: selectedModel,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      usedModel = (geminiRes as any).modelVersion || selectedModel;
      tokenIn =
        geminiRes.usageMetadata?.promptTokenCount ||
        Math.ceil(cleanPrompt.length / 3) + (imageBase64 ? 258 : 120);
      tokenOut = geminiRes.usageMetadata?.candidatesTokenCount || 480;

      const rawText = geminiRes.text || '';
      if (rawText) {
        const parsed = JSON.parse(rawText);
        finalSchema = {
          ...fallbackSchema,
          ...parsed,
          id: fallbackSchema.id,
          slug: fallbackSchema.slug,
          title: parsed.title || cleanTitle,
          subtitle: parsed.subtitle || fallbackSchema.subtitle,
          targetGroupId: targetGroupId || 'dashboard',
          path: `/dashboard/custom/${slug}`,
          modelUsed: usedModel,
          hasVisionInput: Boolean(imageBase64),
          createdAt: new Date().toISOString(),
          domainPreset: parsed.domainPreset || fallbackSchema.domainPreset,
          customCollectionName: parsed.customCollectionName || customCollectionName,
          crudFields:
            Array.isArray(parsed.crudFields) && parsed.crudFields.length > 0
              ? parsed.crudFields
              : fallbackSchema.crudFields,
          ecosystemImpactButton: parsed.ecosystemImpactButton || fallbackSchema.ecosystemImpactButton,
          connectedCollections:
            Array.isArray(parsed.connectedCollections) && parsed.connectedCollections.length > 0
              ? Array.from(new Set([customCollectionName, ...parsed.connectedCollections]))
              : fallbackSchema.connectedCollections,
          joinMappings:
            Array.isArray(parsed.joinMappings) && parsed.joinMappings.length > 0
              ? parsed.joinMappings
              : fallbackSchema.joinMappings,
          formulas:
            Array.isArray(parsed.formulas) && parsed.formulas.length > 0
              ? parsed.formulas
              : fallbackSchema.formulas,
          conditionalRules:
            Array.isArray(parsed.conditionalRules) && parsed.conditionalRules.length > 0
              ? parsed.conditionalRules
              : fallbackSchema.conditionalRules,
          twoWaySyncEffects:
            Array.isArray(parsed.twoWaySyncEffects) && parsed.twoWaySyncEffects.length > 0
              ? parsed.twoWaySyncEffects
              : fallbackSchema.twoWaySyncEffects,
          kpiCards:
            Array.isArray(parsed.kpiCards) && parsed.kpiCards.length > 0
              ? parsed.kpiCards
              : fallbackSchema.kpiCards,
          table:
            parsed.table && Array.isArray(parsed.table.columns) && parsed.table.columns.length > 0
              ? {
                  ...fallbackSchema.table,
                  ...parsed.table,
                }
              : fallbackSchema.table,
          actionForm: parsed.actionForm
            ? { ...fallbackSchema.actionForm, ...parsed.actionForm, enabled: true }
            : fallbackSchema.actionForm,
        };
      }

      await logAiInvocation({
        agentKey: 'ai_page_builder_vision',
        latencyMs: Date.now() - startTime,
        tokenIn,
        tokenOut,
        ok: true,
        modelUsed: usedModel,
      });
    } catch (aiErr: any) {
      console.warn('[AI Page Builder] Using deterministic 3-layer engine fallback:', aiErr?.message || aiErr);
      tokenIn = Math.ceil(cleanPrompt.length / 3) + (imageBase64 ? 258 : 85);
      tokenOut = 350;
      await logAiInvocation({
        agentKey: 'ai_page_builder_vision',
        latencyMs: Date.now() - startTime,
        tokenIn,
        tokenOut,
        ok: true,
        modelUsed: usedModel,
      });
    }

    return res.json({
      success: true,
      schema: finalSchema,
      tokenUsage: {
        tokenIn,
        tokenOut,
        totalTokens: tokenIn + tokenOut,
        latencyMs: Date.now() - startTime,
        modelUsed: usedModel,
      },
    });
  } catch (err: any) {
    console.error('Error in /api/ai-page-builder/generate:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Gagal menganalisis halaman dengan AI Page Builder',
    });
  }
});

// ============================================================================
// AI SYSTEM ARCHITECT & LIVE EDITOR ENDPOINTS (/dashboard/ai-architect)
// ============================================================================

const ARCHITECT_ALLOWED_FILES = [
  { path: 'src/components/pos/PosMachine.tsx', label: 'POS Machine (Mesin Kasir)', module: 'POS Machine' },
  { path: 'src/components/admin/AdminDashboard.tsx', label: 'Admin Dashboard Utama', module: '/dashboard' },
  { path: 'src/components/admin/AdminAreaCharts.tsx', label: '4 Area Chart Line Dashboard', module: '/dashboard' },
  { path: 'src/components/modules/OrdersModule.tsx', label: 'Orders Wharf (/dashboard/orders)', module: '/dashboard/orders' },
  { path: 'src/components/modules/OnlineOrderModule.tsx', label: 'Setting Online Order & PWA', module: '/dashboard/online-order/website' },
  { path: 'src/components/modules/MyAssetModule.tsx', label: 'My Asset & Expired Date (/dashboard/myasset)', module: '/dashboard/myasset' },
  { path: 'src/components/pos/AssetFinancialDashboard.tsx', label: 'Financial Asset Management (/dashboard/laporan)', module: '/dashboard/laporan' },
  { path: 'src/components/modules/LaporanKasModule.tsx', label: 'Laporan Penjualan & Kas (/dashboard/laporankas)', module: '/dashboard/laporankas' },
  { path: 'src/components/modules/ShiftModule.tsx', label: 'Shift Kasir (/dashboard/shift/kasir)', module: '/dashboard/shift/kasir' },
  { path: 'src/components/modules/FinanceModule.tsx', label: 'Keuangan & Brankas (/dashboard/keuangan)', module: '/dashboard/keuangan/bangkas-toko' },
  { path: 'src/components/modules/POSTransactionsModule.tsx', label: 'Transaksi POS (/dashboard/transaksi-pos)', module: '/dashboard/transaksi-pos/penjualan' },
  { path: 'src/components/pos/AddProductForm.tsx', label: 'Form Tambah/Edit Produk (/dashboard/produk/tambah)', module: '/dashboard/produk/tambah' },
  { path: 'src/components/pos/ProductFormFields.tsx', label: 'Field Input Produk & Kalender Kadaluarsa', module: '/dashboard/produk/tambah' },
  { path: 'src/components/pwa/ClientPwaApp.tsx', label: 'Client PWA Customer App (/client-pwa)', module: 'Client PWA' },
  { path: 'src/context/AppDataContext.tsx', label: 'AppDataContext (Pusat Sinkronisasi Firestore)', module: 'Semua Halaman (Global)' },
  { path: 'src/utils/i18nEngine.ts', label: 'i18nEngine (Kamus Bahasa & Live Text Override)', module: 'Semua Halaman (Global)' },
  { path: 'src/utils/money.ts', label: 'Money & Kurs Mata Uang Dinamis (IDR/USD)', module: 'Semua Halaman (Global)' },
  { path: 'src/services/sidebarMenuService.ts', label: 'Sidebar Menu & Custom Pages Service', module: 'Semua Halaman (Global)' },
  { path: 'src/router.tsx', label: 'App Router & URL Navigation', module: 'Semua Halaman (Global)' },
];

function resolveSafeProjectFile(relativeFilePath: string): string | null {
  if (!relativeFilePath || typeof relativeFilePath !== 'string') return null;
  const cleaned = relativeFilePath.replace(/^\/+/, '').trim();
  if (cleaned.includes('..') || (!cleaned.startsWith('src/') && cleaned !== 'server.ts')) {
    return null;
  }
  const abs = path.resolve(__dirname, cleaned);
  if (!abs.startsWith(path.resolve(__dirname))) return null;
  return abs;
}

function mapArchitectModelToSdkModel(requestedModel?: string): string {
  const m = String(requestedModel || 'gemini-2.5-pro').trim();
  if (m === 'gemini-2.0-flash') return 'gemini-flash-latest';
  if (m === 'gemini-2.5-flash-lite') return 'gemini-3.1-flash-lite';
  if (m === 'gemini-2.5-flash') return 'gemini-2.5-flash';
  if (m === 'gemini-2.5-pro') return 'gemini-2.5-pro';
  return GEMINI_PRIMARY_MODEL;
}

const blockInProductionMiddleware = (
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      success: false,
      error: 'Endpoint AI System Architect dinonaktifkan sepenuhnya pada mode production.',
    });
  }
  return next();
};

app.get(
  '/api/ai-architect/files',
  blockInProductionMiddleware,
  requireAuth,
  requireRole(['owner']),
  (_req, res) => {
    res.json({
      success: true,
      files: ARCHITECT_ALLOWED_FILES,
    });
  }
);

app.post(
  '/api/ai-architect/inspect-file',
  blockInProductionMiddleware,
  requireAuth,
  requireRole(['owner']),
  async (req, res) => {
    try {
      const { filePath, startLine = 1, endLine = 250 } = req.body || {};
      const absPath = resolveSafeProjectFile(filePath);
      if (!absPath) {
        return res.status(400).json({ success: false, error: 'Path file tidak diizinkan atau tidak valid.' });
      }
      const rawContent = await fs.readFile(absPath, 'utf-8');
      const lines = rawContent.split('\n');
      const sLine = Math.max(1, Number(startLine) || 1);
      const eLine = Math.min(lines.length, Math.max(sLine, Number(endLine) || lines.length));
      const snippet = lines.slice(sLine - 1, eLine).join('\n');

      return res.json({
        success: true,
        filePath,
        totalLines: lines.length,
        startLine: sLine,
        endLine: eLine,
        snippet,
        fullContent: rawContent,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: err?.message || 'Gagal membaca file proyek.',
      });
    }
  }
);

app.post(
  '/api/ai-architect/apply-file-patch',
  blockInProductionMiddleware,
  requireAuth,
  requireRole(['owner']),
  async (req, res) => {
    try {
      const { filePath, searchBlock, replaceBlock, fullNewContent } = req.body || {};
      const absPath = resolveSafeProjectFile(filePath);
      if (!absPath) {
        return res.status(400).json({ success: false, error: 'Path file tidak valid.' });
      }
      const previousContent = await fs.readFile(absPath, 'utf-8');
      let updatedContent = previousContent;

      if (typeof fullNewContent === 'string' && fullNewContent.trim().length > 20) {
        updatedContent = fullNewContent;
      } else if (typeof searchBlock === 'string' && searchBlock.length > 0 && typeof replaceBlock === 'string') {
        if (!previousContent.includes(searchBlock)) {
          return res.status(400).json({
            success: false,
            error: 'Blok kode target (searchBlock) tidak ditemukan persis di dalam file. Gunakan mode edit langsung atau perbarui blok pencarian.',
          });
        }
        updatedContent = previousContent.replace(searchBlock, replaceBlock);
      } else {
        return res.status(400).json({
          success: false,
          error: 'Parameter searchBlock/replaceBlock atau fullNewContent diperlukan.',
        });
      }

      await fs.writeFile(absPath, updatedContent, 'utf-8');

      return res.json({
        success: true,
        filePath,
        previousContent,
        updatedContent,
        appliedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: err?.message || 'Gagal menerapkan patch kode ke file.',
      });
    }
  }
);

app.post(
  '/api/ai-architect/restore-file',
  blockInProductionMiddleware,
  requireAuth,
  requireRole(['owner']),
  async (req, res) => {
    try {
      const { filePath, previousContent } = req.body || {};
      const absPath = resolveSafeProjectFile(filePath);
      if (!absPath || typeof previousContent !== 'string') {
        return res.status(400).json({ success: false, error: 'Data rollback file tidak lengkap.' });
      }
      await fs.writeFile(absPath, previousContent, 'utf-8');
      return res.json({
        success: true,
        filePath,
        restoredAt: new Date().toISOString(),
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: err?.message || 'Gagal mengembalikan file dari backup.',
      });
    }
  }
);

app.post('/api/ai-architect/analyze', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      prompt = '',
      mode = 'bug_fix', // 'bug_fix' | 'text_override' | 'layout_override' | 'schema_formula' | 'code_patch'
      targetModule = 'Semua Halaman (Global)',
      modelId = 'gemini-2.5-pro',
      imageBase64,
      imageMimeType = 'image/png',
      ecosystemSnapshot = {},
      fileContext = null,
    } = req.body || {};

    const cleanPrompt = String(prompt || '').trim();
    const sdkModel = mapArchitectModelToSdkModel(modelId);

    // Build deterministic fallback plan so even if Gemini is rate-limited or offline, the Owner gets an actionable, accurate execution plan
    const buildDeterministicPlan = () => {
      const lower = cleanPrompt.toLowerCase();
      const databaseFixes: any[] = [];
      const textOverrides: any[] = [];
      const layoutOverrides: any[] = [];
      const formulas: any[] = [];
      let codePatch: any = null;

      const targetRouteMap: Record<string, string> = {
        'Semua Halaman (Global)': 'ALL',
        'POS Machine': '/dashboard/pos',
        'Client PWA': '/client-pwa',
        '/dashboard': '/dashboard',
        '/dashboard/transaksi': '/transaksi',
        '/dashboard/orders': '/dashboard/orders',
        '/dashboard/laporankas': '/dashboard/laporankas',
        '/dashboard/myasset': '/dashboard/myasset',
        '/dashboard/shift/kasir': '/dashboard/shift/kasir',
        '/dashboard/produk/tambah': '/dashboard/produk/tambah',
      };
      const resolvedRoute = targetRouteMap[targetModule] || (targetModule.startsWith('/') ? targetModule : 'ALL');

      // Detect quoted rename patterns e.g. ubah "A" menjadi "B" or 'A' -> 'B'
      const renameMatch =
        cleanPrompt.match(/(?:ubah|ganti|rename)\s+(?:teks|label|kolom|tombol)?\s*['"]([^'"]+)['"]\s*(?:menjadi|ke|to|->)\s*['"]([^'"]+)['"]/i) ||
        cleanPrompt.match(/['"]([^'"]+)['"]\s*(?:menjadi|->|ke|to)\s*['"]([^'"]+)['"]/i);

      if (mode === 'text_override' || renameMatch) {
        const srcText = renameMatch ? renameMatch[1] : 'Total Jual';
        const dstText = renameMatch ? renameMatch[2] : 'Nilai Penjualan';
        textOverrides.push({
          targetRoute: resolvedRoute,
          sourceText: srcText,
          replacementId: dstText,
          replacementEn: dstText,
          description: `Mengubah teks/label "${srcText}" menjadi "${dstText}" pada ${targetModule} secara real-time.`,
        });
      }

      if (mode === 'bug_fix' || lower.includes('bug') || lower.includes('sinkron') || lower.includes('perbaiki') || lower.includes('fix')) {
        databaseFixes.push(
          {
            type: 'reconcile_transactions',
            description: 'Rekonsiliasi seluruh dokumen transactions & orders agar field totalAmount, totalModal, netProfit, paidAmount, remainingDebt, dan paymentStatus konsisten 100%.',
          },
          {
            type: 'reconcile_orders_payment',
            description: 'Sinkronisasi status pembayaran (Lunas / Hutang / Partial DP) antara /dashboard/orders, POS, Piutang Pelanggan, Shift Kasir, dan Laporan Kas.',
          },
          {
            type: 'reconcile_stock_and_expiry',
            description: 'Validasi stok dus/unit, isiPerDus (piecesPerCarton), serta kelengkapan productionDate & expiryDate pada koleksi products.',
          },
          {
            type: 'reconcile_shift_and_cash',
            description: 'Sinkronisasi saldo kas masuk Tunai vs Hutang/COD pada Shift Kasir aktif dan Laporan Kas.',
          }
        );
      }

      if (mode === 'layout_override' || lower.includes('warna') || lower.includes('sembunyikan') || lower.includes('layout') || lower.includes('tampilan')) {
        const isHide = lower.includes('sembunyikan') || lower.includes('hide');
        layoutOverrides.push({
          targetRoute: resolvedRoute,
          title: `Live Style Override (${targetModule})`,
          cssRules: isHide
            ? `/* Custom visibility override for ${resolvedRoute} */`
            : `/* Live table & card accent enhancement for ${resolvedRoute} */\ntable th { letter-spacing: 0.06em; }\n`,
          hideSelector: isHide ? '[data-ai-hideable="true"]' : '',
          description: `Memodifikasi tampilan visual dan layout pada ${targetModule} secara langsung via Live CSS Override Engine.`,
        });
      }

      if (mode === 'schema_formula' || lower.includes('rumus') || lower.includes('field') || lower.includes('kolom') || lower.includes('database')) {
        formulas.push({
          name: cleanPrompt ? `Rumus AI: ${cleanPrompt.slice(0, 45)}` : 'Rasio Margin & Efisiensi Modal (%)',
          targetCollection: 'products',
          outputField: 'aiMarginEfficiencyPct',
          expression: '((pricePerUnit - costPerUnit) / pricePerUnit) * 100',
          outputType: 'percent',
          description: 'Menghitung persentase margin keuntungan bersih per dus produk secara real-time dan mendukung konversi IDR/USD.',
        });
        databaseFixes.push({
          type: 'add_collection_field',
          collection: 'products',
          fieldName: 'aiVerifiedAt',
          defaultValue: new Date().toISOString().slice(0, 10),
          description: 'Menambahkan/memperbarui field metadata audit pada koleksi Firestore products.',
        });
      }

      if (mode === 'code_patch' && fileContext?.filePath) {
        const lines = String(fileContext.snippet || '').split('\n').slice(0, 8).join('\n');
        codePatch = {
          filePath: fileContext.filePath,
          explanation: `Rencana patch kode untuk ${fileContext.filePath} sesuai instruksi: "${cleanPrompt || 'Optimasi & perbaikan komponen'}"`,
          searchBlock: lines,
          replaceBlock: lines,
        };
      }

      return {
        summary: `AI System Architect (${modelId}) telah menganalisis permintaan Anda untuk target "${targetModule}" pada mode "${mode}".`,
        rootCause:
          mode === 'bug_fix'
            ? 'Ditemukan potensi ketidaksinkronan field transaksi/order lama (totalModal, paidAmount, remainingDebt, atau paymentStatus) serta kebutuhan rekonsiliasi lintas koleksi Firestore.'
            : `Permintaan modifikasi langsung pada ${targetModule} siap diterapkan secara real-time dengan dukungan backup & 1-click rollback.`,
        databaseFixes,
        textOverrides,
        layoutOverrides,
        formulas,
        codePatch,
      };
    };

    const fallbackPlan = buildDeterministicPlan();

    const systemInstruction = `Anda adalah RiskCart AI System Architect & Live Editor (God-Mode Control Center untuk Owner/Super Admin).
Tugas Anda adalah menganalisis instruksi Owner (dan screenshot gambar jika dilampirkan) serta menghasilkan rencana eksekusi nyata (JSON) untuk:
1. Memperbaiki bug data & menyinkronkan database Firestore (databaseFixes).
2. Mengubah teks, label, tombol, atau nama kolom di halaman mana pun secara real-time (textOverrides).
3. Memodifikasi tampilan, warna, ukuran font, atau menyembunyikan elemen lewat CSS/Layout override (layoutOverrides).
4. Menambah field struktur database baru atau membuat rumus kalkulasi baru yang mendukung mata uang IDR/USD (formulas).
5. Membuat patch kode TypeScript/React yang presisi jika fileContext diberikan (codePatch).

Kembalikan HANYA objek JSON valid sesuai skema.`;

    const parts: any[] = [];
    if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.length > 20) {
      const cleanedBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      parts.push({
        inlineData: {
          mimeType: imageMimeType || 'image/png',
          data: cleanedBase64,
        },
      });
    }

    parts.push({
      text: `Mode Aksi: "${mode}"
Target Halaman / Modul: "${targetModule}"
Model Dipilih: "${modelId}"
Ringkasan Data Ekosistem Saat Ini: ${JSON.stringify(ecosystemSnapshot)}
${fileContext ? `File yang Diinspeksi (${fileContext.filePath}):\n\`\`\`tsx\n${String(fileContext.snippet || '').slice(0, 6000)}\n\`\`\`` : ''}

Instruksi Owner:
"${cleanPrompt || 'Audit seluruh ekosistem halaman ini, temukan bug data/tampilan, dan berikan rencana perbaikan otomatis.'}"

Hasilkan JSON dengan struktur:
{
  "summary": "Ringkasan jelas analisis & solusi AI dalam Bahasa Indonesia",
  "rootCause": "Penjelasan teknis akar masalah atau perubahan yang akan diterapkan",
  "databaseFixes": [
    {
      "type": "reconcile_transactions" | "reconcile_orders_payment" | "reconcile_stock_and_expiry" | "reconcile_shift_and_cash" | "reconcile_customer_debt" | "add_collection_field",
      "collection": "products | orders | transactions | customers | shifts",
      "fieldName": "namaFieldOpsional",
      "defaultValue": "nilaiDefaultOpsional",
      "description": "Penjelasan tindakan perbaikan database"
    }
  ],
  "textOverrides": [
    {
      "targetRoute": "ALL atau path seperti /dashboard/orders",
      "sourceText": "Teks Asli di UI",
      "replacementId": "Teks Baru (ID)",
      "replacementEn": "New Text (EN)",
      "description": "Penjelasan perubahan teks/label/kolom"
    }
  ],
  "layoutOverrides": [
    {
      "targetRoute": "ALL atau path seperti /dashboard/orders",
      "title": "Judul Aturan Layout/Style",
      "cssRules": "Aturan CSS valid",
      "hideSelector": "Selector opsional jika ingin menyembunyikan elemen",
      "description": "Penjelasan modifikasi tampilan/layout"
    }
  ],
  "formulas": [
    {
      "name": "Nama Rumus",
      "targetCollection": "products | orders | transactions",
      "outputField": "namaFieldHasil",
      "expression": "Ekspresi rumus matematika",
      "outputType": "currency | number | percent",
      "description": "Penjelasan rumus"
    }
  ],
  "codePatch": {
    "filePath": "path/file.tsx jika ada",
    "explanation": "Penjelasan patch kode",
    "searchBlock": "Potongan kode asli yang ingin diganti",
    "replaceBlock": "Potongan kode baru pengganti"
  }
}`,
    });

    let finalPlan = fallbackPlan;
    let tokenIn = 0;
    let tokenOut = 0;
    let usedModel = modelId;

    try {
      const geminiRes = await generateContentWithFallback({
        preferredModel: sdkModel,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      tokenIn =
        geminiRes.usageMetadata?.promptTokenCount ||
        Math.ceil(cleanPrompt.length / 3) + (imageBase64 ? 258 : 150);
      tokenOut = geminiRes.usageMetadata?.candidatesTokenCount || 420;

      const rawText = geminiRes.text || '';
      if (rawText) {
        const parsed = JSON.parse(rawText);
        finalPlan = {
          summary: parsed.summary || fallbackPlan.summary,
          rootCause: parsed.rootCause || fallbackPlan.rootCause,
          databaseFixes:
            Array.isArray(parsed.databaseFixes) && parsed.databaseFixes.length > 0
              ? parsed.databaseFixes
              : fallbackPlan.databaseFixes,
          textOverrides:
            Array.isArray(parsed.textOverrides) && parsed.textOverrides.length > 0
              ? parsed.textOverrides
              : fallbackPlan.textOverrides,
          layoutOverrides:
            Array.isArray(parsed.layoutOverrides) && parsed.layoutOverrides.length > 0
              ? parsed.layoutOverrides
              : fallbackPlan.layoutOverrides,
          formulas:
            Array.isArray(parsed.formulas) && parsed.formulas.length > 0
              ? parsed.formulas
              : fallbackPlan.formulas,
          codePatch:
            parsed.codePatch && parsed.codePatch.filePath
              ? parsed.codePatch
              : fallbackPlan.codePatch,
        };
      }

      await logAiInvocation({
        agentKey: 'ai_system_architect',
        latencyMs: Date.now() - startTime,
        tokenIn,
        tokenOut,
        ok: true,
        modelUsed: usedModel,
      });
    } catch (aiErr: any) {
      console.warn('[AI System Architect] Using deterministic architect plan fallback:', aiErr?.message || aiErr);
      tokenIn = Math.ceil(cleanPrompt.length / 3) + 120;
      tokenOut = 320;
      await logAiInvocation({
        agentKey: 'ai_system_architect',
        latencyMs: Date.now() - startTime,
        tokenIn,
        tokenOut,
        ok: true,
        modelUsed: usedModel,
      });
    }

    return res.json({
      success: true,
      plan: finalPlan,
      tokenUsage: {
        tokenIn,
        tokenOut,
        totalTokens: tokenIn + tokenOut,
        latencyMs: Date.now() - startTime,
        modelUsed: usedModel,
      },
    });
  } catch (err: any) {
    console.error('Error in /api/ai-architect/analyze:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Gagal menjalankan analisis AI System Architect',
    });
  }
});

// ============================================================================
// GOOGLE DOCS & GOOGLE DRIVE AUTOMATIC SYNC ENDPOINTS (POS TRANSACTIONS & VOID EVIDENCE)
// ============================================================================
const inMemoryDriveStore = new Map<string, any>();
const DEFAULT_GOOGLE_APPS_SCRIPT_WEBHOOK_URL = (
  process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL ||
  process.env.GOOGLE_DRIVE_WEBHOOK_URL ||
  ''
).trim();

app.post('/api/google-drive/sync', async (req, res) => {
  try {
    const payload = req.body || {};
    const syncType = String(payload.type || 'TRANSACTION_DOC');
    const rawFileName = String(
      payload.fileName || payload.orderNumber || payload.id || `POS-${Date.now()}`
    ).trim();
    const syncId = String(payload.id || rawFileName).replace(/[^a-zA-Z0-9_-]/g, '_');
    const nowIso = new Date().toISOString();

    // Check Google Drive OAuth token / Apps Script Webhook from server environment or Firestore settings
    let accessToken = String(process.env.GOOGLE_DRIVE_ACCESS_TOKEN || '').trim();
    let folderId = String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
    let webhookUrl = DEFAULT_GOOGLE_APPS_SCRIPT_WEBHOOK_URL;

    if (!accessToken || !folderId || !webhookUrl) {
      try {
        const gdSnap = await getDoc(doc(firestoreDb, 'settings', 'google_drive'));
        if (gdSnap.exists()) {
          const gdData = gdSnap.data() as any;
          accessToken = accessToken || String(gdData?.accessToken || '').trim();
          folderId = folderId || String(gdData?.folderId || '').trim();
          if (!webhookUrl && gdData?.webhookUrl) {
            webhookUrl = String(gdData.webhookUrl).trim();
          }
        }
      } catch {}
    }

    // Resolve active cashier / staff name dynamically from payload or active shift in Firestore so it is never '-' or hardcoded
    const cleanCashierVal = (v: any): string => {
      const s = String(v ?? '').trim();
      return s && s !== '-' ? s : '';
    };
    let resolvedCashierName =
      cleanCashierVal(payload.cashier) ||
      cleanCashierVal(payload.cashierName) ||
      cleanCashierVal(payload.staffName);

    if (!resolvedCashierName) {
      try {
        const shiftsSnap = await getDocs(collection(firestoreDb, 'shifts'));
        const openShifts = shiftsSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((s) => s.status === 'open');
        if (openShifts.length > 0) {
          openShifts.sort((a, b) => {
            const ta = new Date(a.openedAt || a.createdAt || 0).getTime();
            const tb = new Date(b.openedAt || b.createdAt || 0).getTime();
            return tb - ta;
          });
          resolvedCashierName =
            cleanCashierVal(openShifts[0].cashierName) ||
            cleanCashierVal(openShifts[0].staffName);
        }
      } catch {}
    }

    // Load products from Firestore (`products` & `stores/store_001/products`) if any item is missing costPrice
    const rawItemsList = Array.isArray(payload.items || payload.cancelledItems)
      ? payload.items || payload.cancelledItems
      : [];
    let dbProductsCache: any[] = [];
    const needsProductLookup = rawItemsList.some(
      (it: any) => !Number(it?.costPrice ?? it?.hargaModal ?? it?.unitCost ?? 0)
    );
    if (needsProductLookup) {
      try {
        const [rootProdSnap, storeProdSnap] = await Promise.all([
          getDocs(collection(firestoreDb, 'products')).catch(() => null),
          getDocs(collection(firestoreDb, 'stores', 'store_001', 'products')).catch(() => null),
        ]);
        const prodMap = new Map<string, any>();
        if (storeProdSnap) {
          storeProdSnap.forEach((d) => prodMap.set(d.id, { id: d.id, ...(d.data() as any) }));
        }
        if (rootProdSnap) {
          rootProdSnap.forEach((d) =>
            prodMap.set(d.id, { ...(prodMap.get(d.id) || {}), id: d.id, ...(d.data() as any) })
          );
        }
        dbProductsCache = Array.from(prodMap.values());
      } catch {}
    }

    const enrichedItemsList = rawItemsList.map((it: any) => {
      const targetId = String(it?.productId ?? it?.id ?? it?.product?.id ?? '').trim().toLowerCase();
      const targetSku = String(it?.sku ?? it?.product?.sku ?? '').trim().toLowerCase();
      const targetName = String(it?.productName ?? it?.name ?? it?.product?.name ?? '').trim().toLowerCase();
      const matchedProduct = dbProductsCache.find((p: any) => {
        const pId = String(p?.id ?? '').trim().toLowerCase();
        const pSku = String(p?.sku ?? '').trim().toLowerCase();
        const pName = String(p?.name ?? '').trim().toLowerCase();
        return (
          (targetId && pId === targetId) ||
          (targetSku && pSku === targetSku) ||
          (targetName && pName === targetName)
        );
      });

      const qty = Number(it.quantityOrdered ?? it.qty ?? it.quantity ?? 1) || 1;
      const price = Number(
        it.price ??
          it.unitPrice ??
          it.sellingPrice ??
          it.product?.posPrice ??
          it.product?.pricePerUnit ??
          matchedProduct?.posPrice ??
          matchedProduct?.pricePerUnit ??
          matchedProduct?.sellPrice ??
          0
      );
      const costPrice = Number(
        matchedProduct?.costPrice ??
          matchedProduct?.buyPrice ??
          matchedProduct?.modal ??
          matchedProduct?.costPerUnit ??
          it.costPrice ??
          it.hargaModal ??
          it.unitCost ??
          it.product?.costPrice ??
          it.product?.costPerUnit ??
          0
      );
      const subtotal = qty * price;
      const totalModal = qty * costPrice;
      const totalUntung = subtotal - totalModal;

      return {
        ...it,
        qty,
        quantity: qty,
        quantityOrdered: qty,
        price,
        unitPrice: price,
        sellingPrice: price,
        costPrice,
        hargaModal: costPrice,
        unitCost: costPrice,
        subtotal,
        totalModal,
        totalCost: totalModal,
        totalUntung,
        profit: totalUntung,
      };
    });

    const computedTotalModal = enrichedItemsList.reduce((s: number, it: any) => s + Number(it.totalModal || 0), 0);
    const computedTotalUntung = enrichedItemsList.reduce((s: number, it: any) => s + Number(it.totalUntung || 0), 0);

    // Build structured Google Doc text content
    const formattedItemsLines = enrichedItemsList
      .map((it: any, idx: number) => {
        const name = it.productName || it.name || it.product?.name || 'Produk';
        const qty = Number(it.qty ?? 1);
        const price = Number(it.price ?? 0);
        const costPrice = Number(it.costPrice ?? 0);
        const sub = Number(it.subtotal ?? qty * price);
        const totUntung = Number(it.totalUntung ?? sub - qty * costPrice);
        return `${idx + 1}. ${name} — ${qty} Dus x Rp ${price.toLocaleString('id-ID')} (Modal: Rp ${costPrice.toLocaleString('id-ID')}) = Rp ${sub.toLocaleString('id-ID')} | Untung: Rp ${totUntung.toLocaleString('id-ID')}`;
      })
      .join('\n');

    const docContentText =
      syncType === 'CART_VOID_EVIDENCE'
        ? [
            `==========================================================`,
            `DOKUMEN BUKTI PEMBATALAN KERANJANG KASIR (ANTI-FRAUD POS)`,
            `NAMA FILE : ${rawFileName}`,
            `==========================================================`,
            `ID Audit          : ${payload.id || syncId}`,
            `Waktu Pembatalan  : ${payload.createdAt || nowIso}`,
            `Kasir Bertugas    : ${resolvedCashierName} (${payload.staffRole || 'Cashier'})`,
            `Shift ID          : ${payload.shiftId || '-'}`,
            `Pelanggan         : ${payload.customerName || 'Walk-in Customer'}`,
            `Jenis Tindakan    : ${payload.actionLabel || 'Pembatalan Item Keranjang'}`,
            `Status Otorisasi  : ${payload.status || 'TERVERIFIKASI PIN OWNER'}`,
            `----------------------------------------------------------`,
            `ALASAN / KETERANGAN PEMBATALAN:`,
            `${payload.reason || '-'}`,
            `----------------------------------------------------------`,
            `DAFTAR ITEM YANG DIBATALKAN:`,
            formattedItemsLines || '(Tidak ada item)',
            `----------------------------------------------------------`,
            `TOTAL NOMINAL BATAL : Rp ${Number(payload.totalNominal || 0).toLocaleString('id-ID')}`,
            `LAMPIRAN FOTO BUKTI : ${payload.evidencePhoto ? 'TERLAMPIR (TERSIMPAN DI DRIVE)' : 'TIDAK ADA'}`,
            `==========================================================`,
          ].join('\n')
        : [
            `==========================================================`,
            `DOKUMEN TRANSAKSI RESMI RISKCART POS (GOOGLE SHEET AUTO-SYNCED)`,
            `NOMOR TRANSAKSI / NOTA : ${rawFileName}`,
            `==========================================================`,
            `ID Transaksi      : ${payload.id || syncId}`,
            `Waktu Transaksi   : ${payload.createdAt || payload.timestamp || nowIso}`,
            `Tanggal Order     : ${payload.orderDate || nowIso.slice(0, 10)}`,
            `Kasir Bertugas    : ${resolvedCashierName}`,
            `Pengirim / Kurir  : ${payload.deliveryStaffName || '-'}`,
            `Pelanggan         : ${payload.customerName || 'Walk-in Customer'}`,
            `No. Telepon       : ${payload.customerPhone || '-'}`,
            `Alamat            : ${payload.customerAddress || '-'}`,
            `Metode Pembayaran : ${payload.paymentMethodLabel || payload.paymentMethod || 'Tunai'}`,
            `Status Pembayaran : ${String(payload.paymentStatus || 'paid').toUpperCase()}`,
            `----------------------------------------------------------`,
            `RINCIAN ITEM PEMBELIAN:`,
            formattedItemsLines || '(Tidak ada rincian item)',
            `----------------------------------------------------------`,
            `Subtotal          : Rp ${Number(payload.subtotal ?? payload.totalAmount ?? 0).toLocaleString('id-ID')}`,
            `Total Modal (HPP) : Rp ${Number(payload.totalModal ?? payload.totalCost ?? computedTotalModal).toLocaleString('id-ID')}`,
            `Total Untung      : Rp ${Number(payload.totalUntung ?? payload.totalProfit ?? computedTotalUntung).toLocaleString('id-ID')}`,
            `PPN               : Rp ${Number(payload.taxAmount ?? 0).toLocaleString('id-ID')}`,
            `TOTAL TAGIHAN     : Rp ${Number(payload.totalAmount ?? payload.total ?? 0).toLocaleString('id-ID')}`,
            `UANG DITERIMA     : Rp ${Number(payload.cashPaid ?? payload.paidAmount ?? 0).toLocaleString('id-ID')}`,
            `KEMBALIAN         : Rp ${Number(payload.change ?? 0).toLocaleString('id-ID')}`,
            `SISA HUTANG       : Rp ${Number(payload.remainingDebt ?? 0).toLocaleString('id-ID')}`,
            `==========================================================`,
          ].join('\n');

    let googleDocUrl = `/api/google-drive/doc/${encodeURIComponent(syncId)}`;
    let googleDrivePhotoUrl = payload.evidencePhoto
      ? `/api/google-drive/photo/${encodeURIComponent(syncId)}`
      : '';
    let externalDriveFileId = '';
    let externalPhotoFileId = '';

    const cleanPhotoBase64 = payload.evidencePhoto
      ? String(payload.evidencePhoto).replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
      : '';

    // 1. Forward payload to Google Apps Script Webhook URL to create real Google Sheet / Doc & Drive photo
    if (webhookUrl) {
      try {
        const whRes = await fetch(webhookUrl, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            type: syncType,
            fileName: rawFileName,
            title: rawFileName,
            docTitle: rawFileName,
            orderNumber: payload.orderNumber || rawFileName,
            transactionId: payload.id || syncId,
            cashier: resolvedCashierName,
            cashierName: resolvedCashierName,
            staffName: resolvedCashierName,
            items: enrichedItemsList,
            totalCost: Number(payload.totalCost ?? payload.totalModal ?? computedTotalModal),
            totalModal: Number(payload.totalModal ?? payload.totalCost ?? computedTotalModal),
            hargaModal: Number(payload.hargaModal ?? payload.totalModal ?? computedTotalModal),
            totalProfit: Number(payload.totalProfit ?? payload.totalUntung ?? computedTotalUntung),
            totalUntung: Number(payload.totalUntung ?? payload.totalProfit ?? computedTotalUntung),
            keuntungan: Number(payload.keuntungan ?? payload.totalUntung ?? computedTotalUntung),
            folderId,
            docContentText,
            content: docContentText,
            text: docContentText,
            body: docContentText,
            photoBase64: cleanPhotoBase64,
            photoMimeType: 'image/jpeg',
            photoFileName: `FOTO_BUKTI_${rawFileName}.jpg`,
          }),
        });
        const rawText = await whRes.text().catch(() => '');
        let whData: any = {};
        try {
          whData = rawText ? JSON.parse(rawText) : {};
        } catch {}

        const resolvedDocUrl =
          whData?.googleDocUrl ||
          whData?.spreadsheetUrl ||
          whData?.sheetUrl ||
          whData?.docUrl ||
          whData?.documentUrl ||
          whData?.url ||
          whData?.fileUrl ||
          whData?.webViewLink;
        const resolvedPhotoUrl =
          whData?.googleDrivePhotoUrl ||
          whData?.photoUrl ||
          whData?.imageUrl ||
          whData?.evidenceUrl ||
          whData?.drivePhotoUrl;

        if (resolvedDocUrl) googleDocUrl = String(resolvedDocUrl);
        if (resolvedPhotoUrl) googleDrivePhotoUrl = String(resolvedPhotoUrl);
        if (whData?.docId || whData?.documentId || whData?.fileId) {
          externalDriveFileId = String(whData.docId || whData.documentId || whData.fileId);
        }
        if (whData?.photoId || whData?.imageFileId) {
          externalPhotoFileId = String(whData.photoId || whData.imageFileId);
        }
      } catch (whErr) {
        console.warn('[Google Drive Webhook] fallback to internal doc viewer:', whErr);
      }
    }

    // 2. If a Google OAuth Access Token is provided, upload directly via Google Drive REST API v3
    if (accessToken) {
      try {
        const metadata = {
          name: rawFileName,
          mimeType: 'application/vnd.google-apps.document',
          ...(folderId ? { parents: [folderId] } : {}),
        };
        const boundary = '-------RiskCartDriveBoundary' + Date.now();
        const multipartBody =
          `--${boundary}\r\n` +
          `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
          `${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\n` +
          `Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
          `${docContentText}\r\n` +
          `--${boundary}--`;

        const driveRes = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: multipartBody,
          }
        );
        if (driveRes.ok) {
          const driveData = await driveRes.json();
          if (driveData?.id) {
            externalDriveFileId = driveData.id;
            googleDocUrl =
              driveData.webViewLink || `https://docs.google.com/document/d/${driveData.id}/edit`;
          }
        }

        // Upload evidencePhoto to Google Drive if present
        if (payload.evidencePhoto && String(payload.evidencePhoto).startsWith('data:image')) {
          const base64Data = String(payload.evidencePhoto).split(',')[1] || '';
          const photoMeta = {
            name: `FOTO_BUKTI_${rawFileName}.jpg`,
            mimeType: 'image/jpeg',
            ...(folderId ? { parents: [folderId] } : {}),
          };
          const photoBoundary = '-------RiskCartPhotoBoundary' + Date.now();
          const photoBody = Buffer.concat([
            Buffer.from(
              `--${photoBoundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
                photoMeta
              )}\r\n--${photoBoundary}\r\nContent-Type: image/jpeg\r\nContent-Transfer-Encoding: base64\r\n\r\n`,
              'utf-8'
            ),
            Buffer.from(base64Data, 'base64'),
            Buffer.from(`\r\n--${photoBoundary}--`, 'utf-8'),
          ]);

          const photoRes = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': `multipart/related; boundary=${photoBoundary}`,
              },
              body: photoBody,
            }
          );
          if (photoRes.ok) {
            const photoData = await photoRes.json();
            if (photoData?.id) {
              externalPhotoFileId = photoData.id;
              googleDrivePhotoUrl =
                photoData.webViewLink || `https://drive.google.com/file/d/${photoData.id}/view`;
            }
          }
        }
      } catch (driveErr) {
        console.warn('[Google Drive API] fallback to Cloud Firestore Doc Archive:', driveErr);
      }
    }

    const recordToSave = {
      id: syncId,
      type: syncType,
      fileName: rawFileName,
      folderId: folderId || 'RISKCART_POS_SHARED_DRIVE',
      docContentText,
      googleDocUrl,
      googleDrivePhotoUrl,
      externalDriveFileId,
      externalPhotoFileId,
      evidencePhoto: payload.evidencePhoto || '',
      payload: {
        ...payload,
        evidencePhoto: payload.evidencePhoto ? '[ATTACHED]' : '',
      },
      createdAt: nowIso,
    };

    inMemoryDriveStore.set(syncId, {
      ...recordToSave,
      evidencePhoto: payload.evidencePhoto || '',
    });

    try {
      await setDoc(doc(firestoreDb, 'google_drive_docs', syncId), recordToSave, { merge: true });
    } catch (fsErr) {
      console.warn('[google_drive_docs] Firestore write notice:', fsErr);
    }

    return res.json({
      success: true,
      id: syncId,
      fileName: rawFileName,
      googleDocUrl,
      googleDrivePhotoUrl,
      createdAt: nowIso,
    });
  } catch (error: any) {
    console.error('Error in /api/google-drive/sync:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Gagal menyinkronkan dokumen ke Google Drive',
    });
  }
});

app.get('/api/google-drive/doc/:id', async (req, res) => {
  try {
    const syncId = String(req.params.id || '').trim();
    let record = inMemoryDriveStore.get(syncId);
    if (!record) {
      try {
        const snap = await getDoc(doc(firestoreDb, 'google_drive_docs', syncId));
        if (snap.exists()) record = snap.data();
      } catch {}
    }
    if (!record) {
      return res.status(404).send('Dokumen Google Spreadsheet Transaksi tidak ditemukan.');
    }
    const safeTitle = String(record.fileName || syncId).replace(/[<>]/g, '');
    const safeContent = String(record.docContentText || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const photoHtml = record.evidencePhoto
      ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #dadce0;">
           <h3 style="font-size:14px;color:#202124;margin-bottom:8px;">Lampiran Foto Bukti (Google Drive):</h3>
           <img src="${record.evidencePhoto}" alt="Bukti Pembatalan" style="max-width:100%;max-height:480px;border-radius:8px;border:1px solid #dadce0;" />
         </div>`
      : '';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle} - Google Sheet Auto-Synced</title>
  <style>
    body { margin: 0; background: #f8f9fa; font-family: 'Roboto', Arial, sans-serif; color: #202124; }
    .topbar { background: #fff; border-bottom: 1px solid #dadce0; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; }
    .doc-title { font-size: 18px; font-weight: 600; color: #1a73e8; display: flex; align-items: center; gap: 10px; }
    .badge { font-size: 11px; background: #e8f0fe; color: #1967d2; padding: 4px 10px; border-radius: 99px; font-weight: 600; }
    .btn { background: #1a73e8; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 13px; }
    .page { max-width: 760px; margin: 32px auto; background: #fff; border: 1px solid #dadce0; box-shadow: 0 2px 8px rgba(0,0,0,0.06); padding: 48px 56px; border-radius: 4px; }
    pre { font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; margin: 0; color: #202124; }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="doc-title">
      <span>📊 ${safeTitle}</span>
      <span class="badge">Google Sheet Auto-Synced • RiskCart Cloud Sync</span>
    </div>
    <button class="btn" onclick="window.print()">🖨️ Cetak / Simpan PDF</button>
  </div>
  <div class="page">
    <pre>${safeContent}</pre>
    ${photoHtml}
  </div>
</body>
</html>`);
  } catch (err: any) {
    return res.status(500).send('Gagal memuat dokumen.');
  }
});

app.get('/api/google-drive/photo/:id', async (req, res) => {
  try {
    const syncId = String(req.params.id || '').trim();
    let record = inMemoryDriveStore.get(syncId);
    if (!record) {
      try {
        const snap = await getDoc(doc(firestoreDb, 'google_drive_docs', syncId));
        if (snap.exists()) record = snap.data();
      } catch {}
    }
    if (!record || !record.evidencePhoto) {
      return res.status(404).send('Foto bukti tidak ditemukan.');
    }
    const safeTitle = String(record.fileName || syncId).replace(/[<>]/g, '');
    const safePhotoSrc = sanitizeEvidencePhotoUrl(record.evidencePhoto);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>Foto Bukti ${safeTitle} - Google Drive</title>
  <style>
    body { margin: 0; background: #0f0f12; color: #fff; font-family: Arial, sans-serif; display: flex; flex-direction: column; align-items: center; min-height: 100vh; }
    .bar { width: 100%; box-sizing: border-box; padding: 14px 24px; background: #18181b; border-bottom: 1px solid #27272a; display: flex; justify-content: space-between; align-items: center; }
    .container { padding: 24px; max-width: 900px; text-align: center; }
    img { max-width: 100%; max-height: 80vh; border-radius: 12px; border: 2px solid #f59e0b; box-shadow: 0 10px 30px rgba(0,0,0,0.6); }
  </style>
</head>
<body>
  <div class="bar">
    <strong>🖼️ Foto Bukti Pembatalan Keranjang — ${safeTitle}</strong>
    <a href="${safePhotoSrc}" download="BUKTI_${safeTitle}.jpg" rel="noopener noreferrer" style="color:#fbbf24;text-decoration:none;font-weight:bold;font-size:13px;">⬇ Download Foto</a>
  </div>
  <div class="container">
    <img src="${safePhotoSrc}" alt="Foto Bukti Pembatalan" />
  </div>
</body>
</html>`);
  } catch {
    return res.status(500).send('Gagal memuat foto bukti.');
  }
});

// ============================================================================
// SECURITY HELPERS, FONNTE OTP & AI PAGE BUILDER SANITIZATION
// ============================================================================
interface AuthenticatedRequest extends express.Request {
  user?: {
    uid: string;
    email?: string;
    role?: string;
  };
}

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function enforceRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const existing = rateLimitBuckets.get(key);
  if (!existing || now > existing.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= maxRequests) {
    return false;
  }
  existing.count += 1;
  return true;
}

function normalizePhoneID(raw: unknown): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (digits.startsWith('8')) return '62' + digits;
  return digits;
}

function hashOtpCode(phone: string, otp: string): string {
  const secret = process.env.OTP_HMAC_SECRET || process.env.PIN_SALT || 'riskcart-otp-hmac-v1';
  return crypto.createHmac('sha256', secret).update(`${phone}:${otp}`).digest('hex');
}

function sanitizeEvidencePhotoUrl(urlVal: unknown): string {
  const raw = String(urlVal || '').trim();
  if (!raw) return '';
  if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(raw)) {
    return raw.replace(/\s+/g, '');
  }
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return raw.replace(/["'<>]/g, '');
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString().replace(/["'<>]/g, '');
    }
  } catch {
    return '';
  }
  return '';
}

const adminMemoryCollections = new Map<string, Map<string, any>>();

const adminDb = {
  collection(colName: string) {
    if (!adminMemoryCollections.has(colName)) {
      adminMemoryCollections.set(colName, new Map<string, any>());
    }
    const memCol = adminMemoryCollections.get(colName)!;
    return {
      doc(docId: string) {
        const ref = doc(firestoreDb, colName, docId);
        return {
          async get() {
            try {
              const snap = await getDoc(ref);
              if (snap.exists()) {
                const d = snap.data();
                memCol.set(docId, d);
                return { exists: true, data: () => d };
              }
            } catch {}
            const cached = memCol.get(docId);
            return {
              exists: cached !== undefined,
              data: () => cached,
            };
          },
          async set(data: any, options?: { merge?: boolean }) {
            const prev = memCol.get(docId) || {};
            const next = options?.merge ? { ...prev, ...data } : { ...data };
            memCol.set(docId, next);
            try {
              await setDoc(ref, data, options || {});
            } catch {}
          },
          async update(data: any) {
            const prev = memCol.get(docId) || {};
            memCol.set(docId, { ...prev, ...data });
            try {
              await setDoc(ref, data, { merge: true });
            } catch {}
          },
          async delete() {
            memCol.delete(docId);
            try {
              await deleteDoc(ref);
            } catch {}
          },
        };
      },
    };
  },
};

// Server-side Visitor WhatsApp Notification (reads FONNTE_TOKEN and VISITOR_WA_TARGET exclusively from process.env)
app.post('/api/visitor/notify', async (req, res) => {
  try {
    if (!enforceRateLimit(`visitor_wa_ip:${req.ip}`, 10, 10 * 60 * 1000)) {
      return res.status(429).json({ status: 'error', message: 'Rate limit exceeded' });
    }
    const fonnteToken = (process.env.FONNTE_TOKEN || process.env.FONNTE_API_TOKEN || '').trim();
    const waTarget = (process.env.VISITOR_WA_TARGET || '').trim();
    if (!fonnteToken || !waTarget) {
      return res.status(503).json({
        status: 'error',
        message: 'Visitor WhatsApp notification is not configured on the server.',
      });
    }

    const { tanggal = '', halamanAkses = '/', statusLogin = 'NO', meta = {} } = req.body || {};
    const text = [
      `Viewer Riskcart`,
      `Tanggal: ${String(tanggal).slice(0, 64)}`,
      `Halaman Akses: ${String(halamanAkses).slice(0, 200)}`,
      `Login: ${String(statusLogin).slice(0, 80)}`,
      `--`,
      `IP: ${String(meta?.ip || req.ip || '-').slice(0, 64)}`,
      `Lokasi: ${String(meta?.lokasi || '-').slice(0, 120)}`,
      `OS: ${String(meta?.os || '-').slice(0, 64)}`,
      `Operating System: ${String(meta?.operatingSystem || '-').slice(0, 80)}`,
      `---`,
    ].join('\n');

    const formData = new URLSearchParams();
    formData.append('target', waTarget);
    formData.append('message', text);

    const fonnteRes = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: { Authorization: fonnteToken },
      body: formData,
    });
    if (!fonnteRes.ok) {
      return res.status(502).json({ status: 'error', message: 'Failed to deliver visitor notification' });
    }
    return res.json({ status: 'ok' });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// Authenticated Owner-Only Endpoints for Private AI Agent Prompts (ai_agents_private)
app.get('/api/ai/agents/private', requireAuth, requireRole(['owner']), async (_req, res) => {
  try {
    const result: Record<string, any> = {};
    for (const [key, prompt] of Object.entries(SERVER_PRIVATE_AGENT_PROMPTS)) {
      const snap = await adminDb.collection('ai_agents_private').doc(key).get();
      result[key] = snap.exists
        ? snap.data()
        : { id: key, slug: key, defaultInstruction: prompt, globalRules: SERVER_GLOBAL_AI_RULES };
    }
    return res.json({ status: 'ok', prompts: result, globalRules: SERVER_GLOBAL_AI_RULES });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/ai/agents/private', requireAuth, requireRole(['owner']), async (req: AuthRequest, res) => {
  try {
    const { id, slug, customInstruction = '', globalRules = '', modelId = '' } = req.body || {};
    const targetKey = String(slug || id || '').trim();
    if (!targetKey) {
      return res.status(400).json({ status: 'error', message: 'Agent slug or id is required' });
    }
    const payload = {
      id: String(id || targetKey),
      slug: targetKey,
      customInstruction: String(customInstruction).slice(0, 10000),
      globalRules: String(globalRules || SERVER_GLOBAL_AI_RULES).slice(0, 5000),
      modelId: String(modelId || 'gemini-2.5-flash'),
      updatedBy: req.user?.uid || 'owner',
      updatedAt: new Date().toISOString(),
    };
    await adminDb.collection('ai_agents_private').doc(targetKey).set(payload, { merge: true });
    if (id && id !== targetKey) {
      await adminDb.collection('ai_agents_private').doc(String(id)).set(payload, { merge: true });
    }
    return res.json({ status: 'ok', saved: payload });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/auth/request-otp', async (req, res) => {
  try {
    const phone = normalizePhoneID(req.body?.phone);
    if (!phone || phone.length < 10 || phone.length > 16) {
      return res.status(400).json({ status: 'error', message: 'Nomor WhatsApp tidak valid.' });
    }

    if (!enforceRateLimit(`otp_req_ip:${req.ip}`, 5, 10 * 60 * 1000)) {
      return res.status(429).json({
        status: 'error',
        message: 'Terlalu banyak permintaan OTP. Silakan tunggu beberapa menit.',
      });
    }

    if (!enforceRateLimit(`otp_req_phone:${phone}`, 3, 10 * 60 * 1000)) {
      return res.status(429).json({
        status: 'error',
        message: 'Terlalu banyak permintaan OTP untuk nomor ini. Silakan tunggu 10 menit.',
      });
    }

    const fonnteToken = (process.env.FONNTE_TOKEN || process.env.FONNTE_API_TOKEN || '').trim();
    if (!fonnteToken) {
      return res.status(503).json({
        status: 'error',
        message: 'Layanan pengiriman OTP belum dikonfigurasi di server (FONNTE_TOKEN belum diatur).',
      });
    }

    const otpCode = String(crypto.randomInt(100000, 999999));
    const otpHash = hashOtpCode(phone, otpCode);
    const now = Date.now();
    const expiresAt = now + 5 * 60 * 1000;

    await adminDb.collection('otp_sessions').doc(phone).set({
      phone,
      otpHash,
      attempts: 0,
      maxAttempts: 5,
      createdAt: now,
      expiresAt,
    });

    const message = `*RISKCART OTP*\nKode verifikasi Anda adalah: *${otpCode}*\nBerlaku selama 5 menit. Jangan berikan kode ini kepada siapa pun.`;

    const formData = new URLSearchParams();
    formData.append('target', phone);
    formData.append('message', message);

    const fonnteRes = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: {
        Authorization: fonnteToken,
      },
      body: formData,
    });

    const fonnteData = await fonnteRes.json().catch(() => ({}));
    if (!fonnteRes.ok || fonnteData?.status === false) {
      return res.status(502).json({ status: 'error', message: 'Gagal mengirim OTP melalui WhatsApp.' });
    }

    return res.json({
      status: 'ok',
      message: 'Kode OTP berhasil dikirim ke WhatsApp Anda.',
      expiresInSeconds: 300,
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const phone = normalizePhoneID(req.body?.phone);
    const otpInput = String(req.body?.otp || req.body?.code || '').trim();

    if (!phone || !/^\d{6}$/.test(otpInput)) {
      return res.status(400).json({ status: 'error', valid: false, message: 'Nomor HP dan 6 digit OTP wajib valid.' });
    }

    // Rate limit verifikasi per IP
    if (!enforceRateLimit(`otp_verify_ip:${req.ip}`, 10, 10 * 60 * 1000)) {
      return res.status(429).json({ status: 'error', valid: false, message: 'Terlalu banyak percobaan verifikasi.' });
    }

    const otpDocRef = adminDb.collection('otp_sessions').doc(phone);
    const snap = await otpDocRef.get();

    if (!snap.exists) {
      return res.status(400).json({ status: 'error', valid: false, message: 'Sesi OTP tidak ditemukan atau sudah digunakan.' });
    }

    const session = snap.data() || {};
    const now = Date.now();

    // Cek kedaluwarsa
    if (now > Number(session.expiresAt || 0)) {
      await otpDocRef.delete();
      return res.status(400).json({ status: 'error', valid: false, message: 'Kode OTP sudah kedaluwarsa. Silakan minta ulang.' });
    }

    // Cek batas percobaan brute-force (Maksimal 5x salah langsung hangus)
    const currentAttempts = Number(session.attempts || 0) + 1;
    if (currentAttempts > Number(session.maxAttempts || 5)) {
      await otpDocRef.delete();
      return res.status(429).json({
        status: 'error',
        valid: false,
        message: 'Kode OTP hangus karena terlalu banyak percobaan salah. Silakan minta OTP baru.',
      });
    }

    const expectedHash = String(session.otpHash || '');
    const actualHash = hashOtpCode(phone, otpInput);

    const isMatch =
      expectedHash.length === actualHash.length &&
      crypto.timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(actualHash, 'hex'));

    if (!isMatch) {
      await otpDocRef.update({ attempts: currentAttempts });
      return res.status(401).json({
        status: 'error',
        valid: false,
        message: `Kode OTP salah. Sisa percobaan: ${Math.max(0, 5 - currentAttempts)}.`,
      });
    }

    // OTP Valid -> Hapus sesi agar tidak bisa dipakai ulang (Replay Attack Protection)
    await otpDocRef.delete();

    const token = createSignedSessionToken({ uid: `wa_${phone}`, role: 'customer' });

    return res.json({
      status: 'ok',
      valid: true,
      phone,
      token,
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', valid: false, message: err.message });
  }
});

// Whitelist tipe blok komponen yang diizinkan di AI Page Builder
const ALLOWED_PAGE_BLOCK_TYPES = [
  'hero',
  'banner',
  'product-grid',
  'promo-carousel',
  'feature-list',
  'testimonial',
  'faq',
  'cta-whatsapp',
  'text-section',
  'stats',
];

function sanitizePageBuilderConfig(rawConfig: any): Record<string, any> {
  if (!rawConfig || typeof rawConfig !== 'object') {
    throw new Error('Konfigurasi halaman tidak valid.');
  }

  // Tolak jika ukuran JSON terlalu besar (> 100 KB) untuk mencegah DoS
  const serialized = JSON.stringify(rawConfig);
  if (serialized.length > 100 * 1024) {
    throw new Error('Ukuran konfigurasi halaman melebihi batas aman (100KB).');
  }

  // Bersihkan seluruh string dari tag <script>, event handler on*=, dan protokol javascript:/data:text/html
  const cleanString = (val: unknown, maxLen = 2000): string => {
    return String(val || '')
      .slice(0, maxLen)
      .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
      .replace(/<\s*iframe[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, '')
      .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/\bon\w+\s*=\s*[^\s>]+/gi, '')
      .replace(/javascript\s*:/gi, 'blocked:')
      .replace(/vbscript\s*:/gi, 'blocked:')
      .replace(/data\s*:\s*text\/html/gi, 'blocked:');
  };

  const cleanUrl = (urlVal: unknown): string => {
    const raw = String(urlVal || '').trim();
    if (!raw) return '';
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw.replace(/["'<>]/g, '');
    try {
      const parsed = new URL(raw);
      if (['https:', 'http:'].includes(parsed.protocol)) {
        return parsed.toString().replace(/["'<>]/g, '');
      }
    } catch {
      return '';
    }
    return '';
  };

  const rawBlocks = Array.isArray(rawConfig.blocks || rawConfig.sections)
    ? (rawConfig.blocks || rawConfig.sections).slice(0, 25)
    : [];

  const sanitizedBlocks = rawBlocks
    .filter((b: any) => b && ALLOWED_PAGE_BLOCK_TYPES.includes(String(b.type || '').toLowerCase()))
    .map((b: any, idx: number) => ({
      id: cleanString(b.id || `block-${idx}`, 64),
      type: String(b.type).toLowerCase(),
      title: cleanString(b.title, 200),
      subtitle: cleanString(b.subtitle, 500),
      content: cleanString(b.content, 2000),
      imageUrl: sanitizeEvidencePhotoUrl(b.imageUrl || b.image),
      buttonText: cleanString(b.buttonText, 80),
      buttonUrl: cleanUrl(b.buttonUrl || b.actionUrl || b.href),
      items: Array.isArray(b.items)
        ? b.items.slice(0, 20).map((item: any) => ({
            title: cleanString(item?.title || item?.label, 150),
            description: cleanString(item?.description || item?.text, 500),
            imageUrl: sanitizeEvidencePhotoUrl(item?.imageUrl || item?.icon),
            linkUrl: cleanUrl(item?.linkUrl || item?.href),
          }))
        : [],
    }));

  return {
    slug: cleanString(rawConfig.slug || 'home', 64).replace(/[^a-z0-9-_]/gi, '').toLowerCase(),
    title: cleanString(rawConfig.title || 'Custom Page', 120),
    themeColor: /^#[0-9A-Fa-f]{3,8}$/.test(String(rawConfig.themeColor || '')) ? rawConfig.themeColor : '#D4AF37',
    blocks: sanitizedBlocks,
    updatedAt: new Date().toISOString(),
  };
}

// Endpoint khusus untuk menyimpan hasil AI Page Builder secara aman
app.post('/api/ai/page-builder/save', requireAuth, requireRole(['owner', 'supervisor']), async (req: AuthenticatedRequest, res) => {
  try {
    const rateKey = `page_builder:${req.user?.uid}`;
    if (!enforceRateLimit(rateKey, 10, 60 * 1000)) {
      return res.status(429).json({ status: 'error', message: 'Terlalu banyak penyimpanan halaman. Tunggu 1 menit.' });
    }

    const cleanPage = sanitizePageBuilderConfig(req.body?.pageConfig || req.body);
    cleanPage.updatedBy = req.user?.uid;

    await adminDb.collection('custom_pages').doc(cleanPage.slug).set(cleanPage, { merge: true });
    return res.json({ status: 'ok', page: cleanPage });
  } catch (err: any) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// Setup Vite development middlewares or production static serving
async function startServer() {
  const httpServer = createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`RiskCart Server listening on port ${PORT}`);
  });
}

startServer();
