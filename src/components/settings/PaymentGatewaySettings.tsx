import React, { useEffect, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import {
  CheckCircle,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  History,
  Key,
  RefreshCw,
  Save,
  ShieldCheck,
  XCircle,
  Zap,
} from 'lucide-react';
import { db } from '../../firebase';
import { paymentGatewayApi, type ProviderId } from '../../services/paymentGatewayClient';
import {
  PaymentGatewayConfig,
  DEFAULT_PAYMENT_GATEWAY_CONFIG,
  GatewayProviderId,
} from '../../types/settings';
import { logRealAudit } from '../../utils/auditLogger';

const GATEWAY_LIST: {
  id: GatewayProviderId;
  name: string;
  desc: string;
  fields: { key: string; label: string; secret?: boolean; placeholder?: string }[];
}[] = [
  {
    id: 'midtrans',
    name: 'Midtrans',
    desc: 'QRIS, GoPay, ShopeePay & Virtual Account via Snap API & Core API',
    fields: [
      { key: 'merchantCode', label: 'Merchant ID (contoh: G123456789)', placeholder: 'G...' },
      { key: 'clientKey', label: 'Client Key (SB-Mid-client-... / Mid-client-...)', placeholder: 'SB-Mid-client-...' },
      { key: 'serverKey', label: 'Server Key (SB-Mid-server-... / Mid-server-...)', secret: true, placeholder: 'SB-Mid-server-...' },
    ],
  },
  {
    id: 'xendit',
    name: 'Xendit',
    desc: 'Invoice V2, Dynamic QRIS, Virtual Account & E-Wallet',
    fields: [
      { key: 'secretKey', label: 'Secret API Key (xnd_development_... / xnd_production_...)', secret: true, placeholder: 'xnd_development_...' },
      { key: 'apiKey', label: 'Webhook Verification Token (Opsional)', secret: true, placeholder: 'Token verifikasi callback webhook' },
    ],
  },
  {
    id: 'tripay',
    name: 'Tripay',
    desc: 'Closed Payment QRIS, Virtual Account & Convenience Store (HMAC-SHA256)',
    fields: [
      { key: 'merchantCode', label: 'Merchant Code (contoh: T12345)', placeholder: 'T...' },
      { key: 'apiKey', label: 'API Key (DEV-... / PROD-...)', secret: true, placeholder: 'DEV-...' },
      { key: 'privateKey', label: 'Private Key (untuk HMAC-SHA256)', secret: true, placeholder: 'Private key Tripay' },
    ],
  },
  {
    id: 'doku',
    name: 'DOKU',
    desc: 'Jokul Checkout V1, QRIS Dinamis & Direct Virtual Account',
    fields: [
      { key: 'clientId', label: 'Client ID (BRN-...)', placeholder: 'BRN-...' },
      { key: 'secretKey', label: 'Secret Key / Shared Key (SK-...)', secret: true, placeholder: 'SK-...' },
    ],
  },
];

interface Props {
  initialProvider?: ProviderId;
}

export const PaymentGatewaySettings: React.FC<Props> = ({ initialProvider = 'midtrans' }) => {
  const [config, setConfig] = useState<PaymentGatewayConfig>(DEFAULT_PAYMENT_GATEWAY_CONFIG);
  const [selectedTab, setSelectedTab] = useState<GatewayProviderId>(
    ['xendit', 'midtrans', 'doku', 'tripay'].includes(initialProvider) ? initialProvider : 'midtrans'
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingGateway, setTestingGateway] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    gateway: string;
    ok: boolean;
    message: string;
    paymentUrl?: string;
    qrCodeDataUrl?: string;
  } | null>(null);
  const [saveBanner, setSaveBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [settlements, setSettlements] = useState<any[]>([]);
  const [intents, setIntents] = useState<any[]>([]);

  // Real-time listener ke Firestore doc(db, 'settings', 'payment_gateways') + doc(db, 'settings', 'payment_gateway')
  useEffect(() => {
    const unsubGateways = onSnapshot(
      doc(db, 'settings', 'payment_gateways'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<PaymentGatewayConfig>;
          setConfig((prev) => ({
            ...prev,
            ...data,
            activeGateway: (data.activeGateway || prev.activeGateway || 'midtrans') as GatewayProviderId,
            xendit: { ...prev.xendit, ...(data.xendit || {}) },
            midtrans: { ...prev.midtrans, ...(data.midtrans || {}) },
            doku: { ...prev.doku, ...(data.doku || {}) },
            tripay: { ...prev.tripay, ...(data.tripay || {}) },
          }));
        }
        setLoading(false);
      },
      () => setLoading(false)
    );

    const unsubLegacy = onSnapshot(
      doc(db, 'settings', 'payment_gateway'),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data() as any;
        setConfig((prev) => ({
          ...prev,
          activeGateway: (d.activeGateway || d.activeQrisProvider || prev.activeGateway || 'midtrans') as GatewayProviderId,
          xendit: {
            ...prev.xendit,
            ...(d.xendit || {}),
            ...(d.providers?.xendit?.publicFields || {}),
            enabled: typeof d.xendit?.enabled === 'boolean' ? d.xendit.enabled : prev.xendit.enabled,
          },
          midtrans: {
            ...prev.midtrans,
            ...(d.midtrans || {}),
            ...(d.providers?.midtrans?.publicFields || {}),
            enabled: typeof d.midtrans?.enabled === 'boolean' ? d.midtrans.enabled : prev.midtrans.enabled,
          },
          doku: {
            ...prev.doku,
            ...(d.doku || {}),
            ...(d.providers?.doku?.publicFields || {}),
            clientId: d.doku?.clientId || d.clientId || prev.doku.clientId || '',
            secretKey: d.doku?.secretKey || d.doku?.sharedKey || d.secretKey || prev.doku.secretKey || '',
            enabled: typeof d.dokuEnabled === 'boolean' ? d.dokuEnabled : prev.doku.enabled,
          },
          tripay: {
            ...prev.tripay,
            ...(d.tripay || {}),
            ...(d.providers?.tripay?.publicFields || {}),
            enabled: typeof d.tripay?.enabled === 'boolean' ? d.tripay.enabled : prev.tripay.enabled,
          },
        }));
      },
      () => {}
    );

    const u1 = onSnapshot(query(collection(db, 'settlement_history'), orderBy('createdAt', 'desc'), limit(50)), (s) =>
      setSettlements(s.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    const u2 = onSnapshot(query(collection(db, 'payment_intents'), orderBy('createdAt', 'desc'), limit(20)), (s) =>
      setIntents(s.docs.map((d) => ({ id: d.id, ...d.data() })))
    );

    return () => {
      unsubGateways();
      unsubLegacy();
      u1();
      u2();
    };
  }, []);

  const updateGatewayField = (gw: GatewayProviderId, field: string, value: any) => {
    setConfig((prev) => {
      const currentGw = prev[gw];
      const nextGw = {
        ...currentGw,
        [field]: value,
        ...(field === 'isSandbox' ? { mode: (value ? 'sandbox' : 'production') as 'sandbox' | 'production' } : {}),
      };
      return {
        ...prev,
        [gw]: nextGw,
      };
    });
  };

  const handleSaveAll = async (overrideConfig?: PaymentGatewayConfig) => {
    const targetConfig = overrideConfig || config;
    setSaving(true);
    setSaveBanner(null);
    try {
      const nowIso = new Date().toISOString();
      const payload: PaymentGatewayConfig = {
        ...targetConfig,
        updatedAt: nowIso,
      };

      const anyEnabled =
        payload.xendit.enabled || payload.midtrans.enabled || payload.doku.enabled || payload.tripay.enabled;

      // 1. Simpan ke Firestore settings/payment_gateways & settings/payment_gateway
      await Promise.all([
        setDoc(doc(db, 'settings', 'payment_gateways'), payload, { merge: true }),
        setDoc(
          doc(db, 'settings', 'payment_gateway'),
          {
            activeGateway: payload.activeGateway,
            activeQrisProvider: payload.activeGateway,
            dokuEnabled: anyEnabled,
            qrisEnabled: anyEnabled,
            xendit: payload.xendit,
            midtrans: payload.midtrans,
            doku: payload.doku,
            tripay: payload.tripay,
            updatedAt: nowIso,
          },
          { merge: true }
        ),
      ]);

      // 2. Sinkronkan juga ke server vault terenkripsi (/api/payments/config/:provider)
      const gw = selectedTab;
      const gwCfg = payload[gw];
      try {
        await paymentGatewayApi.saveConfig(gw, {
          enabled: gwCfg.enabled,
          mode: gwCfg.isSandbox ? 'sandbox' : 'production',
          publicFields: {
            ...(gwCfg.clientKey ? { clientKey: gwCfg.clientKey } : {}),
            ...(gwCfg.merchantCode ? { merchantCode: gwCfg.merchantCode, merchantId: gwCfg.merchantCode } : {}),
            ...(gwCfg.clientId ? { clientId: gwCfg.clientId } : {}),
          },
          secrets: {
            ...(gwCfg.serverKey ? { serverKey: gwCfg.serverKey } : {}),
            ...(gwCfg.secretKey ? { secretKey: gwCfg.secretKey } : {}),
            ...(gwCfg.apiKey ? { apiKey: gwCfg.apiKey, callbackToken: gwCfg.apiKey } : {}),
            ...(gwCfg.privateKey ? { privateKey: gwCfg.privateKey } : {}),
          },
          setActive: payload.activeGateway === gw ? true : undefined,
        });
      } catch {
        // Firestore settings/payment_gateways sudah tersimpan
      }

      try {
        localStorage.setItem('riskcart_doku_enabled', String(anyEnabled));
        window.dispatchEvent(new Event('riskcart-doku-config-updated'));
      } catch {}

      await logRealAudit({
        action: 'UPDATE_PAYMENT_GATEWAY',
        module: 'Payment Gateway',
        details: `Menyimpan konfigurasi Payment Gateway. Gateway utama aktif: ${payload.activeGateway.toUpperCase()} (${
          payload[payload.activeGateway].isSandbox ? 'SANDBOX' : 'PRODUCTION'
        })`,
        severity: 'WARNING',
      });

      setSaveBanner({
        ok: true,
        text: `Konfigurasi Payment Gateway (${payload.activeGateway.toUpperCase()}) berhasil disimpan ke Firestore!`,
      });
    } catch (err: any) {
      setSaveBanner({
        ok: false,
        text: `Gagal menyimpan konfigurasi: ${err.message || err}`,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async (gw: GatewayProviderId) => {
    setTestingGateway(gw);
    setTestResult(null);
    const gwConfig = config[gw];

    try {
      // Simpan perubahan terbaru ke Firestore terlebih dahulu agar backend membaca kredensial terbaru
      await setDoc(doc(db, 'settings', 'payment_gateways'), config, { merge: true });

      const res = await fetch('/api/payment/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway: gw,
          isSandbox: gwConfig.isSandbox,
          orderId: `TEST-${gw.toUpperCase()}-${Date.now()}`,
          amount: 10000,
          customerName: 'RiskCart Connection Test',
          customerEmail: 'test@riskcart.id',
          credentials: gwConfig,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Koneksi ditolak oleh API provider');
      }

      const payUrl = data.paymentUrl || data.data?.paymentUrl || data.data?.qrUrl || '';
      setTestResult({
        gateway: gw,
        ok: true,
        message: `Berhasil terhubung ke ${gw.toUpperCase()} (${gwConfig.isSandbox ? 'SANDBOX' : 'PRODUCTION'})! Invoice/QRIS uji Rp 10.000 berhasil dibuat.`,
        paymentUrl: payUrl,
        qrCodeDataUrl: data.qrCodeDataUrl || data.data?.qrCodeDataUrl,
      });

      await logRealAudit({
        action: 'TEST_PAYMENT_GATEWAY_SUCCESS',
        module: 'Payment Gateway',
        details: `Uji koneksi ${gw.toUpperCase()} (${gwConfig.isSandbox ? 'Sandbox' : 'Production'}) berhasil. URL: ${
          payUrl || 'OK'
        }`,
        severity: 'INFO',
      });
    } catch (err: any) {
      setTestResult({
        gateway: gw,
        ok: false,
        message: `Gagal terhubung ke ${gw.toUpperCase()}: ${err.message}`,
      });

      await logRealAudit({
        action: 'TEST_PAYMENT_GATEWAY_FAILED',
        module: 'Payment Gateway',
        details: `Uji koneksi ${gw.toUpperCase()} gagal: ${err.message}`,
        severity: 'WARNING',
      });
    } finally {
      setTestingGateway(null);
    }
  };

  const rp = (n: any) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
  const webhookUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/payment/webhook`;

  if (loading) {
    return <div className="p-6 text-zinc-400 text-xs">Memuat konfigurasi Payment Gateway dari Firestore...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header Banner & Tombol Simpan */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span>Integrasi Payment Gateway Resmi (Firestore Real-Time)</span>
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            Tersimpan di dokumen Firestore <code className="text-emerald-400">settings/payment_gateways</code> &amp; terhubung langsung ke Kasir POS dan aplikasi pelanggan (PWA).
          </p>
        </div>

        <button
          type="button"
          onClick={() => handleSaveAll()}
          disabled={saving}
          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-lg shadow-emerald-950/50 shrink-0"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Menyimpan ke Firestore...' : 'Simpan Semua Konfigurasi'}</span>
        </button>
      </div>

      {saveBanner && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-bold flex items-center gap-2 ${
            saveBanner.ok
              ? 'bg-emerald-950/70 border-emerald-700 text-emerald-300'
              : 'bg-rose-950/70 border-rose-700 text-rose-300'
          }`}
        >
          {saveBanner.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
          <span>{saveBanner.text}</span>
        </div>
      )}

      {/* Pilihan Gateway Utama untuk Mesin POS */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
              Gateway Utama Aktif untuk Checkout QRIS / Non-Tunai di POS &amp; PWA
            </h4>
            <p className="text-[11px] text-zinc-400">
              Pilih provider utama yang akan dipanggil oleh mesin kasir saat pelanggan memilih pembayaran QRIS/Digital.
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-mono font-bold">
            AKTIF: {config.activeGateway.toUpperCase()}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
          {GATEWAY_LIST.map((g) => {
            const isSelectedActive = config.activeGateway === g.id;
            const gwState = config[g.id];
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  setSelectedTab(g.id);
                  const nextCfg: PaymentGatewayConfig = {
                    ...config,
                    activeGateway: g.id,
                    [g.id]: { ...gwState, enabled: true },
                  };
                  setConfig(nextCfg);
                }}
                className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                  isSelectedActive
                    ? 'bg-emerald-950/40 border-emerald-500 text-white shadow-md'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-white">{g.name}</span>
                  {isSelectedActive && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500 text-zinc-950 font-black">
                      UTAMA
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      gwState.enabled ? 'bg-emerald-400' : 'bg-zinc-600'
                    }`}
                  />
                  <span>{gwState.enabled ? 'Enabled' : 'Disabled'}</span>
                  <span>•</span>
                  <span className="font-mono text-[10px] text-amber-400">
                    {gwState.isSandbox ? 'SANDBOX' : 'PRODUCTION'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Hasil Uji Koneksi Langsung */}
      {testResult && (
        <div
          className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
            testResult.ok
              ? 'bg-emerald-950/50 border-emerald-700/70 text-emerald-200'
              : 'bg-rose-950/50 border-rose-700/70 text-rose-200'
          }`}
        >
          <div className="flex items-start gap-3">
            {testResult.ok ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1 text-xs">
              <div className="font-bold">{testResult.message}</div>
              {testResult.paymentUrl && (
                <a
                  href={testResult.paymentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-emerald-300 underline font-semibold hover:text-emerald-200"
                >
                  <span>Buka Link Invoice / Checkout Test</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
          {testResult.qrCodeDataUrl && (
            <img
              src={testResult.qrCodeDataUrl}
              alt="Test QRIS"
              className="w-24 h-24 rounded-xl bg-white p-1.5 border border-zinc-700 shrink-0"
            />
          )}
        </div>
      )}

      {/* Grid 4 Kartu Kredensial Payment Gateway (Midtrans, Xendit, Tripay, Doku) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {GATEWAY_LIST.map((gw) => {
          const gwData = config[gw.id];
          const isPrimary = config.activeGateway === gw.id;

          return (
            <div
              key={gw.id}
              className={`bg-zinc-900 border rounded-2xl p-5 flex flex-col justify-between space-y-4 transition ${
                isPrimary ? 'border-emerald-500/60 shadow-lg shadow-emerald-950/20' : 'border-zinc-800'
              }`}
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3 pb-3 border-b border-zinc-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-cyan-400" />
                      <h3 className="text-base font-bold text-white">{gw.name}</h3>
                      {isPrimary && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold">
                          GATEWAY POS AKTIF
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">{gw.desc}</p>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={gwData.enabled}
                      onChange={(e) => updateGatewayField(gw.id, 'enabled', e.target.checked)}
                      className="w-4 h-4 rounded accent-emerald-500"
                    />
                    <span className="font-semibold">Aktifkan</span>
                  </label>
                </div>

                {/* Mode Sandbox vs Production */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
                  <span className="text-zinc-400 font-semibold">Environment Mode:</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateGatewayField(gw.id, 'isSandbox', true)}
                      className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer transition ${
                        gwData.isSandbox
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      Sandbox (Testing)
                    </button>
                    <button
                      type="button"
                      onClick={() => updateGatewayField(gw.id, 'isSandbox', false)}
                      className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer transition ${
                        !gwData.isSandbox
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      Production (Live)
                    </button>
                  </div>
                </div>

                {/* Input Kredensial */}
                <div className="space-y-3 text-xs">
                  {gw.fields.map((field) => (
                    <div key={field.key}>
                      <label className="block text-zinc-400 font-semibold mb-1 flex items-center gap-1">
                        {field.secret && <Key className="w-3 h-3 text-amber-400" />}
                        <span>{field.label}</span>
                      </label>
                      <input
                        type={field.secret ? 'password' : 'text'}
                        value={(gwData as any)[field.key] || ''}
                        onChange={(e) => updateGatewayField(gw.id, field.key, e.target.value)}
                        placeholder={field.placeholder || `Masukkan ${field.label}`}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  ))}

                  <div>
                    <label className="block text-zinc-500 font-semibold mb-1 text-[11px]">
                      Webhook Callback URL ({gw.name})
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={webhookUrl}
                        className="w-full bg-zinc-950/70 border border-zinc-800 rounded-xl px-3 py-1.5 text-cyan-300 font-mono text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(webhookUrl)}
                        className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl border border-zinc-700 cursor-pointer"
                        title="Salin URL Webhook"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-800 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => handleTestConnection(gw.id)}
                  disabled={testingGateway === gw.id}
                  className="flex-1 py-2 px-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border border-zinc-700 cursor-pointer transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${testingGateway === gw.id ? 'animate-spin' : ''}`} />
                  <span>
                    {testingGateway === gw.id
                      ? 'Menghubungi API...'
                      : `Uji Koneksi / Buat Invoice Test ${gw.name}`}
                  </span>
                </button>

                {!isPrimary && (
                  <button
                    type="button"
                    onClick={() => {
                      const nextCfg: PaymentGatewayConfig = {
                        ...config,
                        activeGateway: gw.id,
                        [gw.id]: { ...gwData, enabled: true },
                      };
                      setConfig(nextCfg);
                      void handleSaveAll(nextCfg);
                    }}
                    className="py-2 px-3 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-bold cursor-pointer transition flex items-center gap-1"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Jadikan Utama</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tabel Riwayat Payment Intents & Settlement */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-white text-sm flex items-center gap-2">
          <History className="w-4 h-4 text-cyan-400" /> Tagihan Pembayaran Digital Terbaru (payment_intents)
        </h3>
        <Table
          head={['Transaksi / Order ID', 'Gateway', 'Mode', 'Nominal', 'Status', 'Dibuat']}
          rows={intents.map((i) => [
            i.invoiceNumber || i.id,
            String(i.provider || '').toUpperCase(),
            String(i.mode || 'sandbox').toUpperCase(),
            rp(i.amount),
            i.status,
            i.createdAt ? new Date(i.createdAt).toLocaleString('id-ID') : '-',
          ])}
          empty="Belum ada tagihan pembayaran digital."
        />
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-white text-sm flex items-center gap-2">
          <History className="w-4 h-4 text-cyan-400" /> Riwayat Settlement Gateway (dari Webhook Terverifikasi)
        </h3>
        <Table
          head={['Transaksi', 'Gateway', 'Tanggal', 'Bruto', 'MDR (0.7%)', 'Net', 'Status']}
          rows={settlements.map((s) => [
            s.invoiceNumber || s.id,
            s.gateway,
            s.date,
            rp(s.grossAmount),
            `-${rp(s.fee)}`,
            rp(s.netAmount),
            s.status,
          ])}
          empty="Belum ada settlement. Data muncul otomatis saat pembayaran dikonfirmasi oleh webhook gateway."
        />
      </div>
    </div>
  );
};

const Table: React.FC<{ head: string[]; rows: (string | number)[][]; empty: string }> = ({ head, rows, empty }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="border-b border-zinc-800 text-zinc-400 text-[11px] uppercase tracking-wider">
          {head.map((h) => (
            <th key={h} className="py-2 px-3">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-800/60 font-mono text-[11px] text-zinc-300">
        {rows.length === 0 ? (
          <tr>
            <td colSpan={head.length} className="py-6 text-center text-zinc-500 font-sans">
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((r, i) => (
            <tr key={i} className="hover:bg-zinc-800/30">
              {r.map((c, j) => (
                <td key={j} className="py-2.5 px-3">
                  {c}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

export default PaymentGatewaySettings;
