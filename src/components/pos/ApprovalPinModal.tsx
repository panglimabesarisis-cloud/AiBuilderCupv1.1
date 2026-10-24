import React, { useCallback, useRef, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { logAudit, verifyApproverPin } from '../../services/posRuntime';

/**
 * Hook otorisasi PIN Owner/Supervisor/Manager (sesuai pengaturan Hak Akses).
 * const { requestApproval, approvalModal } = useApprovalPin();
 * const ok = await requestApproval('Buka laci kasir (No-Sale)', 'DRAWER_NO_SALE');
 */
export function useApprovalPin() {
  const [req, setReq] = useState<{ title: string; action: string } | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const requestApproval = useCallback((title: string, action: string) => {
    setPin('');
    setErr(null);
    setReq({ title, action });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setReq(null);
    setPin('');
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!req || busy) return;
    setBusy(true);
    const r = await verifyApproverPin(pin);
    setBusy(false);
    if (r.valid) {
      void logAudit({ action: `${req.action}_APPROVED`, target: req.title });
      close(true);
    } else {
      void logAudit({ action: `${req.action}_PIN_FAILED`, target: req.title });
      setErr(r.error || 'PIN salah.');
    }
  };

  const approvalModal = req ? (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-amber-500/40 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-400" /> Otorisasi Supervisor
          </h3>
          <button type="button" onClick={() => close(false)} className="text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-zinc-300">{req.title}</p>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN Owner / Supervisor / Manager"
          className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-white text-center tracking-widest font-mono"
        />
        {err && <div className="text-[11px] text-rose-400">{err}</div>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || !pin}
            className="flex-1 py-2 rounded-xl bg-amber-500 text-black font-bold text-xs disabled:opacity-50"
          >
            {busy ? 'Memverifikasi…' : 'Otorisasi'}
          </button>
          <button type="button" onClick={() => close(false)} className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-xs">
            Batal
          </button>
        </div>
      </form>
    </div>
  ) : null;

  return { requestApproval, approvalModal };
}
