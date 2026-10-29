import React, { useState, useMemo, useEffect } from 'react';
import {
  Sparkles,
  Cpu,
  Layers,
  Send,
  Plus,
  Play,
  RotateCcw,
  CheckCircle,
  AlertTriangle,
  Database,
  BarChart3,
  Sliders,
  Copy,
  Check,
  Eye,
  FileCode,
  Layout,
  ExternalLink,
  Save,
  Tag,
  Zap,
} from 'lucide-react';
import { collection, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppData } from '../../context/AppDataContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  AIShortcutChipsBar,
  CHART_SHORTCUT_TAGS,
  ShortcutChartRenderer,
  extractChartShortcutsFromPrompt,
  RiskGaugeChart,
  SalesGridDashboardChart,
  TargetLineChart,
  SourceBarChart,
  ExecutiveOverviewChart,
  KategoriDonutChart,
  TopKategoriProgressList,
  GlowAreaChart,
  MultiColorBarChart,
  BurndownChart,
} from '../common/AIShortcutCharts';
import {
  GOOGLE_GEMINI_MODELS,
  DEFAULT_GOOGLE_GEMINI_MODEL,
  getGoogleGeminiModelInfo,
} from '../../services/aiInstructionStore';
import { saveAiCustomPageToMenu, getLocalMenuStructure } from '../../services/sidebarMenuService';

export const AIPageBuilderStudio: React.FC = () => {
  const { products, transactions, orders, customers } = useAppData();
  const { currencyMode } = useLanguage();

  const [activeTab, setActiveTab] = useState<'studio' | 'library' | 'saved_pages'>('studio');
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_GOOGLE_GEMINI_MODEL);
  const [promptInput, setPromptInput] = useState<string>(
    'Buat visualisasi performa penjualan shift kasir dengan #RiskGauge, #SalesGridDashboard, dan #TargetLineChart'
  );
  const [pageTitle, setPageTitle] = useState<string>('Executive Sales & Risk Control');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Active detected charts from current prompt or selection
  const activeDetectedTags = useMemo(() => {
    return extractChartShortcutsFromPrompt(promptInput);
  }, [promptInput]);

  // Selected tag in Library viewer
  const [selectedLibraryTag, setSelectedLibraryTag] = useState<string>('#RiskGauge');

  // Handle clicking a shortcut chip
  const handleSelectChip = (tag: string) => {
    if (!promptInput.includes(tag)) {
      setPromptInput((prev) => {
        const trimmed = prev.trim();
        return trimmed ? `${trimmed} ${tag}` : tag;
      });
    }
  };

  // Saved custom pages from Firestore
  const [savedPages, setSavedPages] = useState<any[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'custom_pages'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setSavedPages(list);
    });
    return () => unsub();
  }, []);

  const handleSaveToFirestore = async () => {
    const slug = pageTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `page-${Date.now().toString().slice(-4)}`;

    const pageSchema = {
      slug,
      title: pageTitle,
      parentGroupId: 'dashboard',
      icon: 'Layout',
      badge: 'AI VISUAL',
      modelUsed: selectedModel,
      tags: activeDetectedTags,
      prompt: promptInput,
      createdAt: new Date().toISOString(),
      customCollectionName: `ext_${slug}`,
    };

    try {
      await setDoc(doc(db, 'custom_pages', slug), pageSchema, { merge: true });
      const currentStruct = getLocalMenuStructure();
      await saveAiCustomPageToMenu(currentStruct, pageSchema as any);
      setSaveSuccess(`✓ Halaman "${pageTitle}" berhasil disimpan ke Firestore (custom_pages/${slug}) & Menu Navigasi!`);
      setTimeout(() => setSaveSuccess(null), 4000);
    } catch (err: any) {
      console.error('Failed to save custom page:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* =================================================================== */}
      {/* HEADER: Executive Dark Obsidian & Luxury Gold                       */}
      {/* =================================================================== */}
      <div className="rounded-3xl bg-[#080705] border-2 border-amber-500/35 p-6 shadow-[0_10px_35px_rgba(0,0,0,0.85)] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-amber-500/20 pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_#f59e0b]" />
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-wide">
                AI Page Builder &amp; Visual Chart Studio
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                10 #ShortcutTags Ready
              </span>
            </div>
            <p className="text-xs sm:text-sm text-zinc-400">
              Rancang dashboard kustom dan visual chart real-time dengan mengetik prompt cerdas atau klik chip pintas.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* View Switcher Tabs */}
            <div className="flex items-center p-1 rounded-xl bg-[#12100b] border border-amber-500/30 text-xs font-bold">
              <button
                type="button"
                onClick={() => setActiveTab('studio')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'studio'
                    ? 'bg-amber-400 text-zinc-950 font-black shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Studio Prompt</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('library')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'library'
                    ? 'bg-amber-400 text-zinc-950 font-black shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>10 Chart Library</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('saved_pages')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'saved_pages'
                    ? 'bg-amber-400 text-zinc-950 font-black shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                <span>Halaman Tersimpan ({savedPages.length})</span>
              </button>
            </div>

            {/* Model Selector */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#12100b] border border-amber-500/30 text-xs">
              <Cpu className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-transparent text-white font-bold text-xs focus:outline-none cursor-pointer"
              >
                {GOOGLE_GEMINI_MODELS.map((m) => (
                  <option key={m.id} value={m.id} className="bg-zinc-900 text-white">
                    {m.shortLabel}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* INTERACTIVE SHORTCUT CHIPS ROW (ABOVE PROMPT BOX)                   */}
        {/* =================================================================== */}
        <div className="pt-4">
          <AIShortcutChipsBar
            onSelectTag={handleSelectChip}
            selectedTags={activeDetectedTags}
          />
        </div>

        {/* Studio Prompt Form */}
        {activeTab === 'studio' && (
          <div className="pt-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="sm:col-span-1">
                <input
                  type="text"
                  value={pageTitle}
                  onChange={(e) => setPageTitle(e.target.value)}
                  placeholder="Judul Halaman / Dashboard..."
                  className="w-full bg-[#12100b] border border-amber-500/30 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 font-bold focus:outline-none focus:border-amber-400"
                />
              </div>
              <div className="sm:col-span-2">
                <input
                  type="text"
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  placeholder="Tuliskan instruksi AI dan sertakan #ShortcutTags (misal: #RiskGauge, #TargetLineChart)..."
                  className="w-full bg-[#12100b] border border-amber-500/30 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400 font-mono"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="font-semibold text-amber-300">
                  {activeDetectedTags.length > 0 ? (
                    <>✓ {activeDetectedTags.length} Chart Terdeteksi: {activeDetectedTags.join(', ')}</>
                  ) : (
                    <>Tip: Klik tombol chip di atas untuk menyematkan chart ke prompt.</>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveToFirestore}
                  className="px-4 py-2 rounded-xl bg-[#12100b] hover:bg-zinc-800 text-amber-300 hover:text-white border border-amber-500/40 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Simpan ke Firestore</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsGenerating(true);
                    setTimeout(() => setIsGenerating(false), 600);
                  }}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-zinc-950 font-black text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/20 cursor-pointer"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Render Live Preview</span>
                </button>
              </div>
            </div>

            {saveSuccess && (
              <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{saveSuccess}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* =================================================================== */}
      {/* TAB CONTENT 1: STUDIO LIVE PREVIEW                                 */}
      {/* =================================================================== */}
      {activeTab === 'studio' && (
        <div className="space-y-6">
          {activeDetectedTags.length === 0 ? (
            <div className="rounded-2xl bg-[#080705] border border-amber-500/25 p-8 text-center space-y-4 shadow-lg">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto text-xl">
                📊
              </div>
              <div className="space-y-1 max-w-lg mx-auto">
                <h3 className="text-base font-bold text-white">Belum Ada #ShortcutTag Dipilih</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Ketik nama tag di kotak prompt atau klik salah satu chip di baris atas untuk merender visual chart library secara instan.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                {CHART_SHORTCUT_TAGS.map((c) => (
                  <button
                    key={c.tag}
                    type="button"
                    onClick={() => handleSelectChip(c.tag)}
                    className="px-3 py-1.5 rounded-xl bg-[#12100b] hover:bg-amber-500/20 border border-amber-500/30 text-xs font-mono text-amber-300 transition cursor-pointer"
                  >
                    + {c.tag} ({c.title})
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>Preview Visual Chart Real-Time ({activeDetectedTags.length} Model Aktif)</span>
                </h2>
                <span className="text-xs font-mono text-zinc-400">
                  Data: Firestore Transaksi ({transactions.length}) • Produk ({products.length})
                </span>
              </div>

              {activeDetectedTags.map((tag) => (
                <ShortcutChartRenderer key={tag} tag={tag} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB CONTENT 2: 10 VISUAL CHART LIBRARY SHOWCASE                     */}
      {/* =================================================================== */}
      {activeTab === 'library' && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 overflow-x-auto pb-2 custom-scrollbar">
            {CHART_SHORTCUT_TAGS.map((c) => (
              <button
                key={c.tag}
                type="button"
                onClick={() => setSelectedLibraryTag(c.tag)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer flex items-center gap-2 shrink-0 border ${
                  selectedLibraryTag === c.tag
                    ? 'bg-amber-400 text-zinc-950 border-amber-300 font-black shadow-md'
                    : 'bg-[#080705] hover:bg-[#12100b] text-zinc-300 border-amber-500/30'
                }`}
              >
                <span>{c.icon}</span>
                <span>{c.tag}</span>
              </button>
            ))}
          </div>

          <div className="rounded-2xl bg-[#080705] border border-amber-500/35 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  Model: {selectedLibraryTag} — {CHART_SHORTCUT_TAGS.find((c) => c.tag === selectedLibraryTag)?.title}
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {CHART_SHORTCUT_TAGS.find((c) => c.tag === selectedLibraryTag)?.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleSelectChip(selectedLibraryTag)}
                className="px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <span>+ Sisipkan ke Prompt</span>
              </button>
            </div>

            <ShortcutChartRenderer tag={selectedLibraryTag} />
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB CONTENT 3: SAVED CUSTOM PAGES FROM FIRESTORE                    */}
      {/* =================================================================== */}
      {activeTab === 'saved_pages' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#080705] border border-amber-500/35 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-amber-400" />
                <span>Daftar Halaman Kustom Tersimpan di Firestore (custom_pages)</span>
              </h3>
              <span className="text-xs text-zinc-400 font-mono">{savedPages.length} Halaman</span>
            </div>

            {savedPages.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 text-xs">
                Belum ada halaman kustom tersimpan. Buat halaman baru pada tab "Studio Prompt" dan klik "Simpan ke Firestore".
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {savedPages.map((page) => (
                  <div
                    key={page.id}
                    className="p-4 rounded-xl bg-[#12100b] border border-amber-500/25 space-y-2 hover:border-amber-400 transition"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white truncate">{page.title || page.id}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        {page.slug || page.id}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 line-clamp-2">{page.prompt || 'Halaman kustom AI.'}</p>
                    <div className="flex items-center justify-between pt-2 border-t border-zinc-800 text-[10px] text-zinc-500 font-mono">
                      <span>Model: {page.modelUsed || 'gemini-2.5-flash'}</span>
                      <a
                        href={`/dashboard/custom/${page.slug || page.id}`}
                        className="text-amber-400 hover:underline flex items-center gap-1 font-bold"
                      >
                        <span>Buka Halaman</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
