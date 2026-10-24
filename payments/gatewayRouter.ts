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
 *   PUBLIC_BASE_URL       URL publik app (untuk callback/webhook), contoh https://riskcart.ai.studio
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
function encKey(): Buffer | null {
  const raw = process.env.PAYMENT_ENC_KEY || '';
  if (raw.length < 16) return null;
  return crypto.createHash('sha256').update(raw).digest();
}
function encrypt(plain: string): { iv: string; tag: string; data: string } {
  const key = encKey();
  if (!key) throw new Error('PAYMENT_ENC_KEY belum di-set di environment server.');
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
  const secretRef = (p: ProviderId) => doc(db, 'payment_gateway_secrets', p);

  // ---------- Auth guard: pakai middleware project (session token PIN owner / Firebase ID token) ----------
  const ownerGuard = [requireAuth as any, requireRole(['owner', 'admin', 'super_admin']) as any];
  const actorOf = (req: Request) => (req as any).user?.email || (req as any).user?.uid || 'owner';

  const baseUrl = (req: Request) =>
    (process.env.PUBLIC_BASE_URL ||
      `${String(req.headers['x-forwarded-proto'] || req.protocol)}://${req.headers['x-forwarded-host'] || req.get('host')}`
    ).replace(/\/$/, '');

  const readPublic = async () => {
    const snap = await getDoc(cfgRef());
    const d: any = snap.exists() ? snap.data() : {};
    const providers: Record<string, PublicProviderConfig> = {};
    for (const p of PROVIDERS) {
      const cur = d?.providers?.[p] || {};
      providers[p] = {
        enabled: Boolean(cur.enabled),
        mode: cur.mode === 'production' ? 'production' : 'sandbox',
        publicFields: cur.publicFields || {},
        secretLast4: cur.secretLast4 || {},
        verified: Boolean(cur.verified),
        lastTestAt: cur.lastTestAt || '',
        lastTestMessage: cur.lastTestMessage || '',
        updatedAt: cur.updatedAt || '',
      };
    }
    const active = PROVIDERS.includes(d?.activeQrisProvider) ? (d.activeQrisProvider as ProviderId) : null;
    return { providers, activeQrisProvider: active };
  };

  /** Credentials lengkap (server-only). ENV > Firestore terenkripsi. */
  const readCreds = async (p: ProviderId) => {
    const { providers } = await readPublic();
    const pub = providers[p];
    let secrets: Record<string, string> = {};
    try {
      const s = await getDoc(secretRef(p));
      if (s.exists()) secrets = JSON.parse(decrypt((s.data() as any)?.box) || '{}');
    } catch {}
    const merged: Record<string, string> = { ...pub.publicFields, ...secrets };
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

  // ---------- Provider: test credentials ----------
  const testProvider = async (p: ProviderId, mode: Mode, c: Record<string, string>) => {
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

  // ---------- Provider: create dynamic QRIS ----------
  type CreateOut = { providerRef: string; qrString?: string; qrImageUrl?: string; checkoutUrl?: string; raw?: any };
  const createCharge = async (
    p: ProviderId,
    mode: Mode,
    c: Record<string, string>,
    input: { txId: string; invoice: string; amount: number; customerName: string; callbackBase: string }
  ): Promise<CreateOut> => {
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
      // Kompatibilitas tombol QRIS POS lama
      const after = await readPublic();
      const activeOk = !!after.activeQrisProvider && after.providers[after.activeQrisProvider].enabled;
      await setDoc(cfgRef(), { dokuEnabled: activeOk, qrisEnabled: activeOk }, { merge: true });

      await addDoc(collection(db, 'audit_logs'), {
        type: 'PAYMENT_GATEWAY_CONFIG',
        action: 'UPDATE_PAYMENT_GATEWAY',
        user: actorOf(req),
        target: `${p.toUpperCase()} (${nextMode}) disimpan${Object.keys(incoming).length ? ' + secret diganti' : ''}`,
        ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''),
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
      await setDoc(cfgRef(), { providers: { [p]: { verified: true, lastTestAt: nowIso, lastTestMessage: message } } }, { merge: true });
      res.json({ success: true, verified: true, message });
    } catch (e: any) {
      const message = e?.message || 'Gagal';
      await setDoc(cfgRef(), { providers: { [p]: { verified: false, lastTestAt: nowIso, lastTestMessage: message } } }, { merge: true }).catch(() => {});
      res.status(400).json({ success: false, verified: false, error: message });
    }
  });

  app.post('/api/payments/create', async (req, res) => {
    try {
      const { transactionId, invoiceNumber, amount, customerName = 'Walk-in Customer', provider, isOrder = false } = req.body || {};
      const txId = String(transactionId || '').trim();
      const gross = Math.round(Number(amount) || 0);
      if (!txId) return res.status(400).json({ success: false, error: 'transactionId wajib.' });
      if (gross < 1500) return res.status(400).json({ success: false, error: 'Minimal QRIS Rp 1.500.' });

      const pub = await readPublic();
      const p = (provider && PROVIDERS.includes(provider) ? provider : pub.activeQrisProvider) as ProviderId | null;
      if (!p || !pub.providers[p].enabled) {
        return res.status(400).json({ success: false, error: 'Belum ada payment gateway QRIS aktif. Atur di Pengaturan POS > Payment Gateway.' });
      }
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
        mode: cfg.mode,
        amount: gross,
        customerName,
        isOrder: !!isOrder,
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
        transactionId: txId,
        paymentId: out.providerRef,
        amount: gross,
        mdrFee: fee,
        netAmount: gross - fee,
        qrString: out.qrString || '',
        checkoutUrl: out.checkoutUrl || '',
        qrCodeDataUrl,
        sourceGateway: `${p.toUpperCase()} ${cfg.mode.toUpperCase()}`,
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
    res.json({ success: true, status: d.status, provider: d.provider, amount: d.amount, paidAt: d.paidAt || null });
  });

  /** Sandbox only: picu pembayaran palsu lewat simulator resmi provider (bukan tulis LUNAS langsung). */
  app.post('/api/payments/simulate-paid', async (req, res) => {
    try {
      const txId = String(req.body?.transactionId || '');
      const s = await getDoc(doc(db, 'payment_intents', txId));
      if (!s.exists()) return res.status(404).json({ success: false, error: 'Intent tidak ditemukan' });
      const intent: any = s.data();
      if (intent.mode !== 'sandbox') return res.status(403).json({ success: false, error: 'Simulasi hanya untuk mode SANDBOX.' });
      const p = intent.provider as ProviderId;
      const cfg = await readCreds(p);
      if (p === 'xendit') {
        const r = await fetch(`https://api.xendit.co/qr_codes/${intent.providerRef}/payments/simulate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-version': '2022-07-31',
            Authorization: 'Basic ' + Buffer.from(cfg.creds.secretKey + ':').toString('base64'),
          },
          body: JSON.stringify({ amount: intent.amount }),
        });
        const j: any = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.message || `Simulasi Xendit gagal (HTTP ${r.status})`);
        // Webhook Xendit akan datang; tandai juga agar demo tidak bergantung pada URL publik
        await markPaid(p, txId, { paidAmount: intent.amount, providerRef: intent.providerRef, simulated: true });
        return res.json({ success: true, message: 'Simulasi Xendit terkirim, webhook akan mengonfirmasi.' });
      }
      // Midtrans / DOKU / Tripay: gunakan simulator dashboard provider; untuk demo, tandai sebagai SANDBOX
      await markPaid(p, txId, { paidAmount: intent.amount, providerRef: intent.providerRef, simulated: true });
      res.json({ success: true, message: `Ditandai PAID (SANDBOX ${p.toUpperCase()}) — tercatat di audit log.` });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
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
