import React, { useState, useRef } from 'react';
import {
  GripVertical,
  ChevronDown,
  Eye,
  EyeOff,
  Edit2,
  Check,
  RotateCcw,
  Search,
  Sparkles,
  Layers,
  ArrowUp,
  ArrowDown,
  ShieldCheck,
  Save,
  CheckCircle,
  FolderTree,
  Monitor,
  ExternalLink,
  Upload,
  Image as ImageIcon,
  Cpu,
  Database,
  Code2,
  PlusCircle,
  Trash2,
  Play,
  X,
  RefreshCw,
  GitMerge,
  Zap,
} from 'lucide-react';
import { useSidebarMenu } from '../../hooks/useSidebarMenu';
import { useLanguage } from '../../context/LanguageContext';
import { apiFetch } from '../../services/firebaseSession';
import { useAppData } from '../../context/AppDataContext';
import { useAppNavigation } from '../../router';
import {
  MenuItemConfig,
  MenuGroupConfig,
  AICustomPageSchema,
} from '../../services/sidebarMenuService';
import { GOOGLE_GEMINI_MODELS } from '../../services/aiInstructionStore';
import { DynamicCustomPage } from '../custom/DynamicCustomPage';
import { AiRunControlBar, useAiFeatureControl } from '../common/AiRunControlBar';

const AI_STUDIO_MODEL_OPTIONS = [
  {
    id: 'gemini-2.5-pro',
    label:
      'gemini-2.5-pro — Google Gemini 2.5 Pro (Rekomendasi Utama untuk Membaca Gambar Kompleks & Merancang Logika/Rumus Baru)',
    shortBadge: 'Gemini 2.5 Pro • Vision & Logic Architect',
  },
  {
    id: 'gemini-2.5-flash',
    label:
      'gemini-2.5-flash — Google Gemini 2.5 Flash (Cepat & Responsif untuk Pembuatan Halaman Standar)',
    shortBadge: 'Gemini 2.5 Flash • Fast Builder',
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'gemini-2.5-flash-lite — Google Gemini 2.5 Flash-Lite (Ringan & Hemat Token)',
    shortBadge: 'Gemini 2.5 Flash-Lite • Token Efficient',
  },
  {
    id: 'gemini-2.0-flash',
    label: 'gemini-2.0-flash — Google Gemini 2.0 Flash (Multimodal Stabil)',
    shortBadge: 'Gemini 2.0 Flash • Multimodal Stable',
  },
];

const AI_BUILDER_PRESETS = [
  {
    label: 'Manajemen Pajak (DPP, PPN 11% & PPh UMKM 0.5%)',
    group: 'keuangan',
    prompt:
      'Buat halaman Manajemen & Pelaporan Pajak Toko (collection ext_pajak) yang menghitung Dasar Pengenaan Pajak (DPP) otomatis dari omzet transaksi POS & pesanan PWA, PPN = Omzet * 11%, dan PPh Final UMKM = Omzet * 0.5%. Sediakan tombol + Tambah Data (form SPT/Faktur) serta tombol Bayar Pajak yang otomatis mencatat pengeluaran ke Laporan Kas (/dashboard/laporankas) dan Keuangan.',
  },
  {
    label: 'Evaluasi KPI, Target & Bonus Kasir/Staf',
    group: 'staff',
    prompt:
      'Buat halaman Evaluasi KPI & Insentif Kasir/Staf (collection ext_kpi_target) yang menggabungkan data shifts, transactions, dan staff. Hitung otomatis % Pencapaian = (Realisasi Transaksi Kasir / Target) * 100, skor produktivitas, dan status badge Tercapai / Belum Tercapai. Sediakan form + Tambah Data Target KPI dan tombol Cairkan Bonus KPI yang langsung tercatat ke Laporan Kas (/dashboard/laporankas).',
  },
  {
    label: 'Analisis Margin, Berat Produk (Kg) & Restock Gudang',
    group: 'inventory',
    prompt:
      'Buat halaman Monitoring Margin, Berat Logistik (Kg), dan Nilai Aset Stok Gudang dari koleksi products dan transactions. Hitung rumus otomatis Total Berat Kg = (beratMl * isiPerDus) / 1000, Nilai Aset = stok * hargaBeli, dan Potensi Margin = hargaJual - hargaBeli. Beri badge merah Stok Kritis jika stok <= minStok, serta tambahkan form aksi cepat Restock Gudang (Tambah Dus).',
  },
  {
    label: 'Audit Rekonsiliasi Kasir & Selisih Shift',
    group: 'shift',
    prompt:
      'Buat halaman Rekonsiliasi & Audit Kasir Lintas Shift yang menggabungkan data transaksi kasir, kas masuk/keluar operasional, dan riwayat shift. Tampilkan KPI Total Penjualan Tunai, Kas Masuk, Kas Keluar, dan Selisih Kas, grafik perbandingan shift, tabel audit kasir dengan rumus Selisih Kas dan status badge Kurang / Short jika negatif.',
  },
];

export const SidebarMenuBuilder: React.FC = () => {
  const { tr } = useLanguage();
  const { globalAiModel } = useAppData();
  const { navigateToPath } = useAppNavigation();
  const {
    groups,
    structure,
    aiAgents,
    isAiAgentsSectionVisible,
    aiAgentsSectionCustomLabel,
    loading,
    saveStructure,
    resetToDefault,
    toggleGroupVisibility,
    toggleItemVisibility,
    setGroupCustomLabel,
    setItemCustomLabel,
    toggleAiAgentsSectionVisibility,
    setAiAgentsSectionCustomLabel,
    toggleAiAgentVisibility,
    setAiAgentCustomLabel,
    moveAiAgent,
    reorderAiAgents,
    moveAiAgentToGroup,
    moveGroup,
    moveItem,
    moveItemAcrossGroups,
    reorderGroups,
    reorderItems,
    addCustomPage,
    deleteCustomPage,
    customPages,
  } = useSidebarMenu();

  // Active builder mode tab & Gemini Studio Modal state
  const [builderMode, setBuilderMode] = useState<'ai-builder' | 'menu-tree'>('menu-tree');
  const [isAddPageModalOpen, setIsAddPageModalOpen] = useState<boolean>(false);

  // AI Page Builder states
  const [aiPageTitle, setAiPageTitle] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [selectedParentGroup, setSelectedParentGroup] = useState('keuangan');
  const [selectedAiModel, setSelectedAiModel] = useState<string>('gemini-2.5-pro');
  const [uploadedImageBase64, setUploadedImageBase64] = useState<string | null>(null);
  const [uploadedImageMime, setUploadedImageMime] = useState<string>('image/png');
  const [uploadedImageName, setUploadedImageName] = useState<string>('');
  const [isGeneratingPage, setIsGeneratingPage] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedSchema, setGeneratedSchema] = useState<AICustomPageSchema | null>(null);
  const [lastTokenUsage, setLastTokenUsage] = useState<{
    tokenIn: number;
    tokenOut: number;
    totalTokens: number;
    modelUsed: string;
  } | null>(null);
  const [isSavingCustomPage, setIsSavingCustomPage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Accordion state for expanded groups in the builder
  const [expandedGroupIds, setExpandedGroupIds] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    groups.forEach((g, idx) => {
      init[g.id] = idx < 2;
    });
    return init;
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupLabelDraft, setGroupLabelDraft] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemGroupId, setEditingItemGroupId] = useState<string | null>(null);
  const [itemLabelDraft, setItemLabelDraft] = useState('');
  const [isAiAgentsListExpanded, setIsAiAgentsListExpanded] = useState<boolean>(true);
  const [editingAiAgentsHeader, setEditingAiAgentsHeader] = useState<boolean>(false);
  const [aiAgentsHeaderDraft, setAiAgentsHeaderDraft] = useState<string>('');
  const [editingAiAgentId, setEditingAiAgentId] = useState<string | null>(null);
  const [aiAgentLabelDraft, setAiAgentLabelDraft] = useState<string>('');
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [showLivePreview, setShowLivePreview] = useState(true);

  // Drag and Drop States with visual drop zone feedback
  const [draggedGroupIndex, setDraggedGroupIndex] = useState<number | null>(null);
  const [dragOverGroupIndex, setDragOverGroupIndex] = useState<number | null>(null);

  const [draggedItemInfo, setDraggedItemInfo] = useState<{
    groupId: string;
    itemIndex: number;
    itemId: string;
    label: string;
    isAiAgent?: boolean;
  } | null>(null);
  const [dragOverItemInfo, setDragOverItemInfo] = useState<{ groupId: string; itemIndex: number } | null>(null);
  const [dragOverGroupForSubmenu, setDragOverGroupForSubmenu] = useState<string | null>(null);

  const toggleExpandGroup = (groupId: string) => {
    setExpandedGroupIds((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    groups.forEach((g) => {
      all[g.id] = true;
    });
    setExpandedGroupIds(all);
    setIsAiAgentsListExpanded(true);
  };

  const collapseAll = () => {
    setExpandedGroupIds({});
    setIsAiAgentsListExpanded(false);
  };

  // Group Label Edit
  const startEditGroup = (g: MenuGroupConfig) => {
    setEditingGroupId(g.id);
    setGroupLabelDraft(g.customLabel || g.labelId);
  };

  const saveEditGroup = (groupId: string) => {
    setGroupCustomLabel(groupId, groupLabelDraft);
    setEditingGroupId(null);
    showToast('✓ Label kelompok menu berhasil diperbarui & disinkronkan ke Sidebar!');
  };

  // Item Label Edit
  const startEditItem = (item: MenuItemConfig, groupId?: string) => {
    setEditingItemId(item.id);
    setEditingItemGroupId(groupId || null);
    setItemLabelDraft(item.customLabel || item.labelId);
  };

  const saveEditItem = (itemId: string, groupId?: string) => {
    setItemCustomLabel(itemId, itemLabelDraft, groupId || editingItemGroupId || undefined);
    setEditingItemId(null);
    setEditingItemGroupId(null);
    showToast('✓ Label sub-menu berhasil diperbarui & disinkronkan ke Sidebar!');
  };

  const showToast = (msg: string) => {
    setSaveToast(msg);
    setTimeout(() => setSaveToast(null), 4000);
  };

  const handleManualSave = async () => {
    if (editingGroupId) {
      setGroupCustomLabel(editingGroupId, groupLabelDraft);
      setEditingGroupId(null);
    }
    if (editingItemId) {
      setItemCustomLabel(editingItemId, itemLabelDraft, editingItemGroupId || undefined);
      setEditingItemId(null);
      setEditingItemGroupId(null);
    }
    if (editingAiAgentsHeader) {
      setAiAgentsSectionCustomLabel(aiAgentsHeaderDraft);
      setEditingAiAgentsHeader(false);
    }
    if (editingAiAgentId) {
      setAiAgentCustomLabel(editingAiAgentId, aiAgentLabelDraft);
      setEditingAiAgentId(null);
    }
    await saveStructure(structure);
    showToast('✓ Struktur Menu & Agen AI berhasil disimpan & disinkronkan ke Sidebar secara real-time!');
  };

  const handleReset = async () => {
    await resetToDefault();
    setConfirmResetOpen(false);
    showToast('✓ Struktur Menu berhasil dikembalikan ke standar default pabrik!');
  };

  // Image upload handler (converts to base64 for Gemini Multimodal inlineData)
  const handleImageUpload = (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setGenerationError('File harus berupa gambar (PNG, JPG, WEBP) untuk dianalisis oleh Vision AI.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64Clean = result.includes(',') ? result.split(',')[1] : result;
      setUploadedImageBase64(base64Clean);
      setUploadedImageMime(file.type || 'image/png');
      setUploadedImageName(file.name);
      setGenerationError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateAiPage = async (signal?: AbortSignal) => {
    if (!aiPrompt.trim() && !uploadedImageBase64) {
      setGenerationError('Masukkan instruksi prompt atau unggah gambar sketsa/wireframe terlebih dahulu.');
      return;
    }
    setIsGeneratingPage(true);
    setGenerationError(null);

    try {
      const derivedTitle =
        aiPageTitle.trim() ||
        aiPrompt
          .trim()
          .replace(/^buat\s+halaman\s+/i, '')
          .split(/[.,\n]/)[0]
          .slice(0, 48) ||
        'Halaman Kustom AI';

      const response = await apiFetch('/api/ai-page-builder/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          pageTitle: derivedTitle,
          prompt: aiPrompt.trim(),
          targetGroupId: selectedParentGroup,
          preferredModel: selectedAiModel || globalAiModel || 'gemini-2.5-flash',
          imageBase64: uploadedImageBase64,
          imageMimeType: uploadedImageMime,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.schema) {
        throw new Error(data.error || 'Gagal menghasilkan schema halaman AI.');
      }

      setGeneratedSchema(data.schema);
      if (data.tokenUsage) {
        setLastTokenUsage({
          ...data.tokenUsage,
          modelUsed: data.modelUsed || selectedAiModel,
        });
      }
      showToast('✓ Analisis 3 Lapis (Visual, Data Mapping & Business Logic) berhasil dirancang oleh Gemini AI!');
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setGenerationError(err?.message || 'Terjadi kesalahan saat menghubungi AI Page Builder.');
    } finally {
      setIsGeneratingPage(false);
    }
  };

  const aiPageBuilderControl = useAiFeatureControl({
    featureKey: 'ai_page_builder',
    onRun: async (signal) => {
      await handleGenerateAiPage(signal);
    },
  });

  const handleSaveAndMountPage = async () => {
    if (!generatedSchema) return;
    setIsSavingCustomPage(true);
    try {
      await addCustomPage(generatedSchema);
      setIsAddPageModalOpen(false);
      showToast(
        `✓ Halaman "${generatedSchema.title}" & Collection "${generatedSchema.customCollectionName || 'ext_' + generatedSchema.slug}" berhasil diterbitkan ke Sidebar & Firestore!`
      );
    } catch (err: any) {
      setGenerationError(err?.message || 'Gagal menyimpan halaman ke Firestore.');
    } finally {
      setIsSavingCustomPage(false);
    }
  };

  // Filter groups / items by search query
  const filteredGroups = groups.filter((g) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const groupName = (g.customLabel || g.labelId).toLowerCase();
    if (groupName.includes(q) || g.letter.toLowerCase().includes(q)) return true;
    if (
      g.id === 'ai' &&
      ('agen ai'.includes(q) ||
        'ai agents'.includes(q) ||
        aiAgents.some(
          (ag) =>
            ag.displayName.toLowerCase().includes(q) ||
            ag.slug.toLowerCase().includes(q) ||
            ag.path.toLowerCase().includes(q)
        ))
    ) {
      return true;
    }
    return g.children.some(
      (c) =>
        (c.customLabel || c.labelId).toLowerCase().includes(q) ||
        c.path.toLowerCase().includes(q)
    );
  });

  const totalGroups = groups.length;
  const activeGroups = groups.filter((g) => g.visible).length;
  const totalAiAgents = aiAgents.length;
  const activeAiAgents = aiAgents.filter((a) => a.visible !== false && !a.movedToGroupId).length;
  const totalSubItems = groups.reduce((acc, g) => acc + g.children.length, 0) + totalAiAgents;
  const activeSubItems =
    groups.reduce((acc, g) => acc + g.children.filter((c) => c.visible).length, 0) +
    activeAiAgents;
  const customPageList = Object.values(customPages || {});

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-zinc-900 via-zinc-850 to-zinc-900 border border-zinc-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2.5 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <Sparkles className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base sm:text-lg font-black text-white flex flex-wrap items-center gap-2">
                <span>AI Page Builder &amp; WordPress Menu Architect</span>
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  MULTIMODAL VISION + 2-WAY SYNC
                </span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Unggah gambar sketsa/wireframe atau ketik prompt untuk merancang halaman baru dengan rumus bisnis otomatis &amp; koneksi dua arah ke koleksi Firestore.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Bar */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setBuilderMode('ai-builder');
              setIsAddPageModalOpen(true);
            }}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white font-black text-xs flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-emerald-600/30"
          >
            <PlusCircle className="w-4 h-4" />
            <span>+ Tambah Halaman (Gemini Studio)</span>
          </button>

          <div className="inline-flex rounded-xl bg-zinc-950 p-1 border border-zinc-800">
            <button
              type="button"
              onClick={() => setBuilderMode('ai-builder')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                builderMode === 'ai-builder'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Page Builder</span>
              {customPageList.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-white/20 text-[10px]">
                  {customPageList.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setBuilderMode('menu-tree')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                builderMode === 'menu-tree'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5" />
              <span>Susunan Menu ({totalGroups})</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowLivePreview(!showLivePreview)}
            className={`px-3 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition cursor-pointer border ${
              showLivePreview
                ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border-zinc-700'
            }`}
            title="Tampilkan panel preview sidebar"
          >
            <Monitor className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Live Preview</span>
          </button>

          <button
            type="button"
            onClick={handleManualSave}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-blue-600/30 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Simpan Struktur Menu</span>
          </button>
        </div>
      </div>

      {/* Toast Feedback */}
      {saveToast && (
        <div className="p-3.5 rounded-xl bg-emerald-950/90 border border-emerald-600 text-emerald-200 text-xs font-bold flex items-center justify-between shadow-xl animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{saveToast}</span>
          </div>
          <button
            onClick={() => setSaveToast(null)}
            className="text-emerald-400 hover:text-white text-xs px-2 py-0.5 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* =====================================================================
          MODE 1: AI PAGE BUILDER (MULTIMODAL VISION + BUSINESS LOGIC ENGINE)
         ===================================================================== */}
      {builderMode === 'ai-builder' && (
        <div className="space-y-6">
          {/* Input Studio Card */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 7 Cols: Multimodal Image + Prompt + Model Config */}
            <div className="lg:col-span-7 p-5 rounded-2xl bg-zinc-900/95 border border-zinc-800 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    Universal AI Page &amp; Database Studio (Gemini Studio)
                  </h3>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                  Auto-Collection + Vision-to-Logic
                </span>
              </div>

              {/* TOP DROPDOWN: Pemilihan Model AI Google (Wajib Ada di Atas) */}
              <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/40 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-indigo-200 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Pilih Model AI Google (@google/genai):</span>
                  </label>
                  <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded border border-emerald-500/30">
                    Auto-Log: ai_token_logs
                  </span>
                </div>
                <select
                  value={selectedAiModel}
                  onChange={(e) => setSelectedAiModel(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-zinc-950 border border-indigo-500/50 text-xs text-white font-bold focus:outline-none focus:border-indigo-400"
                >
                  {AI_STUDIO_MODEL_OPTIONS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Image Upload Dropzone */}
              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                  Unggah Gambar Referensi (Sketsa Tangan, Wireframe, Screenshot Excel / UI) — Opsional:
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImageUpload(f);
                  }}
                  className="hidden"
                />

                {!uploadedImageBase64 ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f) handleImageUpload(f);
                    }}
                    className="border-2 border-dashed border-zinc-700 hover:border-indigo-500 rounded-2xl p-5 text-center cursor-pointer bg-zinc-950/60 hover:bg-indigo-950/15 transition group"
                  >
                    <Upload className="w-7 h-7 text-zinc-500 group-hover:text-indigo-400 mx-auto mb-2 transition" />
                    <p className="text-xs font-bold text-zinc-300">
                      Klik atau Tarik Gambar Sketsa / Tabel Excel / Desain UI ke Sini
                    </p>
                    <p className="text-[11px] text-zinc-500 mt-1">
                      Gemini Vision akan mengekstrak Lapis Visual (KPI, Grafik, Tabel), Lapis Data Firestore, &amp; Lapis Rumus Bisnis secara otomatis.
                    </p>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-zinc-950 border border-indigo-500/40 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={`data:${uploadedImageMime};base64,${uploadedImageBase64}`}
                        alt="Uploaded Design Reference"
                        className="w-16 h-16 object-cover rounded-lg border border-zinc-700 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <ImageIcon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <span className="text-xs font-bold text-white truncate">
                            {uploadedImageName || 'Gambar Referensi UI'}
                          </span>
                        </div>
                        <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                          ✓ Siap Dianalisis Multimodal Vision (inlineData Base64)
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setUploadedImageBase64(null);
                        setUploadedImageName('');
                      }}
                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-600 text-zinc-400 hover:text-white transition cursor-pointer"
                      title="Hapus gambar"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Title + Prompt Input + Presets */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-zinc-300 mb-1">
                    Nama / Judul Halaman Baru (Menu Sidebar):
                  </label>
                  <input
                    type="text"
                    value={aiPageTitle}
                    onChange={(e) => setAiPageTitle(e.target.value)}
                    placeholder="Contoh: Rekonsiliasi Audit Kasir & Selisih Shift"
                    className="w-full rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none font-semibold"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-zinc-300">
                      Instruksi Halaman &amp; Logika Bisnis yang Diinginkan:
                    </label>
                    <span className="text-[10px] text-zinc-500">Contoh Cepat:</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {AI_BUILDER_PRESETS.map((preset, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setAiPageTitle(preset.label);
                          setAiPrompt(preset.prompt);
                          setSelectedParentGroup(preset.group);
                        }}
                        className="text-[10px] px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-indigo-600/20 text-zinc-300 hover:text-indigo-300 border border-zinc-700 hover:border-indigo-500/40 transition cursor-pointer font-semibold"
                      >
                        + {preset.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={4}
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Contoh: Buat halaman Monitoring Margin Produk & Audit Stok Kritis yang menggabungkan data produk, transaksi, dan shift kasir. Hitung rumus Keuntungan = totalNilai - totalModal, Total Berat Kg = (beratMl * isiPerDus) / 1000, tampilkan badge Stok Kritis jika stok <= minStok, serta sediakan tombol Restock Gudang..."
                    className="w-full rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 p-3 text-xs text-white placeholder-zinc-500 focus:outline-none leading-relaxed"
                  />
                </div>
              </div>

              {/* Target Menu Group Selector */}
              <div>
                <label className="block text-[11px] font-bold text-zinc-400 mb-1">
                  Kelompok Menu Induk Target di Sidebar (A–P):
                </label>
                <select
                  value={selectedParentGroup}
                  onChange={(e) => setSelectedParentGroup(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white font-semibold focus:outline-none focus:border-indigo-500"
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.letter}. {g.customLabel || g.labelId}
                    </option>
                  ))}
                </select>
              </div>

              {generationError && (
                <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-700 text-rose-200 text-xs font-semibold">
                  {generationError}
                </div>
              )}

              {/* Generate Action Button */}
              <div className="pt-1 flex flex-wrap items-center justify-between gap-3">
                <div className="text-[11px] text-zinc-400">
                  Token pemakaian AI otomatis dicatat ke <code>ai_token_logs</code>.
                </div>
                <AiRunControlBar
                  featureLabel="AI Page Builder"
                  enabled={aiPageBuilderControl.enabled}
                  isRunning={aiPageBuilderControl.isRunning || isGeneratingPage}
                  onToggle={aiPageBuilderControl.toggleEnabled}
                  onRun={() => void aiPageBuilderControl.runNow()}
                />
              </div>
            </div>

            {/* Right 5 Cols: 3-Layer Extraction Architecture & Active Custom Pages */}
            <div className="lg:col-span-5 space-y-4">
              {/* 3-Layer Blueprint Card */}
              <div className="p-5 rounded-2xl bg-zinc-900/95 border border-zinc-800 shadow-xl space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-black text-white uppercase tracking-wider">
                      Arsitektur 3 Lapis AI Page Builder
                    </h3>
                  </div>
                  {lastTokenUsage && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      {lastTokenUsage.totalTokens} tokens ({lastTokenUsage.modelUsed})
                    </span>
                  )}
                </div>

                {generatedSchema ? (
                  <div className="space-y-2.5 text-xs">
                    <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                      <div className="text-[10px] font-black uppercase text-indigo-400 flex items-center gap-1.5">
                        <Monitor className="w-3.5 h-3.5" />
                        <span>Lapis 1 — Visual &amp; UI Layout</span>
                      </div>
                      <p className="text-zinc-300 text-[11px] leading-relaxed">
                        {generatedSchema.kpiCards?.length || 4} Kartu KPI Real-Time,{' '}
                        {generatedSchema.charts?.length || 2} Grafik Visual, Tabel Pintar ({generatedSchema.table?.columns?.length || 8} kolom), &amp; Form Sinkronisasi 2 Arah.
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                      <div className="text-[10px] font-black uppercase text-emerald-400 flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5" />
                        <span>Lapis 2 — Koneksi Koleksi Firestore &amp; Auto-Join</span>
                      </div>
                      <p className="text-zinc-300 text-[11px] leading-relaxed">
                        Terhubung ke {generatedSchema.connectedCollections?.length || 1} koleksi utama dengan {generatedSchema.joinMappings?.length || 0} relasi lintas data (Auto-Join).
                      </p>
                      <div className="flex flex-wrap gap-1 pt-1">
                        {generatedSchema.connectedCollections.map((col) => (
                          <span
                            key={col}
                            className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                          >
                            firestore::{col}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                      <div className="text-[10px] font-black uppercase text-amber-400 flex items-center gap-1.5">
                        <Code2 className="w-3.5 h-3.5" />
                        <span>Lapis 3 — Business Logic, Rumus &amp; Status Kondisional</span>
                      </div>
                      <p className="text-zinc-300 text-[11px] leading-relaxed">
                        {generatedSchema.formulas?.length || 0} Rumus Otomatis &amp; {generatedSchema.conditionalRules?.length || 0} Aturan Badge Kondisional.
                      </p>
                      {generatedSchema.formulas?.length > 0 && (
                        <div className="pt-1 space-y-1">
                          {generatedSchema.formulas.map((f, idx) => (
                            <div
                              key={idx}
                              className="text-[10px] font-mono px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-amber-300"
                            >
                              ƒ {f.name}: <span className="text-zinc-300">{f.expression}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Save & Mount CTA */}
                    <div className="pt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSaveAndMountPage}
                        disabled={isSavingCustomPage}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/30 cursor-pointer disabled:opacity-50"
                      >
                        <PlusCircle className="w-4 h-4" />
                        <span>
                          {isSavingCustomPage
                            ? 'Menerbitkan ke Firestore...'
                            : 'Simpan & Terbitkan Halaman'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => navigateToPath(`/dashboard/custom/${generatedSchema.slug}`)}
                        className="px-3.5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs flex items-center gap-1.5 border border-zinc-700 cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Buka Rute</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-[11px] text-zinc-400">
                    <p>
                      Saat Anda mengunggah gambar sketsa atau mengetik prompt, AI akan merancang:
                    </p>
                    <ul className="space-y-1.5 pl-1">
                      <li className="flex items-start gap-2">
                        <span className="text-indigo-400 font-bold">1.</span>
                        <span>
                          <strong className="text-zinc-200">Lapis Visual:</strong> Kartu KPI, Grafik Area/Bar/Donut, Tabel pintar, &amp; Tombol Aksi.
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-emerald-400 font-bold">2.</span>
                        <span>
                          <strong className="text-zinc-200">Lapis Data Firestore:</strong> Koneksi real-time ke <code>products</code>, <code>transactions</code>, <code>shifts</code>, <code>cash_logs</code>, <code>customers</code>, dll.
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-amber-400 font-bold">3.</span>
                        <span>
                          <strong className="text-zinc-200">Lapis Business Logic &amp; 2-Way Sync:</strong> Kalkulasi rumus otomatis (Berat Kg, Margin, Selisih Kas), status kondisional, dan penulisan balik ke ekosistem.
                        </span>
                      </li>
                    </ul>
                  </div>
                )}
              </div>

              {/* Active AI Custom Pages Directory */}
              <div className="p-4 rounded-2xl bg-zinc-900/95 border border-zinc-800 shadow-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>Halaman Kustom AI Terpasang ({customPageList.length})</span>
                  </span>
                </div>

                {customPageList.length === 0 ? (
                  <p className="text-[11px] text-zinc-500">
                    Belum ada halaman kustom AI yang dipasang ke Sidebar. Gunakan studio di sebelah kiri untuk membuat halaman baru.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                    {customPageList.map((page) => (
                      <div
                        key={page.slug}
                        className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                            <span>{page.title}</span>
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                              {page.connectedCollections?.length || 1} koleksi
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-zinc-500 truncate">
                            /dashboard/custom/{page.slug}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setGeneratedSchema(page)}
                            className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-bold cursor-pointer"
                            title="Preview & Uji Halaman"
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => navigateToPath(`/dashboard/custom/${page.slug}`)}
                            className="p-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white transition cursor-pointer"
                            title="Buka halaman"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteCustomPage(page.slug);
                              if (generatedSchema?.slug === page.slug) {
                                setGeneratedSchema(null);
                              }
                              showToast(`Halaman "${page.title}" dihapus dari Sidebar.`);
                            }}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-600 text-zinc-400 hover:text-white transition cursor-pointer"
                            title="Hapus halaman kustom"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Live Interactive Workspace Preview of Generated AI Page */}
          {generatedSchema && (
            <div className="rounded-2xl border-2 border-indigo-500/40 bg-zinc-950/90 p-4 sm:p-6 shadow-2xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
                <div className="flex items-center gap-2">
                  <Play className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    Live Interactive Simulation &amp; Two-Way Firestore Workspace
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                    DATA ASLI FIRESTORE
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveAndMountPage}
                    disabled={isSavingCustomPage}
                    className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Simpan &amp; Terbitkan Halaman</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToPath(`/dashboard/custom/${generatedSchema.slug}`)}
                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Buka Halaman Penuh</span>
                  </button>
                </div>
              </div>

              <DynamicCustomPage previewSchema={generatedSchema} />
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          MODAL "+ TAMBAH HALAMAN" (GEMINI STUDIO — UNIVERSAL AI PAGE & DB BUILDER)
         ===================================================================== */}
      {isAddPageModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-zinc-900 border border-indigo-500/50 rounded-3xl max-w-4xl w-full p-5 sm:p-6 shadow-2xl space-y-5 my-8 max-h-[92vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div className="flex items-center gap-3">
                <span className="p-2.5 rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/40">
                  <Sparkles className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
                    <span>Tambah Halaman Baru — Gemini Studio</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
                      AUTO-DATABASE + VISION
                    </span>
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Pilih model AI Google, unggah sketsa/Excel/desain apapun (Pajak, KPI, Audit, Aset, dll.), dan AI otomatis merancang UI, rumus, serta koleksi Firestore-nya.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddPageModalOpen(false)}
                className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 1. DROPDOWN PEMILIHAN MODEL AI GOOGLE (Wajib di Bagian Atas Modal) */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-950/50 via-zinc-950 to-indigo-950/30 border border-indigo-500/40 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black text-indigo-200 flex items-center gap-1.5">
                  <Cpu className="w-4 h-4 text-indigo-400" />
                  <span>1. Pilih Model AI Google (@google/genai):</span>
                </label>
                <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded border border-emerald-500/30">
                  Token Usage Tercatat di ai_token_logs
                </span>
              </div>
              <select
                value={selectedAiModel}
                onChange={(e) => setSelectedAiModel(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-indigo-500/50 text-xs text-white font-bold focus:outline-none focus:border-indigo-400"
              >
                {AI_STUDIO_MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 2. NAMA HALAMAN & KELOMPOK MENU SIDEBAR */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">
                  2. Nama / Judul Halaman Baru:
                </label>
                <input
                  type="text"
                  value={aiPageTitle}
                  onChange={(e) => setAiPageTitle(e.target.value)}
                  placeholder="Contoh: Manajemen Pajak PPN & PPh / Evaluasi KPI Kasir"
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 px-3.5 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none font-semibold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">
                  Kelompok Menu Induk Target (A–P):
                </label>
                <select
                  value={selectedParentGroup}
                  onChange={(e) => setSelectedParentGroup(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white font-semibold focus:outline-none focus:border-indigo-500"
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.letter}. {g.customLabel || g.labelId}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 3. MULTIMODAL VISION UPLOAD & PROMPT */}
            <div className="space-y-3">
              <label className="block text-xs font-bold text-zinc-300">
                3. Unggah Gambar Layout Apapun (Sketsa Kertas, Tabel Excel, Form Pajak, Dashboard KPI):
              </label>
              {!uploadedImageBase64 ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleImageUpload(f);
                  }}
                  className="border-2 border-dashed border-zinc-700 hover:border-indigo-500 rounded-2xl p-4 text-center cursor-pointer bg-zinc-950/60 hover:bg-indigo-950/15 transition"
                >
                  <Upload className="w-6 h-6 text-indigo-400 mx-auto mb-1.5" />
                  <p className="text-xs font-bold text-zinc-200">
                    Klik atau Tarik Gambar Sketsa / Screenshot Excel / Form Pajak / KPI ke Sini
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    AI otomatis mengenali kolom tabel, merumuskan kalkulasi matematika, dan membuatkan collection <code>ext_&#123;slug&#125;</code> di Firestore.
                  </p>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-zinc-950 border border-indigo-500/40 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={`data:${uploadedImageMime};base64,${uploadedImageBase64}`}
                      alt="Preview"
                      className="w-14 h-14 object-cover rounded-lg border border-zinc-700"
                    />
                    <div>
                      <div className="text-xs font-bold text-white truncate">{uploadedImageName}</div>
                      <span className="text-[10px] text-emerald-400 font-semibold">
                        ✓ Gambar siap dianalisis oleh {selectedAiModel}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedImageBase64(null);
                      setUploadedImageName('');
                    }}
                    className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-600 text-zinc-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-zinc-300">
                    4. Prompt / Instruksi Logika &amp; Rumus Halaman:
                  </label>
                  <span className="text-[10px] text-zinc-400">Template Siap Pakai:</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {AI_BUILDER_PRESETS.map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setAiPageTitle(preset.label);
                        setAiPrompt(preset.prompt);
                        setSelectedParentGroup(preset.group);
                      }}
                      className="text-[10px] px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-indigo-600/20 text-zinc-300 hover:text-indigo-300 border border-zinc-700 hover:border-indigo-500/40 transition cursor-pointer font-semibold"
                    >
                      + {preset.label}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={3}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Ketik kebutuhan halaman Anda (misal: halaman Pajak PPN 11% & PPh 0.5%, halaman KPI Kasir & Bonus, atau halaman kustom baru)..."
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 p-3 text-xs text-white placeholder-zinc-500 focus:outline-none"
                />
              </div>
            </div>

            {generationError && (
              <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-700 text-rose-200 text-xs font-semibold">
                {generationError}
              </div>
            )}

            {/* Generated Schema Summary inside Modal */}
            {generatedSchema && (
              <div className="p-4 rounded-2xl bg-zinc-950 border border-emerald-500/40 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-black text-white">
                      Blueprint Siap: {generatedSchema.title}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      Collection: {generatedSchema.customCollectionName || `ext_${generatedSchema.slug}`}
                    </span>
                  </div>
                  {lastTokenUsage && (
                    <span className="text-[10px] font-mono text-indigo-300">
                      {lastTokenUsage.totalTokens} tokens ({lastTokenUsage.modelUsed})
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {generatedSchema.formulas?.map((f, i) => (
                    <span
                      key={i}
                      className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-amber-300"
                    >
                      ƒ {f.name}: {f.expression}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Modal Footer Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setIsAddPageModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold cursor-pointer"
              >
                Tutup
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleGenerateAiPage}
                  disabled={isGeneratingPage}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs flex items-center gap-1.5 shadow-lg shadow-indigo-600/30 cursor-pointer disabled:opacity-50"
                >
                  {isGeneratingPage ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Merancang Blueprint &amp; Database...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>1. Analisis &amp; Bangun Blueprint AI</span>
                    </>
                  )}
                </button>

                {generatedSchema && (
                  <button
                    type="button"
                    onClick={handleSaveAndMountPage}
                    disabled={isSavingCustomPage}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-600/30 cursor-pointer disabled:opacity-50"
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>
                      {isSavingCustomPage
                        ? 'Menerbitkan...'
                        : '2. Simpan & Terbitkan Halaman'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Reset */}
      {confirmResetOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <RotateCcw className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-white">Reset ke Default?</h3>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Seluruh urutan 16 kelompok menu induk dan sub-menu akan dikembalikan ke konfigurasi standar pabrik (A sampai P). Semua label kustom juga akan di-reset.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setConfirmResetOpen(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 hover:bg-zinc-700 font-bold text-xs cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg cursor-pointer"
              >
                Ya, Reset Sekarang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats & Search Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-zinc-900/90 border border-zinc-800/80 p-3 rounded-xl">
        {/* Metric Badges */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 font-medium">
            Kelompok Menu Induk: <strong className="text-white font-black">{activeGroups}</strong>/{totalGroups} Aktif
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 font-medium">
            Sub-Menu Halaman: <strong className="text-white font-black">{activeSubItems}</strong>/{totalSubItems} Aktif
          </span>
          <button
            type="button"
            onClick={() => {
              setExpandedGroupIds((prev) => ({ ...prev, ai: true }));
              setIsAiAgentsListExpanded(true);
            }}
            className="px-2.5 py-1 rounded-lg bg-purple-950/60 hover:bg-purple-900/60 text-purple-200 border border-purple-500/40 font-semibold flex items-center gap-1.5 cursor-pointer transition"
            title="Klik untuk membuka daftar Agen AI di Grup A"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>
              Agen AI: <strong className="text-white font-black">{activeAiAgents}</strong>/{totalAiAgents} Aktif
            </span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmResetOpen(true)}
            className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold flex items-center gap-1 cursor-pointer border border-zinc-700"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Default</span>
          </button>
        </div>

        {/* Search & Bulk Expand/Collapse */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Cari menu atau sub-menu..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          <button
            type="button"
            onClick={expandAll}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold whitespace-nowrap cursor-pointer transition"
            title="Buka semua sub-menu"
          >
            + Expand Semua
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold whitespace-nowrap cursor-pointer transition"
            title="Ciutkan semua sub-menu"
          >
            − Ciutkan Semua
          </button>
        </div>
      </div>

      {/* Main Grid: Builder Canvas + Optional Live Preview */}
      <div className={`grid grid-cols-1 ${showLivePreview ? 'lg:grid-cols-12' : ''} gap-6`}>
        {/* Left Column: WordPress Menu Tree Editor */}
        <div className={`${showLivePreview ? 'lg:col-span-8' : 'w-full'} space-y-3`}>
          {filteredGroups.map((group, groupIndex) => {
            const isExpanded = !!expandedGroupIds[group.id];
            const isGroupVisible = group.visible !== false;
            const isDraggingThis = draggedGroupIndex === groupIndex;
            const isDragOverThis = dragOverGroupIndex === groupIndex && draggedGroupIndex !== groupIndex;
            const isSubmenuDragOverGroup =
              dragOverGroupForSubmenu === group.id && draggedItemInfo !== null;

            return (
              <div
                key={group.id}
                draggable={editingGroupId !== group.id && !editingItemId}
                onDragStart={(e) => {
                  if (draggedItemInfo) return;
                  e.dataTransfer.setData('text/plain', String(groupIndex));
                  setDraggedGroupIndex(groupIndex);
                }}
                onDragEnter={() => {
                  if (draggedItemInfo) {
                    setDragOverGroupForSubmenu(group.id);
                  } else if (draggedGroupIndex !== null && draggedGroupIndex !== groupIndex) {
                    setDragOverGroupIndex(groupIndex);
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (draggedItemInfo) {
                    if (dragOverGroupForSubmenu !== group.id) {
                      setDragOverGroupForSubmenu(group.id);
                    }
                  } else if (draggedGroupIndex !== null && dragOverGroupIndex !== groupIndex) {
                    setDragOverGroupIndex(groupIndex);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverGroupIndex === groupIndex) {
                    setDragOverGroupIndex(null);
                  }
                  if (dragOverGroupForSubmenu === group.id) {
                    setDragOverGroupForSubmenu(null);
                  }
                }}
                onDragEnd={() => {
                  setDraggedGroupIndex(null);
                  setDragOverGroupIndex(null);
                  setDragOverGroupForSubmenu(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedItemInfo) {
                    if (draggedItemInfo.isAiAgent) {
                      moveAiAgentToGroup(draggedItemInfo.itemId, group.id);
                    } else {
                      moveItemAcrossGroups(
                        draggedItemInfo.groupId,
                        draggedItemInfo.itemIndex,
                        group.id
                      );
                    }
                    setExpandedGroupIds((prev) => ({ ...prev, [group.id]: true }));
                    showToast(
                      `✓ Sub-menu "${draggedItemInfo.label}" berhasil dipindahkan ke menu "${group.customLabel || group.labelId}"!`
                    );
                    setDraggedItemInfo(null);
                    setDragOverItemInfo(null);
                    setDragOverGroupForSubmenu(null);
                    return;
                  }
                  if (draggedGroupIndex !== null && draggedGroupIndex !== groupIndex) {
                    const newOrder = [...groups.map((g) => g.id)];
                    const [removed] = newOrder.splice(draggedGroupIndex, 1);
                    newOrder.splice(groupIndex, 0, removed);
                    reorderGroups(newOrder);
                    showToast(`Urutan kelompok "${group.customLabel || group.labelId}" berhasil dipindahkan!`);
                  }
                  setDraggedGroupIndex(null);
                  setDragOverGroupIndex(null);
                  setDragOverGroupForSubmenu(null);
                }}
                className={`rounded-2xl border transition-all duration-150 shadow-lg select-none ${
                  isDraggingThis
                    ? 'opacity-40 border-dashed border-blue-500 scale-[0.99]'
                    : isSubmenuDragOverGroup
                    ? 'border-emerald-500 bg-emerald-950/30 ring-2 ring-emerald-500/60 shadow-emerald-500/20'
                    : isDragOverThis
                    ? 'border-blue-500 bg-blue-950/40 ring-2 ring-blue-500/60 shadow-blue-500/20 translate-y-1'
                    : isGroupVisible
                    ? 'bg-zinc-900/90 border-zinc-800 hover:border-zinc-700'
                    : 'bg-zinc-950/60 border-zinc-850 opacity-60'
                }`}
              >
                {/* Level 1: WordPress Group Header Bar */}
                <div className="p-3 sm:p-4 flex items-center justify-between gap-3">
                  {/* Left: Drag Handle, Number, Letter, Title */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div
                      className="p-1.5 text-zinc-500 hover:text-white cursor-grab active:cursor-grabbing rounded hover:bg-zinc-800 transition shrink-0"
                      title="Klik dan tahan (drag) untuk memindahkan urutan kelompok menu"
                    >
                      <GripVertical className="w-4 h-4" />
                    </div>

                    <span className="text-[11px] font-mono font-bold text-zinc-500 shrink-0 w-6">
                      #{String(groupIndex + 1).padStart(2, '0')}
                    </span>

                    <span
                      className={`w-7 h-7 rounded-lg flex items-center justify-center font-black text-xs shrink-0 ${
                        isGroupVisible
                          ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {group.letter}
                    </span>

                    <div className="min-w-0 flex-1">
                      {editingGroupId === group.id ? (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={groupLabelDraft}
                            onChange={(e) => setGroupLabelDraft(e.target.value)}
                            onBlur={() => saveEditGroup(group.id)}
                            className="px-2 py-1 bg-zinc-950 border border-blue-500 rounded-lg text-xs font-bold text-white focus:outline-none w-full max-w-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEditGroup(group.id);
                              if (e.key === 'Escape') setEditingGroupId(null);
                            }}
                          />
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              saveEditGroup(group.id);
                            }}
                            className="p-1 rounded bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
                            title="Simpan Label"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 truncate">
                          <span
                            onClick={() => startEditGroup(group)}
                            className="font-bold text-white hover:text-blue-300 text-xs sm:text-sm truncate cursor-pointer"
                            title="Klik untuk ubah nama judul kelompok menu"
                          >
                            {(group.customLabel || group.labelId)
                              .replace(/(\bkasir\b)(?:\s+\1)+/gi, '$1')
                              .replace(/(\(kasir\))(?:\s+\1)+/gi, '$1')}
                          </span>
                          {group.customLabel && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono font-bold border border-blue-500/30">
                              Kustom
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => startEditGroup(group)}
                            className="opacity-60 hover:opacity-100 text-zinc-400 hover:text-blue-400 p-1 cursor-pointer transition"
                            title="Ubah nama label kelompok menu ini"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      <div className="text-[10px] text-zinc-500 flex flex-wrap items-center gap-2 mt-0.5">
                        <span>ID: <code className="text-zinc-400">{group.id}</code></span>
                        <span>&bull;</span>
                        <span className="text-zinc-400">
                          {group.children.filter((c) => c.visible).length}/{group.children.length} sub-menu aktif
                        </span>
                        {group.id === 'ai' && (
                          <>
                            <span>&bull;</span>
                            <span className="text-purple-300 font-bold flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-purple-400" />
                              Agen AI ({activeAiAgents}/{totalAiAgents})
                            </span>
                          </>
                        )}
                        {isSubmenuDragOverGroup && (
                          <span className="text-emerald-400 font-bold">
                            &bull; Lepas untuk pindahkan sub-menu ke sini
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveGroup(groupIndex, 'up')}
                      disabled={groupIndex === 0}
                      className="p-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white disabled:opacity-20 cursor-pointer transition"
                      title="Naikkan posisi kelompok ke atas"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => moveGroup(groupIndex, 'down')}
                      disabled={groupIndex === groups.length - 1}
                      className="p-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white disabled:opacity-20 cursor-pointer transition"
                      title="Turunkan posisi kelompok ke bawah"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleGroupVisibility(group.id)}
                      className={`p-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
                        isGroupVisible
                          ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30'
                          : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                      }`}
                      title={isGroupVisible ? 'Tampilkan di Sidebar (Klik untuk Sembunyikan)' : 'Disembunyikan di Sidebar (Klik untuk Tampilkan)'}
                    >
                      {isGroupVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      <span className="hidden sm:inline text-[10px]">{isGroupVisible ? 'Tampil' : 'Sembunyi'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleExpandGroup(group.id)}
                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition cursor-pointer ml-1"
                      title={isExpanded ? 'Ciutkan daftar sub-menu' : 'Buka daftar sub-menu'}
                    >
                      <ChevronDown
                        className={`w-4 h-4 transition-transform duration-200 ${
                          isExpanded ? 'rotate-180 text-blue-400' : ''
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Level 2: Nested Indented Sub-Menu Items */}
                {isExpanded && (
                  <div className="px-3 sm:px-4 pb-3 pt-1 border-t border-zinc-800/60 bg-zinc-950/50 rounded-b-2xl space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 py-1 flex items-center justify-between border-b border-zinc-800/40 mb-2">
                      <span className="flex items-center gap-1.5 text-zinc-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        Sub-Menu Halaman ({group.children.length} item)
                      </span>
                      <span className="text-zinc-500 font-normal">
                        Tarik (Drag) sub-menu &gt; ke urutan lain atau ke Kelompok Menu manapun (A–Q)
                      </span>
                    </div>

                    {group.children.map((item, itemIdx) => {
                      const isItemVisible = item.visible !== false;
                      const isItemDragging =
                        draggedItemInfo?.groupId === group.id && draggedItemInfo.itemIndex === itemIdx;
                      const isItemDragOver =
                        dragOverItemInfo?.groupId === group.id &&
                        dragOverItemInfo.itemIndex === itemIdx &&
                        !(draggedItemInfo?.groupId === group.id && draggedItemInfo?.itemIndex === itemIdx);

                      return (
                        <div
                          key={`${group.id}-${item.id}`}
                          draggable={editingItemId !== item.id}
                          onDragStart={(e) => {
                            e.stopPropagation();
                            e.dataTransfer.setData(
                              'text/plain',
                              JSON.stringify({
                                groupId: group.id,
                                itemIndex: itemIdx,
                                itemId: item.id,
                              })
                            );
                            setDraggedItemInfo({
                              groupId: group.id,
                              itemIndex: itemIdx,
                              itemId: item.id,
                              label: item.customLabel || item.labelId,
                            });
                          }}
                          onDragEnter={(e) => {
                            e.stopPropagation();
                            if (
                              draggedItemInfo &&
                              !(draggedItemInfo.groupId === group.id && draggedItemInfo.itemIndex === itemIdx)
                            ) {
                              setDragOverItemInfo({ groupId: group.id, itemIndex: itemIdx });
                            }
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (
                              draggedItemInfo &&
                              (dragOverItemInfo?.groupId !== group.id ||
                                dragOverItemInfo?.itemIndex !== itemIdx)
                            ) {
                              setDragOverItemInfo({ groupId: group.id, itemIndex: itemIdx });
                            }
                          }}
                          onDragLeave={(e) => {
                            e.stopPropagation();
                            if (dragOverItemInfo?.groupId === group.id && dragOverItemInfo.itemIndex === itemIdx) {
                              setDragOverItemInfo(null);
                            }
                          }}
                          onDragEnd={() => {
                            setDraggedItemInfo(null);
                            setDragOverItemInfo(null);
                            setDragOverGroupForSubmenu(null);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (
                              draggedItemInfo &&
                              !(draggedItemInfo.groupId === group.id && draggedItemInfo.itemIndex === itemIdx)
                            ) {
                              if (draggedItemInfo.isAiAgent) {
                                moveAiAgentToGroup(draggedItemInfo.itemId, group.id, itemIdx);
                              } else {
                                moveItemAcrossGroups(
                                  draggedItemInfo.groupId,
                                  draggedItemInfo.itemIndex,
                                  group.id,
                                  itemIdx
                                );
                              }
                              showToast(
                                draggedItemInfo.groupId === group.id
                                  ? `✓ Urutan sub-menu "${draggedItemInfo.label}" berhasil diperbarui!`
                                  : `✓ Sub-menu "${draggedItemInfo.label}" berhasil dipindahkan ke "${group.customLabel || group.labelId}"!`
                              );
                            }
                            setDraggedItemInfo(null);
                            setDragOverItemInfo(null);
                            setDragOverGroupForSubmenu(null);
                          }}
                          className={`flex flex-wrap sm:flex-nowrap items-center justify-between p-2.5 rounded-xl border transition-all duration-150 ml-4 sm:ml-8 gap-2 ${
                            isItemDragging
                              ? 'opacity-30 border-dashed border-blue-400'
                              : isItemDragOver
                              ? 'border-emerald-500 bg-emerald-950/50 ring-1 ring-emerald-400 shadow-md translate-x-1'
                              : isItemVisible
                              ? 'bg-zinc-900 border-zinc-800/80 hover:border-zinc-700 shadow-sm'
                              : 'bg-zinc-950/80 border-zinc-900 opacity-50'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div
                              className="p-1 text-zinc-500 hover:text-zinc-200 cursor-grab active:cursor-grabbing rounded shrink-0 flex items-center gap-0.5"
                              title="Tarik (Drag) untuk memindahkan sub-menu ke urutan atau kelompok menu manapun"
                            >
                              <GripVertical className="w-3.5 h-3.5" />
                              <span className="text-[10px] font-black text-blue-400">&gt;</span>
                            </div>

                            <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                              {itemIdx + 1}.
                            </span>

                            <div className="min-w-0 flex-1">
                              {editingItemId === item.id && editingItemGroupId === group.id ? (
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="text"
                                    value={itemLabelDraft}
                                    onChange={(e) => setItemLabelDraft(e.target.value)}
                                    onBlur={() => saveEditItem(item.id, group.id)}
                                    className="px-2 py-0.5 bg-zinc-950 border border-blue-500 rounded text-xs font-medium text-white focus:outline-none w-full max-w-xs"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') saveEditItem(item.id, group.id);
                                      if (e.key === 'Escape') {
                                        setEditingItemId(null);
                                        setEditingItemGroupId(null);
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      saveEditItem(item.id, group.id);
                                    }}
                                    className="p-1 rounded bg-blue-600 text-white cursor-pointer"
                                  >
                                    <Check className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 truncate">
                                  <span
                                    onClick={() => startEditItem(item, group.id)}
                                    className="text-xs font-semibold text-zinc-200 hover:text-blue-300 truncate cursor-pointer"
                                    title="Klik untuk ubah nama sub-menu ini"
                                  >
                                    {item.customLabel || item.labelId}
                                  </span>
                                  {item.customLabel && (
                                    <span className="text-[8px] px-1 py-0.2 rounded bg-blue-500/20 text-blue-300 font-mono border border-blue-500/30">
                                      Kustom
                                    </span>
                                  )}
                                  {item.badge && (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                                      {item.badge}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => startEditItem(item, group.id)}
                                    className="opacity-60 hover:opacity-100 text-zinc-400 hover:text-blue-400 p-0.5 cursor-pointer"
                                    title="Ubah label sub-menu ini"
                                  >
                                    <Edit2 className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              )}

                              <div className="text-[10px] text-zinc-500 font-mono truncate">
                                {item.path}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                            {/* Quick Cross-Group Move Selector */}
                            <select
                              value={group.id}
                              onChange={(e) => {
                                const targetGid = e.target.value;
                                if (targetGid === 'ai_agents' && item.id.startsWith('ai_agent_')) {
                                  const rawId = item.id.replace(/^ai_agent_/, '');
                                  moveAiAgentToGroup(rawId, 'ai_agents');
                                  showToast(
                                    `✓ "${item.customLabel || item.labelId}" dikembalikan ke daftar Agen AI!`
                                  );
                                  return;
                                }
                                if (targetGid && targetGid !== group.id) {
                                  moveItemAcrossGroups(group.id, itemIdx, targetGid);
                                  setExpandedGroupIds((prev) => ({ ...prev, [targetGid]: true }));
                                  const targetGrp = groups.find((g) => g.id === targetGid);
                                  showToast(
                                    `✓ Sub-menu "${item.customLabel || item.labelId}" dipindahkan ke "${targetGrp?.customLabel || targetGrp?.labelId || targetGid}"!`
                                  );
                                }
                              }}
                              className="bg-zinc-950 border border-zinc-800 hover:border-blue-500/50 rounded-lg px-1.5 py-1 text-[10px] text-zinc-300 font-semibold focus:outline-none focus:border-blue-500 cursor-pointer max-w-[115px] truncate"
                              title="Pindahkan sub-menu ini ke Kelompok Menu lain"
                            >
                              {item.id.startsWith('ai_agent_') && (
                                <option value="ai_agents">➔ ✨ Kembalikan ke Agen AI</option>
                              )}
                              {groups.map((gOpt) => (
                                <option key={gOpt.id} value={gOpt.id}>
                                  ➔ {gOpt.letter}. {(gOpt.customLabel || gOpt.labelId).replace(/^[A-Z]\.\s*/, '')}
                                </option>
                              ))}
                            </select>

                            {item.isAiCustomPage && (
                              <button
                                type="button"
                                onClick={() => navigateToPath(item.path)}
                                className="p-1 rounded bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white transition cursor-pointer"
                                title="Buka halaman AI"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => moveItem(group.id, itemIdx, 'up')}
                              disabled={itemIdx === 0}
                              className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white disabled:opacity-20 cursor-pointer transition"
                              title="Naikkan sub-menu"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveItem(group.id, itemIdx, 'down')}
                              disabled={itemIdx === group.children.length - 1}
                              className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white disabled:opacity-20 cursor-pointer transition"
                              title="Turunkan sub-menu"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>

                            <button
                              type="button"
                              onClick={() => toggleItemVisibility(item.id)}
                              className={`p-1 rounded transition cursor-pointer ${
                                isItemVisible
                                  ? 'text-emerald-400 hover:bg-emerald-500/10'
                                  : 'text-zinc-600 hover:text-zinc-400'
                              }`}
                              title={isItemVisible ? 'Tampilkan di Sidebar (Klik untuk sembunyikan)' : 'Disembunyikan (Klik untuk tampilkan)'}
                            >
                              {isItemVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {/* =====================================================================
                        NESTED EXPANDABLE "AGEN AI (12)" DRAG & DROP SECTION INSIDE GROUP A
                       ===================================================================== */}
                    {group.id === 'ai' && (
                      <div
                        className={`mt-3 ml-2 sm:ml-4 rounded-2xl border transition-all duration-150 ${
                          isAiAgentsSectionVisible
                            ? 'bg-purple-950/15 border-purple-500/40'
                            : 'bg-zinc-950/60 border-zinc-800 opacity-60'
                        }`}
                        onDragOver={(e) => {
                          if (draggedItemInfo) {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                        }}
                        onDrop={(e) => {
                          if (
                            draggedItemInfo &&
                            (draggedItemInfo.isAiAgent ||
                              draggedItemInfo.itemId.startsWith('ai_agent_'))
                          ) {
                            e.preventDefault();
                            e.stopPropagation();
                            const rawId = draggedItemInfo.itemId.replace(/^ai_agent_/, '');
                            moveAiAgentToGroup(rawId, 'ai_agents');
                            showToast(
                              `✓ "${draggedItemInfo.label}" ditempatkan di sub-grup Agen AI!`
                            );
                            setDraggedItemInfo(null);
                            setDragOverItemInfo(null);
                            setDragOverGroupForSubmenu(null);
                          }
                        }}
                      >
                        {/* Agen AI Section Header */}
                        <div className="p-2.5 sm:p-3 flex items-center justify-between gap-2 border-b border-purple-500/20">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="p-1.5 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30 shrink-0">
                              <Sparkles className="w-3.5 h-3.5" />
                            </span>

                            {editingAiAgentsHeader ? (
                              <div
                                className="flex items-center gap-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="text"
                                  value={aiAgentsHeaderDraft}
                                  onChange={(e) => setAiAgentsHeaderDraft(e.target.value)}
                                  onBlur={() => {
                                    setAiAgentsSectionCustomLabel(aiAgentsHeaderDraft);
                                    setEditingAiAgentsHeader(false);
                                    showToast('✓ Label sub-grup Agen AI diperbarui!');
                                  }}
                                  className="px-2 py-0.5 bg-zinc-950 border border-purple-500 rounded text-xs font-bold text-white focus:outline-none"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      setAiAgentsSectionCustomLabel(aiAgentsHeaderDraft);
                                      setEditingAiAgentsHeader(false);
                                      showToast('✓ Label sub-grup Agen AI diperbarui!');
                                    }
                                    if (e.key === 'Escape') setEditingAiAgentsHeader(false);
                                  }}
                                />
                                <button
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    setAiAgentsSectionCustomLabel(aiAgentsHeaderDraft);
                                    setEditingAiAgentsHeader(false);
                                    showToast('✓ Label sub-grup Agen AI diperbarui!');
                                  }}
                                  className="p-1 rounded bg-purple-600 text-white cursor-pointer"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 truncate">
                                  <span
                                    onClick={() => {
                                      setAiAgentsHeaderDraft(
                                        aiAgentsSectionCustomLabel || 'Agen AI'
                                      );
                                      setEditingAiAgentsHeader(true);
                                    }}
                                    className="text-xs font-black text-purple-200 hover:text-white cursor-pointer truncate"
                                    title="Klik untuk ubah nama sub-grup Agen AI"
                                  >
                                    {aiAgentsSectionCustomLabel || 'Agen AI'} ({activeAiAgents}/{totalAiAgents})
                                  </span>
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono font-bold">
                                    DRAG &amp; DROP SYNC
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAiAgentsHeaderDraft(
                                        aiAgentsSectionCustomLabel || 'Agen AI'
                                      );
                                      setEditingAiAgentsHeader(true);
                                    }}
                                    className="opacity-60 hover:opacity-100 text-purple-300 hover:text-white p-0.5 cursor-pointer"
                                    title="Ubah nama sub-grup Agen AI"
                                  >
                                    <Edit2 className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                                <p className="text-[10px] text-zinc-400 truncate">
                                  Daftar 12+ Agen AI di Sidebar bawah Grup A — tarik (drag) untuk urutkan, ubah nama, sembunyikan, atau pindahkan ke grup lain.
                                </p>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => toggleAiAgentsSectionVisibility()}
                              className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer transition border ${
                                isAiAgentsSectionVisible
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                                  : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300'
                              }`}
                              title={
                                isAiAgentsSectionVisible
                                  ? 'Sub-Grup Agen AI Tampil di Sidebar (Klik untuk Sembunyikan Semua)'
                                  : 'Sub-Grup Agen AI Disembunyikan (Klik untuk Tampilkan)'
                              }
                            >
                              {isAiAgentsSectionVisible ? (
                                <Eye className="w-3 h-3" />
                              ) : (
                                <EyeOff className="w-3 h-3" />
                              )}
                              <span className="hidden sm:inline">
                                {isAiAgentsSectionVisible ? 'Tampil' : 'Sembunyi'}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setIsAiAgentsListExpanded((prev) => !prev)}
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-purple-300 hover:text-white cursor-pointer transition"
                              title={
                                isAiAgentsListExpanded
                                  ? 'Ciutkan daftar Agen AI'
                                  : 'Buka daftar Agen AI'
                              }
                            >
                              <ChevronDown
                                className={`w-3.5 h-3.5 transition-transform ${
                                  isAiAgentsListExpanded ? 'rotate-180' : ''
                                }`}
                              />
                            </button>
                          </div>
                        </div>

                        {/* Agen AI Draggable Items List */}
                        {isAiAgentsListExpanded && (
                          <div className="p-2.5 sm:p-3 space-y-1.5">
                            {aiAgents.map((agent, agentIdx) => {
                              const isAgentVis = agent.visible !== false;
                              const isAgentDragging =
                                draggedItemInfo?.isAiAgent && draggedItemInfo.itemId === agent.id;
                              const isAgentDragOver =
                                dragOverItemInfo?.groupId === 'ai_agents' &&
                                dragOverItemInfo.itemIndex === agentIdx &&
                                draggedItemInfo?.itemId !== agent.id;
                              const movedGroupObj = agent.movedToGroupId
                                ? groups.find((g) => g.id === agent.movedToGroupId)
                                : null;

                              return (
                                <div
                                  key={agent.id}
                                  draggable={editingAiAgentId !== agent.id}
                                  onDragStart={(e) => {
                                    e.stopPropagation();
                                    e.dataTransfer.setData(
                                      'text/plain',
                                      JSON.stringify({
                                        groupId: 'ai_agents',
                                        itemIndex: agentIdx,
                                        itemId: agent.id,
                                        isAiAgent: true,
                                      })
                                    );
                                    setDraggedItemInfo({
                                      groupId: 'ai_agents',
                                      itemIndex: agentIdx,
                                      itemId: agent.id,
                                      label: agent.displayName,
                                      isAiAgent: true,
                                    });
                                  }}
                                  onDragEnter={(e) => {
                                    e.stopPropagation();
                                    if (draggedItemInfo && draggedItemInfo.itemId !== agent.id) {
                                      setDragOverItemInfo({
                                        groupId: 'ai_agents',
                                        itemIndex: agentIdx,
                                      });
                                    }
                                  }}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (
                                      draggedItemInfo &&
                                      (dragOverItemInfo?.groupId !== 'ai_agents' ||
                                        dragOverItemInfo?.itemIndex !== agentIdx)
                                    ) {
                                      setDragOverItemInfo({
                                        groupId: 'ai_agents',
                                        itemIndex: agentIdx,
                                      });
                                    }
                                  }}
                                  onDragLeave={(e) => {
                                    e.stopPropagation();
                                    if (
                                      dragOverItemInfo?.groupId === 'ai_agents' &&
                                      dragOverItemInfo.itemIndex === agentIdx
                                    ) {
                                      setDragOverItemInfo(null);
                                    }
                                  }}
                                  onDragEnd={() => {
                                    setDraggedItemInfo(null);
                                    setDragOverItemInfo(null);
                                    setDragOverGroupForSubmenu(null);
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (draggedItemInfo && draggedItemInfo.itemId !== agent.id) {
                                      if (draggedItemInfo.isAiAgent) {
                                        const currentIds = aiAgents.map((a) => a.id);
                                        const fromIdx = currentIds.indexOf(draggedItemInfo.itemId);
                                        if (fromIdx !== -1 && fromIdx !== agentIdx) {
                                          const nextOrder = [...currentIds];
                                          const [removed] = nextOrder.splice(fromIdx, 1);
                                          nextOrder.splice(agentIdx, 0, removed);
                                          reorderAiAgents(nextOrder);
                                          showToast(
                                            `✓ Urutan Agen AI "${draggedItemInfo.label}" berhasil diperbarui & disinkronkan ke Sidebar!`
                                          );
                                        }
                                      } else if (draggedItemInfo.itemId.startsWith('ai_agent_')) {
                                        const rawId = draggedItemInfo.itemId.replace(
                                          /^ai_agent_/,
                                          ''
                                        );
                                        moveAiAgentToGroup(rawId, 'ai_agents');
                                        showToast(
                                          `✓ "${draggedItemInfo.label}" dikembalikan ke sub-grup Agen AI!`
                                        );
                                      }
                                    }
                                    setDraggedItemInfo(null);
                                    setDragOverItemInfo(null);
                                    setDragOverGroupForSubmenu(null);
                                  }}
                                  className={`flex flex-wrap sm:flex-nowrap items-center justify-between p-2.5 rounded-xl border transition-all duration-150 gap-2 ${
                                    isAgentDragging
                                      ? 'opacity-30 border-dashed border-purple-400'
                                      : isAgentDragOver
                                      ? 'border-emerald-500 bg-emerald-950/50 ring-1 ring-emerald-400 shadow-md translate-x-1'
                                      : isAgentVis
                                      ? 'bg-zinc-900/95 border-zinc-800 hover:border-purple-500/40 shadow-sm'
                                      : 'bg-zinc-950/80 border-zinc-900 opacity-50'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <div
                                      className="p-1 text-zinc-500 hover:text-purple-300 cursor-grab active:cursor-grabbing rounded shrink-0 flex items-center gap-0.5"
                                      title="Tarik (Drag) untuk mengubah urutan Agen AI atau pindahkan ke Grup Menu lain"
                                    >
                                      <GripVertical className="w-3.5 h-3.5" />
                                      <span className="text-[10px] font-black text-purple-400">
                                        &gt;
                                      </span>
                                    </div>

                                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />

                                    <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                                      {agentIdx + 1}.
                                    </span>

                                    <div className="min-w-0 flex-1">
                                      {editingAiAgentId === agent.id ? (
                                        <div
                                          className="flex items-center gap-2"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <input
                                            type="text"
                                            value={aiAgentLabelDraft}
                                            onChange={(e) => setAiAgentLabelDraft(e.target.value)}
                                            onBlur={() => {
                                              setAiAgentCustomLabel(agent.id, aiAgentLabelDraft);
                                              setEditingAiAgentId(null);
                                              showToast(
                                                `✓ Nama Agen AI berhasil diubah menjadi "${aiAgentLabelDraft}"!`
                                              );
                                            }}
                                            className="px-2 py-0.5 bg-zinc-950 border border-purple-500 rounded text-xs font-bold text-white focus:outline-none w-full max-w-xs"
                                            autoFocus
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') {
                                                setAiAgentCustomLabel(agent.id, aiAgentLabelDraft);
                                                setEditingAiAgentId(null);
                                                showToast(
                                                  `✓ Nama Agen AI berhasil diubah menjadi "${aiAgentLabelDraft}"!`
                                                );
                                              }
                                              if (e.key === 'Escape') {
                                                setEditingAiAgentId(null);
                                              }
                                            }}
                                          />
                                          <button
                                            type="button"
                                            onMouseDown={(e) => {
                                              e.preventDefault();
                                              setAiAgentCustomLabel(agent.id, aiAgentLabelDraft);
                                              setEditingAiAgentId(null);
                                              showToast(
                                                `✓ Nama Agen AI berhasil diubah menjadi "${aiAgentLabelDraft}"!`
                                              );
                                            }}
                                            className="p-1 rounded bg-purple-600 text-white cursor-pointer"
                                          >
                                            <Check className="w-3 h-3" />
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="flex flex-wrap items-center gap-1.5 truncate">
                                          <span
                                            onClick={() => {
                                              setEditingAiAgentId(agent.id);
                                              setAiAgentLabelDraft(agent.displayName);
                                            }}
                                            className="text-xs font-bold text-zinc-100 hover:text-purple-300 truncate cursor-pointer"
                                            title="Klik untuk ubah nama Agen AI ini"
                                          >
                                            {agent.displayName}
                                          </span>
                                          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                                            {agent.latency}
                                          </span>
                                          {movedGroupObj && (
                                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                                              Dipindah ke {movedGroupObj.letter}
                                            </span>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setEditingAiAgentId(agent.id);
                                              setAiAgentLabelDraft(agent.displayName);
                                            }}
                                            className="opacity-60 hover:opacity-100 text-zinc-400 hover:text-purple-300 p-0.5 cursor-pointer"
                                            title="Ubah nama Agen AI ini"
                                          >
                                            <Edit2 className="w-2.5 h-2.5" />
                                          </button>
                                        </div>
                                      )}

                                      <div className="text-[10px] text-zinc-500 font-mono truncate">
                                        {agent.path}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Right Controls for Each AI Agent */}
                                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                                    <select
                                      value={agent.movedToGroupId || 'ai_agents'}
                                      onChange={(e) => {
                                        const targetGid = e.target.value;
                                        moveAiAgentToGroup(agent.id, targetGid);
                                        if (targetGid === 'ai_agents') {
                                          showToast(
                                            `✓ "${agent.displayName}" ditempatkan kembali di sub-grup Agen AI!`
                                          );
                                        } else {
                                          setExpandedGroupIds((prev) => ({
                                            ...prev,
                                            [targetGid]: true,
                                          }));
                                          const targetGrp = groups.find((g) => g.id === targetGid);
                                          showToast(
                                            `✓ Agen AI "${agent.displayName}" dipindahkan ke "${targetGrp?.customLabel || targetGrp?.labelId || targetGid}"!`
                                          );
                                        }
                                      }}
                                      className="bg-zinc-950 border border-zinc-800 hover:border-purple-500/50 rounded-lg px-1.5 py-1 text-[10px] text-zinc-300 font-semibold focus:outline-none focus:border-purple-500 cursor-pointer max-w-[125px] truncate"
                                      title="Pindahkan Agen AI ini ke Kelompok Menu lain atau tetap di Agen AI"
                                    >
                                      <option value="ai_agents">✨ Agen AI (Sub-Grup A)</option>
                                      {groups.map((gOpt) => (
                                        <option key={gOpt.id} value={gOpt.id}>
                                          ➔ {gOpt.letter}.{' '}
                                          {(gOpt.customLabel || gOpt.labelId).replace(
                                            /^[A-Z]\.\s*/,
                                            ''
                                          )}
                                        </option>
                                      ))}
                                    </select>

                                    <button
                                      type="button"
                                      onClick={() => navigateToPath(agent.path)}
                                      className="p-1 rounded bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white transition cursor-pointer"
                                      title="Buka halaman Agen AI"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => moveAiAgent(agentIdx, 'up')}
                                      disabled={agentIdx === 0}
                                      className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white disabled:opacity-20 cursor-pointer transition"
                                      title="Naikkan urutan Agen AI"
                                    >
                                      <ArrowUp className="w-3 h-3" />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => moveAiAgent(agentIdx, 'down')}
                                      disabled={agentIdx === aiAgents.length - 1}
                                      className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white disabled:opacity-20 cursor-pointer transition"
                                      title="Turunkan urutan Agen AI"
                                    >
                                      <ArrowDown className="w-3 h-3" />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => toggleAiAgentVisibility(agent.id)}
                                      className={`p-1 rounded transition cursor-pointer ${
                                        isAgentVis
                                          ? 'text-emerald-400 hover:bg-emerald-500/10'
                                          : 'text-zinc-600 hover:text-zinc-400'
                                      }`}
                                      title={
                                        isAgentVis
                                          ? 'Tampil di Sidebar Agen AI (Klik untuk sembunyikan)'
                                          : 'Disembunyikan di Sidebar (Klik untuk tampilkan)'
                                      }
                                    >
                                      {isAgentVis ? (
                                        <Eye className="w-3.5 h-3.5" />
                                      ) : (
                                        <EyeOff className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right Column: Panel Live Preview (Interactive Mini-Sidebar Representation) */}
        {showLivePreview && (
          <div className="lg:col-span-4 space-y-3">
            <div className="sticky top-4 rounded-2xl bg-zinc-900 border border-zinc-800 p-4 shadow-2xl space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Live Preview Sidebar
                  </span>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                  REAL-TIME
                </span>
              </div>

              <p className="text-[11px] text-zinc-400">
                Berikut adalah susunan menu yang aktif di Sidebar kiri saat ini:
              </p>

              <div className="max-h-[600px] overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                {groups
                  .filter((g) => g.visible !== false)
                  .map((g) => {
                    const activeChildren = g.children.filter((c) => c.visible !== false);
                    const previewAiAgents =
                      g.id === 'ai' && isAiAgentsSectionVisible
                        ? aiAgents.filter((a) => a.visible !== false && !a.movedToGroupId)
                        : [];

                    return (
                      <div
                        key={g.id}
                        className="p-2 rounded-xl bg-zinc-950/70 border border-zinc-850 space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-xs font-bold text-zinc-200">
                          <span className="flex items-center gap-1.5 truncate">
                            <span className="text-blue-400 font-mono text-[10px]">
                              {g.letter}.
                            </span>
                            <span className="truncate">{g.customLabel || g.labelId}</span>
                          </span>
                          <span className="text-[9px] font-mono text-zinc-500">
                            {activeChildren.length + previewAiAgents.length}
                          </span>
                        </div>

                        {activeChildren.length > 0 && (
                          <div className="pl-3 space-y-0.5 border-l border-zinc-800">
                            {activeChildren.slice(0, 8).map((child) => (
                              <div
                                key={child.id}
                                onClick={() => navigateToPath(child.path)}
                                className="text-[10px] text-zinc-400 hover:text-white flex items-center justify-between truncate py-0.5 cursor-pointer"
                              >
                                <span className="truncate">{child.customLabel || child.labelId}</span>
                                {child.badge && (
                                  <span className="text-[8px] px-1 rounded bg-amber-500/20 text-amber-300">
                                    {child.badge}
                                  </span>
                                )}
                              </div>
                            ))}
                            {activeChildren.length > 8 && (
                              <div className="text-[9px] text-zinc-600 italic">
                                + {activeChildren.length - 8} sub-halaman lainnya
                              </div>
                            )}
                          </div>
                        )}

                        {previewAiAgents.length > 0 && (
                          <div className="pl-3 pt-1.5 mt-1 border-t border-zinc-800/80 space-y-1">
                            <div className="flex items-center justify-between text-[10px] font-bold text-purple-300">
                              <span className="flex items-center gap-1">
                                <Sparkles className="w-3 h-3 text-purple-400" />
                                <span>
                                  {aiAgentsSectionCustomLabel || 'Agen AI'} ({previewAiAgents.length})
                                </span>
                              </span>
                            </div>
                            <div className="pl-2 space-y-0.5 border-l border-purple-500/40">
                              {previewAiAgents.map((ag) => (
                                <div
                                  key={ag.id}
                                  onClick={() => navigateToPath(ag.path)}
                                  className="text-[10px] text-zinc-300 hover:text-white flex items-center justify-between truncate py-0.5 cursor-pointer"
                                >
                                  <span className="flex items-center gap-1.5 truncate">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                    <span className="truncate">{ag.displayName}</span>
                                  </span>
                                  <span className="text-[8px] font-mono text-zinc-500 shrink-0 ml-1">
                                    {ag.latency}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>

              <div className="pt-2 border-t border-zinc-800 text-[10px] text-zinc-500 text-center">
                Perubahan pada editor di sebelah kiri langsung merefleksikan Sidebar dan Live Preview ini.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Info Box */}
      <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-start gap-3 text-xs text-zinc-400">
        <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-bold text-white">Prinsip Sinkronisasi Real-Time &amp; AI Business Logic Engine RiskCart:</span>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Setiap halaman yang dibuat melalui <strong>AI Page Builder</strong> memiliki skema terstruktur di Firestore (<code>custom_pages</code> &amp; <code>settings/sidebar_menu</code>), mendukung pembacaan gambar Multimodal Vision (<code>inlineData</code>), kalkulasi rumus otomatis, penggabungan lintas koleksi (Auto-Join), serta penulisan balik dua arah (Two-Way Write Sync) ke POS, Client PWA, Inventory, dan Laporan Keuangan.
          </p>
        </div>
      </div>
    </div>
  );
};
