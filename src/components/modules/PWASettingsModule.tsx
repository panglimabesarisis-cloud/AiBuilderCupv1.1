import React, { useState } from 'react';
import {
  Smartphone,
  ShoppingBag,
  Bell,
  CreditCard,
  Lock,
  Save,
  CheckCircle,
  ShieldCheck,
  MapPin,
  Clock,
  UserCheck,
  Gift,
  Ticket,
  Award,
  Trophy,
  Info,
  MessageSquare,
  HelpCircle,
  Settings,
  BarChart3,
  Plus,
  Trash2,
  ExternalLink,
  Sparkles,
  User,
} from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db, isDemoModeActive } from '../../firebase';
import { useAppNavigation } from '../../router';
import { useLanguage } from '../../context/LanguageContext';
import {
  usePwaPageConfigs,
  PWA_SLUG_METADATA,
  PwaConfigSlug,
  TargetMilestoneItem,
  PwaVoucherItem,
  PwaRewardCatalogItem,
  PwaAnnouncementItem,
  PwaFaqItem,
} from '../../services/pwaPageConfigService';

interface PWASettingsModuleProps {
  subModule?: string;
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

export const PWASettingsModule: React.FC<PWASettingsModuleProps> = ({
  subModule = 'umum',
}) => {
  const { route, navigateToPath } = useAppNavigation();
  const { formatCurrency, currencyMode, tr } = useLanguage();
  const { configs, saveSlugConfig } = usePwaPageConfigs();

  // Resolve current slug from URL `/dashboard/pengaturan-pwa/:slug`
  const rawSlug = (
    route.activeTab === 'module_pwa_settings' ? route.activeSubModule : subModule
  )
    .toLowerCase()
    .replace(/_/g, '-') as PwaConfigSlug;

  const activeSlug: PwaConfigSlug = PWA_SLUG_METADATA.some((m) => m.slug === rawSlug)
    ? rawSlug
    : 'umum';

  const currentMeta =
    PWA_SLUG_METADATA.find((m) => m.slug === activeSlug) || PWA_SLUG_METADATA[0];

  const [savedToast, setSavedToast] = useState<string | null>(null);

  // Local draft states for adding new items in CRUD slugs
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('');
  const [newMilestoneTargetIdr, setNewMilestoneTargetIdr] = useState(3000000);
  const [newMilestoneRewardTitle, setNewMilestoneRewardTitle] = useState('');
  const [newMilestoneRewardVal, setNewMilestoneRewardVal] = useState(75000);
  const [newMilestoneType, setNewMilestoneType] = useState<'voucher' | 'physical' | 'bundle'>('voucher');
  const [newMilestoneCode, setNewMilestoneCode] = useState('');

  const [newVoucherCode, setNewVoucherCode] = useState('');
  const [newVoucherTitle, setNewVoucherTitle] = useState('');
  const [newVoucherDesc, setNewVoucherDesc] = useState('');
  const [newVoucherType, setNewVoucherType] = useState<'fixed' | 'percent'>('fixed');
  const [newVoucherVal, setNewVoucherVal] = useState(20000);
  const [newVoucherMinOrder, setNewVoucherMinOrder] = useState(150000);
  const [newVoucherQuota, setNewVoucherQuota] = useState(50);
  const [newVoucherExpiry, setNewVoucherExpiry] = useState('2026-12-31');

  const [newRewardTitle, setNewRewardTitle] = useState('');
  const [newRewardDesc, setNewRewardDesc] = useState('');
  const [newRewardPoints, setNewRewardPoints] = useState(250);
  const [newRewardValueIdr, setNewRewardValueIdr] = useState(25000);
  const [newRewardType, setNewRewardType] = useState<'voucher' | 'physical' | 'free_shipping'>('voucher');
  const [newRewardCode, setNewRewardCode] = useState('');
  const [newRewardStock, setNewRewardStock] = useState(30);

  const [newAnnTitle, setNewAnnTitle] = useState('');
  const [newAnnContent, setNewAnnContent] = useState('');
  const [newAnnCategory, setNewAnnCategory] = useState<'pengumuman' | 'jadwal_kurir' | 'panduan_grosir'>('pengumuman');

  const [newFaqQuestion, setNewFaqQuestion] = useState('');
  const [newFaqAnswer, setNewFaqAnswer] = useState('');
  const [newFaqCategory, setNewFaqCategory] = useState('Umum & Belanja');

  const triggerToast = (msg: string) => {
    setSavedToast(msg);
    setTimeout(() => setSavedToast(null), 3200);
  };

  const handleSelectSlug = (slug: PwaConfigSlug) => {
    navigateToPath(`/dashboard/pengaturan-pwa/${slug}`);
  };

  const handleSaveCurrentSlug = async () => {
    await saveSlugConfig(activeSlug, configs[activeSlug]);
    // Also mirror core settings to settings/pwa for backward compatibility
    if (activeSlug === 'umum' || activeSlug === 'order-pelanggan' || activeSlug === 'pembayaran') {
      await setDoc(
        doc(db, 'settings', 'pwa'),
        {
          appName: configs.umum.storeTitle,
          minOrderDelivery: configs['order-pelanggan'].minOrderAmountIdr,
          deliveryBaseFee: configs['order-pelanggan'].baseDeliveryFeeIdr,
          freeDeliveryThreshold: configs['order-pelanggan'].freeDeliveryMinIdr,
          enableCodPwa: configs.pembayaran.enableCod,
          enableQrisPwa: configs.pembayaran.enableQris,
          enableMemberKasbon: configs.pembayaran.enableHutang,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ).catch(() => {});
    }
    triggerToast(
      isDemoModeActive()
        ? `[SANDBOX DEMO] Konfigurasi slug "/dashboard/pengaturan-pwa/${activeSlug}" disimpan di memori sesi Sandbox (tidak mengubah Cloud Firestore asli)!`
        : `Konfigurasi slug "/dashboard/pengaturan-pwa/${activeSlug}" berhasil disimpan ke Firestore (pwa_page_configs/${activeSlug}) & disinkronkan secara real-time ke ${currentMeta.clientRoute}!`
    );
  };

  const goldInput =
    'w-full bg-zinc-950/90 border border-amber-500/30 focus:border-amber-400 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none transition';
  const goldCard =
    'bg-gradient-to-b from-zinc-900/95 to-zinc-950 border border-amber-500/25 rounded-2xl p-5 shadow-xl space-y-4';

  return (
    <div className="space-y-6 pb-10">
      {/* Executive Dark Gold Header */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 border border-amber-500/30 shadow-2xl flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  PENGATURAN CLIENT PWA BERBASIS SLUG
                </h1>
                <span
                  translate="no"
                  className="notranslate text-xs font-mono uppercase tracking-wider text-amber-400"
                >
                  · RiskCart 1-to-1 Sync
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Setiap perubahan pada <code className="text-amber-300 font-mono">/dashboard/pengaturan-pwa/{activeSlug}</code> langsung mengontrol halaman <code className="text-emerald-400 font-mono">{currentMeta.clientRoute}</code> secara real-time (<code className="font-mono text-zinc-300">onSnapshot</code>).
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigateToPath(currentMeta.clientRoute)}
            className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-2 cursor-pointer transition"
          >
            <ExternalLink className="w-4 h-4" />
            <span>Lihat {currentMeta.clientRoute}</span>
          </button>

          <button
            type="button"
            onClick={handleSaveCurrentSlug}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-black text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 cursor-pointer transition"
          >
            <Save className="w-4 h-4" />
            <span>Simpan Konfigurasi Slug ({activeSlug})</span>
          </button>
        </div>
      </div>

      {/* Real-Time Toast Notification */}
      {savedToast && (
        <div className="p-4 rounded-xl bg-emerald-950/90 border border-emerald-500/50 text-emerald-200 text-xs flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-bold">{savedToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setSavedToast(null)}
            className="text-emerald-400 hover:text-white font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* 1-to-1 Slug Navigation Bar */}
      <div className="bg-zinc-950 border border-zinc-800/90 rounded-2xl p-3">
        <div className="text-[11px] font-bold text-zinc-400 mb-2 px-1 flex items-center justify-between">
          <span>PILIH SLUG HALAMAN CLIENT PWA (1-TO-1 MAPPING KE FIRESTORE `pwa_page_configs`)</span>
          <span className="font-mono text-amber-400">
            Doc ID: pwa_page_configs/{activeSlug} &rarr; {currentMeta.clientRoute}
          </span>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {PWA_SLUG_METADATA.map((item) => {
            const isActive = item.slug === activeSlug;
            return (
              <button
                key={item.slug}
                type="button"
                onClick={() => handleSelectSlug(item.slug)}
                className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-zinc-950 shadow-md shadow-amber-500/20'
                    : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800'
                }`}
              >
                <span>{tr(item.labelEn, item.labelId)}</span>
                <span
                  className={`text-[10px] font-mono ${
                    isActive ? 'text-zinc-900 font-black' : 'text-zinc-500'
                  }`}
                >
                  /{item.slug}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Slug Context Banner */}
      <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-white">
              Target Kontrol: <span className="text-amber-400 font-mono">{currentMeta.clientRoute}</span>
            </div>
            <p className="text-zinc-300 mt-0.5">{tr(currentMeta.descriptionEn, currentMeta.descriptionId)}</p>
          </div>
        </div>
        <div className="text-right font-mono text-[11px] text-zinc-400 shrink-0">
          Mata Uang Aktif: <strong className="text-amber-400">{currencyMode}</strong>
        </div>
      </div>

      {/* ================================================================= */}
      {/* SLUG 1: UMUM (/dashboard/pengaturan-pwa/umum -> /client-pwa/home) */}
      {/* ================================================================= */}
      {activeSlug === 'umum' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              <span>Identitas &amp; Banner Beranda PWA (/client-pwa/clienthome)</span>
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Nama Toko di Header PWA</label>
                <input
                  type="text"
                  value={configs.umum.storeTitle}
                  onChange={(e) => saveSlugConfig('umum', { storeTitle: e.target.value })}
                  className={goldInput}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Sub-Judul Toko (Bahasa Indonesia)</label>
                <input
                  type="text"
                  value={configs.umum.storeSubtitleId}
                  onChange={(e) => saveSlugConfig('umum', { storeSubtitleId: e.target.value })}
                  className={goldInput}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Teks Banner Promo Beranda (ID)</label>
                <input
                  type="text"
                  value={configs.umum.bannerHeadlineId}
                  onChange={(e) => saveSlugConfig('umum', { bannerHeadlineId: e.target.value })}
                  className={goldInput}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Promo Banner Headline (EN)</label>
                <input
                  type="text"
                  value={configs.umum.bannerHeadlineEn}
                  onChange={(e) => saveSlugConfig('umum', { bannerHeadlineEn: e.target.value })}
                  className={goldInput}
                />
              </div>
            </div>
          </div>

          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span>Jam Operasional &amp; Mode Tutup Toko</span>
            </h3>
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Jam Buka</label>
                  <input
                    type="time"
                    value={configs.umum.openHour}
                    onChange={(e) => saveSlugConfig('umum', { openHour: e.target.value })}
                    className={goldInput}
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Jam Tutup</label>
                  <input
                    type="time"
                    value={configs.umum.closeHour}
                    onChange={(e) => saveSlugConfig('umum', { closeHour: e.target.value })}
                    className={goldInput}
                  />
                </div>
              </div>

              <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                <div>
                  <span className="font-bold text-white block">Aktifkan Mode Tutup Toko Sementara</span>
                  <span className="text-[11px] text-zinc-400">
                    Jika aktif, pelanggan melihat banner pengumuman tutup di beranda PWA
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={configs.umum.isStoreClosedMode}
                  onChange={(e) => saveSlugConfig('umum', { isStoreClosedMode: e.target.checked })}
                  className="w-4 h-4 accent-amber-500"
                />
              </label>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Pesan Pengumuman Saat Toko Tutup</label>
                <textarea
                  rows={2}
                  value={configs.umum.closedAnnouncementId}
                  onChange={(e) => saveSlugConfig('umum', { closedAnnouncementId: e.target.value })}
                  className={goldInput}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SLUG 2: LOGIN (/dashboard/pengaturan-pwa/login -> /client-pwa/login) */}
      {/* ================================================================= */}
      {activeSlug === 'login' && (
        <div className={goldCard}>
          <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
            <UserCheck className="w-4 h-4" />
            <span>Pengaturan Autentikasi Nomor WhatsApp + PIN (/client-pwa/login)</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <label className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
              <div>
                <span className="font-bold text-white block">Wajibkan PIN / Password saat Login WA</span>
                <span className="text-[11px] text-zinc-400">
                  Mencocokkan nomor WhatsApp (`08...`/`628...`) dan PIN dengan koleksi `customers`
                </span>
              </div>
              <input
                type="checkbox"
                checked={configs.login.requireWaPin}
                onChange={(e) => saveSlugConfig('login', { requireWaPin: e.target.checked })}
                className="w-4 h-4 accent-amber-500"
              />
            </label>

            <label className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
              <div>
                <span className="font-bold text-white block">Izinkan Pendaftaran Member Mandiri</span>
                <span className="text-[11px] text-zinc-400">
                  Tampilkan link &ldquo;Belum punya akun? Daftar Member&rdquo; di halaman login PWA
                </span>
              </div>
              <input
                type="checkbox"
                checked={configs.login.allowSelfRegistration}
                onChange={(e) => saveSlugConfig('login', { allowSelfRegistration: e.target.checked })}
                className="w-4 h-4 accent-amber-500"
              />
            </label>

            <div>
              <label className="block text-zinc-400 font-semibold mb-1">Level Member Default Pendaftar Baru</label>
              <input
                type="text"
                value={configs.login.defaultMemberTier}
                onChange={(e) => saveSlugConfig('login', { defaultMemberTier: e.target.value })}
                className={goldInput}
              />
            </div>

            <div>
              <label className="block text-zinc-400 font-semibold mb-1">Nomor WA Bantuan Lupa PIN</label>
              <input
                type="text"
                value={configs.login.adminSupportWa}
                onChange={(e) => saveSlugConfig('login', { adminSupportWa: e.target.value })}
                className={`${goldInput} font-mono`}
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-zinc-400 font-semibold mb-1">Sub-Judul Form Login Pelanggan</label>
              <input
                type="text"
                value={configs.login.loginSubtitleId}
                onChange={(e) => saveSlugConfig('login', { loginSubtitleId: e.target.value })}
                className={goldInput}
              />
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SLUG 3: ORDER PELANGGAN (/dashboard/pengaturan-pwa/order-pelanggan) */}
      {/* ================================================================= */}
      {activeSlug === 'order-pelanggan' && (
        <div className={goldCard}>
          <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
            <ShoppingBag className="w-4 h-4" />
            <span>Aturan Minimal Order, Ongkos Kirim &amp; Jam Checkout PWA</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block text-zinc-400 font-semibold mb-1">Minimal Order Kuantitas (Dus/Unit)</label>
              <input
                type="number"
                min={1}
                value={configs['order-pelanggan'].minOrderCartons}
                onChange={(e) =>
                  saveSlugConfig('order-pelanggan', { minOrderCartons: Number(e.target.value) })
                }
                className={`${goldInput} font-mono font-bold`}
              />
            </div>

            <div>
              <label className="block text-zinc-400 font-semibold mb-1">
                Minimal Nominal Belanja ({formatCurrency(configs['order-pelanggan'].minOrderAmountIdr)})
              </label>
              <input
                type="number"
                step={5000}
                value={configs['order-pelanggan'].minOrderAmountIdr}
                onChange={(e) =>
                  saveSlugConfig('order-pelanggan', { minOrderAmountIdr: Number(e.target.value) })
                }
                className={`${goldInput} font-mono font-bold text-amber-300`}
              />
            </div>

            <div>
              <label className="block text-zinc-400 font-semibold mb-1">
                Tarif Ongkir Dasar ({formatCurrency(configs['order-pelanggan'].baseDeliveryFeeIdr)})
              </label>
              <input
                type="number"
                step={1000}
                value={configs['order-pelanggan'].baseDeliveryFeeIdr}
                onChange={(e) =>
                  saveSlugConfig('order-pelanggan', { baseDeliveryFeeIdr: Number(e.target.value) })
                }
                className={`${goldInput} font-mono font-bold`}
              />
            </div>

            <div>
              <label className="block text-zinc-400 font-semibold mb-1">
                Batas Gratis Ongkir ({formatCurrency(configs['order-pelanggan'].freeDeliveryMinIdr)})
              </label>
              <input
                type="number"
                step={10000}
                value={configs['order-pelanggan'].freeDeliveryMinIdr}
                onChange={(e) =>
                  saveSlugConfig('order-pelanggan', { freeDeliveryMinIdr: Number(e.target.value) })
                }
                className={`${goldInput} font-mono font-bold text-emerald-400`}
              />
            </div>

            <div>
              <label className="block text-zinc-400 font-semibold mb-1">Jam Mulai Terima Order</label>
              <input
                type="time"
                value={configs['order-pelanggan'].orderStartHour}
                onChange={(e) =>
                  saveSlugConfig('order-pelanggan', { orderStartHour: e.target.value })
                }
                className={goldInput}
              />
            </div>

            <div>
              <label className="block text-zinc-400 font-semibold mb-1">Jam Batas Akhir Order</label>
              <input
                type="time"
                value={configs['order-pelanggan'].orderEndHour}
                onChange={(e) =>
                  saveSlugConfig('order-pelanggan', { orderEndHour: e.target.value })
                }
                className={goldInput}
              />
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SLUG 4: PEMBAYARAN (/dashboard/pengaturan-pwa/pembayaran)          */}
      {/* ================================================================= */}
      {activeSlug === 'pembayaran' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              <span>Metode Pembayaran Aktif di Keranjang PWA</span>
            </h3>
            <div className="space-y-2.5 text-xs">
              {[
                { key: 'enableTunai', label: 'Tunai (Bayar Langsung)', desc: 'Status pembayaran Lunas di Kasir' },
                { key: 'enableHutang', label: 'Hutang / Kasbon Member', desc: 'Tercatat ke Piutang Pelanggan' },
                { key: 'enableCod', label: 'COD (Bayar di Tempat ke Kurir)', desc: 'Kurir menerima uang saat barang tiba' },
                { key: 'enableQris', label: 'QRIS Instan Dinamis', desc: 'Scan QRIS semua e-wallet & m-banking' },
                { key: 'enableTransfer', label: 'Transfer Bank Toko', desc: 'Verifikasi bukti transfer manual/otomatis' },
              ].map((pm) => (
                <label
                  key={pm.key}
                  className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer"
                >
                  <div>
                    <span className="font-bold text-white block">{pm.label}</span>
                    <span className="text-[11px] text-zinc-400">{pm.desc}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={(configs.pembayaran as any)[pm.key]}
                    onChange={(e) =>
                      saveSlugConfig('pembayaran', { [pm.key]: e.target.checked } as any)
                    }
                    className="w-4 h-4 accent-amber-500"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5">
              Informasi Rekening Transfer &amp; Limit COD
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Nama Bank Tujuan</label>
                <input
                  type="text"
                  value={configs.pembayaran.bankName}
                  onChange={(e) => saveSlugConfig('pembayaran', { bankName: e.target.value })}
                  className={goldInput}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Nomor Rekening Toko</label>
                <input
                  type="text"
                  value={configs.pembayaran.bankAccountNumber}
                  onChange={(e) => saveSlugConfig('pembayaran', { bankAccountNumber: e.target.value })}
                  className={`${goldInput} font-mono font-bold text-amber-300`}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Atas Nama Rekening</label>
                <input
                  type="text"
                  value={configs.pembayaran.bankAccountHolder}
                  onChange={(e) => saveSlugConfig('pembayaran', { bankAccountHolder: e.target.value })}
                  className={goldInput}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">
                  Batas Maksimal Nominal COD ({formatCurrency(configs.pembayaran.maxCodAmountIdr)})
                </label>
                <input
                  type="number"
                  step={100000}
                  value={configs.pembayaran.maxCodAmountIdr}
                  onChange={(e) =>
                    saveSlugConfig('pembayaran', { maxCodAmountIdr: Number(e.target.value) })
                  }
                  className={`${goldInput} font-mono font-bold`}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SLUG 5: NOTIFIKASI (/dashboard/pengaturan-pwa/notifikasi)          */}
      {/* ================================================================= */}
      {activeSlug === 'notifikasi' && (
        <div className={goldCard}>
          <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
            <Bell className="w-4 h-4" />
            <span>Konfigurasi WhatsApp Admin &amp; Suara Alert POS</span>
          </h3>
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Nomor WhatsApp Admin Penerima Order</label>
                <input
                  type="text"
                  value={configs.notifikasi.adminWhatsappNumber}
                  onChange={(e) =>
                    saveSlugConfig('notifikasi', { adminWhatsappNumber: e.target.value })
                  }
                  className={`${goldInput} font-mono font-bold text-emerald-400`}
                />
              </div>

              <label className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                <div>
                  <span className="font-bold text-white block">Bunyikan Suara Notifikasi di Mesin Kasir POS</span>
                  <span className="text-[11px] text-zinc-400">
                    Memutar suara dering kasir saat pesanan baru masuk dari Client PWA
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={configs.notifikasi.enablePosSoundAlert}
                  onChange={(e) =>
                    saveSlugConfig('notifikasi', { enablePosSoundAlert: e.target.checked })
                  }
                  className="w-4 h-4 accent-amber-500"
                />
              </label>
            </div>

            <div>
              <label className="block text-zinc-400 font-semibold mb-1">Template Pesan WA Saat Pesanan Dibuat</label>
              <textarea
                rows={2}
                value={configs.notifikasi.orderPlacedTemplateId}
                onChange={(e) =>
                  saveSlugConfig('notifikasi', { orderPlacedTemplateId: e.target.value })
                }
                className={goldInput}
              />
            </div>

            <div>
              <label className="block text-zinc-400 font-semibold mb-1">
                Template Pesan WA Saat Klaim Hadiah / Voucher Disetujui Admin
              </label>
              <textarea
                rows={2}
                value={configs.notifikasi.orderApprovedTemplateId}
                onChange={(e) =>
                  saveSlugConfig('notifikasi', { orderApprovedTemplateId: e.target.value })
                }
                className={goldInput}
              />
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SLUG 6: PROFILE & AKUN (/dashboard/pengaturan-pwa/profile | akun) */}
      {/* ================================================================= */}
      {(activeSlug === 'profile' || activeSlug === 'akun') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
              <User className="w-4 h-4" />
              <span>Visibilitas 11 Sub-Menu di /client-pwa/profile</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              {[
                { key: 'showMenuAkun', label: '1. Profil Saya (/profile/akun)' },
                { key: 'showMenuStatistik', label: '2. Statistik Pembelian (/profile/statistik)' },
                { key: 'showMenuAlamat', label: '3. Alamat Toko (/profile/alamat)' },
                { key: 'showMenuTarget', label: '4. Hadiah Target (/profile/target)' },
                { key: 'showMenuVoucher', label: '5. Voucher Saya (/profile/voucher)' },
                { key: 'showMenuReward', label: '6. Reward & Poin (/profile/reward)' },
                { key: 'showMenuTopBuyer', label: '7. Top 10 Buyer (/profile/top-buyer)' },
                { key: 'showMenuInformasi', label: '8. Informasi (/profile/informasi)' },
                { key: 'showMenuChatAdmin', label: '9. Chat Admin (/profile/chat-admin)' },
                { key: 'showMenuFaq', label: '10. FAQ (/profile/faq)' },
                { key: 'showMenuPengaturan', label: '11. Pengaturan (/profile/pengaturan)' },
              ].map((item) => (
                <label
                  key={item.key}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer"
                >
                  <span className="text-zinc-200 font-semibold">{item.label}</span>
                  <input
                    type="checkbox"
                    checked={(configs.profile as any)[item.key]}
                    onChange={(e) =>
                      saveSlugConfig('profile', { [item.key]: e.target.checked } as any)
                    }
                    className="w-4 h-4 accent-amber-500"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5">
              Ambang Level Bintang Member &amp; Tampilan Profil Akun
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">
                  Minimal Total Belanja Level Silver ({formatCurrency(configs.profile.tierSilverMinIdr)})
                </label>
                <input
                  type="number"
                  step={500000}
                  value={configs.profile.tierSilverMinIdr}
                  onChange={(e) =>
                    saveSlugConfig('profile', { tierSilverMinIdr: Number(e.target.value) })
                  }
                  className={`${goldInput} font-mono`}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">
                  Minimal Total Belanja Level Gold ({formatCurrency(configs.profile.tierGoldMinIdr)})
                </label>
                <input
                  type="number"
                  step={500000}
                  value={configs.profile.tierGoldMinIdr}
                  onChange={(e) =>
                    saveSlugConfig('profile', { tierGoldMinIdr: Number(e.target.value) })
                  }
                  className={`${goldInput} font-mono text-amber-300`}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">
                  Minimal Total Belanja Level Royal Crown ({formatCurrency(configs.profile.tierPlatinumMinIdr)})
                </label>
                <input
                  type="number"
                  step={1000000}
                  value={configs.profile.tierPlatinumMinIdr}
                  onChange={(e) =>
                    saveSlugConfig('profile', { tierPlatinumMinIdr: Number(e.target.value) })
                  }
                  className={`${goldInput} font-mono text-emerald-400`}
                />
              </div>

              <div className="pt-2 space-y-2">
                <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                  <span className="font-semibold text-white">Tampilkan Produk Favorit Otomatis di /profile/akun</span>
                  <input
                    type="checkbox"
                    checked={configs.akun.showFavoriteProducts}
                    onChange={(e) =>
                      saveSlugConfig('akun', { showFavoriteProducts: e.target.checked })
                    }
                    className="w-4 h-4 accent-amber-500"
                  />
                </label>
                <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                  <span className="font-semibold text-white">Tampilkan Grafik Ringkasan &amp; Tabel Transaksi</span>
                  <input
                    type="checkbox"
                    checked={configs.akun.showRecentTransactionsTable}
                    onChange={(e) =>
                      saveSlugConfig('akun', { showRecentTransactionsTable: e.target.checked })
                    }
                    className="w-4 h-4 accent-amber-500"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SLUG 7: TARGET (/dashboard/pengaturan-pwa/target)                 */}
      {/* ================================================================= */}
      {activeSlug === 'target' && (
        <div className="space-y-6">
          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
              <Gift className="w-4 h-4" />
              <span>Tambah Milestone Hadiah Target Belanja Baru (/client-pwa/profile/target &amp; /promo)</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Judul Milestone</label>
                <input
                  type="text"
                  placeholder="Misal: Belanja Rp 3.000.000"
                  value={newMilestoneTitle}
                  onChange={(e) => setNewMilestoneTitle(e.target.value)}
                  className={goldInput}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">
                  Target Belanja Lunas ({formatCurrency(newMilestoneTargetIdr)})
                </label>
                <input
                  type="number"
                  step={500000}
                  value={newMilestoneTargetIdr}
                  onChange={(e) => setNewMilestoneTargetIdr(Number(e.target.value))}
                  className={`${goldInput} font-mono font-bold text-amber-300`}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Nama Hadiah Target</label>
                <input
                  type="text"
                  placeholder="Misal: 2 Karton Air Mineral / Voucher Rp 75.000"
                  value={newMilestoneRewardTitle}
                  onChange={(e) => setNewMilestoneRewardTitle(e.target.value)}
                  className={goldInput}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">
                  Nilai Valuasi Hadiah ({formatCurrency(newMilestoneRewardVal)})
                </label>
                <input
                  type="number"
                  step={5000}
                  value={newMilestoneRewardVal}
                  onChange={(e) => setNewMilestoneRewardVal(Number(e.target.value))}
                  className={`${goldInput} font-mono`}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Tipe Hadiah</label>
                <select
                  value={newMilestoneType}
                  onChange={(e) => setNewMilestoneType(e.target.value as any)}
                  className={goldInput}
                >
                  <option value="voucher">Voucher Potongan</option>
                  <option value="physical">Barang Fisik (Karton/Unit)</option>
                  <option value="bundle">Paket Bundle (Barang + Voucher)</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    if (!newMilestoneTitle.trim() || !newMilestoneRewardTitle.trim()) return;
                    const item: TargetMilestoneItem = {
                      id: `TGT-${Date.now().toString().slice(-4)}`,
                      titleId: newMilestoneTitle.trim(),
                      titleEn: newMilestoneTitle.trim(),
                      targetAmountIdr: Number(newMilestoneTargetIdr) || 1000000,
                      rewardTitleId: newMilestoneRewardTitle.trim(),
                      rewardTitleEn: newMilestoneRewardTitle.trim(),
                      rewardValueIdr: Number(newMilestoneRewardVal) || 50000,
                      rewardType: newMilestoneType,
                      voucherCode:
                        newMilestoneCode.trim() ||
                        `TGT${Math.round((Number(newMilestoneRewardVal) || 50000) / 1000)}K`,
                      physicalProductName:
                        newMilestoneType !== 'voucher' ? newMilestoneRewardTitle.trim() : undefined,
                      physicalQtyCarton: 1,
                      badgeText: 'TARGET',
                      active: true,
                    };
                    saveSlugConfig('target', {
                      milestones: [...(configs.target.milestones || []), item],
                    });
                    setNewMilestoneTitle('');
                    setNewMilestoneRewardTitle('');
                    setNewMilestoneCode('');
                    triggerToast(`Milestone "${item.titleId}" berhasil ditambahkan!`);
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ Tambah Milestone Target</span>
                </button>
              </div>
            </div>
          </div>

          <div className={goldCard}>
            <h3 className="text-sm font-bold text-white">Daftar Milestone Target Belanja Aktif</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(configs.target.milestones || []).map((ms) => (
                <div
                  key={ms.id}
                  className="p-4 rounded-xl bg-zinc-950 border border-amber-500/30 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono text-amber-400 font-bold">{ms.id}</span>
                      <span className="text-zinc-400 uppercase">{ms.rewardType}</span>
                    </div>
                    <h4 className="text-sm font-black text-white mt-1">{ms.titleId}</h4>
                    <div className="text-xs text-zinc-400 mt-1">
                      Target Belanja:{' '}
                      <strong className="text-amber-300 font-mono">
                        {formatCurrency(ms.targetAmountIdr)}
                      </strong>
                    </div>
                    <div className="mt-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs">
                      <span className="text-zinc-400 block text-[10px]">Hadiah:</span>
                      <strong className="text-white">{ms.rewardTitleId}</strong>
                      <div className="text-[11px] font-mono text-emerald-400 mt-0.5">
                        Senilai {formatCurrency(ms.rewardValueIdr)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
                    <label className="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ms.active}
                        onChange={(e) => {
                          const next = configs.target.milestones.map((x) =>
                            x.id === ms.id ? { ...x, active: e.target.checked } : x
                          );
                          saveSlugConfig('target', { milestones: next });
                        }}
                        className="accent-amber-500"
                      />
                      <span>Aktif di PWA</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const next = configs.target.milestones.filter((x) => x.id !== ms.id);
                        saveSlugConfig('target', { milestones: next });
                      }}
                      className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SLUG 8: VOUCHER (/dashboard/pengaturan-pwa/voucher)               */}
      {/* ================================================================= */}
      {activeSlug === 'voucher' && (
        <div className="space-y-6">
          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
              <Ticket className="w-4 h-4" />
              <span>Buat Kode Voucher Pelanggan Baru (/client-pwa/profile/voucher)</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Kode Voucher (Huruf Kapital)</label>
                <input
                  type="text"
                  placeholder="Misal: BERKAH50"
                  value={newVoucherCode}
                  onChange={(e) => setNewVoucherCode(e.target.value.toUpperCase())}
                  className={`${goldInput} font-mono font-bold text-amber-300 uppercase`}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Nama Promo Voucher</label>
                <input
                  type="text"
                  placeholder="Potongan Agen Rp 50.000"
                  value={newVoucherTitle}
                  onChange={(e) => setNewVoucherTitle(e.target.value)}
                  className={goldInput}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Tipe Potongan</label>
                <select
                  value={newVoucherType}
                  onChange={(e) => setNewVoucherType(e.target.value as any)}
                  className={goldInput}
                >
                  <option value="fixed">Nominal Tetap (IDR/USD)</option>
                  <option value="percent">Persentase (%)</option>
                </select>
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">
                  Nilai Diskon ({newVoucherType === 'percent' ? `${newVoucherVal}%` : formatCurrency(newVoucherVal)})
                </label>
                <input
                  type="number"
                  value={newVoucherVal}
                  onChange={(e) => setNewVoucherVal(Number(e.target.value))}
                  className={`${goldInput} font-mono font-bold`}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">
                  Minimal Belanja ({formatCurrency(newVoucherMinOrder)})
                </label>
                <input
                  type="number"
                  step={25000}
                  value={newVoucherMinOrder}
                  onChange={(e) => setNewVoucherMinOrder(Number(e.target.value))}
                  className={`${goldInput} font-mono`}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Kuota Klaim</label>
                <input
                  type="number"
                  min={1}
                  value={newVoucherQuota}
                  onChange={(e) => setNewVoucherQuota(Number(e.target.value))}
                  className={`${goldInput} font-mono`}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Masa Berlaku s/d</label>
                <input
                  type="date"
                  value={newVoucherExpiry}
                  onChange={(e) => setNewVoucherExpiry(e.target.value)}
                  className={goldInput}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    if (!newVoucherCode.trim() || !newVoucherTitle.trim()) return;
                    const vch: PwaVoucherItem = {
                      id: `VCH-${newVoucherCode.trim()}`,
                      code: newVoucherCode.trim().toUpperCase(),
                      titleId: newVoucherTitle.trim(),
                      titleEn: newVoucherTitle.trim(),
                      descriptionId:
                        newVoucherDesc.trim() ||
                        `Gunakan kode ${newVoucherCode.trim().toUpperCase()} saat checkout di PWA atau Kasir POS.`,
                      descriptionEn:
                        newVoucherDesc.trim() ||
                        `Use code ${newVoucherCode.trim().toUpperCase()} at PWA or POS checkout.`,
                      discountType: newVoucherType,
                      discountValueIdr: Number(newVoucherVal) || 10000,
                      minOrderIdr: Number(newVoucherMinOrder) || 0,
                      quota: Number(newVoucherQuota) || 50,
                      usedCount: 0,
                      expiryDate: newVoucherExpiry || '2026-12-31',
                      active: true,
                      source: 'promo',
                    };
                    saveSlugConfig('voucher', {
                      items: [vch, ...(configs.voucher.items || [])],
                    });
                    setNewVoucherCode('');
                    setNewVoucherTitle('');
                    setNewVoucherDesc('');
                    triggerToast(`Kode Voucher "${vch.code}" berhasil diterbitkan ke halaman Voucher Pelanggan!`);
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ Terbitkan Voucher</span>
                </button>
              </div>
            </div>
          </div>

          <div className={goldCard}>
            <h3 className="text-sm font-bold text-white">Katalog Voucher Aktif di /client-pwa/profile/voucher</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(configs.voucher.items || []).map((v) => (
                <div
                  key={v.id}
                  className="p-4 rounded-xl bg-zinc-950 border border-amber-500/30 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 font-mono font-black text-amber-300 text-xs">
                        {v.code}
                      </span>
                      <span className="text-[11px] font-mono text-zinc-400">
                        Kuota: {v.usedCount}/{v.quota}
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-white mt-2">{v.titleId}</h4>
                    <p className="text-xs text-zinc-400 mt-1">{v.descriptionId}</p>
                    <div className="mt-2 pt-2 border-t border-zinc-800/80 flex items-center justify-between text-xs">
                      <span className="text-zinc-400">
                        Min. Belanja: <strong className="text-white font-mono">{formatCurrency(v.minOrderIdr)}</strong>
                      </span>
                      <span className="font-mono font-bold text-emerald-400">
                        {v.discountType === 'percent'
                          ? `Diskon ${v.discountValueIdr}%`
                          : `Potongan ${formatCurrency(v.discountValueIdr)}`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
                    <span className="text-[11px] text-zinc-500 font-mono">Exp: {v.expiryDate}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = configs.voucher.items.filter((x) => x.id !== v.id);
                        saveSlugConfig('voucher', { items: next });
                      }}
                      className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SLUG 9: REWARD & POIN (/dashboard/pengaturan-pwa/reward)          */}
      {/* ================================================================= */}
      {activeSlug === 'reward' && (
        <div className="space-y-6">
          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              <span>Rumus Perolehan Poin Otomatis &amp; Keterangan di /client-pwa/profile/reward</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">
                  Persentase Alokasi Poin dari Keuntungan Produk (%)
                </label>
                <input
                  type="number"
                  step={0.5}
                  min={1}
                  max={50}
                  value={configs.reward.profitSharePercent}
                  onChange={(e) =>
                    saveSlugConfig('reward', { profitSharePercent: Number(e.target.value) })
                  }
                  className={`${goldInput} font-mono font-bold text-amber-300`}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">
                  Rasio Konversi Poin (Rp 1 = X Poin)
                </label>
                <input
                  type="number"
                  min={1}
                  value={configs.reward.rupiahToPointConversion}
                  onChange={(e) =>
                    saveSlugConfig('reward', { rupiahToPointConversion: Number(e.target.value) })
                  }
                  className={`${goldInput} font-mono font-bold text-emerald-400`}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">
                  Valuasi 1 Poin Saat Ditukar ({formatCurrency(configs.reward.pointValueIdr)})
                </label>
                <input
                  type="number"
                  min={1}
                  value={configs.reward.pointValueIdr}
                  onChange={(e) =>
                    saveSlugConfig('reward', { pointValueIdr: Number(e.target.value) })
                  }
                  className={`${goldInput} font-mono font-bold`}
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-zinc-400 font-semibold mb-1">
                  Teks Penjelasan Rumus Poin di Layar Pelanggan PWA
                </label>
                <textarea
                  rows={2}
                  value={configs.reward.formulaExplanationId}
                  onChange={(e) =>
                    saveSlugConfig('reward', { formulaExplanationId: e.target.value })
                  }
                  className={goldInput}
                />
              </div>
            </div>
          </div>

          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
              <Award className="w-4 h-4" />
              <span>Tambah Item Katalog &ldquo;Tukar Hadiah&rdquo; Poin Baru</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Nama Hadiah Penukaran</label>
                <input
                  type="text"
                  placeholder="Misal: Voucher Potongan Rp 25.000 / Gratis 1 Dus Teh"
                  value={newRewardTitle}
                  onChange={(e) => setNewRewardTitle(e.target.value)}
                  className={goldInput}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Syarat Poin Ditukar (Pts)</label>
                <input
                  type="number"
                  min={10}
                  step={10}
                  value={newRewardPoints}
                  onChange={(e) => setNewRewardPoints(Number(e.target.value))}
                  className={`${goldInput} font-mono font-bold text-amber-300`}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">
                  Nilai Nominal Hadiah ({formatCurrency(newRewardValueIdr)})
                </label>
                <input
                  type="number"
                  step={5000}
                  value={newRewardValueIdr}
                  onChange={(e) => setNewRewardValueIdr(Number(e.target.value))}
                  className={`${goldInput} font-mono font-bold text-emerald-400`}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Kategori Hadiah</label>
                <select
                  value={newRewardType}
                  onChange={(e) => setNewRewardType(e.target.value as any)}
                  className={goldInput}
                >
                  <option value="voucher">Voucher Potongan Harga</option>
                  <option value="physical">Barang Fisik (Dus/Galon)</option>
                  <option value="free_shipping">Gratis Ongkir Pengiriman</option>
                </select>
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Stok Kuota Tersedia</label>
                <input
                  type="number"
                  min={1}
                  value={newRewardStock}
                  onChange={(e) => setNewRewardStock(Number(e.target.value))}
                  className={`${goldInput} font-mono`}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    if (!newRewardTitle.trim()) return;
                    const item: PwaRewardCatalogItem = {
                      id: `REW-${Date.now().toString().slice(-4)}`,
                      titleId: newRewardTitle.trim(),
                      titleEn: newRewardTitle.trim(),
                      descriptionId:
                        newRewardDesc.trim() ||
                        `Tukar ${newRewardPoints} poin dengan ${newRewardTitle.trim()}.`,
                      descriptionEn:
                        newRewardDesc.trim() ||
                        `Redeem ${newRewardPoints} points for ${newRewardTitle.trim()}.`,
                      pointsCost: Number(newRewardPoints) || 100,
                      rewardValueIdr: Number(newRewardValueIdr) || 10000,
                      rewardType: newRewardType,
                      voucherCode:
                        newRewardType !== 'physical'
                          ? newRewardCode.trim() || `REWARD${newRewardPoints}`
                          : undefined,
                      physicalProductName:
                        newRewardType === 'physical' ? newRewardTitle.trim() : undefined,
                      stock: Number(newRewardStock) || 25,
                      category:
                        newRewardType === 'physical'
                          ? 'Hadiah Fisik'
                          : newRewardType === 'free_shipping'
                          ? 'Layanan Pengiriman'
                          : 'Voucher Belanja',
                      active: true,
                    };
                    saveSlugConfig('reward', {
                      catalog: [...(configs.reward.catalog || []), item],
                    });
                    setNewRewardTitle('');
                    setNewRewardDesc('');
                    setNewRewardCode('');
                    triggerToast(`Katalog Hadiah "${item.titleId}" (${item.pointsCost} poin) berhasil ditambahkan!`);
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ Tambah Katalog Reward</span>
                </button>
              </div>
            </div>
          </div>

          <div className={goldCard}>
            <h3 className="text-sm font-bold text-white">Daftar Katalog Tukar Hadiah Poin Aktif</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {(configs.reward.catalog || []).map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-xl bg-zinc-950 border border-amber-500/30 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono font-bold text-amber-400">{item.pointsCost} Poin</span>
                      <span className="text-zinc-400">Stok: {item.stock}</span>
                    </div>
                    <h4 className="text-sm font-bold text-white mt-1.5">{item.titleId}</h4>
                    <p className="text-xs text-zinc-400 mt-1">{item.descriptionId}</p>
                    <div className="mt-2 text-xs font-mono text-emerald-400 font-bold">
                      Nilai: {formatCurrency(item.rewardValueIdr)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
                    <span className="text-[10px] uppercase font-mono text-zinc-500">{item.rewardType}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = configs.reward.catalog.filter((x) => x.id !== item.id);
                        saveSlugConfig('reward', { catalog: next });
                      }}
                      className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SLUG 10: TOP-BUYER (/dashboard/pengaturan-pwa/top-buyer)          */}
      {/* ================================================================= */}
      {activeSlug === 'top-buyer' && (
        <div className={goldCard}>
          <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
            <Trophy className="w-4 h-4" />
            <span>Pengaturan Papan Peringkat Top 10 Buyer (/client-pwa/profile/top-buyer &amp; /leaderboard)</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-zinc-400 font-semibold mb-1">Kriteria Perhitungan Ranking #1 s/d #10</label>
              <select
                value={configs['top-buyer'].rankingBasis}
                onChange={(e) =>
                  saveSlugConfig('top-buyer', { rankingBasis: e.target.value as any })
                }
                className={goldInput}
              >
                <option value="profit">
                  Pelanggan Paling Menguntungkan bagi Toko — SUM((Harga Jual - Modal HPP) * Qty Dus)
                </option>
                <option value="omzet">Total Volume Belanja (Omzet Gross)</option>
              </select>
            </div>

            <div>
              <label className="block text-zinc-400 font-semibold mb-1">Sub-Judul Periode Papan Peringkat</label>
              <input
                type="text"
                value={configs['top-buyer'].periodLabelId}
                onChange={(e) => saveSlugConfig('top-buyer', { periodLabelId: e.target.value })}
                className={goldInput}
              />
            </div>

            <label className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
              <div>
                <span className="font-bold text-white block">
                  Sembunyikan Angka Modal HPP &amp; Profit Toko di Layar HP Pelanggan
                </span>
                <span className="text-[11px] text-zinc-400">
                  Pelanggan hanya melihat Ranking #1-#10, Nama Toko/Member, Level, Pesanan &amp; Poin
                </span>
              </div>
              <input
                type="checkbox"
                checked={configs['top-buyer'].hideStoreProfitOnPwa}
                onChange={(e) =>
                  saveSlugConfig('top-buyer', { hideStoreProfitOnPwa: e.target.checked })
                }
                className="w-4 h-4 accent-amber-500"
              />
            </label>

            <label className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
              <div>
                <span className="font-bold text-white block">Sensor Sebagian Nomor WhatsApp Member di Peringkat</span>
                <span className="text-[11px] text-zinc-400">
                  Menjaga privasi nomor telepon antar pelanggan (contoh: 0812****890)
                </span>
              </div>
              <input
                type="checkbox"
                checked={configs['top-buyer'].maskCustomerPhoneOnPwa}
                onChange={(e) =>
                  saveSlugConfig('top-buyer', { maskCustomerPhoneOnPwa: e.target.checked })
                }
                className="w-4 h-4 accent-amber-500"
              />
            </label>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SLUG 11: INFORMASI (/dashboard/pengaturan-pwa/informasi)          */}
      {/* ================================================================= */}
      {activeSlug === 'informasi' && (
        <div className="space-y-6">
          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
              <Info className="w-4 h-4" />
              <span>Jadwal Pengiriman Kurir/Shipper &amp; Panduan Member Grosir (/client-pwa/profile/informasi)</span>
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Jadwal Kloter Pengiriman Kurir Toko</label>
                <textarea
                  rows={2}
                  value={configs.informasi.courierScheduleTextId}
                  onChange={(e) =>
                    saveSlugConfig('informasi', { courierScheduleTextId: e.target.value })
                  }
                  className={goldInput}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Panduan Member &amp; Harga Grosir</label>
                <textarea
                  rows={2}
                  value={configs.informasi.wholesaleGuideTextId}
                  onChange={(e) =>
                    saveSlugConfig('informasi', { wholesaleGuideTextId: e.target.value })
                  }
                  className={goldInput}
                />
              </div>
            </div>
          </div>

          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5">
              Tambah Pengumuman Toko Baru
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Judul Pengumuman</label>
                <input
                  type="text"
                  placeholder="Misal: Libur Operasional / Stok Baru Masuk"
                  value={newAnnTitle}
                  onChange={(e) => setNewAnnTitle(e.target.value)}
                  className={goldInput}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Kategori</label>
                <select
                  value={newAnnCategory}
                  onChange={(e) => setNewAnnCategory(e.target.value as any)}
                  className={goldInput}
                >
                  <option value="pengumuman">Pengumuman Toko</option>
                  <option value="jadwal_kurir">Info Jadwal Kurir</option>
                  <option value="panduan_grosir">Panduan Member Grosir</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    if (!newAnnTitle.trim() || !newAnnContent.trim()) return;
                    const item: PwaAnnouncementItem = {
                      id: `INF-${Date.now().toString().slice(-4)}`,
                      titleId: newAnnTitle.trim(),
                      titleEn: newAnnTitle.trim(),
                      contentId: newAnnContent.trim(),
                      contentEn: newAnnContent.trim(),
                      date: new Date().toISOString().slice(0, 10),
                      category: newAnnCategory,
                      pinned: true,
                    };
                    saveSlugConfig('informasi', {
                      announcements: [item, ...(configs.informasi.announcements || [])],
                    });
                    setNewAnnTitle('');
                    setNewAnnContent('');
                    triggerToast('Pengumuman baru berhasil dipublikasikan ke halaman Informasi PWA!');
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ Publikasikan Pengumuman</span>
                </button>
              </div>
              <div className="md:col-span-3">
                <label className="block text-zinc-400 font-semibold mb-1">Isi Pengumuman</label>
                <textarea
                  rows={2}
                  placeholder="Tulis isi pengumuman untuk pelanggan..."
                  value={newAnnContent}
                  onChange={(e) => setNewAnnContent(e.target.value)}
                  className={goldInput}
                />
              </div>
            </div>

            <div className="space-y-2.5 pt-3">
              {(configs.informasi.announcements || []).map((ann) => (
                <div
                  key={ann.id}
                  className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 flex items-start justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-amber-400">{ann.titleId}</span>
                      <span className="text-[10px] font-mono text-zinc-500">{ann.date}</span>
                    </div>
                    <p className="text-zinc-300 mt-1">{ann.contentId}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = configs.informasi.announcements.filter((x) => x.id !== ann.id);
                      saveSlugConfig('informasi', { announcements: next });
                    }}
                    className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SLUG 12: FAQ & CHAT ADMIN (/dashboard/pengaturan-pwa/faq | chat-admin) */}
      {/* ================================================================= */}
      {(activeSlug === 'faq' || activeSlug === 'chat-admin') && (
        <div className="space-y-6">
          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              <span>Konfigurasi Chat Langsung WhatsApp Admin (/client-pwa/profile/chat-admin)</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Nomor WhatsApp CS Toko</label>
                <input
                  type="text"
                  value={configs['chat-admin'].whatsappCsNumber}
                  onChange={(e) =>
                    saveSlugConfig('chat-admin', { whatsappCsNumber: e.target.value })
                  }
                  className={`${goldInput} font-mono font-bold text-emerald-400`}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Jam Layanan CS Admin</label>
                <input
                  type="text"
                  value={configs['chat-admin'].csOperatingHours}
                  onChange={(e) =>
                    saveSlugConfig('chat-admin', { csOperatingHours: e.target.value })
                  }
                  className={goldInput}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-zinc-400 font-semibold mb-1">Template Pesan Otomatis Saat Klik Chat Admin</label>
                <input
                  type="text"
                  value={configs['chat-admin'].autoGreetingTemplateId}
                  onChange={(e) =>
                    saveSlugConfig('chat-admin', { autoGreetingTemplateId: e.target.value })
                  }
                  className={goldInput}
                />
              </div>
            </div>
          </div>

          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
              <HelpCircle className="w-4 h-4" />
              <span>Kelola Daftar Tanya-Jawab Interaktif (/client-pwa/profile/faq)</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Pertanyaan</label>
                <input
                  type="text"
                  placeholder="Misal: Berapa lama pengiriman kurir?"
                  value={newFaqQuestion}
                  onChange={(e) => setNewFaqQuestion(e.target.value)}
                  className={goldInput}
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Kategori</label>
                <input
                  type="text"
                  value={newFaqCategory}
                  onChange={(e) => setNewFaqCategory(e.target.value)}
                  className={goldInput}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    if (!newFaqQuestion.trim() || !newFaqAnswer.trim()) return;
                    const faq: PwaFaqItem = {
                      id: `FAQ-${Date.now().toString().slice(-4)}`,
                      questionId: newFaqQuestion.trim(),
                      questionEn: newFaqQuestion.trim(),
                      answerId: newFaqAnswer.trim(),
                      answerEn: newFaqAnswer.trim(),
                      category: newFaqCategory.trim() || 'Umum',
                    };
                    saveSlugConfig('faq', {
                      items: [...(configs.faq.items || []), faq],
                    });
                    setNewFaqQuestion('');
                    setNewFaqAnswer('');
                    triggerToast('Item FAQ baru berhasil ditambahkan!');
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ Tambah Tanya Jawab</span>
                </button>
              </div>
              <div className="md:col-span-3">
                <label className="block text-zinc-400 font-semibold mb-1">Jawaban Lengkap</label>
                <textarea
                  rows={2}
                  placeholder="Tulis jawaban penjelasan..."
                  value={newFaqAnswer}
                  onChange={(e) => setNewFaqAnswer(e.target.value)}
                  className={goldInput}
                />
              </div>
            </div>

            <div className="space-y-2.5 pt-3">
              {(configs.faq.items || []).map((f) => (
                <div
                  key={f.id}
                  className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 flex items-start justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-bold text-amber-300">{f.questionId}</div>
                    <p className="text-zinc-300 mt-1">{f.answerId}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = configs.faq.items.filter((x) => x.id !== f.id);
                      saveSlugConfig('faq', { items: next });
                    }}
                    className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SLUG 13: STATISTIK, ALAMAT, PENGATURAN, HAK-AKSES                 */}
      {/* ================================================================= */}
      {(activeSlug === 'statistik' ||
        activeSlug === 'alamat' ||
        activeSlug === 'pengaturan' ||
        activeSlug === 'hak-akses') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              <span>Pengaturan Statistik &amp; Alamat GPS (/profile/statistik &amp; /alamat)</span>
            </h3>
            <div className="space-y-2.5 text-xs">
              <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                <span className="font-bold text-white">Tampilkan Area Chart Tren Belanja Pelanggan</span>
                <input
                  type="checkbox"
                  checked={configs.statistik.showAreaChart}
                  onChange={(e) =>
                    saveSlugConfig('statistik', { showAreaChart: e.target.checked })
                  }
                  className="w-4 h-4 accent-amber-500"
                />
              </label>
              <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                <span className="font-bold text-white">Tampilkan Doughnut Chart Kategori Minuman</span>
                <input
                  type="checkbox"
                  checked={configs.statistik.showCategoryDoughnut}
                  onChange={(e) =>
                    saveSlugConfig('statistik', { showCategoryDoughnut: e.target.checked })
                  }
                  className="w-4 h-4 accent-amber-500"
                />
              </label>
              <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                <span className="font-bold text-white">Tampilkan Kartu Info Sisa Hutang / Kasbon Aktif</span>
                <input
                  type="checkbox"
                  checked={configs.statistik.showActiveDebtCard}
                  onChange={(e) =>
                    saveSlugConfig('statistik', { showActiveDebtCard: e.target.checked })
                  }
                  className="w-4 h-4 accent-amber-500"
                />
              </label>
              <div className="pt-2">
                <label className="block text-zinc-400 font-semibold mb-1">Radius Maksimal Pengantaran Kurir (KM)</label>
                <input
                  type="number"
                  min={1}
                  value={configs.alamat.maxDeliveryRadiusKm}
                  onChange={(e) =>
                    saveSlugConfig('alamat', { maxDeliveryRadiusKm: Number(e.target.value) })
                  }
                  className={`${goldInput} font-mono font-bold`}
                />
              </div>
            </div>
          </div>

          <div className={goldCard}>
            <h3 className="text-sm font-bold text-amber-400 border-b border-zinc-800 pb-2.5 flex items-center gap-2">
              <Lock className="w-4 h-4" />
              <span>Hak Akses Katalog &amp; Pengaturan Akun (/profile/pengaturan)</span>
            </h3>
            <div className="space-y-2.5 text-xs">
              <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                <span className="font-bold text-white">Izinkan Pelanggan Mengubah PIN / Password Login WA</span>
                <input
                  type="checkbox"
                  checked={configs.pengaturan.allowChangePin}
                  onChange={(e) =>
                    saveSlugConfig('pengaturan', { allowChangePin: e.target.checked })
                  }
                  className="w-4 h-4 accent-amber-500"
                />
              </label>
              <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                <span className="font-bold text-white">Izinkan Ganti Bahasa (ID / EN) &amp; Currency (IDR / USD)</span>
                <input
                  type="checkbox"
                  checked={configs.pengaturan.allowCurrencySwitch}
                  onChange={(e) =>
                    saveSlugConfig('pengaturan', {
                      allowCurrencySwitch: e.target.checked,
                      allowLanguageSwitch: e.target.checked,
                    })
                  }
                  className="w-4 h-4 accent-amber-500"
                />
              </label>
              <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                <span className="font-bold text-white">Wajibkan Member Terverifikasi untuk Metode Hutang</span>
                <input
                  type="checkbox"
                  checked={configs['hak-akses'].requireVerifiedMemberForDebt}
                  onChange={(e) =>
                    saveSlugConfig('hak-akses', {
                      requireVerifiedMemberForDebt: e.target.checked,
                    })
                  }
                  className="w-4 h-4 accent-amber-500"
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
