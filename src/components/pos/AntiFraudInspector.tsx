import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, updateDoc, query, limit, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { ACTIVE_STORE_ID } from '../../config/store';
import { FraudLog, Transaction } from '../../types';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Flame,
  Radio,
  MapPin,
  Cpu,
  Boxes,
  Zap,
  CheckCircle2,
  RefreshCw,
  Play,
  FileText,
  Image as ImageIcon,
  ExternalLink,
  Lock,
  Trash2,
  Eye,
  X,
  User,
  Clock,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAppData } from '../../context/AppDataContext';
import { checkAndRecordAiCooldown } from '../../utils/aiCooldown';
import { AiRunControlBar, useAiFeatureControl } from '../common/AiRunControlBar';
import { apiFetch } from '../../services/firebaseSession';

export interface CartVoidEvidenceLog {
  id: string;
  type: 'CART_VOID_EVIDENCE';
  status?: 'CONFIRMED_BY_OWNER_PIN' | 'FAILED_PIN_ATTEMPT';
  createdAt: string;
  staffName: string;
  staffRole?: string;
  shiftId?: string;
  customerName?: string;
  actionLabel: string;
  cancelledItems: Array<{
    productId: string;
    productName: string;
    sku?: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
  totalNominal: number;
  reason: string;
  evidencePhoto?: string;
  googleDocUrl?: string;
  googleDrivePhotoUrl?: string;
}

export const isSafeEvidencePhoto = (url?: string | null): boolean =>
  Boolean(url && (url.startsWith('data:image/') || url.startsWith('https://')));

export const AntiFraudInspector: React.FC = () => {
  const { language, formatCurrency } = useLanguage();
  const { products, transactions } = useAppData();
  const [fraudLogs, setFraudLogs] = useState<FraudLog[]>([]);
  const [voidEvidenceLogs, setVoidEvidenceLogs] = useState<CartVoidEvidenceLog[]>([]);
  const [previewPhotoModal, setPreviewPhotoModal] = useState<{
    title: string;
    photoUrl: string;
    reason: string;
    staffName: string;
    createdAt: string;
    googleDocUrl?: string;
    googleDrivePhotoUrl?: string;
  } | null>(null);
  const [driveDocModal, setDriveDocModal] = useState<{
    loading: boolean;
    error?: string;
    fileName: string;
    docContentText: string;
    evidencePhoto: string;
  } | null>(null);
  const [isAuditing, setIsAuditing] = useState<boolean>(false);
  const [auditResult, setAuditResult] = useState<any | null>(null);

  const openDriveEvidenceModal = async (
    targetUrl: string,
    fallback?: { fileName?: string; docContentText?: string; evidencePhoto?: string }
  ) => {
    const cleanUrl = String(targetUrl || '').trim();
    if (!cleanUrl) return;
    if (cleanUrl.startsWith('data:image/') || (cleanUrl.startsWith('https://') && !cleanUrl.includes('/api/google-drive/'))) {
      setDriveDocModal({
        loading: false,
        fileName: fallback?.fileName || 'Bukti Dokumen',
        docContentText: fallback?.docContentText || '',
        evidencePhoto: isSafeEvidencePhoto(cleanUrl) ? cleanUrl : (isSafeEvidencePhoto(fallback?.evidencePhoto) ? fallback!.evidencePhoto! : ''),
      });
      return;
    }
    setDriveDocModal({
      loading: true,
      fileName: fallback?.fileName || 'Memuat Dokumen...',
      docContentText: '',
      evidencePhoto: '',
    });
    try {
      const res = await apiFetch(cleanUrl);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDriveDocModal({
          loading: false,
          error: data?.error || 'Dokumen belum tersedia di server.',
          fileName: fallback?.fileName || 'Dokumen Transaksi / Bukti',
          docContentText: fallback?.docContentText || '',
          evidencePhoto: isSafeEvidencePhoto(fallback?.evidencePhoto) ? fallback!.evidencePhoto! : '',
        });
        return;
      }
      const rawPhoto = String(data?.evidencePhoto || fallback?.evidencePhoto || '').trim();
      setDriveDocModal({
        loading: false,
        fileName: String(data?.fileName || fallback?.fileName || 'Dokumen Transaksi'),
        docContentText: String(data?.docContentText || fallback?.docContentText || ''),
        evidencePhoto: isSafeEvidencePhoto(rawPhoto) ? rawPhoto : '',
      });
    } catch (err: any) {
      setDriveDocModal({
        loading: false,
        error: err?.message || 'Gagal memuat data dokumen.',
        fileName: fallback?.fileName || 'Dokumen Transaksi',
        docContentText: fallback?.docContentText || '',
        evidencePhoto: isSafeEvidencePhoto(fallback?.evidencePhoto) ? fallback!.evidencePhoto! : '',
      });
    }
  };

  // Sandbox simulation parameters
  const [sandboxChannel, setSandboxChannel] = useState<'pwa_client' | 'pos'>('pwa_client');
  const [sandboxAmount, setSandboxAmount] = useState<number>(0);
  const [sandboxCartons, setSandboxCartons] = useState<number>(0);
  const [sandboxDistance, setSandboxDistance] = useState<number>(0); // meters
  const [sandboxAccuracy, setSandboxAccuracy] = useState<number>(10); // meters
  const [sandboxVelocity, setSandboxVelocity] = useState<number>(0);

  useEffect(() => {
    const qLogs = query(
      collection(db, 'fraud_logs'),
      where('storeId', '==', ACTIVE_STORE_ID),
      limit(30)
    );
    const unsub = onSnapshot(
      qLogs,
      (snapshot) => {
        const logs: FraudLog[] = [];
        snapshot.forEach((docSnap) => {
          logs.push({ id: docSnap.id, ...(docSnap.data() as Omit<FraudLog, 'id'>) });
        });
        setFraudLogs(logs);
      },
      (error) => {
        console.warn('[AntiFraudInspector] fraud_logs notice:', error);
      }
    );

    return () => unsub();
  }, []);

  // Real-time subscription to Cart Cancellation Evidence (`audit_logs` + `product_logs` + localStorage fallback)
  useEffect(() => {
    let auditDocs: CartVoidEvidenceLog[] = [];
    let productLogDocs: CartVoidEvidenceLog[] = [];

    const readLocalVoidLogs = (): CartVoidEvidenceLog[] => {
      try {
        const raw = localStorage.getItem('riskcart_cart_void_logs');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
      return [];
    };

    const mergeAndPublishVoidLogs = () => {
      const map = new Map<string, CartVoidEvidenceLog>();
      readLocalVoidLogs().forEach((item) => {
        if (item && item.id) map.set(item.id, item);
      });
      productLogDocs.forEach((item) => {
        if (item && item.id) map.set(item.id, { ...(map.get(item.id) || {}), ...item });
      });
      auditDocs.forEach((item) => {
        if (item && item.id) map.set(item.id, { ...(map.get(item.id) || {}), ...item });
      });

      const sorted = Array.from(map.values()).sort((a, b) => {
        const tA = new Date(a.createdAt || 0).getTime() || 0;
        const tB = new Date(b.createdAt || 0).getTime() || 0;
        return tB - tA;
      });
      setVoidEvidenceLogs(sorted);
    };

    mergeAndPublishVoidLogs();

    const unsubAudit = onSnapshot(
      query(
        collection(db, 'audit_logs'),
        where('storeId', '==', ACTIVE_STORE_ID),
        limit(30)
      ),
      (snap) => {
        const list: CartVoidEvidenceLog[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          if (data?.type === 'CART_VOID_EVIDENCE') {
            list.push({
              id: d.id,
              ...data,
              cancelledItems: Array.isArray(data.cancelledItems) ? data.cancelledItems : [],
            });
          }
        });
        auditDocs = list;
        mergeAndPublishVoidLogs();
      },
      () => {}
    );

    const unsubProdLogs = onSnapshot(
      query(
        collection(db, 'product_logs'),
        where('storeId', '==', ACTIVE_STORE_ID),
        limit(30)
      ),
      (snap) => {
        const list: CartVoidEvidenceLog[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          if (data?.type === 'CART_VOID_EVIDENCE') {
            list.push({
              id: d.id,
              ...data,
              cancelledItems: Array.isArray(data.cancelledItems) ? data.cancelledItems : [],
            });
          }
        });
        productLogDocs = list;
        mergeAndPublishVoidLogs();
      },
      () => {}
    );

    const handleLocalUpdate = () => mergeAndPublishVoidLogs();
    window.addEventListener('riskcart:void-evidence-updated', handleLocalUpdate);

    return () => {
      unsubAudit();
      unsubProdLogs();
      window.removeEventListener('riskcart:void-evidence-updated', handleLocalUpdate);
    };
  }, []);

  const handleRunAiAudit = async (signal?: AbortSignal) => {
    if (products.length === 0 && transactions.length === 0) {
      setAuditResult(null);
      return;
    }
    const cooldown = checkAndRecordAiCooldown('fraud-audit');
    if (!cooldown.allowed) {
      setAuditResult({
        overallHealth: 'warning',
        summary: cooldown.message,
        suspiciousPatterns: [],
        actionableRecommendations: ['Tunggu hingga cooldown 30 detik selesai sebelum menjalankan audit AI ulang.'],
      } as any);
      return;
    }
    setIsAuditing(true);
    try {
      const firstProduct = products[0];
      const sampleItem = firstProduct
        ? {
            productName: firstProduct.name,
            packageType: 'carton',
            quantityOrdered: Math.max(1, sandboxCartons),
            unitPrice: Number(firstProduct.pricePerCarton || firstProduct.pricePerUnit || 0),
          }
        : null;

      // Construct live batch from actual Firestore transactions
      const liveTxBatch = transactions.slice(0, 30).map((t) => ({
        id: t.id,
        channel: t.channel,
        totalAmount: t.totalAmount,
        status: t.status,
        customerName: t.customerName,
        customerPhone: t.customerPhone,
        paymentMethod: t.paymentMethod,
        distanceToStoreMeters: t.distanceToStoreMeters,
        gpsAccuracy: t.gpsAccuracy,
        fraudScore: t.fraudScore,
        fraudFlags: t.fraudFlags,
        createdAt: t.createdAt,
        items: sampleItem ? [sampleItem] : [],
      }));

      const varianceLogs: any[] = voidEvidenceLogs.slice(0, 20).map((v) => ({
        id: v.id,
        type: v.type,
        staffName: v.staffName,
        actionLabel: v.actionLabel,
        totalNominal: v.totalNominal,
        reason: v.reason,
        createdAt: v.createdAt,
      }));

      const res = await apiFetch('/api/ai/fraud-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          manualTrigger: true,
          transactions: liveTxBatch,
          inventoryVariances: varianceLogs,
          timeRange: 'last_30_records',
          agentKey: 'agent_fraud_audit',
          language,
        }),
      });

      const data = await res.json();
      setAuditResult(data);
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      console.warn('Audit notice:', error);
    } finally {
      setIsAuditing(false);
    }
  };

  const aiAntiFraudControl = useAiFeatureControl({
    featureKey: 'ai_anti_fraud_inspector',
    onRun: async (signal) => {
      await handleRunAiAudit(signal);
    },
  });

  const handleResolveLog = async (logId: string) => {
    try {
      await updateDoc(doc(db, 'fraud_logs', logId), {
        resolved: true,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `fraud_logs/${logId}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Preventive AI Anti-Fraud Shield
          </h1>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1">
            <Cpu className="w-3 h-3" />
            Gemini 3.8 Flash Engine
          </span>
        </div>
        <p className="text-sm text-zinc-400 mt-1">
          Multi-layered threat interception evaluating Geofence telemetry, Cashier Cart Void PIN &amp; Photo Evidence, Google Docs Transaction Audit, and inventory velocity.
        </p>
      </div>

      {/* 4 Shield Pillars Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2">
          <div className="flex items-center gap-2 text-rose-400 text-xs font-bold uppercase tracking-wider">
            <MapPin className="w-4 h-4" />
            Geofence Guard
          </div>
          <div className="text-lg font-bold text-white">500m Precision Perimeter</div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Strict geodesic haversine verification blocks remote out-of-region orders masquerading as local customers.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2">
          <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider">
            <Lock className="w-4 h-4" />
            Cart Void Lock (PIN + Foto)
          </div>
          <div className="text-lg font-bold text-white">100% Staff Void Protection</div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Semua penghapusan item keranjang &amp; Clear Cart wajib PIN Owner, alasan tertulis, dan bukti foto kamera/galeri.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2">
          <div className="flex items-center gap-2 text-blue-400 text-xs font-bold uppercase tracking-wider">
            <FileText className="w-4 h-4" />
            Google Docs &amp; Drive Sync
          </div>
          <div className="text-lg font-bold text-white">Auto-Doc Per Transaction</div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Setiap nota transaksi selesai &amp; bukti pembatalan otomatis dibuatkan file Google Doc sesuai Nomor Transaksi.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2">
          <div className="flex items-center gap-2 text-purple-400 text-xs font-bold uppercase tracking-wider">
            <Zap className="w-4 h-4" />
            Cash Payment Blocker
          </div>
          <div className="text-lg font-bold text-white">Zero Unpaid Cash Checkout</div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Memblokir transaksi metode Tunai jika kasir belum memasukkan nominal Uang Diterima yang valid.
          </p>
        </div>
      </div>

      {/* SECTION BARU: BUKTI PEMBATALAN KERANJANG (PIN OWNER + ALASAN + FOTO + GOOGLE DRIVE) */}
      <div className="bg-[#110f0a] border border-amber-500/40 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-amber-500/30 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-black text-amber-50">
                Bukti Pembatalan Keranjang (PIN + Alasan + Foto)
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                {voidEvidenceLogs.length} Log Bukti
              </span>
            </div>
            <p className="text-xs text-amber-200/70 mt-1">
              Rekaman forensik setiap penghapusan item keranjang (`🗑️`), pengurangan Qty (`-`), `Clear Cart`, atau `Order Baru` di Mesin Kasir POS beserta foto bukti &amp; sinkronisasi Google Drive.
            </p>
          </div>
        </div>

        {voidEvidenceLogs.length === 0 ? (
          <div className="p-8 rounded-xl bg-black/50 border border-amber-500/20 text-center text-zinc-400 text-xs">
            Belum ada riwayat pembatalan item keranjang kasir. Setiap pembatalan yang dilakukan di Mesin Kasir POS akan otomatis muncul di sini lengkap dengan foto bukti dan link Google Drive.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-amber-500/30">
            <table className="w-full text-left text-xs text-zinc-200">
              <thead className="bg-black/80 text-[10px] font-black uppercase tracking-wider text-amber-300 border-b border-amber-500/30">
                <tr>
                  <th className="py-3 px-3">Waktu &amp; ID</th>
                  <th className="py-3 px-3">Kasir Aktif</th>
                  <th className="py-3 px-3">Jenis Aksi &amp; Status PIN</th>
                  <th className="py-3 px-3">Item Dibatalkan &amp; Nominal</th>
                  <th className="py-3 px-3">Alasan / Keterangan</th>
                  <th className="py-3 px-3 text-center">Foto Bukti</th>
                  <th className="py-3 px-3 text-right">Google Doc &amp; Drive</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-500/20 bg-[#0b0906]/90">
                {voidEvidenceLogs.map((vlog) => {
                  const isFailedPin = vlog.status === 'FAILED_PIN_ATTEMPT';
                  const syncKey = encodeURIComponent(String(vlog.id || '').replace(/[^a-zA-Z0-9_-]/g, '_'));
                  const docUrl = `/api/google-drive/doc/${syncKey}`;
                  const photoDriveUrl = vlog.evidencePhoto
                    ? `/api/google-drive/photo/${syncKey}`
                    : '';

                  return (
                    <tr key={vlog.id} className="hover:bg-amber-500/5 transition">
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-mono font-bold text-amber-300 text-[11px]">
                          #{vlog.id.slice(-8).toUpperCase()}
                        </div>
                        <div className="text-[10px] text-zinc-400 flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3 text-amber-400/70" />
                          {vlog.createdAt
                            ? new Date(vlog.createdAt).toLocaleString('id-ID', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '-'}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-amber-400" />
                          <span>{vlog.staffName || 'Kasir POS'}</span>
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          {vlog.staffRole || 'Cashier'} • {vlog.customerName || 'Walk-in'}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <span className="inline-block px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 font-bold text-[10px] uppercase">
                          {vlog.actionLabel || 'Hapus Item'}
                        </span>
                        <div className="mt-1">
                          {isFailedPin ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-950 text-red-300 border border-red-700 text-[9px] font-black">
                              ⚠️ PIN OWNER SALAH (DITOLAK)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[9px] font-bold">
                              ✓ PIN OWNER TERVERIFIKASI
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="space-y-0.5 max-w-[230px]">
                          {Array.isArray(vlog.cancelledItems) && vlog.cancelledItems.length > 0 ? (
                            vlog.cancelledItems.map((ci, idx) => (
                              <div key={idx} className="text-[11px] text-zinc-200 truncate">
                                <span className="font-bold text-amber-300">{ci.quantity}x</span>{' '}
                                {ci.productName}{' '}
                                <span className="text-zinc-400 font-mono">
                                  ({formatCurrency(Number(ci.subtotal || ci.unitPrice * ci.quantity || 0))})
                                </span>
                              </div>
                            ))
                          ) : (
                            <span className="text-zinc-500 italic">Item keranjang</span>
                          )}
                        </div>
                        <div className="font-mono font-black text-rose-400 text-xs mt-1">
                          Total: {formatCurrency(Number(vlog.totalNominal || 0))}
                        </div>
                      </td>

                      <td className="py-3 px-3 max-w-[220px]">
                        <div className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] text-amber-100 leading-snug">
                          {vlog.reason || '-'}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-center">
                        {isSafeEvidencePhoto(vlog.evidencePhoto) ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewPhotoModal({
                                title: `${vlog.actionLabel} — #${vlog.id.slice(-8).toUpperCase()}`,
                                photoUrl: vlog.evidencePhoto!,
                                reason: vlog.reason,
                                staffName: vlog.staffName,
                                createdAt: vlog.createdAt,
                                googleDocUrl: docUrl,
                                googleDrivePhotoUrl: photoDriveUrl,
                              })
                            }
                            className="group relative inline-flex flex-col items-center gap-1 cursor-pointer"
                            title="Klik untuk memperbesar Foto Bukti Pembatalan"
                          >
                            <img
                              src={vlog.evidencePhoto}
                              alt="Bukti Batal"
                              className="w-14 h-14 object-cover rounded-lg border-2 border-amber-500/60 group-hover:border-amber-300 shadow-md transition"
                            />
                            <span className="text-[9px] font-bold text-amber-300 flex items-center gap-0.5">
                              <Eye className="w-2.5 h-2.5" /> Preview
                            </span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-zinc-500 italic">Tanpa Foto</span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="flex flex-col items-end gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              void openDriveEvidenceModal(docUrl, {
                                fileName: `${vlog.actionLabel} — #${vlog.id}`,
                                docContentText: `Alasan: ${vlog.reason || '-'}\nKasir: ${vlog.staffName || '-'}\nTotal Batal: ${formatCurrency(Number(vlog.totalNominal || 0))}`,
                                evidencePhoto: vlog.evidencePhoto,
                              })
                            }
                            className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/35 text-blue-300 border border-blue-500/40 font-bold text-[10px] inline-flex items-center gap-1 transition cursor-pointer"
                          >
                            <span>📊 Buka Google Spreadsheet</span>
                            <Eye className="w-2.5 h-2.5" />
                          </button>
                          {photoDriveUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                void openDriveEvidenceModal(photoDriveUrl, {
                                  fileName: `Foto Bukti — #${vlog.id}`,
                                  docContentText: `Alasan: ${vlog.reason || '-'}`,
                                  evidencePhoto: vlog.evidencePhoto,
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/35 text-amber-300 border border-amber-500/40 font-bold text-[10px] inline-flex items-center gap-1 transition cursor-pointer"
                            >
                              <span>🖼️ Lihat Foto Drive</span>
                              <Eye className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION BARU: ARSIP DOKUMEN GOOGLE DOC TRANSAKSI POS (NAMA FILE = NOMOR TRANSAKSI) */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-400" />
              Arsip Otomatis File Google Doc Transaksi POS (Nama File = Nomor Transaksi)
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Setiap transaksi selesai di Mesin Kasir POS otomatis disinkronkan menjadi dokumen Google Doc dengan nama file sesuai Nomor Transaksi / Nota.
            </p>
          </div>
        </div>

        {transactions.length === 0 ? (
          <div className="p-6 text-center text-zinc-500 text-xs">
            Belum ada transaksi tersimpan.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-left text-xs text-zinc-300">
              <thead className="bg-zinc-950 text-[10px] font-black uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-3">Nama File Google Doc (No. Transaksi)</th>
                  <th className="py-3 px-3">Waktu</th>
                  <th className="py-3 px-3">Kasir</th>
                  <th className="py-3 px-3">Pelanggan</th>
                  <th className="py-3 px-3">Metode Bayar</th>
                  <th className="py-3 px-3 text-right">Total Nominal</th>
                  <th className="py-3 px-3 text-right">Dokumen Google Drive</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {transactions.slice(0, 15).map((tx) => {
                  const anyTx = tx as any;
                  const fileOrderNum =
                    anyTx.orderNumber || `POS-${tx.id.slice(-6).toUpperCase()}`;
                  const syncDocId = String(fileOrderNum || tx.id).replace(/[^a-zA-Z0-9_-]/g, '_');
                  const txDocUrl = `/api/google-drive/doc/${encodeURIComponent(syncDocId)}`;
                  return (
                    <tr key={tx.id} className="hover:bg-zinc-800/40 transition">
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-400">
                        📄 {fileOrderNum}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-400 font-mono text-[11px]">
                        {tx.createdAt
                          ? new Date(tx.createdAt).toLocaleString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '-'}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-white">
                        {anyTx.cashierName || 'Kasir POS'}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-200">
                        {tx.customerName || 'Walk-in Customer'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded bg-zinc-800 text-amber-300 font-bold text-[10px] uppercase">
                          {anyTx.paymentMethodLabel || tx.paymentMethod || 'Tunai'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                        {formatCurrency(Number(tx.totalAmount ?? anyTx.total ?? 0))}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            void openDriveEvidenceModal(txDocUrl, {
                              fileName: fileOrderNum,
                              docContentText: `Nomor Transaksi: ${fileOrderNum}\nPelanggan: ${tx.customerName || 'Walk-in Customer'}\nKasir: ${anyTx.cashierName || 'Kasir POS'}\nTotal: ${formatCurrency(Number(tx.totalAmount ?? anyTx.total ?? 0))}`,
                            })
                          }
                          className="px-3 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/35 text-blue-300 border border-blue-500/40 font-bold text-[10px] inline-flex items-center gap-1 transition cursor-pointer"
                        >
                          <span>📊 Buka Google Spreadsheet</span>
                          <Eye className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Interactive AI Anti-Fraud Sandbox */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Flame className="w-5 h-5 text-rose-500" />
              Live AI Forensic Simulation Sandbox
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Tweak checkout parameters and watch Gemini AI evaluate the threat payload in real time.
            </p>
          </div>

          <AiRunControlBar
            featureLabel="AI Preventif Anti-Fraud"
            enabled={aiAntiFraudControl.enabled}
            isRunning={aiAntiFraudControl.isRunning || isAuditing}
            onToggle={aiAntiFraudControl.toggleEnabled}
            onRun={() => void aiAntiFraudControl.runNow()}
          />
        </div>

        {/* Sandbox Sliders / Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
          {/* Channel & Cartons */}
          <div className="space-y-4">
            <div>
              <label className="block font-medium text-zinc-400 mb-1">Checkout Channel</label>
              <select
                value={sandboxChannel}
                onChange={(e) => setSandboxChannel(e.target.value as any)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-white"
              >
                <option value="pwa_client">Client PWA (Remote Mobile Web)</option>
                <option value="pos">In-Person POS Cashier Terminal</option>
              </select>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="font-medium text-zinc-400">Bulk Dus / Cartons Ordered:</span>
                <span className="font-mono text-white font-bold">{sandboxCartons} Cartons</span>
              </div>
              <input
                type="range"
                min="1"
                max="25"
                value={sandboxCartons}
                onChange={(e) => {
                  const c = Number(e.target.value);
                  setSandboxCartons(c);
                  setSandboxAmount(c * 20);
                }}
                className="w-full accent-blue-500"
              />
              <span className="text-[10px] text-zinc-500">
                Total Transaction Value: ${sandboxAmount.toFixed(2)}
              </span>
            </div>
          </div>

          {/* GPS Distance & Accuracy */}
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-1">
                <span className="font-medium text-zinc-400">Distance to Store (Geofence: 500m):</span>
                <span
                  className={`font-mono font-bold ${
                    sandboxDistance > 500 ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {sandboxDistance > 1000 ? `${(sandboxDistance / 1000).toFixed(1)} km` : `${sandboxDistance} m`}
                </span>
              </div>
              <input
                type="range"
                min="5"
                max="25000"
                step="50"
                value={sandboxDistance}
                onChange={(e) => setSandboxDistance(Number(e.target.value))}
                className="w-full accent-rose-500"
              />
              <span className="text-[10px] text-zinc-500">
                {sandboxDistance > 500 ? 'Breaches 500m Geofence Boundary!' : 'Inside Safe Retail Geofence'}
              </span>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="font-medium text-zinc-400">Reported GPS Accuracy:</span>
                <span className="font-mono text-white font-bold">
                  {sandboxAccuracy === 0 ? '0m (Mock GPS Provider!)' : `±${sandboxAccuracy}m`}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                value={sandboxAccuracy}
                onChange={(e) => setSandboxAccuracy(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>
          </div>

          {/* Velocity Burst */}
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-1">
                <span className="font-medium text-zinc-400">Order Velocity within 10 Mins:</span>
                <span
                  className={`font-mono font-bold ${
                    sandboxVelocity >= 3 ? 'text-rose-400' : 'text-zinc-300'
                  }`}
                >
                  {sandboxVelocity} Orders
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="8"
                value={sandboxVelocity}
                onChange={(e) => setSandboxVelocity(Number(e.target.value))}
                className="w-full accent-purple-500"
              />
              <span className="text-[10px] text-zinc-500">
                {sandboxVelocity >= 3 ? 'Triggers scalper bot velocity warning' : 'Normal human shopping speed'}
              </span>
            </div>

            <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 text-[11px] text-zinc-400">
              <span className="text-white font-semibold block mb-0.5">Quick Presets:</span>
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setSandboxDistance(15);
                    setSandboxAccuracy(10);
                    setSandboxCartons(1);
                    setSandboxAmount(25);
                    setSandboxVelocity(1);
                  }}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                >
                  Clean Walk-in
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSandboxDistance(12000);
                    setSandboxAccuracy(0);
                    setSandboxCartons(15);
                    setSandboxAmount(300);
                    setSandboxVelocity(5);
                  }}
                  className="px-2 py-1 rounded bg-rose-950 text-rose-300 border border-rose-800"
                >
                  Spoofed Bot
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Live Evaluation Result Card */}
        {auditResult && (
          <div className="p-5 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-4 animate-in fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`px-3 py-1.5 rounded-xl font-black font-mono text-xl ${
                    (auditResult.riskScore ?? auditResult.fraudScore ?? 0) >= 75
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : (auditResult.riskScore ?? auditResult.fraudScore ?? 0) >= 45
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  }`}
                >
                  Risk Score: {auditResult.riskScore ?? auditResult.fraudScore ?? 0} / 100
                </div>

                <div>
                  <div className="text-xs font-bold text-white uppercase tracking-wider">
                    Risk Verdict: {auditResult.riskLevel || ((auditResult.riskScore ?? auditResult.fraudScore ?? 0) >= 75 ? 'critical' : (auditResult.riskScore ?? auditResult.fraudScore ?? 0) >= 45 ? 'high' : 'clean')}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    Anomalies Detected: <strong>{auditResult.anomalyCount ?? auditResult.flaggedItems?.length ?? 0}</strong>
                    {auditResult.recommendation && (
                      <span className="ml-2">| Decision: <strong>{String(auditResult.recommendation).toUpperCase()}</strong></span>
                    )}
                  </div>
                </div>
              </div>

              {/* Triggered Flags / Anomaly Types */}
              <div className="flex flex-wrap gap-1.5">
                {auditResult.fraudFlags?.map((f: string, i: number) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-rose-300 border border-rose-500/30"
                  >
                    {f}
                  </span>
                ))}
                {auditResult.flaggedItems?.slice(0, 4).map((item: any, i: number) => (
                  <span
                    key={`flagged-${i}`}
                    className="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-950/60 text-rose-300 border border-rose-800/50"
                  >
                    {item.type || item.severity}
                  </span>
                ))}
              </div>
            </div>

            {/* AI Forensic Rationale & Summary */}
            <div className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 leading-relaxed space-y-1.5">
              <strong className="text-white flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-rose-400" />
                Gemini 2.5 Flash Forensic Audit Rationale:
              </strong>
              <p className="text-zinc-300 text-xs leading-relaxed">
                {auditResult.summary || auditResult.aiExplanation || 'Analisis forensik selesai dijalankan.'}
              </p>
            </div>

            {/* Detailed Flagged Items & Anomaly Explanations */}
            {Array.isArray(auditResult.flaggedItems) && auditResult.flaggedItems.length > 0 && (
              <div className="space-y-2 pt-1 border-t border-zinc-850">
                <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  Gemini Anomaly Explanations ({auditResult.flaggedItems.length}):
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {auditResult.flaggedItems.map((item: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] font-bold text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                          {item.type}
                        </span>
                        <span className={`text-[10px] font-semibold uppercase ${
                          item.severity === 'critical' ? 'text-rose-400' : item.severity === 'high' ? 'text-amber-400' : 'text-zinc-400'
                        }`}>
                          {item.severity} severity
                        </span>
                      </div>
                      <p className="text-zinc-300 text-[11px] leading-snug">
                        {item.reason}
                      </p>
                      {item.referenceId && (
                        <div className="text-[10px] text-zinc-500 font-mono truncate">
                          Ref: {item.referenceId}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Historical Intercepted Fraud Logs */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-xl">
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-rose-400" />
          Recent Intercepted Threat Audit Trail
        </h2>

        {fraudLogs.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-xs">
            Belum ada data produk &amp; transaksi untuk dianalisis.
          </div>
        ) : (
          <div className="space-y-3">
            {fraudLogs.map((log) => (
              <div
                key={log.id}
                className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        log.riskLevel === 'critical'
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      {log.riskLevel}
                    </span>
                    <span className="font-mono text-xs font-semibold text-white">
                      #{log.anomalyType}
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-300 font-medium">{log.summary}</p>
                  <p className="text-[11px] text-zinc-500 leading-relaxed max-w-3xl">
                    {log.aiDetails}
                  </p>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  {log.resolved ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                      Resolved
                    </span>
                  ) : (
                    <button
                      onClick={() => handleResolveLog(log.id)}
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition"
                    >
                      Mark Resolved
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fullscreen Evidence Photo Preview Modal */}
      {previewPhotoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-[#110f0a] border border-amber-500/50 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-amber-500/30 pb-3">
              <div>
                <h3 className="text-base font-black text-amber-50 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-amber-400" />
                  <span>Bukti Foto Pembatalan Keranjang — {previewPhotoModal.title}</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Kasir: <strong className="text-amber-300">{previewPhotoModal.staffName}</strong> •{' '}
                  {previewPhotoModal.createdAt
                    ? new Date(previewPhotoModal.createdAt).toLocaleString('id-ID')
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewPhotoModal(null)}
                className="p-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-black rounded-xl border border-amber-500/30 p-2 flex items-center justify-center max-h-[60vh] overflow-hidden">
              {isSafeEvidencePhoto(previewPhotoModal.photoUrl) ? (
                <img
                  src={previewPhotoModal.photoUrl}
                  alt="Bukti Pembatalan"
                  className="max-h-[56vh] w-auto object-contain rounded-lg"
                />
              ) : (
                <div className="text-xs text-zinc-400 p-4">Foto bukti tidak valid atau tidak tersedia.</div>
              )}
            </div>

            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs space-y-1">
              <div className="text-[10px] font-bold uppercase text-amber-400">
                Alasan / Keterangan Pembatalan:
              </div>
              <p className="text-zinc-200">{previewPhotoModal.reason}</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2">
                {previewPhotoModal.googleDocUrl && (
                  <button
                    type="button"
                    onClick={() =>
                      void openDriveEvidenceModal(previewPhotoModal.googleDocUrl!, {
                        fileName: previewPhotoModal.title,
                        docContentText: `Alasan: ${previewPhotoModal.reason}`,
                        evidencePhoto: previewPhotoModal.photoUrl,
                      })
                    }
                    className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>📊 Buka Google Spreadsheet</span>
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                )}
                {previewPhotoModal.googleDrivePhotoUrl && (
                  <button
                    type="button"
                    onClick={() =>
                      void openDriveEvidenceModal(previewPhotoModal.googleDrivePhotoUrl!, {
                        fileName: previewPhotoModal.title,
                        docContentText: `Alasan: ${previewPhotoModal.reason}`,
                        evidencePhoto: previewPhotoModal.photoUrl,
                      })
                    }
                    className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-black text-xs inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>🖼️ Lihat Foto Drive</span>
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPreviewPhotoModal(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Dokumen & Foto Bukti Google Drive (JSON via apiFetch) */}
      {driveDocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-[#110f0a] border border-amber-500/50 p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-amber-500/30 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-400" />
                <h3 className="text-base font-black text-amber-50">{driveDocModal.fileName}</h3>
              </div>
              <button
                type="button"
                onClick={() => setDriveDocModal(null)}
                className="p-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {driveDocModal.loading ? (
              <div className="p-8 text-center text-xs text-zinc-400">Memuat data dari server...</div>
            ) : (
              <div className="space-y-4">
                {driveDocModal.error && (
                  <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-xs text-amber-200">
                    {driveDocModal.error}
                  </div>
                )}
                {driveDocModal.docContentText && (
                  <pre className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-200 whitespace-pre-wrap break-words max-h-[45vh] overflow-y-auto">
                    {driveDocModal.docContentText}
                  </pre>
                )}
                {isSafeEvidencePhoto(driveDocModal.evidencePhoto) && (
                  <div className="bg-black rounded-xl border border-amber-500/30 p-3 flex flex-col items-center gap-2">
                    <div className="text-[11px] font-bold text-amber-300 self-start">
                      Lampiran Foto Bukti:
                    </div>
                    <img
                      src={driveDocModal.evidencePhoto}
                      alt={driveDocModal.fileName}
                      className="max-h-[48vh] w-auto object-contain rounded-lg"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setDriveDocModal(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

