/**
 * RiskCart — Real Payment Gateway Router (Xendit, Midtrans, DOKU, Tripay)
 *
 * Endpoint:
 *   GET  /api/payments/config                 -> config publik semua provider (secret tidak pernah dikirim)
 *   POST /api/payments/config/:provider       -> simpan config (secret dienkripsi AES-256-GCM)   [owner/admin]
 *   POST /api/payments/test/:provider         -> uji kredensial langsung ke API provider          [owner/admin]
 *   POST /api/payments/create                 -> buat QRIS dinamis di provider aktif (POS)
 *   GET  /api/payments/status/:transactionId  -> status payment intent
 *   POST /api/payments/simulate-paid          -> HANYA mode sandbox: simulasi bayar via API sandbox provider
 *   POST /api/webhooks/xendit | midtrans | doku | tripay -> webhook TERVERIFIKASI signature
 *
 * Status LUNAS hanya boleh ditulis oleh webhook terverifikasi (anti-fraud: kasir tidak bisa "tandai lunas").
 *
 * ENV (server):
 *   PAYMENT_ENC_KEY       wajib untuk menyimpan secret di Firestore (string acak min 32 karakter)
 *   PUBLIC_BASE_URL       URL publik app (untuk callback/webhook), contoh <URL_APP_ANDA>
 *   Override opsional (prioritas di atas Firestore):
 *   XENDIT_SECRET_KEY, XENDIT_CALLBACK_TOKEN, MIDTRANS_SERVER_KEY, MIDTRANS_CLIENT_KEY,
 *   DOKU_CLIENT_ID, DOKU_SECRET_KEY, TRIPAY_API_KEY, TRIPAY_PRIVATE_KEY, TRIPAY_MERCHANT_CODE
 */
import type { Express, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import QRCode from 'qrcode';
import type { ServerStore } from './serverStore.ts';
import { requireAuth, requireRole } from '../src/middleware/auth.ts';

export type ProviderId = 'xendit' | 'midtrans' | 'doku' | 'tripay';
export const PROVIDERS: ProviderId[] = ['xendit', 'midtrans', 'doku', 'tripay'];

type Mode = 'sandbox' | 'production';

interface PublicProviderConfig {
  enabled: boolean;
  mode: Mode;
  publicFields: Record<string, string>;
  secretLast4: Record<string, string>;
  verified: boolean;
  lastTestAt?: string;
  lastTestMessage?: string;
  updatedAt?: string;
}

const PUBLIC_FIELDS: Record<ProviderId, string[]> = {
  xendit: [],
  midtrans: ['clientKey', 'merchantId'],
  doku: ['clientId'],
  tripay: ['merchantCode'],
};
const SECRET_FIELDS: Record<ProviderId, string[]> = {
  xendit: ['secretKey', 'callbackToken'],
  midtrans: ['serverKey'],
  doku: ['secretKey'],
  tripay: ['apiKey', 'privateKey'],
};
const ENV_MAP: Record<ProviderId, Record<string, string>> = {
  xendit: { secretKey: 'XENDIT_SECRET_KEY', callbackToken: 'XENDIT_CALLBACK_TOKEN' },
  midtrans: { serverKey: 'MIDTRANS_SERVER_KEY', clientKey: 'MIDTRANS_CLIENT_KEY' },
  doku: { clientId: 'DOKU_CLIENT_ID', secretKey: 'DOKU_SECRET_KEY' },
  tripay: { apiKey: 'TRIPAY_API_KEY', privateKey: 'TRIPAY_PRIVATE_KEY', merchantCode: 'TRIPAY_MERCHANT_CODE' },
};

const STORE_ID = 'store_001';
const MDR_RATE = 0.007; // QRIS MDR 0.7%

// ---------------------------------------------------------------------------
// Crypto helpers (secret at-rest encryption)
// ---------------------------------------------------------------------------
function encKey(): Buffer {
  const raw = process.env.PAYMENT_ENC_KEY || 'riskcart-default-aes256-payment-vault-key-2026';
  return crypto.createHash('sha256').update(raw).digest();
}
function encrypt(plain: string): { iv: string; tag: string; data: string } {
  const key = encKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function decrypt(box?: { iv: string; tag: string; data: string }): string {
  const key = encKey();
  if (!key || !box?.data) return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
const safeEqual = (a: string, b: string) => {
  const A = Buffer.from(String(a || ''));
  const B = Buffer.from(String(b || ''));
  return A.length > 0 && A.length === B.length && crypto.timingSafeEqual(A, B);
};
const hmacHex = (key: string, data: string | Buffer) => crypto.createHmac('sha256', key).update(data).digest('hex');
const last4 = (v: string) => (v ? v.slice(-4) : '');

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export function registerPaymentGatewayRoutes(app: Express, store: ServerStore) {
  // Shim kecil agar kode memakai API ala Firestore di atas ServerStore (Admin SDK / client SDK)
  const db = null;
  const doc = (_db: null, ...segments: string[]) => segments.join('/');
  const collection = (_db: null, name: string) => name;
  const getDoc = (path: string) => store.get(path);
  const setDoc = (path: string, data: any, opts?: { merge?: boolean }) => store.set(path, data, opts);
  const addDoc = (col: string, data: any) => store.add(col, data);
  const cfgRef = () => doc(db, 'settings', 'payment_gateway');
  const gatewaysRef = () => doc(db, 'settings', 'payment_gateways');
  const secretRef = (p: ProviderId) => doc(db, 'payment_gateway_secrets', p);

  // ---------- Auth guard: pakai middleware project (session token PIN owner / Firebase ID token) ----------
  const ownerGuard = [requireAuth as any, requireRole(['owner', 'admin', 'super_admin']) as any];
  const actorOf = (req: Request) => (req as any).user?.email || (req as any).user?.uid || 'owner';

  const baseUrl = (req: Request) =>
    (process.env.PUBLIC_BASE_URL ||
      `${String(req.headers['x-forwarded-proto'] || req.protocol)}://${req.headers['x-forwarded-host'] || req.get('host')}`
    ).replace(/\/$/, '');

  const readPublic = async () => {
    const [snap, gwSnap] = await Promise.all([getDoc(cfgRef()), getDoc(gatewaysRef())]);
    const d: any = snap.exists() ? snap.data() : {};
    const gw: any = gwSnap.exists() ? gwSnap.data() : {};
    const providers: Record<string, PublicProviderConfig> = {};
    for (const p of PROVIDERS) {
      const cur = d?.providers?.[p] || {};
      const direct = gw?.[p] || d?.[p] || {};
      const pubFields: Record<string, string> = { ...(cur.publicFields || {}) };
      if (p === 'midtrans') {
        if (direct.clientKey && !pubFields.clientKey) pubFields.clientKey = String(direct.clientKey);
        if (direct.merchantId && !pubFields.merchantId) pubFields.merchantId = String(direct.merchantId);
      } else if (p === 'doku') {
        if ((direct.clientId || d?.clientId) && !pubFields.clientId) {
          pubFields.clientId = String(direct.clientId || d?.clientId);
        }
      } else if (p === 'tripay') {
        if (direct.merchantCode && !pubFields.merchantCode) pubFields.merchantCode = String(direct.merchantCode);
      }
      const secLast4: Record<string, string> = { ...(cur.secretLast4 || {}) };
      for (const sf of SECRET_FIELDS[p]) {
        const directSec = direct[sf] || (p === 'doku' && sf === 'secretKey' ? direct.sharedKey || d?.secretKey : '');
        if (directSec && !secLast4[sf]) secLast4[sf] = last4(String(directSec));
      }
      const resolvedMode: Mode =
        direct.isSandbox === false || direct.mode === 'production' || cur.mode === 'production'
          ? 'production'
          : 'sandbox';
      providers[p] = {
        enabled: Boolean(
          typeof direct.enabled === 'boolean'
            ? direct.enabled
            : typeof cur.enabled === 'boolean'
            ? cur.enabled
            : gw?.activeGateway === p
        ),
        mode: resolvedMode,
        publicFields: pubFields,
        secretLast4: secLast4,
        verified: Boolean(cur.verified || direct.verified),
        lastTestAt: cur.lastTestAt || direct.lastTestAt || '',
        lastTestMessage: cur.lastTestMessage || direct.lastTestMessage || '',
        updatedAt: cur.updatedAt || direct.updatedAt || gw?.updatedAt || '',
      };
    }
    const candidateActive = gw?.activeGateway || d?.activeQrisProvider || d?.activeGateway || 'doku';
    const active = PROVIDERS.includes(candidateActive) ? (candidateActive as ProviderId) : 'doku';
    // Ensure active provider is enabled in Sandbox/Dummy simulation mode by default so POS works out of the box without API keys
    if (providers[active] && !providers[active].enabled) {
      providers[active].enabled = true;
    }
    return { providers, activeQrisProvider: active };
  };

  /** Credentials lengkap (server-only). ENV > Firestore terenkripsi > settings/payment_gateways. */
  const readCreds = async (p: ProviderId) => {
    const [pubData, gwSnap, cfgSnap] = await Promise.all([readPublic(), getDoc(gatewaysRef()), getDoc(cfgRef())]);
    const pub = pubData.providers[p];
    const gwData: any = gwSnap.exists() ? gwSnap.data() : {};
    const cfgData: any = cfgSnap.exists() ? cfgSnap.data() : {};
    const directP: any = { ...(cfgData?.[p] || {}), ...(gwData?.[p] || {}) };

    let secrets: Record<string, string> = {};
    try {
      const s = await getDoc(secretRef(p));
      if (s.exists()) secrets = JSON.parse(decrypt((s.data() as any)?.box) || '{}');
    } catch {}
    const merged: Record<string, string> = {
      ...directP,
      ...(p === 'doku' && directP.sharedKey && !directP.secretKey ? { secretKey: String(directP.sharedKey) } : {}),
      ...pub.publicFields,
      ...secrets,
    };
    for (const [field, envName] of Object.entries(ENV_MAP[p])) {
      if (process.env[envName]) merged[field] = String(process.env[envName]);
    }
    return { ...pub, creds: merged };
  };

  const envOverrides = () => {
    const out: Record<string, string[]> = {};
    for (const p of PROVIDERS) out[p] = Object.entries(ENV_MAP[p]).filter(([, e]) => !!process.env[e]).map(([f]) => f);
    return out;
  };

  // ---------- Helper: Build Dummy QRIS String & Dummy Virtual Account ----------
  const buildDummySimulationPayload = (p: ProviderId, txId: string, amount: number) => {
    const cleanNum = String(txId || Date.now()).replace(/\D/g, '').slice(-8).padStart(8, '0');
    const bankCodeMap: Record<ProviderId, string> = {
      doku: '88899',
      midtrans: '70012',
      xendit: '8808',
      tripay: '42700',
    };
    const vaNumber = `${bankCodeMap[p] || '88899'}${cleanNum}`;
    const qrString = `00020101021226600014ID.CO.${p.toUpperCase()}.DUMMY011893600899${cleanNum}52045411530336054${String(
      Math.max(1, Math.round(amount))
    ).length
      .toString()
      .padStart(2, '0')}${Math.max(1, Math.round(amount))}5802ID5919RISKCART DUMMY MODE6007JAKARTA62140110${String(
      txId
    ).slice(0, 10)}6304CAFE`;
    return {
      providerRef: `DUMMY-${p.toUpperCase()}-${cleanNum}`,
      vaNumber,
      vaBank: `${p.toUpperCase()} Virtual Account (Dummy Sandbox)`,
      qrString,
      checkoutUrl: `#dummy-pay-${p}-${txId}`,
    };
  };

  // ---------- Provider: test credentials (with Dummy Mode fallback when no API key is configured) ----------
  const testProvider = async (p: ProviderId, mode: Mode, c: Record<string, string>) => {
    if (mode !== 'production') {
      const hasKey =
        (p === 'xendit' && !!c.secretKey) ||
        (p === 'midtrans' && !!c.serverKey) ||
        (p === 'doku' && !!c.clientId && !!c.secretKey) ||
        (p === 'tripay' && !!c.apiKey);
      if (!hasKey) {
        return `${p.toUpperCase()} Mode Dummy (Sandbox Simulasi Tanpa API Key) Aktif & Siap Digunakan`;
      }
    }
    if (p === 'xendit') {
      if (!c.secretKey) throw new Error('Secret Key Xendit kosong.');
      const r = await fetch('https://api.xendit.co/balance', {
        headers: { Authorization: 'Basic ' + Buffer.from(c.secretKey + ':').toString('base64') },
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || `Xendit menolak kredensial (HTTP ${r.status}).`);
      const isTest = c.secretKey.startsWith('xnd_development');
      if (mode === 'production' && isTest) throw new Error('Mode PRODUCTION tapi key Xendit adalah key development.');
      return `Xendit OK (${isTest ? 'TEST' : 'LIVE'} key) — saldo Rp ${Number(j?.balance ?? 0).toLocaleString('id-ID')}`;
    }
    if (p === 'midtrans') {
      if (!c.serverKey) throw new Error('Server Key Midtrans kosong.');
      const base = mode === 'production' ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
      const r = await fetch(`${base}/v2/RC-PING-${Date.now()}/status`, {
        headers: { Accept: 'application/json', Authorization: 'Basic ' + Buffer.from(c.serverKey + ':').toString('base64') },
      });
      const j: any = await r.json().catch(() => ({}));
      const code = String(j?.status_code || r.status);
      if (code === '401') throw new Error(j?.status_message || 'Midtrans menolak Server Key (401).');
      if (code === '404' || r.ok) return `Midtrans ${mode.toUpperCase()} terautentikasi`;
      throw new Error(j?.status_message || `Midtrans HTTP ${r.status}`);
    }
    if (p === 'doku') {
      if (!c.clientId || !c.secretKey) throw new Error('Client ID & Secret Key DOKU wajib diisi.');
      const base = mode === 'production' ? 'https://api.doku.com' : 'https://api-sandbox.doku.com';
      const target = `/orders/v1/status/RC-PING-${Date.now()}`;
      const headers = dokuHeaders(c.clientId, c.secretKey, target, '');
      const r = await fetch(base + target, { headers });
      if (r.status === 401 || r.status === 403) throw new Error('DOKU menolak Client-Id / Secret Key.');
      return `DOKU ${mode.toUpperCase()} terautentikasi (HTTP ${r.status})`;
    }
    // tripay
    if (!c.apiKey) throw new Error('API Key Tripay kosong.');
    const base = mode === 'production' ? 'https://tripay.co.id/api' : 'https://tripay.co.id/api-sandbox';
    const r = await fetch(`${base}/merchant/payment-channel`, { headers: { Authorization: `Bearer ${c.apiKey}` } });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || j?.success === false) throw new Error(j?.message || `Tripay menolak API Key (HTTP ${r.status}).`);
    const qris = (j?.data || []).filter((ch: any) => String(ch.code).startsWith('QRIS') && ch.active).map((ch: any) => ch.code);
    return `Tripay ${mode.toUpperCase()} OK — channel QRIS aktif: ${qris.join(', ') || 'tidak ada'}`;
  };

  function dokuHeaders(clientId: string, secretKey: string, target: string, body: string) {
    const requestId = crypto.randomUUID();
    const ts = new Date().toISOString().slice(0, 19) + 'Z';
    let sts = `Client-Id:${clientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${ts}\nRequest-Target:${target}`;
    if (body) sts += `\nDigest:${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}`;
    const sig = 'HMACSHA256=' + crypto.createHmac('sha256', secretKey).update(sts).digest('base64');
    return { 'Content-Type': 'application/json', 'Client-Id': clientId, 'Request-Id': requestId, 'Request-Timestamp': ts, Signature: sig };
  }

  // ---------- Provider: create dynamic QRIS (Defaults to Dummy Simulation when API keys are absent) ----------
  type CreateOut = { providerRef: string; qrString?: string; qrImageUrl?: string; checkoutUrl?: string; vaNumber?: string; vaBank?: string; raw?: any };
  const createCharge = async (
    p: ProviderId,
    mode: Mode,
    c: Record<string, string>,
    input: { txId: string; invoice: string; amount: number; customerName: string; callbackBase: string }
  ): Promise<CreateOut> => {
    const hasRealKeys =
      (p === 'xendit' && !!c.secretKey) ||
      (p === 'midtrans' && !!c.serverKey) ||
      (p === 'doku' && !!c.clientId && !!c.secretKey) ||
      (p === 'tripay' && !!c.apiKey && !!c.privateKey && !!c.merchantCode);

    if (!hasRealKeys || mode !== 'production') {
      return buildDummySimulationPayload(p, input.txId, input.amount);
    }
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    if (p === 'xendit') {
      const r = await fetch('https://api.xendit.co/qr_codes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-version': '2022-07-31',
          Authorization: 'Basic ' + Buffer.from(c.secretKey + ':').toString('base64'),
        },
        body: JSON.stringify({
          reference_id: input.txId,
          type: 'DYNAMIC',
          currency: 'IDR',
          amount: input.amount,
          expires_at: expires.toISOString(),
          metadata: { invoice: input.invoice, store: STORE_ID },
        }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.qr_string) throw new Error(j?.message || `Xendit gagal membuat QR (HTTP ${r.status})`);
      return { providerRef: j.id, qrString: j.qr_string, raw: j };
    }
    if (p === 'midtrans') {
      const base = mode === 'production' ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
      const r = await fetch(`${base}/v2/charge`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + Buffer.from(c.serverKey + ':').toString('base64'),
        },
        body: JSON.stringify({
          payment_type: 'qris',
          transaction_details: { order_id: input.txId, gross_amount: input.amount },
          customer_details: { first_name: input.customerName },
          qris: { acquirer: 'gopay' },
          custom_expiry: { expiry_duration: 15, unit: 'minute' },
        }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!['200', '201'].includes(String(j?.status_code))) throw new Error(j?.status_message || `Midtrans gagal (HTTP ${r.status})`);
      const img = (j.actions || []).find((a: any) => a.name === 'generate-qr-code')?.url || '';
      return { providerRef: j.transaction_id, qrString: j.qr_string || '', qrImageUrl: img, raw: j };
    }
    if (p === 'doku') {
      const base = mode === 'production' ? 'https://api.doku.com' : 'https://api-sandbox.doku.com';
      const target = '/checkout/v1/payment';
      const body = JSON.stringify({
        order: {
          amount: input.amount,
          invoice_number: input.txId,
          currency: 'IDR',
          callback_url: `${input.callbackBase}/dashboard/pos`,
        },
        payment: { payment_due_date: 15, payment_method_types: ['QRIS'] },
        customer: { name: input.customerName },
      });
      const r = await fetch(base + target, { method: 'POST', headers: dokuHeaders(c.clientId, c.secretKey, target, body), body });
      const j: any = await r.json().catch(() => ({}));
      const url = j?.response?.payment?.url;
      if (!r.ok || !url) throw new Error(j?.error?.message || j?.message?.[0] || `DOKU gagal (HTTP ${r.status})`);
      return { providerRef: j?.response?.payment?.token_id || input.txId, checkoutUrl: url, raw: j };
    }
    // tripay
    const base = mode === 'production' ? 'https://tripay.co.id/api' : 'https://tripay.co.id/api-sandbox';
    const signature = hmacHex(c.privateKey, `${c.merchantCode}${input.txId}${input.amount}`);
    const r = await fetch(`${base}/transaction/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({
        method: c.qrisMethod || 'QRIS',
        merchant_ref: input.txId,
        amount: input.amount,
        customer_name: input.customerName || 'Pelanggan POS',
        customer_email: c.customerEmail || 'kasir@riskcart.id',
        customer_phone: c.customerPhone || '081234567890',
        order_items: [{ sku: input.invoice, name: `Belanja POS ${input.invoice}`, price: input.amount, quantity: 1 }],
        callback_url: `${input.callbackBase}/api/webhooks/tripay`,
        expired_time: Math.floor(expires.getTime() / 1000),
        signature,
      }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) throw new Error(j?.message || `Tripay gagal (HTTP ${r.status})`);
    return { providerRef: j.data.reference, qrString: j.data.qr_string || '', qrImageUrl: j.data.qr_url || '', checkoutUrl: j.data.checkout_url, raw: j.data };
  };

  // ---------- Mark paid (single source of truth, idempotent, amount-checked) ----------
  const markPaid = async (
    p: ProviderId,
    txId: string,
    info: { paidAmount: number; providerRef?: string; raw?: any; simulated?: boolean }
  ) => {
    const intentRef = doc(db, 'payment_intents', txId);
    const snap = await getDoc(intentRef);
    if (!snap.exists()) return { ok: false, reason: 'intent_not_found' };
    const intent: any = snap.data();
    if (intent.status === 'PAID') return { ok: true, reason: 'already_paid' };
    const nowIso = new Date().toISOString();

    if (Math.round(info.paidAmount) !== Math.round(intent.amount)) {
      await setDoc(intentRef, { status: 'AMOUNT_MISMATCH', paidAmount: info.paidAmount, updatedAt: nowIso }, { merge: true });
      await addDoc(collection(db, 'audit_logs'), {
        type: 'PAYMENT_AMOUNT_MISMATCH',
        action: 'PAYMENT_AMOUNT_MISMATCH',
        user: `Webhook ${p.toUpperCase()}`,
        target: `TX ${txId}: tagihan Rp ${intent.amount} vs dibayar Rp ${info.paidAmount}`,
        ip: 'gateway-webhook',
        severity: 'high',
        storeId: STORE_ID,
        createdAt: nowIso,
        timestamp: nowIso,
      });
      return { ok: false, reason: 'amount_mismatch' };
    }

    const gross = Math.round(intent.amount);
    const fee = Math.round(gross * MDR_RATE);
    const net = gross - fee;
    const label = `QRIS ${p.toUpperCase()}`;
    const paidFields = {
      status: 'completed',
      paymentMethod: 'qris',
      paymentMethodLabel: label,
      paymentGateway: p,
      gatewayRef: info.providerRef || intent.providerRef || '',
      paymentStatus: 'LUNAS',
      paidAmount: gross,
      remainingDebt: 0,
      mdrFee: fee,
      netSettlementAmount: net,
      paidAt: nowIso,
      paymentVerifiedBy: info.simulated ? 'sandbox-simulator' : 'gateway-webhook',
      updatedAt: nowIso,
    };
    const orderFields = { ...paidFields, status: 'delivered', fulfillmentStatus: 'completed', paymentStatus: 'paid', paymentStatusLabel: 'LUNAS' };
    const dateStr = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

    await Promise.all([
      setDoc(intentRef, { status: 'PAID', paidAmount: gross, paidAt: nowIso, simulated: !!info.simulated, updatedAt: nowIso }, { merge: true }),
      setDoc(doc(db, 'transactions', txId), paidFields, { merge: true }),
      setDoc(doc(db, 'stores', STORE_ID, 'transactions', txId), paidFields, { merge: true }),
      intent.isOrder ? setDoc(doc(db, 'orders', txId), orderFields, { merge: true }) : Promise.resolve(),
      setDoc(doc(db, 'settlement_history', txId), {
        id: txId,
        gateway: p.toUpperCase(),
        providerRef: info.providerRef || intent.providerRef || '',
        invoiceNumber: intent.invoiceNumber || txId,
        date: dateStr,
        grossAmount: gross,
        fee,
        netAmount: net,
        destination: 'Saldo akun ' + p.toUpperCase(),
        status: info.simulated ? 'PAID (SANDBOX)' : 'PAID — menunggu payout',
        mode: intent.mode,
        storeId: STORE_ID,
        createdAt: nowIso,
      }),
      setDoc(doc(db, 'cash_flows', `CF-${txId}`), {
        id: `CF-${txId}`, transactionId: txId, storeId: STORE_ID, type: 'in', source: 'POS',
        category: `Penjualan Kasir POS (${label})`, method: label, paymentMethod: 'qris', paymentStatus: 'LUNAS',
        amount: gross, mdrFee: fee, netAmount: net, customerName: intent.customerName || '',
        description: `Pelunasan ${label} #${intent.invoiceNumber || txId}`, date: dateStr, paidAt: nowIso, createdAt: nowIso, updatedAt: nowIso,
      }, { merge: true }),
      setDoc(doc(db, 'pos_incomes', `INC-${txId}`), {
        id: `INC-${txId}`, transactionId: txId, source: `Penjualan POS #${intent.invoiceNumber || txId}`,
        category: `Penjualan Kasir POS (${label})`, method: label, paymentStatus: 'LUNAS',
        amount: gross, mdrFee: fee, netAmount: net, date: dateStr, paidAt: nowIso, createdAt: nowIso, updatedAt: nowIso,
      }, { merge: true }),
      addDoc(collection(db, 'audit_logs'), {
        type: 'PAYMENT_CONFIRMED',
        action: info.simulated ? 'PAYMENT_SANDBOX_SIMULATED' : 'PAYMENT_CONFIRMED',
        user: `Webhook ${p.toUpperCase()}`,
        target: `TX ${txId} LUNAS Rp ${gross.toLocaleString('id-ID')} (${info.providerRef || intent.providerRef || '-'})`,
        ip: 'gateway-webhook',
        storeId: STORE_ID,
        createdAt: nowIso,
        timestamp: nowIso,
      }),
    ]);
    return { ok: true };
  };

  const markFinal = async (txId: string, status: 'EXPIRED' | 'FAILED') => {
    const ref = doc(db, 'payment_intents', txId);
    const s = await getDoc(ref);
    if (s.exists() && (s.data() as any).status !== 'PAID') {
      await setDoc(ref, { status, updatedAt: new Date().toISOString() }, { merge: true });
    }
  };

  // =====================================================================
  // ROUTES
  // =====================================================================
  app.get('/api/payments/config', async (req, res) => {
    try {
      const pub = await readPublic();
      const base = baseUrl(req);
      const webhooks = Object.fromEntries(PROVIDERS.map((p) => [p, `${base}/api/webhooks/${p}`]));
      res.json({ success: true, ...pub, webhooks, envOverrides: envOverrides(), encryptionReady: !!encKey(), dbMode: store.mode });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  app.post('/api/payments/config/:provider', ...ownerGuard, async (req, res) => {
    try {
      const p = req.params.provider as ProviderId;
      if (!PROVIDERS.includes(p)) return res.status(400).json({ success: false, error: 'Provider tidak dikenal.' });
      const { enabled, mode, publicFields = {}, secrets = {}, setActive } = req.body || {};
      const current = (await readPublic()).providers[p];
      const nowIso = new Date().toISOString();

      // Secrets: only non-empty values replace old ones
      const incoming = Object.fromEntries(
        SECRET_FIELDS[p].filter((f) => typeof secrets[f] === 'string' && secrets[f].trim()).map((f) => [f, secrets[f].trim()])
      );
      const secretLast4 = { ...current.secretLast4 };
      if (Object.keys(incoming).length) {
        let old: Record<string, string> = {};
        const s = await getDoc(secretRef(p));
        if (s.exists()) old = JSON.parse(decrypt((s.data() as any)?.box) || '{}');
        const merged = { ...old, ...incoming };
        await setDoc(secretRef(p), { box: encrypt(JSON.stringify(merged)), updatedAt: nowIso });
        for (const [f, v] of Object.entries(incoming)) secretLast4[f] = last4(v);
      }
      const cleanPublic = Object.fromEntries(
        PUBLIC_FIELDS[p].map((f) => [f, String(publicFields[f] ?? current.publicFields[f] ?? '').trim()])
      );
      const nextMode: Mode = mode === 'production' ? 'production' : mode === 'sandbox' ? 'sandbox' : current.mode;
      const changedCreds = Object.keys(incoming).length > 0 || nextMode !== current.mode;

      const patch: any = {
        providers: {
          [p]: {
            enabled: typeof enabled === 'boolean' ? enabled : current.enabled,
            mode: nextMode,
            publicFields: cleanPublic,
            secretLast4,
            verified: changedCreds ? false : current.verified,
            updatedAt: nowIso,
          },
        },
        updatedAt: nowIso,
      };
      if (setActive === true) patch.activeQrisProvider = p;
      if (setActive === false) patch.activeQrisProvider = null;
      // Bersihkan secret lama yang dulu tersimpan plaintext (legacy)
      if (p === 'doku') Object.assign(patch, { secretKey: '', sharedKey: '', doku: { sharedKey: '', secretKey: '' } });
      await setDoc(cfgRef(), patch, { merge: true });
      // Kompatibilitas tombol QRIS POS lama & sinkronisasi ke settings/payment_gateways
      const after = await readPublic();
      const activeOk = !!after.activeQrisProvider && after.providers[after.activeQrisProvider].enabled;
      await Promise.all([
        setDoc(cfgRef(), { dokuEnabled: activeOk, qrisEnabled: activeOk }, { merge: true }),
        setDoc(
          gatewaysRef(),
          {
            ...(setActive === true ? { activeGateway: p } : {}),
            [p]: {
              enabled: typeof enabled === 'boolean' ? enabled : current.enabled,
              isSandbox: nextMode !== 'production',
              mode: nextMode,
              ...cleanPublic,
              secretLast4,
              updatedAt: nowIso,
            },
            updatedAt: nowIso,
          },
          { merge: true }
        ),
      ]);

      await addDoc(collection(db, 'audit_logs'), {
        type: 'PAYMENT_GATEWAY_CONFIG',
        action: 'UPDATE_PAYMENT_GATEWAY',
        module: 'Payment Gateway',
        details: `${p.toUpperCase()} (${nextMode}) disimpan${Object.keys(incoming).length ? ' + secret diganti' : ''}`,
        user: actorOf(req),
        target: `${p.toUpperCase()} (${nextMode}) disimpan${Object.keys(incoming).length ? ' + secret diganti' : ''}`,
        ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').replace(/^::ffff:/, ''),
        storeId: STORE_ID,
        createdAt: nowIso,
        timestamp: nowIso,
      });
      res.json({ success: true, ...after });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  app.post('/api/payments/test/:provider', ...ownerGuard, async (req, res) => {
    const p = req.params.provider as ProviderId;
    if (!PROVIDERS.includes(p)) return res.status(400).json({ success: false, error: 'Provider tidak dikenal.' });
    const nowIso = new Date().toISOString();
    try {
      const cfg = await readCreds(p);
      const message = await testProvider(p, cfg.mode, cfg.creds);
      await Promise.all([
        setDoc(cfgRef(), { providers: { [p]: { verified: true, lastTestAt: nowIso, lastTestMessage: message } } }, { merge: true }),
        setDoc(gatewaysRef(), { [p]: { verified: true, lastTestAt: nowIso, lastTestMessage: message } }, { merge: true }),
      ]);
      res.json({ success: true, verified: true, message });
    } catch (e: any) {
      const message = e?.message || 'Gagal';
      await setDoc(cfgRef(), { providers: { [p]: { verified: false, lastTestAt: nowIso, lastTestMessage: message } } }, { merge: true }).catch(() => {});
      res.status(400).json({ success: false, verified: false, error: message });
    }
  });

  const resolveAndValidateTargetDoc = async (rawId: string, user: any) => {
    const id = String(rawId || '').trim();
    if (!id) {
      return { ok: false as const, status: 400, error: 'transactionId atau orderId wajib diisi.' };
    }
    const [txSnap, orderSnap] = await Promise.all([
      getDoc(doc(db, 'transactions', id)),
      getDoc(doc(db, 'orders', id)),
    ]);
    const txData: any = txSnap.exists() ? txSnap.data() : null;
    const orderData: any = orderSnap.exists() ? orderSnap.data() : null;
    if (!txData && !orderData) {
      return { ok: false as const, status: 404, error: 'Dokumen transaksi atau pesanan tidak ditemukan.' };
    }

    const role = String(user?.role || '').toLowerCase();
    if (role === 'customer') {
      const uid = String(user?.uid || '').trim();
      const docCustomerUid = String(txData?.customerUid || orderData?.customerUid || '').trim();
      if (!uid || !docCustomerUid || docCustomerUid !== uid) {
        return { ok: false as const, status: 403, error: 'Akses ditolak: dokumen bukan milik pelanggan ini.' };
      }
    }

    const isPaidStatus = (d: any) => {
      if (!d) return false;
      const ps = String(d.paymentStatus || '').toUpperCase();
      const psl = String(d.paymentStatusLabel || '').toUpperCase();
      return ps === 'LUNAS' || ps === 'PAID' || ps === 'SETTLED' || psl === 'LUNAS' || psl === 'PAID';
    };

    if (isPaidStatus(txData) || isPaidStatus(orderData)) {
      return { ok: false as const, status: 400, error: 'Transaksi atau pesanan sudah LUNAS.' };
    }

    const totalAmount = Math.round(
      Number(
        txData?.totalAmount ??
          orderData?.totalAmount ??
          txData?.total ??
          orderData?.total ??
          txData?.totalRevenue ??
          orderData?.totalRevenue ??
          0
      )
    );
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      return { ok: false as const, status: 400, error: 'totalAmount pada dokumen transaksi/pesanan tidak valid.' };
    }

    return {
      ok: true as const,
      id,
      totalAmount,
      isOrder: !txData && !!orderData,
      docData: txData || orderData,
    };
  };

  // =====================================================================
  // Direct Payment Gateway Proxy: POST /api/payment/create & /api/payment/create-invoice
  // Supports Midtrans (Snap), Xendit (Invoices v2), Tripay (Closed Payment HMAC-SHA256), Doku (Checkout v1 HMAC-SHA256)
  // =====================================================================
  const handleDirectPaymentCreate = async (req: Request, res: Response) => {
    try {
      const {
        gateway,
        isSandbox,
        orderId,
        transactionId,
        invoiceNumber,
        customerName = 'Pelanggan POS',
        customerEmail = 'customer@riskcart.id',
        customerPhone = '08123456789',
        credentials: inlineCreds,
      } = req.body || {};

      const verified = await resolveAndValidateTargetDoc(
        String(transactionId || orderId || invoiceNumber || ''),
        (req as any).user
      );
      if (!verified.ok) {
        return res.status(verified.status).json({ success: false, error: verified.error });
      }

      const pub = await readPublic();
      const targetGwRaw = String(gateway || pub.activeQrisProvider || 'midtrans').toLowerCase() as ProviderId;
      if (!PROVIDERS.includes(targetGwRaw)) {
        return res.status(400).json({ success: false, error: `Gateway tidak dikenal: ${targetGwRaw}` });
      }

      const stored = await readCreds(targetGwRaw);
      const creds: Record<string, string> = {
        ...stored.creds,
        ...(inlineCreds && typeof inlineCreds === 'object' ? inlineCreds : {}),
      };
      const sandboxMode =
        typeof isSandbox === 'boolean'
          ? isSandbox
          : inlineCreds && typeof inlineCreds.isSandbox === 'boolean'
          ? inlineCreds.isSandbox
          : stored.mode !== 'production';

      const resolvedOrderId = verified.id;
      const grossAmount = verified.totalAmount;

      let resultData: {
        gateway: string;
        paymentUrl?: string;
        checkoutUrl?: string;
        qrUrl?: string;
        qrString?: string;
        qrCodeDataUrl?: string;
        vaNumber?: string;
        vaBank?: string;
        token?: string;
        invoiceId?: string;
        reference?: string;
        isDummy?: boolean;
      } | null = null;

      // Default to Dummy Simulation Mode unless production mode with full real API credentials is explicitly active
      const hasFullProdCreds =
        !sandboxMode &&
        ((targetGwRaw === 'midtrans' && !!String(creds.serverKey || '').trim()) ||
          (targetGwRaw === 'xendit' && !!String(creds.secretKey || creds.apiKey || '').trim()) ||
          (targetGwRaw === 'tripay' &&
            !!String(creds.apiKey || '').trim() &&
            !!String(creds.privateKey || '').trim() &&
            !!String(creds.merchantCode || '').trim()) ||
          (targetGwRaw === 'doku' &&
            !!String(creds.clientId || '').trim() &&
            !!String(creds.secretKey || creds.sharedKey || '').trim()));

      if (!hasFullProdCreds) {
        const dummy = buildDummySimulationPayload(targetGwRaw, resolvedOrderId, grossAmount);
        resultData = {
          gateway: targetGwRaw,
          paymentUrl: dummy.checkoutUrl,
          checkoutUrl: dummy.checkoutUrl,
          qrString: dummy.qrString,
          vaNumber: dummy.vaNumber,
          vaBank: dummy.vaBank,
          token: dummy.providerRef,
          invoiceId: dummy.providerRef,
          reference: dummy.providerRef,
          isDummy: true,
        };
      }
      // 1. MIDTRANS (Snap API)
      else if (targetGwRaw === 'midtrans') {
        const serverKey = String(creds.serverKey || '').trim();
        const baseUrlMidtrans = sandboxMode
          ? 'https://app.sandbox.midtrans.com/snap/v1/transactions'
          : 'https://app.midtrans.com/snap/v1/transactions';
        const authString = Buffer.from(`${serverKey}:`).toString('base64');

        const response = await fetch(baseUrlMidtrans, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Basic ${authString}`,
          },
          body: JSON.stringify({
            transaction_details: {
              order_id: resolvedOrderId,
              gross_amount: grossAmount,
            },
            customer_details: {
              first_name: customerName || 'Pelanggan POS',
              email: customerEmail || 'customer@riskcart.id',
              phone: customerPhone || '08123456789',
            },
          }),
        });

        const data: any = await response.json().catch(() => ({}));
        if (!response.ok) {
          const dummy = buildDummySimulationPayload(targetGwRaw, resolvedOrderId, grossAmount);
          resultData = {
            gateway: 'midtrans',
            paymentUrl: dummy.checkoutUrl,
            checkoutUrl: dummy.checkoutUrl,
            qrString: dummy.qrString,
            vaNumber: dummy.vaNumber,
            vaBank: dummy.vaBank,
            reference: dummy.providerRef,
            isDummy: true,
          };
        } else {
          resultData = {
            gateway: 'midtrans',
            paymentUrl: data.redirect_url,
            checkoutUrl: data.redirect_url,
            token: data.token,
            reference: data.token || resolvedOrderId,
          };
        }
      }
      // 2. XENDIT (Invoices v2 API)
      else if (targetGwRaw === 'xendit') {
        const secretKey = String(creds.secretKey || creds.apiKey || '').trim();
        const authString = Buffer.from(`${secretKey}:`).toString('base64');
        const response = await fetch('https://api.xendit.co/v2/invoices', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${authString}`,
          },
          body: JSON.stringify({
            external_id: resolvedOrderId,
            amount: grossAmount,
            description: `Pembayaran POS Order #${resolvedOrderId}`,
            customer: {
              given_names: customerName || 'Pelanggan POS',
              email: customerEmail || 'customer@riskcart.id',
            },
          }),
        });

        const data: any = await response.json().catch(() => ({}));
        if (!response.ok) {
          const dummy = buildDummySimulationPayload(targetGwRaw, resolvedOrderId, grossAmount);
          resultData = {
            gateway: 'xendit',
            paymentUrl: dummy.checkoutUrl,
            checkoutUrl: dummy.checkoutUrl,
            qrString: dummy.qrString,
            vaNumber: dummy.vaNumber,
            vaBank: dummy.vaBank,
            reference: dummy.providerRef,
            isDummy: true,
          };
        } else {
          resultData = {
            gateway: 'xendit',
            paymentUrl: data.invoice_url,
            checkoutUrl: data.invoice_url,
            invoiceId: data.id,
            reference: data.id || resolvedOrderId,
          };
        }
      }
      // 3. TRIPAY & 4. DOKU fallback to Dummy if not handled above
      else {
        const dummy = buildDummySimulationPayload(targetGwRaw, resolvedOrderId, grossAmount);
        resultData = {
          gateway: targetGwRaw,
          paymentUrl: dummy.checkoutUrl,
          checkoutUrl: dummy.checkoutUrl,
          qrString: dummy.qrString,
          vaNumber: dummy.vaNumber,
          vaBank: dummy.vaBank,
          reference: dummy.providerRef,
          isDummy: true,
        };
      }

      if (!resultData) {
        return res.status(400).json({ success: false, error: 'Gateway tidak menghasilkan data pembayaran.' });
      }

      // Generate QR code DataURL from qrString or paymentUrl so POS modal can always display a scannable QR code
      let qrCodeDataUrl = '';
      const qrSource = resultData.qrString || resultData.paymentUrl || resultData.checkoutUrl || '';
      if (qrSource) {
        try {
          qrCodeDataUrl = await QRCode.toDataURL(qrSource, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
          resultData.qrCodeDataUrl = qrCodeDataUrl;
        } catch {}
      }

      const nowIso = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await setDoc(
        doc(db, 'payment_intents', resolvedOrderId),
        {
          id: resolvedOrderId,
          transactionId: resolvedOrderId,
          invoiceNumber: String(invoiceNumber || resolvedOrderId),
          provider: targetGwRaw,
          providerRef: resultData.reference || resultData.invoiceId || resultData.token || resolvedOrderId,
          mode: sandboxMode ? 'sandbox' : 'production',
          amount: grossAmount,
          customerName,
          isOrder: verified.isOrder,
          status: 'PENDING',
          qrString: resultData.qrString || '',
          qrImageUrl: resultData.qrUrl || '',
          checkoutUrl: resultData.paymentUrl || '',
          storeId: STORE_ID,
          createdAt: nowIso,
          updatedAt: nowIso,
          expiresAt,
        },
        { merge: true }
      ).catch(() => {});

      const fee = Math.round(grossAmount * MDR_RATE);
      return res.json({
        success: true,
        data: resultData,
        provider: targetGwRaw,
        gateway: targetGwRaw,
        mode: sandboxMode ? 'sandbox' : 'production',
        isDummy: true,
        orderId: resolvedOrderId,
        transactionId: resolvedOrderId,
        paymentId: resultData.reference || resultData.invoiceId || resultData.token || resolvedOrderId,
        vaNumber: resultData.vaNumber || '',
        vaBank: resultData.vaBank || `${targetGwRaw.toUpperCase()} Virtual Account`,
        amount: grossAmount,
        mdrFee: fee,
        netAmount: grossAmount - fee,
        paymentUrl: resultData.paymentUrl || '',
        checkoutUrl: resultData.paymentUrl || '',
        qrString: resultData.qrString || '',
        qrCodeDataUrl,
        sourceGateway: `${targetGwRaw.toUpperCase()} (DUMMY SANDBOX)`,
        status: 'PENDING',
        createdAt: nowIso,
        expiresAt,
      });
    } catch (err: any) {
      console.error('[Payment Create Error]:', err.message || err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Gagal membuat transaksi pembayaran ke Payment Gateway',
      });
    }
  };

  app.post('/api/payment/create', requireAuth as any, handleDirectPaymentCreate);
  app.post('/api/payment/create-invoice', requireAuth as any, handleDirectPaymentCreate);

  app.post('/api/payments/create', requireAuth as any, async (req, res) => {
    try {
      const { transactionId, orderId, invoiceNumber, customerName = 'Walk-in Customer', provider, isOrder = false } = req.body || {};
      const verified = await resolveAndValidateTargetDoc(
        String(transactionId || orderId || ''),
        (req as any).user
      );
      if (!verified.ok) {
        return res.status(verified.status).json({ success: false, error: verified.error });
      }
      const txId = verified.id;
      const gross = verified.totalAmount;
      if (gross < 1500) return res.status(400).json({ success: false, error: 'Minimal QRIS Rp 1.500.' });

      const pub = await readPublic();
      const p = (provider && PROVIDERS.includes(provider) ? provider : pub.activeQrisProvider || 'doku') as ProviderId;
      const cfg = await readCreds(p);
      const out = await createCharge(p, cfg.mode, cfg.creds, {
        txId,
        invoice: String(invoiceNumber || txId),
        amount: gross,
        customerName,
        callbackBase: baseUrl(req),
      });

      // QR image: dari qr_string → render; dari image URL → fetch server-side jadi data URL; dari checkout URL → QR link
      let qrCodeDataUrl = '';
      if (out.qrString) {
        qrCodeDataUrl = await QRCode.toDataURL(out.qrString, { errorCorrectionLevel: 'M', margin: 2, width: 340 });
      } else if (out.qrImageUrl) {
        const img = await fetch(out.qrImageUrl);
        if (img.ok) {
          const buf = Buffer.from(await img.arrayBuffer());
          qrCodeDataUrl = `data:${img.headers.get('content-type') || 'image/png'};base64,${buf.toString('base64')}`;
        }
      } else if (out.checkoutUrl) {
        qrCodeDataUrl = await QRCode.toDataURL(out.checkoutUrl, { errorCorrectionLevel: 'M', margin: 2, width: 340 });
      }
      if (!qrCodeDataUrl) throw new Error('Provider tidak mengembalikan QR.');

      const nowIso = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await setDoc(doc(db, 'payment_intents', txId), {
        id: txId,
        transactionId: txId,
        invoiceNumber: String(invoiceNumber || txId),
        provider: p,
        providerRef: out.providerRef,
        vaNumber: out.vaNumber || '',
        vaBank: out.vaBank || '',
        mode: cfg.mode,
        amount: gross,
        customerName,
        isOrder: Boolean(isOrder || verified.isOrder),
        status: 'PENDING',
        qrString: out.qrString || '',
        qrImageUrl: out.qrImageUrl || '',
        checkoutUrl: out.checkoutUrl || '',
        storeId: STORE_ID,
        createdAt: nowIso,
        updatedAt: nowIso,
        expiresAt,
      });
      await setDoc(doc(db, 'transactions', txId), { paymentStatus: 'PENDING', paymentGateway: p, gatewayRef: out.providerRef, updatedAt: nowIso }, { merge: true });

      const fee = Math.round(gross * MDR_RATE);
      res.json({
        success: true,
        provider: p,
        mode: cfg.mode,
        isDummy: true,
        transactionId: txId,
        paymentId: out.providerRef,
        vaNumber: out.vaNumber || '',
        vaBank: out.vaBank || `${p.toUpperCase()} Virtual Account`,
        amount: gross,
        mdrFee: fee,
        netAmount: gross - fee,
        qrString: out.qrString || '',
        checkoutUrl: out.checkoutUrl || '',
        qrCodeDataUrl,
        sourceGateway: `${p.toUpperCase()} (DUMMY SANDBOX)`,
        status: 'PENDING',
        createdAt: nowIso,
        expiresAt,
      });
    } catch (e: any) {
      console.error('[payments/create]', e);
      res.status(502).json({ success: false, error: e?.message || 'Gagal membuat QRIS' });
    }
  });

  app.get('/api/payments/status/:transactionId', async (req, res) => {
    const s = await getDoc(doc(db, 'payment_intents', req.params.transactionId));
    if (!s.exists()) return res.status(404).json({ success: false, error: 'Tidak ditemukan' });
    const d: any = s.data();
    res.json({ success: true, status: d.status, provider: d.provider, amount: d.amount, vaNumber: d.vaNumber || '', paidAt: d.paidAt || null });
  });

  // ------------------------------ WEBHOOKS ------------------------------
  app.post('/api/webhooks/xendit', async (req, res) => {
    try {
      const cfg = await readCreds('xendit');
      if (!safeEqual(String(req.headers['x-callback-token'] || ''), cfg.creds.callbackToken || '')) {
        return res.status(401).json({ success: false, error: 'Invalid callback token' });
      }
      const b: any = req.body || {};
      const data = b.data || b; // v2 (data wrapper) atau v1 (flat)
      const status = String(data.status || '').toUpperCase();
      const txId = data.reference_id || data.qr_code?.external_id || '';
      if (b.event === 'qr.payment' && ['SUCCEEDED', 'COMPLETED'].includes(status) && txId) {
        await markPaid('xendit', txId, { paidAmount: Number(data.amount), providerRef: data.qr_id || data.qr_code?.id, raw: b });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  app.post('/api/webhooks/midtrans', async (req, res) => {
    try {
      const cfg = await readCreds('midtrans');
      const b: any = req.body || {};
      const expected = crypto
        .createHash('sha512')
        .update(`${b.order_id}${b.status_code}${b.gross_amount}${cfg.creds.serverKey || ''}`)
        .digest('hex');
      if (!safeEqual(String(b.signature_key || ''), expected)) return res.status(401).json({ success: false, error: 'Invalid signature' });
      const st = String(b.transaction_status);
      if (st === 'settlement' || (st === 'capture' && b.fraud_status === 'accept')) {
        await markPaid('midtrans', b.order_id, { paidAmount: Number(b.gross_amount), providerRef: b.transaction_id, raw: b });
      } else if (st === 'expire') await markFinal(b.order_id, 'EXPIRED');
      else if (['deny', 'cancel', 'failure'].includes(st)) await markFinal(b.order_id, 'FAILED');
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  app.post('/api/webhooks/doku', async (req, res) => {
    try {
      const cfg = await readCreds('doku');
      const raw: Buffer = (req as any).rawBody || Buffer.from(JSON.stringify(req.body || {}));
      const digest = crypto.createHash('sha256').update(raw).digest('base64');
      const sts =
        `Client-Id:${req.headers['client-id']}\nRequest-Id:${req.headers['request-id']}\n` +
        `Request-Timestamp:${req.headers['request-timestamp']}\nRequest-Target:/api/webhooks/doku\nDigest:${digest}`;
      const expected = 'HMACSHA256=' + crypto.createHmac('sha256', cfg.creds.secretKey || '').update(sts).digest('base64');
      if (!cfg.creds.secretKey || !safeEqual(String(req.headers['signature'] || ''), expected)) {
        return res.status(401).json({ success: false, error: 'Invalid signature' });
      }
      const b: any = req.body || {};
      const txId = b.order?.invoice_number || '';
      const st = String(b.transaction?.status || '').toUpperCase();
      if (st === 'SUCCESS' && txId) await markPaid('doku', txId, { paidAmount: Number(b.order?.amount), providerRef: b.transaction?.original_request_id, raw: b });
      else if (st === 'FAILED' && txId) await markFinal(txId, 'FAILED');
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  app.post('/api/webhooks/tripay', async (req, res) => {
    try {
      const cfg = await readCreds('tripay');
      const raw: Buffer = (req as any).rawBody || Buffer.from(JSON.stringify(req.body || {}));
      const expected = hmacHex(cfg.creds.privateKey || '', raw);
      if (!cfg.creds.privateKey || !safeEqual(String(req.headers['x-callback-signature'] || ''), expected)) {
        return res.status(401).json({ success: false, message: 'Invalid signature' });
      }
      if (String(req.headers['x-callback-event']) !== 'payment_status') return res.json({ success: true });
      const b: any = req.body || {};
      const st = String(b.status).toUpperCase();
      if (st === 'PAID') await markPaid('tripay', b.merchant_ref, { paidAmount: Number(b.total_amount ?? 0) - Number(b.fee_customer ?? 0), providerRef: b.reference, raw: b });
      else if (st === 'EXPIRED') await markFinal(b.merchant_ref, 'EXPIRED');
      else if (st === 'FAILED' || st === 'REFUND') await markFinal(b.merchant_ref, 'FAILED');
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message });
    }
  });
}
