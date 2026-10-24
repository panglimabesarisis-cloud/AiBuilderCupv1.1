import React, { useState, useEffect, useMemo } from 'react';
import {
  Brain,
  Sparkles,
  CheckCircle2,
  RotateCcw,
  Search,
  Edit,
  Eye,
  Plus,
  X,
  Check,
  ChevronRight,
  Database,
  ShieldCheck,
  Moon,
  Sun,
  Send,
  Cpu,
  Trash2,
  GripVertical,
  RefreshCw,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAppData } from '../../context/AppDataContext';
import { AppLink, useAppNavigation } from '../../router';
import {
  AIAgentInstructionConfig,
  GLOBAL_AI_STANDARD_RULES,
  GOOGLE_GEMINI_MODELS,
  DEFAULT_GOOGLE_GEMINI_MODEL,
  getGoogleGeminiModelInfo,
  loadAIAgentInstructions,
  saveAIAgentInstruction,
  updateAIAgentsOrder,
  deleteAIAgentInStore,
  createNewAIAgentInStore,
  resetAIAgentInstruction,
  resetAllAIAgentInstructions,
  findAgentInstructionConfig,
  getActiveAgentInstruction,
  getMasterAgentSlug,
} from '../../services/aiInstructionStore';
import {
  AILayoutToggleBar,
  AILayoutColumnMode,
  getDynamicLayoutGridClass,
} from '../common/AIShortcutCharts';

export interface KnowledgeEntry {
  id: string;
  title: string;
  category: string;
  content: string;
  lastUpdated: string;
}

export interface AIInstructionKnowledgePanelProps {
  agentKey?: string;
  agentTitle?: string;
  agentRole?: string;
  defaultInstruction?: string;
  defaultKnowledgeList?: KnowledgeEntry[];
  accentColor?: 'purple' | 'amber' | 'emerald' | 'rose' | 'blue' | 'indigo';
}

export const AIInstructionKnowledgePanel: React.FC<AIInstructionKnowledgePanelProps> = ({
  agentKey,
  agentTitle,
  agentRole,
  defaultInstruction,
}) => {
  const { language, tr } = useLanguage();
  const { navigateToPath } = useAppNavigation();
  const {
    products,
    transactions,
    orders,
    customers,
    formatMoney,
    refreshFirestore,
    defaultAiModel,
    setDefaultAiModel,
  } = useAppData();

  const [agents, setAgents] = useState<AIAgentInstructionConfig[]>(() =>
    loadAIAgentInstructions()
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [layoutMode, setLayoutMode] = useState<AILayoutColumnMode>('auto');
  const [tableTheme, setTableTheme] = useState<'dark' | 'light'>('dark');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const agentGridClass = getDynamicLayoutGridClass(layoutMode, searchQuery, 4);

  // Drag and drop ordering state
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Modal Edit Instruksi (Prompt Knowledge) & Pilihan Model AI Google
  const [editingAgent, setEditingAgent] = useState<AIAgentInstructionConfig | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editModelId, setEditModelId] = useState<string>(DEFAULT_GOOGLE_GEMINI_MODEL);
  const [editPromptKnowledge, setEditPromptKnowledge] = useState('');
  const [editModuleRoute, setEditModuleRoute] = useState('/dashboard');
  const [editModuleLabel, setEditModuleLabel] = useState('Dashboard Utama');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editSyncStatusLabel, setEditSyncStatusLabel] = useState('Firestore Synced');
  const [editGlobalRules, setEditGlobalRules] = useState(GLOBAL_AI_STANDARD_RULES);
  const [editConnectedDataSources, setEditConnectedDataSources] = useState('');
  const [editSlug, setEditSlug] = useState('');

  // Modal Tambah AI Agent Baru
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentDesc, setNewAgentDesc] = useState('');
  const [newAgentModelId, setNewAgentModelId] = useState<string>(DEFAULT_GOOGLE_GEMINI_MODEL);
  const [newAgentIcon, setNewAgentIcon] = useState('🤖');
  const [newAgentBadge, setNewAgentBadge] = useState('AI CUSTOM');
  const [newAgentPrompt, setNewAgentPrompt] = useState('');

  // Modal Uji / Eksekusi Langsung AI Agent dengan Data Firestore
  const [testingAgent, setTestingAgent] = useState<AIAgentInstructionConfig | null>(null);
  const [testQuery, setTestQuery] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [isRunningTest, setIsRunningTest] = useState(false);

  const isDark = tableTheme === 'dark';

  const isAllAgentsView =
    !agentKey ||
    agentKey === 'ai_agent' ||
    agentKey === 'ai-agent' ||
    agentKey === 'ai_knowledge' ||
    agentKey === 'ai-knowledge' ||
    agentKey === 'all' ||
    agentKey === 'ai_master';

  useEffect(() => {
    const refresh = () => {
      setAgents(loadAIAgentInstructions());
    };
    window.addEventListener('riskcart_ai_instructions_updated', refresh);
    return () => window.removeEventListener('riskcart_ai_instructions_updated', refresh);
  }, []);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  };

  const handleGlobalModelChange = async (nextModelId: string) => {
    await setDefaultAiModel(nextModelId, true);
    setAgents(loadAIAgentInstructions());
    const modelInfo = getGoogleGeminiModelInfo(nextModelId);
    showToast(
      `Model AI Google Default diubah ke ${modelInfo.shortLabel} (${modelInfo.id}) & disimpan ke Firestore!`
    );
  };

  // Hitung metrik aktual dari database Firestore (AppDataContext) untuk rekomendasi utama tiap kartu agen
  const liveEcosystemMetrics = useMemo(() => {
    const totalProducts = products.length;
    const criticalStockCount = products.filter(
      (p: any) => Number(p.stock ?? p.stockInUnits ?? p.totalStock ?? 0) <= Number(p.minStockAlert ?? 10)
    ).length;
    const totalUnitsInStock = products.reduce(
      (sum: number, p: any) => sum + Number(p.stock ?? p.stockInUnits ?? p.totalStock ?? 0),
      0
    );

    const completedTx = transactions.filter((t: any) => t.status !== 'cancelled' && t.status !== 'void');
    const totalRevenue = completedTx.reduce((sum: number, t: any) => sum + Number(t.totalAmount ?? 0), 0);
    const totalModal = completedTx.reduce((sum: number, t: any) => {
      if (Number(t.totalCost) > 0) return sum + Number(t.totalCost);
      const items = Array.isArray(t.items) ? t.items : [];
      return (
        sum +
        items.reduce((s: number, it: any) => {
          const qty = Number(it.quantity ?? it.qty ?? it.quantityOrdered ?? 1);
          const cost = Number(it.costPrice ?? it.buyPrice ?? it.modal ?? (Number(it.price || 0) * 0.75));
          return s + cost * qty;
        }, 0)
      );
    }, 0);
    const totalProfit = totalRevenue - totalModal;

    const highRiskTxCount = transactions.filter((t: any) => Number(t.fraudScore ?? 0) >= 40).length;
    const totalOrders = orders.length;
    const totalCustomers = customers.length;

    return {
      totalProducts,
      criticalStockCount,
      totalUnitsInStock,
      totalTx: transactions.length,
      totalRevenue,
      totalModal,
      totalProfit,
      highRiskTxCount,
      totalOrders,
      totalCustomers,
    };
  }, [products, transactions, orders, customers]);

  const getAgentLiveRecommendation = (agent: AIAgentInstructionConfig): string => {
    switch (agent.slug) {
      case 'ai-advisor-purchase':
        return liveEcosystemMetrics.criticalStockCount > 0
          ? `${liveEcosystemMetrics.criticalStockCount} SKU Stok Kritis (< 7 Hari) • Wajib PO`
          : `${liveEcosystemMetrics.totalProducts} SKU Terpantau • Stok Aman`;
      case 'strategic-restock-advisor':
        return `Total Stok Sistem: ${liveEcosystemMetrics.totalUnitsInStock.toLocaleString('id-ID')} Unit (${liveEcosystemMetrics.totalProducts} Produk)`;
      case 'loss-prevention':
        return `${liveEcosystemMetrics.totalTx} Transaksi • Laba: ${formatMoney(liveEcosystemMetrics.totalProfit)}`;
      case 'anti-fraud-sentinel':
        return liveEcosystemMetrics.highRiskTxCount > 0
          ? `${liveEcosystemMetrics.highRiskTxCount} Transaksi Perlu Audit Forensik`
          : `${liveEcosystemMetrics.totalTx} Transaksi Terverifikasi Bersih`;
      case 'dynamic-pricing':
        return `Omset: ${formatMoney(liveEcosystemMetrics.totalRevenue)} • Modal: ${formatMoney(liveEcosystemMetrics.totalModal)}`;
      case 'staff-kpi':
        return `${liveEcosystemMetrics.totalTx} Aktivitas Kasir & Kepatuhan Shift Aktif`;
      case 'order-intent-parser':
        return `${liveEcosystemMetrics.totalOrders} Order PWA & ${liveEcosystemMetrics.totalProducts} Katalog SKU`;
      case 'business-copilot':
        return `Sinkronisasi Penuh: ${liveEcosystemMetrics.totalProducts} Produk & ${liveEcosystemMetrics.totalTx} Transaksi`;
      case 'customer-retention':
        return `${liveEcosystemMetrics.totalCustomers} Pelanggan Terdaftar di Database CRM`;
      case 'supplier-anomaly':
        return `Monitoring HPP & Lead Time ${liveEcosystemMetrics.totalProducts} SKU Produk`;
      case 'scanner-ai':
        return `Siap Scan Barcode & Voice (${liveEcosystemMetrics.totalProducts} SKU Aktif)`;
      default:
        return `Terhubung ke Firestore (${liveEcosystemMetrics.totalProducts} Produk, ${liveEcosystemMetrics.totalTx} Transaksi)`;
    }
  };

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIdx !== index) {
      setDragOverIdx(index);
    }
  };

  const handleDragEnter = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIdx(index);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIdx = draggedIdx;
    setDraggedIdx(null);
    setDragOverIdx(null);
    if (sourceIdx === null || sourceIdx === targetIndex) return;

    const reordered = [...agents];
    const [moved] = reordered.splice(sourceIdx, 1);
    reordered.splice(targetIndex, 0, moved);

    setAgents(reordered);
    await updateAIAgentsOrder(reordered);
    showToast(
      tr(
        'AI Agent order updated and saved to Firestore!',
        'Urutan AI Agent berhasil diperbarui dan disimpan ke Firestore!'
      )
    );
  };

  const handleDeleteAgent = async (agent: AIAgentInstructionConfig) => {
    const agentName = language === 'id' ? agent.nameId : agent.nameEn;
    const confirmed = window.confirm(
      `Apakah Anda yakin ingin menghapus AI Agent "${agentName}" dari database RiskCart dan sidebar?`
    );
    if (!confirmed) return;

    setIsSaving(true);
    try {
      const updated = await deleteAIAgentInStore(agent.slug || agent.id);
      setAgents(updated);
      if (editingAgent && (editingAgent.id === agent.id || editingAgent.slug === agent.slug)) {
        setEditingAgent(null);
      }
      showToast(`AI Agent "${agentName}" berhasil dihapus dari database!`);
    } finally {
      setIsSaving(false);
    }
  };

  const openEditModal = (agent: AIAgentInstructionConfig) => {
    setEditingAgent(agent);
    setEditName(language === 'id' ? agent.nameId : agent.nameEn);
    setEditDescription(language === 'id' ? agent.roleId : agent.roleEn);
    setEditModelId(agent.modelId || defaultAiModel || DEFAULT_GOOGLE_GEMINI_MODEL);
    const currentPrompt =
      agent.customInstruction && agent.customInstruction.trim().length > 0
        ? agent.customInstruction
        : agent.defaultInstruction;
    setEditPromptKnowledge(currentPrompt);
    setEditModuleRoute(agent.moduleRoute || '/dashboard');
    setEditModuleLabel(agent.moduleLabel || 'Dashboard RiskCart');
    setEditIsActive(agent.isActive !== false);
    setEditSyncStatusLabel(agent.syncStatusLabel || 'Firestore Synced');
    setEditGlobalRules(agent.globalRules || GLOBAL_AI_STANDARD_RULES);
    setEditConnectedDataSources(
      agent.connectedDataSources ||
        `${liveEcosystemMetrics.totalProducts} Produk, ${liveEcosystemMetrics.totalTx} Transaksi POS, ${liveEcosystemMetrics.totalOrders} Orders PWA`
    );
    setEditSlug(agent.slug || '');
  };

  const handleSaveEditModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAgent) return;
    setIsSaving(true);
    try {
      const updated = await saveAIAgentInstruction(editingAgent.slug, editPromptKnowledge, {
        nameId: editName,
        roleId: editDescription,
        modelId: editModelId,
        moduleRoute: editModuleRoute,
        moduleLabel: editModuleLabel,
        isActive: editIsActive,
        syncStatusLabel: editSyncStatusLabel,
        globalRules: editGlobalRules,
        connectedDataSources: editConnectedDataSources,
        newSlug: editSlug,
      });
      setAgents(updated);
      const selectedModelInfo = getGoogleGeminiModelInfo(editModelId);
      setEditingAgent(null);
      showToast(
        tr(
          `Saved "${editName}" with ${selectedModelInfo.shortLabel} to Firestore!`,
          `Pengaturan "${editName}" (${selectedModelInfo.shortLabel}) berhasil disimpan ke Database Firestore!`
        )
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetInsideModal = async () => {
    if (!editingAgent) return;
    setEditPromptKnowledge(editingAgent.defaultInstruction);
    setEditName(editingAgent.nameId);
    setEditDescription(editingAgent.roleId);
    setEditModelId(editingAgent.modelId || DEFAULT_GOOGLE_GEMINI_MODEL);
    const updated = await resetAIAgentInstruction(editingAgent.slug);
    setAgents(updated);
    showToast(
      tr(
        'Instruction restored to default template.',
        'Instruksi dikembalikan ke Prompt Knowledge bawaan.'
      )
    );
  };

  const handleResetAll = async () => {
    const updated = await resetAllAIAgentInstructions();
    setAgents(updated);
    showToast(
      tr(
        'All AI Agent instructions and models reset to defaults.',
        'Seluruh instruksi & model AI Agent dikembalikan ke bawaan.'
      )
    );
  };

  const handleCreateNewAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName.trim()) return;
    setIsSaving(true);
    try {
      const defaultPromptText =
        newAgentPrompt.trim() ||
        `[${newAgentName.trim().toUpperCase()}]\nTugas Utama:\n1. Sebelum memberikan informasi, wajib cek data aktual dari database Firestore dan cocokkan dengan halaman modul yang dikerjakan.\n2. Analisis data transaksi POS, pesanan Client PWA, produk, dan stok secara deterministik.`;
      const updated = await createNewAIAgentInStore({
        name: newAgentName,
        description: newAgentDesc,
        promptKnowledge: defaultPromptText,
        modelId: newAgentModelId,
        icon: newAgentIcon,
        badgeText: newAgentBadge,
      });
      setAgents(updated);
      setIsAddModalOpen(false);
      setNewAgentName('');
      setNewAgentDesc('');
      setNewAgentPrompt('');
      showToast(`AI Agent "${newAgentName}" (${newAgentModelId}) berhasil disimpan ke Firestore!`);
    } finally {
      setIsSaving(false);
    }
  };

  const openTestModal = (agent: AIAgentInstructionConfig) => {
    setTestingAgent(agent);
    setTestQuery(
      `Analisis kondisi aktual toko saat ini berdasarkan modul ${agent.moduleLabel} dan berikan rekomendasi utama.`
    );
    setTestOutput('');
  };

  const handleRunLiveAgentTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testingAgent || !testQuery.trim() || isRunningTest) return;
    setIsRunningTest(true);
    setTestOutput('');

    const systemPrompt = getActiveAgentInstruction(testingAgent.slug);
    const activeModelId = testingAgent.modelId || defaultAiModel || DEFAULT_GOOGLE_GEMINI_MODEL;
    const liveStoreSnapshot = {
      timestamp: new Date().toISOString(),
      targetModule: testingAgent.moduleRoute,
      selectedGeminiModel: activeModelId,
      summaryMetrics: {
        totalProducts: liveEcosystemMetrics.totalProducts,
        criticalStockProducts: liveEcosystemMetrics.criticalStockCount,
        totalUnitsInStock: liveEcosystemMetrics.totalUnitsInStock,
        totalTransactionsPOS: liveEcosystemMetrics.totalTx,
        totalOrdersPWA: liveEcosystemMetrics.totalOrders,
        totalCustomersCRM: liveEcosystemMetrics.totalCustomers,
        totalRevenue: formatMoney(liveEcosystemMetrics.totalRevenue),
        totalModalHPP: formatMoney(liveEcosystemMetrics.totalModal),
        totalGrossProfit: formatMoney(liveEcosystemMetrics.totalProfit),
        highRiskTransactions: liveEcosystemMetrics.highRiskTxCount,
      },
      sampleProducts: products.slice(0, 12).map((p: any) => ({
        name: p.name,
        sku: p.sku || p.id,
        category: p.category,
        stockUnits: Number(p.stock ?? p.stockInUnits ?? p.totalStock ?? 0),
        isiPerDus: Number(p.isiPerDus ?? p.piecesPerCarton ?? 1),
        totalBeratKg: Number(p.totalBeratKg ?? 0),
        costPrice: Number(p.costPrice ?? 0),
        sellPrice: Number(p.pricePerUnit ?? p.sellPrice ?? 0),
      })),
      recentTransactions: transactions.slice(0, 8).map((t: any) => ({
        id: t.id,
        customer: t.customerName,
        totalAmount: t.totalAmount,
        totalCost: t.totalCost,
        status: t.status,
        channel: t.channel,
        fraudScore: t.fraudScore,
      })),
      recentOrdersPWA: orders.slice(0, 6).map((o: any) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        totalAmount: o.totalAmount,
        status: o.status,
      })),
    };

    try {
      const res = await fetch('/api/ai/agent-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentKey: testingAgent.slug,
          agentName: testingAgent.nameId,
          systemPrompt,
          query: `DATA AKTUAL FIRESTORE RISKCART (POS & CLIENT PWA):\n${JSON.stringify(liveStoreSnapshot, null, 2)}\n\nPERTANYAAN / INSTRUKSI EKSEKUSI:\n${testQuery}`,
          model: activeModelId,
          modelId: activeModelId,
          language,
        }),
      });
      const data = await res.json();
      setTestOutput(
        data.text ||
          `[${testingAgent.nameId} • ${activeModelId}] Analisis selesai berdasarkan ${liveEcosystemMetrics.totalProducts} produk & ${liveEcosystemMetrics.totalTx} transaksi di Firestore.`
      );
    } catch (err: any) {
      setTestOutput(
        `Hasil Analisis Deterministik (${testingAgent.nameId} • ${activeModelId}):\n• Modul Acuan: ${testingAgent.moduleLabel} (${testingAgent.moduleRoute})\n• Produk Terdaftar: ${liveEcosystemMetrics.totalProducts} SKU (${liveEcosystemMetrics.criticalStockCount} SKU Stok Kritis)\n• Total Transaksi: ${liveEcosystemMetrics.totalTx} Struk | Omset: ${formatMoney(liveEcosystemMetrics.totalRevenue)} | Modal: ${formatMoney(liveEcosystemMetrics.totalModal)} | Keuntungan: ${formatMoney(liveEcosystemMetrics.totalProfit)}\n• Rekomendasi: ${getAgentLiveRecommendation(testingAgent)}`
      );
    } finally {
      setIsRunningTest(false);
    }
  };

  const displayedAgents = useMemo(() => {
    if (!isAllAgentsView && agentKey) {
      const found = findAgentInstructionConfig(agentKey);
      if (found) return [found];
      const fallbackConfig: AIAgentInstructionConfig = {
        id: agentKey,
        slug: agentKey,
        nameId: agentTitle || 'AI Agent RiskCart',
        nameEn: agentTitle || 'RiskCart AI Agent',
        roleId: agentRole || 'Agen cerdas terhubung ekosistem POS & PWA RiskCart.',
        roleEn: agentRole || 'Intelligent agent connected to POS & PWA ecosystem.',
        icon: '🤖',
        color: 'from-purple-600/20 to-indigo-600/20',
        border: 'border-purple-500/30',
        badgeText: 'AI AGENT',
        moduleRoute: '/dashboard',
        moduleLabel: 'Dashboard RiskCart',
        modelId: defaultAiModel || DEFAULT_GOOGLE_GEMINI_MODEL,
        isActive: true,
        defaultInstruction: defaultInstruction || GLOBAL_AI_STANDARD_RULES,
        customInstruction: '',
        updatedAt: new Date().toISOString(),
      };
      return [fallbackConfig];
    }

    const q = searchQuery.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.nameId.toLowerCase().includes(q) ||
        a.nameEn.toLowerCase().includes(q) ||
        a.roleId.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q) ||
        a.badgeText.toLowerCase().includes(q) ||
        a.moduleLabel.toLowerCase().includes(q) ||
        (a.modelId || '').toLowerCase().includes(q)
    );
  }, [agents, isAllAgentsView, agentKey, agentTitle, agentRole, defaultInstruction, searchQuery, defaultAiModel]);

  // Render Edit Modal & Test Modal (shared between single-agent card and full /dashboard/ai-agent grid)
  const renderModals = () => (
    <>
      {/* ========================================================================= */}
      {/* MODAL EDIT INSTRUKSI AI AGENT (NAMA, DESKRIPSI, MODEL GOOGLE AI, PROMPT)  */}
      {/* ========================================================================= */}
      {editingAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div
            className={`w-full max-w-2xl rounded-2xl border p-6 shadow-2xl space-y-4 text-xs max-h-[92vh] overflow-y-auto custom-scrollbar ${
              isDark
                ? 'bg-zinc-900 border-zinc-800 text-zinc-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div
              className={`flex items-center justify-between border-b pb-3 ${
                isDark ? 'border-zinc-800' : 'border-slate-100'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">{editingAgent.icon}</span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold">
                      {tr('Edit AI Agent & Google Gemini Model', 'Edit Instruksi & Model AI Agent')}
                    </h3>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono">
                      {editingAgent.badgeText}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border font-mono ${
                        getGoogleGeminiModelInfo(editModelId).badgeColor
                      }`}
                    >
                      {getGoogleGeminiModelInfo(editModelId).shortLabel}
                    </span>
                  </div>
                  <p className={`text-[11px] mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                    Pengaturan Model AI Google &amp; Prompt Knowledge otomatis tersimpan ke koleksi Firestore{' '}
                    <code className="text-purple-400 font-mono">ai_agents</code> &amp;{' '}
                    <code className="text-purple-400 font-mono">ai_instructions</code> secara real-time.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingAgent(null)}
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  isDark
                    ? 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                    : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditModal} className="space-y-4">
              {/* 1. Field Nama Agen & Modul Acuan */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    className={`block text-[11px] font-bold mb-1 ${
                      isDark ? 'text-zinc-300' : 'text-slate-700'
                    }`}
                  >
                    Nama Agen *
                  </label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className={`w-full px-3 py-2 rounded-xl border transition focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-950 text-zinc-100'
                        : 'border-slate-200 bg-slate-50 text-slate-800'
                    }`}
                  />
                </div>

                <div>
                  <label
                    className={`block text-[11px] font-bold mb-1 ${
                      isDark ? 'text-zinc-300' : 'text-slate-700'
                    }`}
                  >
                    Halaman Modul Acuan (Sinkronisasi Data)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <input
                        type="text"
                        list="module-routes-list"
                        value={editModuleRoute}
                        onChange={(e) => setEditModuleRoute(e.target.value)}
                        placeholder="Route URL (/dashboard/...)"
                        className={`w-full px-3 py-2 rounded-xl border font-mono text-[11px] transition focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                          isDark
                            ? 'border-zinc-700 bg-zinc-950 text-emerald-400 placeholder:text-zinc-600'
                            : 'border-slate-200 bg-slate-50 text-emerald-700 placeholder:text-slate-400'
                        }`}
                      />
                      <datalist id="module-routes-list">
                        <option value="/dashboard/pembelian">Modul Pembelian &amp; PO</option>
                        <option value="/dashboard/produk">Modul Produk &amp; Stok</option>
                        <option value="/dashboard/transaksi">Modul Transaksi POS</option>
                        <option value="/dashboard/orders">Modul Orders &amp; Client PWA</option>
                        <option value="/dashboard/staff">Modul Staff &amp; Shift Kasir</option>
                        <option value="/dashboard/financial">Modul Keuangan &amp; Neraca</option>
                        <option value="/dashboard/laporan">Modul Laporan &amp; Analitik</option>
                        <option value="/dashboard/pelanggan">Modul CRM &amp; Pelanggan</option>
                        <option value="/dashboard/supplier">Modul Supplier &amp; Vendor</option>
                        <option value="/dashboard">Dashboard Utama RiskCart</option>
                      </datalist>
                    </div>
                    <div>
                      <input
                        type="text"
                        value={editModuleLabel}
                        onChange={(e) => setEditModuleLabel(e.target.value)}
                        placeholder="Label Modul (misal: Modul Pembelian)"
                        className={`w-full px-3 py-2 rounded-xl border text-[11px] font-medium transition focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                          isDark
                            ? 'border-zinc-700 bg-zinc-950 text-zinc-100 placeholder:text-zinc-600'
                            : 'border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Deskripsi Singkat */}
              <div>
                <label
                  className={`block text-[11px] font-bold mb-1 ${
                    isDark ? 'text-zinc-300' : 'text-slate-700'
                  }`}
                >
                  Deskripsi *
                </label>
                <input
                  type="text"
                  required
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl border transition focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                    isDark
                      ? 'border-zinc-700 bg-zinc-950 text-zinc-100'
                      : 'border-slate-200 bg-slate-50 text-slate-800'
                  }`}
                />
              </div>

              {/* 2. Dropdown Pilih Agen AI (AI dari Google) */}
              <div
                className={`p-3.5 rounded-xl border space-y-2 ${
                  isDark
                    ? 'bg-blue-950/25 border-blue-500/30'
                    : 'bg-blue-50 border-blue-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <label
                    className={`block text-[11px] font-bold flex items-center gap-1.5 ${
                      isDark ? 'text-blue-200' : 'text-blue-900'
                    }`}
                  >
                    <Cpu className="w-4 h-4 text-blue-400 shrink-0" />
                    <span>Pilih Agen AI (AI dari Google) *</span>
                  </label>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold">
                    SDK @google/genai
                  </span>
                </div>

                <select
                  value={editModelId}
                  onChange={(e) => setEditModelId(e.target.value)}
                  className={`w-full px-3 py-2.5 rounded-xl border font-semibold text-xs transition focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer ${
                    isDark
                      ? 'border-zinc-700 bg-zinc-950 text-white'
                      : 'border-slate-300 bg-white text-slate-900'
                  }`}
                >
                  {GOOGLE_GEMINI_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullLabel}
                    </option>
                  ))}
                </select>

                <p className={`text-[11px] ${isDark ? 'text-zinc-400' : 'text-slate-600'}`}>
                  Model aktif: <strong className="text-blue-400 font-mono">{editModelId}</strong> —{' '}
                  {getGoogleGeminiModelInfo(editModelId).descriptionId}
                </p>
              </div>

              {/* Aturan Standar Global (System Instruction) — BISA DIEDIT OLEH USER */}
              <div
                className={`p-3.5 rounded-xl border space-y-2 ${
                  isDark
                    ? 'bg-purple-950/25 border-purple-500/30 text-purple-200'
                    : 'bg-purple-50 border-purple-200 text-purple-900'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-[11px] flex items-center gap-1.5 text-purple-300">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Aturan Standar Global (Otomatis Diterapkan ke Semua Agen)</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditGlobalRules(GLOBAL_AI_STANDARD_RULES)}
                      className="text-[10px] text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 cursor-pointer transition"
                      title="Kembalikan aturan standar global ke format baku"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>Reset Aturan Global</span>
                    </button>
                    <input
                      type="text"
                      value={editSyncStatusLabel}
                      onChange={(e) => setEditSyncStatusLabel(e.target.value)}
                      title="Edit label status sinkronisasi Firestore"
                      placeholder="Status Sync..."
                      className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40 focus:outline-none focus:ring-1 focus:ring-emerald-400 w-32 text-center"
                    />
                  </div>
                </div>
                <textarea
                  rows={5}
                  value={editGlobalRules}
                  onChange={(e) => setEditGlobalRules(e.target.value)}
                  placeholder="Tulis aturan standar global yang otomatis diterapkan ke semua agen di sini..."
                  className="w-full p-2.5 rounded-xl border border-purple-500/30 bg-zinc-950 font-mono text-[10px] leading-relaxed text-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-500 custom-scrollbar"
                />
              </div>

              {/* 3. Textarea Kolom Instruksi (Prompt Knowledge) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    className={`block text-[11px] font-bold ${
                      isDark ? 'text-zinc-200' : 'text-slate-800'
                    }`}
                  >
                    Kolom Instruksi (Prompt Knowledge) *
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleResetInsideModal()}
                    className="text-[11px] text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset ke Default</span>
                  </button>
                </div>
                <textarea
                  rows={7}
                  required
                  value={editPromptKnowledge}
                  onChange={(e) => setEditPromptKnowledge(e.target.value)}
                  placeholder="Tulis instruksi spesifik dan aturan kerja agen AI di sini..."
                  className={`w-full p-3.5 rounded-xl border font-mono text-xs leading-relaxed transition focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                    isDark
                      ? 'border-zinc-700 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500'
                      : 'border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400'
                  }`}
                />
              </div>

              {/* Live Database Context Verification & Connected Data Sources — BISA DIEDIT */}
              <div
                className={`p-3.5 rounded-xl border space-y-2 text-[11px] ${
                  isDark
                    ? 'bg-zinc-950/90 border-zinc-800 text-zinc-300'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="font-bold text-[11px] flex items-center gap-1.5 text-zinc-200">
                    <Database className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Sumber Data Aktual Terhubung (Database Firestore):</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const autoCalculated = `${liveEcosystemMetrics.totalProducts} Produk, ${liveEcosystemMetrics.totalTx} Transaksi POS, ${liveEcosystemMetrics.totalOrders} Orders PWA, ${liveEcosystemMetrics.totalCustomers} Pelanggan CRM, Omset ${formatMoney(liveEcosystemMetrics.totalRevenue)}`;
                      setEditConnectedDataSources(autoCalculated);
                      showToast('Sumber data berhasil dihitung ulang otomatis dari Firestore!');
                    }}
                    className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1 cursor-pointer bg-emerald-500/15 hover:bg-emerald-500/25 px-2 py-0.5 rounded-lg border border-emerald-500/30 transition"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>🔄 Hitung Ulang Otomatis dari Database</span>
                  </button>
                </div>

                <textarea
                  rows={2}
                  value={editConnectedDataSources}
                  onChange={(e) => setEditConnectedDataSources(e.target.value)}
                  placeholder="Contoh: 21 Produk, 1 Transaksi POS, 1 Orders PWA, Laporan Kas Toko, Supplier Anomali"
                  className="w-full px-3 py-1.5 rounded-xl border border-zinc-700 bg-zinc-900 text-emerald-300 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />

                <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-zinc-800/80">
                  <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                    <span className="text-[10px] text-zinc-400 font-bold shrink-0">Slug URL:</span>
                    <input
                      type="text"
                      value={editSlug}
                      onChange={(e) =>
                        setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))
                      }
                      placeholder="slug-agen"
                      className="px-2 py-1 rounded-lg border border-zinc-700 bg-zinc-900 text-amber-300 font-mono text-[11px] w-full focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </div>
                  <span className="font-mono text-[10px] text-zinc-500">
                    Model Aktif: <strong className="text-blue-400 font-mono">{editModelId}</strong>
                  </span>
                </div>
              </div>

              {/* 4. Footer: Tombol Hapus Agen (Merah) & Tombol Batal/Simpan */}
              <div
                className={`flex items-center justify-between gap-2 pt-3 border-t ${
                  isDark ? 'border-zinc-800' : 'border-slate-100'
                }`}
              >
                <button
                  type="button"
                  onClick={() => void handleDeleteAgent(editingAgent)}
                  disabled={isSaving}
                  className="px-3.5 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 font-bold flex items-center gap-1.5 transition cursor-pointer text-xs disabled:opacity-50"
                  title="Hapus Agen AI ini secara permanen dari database RiskCart dan Sidebar"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>Hapus Agen</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingAgent(null)}
                    className={`px-4 py-2 rounded-xl font-bold transition cursor-pointer ${
                      isDark
                        ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold shadow-md shadow-purple-500/20 cursor-pointer flex items-center gap-1.5"
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                    <span>{isSaving ? 'Menyimpan...' : '✓ Simpan ke Database'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL TAMBAH AI AGENT BARU                                                */}
      {/* ========================================================================= */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div
            className={`w-full max-w-lg rounded-2xl border p-6 shadow-2xl space-y-4 text-xs ${
              isDark
                ? 'bg-zinc-900 border-zinc-800 text-zinc-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Brain className="w-5 h-5 text-purple-400" />
                <span>Tambah AI Agent Assistant Baru</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNewAgent} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-[11px] font-bold mb-1">Nama Agen *</label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: AI Audit Kasir & Pajak"
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold mb-1">Icon &amp; Badge</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={newAgentIcon}
                      onChange={(e) => setNewAgentIcon(e.target.value)}
                      className="w-12 text-center px-2 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-white"
                    />
                    <input
                      type="text"
                      value={newAgentBadge}
                      onChange={(e) => setNewAgentBadge(e.target.value)}
                      className="flex-1 px-2 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-white font-mono text-[10px]"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-1">Deskripsi *</label>
                <input
                  type="text"
                  required
                  placeholder="Jelaskan tugas utama agen AI ini..."
                  value={newAgentDesc}
                  onChange={(e) => setNewAgentDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-1">
                  Pilih Agen AI (AI dari Google) *
                </label>
                <select
                  value={newAgentModelId}
                  onChange={(e) => setNewAgentModelId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-white text-xs font-semibold cursor-pointer"
                >
                  {GOOGLE_GEMINI_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullLabel}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-1">
                  Kolom Instruksi (Prompt Knowledge) *
                </label>
                <textarea
                  rows={5}
                  required
                  placeholder="Tulis instruksi Prompt Knowledge agen AI..."
                  value={newAgentPrompt}
                  onChange={(e) => setNewAgentPrompt(e.target.value)}
                  className="w-full p-3 rounded-xl border border-zinc-700 bg-zinc-950 text-white font-mono text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Simpan ke Database</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL UJI & EKSEKUSI AGEN AI (BACA DATA AKTUAL FIRESTORE)                 */}
      {/* ========================================================================= */}
      {testingAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div
            className={`w-full max-w-xl rounded-2xl border p-6 shadow-2xl space-y-4 text-xs ${
              isDark
                ? 'bg-zinc-900 border-zinc-800 text-zinc-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">{testingAgent.icon}</span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-white">{testingAgent.nameId}</h3>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border font-mono ${
                        getGoogleGeminiModelInfo(testingAgent.modelId).badgeColor
                      }`}
                    >
                      {getGoogleGeminiModelInfo(testingAgent.modelId).shortLabel}
                    </span>
                  </div>
                  <span className="text-[11px] text-emerald-400 font-mono">
                    Sinkronisasi Modul: {testingAgent.moduleLabel} ({testingAgent.moduleRoute})
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTestingAgent(null)}
                className="p-1 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
              <div className="text-[10px] font-bold uppercase text-purple-400">
                Indikator Rekomendasi Utama (Live Database POS &amp; PWA):
              </div>
              <div className="text-xs font-bold text-white">
                {getAgentLiveRecommendation(testingAgent)}
              </div>
            </div>

            <form onSubmit={handleRunLiveAgentTest} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                  Instruksi Analisis / Pertanyaan ke Agen AI ({getGoogleGeminiModelInfo(testingAgent.modelId).shortLabel}):
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={testQuery}
                    onChange={(e) => setTestQuery(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-white text-xs"
                  />
                  <button
                    type="submit"
                    disabled={isRunningTest}
                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold cursor-pointer flex items-center gap-1.5 shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isRunningTest ? 'Menganalisis...' : 'Jalankan AI'}</span>
                  </button>
                </div>
              </div>
            </form>

            {testOutput && (
              <div className="overflow-x-auto rounded-xl border border-emerald-500/30 bg-zinc-950 max-h-60 overflow-y-auto custom-scrollbar">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-zinc-900 text-zinc-400 uppercase text-[10px] border-b border-zinc-800 sticky top-0">
                    <tr>
                      <th className="p-2.5 w-36">Agen AI</th>
                      <th className="p-2.5 w-32">Model</th>
                      <th className="p-2.5">Hasil Analisa AI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 text-zinc-200">
                    <tr className="align-top">
                      <td className="p-2.5 font-bold text-amber-300">
                        {testingAgent.icon} {testingAgent.nameId}
                      </td>
                      <td className="p-2.5 font-mono text-[10px] text-blue-300">
                        {testingAgent.modelId || defaultAiModel}
                      </td>
                      <td className="p-2.5 whitespace-pre-wrap leading-relaxed font-mono text-[11px]">
                        {testOutput}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  const target = testingAgent;
                  setTestingAgent(null);
                  openEditModal(target);
                }}
                className="px-3.5 py-2 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 font-bold cursor-pointer flex items-center gap-1.5"
              >
                <Edit className="w-3.5 h-3.5" />
                <span>Edit Model &amp; Prompt Knowledge</span>
              </button>
              <button
                type="button"
                onClick={() => setTestingAgent(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Jika dipanggil di dalam sub-halaman spesifik 1 agen (misal di dalam tab AI Advisor Purchase / Tanya AI),
  // tampilkan card ringkas yang juga menampilkan Badge Model Google AI aktif & tombol Icon Edit (TANPA menampilkan Prompt Knowledge di depan card)!
  if (!isAllAgentsView && displayedAgents.length === 1) {
    const singleAgent = displayedAgents[0];
    const isCustomized =
      Boolean(singleAgent.customInstruction && singleAgent.customInstruction.trim().length > 0) &&
      singleAgent.customInstruction.trim() !== singleAgent.defaultInstruction.trim();
    const modelInfo = getGoogleGeminiModelInfo(singleAgent.modelId || defaultAiModel);

    return (
      <div className="space-y-3">
        {toastMsg && (
          <div className="fixed bottom-6 right-6 z-50 bg-zinc-900 border border-emerald-500/50 text-emerald-300 px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-bold animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{toastMsg}</span>
          </div>
        )}

        <div
          className={`p-4 rounded-xl border bg-gradient-to-br ${singleAgent.color} ${singleAgent.border} flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition`}
        >
          <div className="flex items-start gap-3">
            <span className="text-2xl mt-0.5">{singleAgent.icon}</span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-white text-sm">
                  {language === 'id' ? singleAgent.nameId : singleAgent.nameEn}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-white font-mono">
                  {singleAgent.badgeText}
                </span>
                <span
                  className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border font-mono flex items-center gap-1 ${modelInfo.badgeColor}`}
                >
                  <Cpu className="w-3 h-3" />
                  <span>{modelInfo.shortLabel}</span>
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {isCustomized ? 'CUSTOM PROMPT AKTIF' : 'AKTIF • FIRESTORE SYNC'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-300 mt-1">
                {language === 'id' ? singleAgent.roleId : singleAgent.roleEn}
              </p>
              <div className="text-[11px] text-emerald-300 font-semibold mt-1">
                Status Data: {getAgentLiveRecommendation(singleAgent)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleDeleteAgent(singleAgent)}
              title="Hapus Agen AI ini dari database"
              className="px-3.5 py-2 rounded-xl bg-black/40 hover:bg-rose-600 text-rose-300 hover:text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border border-white/10"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Hapus Agen</span>
            </button>
            <button
              type="button"
              onClick={() => openEditModal(singleAgent)}
              title="Edit Model Google AI & Prompt Knowledge"
              className="px-3.5 py-2 rounded-xl bg-black/40 hover:bg-amber-600 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border border-white/10"
            >
              <Edit className="w-3.5 h-3.5" />
              <span>Edit Model &amp; Instruksi AI</span>
            </button>
          </div>
        </div>

        {renderModals()}
      </div>
    );
  }

  // ============================================================================
  // TAMPILAN UTAMA HALAMAN /dashboard/ai-agent (MENYERUPAI /dashboard/kategori-produk)
  // ============================================================================
  return (
    <div className="w-full max-w-none px-4 space-y-4 font-sans select-none pb-12 animate-in fade-in">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-zinc-900 border border-emerald-500/50 text-emerald-200 px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* TOP PAGE HEADER BOX — Judul Halaman: Ai Agent Assistant + Dropdown Global Model AI Google */}
      <div
        className={`rounded-2xl p-5 border shadow-sm flex flex-col gap-4 transition-colors ${
          isDark
            ? 'bg-zinc-900/95 border-zinc-800 text-zinc-200'
            : 'bg-white border-slate-200 text-slate-800'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-3.5 border-b border-zinc-800/60">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center shrink-0 mt-0.5">
              <Brain className="w-5 h-5 text-purple-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2">
                <span>Ai Agent Assistant — Master AI Control</span>
              </h1>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed max-w-3xl">
                {language === 'en'
                  ? 'Centralized AI Agent Assistant control system powered by Google Gemini (@google/genai) and synced in real-time with Firestore.'
                  : 'Pusat kendali AI Agent Assistant bertenaga Google Gemini (@google/genai) yang terhubung real-time dengan database Firestore (POS, Client PWA, Produk, Stok & Transaksi).'}
              </p>
            </div>
          </div>

          {/* DROPDOWN GLOBAL MODEL AI GOOGLE DI HEADER */}
          <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-zinc-950 border border-blue-500/40 shadow-sm shrink-0 self-start">
            <Cpu className="w-4 h-4 text-blue-400 shrink-0" />
            <div className="flex flex-col">
              <span className="text-[9px] font-bold uppercase tracking-wider text-blue-300 leading-none">
                Model AI Google (Default Global)
              </span>
              <select
                value={defaultAiModel || DEFAULT_GOOGLE_GEMINI_MODEL}
                onChange={(e) => void handleGlobalModelChange(e.target.value)}
                aria-label="Pilih Model AI Google Default"
                className="bg-transparent text-white font-bold text-xs focus:outline-none cursor-pointer pr-2 mt-0.5"
              >
                {GOOGLE_GEMINI_MODELS.map((m) => (
                  <option key={m.id} value={m.id} className="bg-zinc-900 text-white">
                    {m.shortLabel} ({m.id})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Bottom Action Toolbar: Layout Toggle, Theme Switcher, Refresh & Add Agent */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <AILayoutToggleBar
            mode={layoutMode}
            onChange={setLayoutMode}
            promptText={searchQuery}
          />

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center p-1 rounded-xl bg-zinc-950 border border-zinc-800 shadow-sm">
              <button
                type="button"
                onClick={() => setTableTheme('dark')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  isDark
                    ? 'bg-zinc-800 text-white shadow-sm font-bold border border-zinc-700/60'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Moon className="w-3.5 h-3.5 text-purple-400" />
                <span>Dark</span>
              </button>
              <button
                type="button"
                onClick={() => setTableTheme('light')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  !isDark
                    ? 'bg-white text-slate-900 shadow-sm font-bold border border-slate-200'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Sun className="w-3.5 h-3.5 text-amber-500" />
                <span>Light</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                void refreshFirestore();
                setAgents(loadAIAgentInstructions());
                showToast('Data AI Agent & Model Google Gemini berhasil disinkronkan dari Firestore!');
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 hover:bg-zinc-800 text-zinc-200 text-xs font-semibold transition shadow-sm cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition shadow-md shadow-purple-600/20 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Tambah AI Agent</span>
            </button>
          </div>
        </div>
      </div>

      {/* MAIN CONTAINER BOX — Subjudul / Header Box: Daftar AI Agent Assistant — RiskCart */}
      <div
        className={`rounded-2xl p-6 border shadow-sm space-y-4 transition-colors ${
          isDark
            ? 'bg-zinc-900/95 border-zinc-800 text-zinc-200'
            : 'bg-white border-slate-200 text-slate-800'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 border-zinc-800/40">
          <div>
            <h3 className="text-base font-bold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-400" />
              <span>Daftar AI Agent Assistant — RiskCart</span>
            </h3>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
              Klik ikon <strong>Edit (Pensil)</strong> pada kartu untuk memilih{' '}
              <strong>Model AI dari Google (Gemini)</strong> dan mengubah{' '}
              <strong>Prompt Knowledge</strong> yang tersimpan langsung ke Firestore.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search Filter */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari AI Agent atau model..."
                className={`pl-8 pr-3 py-1.5 rounded-xl border text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                  isDark
                    ? 'bg-zinc-950 border-zinc-800 text-white placeholder-zinc-500'
                    : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400'
                }`}
              />
            </div>

            <button
              type="button"
              onClick={() => void handleResetAll()}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                isDark
                  ? 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-300'
                  : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
              }`}
              title="Reset seluruh instruksi & model agen ke bawaan"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Default</span>
            </button>

            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-sm transition cursor-pointer"
            >
              + Tambah AI Agent
            </button>
          </div>
        </div>

        {/* TABEL HASIL ANALISA & DIREKTORI 12 AI AGENTS (Drag & Drop Reordering, Klik Baris ke /dashboard/ai/master/:agentSlug) */}
        <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950/90 shadow-xl">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-zinc-900 text-zinc-400 uppercase text-[10px] border-b border-zinc-800">
              <tr>
                <th className="p-3 w-12 text-center">Urut</th>
                <th className="p-3">Agen AI (12)</th>
                <th className="p-3">Model Google AI</th>
                <th className="p-3">Peran &amp; Rute Kanvas</th>
                <th className="p-3">Hasil Analisa Live Database</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80 text-zinc-200">
              {displayedAgents.map((agent, index) => {
                const isCustomized =
                  Boolean(agent.customInstruction && agent.customInstruction.trim().length > 0) &&
                  agent.customInstruction.trim() !== agent.defaultInstruction.trim();
                const liveRec = getAgentLiveRecommendation(agent);
                const modelInfo = getGoogleGeminiModelInfo(agent.modelId || defaultAiModel);
                const masterSlug = getMasterAgentSlug(agent);
                const targetMasterUrl = `/dashboard/ai/master/${masterSlug}`;
                const isBeingDragged = draggedIdx === index;
                const isOverTarget = dragOverIdx === index && draggedIdx !== index;

                return (
                  <tr
                    key={agent.id}
                    draggable={true}
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnter={(e) => handleDragEnter(e, index)}
                    onDragEnd={handleDragEnd}
                    onDrop={(e) => void handleDrop(e, index)}
                    onClick={() => navigateToPath(targetMasterUrl)}
                    className={`transition cursor-pointer hover:bg-zinc-900/80 ${
                      isBeingDragged ? 'opacity-40 bg-amber-500/10' : ''
                    } ${isOverTarget ? 'bg-amber-500/15 ring-1 ring-amber-400' : ''}`}
                  >
                    <td
                      className="p-3 text-center font-mono text-zinc-500"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-1 cursor-grab active:cursor-grabbing text-amber-400/80 hover:text-amber-300">
                        <GripVertical className="w-3.5 h-3.5" />
                        <span>{index + 1}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xl shrink-0">{agent.icon}</span>
                        <div>
                          <div className="font-bold text-white hover:text-amber-300 text-xs sm:text-sm">
                            {language === 'id' ? agent.nameId : agent.nameEn}
                          </div>
                          <span className="inline-block mt-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-zinc-300 font-mono">
                            {agent.badgeText}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <span
                        className={`text-[10px] font-bold px-2 py-1 rounded-lg border font-mono inline-flex items-center gap-1 ${modelInfo.badgeColor}`}
                        title={modelInfo.fullLabel}
                      >
                        <Cpu className="w-3 h-3 shrink-0" />
                        <span>{modelInfo.shortLabel}</span>
                      </span>
                    </td>
                    <td className="p-3 max-w-xs">
                      <p className="text-[11px] text-zinc-300 line-clamp-2 leading-relaxed">
                        {language === 'id' ? agent.roleId : agent.roleEn}
                      </p>
                      <div className="text-[10px] font-mono text-amber-400/90 mt-0.5 truncate">
                        {targetMasterUrl}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
                        <span className="font-mono text-white font-semibold text-xs">
                          {liveRec}
                        </span>
                      </div>
                      {agent.syncStatusLabel && (
                        <div className="text-[9px] text-emerald-400/90 font-mono font-bold mt-1">
                          {agent.syncStatusLabel}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <span
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                          isCustomized
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        }`}
                      >
                        {isCustomized ? 'Custom' : 'Aktif'}
                      </span>
                    </td>
                    <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openTestModal(agent);
                          }}
                          title="Uji Cepat Modal AI Agent"
                          className="p-1.5 rounded-lg bg-zinc-900 hover:bg-blue-600/80 text-zinc-200 hover:text-white border border-zinc-800 transition cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditModal(agent);
                          }}
                          title="Edit Model Google AI & Prompt Knowledge"
                          className="p-1.5 rounded-lg bg-zinc-900 hover:bg-amber-600/80 text-zinc-200 hover:text-white border border-zinc-800 transition cursor-pointer"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteAgent(agent);
                          }}
                          title="Hapus Agen AI ini"
                          className="p-1.5 rounded-lg bg-zinc-900 hover:bg-rose-600/80 text-rose-400 hover:text-white border border-zinc-800 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <AppLink
                          to={targetMasterUrl}
                          title={`Buka Kanvas Mandiri ${agent.nameId}`}
                          className="py-1.5 px-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500 border border-amber-500/40 text-amber-200 hover:text-zinc-950 text-xs font-bold inline-flex items-center gap-1 transition cursor-pointer"
                        >
                          <span>Kanvas</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </AppLink>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {renderModals()}
    </div>
  );
};
