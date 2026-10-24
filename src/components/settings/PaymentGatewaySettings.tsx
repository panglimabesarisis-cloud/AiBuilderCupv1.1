import React, { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { CheckCircle, Copy, CreditCard, History, Key, RefreshCw, Save, ShieldAlert, Zap } from 'lucide-react';
import { db } from '../../firebase';
import { paymentGatewayApi, type PaymentConfigResponse, type ProviderId } from '../../services/paymentGatewayClient';

const META: Record<
  ProviderId,
  { name: string; publicFields: { key: string; label: string }[]; secretFields: { key: string; label: string }[]; note: string }
> = {
  xendit: {
    name: 'Xendit',
    publicFields: [],
    secretFields: [
      { key: 'secretKey', label: 'Secret API Key (xnd_development_… / xnd_production_…)' },
      { key: 'callbackToken', label: 'Webhook Verification Token (Settings > Webhooks)' },
    ],
    note: 'QRIS dinamis via /qr_codes. Mode ditentukan oleh jenis key. Sandbox bisa simulasi bayar langsung dari POS.',
  },
  midtrans: {
    name: 'Midtrans',
    publicFields: [
      { key: 'merchantId', label: 'Merchant ID' },
      { key: 'clientKey', label: 'Client Key' },
    ],
    secretFields: [{ key: 'serverKey', label: 'Server Key' }],
    note: 'QRIS Core API (acquirer GoPay). Isi Payment Notification URL di Dashboard Midtrans dengan URL webhook di bawah.',
  },
  doku: {
    name: 'DOKU',
    publicFields: [{ key: 'clientId', label: 'Client ID' }],
    secretFields: [{ key: 'secretKey', label: 'Secret Key' }],
    note: 'DOKU Checkout (QRIS). Pelanggan scan QR berisi link checkout DOKU. Isi Notification URL di Back Office DOKU.',
  },
  tripay: {
    name: 'Tripay',
    publicFields: [{ key: 'merchantCode', label: 'Kode Merchant (T…)' }],
    secretFields: [
      { key: 'apiKey', label: 'API Key' },
      { key: 'privateKey', label: 'Private Key' },
    ],
    note: 'Closed Payment metode QRIS. Isi URL Callback di Merchant > Opsi dengan URL webhook di bawah.',
  },
};
const ORDER: ProviderId[] = ['xendit', 'midtrans', 'doku', 'tripay'];

interface Props {
  initialProvider?: ProviderId;
}

export const PaymentGatewaySettings: React.FC<Props> = ({ initialProvider = 'xendit' }) => {
  const [tab, setTab] = useState<ProviderId>(ORDER.includes(initialProvider) ? initialProvider : 'xendit');
  const [cfg, setCfg] = useState<PaymentConfigResponse | null>(null);
  const [form, setForm] = useState<{ enabled: boolean; mode: 'sandbox' | 'production'; pub: Record<string, string>; sec: Record<string, string> }>({
    enabled: false,
    mode: 'sandbox',
    pub: {},
    sec: {},
  });
  const [busy, setBusy] = useState<'' | 'load' | 'save' | 'test'>('load');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [settlements, setSettlements] = useState<any[]>([]);
  const [intents, setIntents] = useState<any[]>([]);

  const load = async () => {
    setBusy('load');
    try {
      setCfg(await paymentGatewayApi.getConfig());
    } catch (e: any) {
      setMsg({ ok: false, text: `Gagal memuat konfigurasi: ${e.message}` });
    } finally {
      setBusy('');
    }
  };
  useEffect(() => {
    load();
    const u1 = onSnapshot(query(collection(db, 'settlement_history'), orderBy('createdAt', 'desc'), limit(50)), (s) =>
      setSettlements(s.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    const u2 = onSnapshot(query(collection(db, 'payment_intents'), orderBy('createdAt', 'desc'), limit(20)), (s) =>
      setIntents(s.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    return () => {
      u1();
      u2();
    };
  }, []);

  const current = cfg?.providers?.[tab];
  useEffect(() => {
    if (!current) return;
    setForm({ enabled: current.enabled, mode: current.mode, pub: { ...current.publicFields }, sec: {} });
    setMsg(null);
  }, [tab, cfg]);

  const envLocked = useMemo(() => new Set(cfg?.envOverrides?.[tab] || []), [cfg, tab]);
  const isActive = cfg?.activeQrisProvider === tab;

  const save = async (setActive?: boolean) => {
    setBusy('save');
    setMsg(null);
    try {
      const next = await paymentGatewayApi.saveConfig(tab, {
        enabled: setActive === true ? true : form.enabled,
        mode: form.mode,
        publicFields: form.pub,
        secrets: form.sec,
        setActive,
      });
      setCfg((prev) => (prev ? { ...prev, ...next } : next));
      setMsg({ ok: true, text: `${META[tab].name} tersimpan ke database.` });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    setMsg(null);
    try {
      const r = await paymentGatewayApi.test(tab);
      setMsg({ ok: true, text: r.message });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy('');
      load();
    }
  };

  const rp = (n: any) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
  const input = 'w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono text-xs';

  return (
    <div className="space-y-6">
      {!cfg?.encryptionReady && cfg && (
        <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-800 text-amber-300 text-xs flex gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>
            <b>PAYMENT_ENC_KEY</b> belum di-set di server. Secret tidak bisa disimpan ke database — set env tersebut, atau isi
            key lewat env (XENDIT_SECRET_KEY, MIDTRANS_SERVER_KEY, DOKU_SECRET_KEY, TRIPAY_API_KEY…).
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 p-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto">
        {ORDER.map((p) => {
          const pc = cfg?.providers?.[p];
          return (
            <button
              key={p}
              onClick={() => setTab(p)}
              className={`px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                tab === p ? 'bg-cyan-600 text-white shadow' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>{META[p].name}</span>
              {cfg?.activeQrisProvider === p && <span className="text-[9px] px-1 rounded bg-amber-500/30 text-amber-200">QRIS AKTIF</span>}
              {pc?.verified && <CheckCircle className="w-3 h-3 text-emerald-300" />}
            </button>
          );
        })}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
          <div>
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-cyan-400" />
              <span>{META[tab].name}</span>
            </h3>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px]">
              <span
                className={`px-2 py-0.5 rounded-full font-bold border ${
                  current?.verified
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                }`}
              >
                {current?.verified ? 'Terverifikasi' : 'Belum diverifikasi'}
              </span>
              {current?.lastTestAt && (
                <span className="text-zinc-500">
                  Tes terakhir {new Date(current.lastTestAt).toLocaleString('id-ID')} — {current.lastTestMessage}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={test}
              disabled={!!busy}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${busy === 'test' ? 'animate-spin' : ''}`} />
              <span>{busy === 'test' ? 'Menguji…' : 'Test Connection'}</span>
            </button>
            <button
              type="button"
              onClick={() => save(!isActive)}
              disabled={!!busy}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer disabled:opacity-50 ${
                isActive ? 'bg-amber-500/20 text-amber-200 border-amber-500/40' : 'bg-zinc-800 text-zinc-300 border-zinc-700'
              }`}
            >
              {isActive ? 'QRIS POS: Aktif (klik untuk matikan)' : 'Jadikan QRIS POS'}
            </button>
          </div>
        </div>

        {msg && (
          <div
            className={`p-3 rounded-xl text-xs border ${
              msg.ok ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300' : 'bg-rose-950/70 border-rose-800 text-rose-300'
            }`}
          >
            {msg.text}
          </div>
        )}

        <p className="text-[11px] text-zinc-400">{META[tab].note}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
            <span className="font-semibold text-white">Aktifkan {META[tab].name}</span>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="w-4 h-4"
            />
          </label>
          <div>
            <label className="block text-zinc-400 font-semibold mb-1">Mode</label>
            <select
              value={form.mode}
              onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as any }))}
              className={input}
            >
              <option value="sandbox">SANDBOX (uji coba)</option>
              <option value="production">PRODUCTION (uang asli)</option>
            </select>
          </div>

          {META[tab].publicFields.map((f) => (
            <div key={f.key}>
              <label className="block text-zinc-400 font-semibold mb-1">{f.label}</label>
              <input
                className={input}
                disabled={envLocked.has(f.key)}
                placeholder={envLocked.has(f.key) ? 'Diatur lewat ENV server' : ''}
                value={form.pub[f.key] || ''}
                onChange={(e) => setForm((s) => ({ ...s, pub: { ...s.pub, [f.key]: e.target.value } }))}
              />
            </div>
          ))}

          {META[tab].secretFields.map((f) => {
            const saved = current?.secretLast4?.[f.key];
            return (
              <div key={f.key}>
                <label className="block text-zinc-400 font-semibold mb-1 flex items-center gap-1">
                  <Key className="w-3 h-3" /> {f.label}
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  className={input}
                  disabled={envLocked.has(f.key)}
                  placeholder={
                    envLocked.has(f.key)
                      ? 'Diatur lewat ENV server'
                      : saved
                      ? `Tersimpan ••••${saved} — kosongkan jika tidak diubah`
                      : 'Belum diisi'
                  }
                  value={form.sec[f.key] || ''}
                  onChange={(e) => setForm((s) => ({ ...s, sec: { ...s.sec, [f.key]: e.target.value } }))}
                />
              </div>
            );
          })}

          <div className="sm:col-span-2">
            <label className="block text-zinc-400 font-semibold mb-1">Webhook / Callback URL (daftarkan di dashboard {META[tab].name})</label>
            <div className="flex items-center gap-2">
              <input readOnly value={cfg?.webhooks?.[tab] || ''} className={`${input} text-cyan-300`} />
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(cfg?.webhooks?.[tab] || '')}
                className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl border border-zinc-700 cursor-pointer"
                title="Salin"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-zinc-800">
          <button
            type="button"
            onClick={() => save()}
            disabled={!!busy}
            className="px-6 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{busy === 'save' ? 'Menyimpan…' : `Simpan ${META[tab].name}`}</span>
          </button>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-white text-sm flex items-center gap-2">
          <History className="w-4 h-4 text-cyan-400" /> Tagihan QRIS Terbaru (payment_intents)
        </h3>
        <Table
          head={['Transaksi', 'Gateway', 'Mode', 'Nominal', 'Status', 'Dibuat']}
          rows={intents.map((i) => [
            i.invoiceNumber || i.id,
            String(i.provider || '').toUpperCase(),
            i.mode,
            rp(i.amount),
            i.status,
            i.createdAt ? new Date(i.createdAt).toLocaleString('id-ID') : '-',
          ])}
          empty="Belum ada tagihan QRIS."
        />
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-white text-sm flex items-center gap-2">
          <History className="w-4 h-4 text-cyan-400" /> Riwayat Settlement Gateway (dari webhook terverifikasi)
        </h3>
        <Table
          head={['Transaksi', 'Gateway', 'Tanggal', 'Bruto', 'MDR', 'Net', 'Status']}
          rows={settlements.map((s) => [
            s.invoiceNumber || s.id,
            s.gateway,
            s.date,
            rp(s.grossAmount),
            `-${rp(s.fee)}`,
            rp(s.netAmount),
            s.status,
          ])}
          empty="Belum ada settlement. Data muncul otomatis saat pembayaran QRIS dikonfirmasi gateway."
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
