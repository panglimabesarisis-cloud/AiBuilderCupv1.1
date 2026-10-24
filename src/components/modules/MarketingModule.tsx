import React, { useState } from 'react';
import {
  Target,
  Megaphone,
  Ticket,
  Sparkles,
  Smartphone,
  BarChart2,
  Plus,
  CheckCircle,
  TrendingUp,
  X,
  Save,
  Eye,
  Edit2,
  Trash2,
} from 'lucide-react';
import { useFirestoreList } from '../../hooks/useFirestoreList';
import { useAppNavigation } from '../../router';

interface MarketingModuleProps {
  subModule:
    | 'hadiah_target'
    | 'informasi_hadiah'
    | 'voucher_promo'
    | 'setting_poin'
    | 'setting_poin_pwa'
    | 'statistik_marketing';
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

const INITIAL_VOUCHERS: any[] = [];
const INITIAL_POINT_RULES: any[] = [];

export const MarketingModule: React.FC<MarketingModuleProps> = ({
  subModule,
}) => {
  const { route, navigateTab } = useAppNavigation();
  const activeSub = (
    route.activeTab === 'module_marketing' ? route.activeSubModule : subModule
  ) as
    | 'hadiah_target'
    | 'informasi_hadiah'
    | 'voucher_promo'
    | 'setting_poin'
    | 'setting_poin_pwa'
    | 'statistik_marketing';
  const setActiveSub = (
    next:
      | 'hadiah_target'
      | 'informasi_hadiah'
      | 'voucher_promo'
      | 'setting_poin'
      | 'setting_poin_pwa'
      | 'statistik_marketing'
  ) => {
    navigateTab('module_marketing', next);
  };

  // Firestore collections via useFirestoreList
  const {
    data: vouchers,
    addItem: addVoucher,
    updateItem: updateVoucher,
    deleteItem: deleteVoucher,
  } = useFirestoreList('vouchers', INITIAL_VOUCHERS);
  const {
    data: pointRules,
    addItem: addPointRule,
    updateItem: updatePointRule,
    deleteItem: deletePointRule,
  } = useFirestoreList('point_rules', INITIAL_POINT_RULES);
  const {
    data: targets,
    addItem: addTarget,
    updateItem: updateTarget,
    deleteItem: deleteTarget,
  } = useFirestoreList<any>('marketing_targets', []);
  const {
    data: promoBanners,
    addItem: addPromoBanner,
    updateItem: updatePromoBanner,
    deleteItem: deletePromoBanner,
  } = useFirestoreList<any>('promo_banners', []);
  const { data: customersList } = useFirestoreList<any>('stores/store_001/customers', []);

  // Detail modal generic state
  const [detailItem, setDetailItem] = useState<{ title: string; data: Record<string, any> } | null>(null);

  // Target Modal States
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [editingTarget, setEditingTarget] = useState<any | null>(null);
  const [tgtTitle, setTgtTitle] = useState('');
  const [tgtPeriod, setTgtPeriod] = useState('Bulanan • Q4 2026');
  const [tgtReward, setTgtReward] = useState('');
  const [tgtAchievers, setTgtAchievers] = useState(0);

  // Banner Promo Modal States
  const [showBannerModal, setShowBannerModal] = useState(false);
  const [editingBanner, setEditingBanner] = useState<any | null>(null);
  const [bannerTitle, setBannerTitle] = useState('');
  const [bannerMessage, setBannerMessage] = useState('');
  const [bannerPeriod, setBannerPeriod] = useState('Berlaku s/d Akhir Bulan');

  // Voucher Modal States
  const [showAddVoucherModal, setShowAddVoucherModal] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<any | null>(null);
  const [newVouchCode, setNewVouchCode] = useState('');
  const [newVouchType, setNewVouchType] = useState('Nominal Potongan');
  const [newVouchVal, setNewVouchVal] = useState(10000);
  const [newVouchMinSpend, setNewVouchMinSpend] = useState(50000);
  const [newVouchMaxUsage, setNewVouchMaxUsage] = useState(100);
  const [newVouchValidUntil, setNewVouchValidUntil] = useState('31 Des 2026');

  // Point Rules States
  const [showSavePointRuleModal, setShowSavePointRuleModal] = useState(false);
  const [pointRuleNotes, setPointRuleNotes] = useState('Pembaruan aturan poin loyalty kasir');
  const [pointRuleSuccess, setPointRuleSuccess] = useState(false);
  const [pointRatio, setPointRatio] = useState(10000);
  const [pointValueRupiah, setPointValueRupiah] = useState(50);

  // PWA Point Rules States
  const [pwaWelcomePoints, setPwaWelcomePoints] = useState(100);
  const [pwaMultiplier, setPwaMultiplier] = useState(2);
  const [pwaRuleSavedMsg, setPwaRuleSavedMsg] = useState(false);

  // Target Handlers
  const openAddTarget = () => {
    setEditingTarget(null);
    setTgtTitle('');
    setTgtPeriod('Bulanan • Q4 2026');
    setTgtReward('');
    setTgtAchievers(0);
    setShowTargetModal(true);
  };

  const openEditTarget = (tgt: any) => {
    setEditingTarget(tgt);
    setTgtTitle(tgt.title || '');
    setTgtPeriod(tgt.period || '');
    setTgtReward(tgt.reward || '');
    setTgtAchievers(Number(tgt.currentAchievers || 0));
    setShowTargetModal(true);
  };

  const handleSaveTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tgtTitle.trim()) return;
    if (editingTarget?.id) {
      await updateTarget(editingTarget.id, {
        title: tgtTitle.trim(),
        period: tgtPeriod.trim(),
        reward: tgtReward.trim(),
        currentAchievers: Number(tgtAchievers),
      });
    } else {
      await addTarget({
        title: tgtTitle.trim(),
        period: tgtPeriod.trim(),
        reward: tgtReward.trim(),
        currentAchievers: Number(tgtAchievers),
      });
    }
    setShowTargetModal(false);
    setEditingTarget(null);
  };

  // Banner Handlers
  const openAddBanner = () => {
    setEditingBanner(null);
    setBannerTitle('');
    setBannerMessage('');
    setBannerPeriod('Berlaku s/d Akhir Bulan');
    setShowBannerModal(true);
  };

  const openEditBanner = (b: any) => {
    setEditingBanner(b);
    setBannerTitle(b.title || '');
    setBannerMessage(b.message || '');
    setBannerPeriod(b.period || '');
    setShowBannerModal(true);
  };

  const handleSaveBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bannerTitle.trim() || !bannerMessage.trim()) return;
    if (editingBanner?.id) {
      await updatePromoBanner(editingBanner.id, {
        title: bannerTitle.trim(),
        message: bannerMessage.trim(),
        period: bannerPeriod.trim(),
        status: 'Aktif',
      });
    } else {
      await addPromoBanner({
        title: bannerTitle.trim(),
        message: bannerMessage.trim(),
        period: bannerPeriod.trim(),
        status: 'Aktif',
      });
    }
    setShowBannerModal(false);
    setEditingBanner(null);
  };

  // Voucher Handlers
  const openCreateVoucher = () => {
    setEditingVoucher(null);
    setNewVouchCode('');
    setNewVouchType('Nominal Potongan');
    setNewVouchVal(10000);
    setNewVouchMinSpend(50000);
    setNewVouchMaxUsage(100);
    setNewVouchValidUntil('31 Des 2026');
    setShowAddVoucherModal(true);
  };

  const openEditVoucher = (v: any) => {
    setEditingVoucher(v);
    setNewVouchCode(v.code || '');
    setNewVouchType(v.discountType || 'Nominal Potongan');
    setNewVouchVal(Number(v.discountValue || 0));
    setNewVouchMinSpend(Number(v.minSpend || 0));
    setNewVouchMaxUsage(Number(v.maxUsage || 100));
    setNewVouchValidUntil(v.validUntil || '');
    setShowAddVoucherModal(true);
  };

  const handleSaveVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVouchCode.trim()) return;
    if (editingVoucher?.id) {
      await updateVoucher(editingVoucher.id, {
        code: newVouchCode.trim().toUpperCase(),
        discountType: newVouchType,
        discountValue: Number(newVouchVal),
        minSpend: Number(newVouchMinSpend),
        maxUsage: Number(newVouchMaxUsage),
        validUntil: newVouchValidUntil,
      });
    } else {
      await addVoucher({
        code: newVouchCode.trim().toUpperCase(),
        discountType: newVouchType,
        discountValue: Number(newVouchVal),
        minSpend: Number(newVouchMinSpend),
        usageCount: 0,
        maxUsage: Number(newVouchMaxUsage),
        validUntil: newVouchValidUntil,
        status: 'active',
      });
    }
    setNewVouchCode('');
    setEditingVoucher(null);
    setShowAddVoucherModal(false);
  };

  const handleConfirmSavePointRule = async (e: React.FormEvent) => {
    e.preventDefault();
    await addPointRule({
      name: 'Aturan Poin POS Kasir',
      type: 'POS',
      pointRatio: Number(pointRatio),
      pointValueRupiah: Number(pointValueRupiah),
      notes: pointRuleNotes,
      updatedAtText: new Date().toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
    });
    setPointRuleSuccess(true);
    setTimeout(() => {
      setShowSavePointRuleModal(false);
      setPointRuleSuccess(false);
    }, 1500);
  };

  const handleSavePwaPointRule = async (e: React.FormEvent) => {
    e.preventDefault();
    await addPointRule({
      name: 'Bonus Poin Client PWA',
      type: 'PWA',
      pwaWelcomePoints: Number(pwaWelcomePoints),
      pwaMultiplier: Number(pwaMultiplier),
      notes: `Welcome +${pwaWelcomePoints} Poin, Multiplier ${pwaMultiplier}x`,
      updatedAtText: new Date().toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
    });
    setPwaRuleSavedMsg(true);
    setTimeout(() => setPwaRuleSavedMsg(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Target className="w-6 h-6 text-indigo-400" />
          <h1 className="text-2xl font-black text-white tracking-tight">
            TEKNIK MARKETING &amp; PROMOSI
          </h1>
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          Program retensi pelanggan, hadiah target penjualan, kupon voucher promo, pengaturan loyalty poin POS &amp; PWA.
        </p>
      </div>

      {/* Sub-Tabs */}
      <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto w-fit max-w-full mb-4">
        <button
          onClick={() => setActiveSub('hadiah_target')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'hadiah_target' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Target className="w-3.5 h-3.5" />
          <span>Hadiah Target</span>
        </button>
        <button
          onClick={() => setActiveSub('informasi_hadiah')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'informasi_hadiah' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Megaphone className="w-3.5 h-3.5" />
          <span>Informasi &amp; Hadiah</span>
        </button>
        <button
          onClick={() => setActiveSub('voucher_promo')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'voucher_promo' ? 'bg-purple-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Ticket className="w-3.5 h-3.5" />
          <span>Voucher dan Promo</span>
        </button>
        <button
          onClick={() => setActiveSub('setting_poin')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'setting_poin' ? 'bg-amber-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Setting Poin</span>
        </button>
        <button
          onClick={() => setActiveSub('setting_poin_pwa')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'setting_poin_pwa' ? 'bg-emerald-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>Setting Poin PWA</span>
        </button>
        <button
          onClick={() => setActiveSub('statistik_marketing')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'statistik_marketing' ? 'bg-rose-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <BarChart2 className="w-3.5 h-3.5" />
          <span>Statistik Marketing</span>
        </button>
      </div>

      {/* VIEW: HADIAH TARGET */}
      {activeSub === 'hadiah_target' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Program Target Belanja &amp; Reward Pelanggan
            </h3>
            <button
              onClick={openAddTarget}
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Tambah Target Baru</span>
            </button>
          </div>

          {targets.length === 0 ? (
            <div className="p-8 bg-zinc-900 border border-dashed border-zinc-800 rounded-2xl text-center text-xs text-zinc-500">
              Belum ada program hadiah target. Klik &quot;+ Tambah Target Baru&quot; untuk menambahkan target belanja pelanggan.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {targets.map((tgt) => (
                <div key={tgt.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-indigo-400 bg-indigo-950/80 border border-indigo-800 px-2 py-0.5 rounded">
                      {tgt.period}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono font-bold text-emerald-400 mr-2">
                        {tgt.currentAchievers || 0} Mencapai
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setDetailItem({
                            title: 'Detail Program Hadiah Target',
                            data: {
                              'Nama Program': tgt.title,
                              Periode: tgt.period,
                              'Reward Hadiah': tgt.reward,
                              'Jumlah Pencapai': `${tgt.currentAchievers || 0} Pelanggan/Toko`,
                            },
                          })
                        }
                        title="Lihat Detail"
                        className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditTarget(tgt)}
                        title="Edit Target"
                        className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (tgt.id) await deleteTarget(tgt.id);
                        }}
                        title="Hapus Target"
                        className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <h3 className="font-bold text-white text-base">{tgt.title}</h3>
                  <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800/80 text-xs text-amber-300 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 shrink-0" />
                    <span>Hadiah: {tgt.reward}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW: INFORMASI & HADIAH */}
      {activeSub === 'informasi_hadiah' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
            <div>
              <h3 className="font-bold text-white text-base">Banner Informasi Promo di Client PWA</h3>
              <p className="text-xs text-zinc-400">Pemberitahuan pop-up &amp; pengumuman hadiah yang tampil di aplikasi pelanggan Client PWA.</p>
            </div>
            <button
              onClick={openAddBanner}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>+ Buat Banner Informasi</span>
            </button>
          </div>

          {promoBanners.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-zinc-800 rounded-xl text-xs text-zinc-500">
              Belum ada banner promosi aktif. Klik &quot;+ Buat Banner Informasi&quot; untuk menampilkan pengumuman di Client PWA.
            </div>
          ) : (
            <div className="space-y-3">
              {promoBanners.map((b) => (
                <div
                  key={b.id}
                  className="p-4 bg-blue-950/20 border border-blue-900/40 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-blue-300 text-sm">{b.title}</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-bold">
                        {b.period || 'Aktif'}
                      </span>
                    </div>
                    <p className="text-white font-medium">&quot;{b.message}&quot;</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setDetailItem({
                          title: 'Detail Banner Promo PWA',
                          data: {
                            Judul: b.title,
                            Pesan: b.message,
                            Periode: b.period || 'Aktif',
                            Status: b.status || 'Aktif',
                          },
                        })
                      }
                      title="Lihat Detail"
                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditBanner(b)}
                      title="Edit Banner"
                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (b.id) await deletePromoBanner(b.id);
                      }}
                      title="Hapus Banner"
                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW: VOUCHER DAN PROMO */}
      {activeSub === 'voucher_promo' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Kupon Kode Promo Aktif
            </h3>
            <button
              onClick={openCreateVoucher}
              className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Buat Kupon Baru</span>
            </button>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Kode Kupon</th>
                  <th className="py-3 px-4">Tipe Potongan</th>
                  <th className="py-3 px-4">Nilai Diskon</th>
                  <th className="py-3 px-4">Min. Belanja</th>
                  <th className="py-3 px-4 text-center">Penggunaan</th>
                  <th className="py-3 px-4">Berlaku Sampai</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {vouchers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-zinc-500">
                      Belum ada kupon promo terdaftar. Klik &quot;Buat Kupon Baru&quot; untuk menambahkan voucher.
                    </td>
                  </tr>
                ) : (
                  vouchers.map((v) => (
                    <tr key={v.id} className="hover:bg-zinc-800/40">
                      <td className="py-3 px-4 font-mono font-black text-purple-400 text-sm">{v.code}</td>
                      <td className="py-3 px-4 font-medium text-white">{v.discountType}</td>
                      <td className="py-3 px-4 font-mono font-bold text-emerald-400">
                        {(v.discountType || '').includes('Persen')
                          ? `${v.discountValue}%`
                          : `Rp ${Number(v.discountValue || 0).toLocaleString('id-ID')}`}
                      </td>
                      <td className="py-3 px-4 font-mono text-zinc-300">
                        Rp {Number(v.minSpend || 0).toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-4 text-center font-mono">
                        {v.usageCount || 0} / {v.maxUsage || 100}
                      </td>
                      <td className="py-3 px-4 text-zinc-400">{v.validUntil}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setDetailItem({
                                title: `Detail Voucher ${v.code}`,
                                data: {
                                  'Kode Voucher': v.code,
                                  'Tipe Potongan': v.discountType,
                                  'Nilai Diskon': (v.discountType || '').includes('Persen')
                                    ? `${v.discountValue}%`
                                    : `Rp ${Number(v.discountValue || 0).toLocaleString('id-ID')}`,
                                  'Minimum Belanja': `Rp ${Number(v.minSpend || 0).toLocaleString('id-ID')}`,
                                  'Kuota Pemakaian': `${v.usageCount || 0} dari ${v.maxUsage || 100}`,
                                  'Berlaku Sampai': v.validUntil,
                                },
                              })
                            }
                            title="Lihat Detail"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditVoucher(v)}
                            title="Edit Kupon"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (v.id) await deleteVoucher(v.id);
                            }}
                            title="Hapus Kupon"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW: SETTING POIN */}
      {activeSub === 'setting_poin' && (
        <div className="space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4 max-w-xl">
            <h3 className="font-bold text-white text-base">Aturan Perhitungan Poin Kasir POS</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Setiap Belanja Kelipatan (Rp):</label>
                <input
                  type="number"
                  value={pointRatio}
                  onChange={(e) => setPointRatio(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold"
                />
                <span className="text-[10px] text-zinc-500">Mendapatkan 1 Poin loyalitas di struk POS.</span>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Nilai Tukar 1 Poin (Rp Rupiah):</label>
                <input
                  type="number"
                  value={pointValueRupiah}
                  onChange={(e) => setPointValueRupiah(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold"
                />
              </div>
              <button
                onClick={() => setShowSavePointRuleModal(true)}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold transition cursor-pointer"
              >
                Simpan Konfigurasi Poin
              </button>
            </div>
          </div>

          {pointRules.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="p-4 border-b border-zinc-800">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Riwayat Kebijakan Poin Tersimpan</h4>
              </div>
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4">Nama Kebijakan</th>
                    <th className="py-3 px-4">Detail Aturan</th>
                    <th className="py-3 px-4">Tanggal Update</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {pointRules.map((pr: any) => (
                    <tr key={pr.id} className="hover:bg-zinc-800/40">
                      <td className="py-3 px-4 font-bold text-white">{pr.name || 'Aturan Poin'}</td>
                      <td className="py-3 px-4 text-zinc-300">{pr.notes || `Rp ${pr.pointRatio} = 1 Poin`}</td>
                      <td className="py-3 px-4 text-zinc-400">{pr.updatedAtText || '-'}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setDetailItem({
                                title: pr.name || 'Detail Aturan Poin',
                                data: {
                                  Nama: pr.name,
                                  Catatan: pr.notes,
                                  'Tanggal Update': pr.updatedAtText || '-',
                                },
                              })
                            }
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (pr.id) await deletePointRule(pr.id);
                            }}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VIEW: SETTING POIN PWA */}
      {activeSub === 'setting_poin_pwa' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4 max-w-xl">
          <h3 className="font-bold text-white text-base">Bonus Poin Khusus Client PWA</h3>
          <p className="text-xs text-zinc-400">Tingkatkan adopsi aplikasi web PWA dengan reward berlipat bagi pelanggan mandiri.</p>
          <form onSubmit={handleSavePwaPointRule} className="space-y-4 text-xs">
            <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 space-y-2">
              <label className="font-bold text-white block">
                Poin Sambutan (Install &amp; Login PWA Pertama Kali)
              </label>
              <input
                type="number"
                min={0}
                value={pwaWelcomePoints}
                onChange={(e) => setPwaWelcomePoints(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-emerald-400 font-mono font-bold"
              />
              <span className="text-[11px] text-zinc-500 block">
                Bonus poin otomatis saat pelanggan verifikasi nomor handphone di PWA.
              </span>
            </div>

            <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 space-y-2">
              <label className="font-bold text-white block">
                Pengganda Poin PWA (Multiplier Order Mandiri)
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={pwaMultiplier}
                onChange={(e) => setPwaMultiplier(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-purple-400 font-mono font-bold"
              />
              <span className="text-[11px] text-zinc-500 block">
                Kelipatan poin bagi pelanggan yang memesan mandiri lewat Client PWA.
              </span>
            </div>

            {pwaRuleSavedMsg && (
              <div className="p-3 bg-emerald-950 border border-emerald-800 text-emerald-300 rounded-xl font-bold flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span>Pengaturan Bonus Poin PWA berhasil disimpan ke Firestore!</span>
              </div>
            )}

            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition cursor-pointer"
            >
              Simpan Bonus Poin PWA
            </button>
          </form>
        </div>
      )}

      {/* VIEW: STATISTIK MARKETING */}
      {activeSub === 'statistik_marketing' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl">
            <span className="text-zinc-500 block text-[10px] font-bold uppercase">Total Penggunaan Kupon Promo</span>
            <span className="text-2xl font-mono font-black text-purple-400 mt-1 block">
              {vouchers.reduce((acc, v) => acc + Number(v.usageCount || 0), 0)} Klaim
            </span>
            <span className="text-emerald-400 text-[11px] font-bold flex items-center gap-1 mt-1">
              <TrendingUp className="w-3 h-3" />
              {vouchers.length} Kupon Aktif Terdaftar
            </span>
          </div>

          <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl">
            <span className="text-zinc-500 block text-[10px] font-bold uppercase">Total Poin Pelanggan Aktif</span>
            <span className="text-2xl font-mono font-black text-amber-400 mt-1 block">
              {customersList.reduce((acc, c) => acc + Number(c.points || 0), 0).toLocaleString('id-ID')} Poin
            </span>
            <span className="text-zinc-400 text-[11px] mt-1 block">Akumulasi poin seluruh member</span>
          </div>

          <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl">
            <span className="text-zinc-500 block text-[10px] font-bold uppercase">Total Pelanggan Terdaftar</span>
            <span className="text-2xl font-mono font-black text-white mt-1 block">
              {customersList.length} Member
            </span>
            <span className="text-zinc-400 text-[11px] mt-1 block">Data real-time dari direktori pelanggan</span>
          </div>
        </div>
      )}

      {/* Modal: Detail Item */}
      {detailItem && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-white">{detailItem.title}</h3>
              <button
                onClick={() => setDetailItem(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2.5 text-xs">
              {Object.entries(detailItem.data).map(([k, val]) => (
                <div key={k} className="flex justify-between py-1.5 border-b border-zinc-800/60 gap-4">
                  <span className="text-zinc-400">{k}:</span>
                  <span className="font-bold text-white text-right">{String(val ?? '-')}</span>
                </div>
              ))}
            </div>
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setDetailItem(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Tambah / Edit Target */}
      {showTargetModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-white">
                {editingTarget ? 'Edit Program Target' : 'Tambah Target Belanja Baru'}
              </h3>
              <button
                onClick={() => setShowTargetModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveTarget} className="space-y-4 pt-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Judul Target Belanja *</label>
                <input
                  type="text"
                  required
                  placeholder="Misal: Belanja Grosir 50 Karton / Bulan"
                  value={tgtTitle}
                  onChange={(e) => setTgtTitle(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Periode Program *</label>
                <input
                  type="text"
                  required
                  placeholder="Misal: Kuartal IV 2026"
                  value={tgtPeriod}
                  onChange={(e) => setTgtPeriod(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Hadiah / Reward *</label>
                <input
                  type="text"
                  required
                  placeholder="Misal: Emas Antam 1 Gram / Voucher Rp 500.000"
                  value={tgtReward}
                  onChange={(e) => setTgtReward(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Jumlah Pelanggan Mencapai Saat Ini</label>
                <input
                  type="number"
                  min={0}
                  value={tgtAchievers}
                  onChange={(e) => setTgtAchievers(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowTargetModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold cursor-pointer"
                >
                  Simpan Target
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Tambah / Edit Banner Informasi */}
      {showBannerModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-white">
                {editingBanner ? 'Edit Banner Informasi PWA' : 'Buat Banner Informasi PWA'}
              </h3>
              <button
                onClick={() => setShowBannerModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveBanner} className="space-y-4 pt-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Judul Kampanye / Promo *</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Gebyar Grosir Akhir Pekan"
                  value={bannerTitle}
                  onChange={(e) => setBannerTitle(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Isi Pesan Banner di Client PWA *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Diskon Grosir Dus Indomie & Le Minerale! Belanja minimal 3 karton gratis ongkir."
                  value={bannerMessage}
                  onChange={(e) => setBannerMessage(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Keterangan Periode</label>
                <input
                  type="text"
                  value={bannerPeriod}
                  onChange={(e) => setBannerPeriod(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowBannerModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold cursor-pointer"
                >
                  Simpan Banner
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Buat / Edit Kupon Baru */}
      {showAddVoucherModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Ticket className="w-5 h-5 text-purple-400" />
                <h3 className="text-base font-bold text-white">
                  {editingVoucher ? 'Edit Kupon Promo' : 'Buat Kupon Promo Baru'}
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowAddVoucherModal(false);
                  setEditingVoucher(null);
                }}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveVoucher} className="space-y-4 pt-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Kode Kupon / Promo *</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: BERKAH10 / JUMATHEMAT"
                  value={newVouchCode}
                  onChange={(e) => setNewVouchCode(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono uppercase tracking-wider font-bold focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Tipe Potongan</label>
                  <select
                    value={newVouchType}
                    onChange={(e) => setNewVouchType(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="Nominal Potongan">Nominal Potongan (Rp)</option>
                    <option value="Persentase Diskon">Persentase Diskon (%)</option>
                    <option value="Gratis Ongkir Dus">Gratis Ongkir Dus</option>
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Nilai Potongan</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={newVouchVal}
                    onChange={(e) => setNewVouchVal(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Min. Belanja (Rp)</label>
                  <input
                    type="number"
                    required
                    min={0}
                    step={5000}
                    value={newVouchMinSpend}
                    onChange={(e) => setNewVouchMinSpend(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Batas Kuota Pemakaian</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={newVouchMaxUsage}
                    onChange={(e) => setNewVouchMaxUsage(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Berlaku Sampai Tanggal</label>
                <input
                  type="text"
                  placeholder="31 Des 2026"
                  value={newVouchValidUntil}
                  onChange={(e) => setNewVouchValidUntil(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddVoucherModal(false);
                    setEditingVoucher(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold transition shadow-lg cursor-pointer"
                >
                  {editingVoucher ? 'Simpan Perubahan' : 'Terbitkan Kupon'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Simpan Aturan Poin */}
      {showSavePointRuleModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Save className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Simpan Aturan Poin Loyalitas</h3>
              </div>
              <button
                onClick={() => setShowSavePointRuleModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleConfirmSavePointRule} className="space-y-4 pt-4 text-xs">
              <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400">Rasio Belanja per Poin:</span>
                  <span className="font-mono font-bold text-white">Rp {pointRatio.toLocaleString('id-ID')} = 1 Poin</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400">Nilai Tukar 1 Poin:</span>
                  <span className="font-mono font-bold text-emerald-400">Rp {pointValueRupiah.toLocaleString('id-ID')}</span>
                </div>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Catatan Pembaruan Kebijakan Toko</label>
                <input
                  type="text"
                  required
                  value={pointRuleNotes}
                  onChange={(e) => setPointRuleNotes(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              {pointRuleSuccess && (
                <div className="p-3 bg-emerald-950 border border-emerald-800 text-emerald-300 rounded-xl text-xs font-bold flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span>Aturan poin loyalitas berhasil disimpan dan disinkronkan ke Cloud Firestore!</span>
                </div>
              )}

              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowSavePointRuleModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold transition shadow-lg cursor-pointer"
                >
                  Simpan ke Firestore
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
