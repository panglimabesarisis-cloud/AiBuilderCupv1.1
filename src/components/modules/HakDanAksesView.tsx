import React, { useState, useMemo, useEffect } from 'react';
import {
  Shield,
  ShieldCheck,
  Lock,
  Key,
  Check,
  X,
  Search,
  Cloud,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  Edit3,
  MoreVertical,
  Layers,
  Info,
  RotateCcw,
  FileText,
  CheckSquare,
  Square,
  MinusSquare,
  Users,
  ArrowLeft,
  SlidersHorizontal,
  EyeOff,
  Eye,
  Percent,
  KeyRound,
  DollarSign,
  ClipboardCheck,
  Vault,
  Download,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import {
  useAccessControl,
  PermissionGroup,
  RoleDefinition,
  GranularActionType,
  VoidRefundPolicy,
  CustomAuthorityRule,
} from '../../context/AccessControlContext';
import { useLanguage } from '../../context/LanguageContext';
import { useAppNavigation } from '../../router';

interface HakDanAksesViewProps {
  onNavigateTab?: (tab: string) => void;
}

export const HakDanAksesView: React.FC<HakDanAksesViewProps> = ({ onNavigateTab }) => {
  const { tr } = useLanguage();
  const { navigateToPath, navigateTab } = useAppNavigation();
  const {
    roles,
    grants,
    moduleMatrix,
    operationalLimits,
    customRules,
    ecosystemModules,
    activeRoleId,
    setActiveRoleId,
    toggleGrant,
    setGroupGrants,
    setRoleGrants,
    toggleModuleAction,
    setAllModuleActionsForRole,
    updateOperationalLimit,
    addCustomRole,
    updateRole,
    duplicateRole,
    deleteCustomRole,
    addCustomRule,
    updateCustomRule,
    deleteCustomRule,
    resetToDefault,
    saveToCloud,
    isSaving,
    lastSaved,
    groups,
    allPermissionKeys,
  } = useAccessControl();

  // Primary View Tab:
  // 'rbac_builder' = Matriks Modul (View/Create/Update/Delete/Approve) + Otoritas Operasional & Finansial + Custom Rules
  // 'roles_cards' = Manajemen Role / Jabatan (CRUD Kartu Jabatan)
  // 'sub_features' = Matriks Sub-Fitur Lengkap (A-P)
  // 'catalog' = Katalog Ringkasan Izin
  const [activeTab, setActiveTab] = useState<'rbac_builder' | 'roles_cards' | 'sub_features' | 'catalog'>('rbac_builder');

  // Selected Role inside RBAC Builder Matrix
  const [selectedRoleForBuilder, setSelectedRoleForBuilder] = useState<string>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const qRole = params.get('role');
      if (qRole) return qRole;
    } catch {}
    return 'cashier';
  });

  // Ensure selectedRoleForBuilder exists in roles
  useEffect(() => {
    if (!roles.some((r) => r.id === selectedRoleForBuilder) && roles.length > 0) {
      setSelectedRoleForBuilder(roles[0].id);
    }
  }, [roles, selectedRoleForBuilder]);

  const currentBuilderRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleForBuilder) || roles[0],
    [roles, selectedRoleForBuilder]
  );

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [catalogGroupFilter, setCatalogGroupFilter] = useState<string>('all');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    groups.forEach((g) => {
      initial[g.key] = true;
    });
    return initial;
  });

  // Highlighted role from query param (?role=cashier)
  const [highlightedRoleId] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('role');
    } catch {
      return null;
    }
  });

  const [activeTooltip, setActiveTooltip] = useState<{ id: string; text: string; title: string; route?: string } | null>(null);
  const [openKebabRoleId, setOpenKebabRoleId] = useState<string | null>(null);

  // Modal: + Tambah Role / Jabatan Baru
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleCode, setNewRoleCode] = useState('');
  const [newRoleLevel, setNewRoleLevel] = useState<number>(60);
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#f59e0b');
  const [newRoleCopyFrom, setNewRoleCopyFrom] = useState('cashier');

  // Modal: Edit Role
  const [editRoleTarget, setEditRoleTarget] = useState<RoleDefinition | null>(null);
  const [editRoleName, setEditRoleName] = useState('');
  const [editRoleCode, setEditRoleCode] = useState('');
  const [editRoleLevel, setEditRoleLevel] = useState<number>(60);
  const [editRoleDesc, setEditRoleDesc] = useState('');
  const [editRoleColor, setEditRoleColor] = useState('#f59e0b');

  // Modal: + Tambah Aturan Otoritas Baru
  const [isAddRuleModalOpen, setIsAddRuleModalOpen] = useState(false);
  const [ruleTitle, setRuleTitle] = useState('');
  const [ruleCode, setRuleCode] = useState('');
  const [ruleDesc, setRuleDesc] = useState('');
  const [ruleModuleId, setRuleModuleId] = useState('mod_pos');
  const [ruleRoleIds, setRuleRoleIds] = useState<string[]>(['cashier']);
  const [ruleActionType, setRuleActionType] = useState<CustomAuthorityRule['actionType']>('pin_override');
  const [ruleThreshold, setRuleThreshold] = useState<number>(10);
  const [ruleRequirePin, setRuleRequirePin] = useState<boolean>(true);

  const [deleteRoleTarget, setDeleteRoleTarget] = useState<RoleDefinition | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  // Notification Toast state
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 3800);
  };

  useEffect(() => {
    const handleClickOutside = () => {
      setOpenKebabRoleId(null);
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  const filteredGroups = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return groups;

    return groups
      .map((g) => {
        const matchingItems = g.items.filter((item) => {
          return (
            item.title.toLowerCase().includes(q) ||
            item.id.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q) ||
            (item.subModule && item.subModule.toLowerCase().includes(q)) ||
            g.title.toLowerCase().includes(q)
          );
        });

        return {
          ...g,
          items: matchingItems,
        };
      })
      .filter((g) => g.items.length > 0);
  }, [groups, searchQuery]);

  const filteredEcosystemModules = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return ecosystemModules;
    return ecosystemModules.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.code.toLowerCase().includes(q) ||
        m.routesLabel.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q)
    );
  }, [ecosystemModules, searchQuery]);

  const totalItemsCount = allPermissionKeys.length;

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleExpandAll = (expand: boolean) => {
    const next: Record<string, boolean> = {};
    groups.forEach((g) => {
      next[g.key] = expand;
    });
    setOpenGroups(next);
  };

  const handleSaveToCloud = async () => {
    try {
      await saveToCloud();
      showToast('Seluruh aturan RBAC (`settings/access_control`, `rbac_roles` & `rbac_rules`) berhasil disimpan ke Cloud Firestore!');
    } catch (e) {
      showToast(`Gagal menyimpan: ${String(e)}`, 'error');
    }
  };

  const handleAddRoleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;

    addCustomRole({
      name: newRoleName.trim(),
      code: newRoleCode.trim() || newRoleName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
      level: Math.min(99, Math.max(1, Number(newRoleLevel || 50))),
      description: newRoleDesc.trim(),
      color: newRoleColor,
      copyFromId: newRoleCopyFrom,
    });

    setIsAddModalOpen(false);
    setNewRoleName('');
    setNewRoleCode('');
    setNewRoleLevel(60);
    setNewRoleDesc('');
    showToast(`Role "${newRoleName.trim()}" berhasil ditambahkan ke koleksi rbac_roles!`);
  };

  const handleEditRoleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editRoleTarget || !editRoleName.trim()) return;

    updateRole(editRoleTarget.id, {
      name: editRoleName.trim(),
      code: editRoleCode.trim() || editRoleTarget.code,
      level: editRoleTarget.id === 'owner' ? 100 : Math.min(99, Math.max(1, Number(editRoleLevel || 50))),
      description: editRoleDesc.trim(),
      color: editRoleColor,
    });

    setEditRoleTarget(null);
    showToast(`Role "${editRoleName.trim()}" berhasil diperbarui di Firestore.`);
  };

  const handleAddRuleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleTitle.trim()) return;

    await addCustomRule({
      code:
        ruleCode.trim().toUpperCase() ||
        `RULE_${ruleTitle.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 18)}`,
      title: ruleTitle.trim(),
      description: ruleDesc.trim() || 'Aturan otoritas kustom yang ditetapkan oleh Owner.',
      moduleId: ruleModuleId,
      roleIds: ruleRoleIds.length > 0 ? ruleRoleIds : ['cashier'],
      actionType: ruleActionType,
      maxThresholdValue: Number(ruleThreshold || 0),
      requireSupervisorPin: ruleRequirePin,
      enabled: true,
    });

    setIsAddRuleModalOpen(false);
    setRuleTitle('');
    setRuleCode('');
    setRuleDesc('');
    showToast('Aturan Otoritas Baru berhasil disimpan ke koleksi Firestore `rbac_rules`!');
  };

  const handleDuplicate = (role: RoleDefinition) => {
    duplicateRole(role.id, `${role.name} (Salinan)`);
    showToast(`Role "${role.name}" berhasil diduplikasi.`);
  };

  const handleDeleteRole = () => {
    if (!deleteRoleTarget) return;
    deleteCustomRole(deleteRoleTarget.id);
    showToast(`Role "${deleteRoleTarget.name}" telah dihapus.`);
    setDeleteRoleTarget(null);
  };

  const getGroupCheckState = (group: PermissionGroup, roleId: string) => {
    if (roleId === 'owner') return 'all';
    const roleGrants = grants[roleId] || [];
    const itemIds = group.items.map((i) => i.id);
    const grantedCount = itemIds.filter((id) => roleGrants.includes(id)).length;

    if (grantedCount === 0) return 'none';
    if (grantedCount === itemIds.length) return 'all';
    return 'some';
  };

  const isBuilderRoleOwner = currentBuilderRole?.id === 'owner' || Boolean(currentBuilderRole?.terkunci);
  const currentLimits = isBuilderRoleOwner
    ? operationalLimits.owner
    : operationalLimits[currentBuilderRole?.id || 'cashier'] || operationalLimits.cashier;

  return (
    <div className="min-h-screen bg-[#070a10] text-zinc-100 flex flex-col font-sans">
      {/* 1. EXECUTIVE DARK LUXURY GOLD HEADER */}
      <div className="border-b border-amber-500/20 bg-gradient-to-r from-[#0b0f19] via-[#0f1422] to-[#17130a] sticky top-0 z-40 shadow-2xl">
        <div className="px-4 sm:px-6 py-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          {/* Left: Back & Luxury Title */}
          <div className="flex items-start sm:items-center gap-3.5">
            <button
              onClick={() => {
                if (onNavigateTab) onNavigateTab('module_staff');
                else navigateTab('module_staff', 'daftar_staff');
              }}
              className="p-2.5 rounded-xl bg-zinc-900/90 border border-amber-500/30 text-amber-400 hover:text-amber-300 hover:bg-zinc-800 transition cursor-pointer shrink-0"
              title="Kembali ke Direktori Staff"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-400 shadow-sm">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h1 className="text-lg sm:text-xl font-black tracking-tight text-white uppercase">
                  OTORITAS AKSES SISTEM{' '}
                  <span className="text-amber-400 font-mono text-xs px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 ml-1">
                    RBAC CONTROL
                  </span>
                </h1>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Firestore `rbac_roles` &amp; `rbac_rules` Live</span>
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Pusat kendali wewenang jabatan, izin granular modul (View, Create, Update, Delete, Approve), proteksi HPP/Laba, dan batas otorisasi kasir POS.
              </p>
            </div>
          </div>

          {/* Right: Action Buttons & Role Simulator */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Simulator Role Aktif */}
            <div className="flex items-center gap-2 bg-zinc-950/90 border border-amber-500/30 rounded-xl px-3 py-1.5">
              <UserCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-[11px] text-zinc-400 font-semibold">Simulasi Role Aktif:</span>
              <select
                value={activeRoleId}
                onChange={(e) => {
                  setActiveRoleId(e.target.value);
                  const rName = roles.find((r) => r.id === e.target.value)?.name || e.target.value;
                  showToast(`Simulasi akses aktif diubah ke: ${rName}`, 'info');
                }}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs font-bold text-amber-300 focus:outline-none focus:border-amber-400 cursor-pointer"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} {r.id === 'owner' ? '(Full 100%)' : `(Lv.${r.level ?? 50})`}
                  </option>
                ))}
              </select>
            </div>

            {/* + Tambah Role / Jabatan Baru */}
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-amber-300 text-xs font-bold border border-amber-500/40 transition cursor-pointer shadow-sm"
            >
              <Plus className="w-3.5 h-3.5 text-amber-400" />
              <span>+ Tambah Role / Jabatan Baru</span>
            </button>

            {/* + Tambah Aturan Otoritas Baru */}
            <button
              onClick={() => setIsAddRuleModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 text-xs font-bold border border-amber-500/50 transition cursor-pointer shadow-sm"
            >
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
              <span>+ Tambah Aturan Otoritas Baru</span>
            </button>

            {/* Simpan Perubahan ke Cloud */}
            <button
              onClick={handleSaveToCloud}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-zinc-950 text-xs font-black shadow-lg shadow-amber-950/50 transition cursor-pointer disabled:opacity-60"
            >
              <Cloud className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} />
              <span>{isSaving ? 'Menyimpan...' : 'Simpan Otoritas'}</span>
            </button>

            <button
              onClick={() => setIsResetConfirmOpen(true)}
              className="p-2 rounded-xl bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-amber-300 border border-zinc-800 transition cursor-pointer"
              title="Reset seluruh aturan RBAC ke standar default"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Navigation Sub-Tabs Bar */}
        <div className="px-4 sm:px-6 pb-3 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/70 pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5 bg-zinc-950/90 p-1 rounded-xl border border-zinc-800/90">
            <button
              onClick={() => setActiveTab('rbac_builder')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                activeTab === 'rbac_builder'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-zinc-950 shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Matriks RBAC &amp; Otoritas Finansial</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] bg-black/25 font-mono">
                13 Modul
              </span>
            </button>

            <button
              onClick={() => setActiveTab('roles_cards')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                activeTab === 'roles_cards'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-zinc-950 shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Daftar Role / Jabatan</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] bg-black/25 font-mono">
                {roles.length} Role
              </span>
            </button>

            <button
              onClick={() => setActiveTab('sub_features')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                activeTab === 'sub_features'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-zinc-950 shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Matriks Sub-Fitur Lengkap (A–P)</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] bg-black/25 font-mono">
                {totalItemsCount}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('catalog')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                activeTab === 'catalog'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-zinc-950 shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Katalog Ringkasan Izin</span>
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2 pointer-events-none" />
              <input
                type="text"
                placeholder="Cari modul, halaman, atau aturan..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-7 py-1 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1.5 text-zinc-500 hover:text-zinc-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {lastSaved && (
              <span className="text-[11px] text-zinc-500 hidden md:inline">
                Tersinkronisasi: {new Date(lastSaved).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2. MAIN WORKSPACE CONTENT */}
      <div className="flex-1 p-4 sm:p-6 space-y-6 overflow-x-auto">
        {/* =====================================================================
            TAB 1: RBAC MATRIX BUILDER (5 GRANULAR COLUMNS + OPERATIONAL & FINANCIAL LIMITS)
           ===================================================================== */}
        {activeTab === 'rbac_builder' && (
          <div className="space-y-6">
            {/* Role Selector Strip */}
            <div className="bg-[#0c111d] border border-amber-500/20 rounded-2xl p-4 shadow-xl">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 mb-3 border-b border-zinc-800/80">
                <div>
                  <h2 className="text-sm font-black text-white uppercase tracking-wide flex items-center gap-2">
                    <Shield className="w-4 h-4 text-amber-400" />
                    <span>Pilih Role / Jabatan untuk Dikonfigurasi:</span>
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Klik salah satu jabatan di bawah untuk mengatur matriks izin halaman (View, Create, Update, Delete, Approve) dan batasan finansialnya.
                  </p>
                </div>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1.5 self-start md:self-auto cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Jabatan Baru</span>
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {roles.map((r) => {
                  const isSelected = r.id === currentBuilderRole?.id;
                  const isOwner = r.id === 'owner' || r.terkunci;
                  const rMatrix = moduleMatrix[r.id] || {};
                  const activeViewCount = isOwner
                    ? ecosystemModules.length
                    : ecosystemModules.filter((m) => rMatrix[m.id]?.view).length;

                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedRoleForBuilder(r.id)}
                      className={`px-3.5 py-2.5 rounded-xl border text-left transition flex items-center gap-3 cursor-pointer ${
                        isSelected
                          ? 'bg-gradient-to-r from-amber-500/20 to-amber-600/10 border-amber-400 text-white shadow-lg shadow-amber-950/30'
                          : 'bg-zinc-950/80 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: r.color || '#f59e0b' }}
                      />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-black text-xs text-white">{r.name}</span>
                          {isOwner && <Lock className="w-3 h-3 text-amber-400" />}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-mono mt-0.5">
                          <span>{r.code || r.id.toUpperCase()}</span>
                          <span>•</span>
                          <span className="text-amber-300 font-bold">
                            {activeViewCount}/{ecosystemModules.length} Modul
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected Role Summary Banner */}
            {currentBuilderRole && (
              <div className="bg-gradient-to-r from-[#0e1422] via-[#121829] to-[#19140b] border border-amber-500/30 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div
                    className="w-11 h-11 rounded-2xl flex items-center justify-center font-black text-base shrink-0 border"
                    style={{
                      backgroundColor: `${currentBuilderRole.color || '#f59e0b'}20`,
                      borderColor: `${currentBuilderRole.color || '#f59e0b'}50`,
                      color: currentBuilderRole.color || '#f59e0b',
                    }}
                  >
                    {currentBuilderRole.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-black text-white">{currentBuilderRole.name}</h3>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-zinc-900 border border-zinc-700 text-amber-300">
                        Kode: {currentBuilderRole.code || currentBuilderRole.id.toUpperCase()}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 border border-amber-500/30 text-amber-300">
                        Level Otoritas: {isBuilderRoleOwner ? 100 : (currentBuilderRole.level ?? 50)}
                      </span>
                      {isBuilderRoleOwner && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-black bg-amber-500 text-zinc-950">
                          <Lock className="w-3 h-3" />
                          <span>TERKUNCI 100% FULL ACCESS</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-300 mt-1">{currentBuilderRole.description}</p>
                  </div>
                </div>

                {!isBuilderRoleOwner && (
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        ecosystemModules.forEach((m) =>
                          setAllModuleActionsForRole(currentBuilderRole.id, m.id, true)
                        );
                        showToast(`Seluruh izin modul diaktifkan untuk ${currentBuilderRole.name}.`);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-700/60 text-emerald-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                      <span>Izinkan Semua Modul</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        ecosystemModules.forEach((m) =>
                          setAllModuleActionsForRole(currentBuilderRole.id, m.id, false)
                        );
                        showToast(`Seluruh izin modul dicabut untuk ${currentBuilderRole.name}.`, 'info');
                      }}
                      className="px-3 py-1.5 rounded-xl bg-rose-950/70 hover:bg-rose-900/80 border border-rose-700/60 text-rose-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Square className="w-3.5 h-3.5" />
                      <span>Cabut Semua</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditRoleTarget(currentBuilderRole);
                        setEditRoleName(currentBuilderRole.name);
                        setEditRoleCode(currentBuilderRole.code || currentBuilderRole.id.toUpperCase());
                        setEditRoleLevel(currentBuilderRole.level ?? 60);
                        setEditRoleDesc(currentBuilderRole.description || '');
                        setEditRoleColor(currentBuilderRole.color || '#f59e0b');
                      }}
                      className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                      <span>Edit Role</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* SECTION B.1: 5-COLUMN GRANULAR MODULE & PAGE PERMISSIONS TABLE */}
            <div className="bg-[#0b101b] border border-zinc-800 rounded-2xl shadow-xl overflow-hidden">
              <div className="p-4 bg-[#0f1626] border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wide flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-400" />
                    <span>1. Matriks Izin Akses per Modul &amp; Halaman (Page &amp; Action Permissions)</span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Atur 5 izin granular untuk jabatan <strong className="text-amber-300">{currentBuilderRole?.name}</strong>. Jika <em>Lihat Halaman (View)</em> dinonaktifkan, menu tersebut otomatis disembunyikan dari Sidebar staf.
                  </p>
                </div>
                <span className="text-[11px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-lg">
                  5 Kolom Otoritas Granular
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="bg-[#090d16] text-zinc-300 uppercase tracking-wider text-[11px] border-b border-zinc-800">
                    <tr>
                      <th className="py-3.5 px-4 min-w-[290px]">Cakupan Modul &amp; Route Ekosistem</th>
                      <th className="py-3.5 px-3 text-center w-36 border-l border-zinc-800/80">
                        <span className="text-emerald-400 block font-black">Lihat Halaman</span>
                        <span className="text-[10px] text-zinc-500 font-mono">(View)</span>
                      </th>
                      <th className="py-3.5 px-3 text-center w-36 border-l border-zinc-800/80">
                        <span className="text-blue-400 block font-black">Tambah Data</span>
                        <span className="text-[10px] text-zinc-500 font-mono">(Create)</span>
                      </th>
                      <th className="py-3.5 px-3 text-center w-36 border-l border-zinc-800/80">
                        <span className="text-amber-400 block font-black">Edit Data</span>
                        <span className="text-[10px] text-zinc-500 font-mono">(Update)</span>
                      </th>
                      <th className="py-3.5 px-3 text-center w-36 border-l border-zinc-800/80">
                        <span className="text-rose-400 block font-black">Hapus Data</span>
                        <span className="text-[10px] text-zinc-500 font-mono">(Delete)</span>
                      </th>
                      <th className="py-3.5 px-3 text-center w-40 border-l border-zinc-800/80">
                        <span className="text-purple-400 block font-black">Approve / Otorisasi</span>
                        <span className="text-[10px] text-zinc-500 font-mono">(Special Approval)</span>
                      </th>
                      <th className="py-3.5 px-3 text-center w-28 border-l border-zinc-800/80">
                        Semua Aksi
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {filteredEcosystemModules.map((mod) => {
                      const roleId = currentBuilderRole?.id || 'cashier';
                      const perms = isBuilderRoleOwner
                        ? { view: true, create: true, update: true, delete: true, approve: true }
                        : moduleMatrix[roleId]?.[mod.id] || {
                            view: false,
                            create: false,
                            update: false,
                            delete: false,
                            approve: false,
                          };
                      const allFiveEnabled =
                        perms.view && perms.create && perms.update && perms.delete && perms.approve;

                      const actions: { key: GranularActionType; activeClass: string }[] = [
                        { key: 'view', activeClass: 'bg-emerald-600 border-emerald-400 text-white' },
                        { key: 'create', activeClass: 'bg-blue-600 border-blue-400 text-white' },
                        { key: 'update', activeClass: 'bg-amber-500 border-amber-300 text-zinc-950' },
                        { key: 'delete', activeClass: 'bg-rose-600 border-rose-400 text-white' },
                        { key: 'approve', activeClass: 'bg-purple-600 border-purple-400 text-white' },
                      ];

                      return (
                        <tr key={mod.id} className="hover:bg-zinc-900/60 transition">
                          <td className="py-3 px-4">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-white text-xs">{mod.title}</span>
                                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-amber-400">
                                    {mod.routesLabel}
                                  </span>
                                </div>
                                <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                                  {mod.description}
                                </p>
                              </div>
                            </div>
                          </td>

                          {actions.map((act) => {
                            const checked = perms[act.key];
                            return (
                              <td
                                key={act.key}
                                className="py-3 px-3 text-center border-l border-zinc-800/60"
                              >
                                <div className="flex items-center justify-center">
                                  {isBuilderRoleOwner ? (
                                    <span
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-400 text-[10px] font-bold cursor-not-allowed"
                                      title="Owner terkunci 100% Full Access"
                                    >
                                      <Lock className="w-3 h-3" />
                                      <span> Penuh</span>
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => toggleModuleAction(roleId, mod.id, act.key)}
                                      className={`w-11 h-6 rounded-full p-0.5 transition-colors flex items-center cursor-pointer border ${
                                        checked
                                          ? act.activeClass
                                          : 'bg-zinc-950 border-zinc-700 justify-start'
                                      }`}
                                      title={`Ubah izin ${act.key.toUpperCase()} pada ${mod.title}`}
                                    >
                                      <span
                                        className={`w-4 h-4 rounded-full transition-transform ${
                                          checked
                                            ? 'translate-x-5 bg-white shadow'
                                            : 'translate-x-0 bg-zinc-500'
                                        }`}
                                      />
                                    </button>
                                  )}
                                </div>
                              </td>
                            );
                          })}

                          <td className="py-3 px-3 text-center border-l border-zinc-800/60">
                            {isBuilderRoleOwner ? (
                              <span className="text-[10px] font-mono text-amber-400 font-bold">100%</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  setAllModuleActionsForRole(roleId, mod.id, !allFiveEnabled)
                                }
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                                  allFiveEnabled
                                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                                    : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white'
                                }`}
                              >
                                {allFiveEnabled ? 'Semua Aktif' : 'Pilih Semua'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* SECTION B.2: OTORITAS OPERASIONAL & FINANSIAL KHUSUS (GRANULAR RULES) */}
            <div className="bg-[#0b101b] border border-amber-500/25 rounded-2xl shadow-xl overflow-hidden">
              <div className="p-4 bg-gradient-to-r from-[#0f1626] to-[#1a1408] border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wide flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-amber-400" />
                    <span>2. Otoritas Operasional &amp; Finansial Khusus (Granular Protection Rules)</span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Pengaturan batasan sensitif kasir POS, kerahasiaan Harga Modal (HPP) &amp; Laba, persetujuan PIN Void/Refund, serta mutasi Brankas untuk jabatan{' '}
                    <strong className="text-amber-300">{currentBuilderRole?.name}</strong>.
                  </p>
                </div>
                <span className="text-[11px] font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-lg">
                  Real-Time Enforcement Aktif
                </span>
              </div>

              <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Rule 1: Sembunyikan HPP & Margin Keuntungan */}
                <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0">
                      {currentLimits.hideHppAndMargin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-xs">
                        1. Sembunyikan Harga Modal (HPP) &amp; Margin Keuntungan
                      </h4>
                      <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                        Jika aktif, staf dengan role ini tidak dapat melihat kolom Harga Beli/HPP, Persentase Margin, dan Laba Bersih di halaman Produk, Orders, maupun Laporan.
                      </p>
                      <span
                        className={`inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded border ${
                          currentLimits.hideHppAndMargin
                            ? 'bg-rose-950/60 border-rose-700 text-rose-300'
                            : 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                        }`}
                      >
                        Status: {currentLimits.hideHppAndMargin ? 'HPP & Margin Disembunyikan' : 'Dapat Melihat HPP & Margin'}
                      </span>
                    </div>
                  </div>
                  {isBuilderRoleOwner ? (
                    <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-1" />
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        updateOperationalLimit(
                          currentBuilderRole.id,
                          'hideHppAndMargin',
                          !currentLimits.hideHppAndMargin
                        )
                      }
                      className={`w-12 h-6 rounded-full p-0.5 transition-colors flex items-center shrink-0 cursor-pointer border ${
                        currentLimits.hideHppAndMargin
                          ? 'bg-amber-500 border-amber-300'
                          : 'bg-zinc-950 border-zinc-700'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full transition-transform ${
                          currentLimits.hideHppAndMargin
                            ? 'translate-x-6 bg-zinc-950'
                            : 'translate-x-0 bg-zinc-500'
                        }`}
                      />
                    </button>
                  )}
                </div>

                {/* Rule 2 & 3: Izin Diskon Manual di Kasir POS + Batas Maksimal Diskon (%) */}
                <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 shrink-0">
                        <Percent className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-white text-xs">
                          2 &amp; 3. Izin Diskon Manual di Kasir POS &amp; Batas Maksimal Diskon (%)
                        </h4>
                        <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                          Mengizinkan kasir memberikan potongan harga manual saat transaksi beserta batas persentase diskon maksimal tanpa PIN Owner.
                        </p>
                      </div>
                    </div>
                    {isBuilderRoleOwner ? (
                      <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-1" />
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          updateOperationalLimit(
                            currentBuilderRole.id,
                            'allowManualDiscount',
                            !currentLimits.allowManualDiscount
                          )
                        }
                        className={`w-12 h-6 rounded-full p-0.5 transition-colors flex items-center shrink-0 cursor-pointer border ${
                          currentLimits.allowManualDiscount
                            ? 'bg-blue-600 border-blue-400'
                            : 'bg-zinc-950 border-zinc-700'
                        }`}
                      >
                        <span
                          className={`w-4 h-4 rounded-full transition-transform ${
                            currentLimits.allowManualDiscount
                              ? 'translate-x-6 bg-white'
                              : 'translate-x-0 bg-zinc-500'
                          }`}
                        />
                      </button>
                    )}
                  </div>

                  <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between gap-3">
                    <span className="text-xs text-zinc-300 font-semibold">
                      Batas Maksimal Diskon Manual (%):
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        disabled={isBuilderRoleOwner || !currentLimits.allowManualDiscount}
                        value={isBuilderRoleOwner ? 100 : currentLimits.maxDiscountPercent}
                        onChange={(e) =>
                          updateOperationalLimit(
                            currentBuilderRole.id,
                            'maxDiscountPercent',
                            Math.min(100, Math.max(0, Number(e.target.value || 0)))
                          )
                        }
                        className="w-24 bg-zinc-950 border border-amber-500/40 rounded-xl px-3 py-1.5 text-right font-mono font-bold text-amber-300 text-xs focus:outline-none focus:border-amber-400 disabled:opacity-50"
                      />
                      <span className="text-xs font-mono font-bold text-amber-400">%</span>
                    </div>
                  </div>
                </div>

                {/* Rule 4: Izin Void / Batal / Refund Transaksi */}
                <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 shrink-0">
                      <KeyRound className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-white text-xs">
                        4. Izin Void / Batal / Refund Transaksi POS
                      </h4>
                      <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                        Atur apakah jabatan ini boleh membatalkan transaksi yang sudah tercatat, wajib meminta PIN 6-Digit Supervisor/Owner, atau ditolak sepenuhnya.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {(
                      [
                        { id: 'allowed', label: 'Diizinkan Langsung', color: 'emerald' },
                        { id: 'require_pin', label: 'Wajib PIN Supervisor', color: 'amber' },
                        { id: 'denied', label: 'Ditolak / Terkunci', color: 'rose' },
                      ] as { id: VoidRefundPolicy; label: string; color: string }[]
                    ).map((opt) => {
                      const active = currentLimits.voidRefundPolicy === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={isBuilderRoleOwner}
                          onClick={() =>
                            updateOperationalLimit(currentBuilderRole.id, 'voidRefundPolicy', opt.id)
                          }
                          className={`py-2 px-2.5 rounded-xl border text-[11px] font-bold transition cursor-pointer disabled:cursor-not-allowed ${
                            active
                              ? opt.color === 'emerald'
                                ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                                : opt.color === 'amber'
                                ? 'bg-amber-950/80 border-amber-500 text-amber-300'
                                : 'bg-rose-950/80 border-rose-500 text-rose-300'
                              : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Rule 5: Izin Ubah Harga Jual Langsung di POS */}
                <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 shrink-0">
                      <DollarSign className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-xs">
                        5. Izin Ubah Harga Jual Langsung di POS (Custom Price Override)
                      </h4>
                      <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                        Mengizinkan perubahan harga jual satuan/karton secara manual di layar kasir POS maupun di tabel katalog produk.
                      </p>
                    </div>
                  </div>
                  {isBuilderRoleOwner ? (
                    <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-1" />
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        updateOperationalLimit(
                          currentBuilderRole.id,
                          'allowDirectPriceEdit',
                          !currentLimits.allowDirectPriceEdit
                        )
                      }
                      className={`w-12 h-6 rounded-full p-0.5 transition-colors flex items-center shrink-0 cursor-pointer border ${
                        currentLimits.allowDirectPriceEdit
                          ? 'bg-purple-600 border-purple-400'
                          : 'bg-zinc-950 border-zinc-700'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full transition-transform ${
                          currentLimits.allowDirectPriceEdit
                            ? 'translate-x-6 bg-white'
                            : 'translate-x-0 bg-zinc-500'
                        }`}
                      />
                    </button>
                  )}
                </div>

                {/* Rule 6: Izin Penyesuaian Stok Opname (+/-) */}
                <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-400 shrink-0">
                      <ClipboardCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-xs">
                        6. Izin Penyesuaian Stok Opname (+/-) &amp; Koreksi Fisik
                      </h4>
                      <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                        Mengizinkan staf melakukan penyesuaian selisih jumlah stok fisik gudang (Stok Opname) tanpa menunggu approval Owner.
                      </p>
                    </div>
                  </div>
                  {isBuilderRoleOwner ? (
                    <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-1" />
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        updateOperationalLimit(
                          currentBuilderRole.id,
                          'allowStockOpnameAdjustment',
                          !currentLimits.allowStockOpnameAdjustment
                        )
                      }
                      className={`w-12 h-6 rounded-full p-0.5 transition-colors flex items-center shrink-0 cursor-pointer border ${
                        currentLimits.allowStockOpnameAdjustment
                          ? 'bg-orange-500 border-orange-300'
                          : 'bg-zinc-950 border-zinc-700'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full transition-transform ${
                          currentLimits.allowStockOpnameAdjustment
                            ? 'translate-x-6 bg-zinc-950'
                            : 'translate-x-0 bg-zinc-500'
                        }`}
                      />
                    </button>
                  )}
                </div>

                {/* Rule 7: Izin Kas Keluar & Mutasi Brankas */}
                <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shrink-0">
                      <Vault className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-xs">
                        7. Izin Kas Keluar &amp; Mutasi Brankas (Toko / Modal / Untung)
                      </h4>
                      <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                        Mengizinkan pencairan uang kas keluar dan pemindahan dana antar Brankas Toko, Brankas Modal, dan Brankas Untung.
                      </p>
                    </div>
                  </div>
                  {isBuilderRoleOwner ? (
                    <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-1" />
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        updateOperationalLimit(
                          currentBuilderRole.id,
                          'allowCashOutAndVaultTransfer',
                          !currentLimits.allowCashOutAndVaultTransfer
                        )
                      }
                      className={`w-12 h-6 rounded-full p-0.5 transition-colors flex items-center shrink-0 cursor-pointer border ${
                        currentLimits.allowCashOutAndVaultTransfer
                          ? 'bg-emerald-600 border-emerald-400'
                          : 'bg-zinc-950 border-zinc-700'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full transition-transform ${
                          currentLimits.allowCashOutAndVaultTransfer
                            ? 'translate-x-6 bg-white'
                            : 'translate-x-0 bg-zinc-500'
                        }`}
                      />
                    </button>
                  )}
                </div>

                {/* Rule 8: Izin Export Laporan & Kosongkan Data */}
                <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 flex items-start justify-between gap-4 md:col-span-2">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 shrink-0">
                      <Download className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-xs">
                        8. Izin Export Laporan Keuangan (CSV/PDF) &amp; Reset / Kosongkan Data
                      </h4>
                      <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                        Mengizinkan pengunduhan database transaksi/produk ke file eksternal serta akses ke fitur sensitif penghapusan/reset data sistem.
                      </p>
                    </div>
                  </div>
                  {isBuilderRoleOwner ? (
                    <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-1" />
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        updateOperationalLimit(
                          currentBuilderRole.id,
                          'allowExportAndWipeData',
                          !currentLimits.allowExportAndWipeData
                        )
                      }
                      className={`w-12 h-6 rounded-full p-0.5 transition-colors flex items-center shrink-0 cursor-pointer border ${
                        currentLimits.allowExportAndWipeData
                          ? 'bg-cyan-600 border-cyan-400'
                          : 'bg-zinc-950 border-zinc-700'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full transition-transform ${
                          currentLimits.allowExportAndWipeData
                            ? 'translate-x-6 bg-white'
                            : 'translate-x-0 bg-zinc-500'
                        }`}
                      />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* SECTION B.3: DAFTAR ATURAN OTORITAS KUSTOM (`rbac_rules`) */}
            <div className="bg-[#0b101b] border border-zinc-800 rounded-2xl shadow-xl overflow-hidden">
              <div className="p-4 bg-[#0f1626] border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wide flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>3. Daftar Aturan Otoritas Khusus (`rbac_rules` Firestore)</span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Daftar aturan kebijakan keamanan tambahan yang dibuat oleh Owner dan disimpan secara real-time di koleksi <code className="text-amber-300 font-mono">rbac_rules</code>.
                  </p>
                </div>
                <button
                  onClick={() => setIsAddRuleModalOpen(true)}
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-black text-xs flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Tambah Aturan Otoritas Baru</span>
                </button>
              </div>

              <div className="divide-y divide-zinc-800/70">
                {customRules.length === 0 ? (
                  <div className="p-8 text-center text-zinc-500 text-xs">
                    Belum ada aturan otoritas tambahan. Klik tombol &quot;+ Tambah Aturan Otoritas Baru&quot; untuk membuat kebijakan baru.
                  </div>
                ) : (
                  customRules.map((rule) => {
                    const mod = ecosystemModules.find((m) => m.id === rule.moduleId);
                    return (
                      <div
                        key={rule.id}
                        className="p-4 hover:bg-zinc-900/50 transition flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300">
                              {rule.code}
                            </span>
                            <h4 className="font-bold text-white text-xs">{rule.title}</h4>
                            {rule.requireSupervisorPin && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 border border-rose-500/30 text-rose-300">
                                Wajib PIN Supervisor
                              </span>
                            )}
                            {mod && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-900 border border-zinc-700 text-zinc-300">
                                Modul: {mod.title}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-400">{rule.description}</p>
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="text-[10px] text-zinc-500">Berlaku untuk Role:</span>
                            {rule.roleIds.map((rId) => {
                              const rObj = roles.find((r) => r.id === rId);
                              return (
                                <span
                                  key={rId}
                                  className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-200 border border-zinc-700"
                                >
                                  {rObj?.name || rId}
                                </span>
                              );
                            })}
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => updateCustomRule(rule.id, { enabled: !rule.enabled })}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                              rule.enabled
                                ? 'bg-emerald-950/70 border-emerald-600/60 text-emerald-300'
                                : 'bg-zinc-900 border-zinc-700 text-zinc-500'
                            }`}
                          >
                            {rule.enabled ? 'Aktif' : 'Nonaktif'}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteCustomRule(rule.id)}
                            className="p-2 rounded-xl bg-zinc-900 hover:bg-rose-950/60 text-zinc-400 hover:text-rose-400 border border-zinc-800 transition cursor-pointer"
                            title="Hapus Aturan Otoritas"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            TAB 2: MANAJEMEN ROLE / JABATAN (CRUD KARTU ROLE DINAMIS)
           ===================================================================== */}
        {activeTab === 'roles_cards' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0c111d] border border-amber-500/20 rounded-2xl p-4">
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-wide">
                  Manajemen Role / Jabatan Ekosistem RiskCart (`rbac_roles`)
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Setiap jabatan yang dibuat di sini otomatis muncul pada pilihan Role saat menambah/mengedit akun karyawan di halaman Daftar Staff (`/dashboard/staff`).
                </p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>+ Tambah Role / Jabatan Baru</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {roles.map((role) => {
                const isOwner = role.id === 'owner' || Boolean(role.terkunci);
                const rMatrix = moduleMatrix[role.id] || {};
                const rLimits = isOwner
                  ? operationalLimits.owner
                  : operationalLimits[role.id] || operationalLimits.cashier;
                const allowedModCount = isOwner
                  ? ecosystemModules.length
                  : ecosystemModules.filter((m) => rMatrix[m.id]?.view).length;

                return (
                  <div
                    key={role.id}
                    className="bg-[#0b101b] border border-zinc-800 hover:border-amber-500/40 rounded-2xl p-5 flex flex-col justify-between gap-4 relative overflow-hidden transition shadow-lg"
                  >
                    <div
                      className="absolute top-0 left-0 right-0 h-1"
                      style={{ backgroundColor: role.color || '#f59e0b' }}
                    />

                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: role.color || '#f59e0b' }}
                            />
                            <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-300">
                              {role.code || role.id.toUpperCase()}
                            </span>
                            <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300">
                              Lv.{isOwner ? 100 : (role.level ?? 50)}
                            </span>
                          </div>
                          <h3 className="text-base font-black text-white mt-2">{role.name}</h3>
                        </div>

                        {isOwner ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-400 text-[10px] font-black">
                            <Lock className="w-3 h-3" />
                            <span>TERKUNCI</span>
                          </span>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditRoleTarget(role);
                                setEditRoleName(role.name);
                                setEditRoleCode(role.code || role.id.toUpperCase());
                                setEditRoleLevel(role.level ?? 60);
                                setEditRoleDesc(role.description || '');
                                setEditRoleColor(role.color || '#f59e0b');
                              }}
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                              title="Edit Role"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicate(role)}
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-amber-300 hover:bg-zinc-800 cursor-pointer"
                              title="Duplikat Role"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            {!role.isDefault && (
                              <button
                                type="button"
                                onClick={() => setDeleteRoleTarget(role)}
                                className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-950/40 cursor-pointer"
                                title="Hapus Role"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <p className="text-xs text-zinc-400 leading-relaxed min-h-[36px]">
                        {role.description}
                      </p>

                      {/* Granular Summary Badges */}
                      <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-zinc-800/80 text-[11px]">
                        <div className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                          <span className="text-zinc-400">Modul Aktif:</span>
                          <strong className="text-amber-300 font-mono">
                            {allowedModCount}/{ecosystemModules.length}
                          </strong>
                        </div>
                        <div className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                          <span className="text-zinc-400">Maks Diskon:</span>
                          <strong className="text-blue-400 font-mono">
                            {rLimits.allowManualDiscount ? `${rLimits.maxDiscountPercent}%` : '0%'}
                          </strong>
                        </div>
                        <div className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                          <span className="text-zinc-400">Data HPP/Laba:</span>
                          <strong
                            className={
                              rLimits.hideHppAndMargin ? 'text-rose-400' : 'text-emerald-400'
                            }
                          >
                            {rLimits.hideHppAndMargin ? 'Tersembunyi' : 'Terlihat'}
                          </strong>
                        </div>
                        <div className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                          <span className="text-zinc-400">Void Struk:</span>
                          <strong className="text-amber-300">
                            {rLimits.voidRefundPolicy === 'allowed'
                              ? 'Bebas'
                              : rLimits.voidRefundPolicy === 'require_pin'
                              ? 'Wajib PIN'
                              : 'Ditolak'}
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-zinc-800 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRoleForBuilder(role.id);
                          setActiveTab('rbac_builder');
                        }}
                        className="flex-1 py-2 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                        <span>Konfigurasi Matriks Izin</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* =====================================================================
            TAB 3: MATRIKS SUB-FITUR LENGKAP (A-P)
           ===================================================================== */}
        {activeTab === 'sub_features' && (
          <div className="bg-[#0b101b] border border-zinc-800 rounded-2xl shadow-xl overflow-hidden flex flex-col">
            <div className="p-3.5 bg-zinc-900/90 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExpandAll(true)}
                  className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition text-[11px] font-medium cursor-pointer"
                >
                  Buka Semua Grup
                </button>
                <button
                  onClick={() => handleExpandAll(false)}
                  className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition text-[11px] font-medium cursor-pointer"
                >
                  Tutup Semua
                </button>
              </div>
              <span className="text-xs text-zinc-400">
                Centang sub-fitur spesifik untuk mengatur akses lebih rinci di setiap grup menu A–P.
              </span>
            </div>

            <div className="overflow-x-auto max-h-[calc(100vh-240px)] relative">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-[#0e1422] text-zinc-300 uppercase tracking-wider text-[11px] sticky top-0 z-30 shadow-sm">
                  <tr className="border-b border-zinc-800">
                    <th className="py-3 px-4 w-96 min-w-[340px] font-bold bg-[#0e1422] sticky left-0 z-30 border-r border-zinc-800/80">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-zinc-200">
                          <Layers className="w-4 h-4 text-amber-400" />
                          <span>Halaman &amp; Sub-Fitur</span>
                        </span>
                        <span className="font-mono text-[10px] text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded border border-zinc-700">
                          {totalItemsCount} Sub-Fitur
                        </span>
                      </div>
                    </th>

                    {roles.map((role) => {
                      const isOwner = role.terkunci || role.id === 'owner';
                      const roleGrantsCount = isOwner
                        ? totalItemsCount
                        : (grants[role.id] || []).length;
                      const roleColor = role.color || '#f59e0b';
                      const isHighlighted = highlightedRoleId === role.id;

                      return (
                        <th
                          key={role.id}
                          className={`py-3 px-3 min-w-[150px] max-w-[190px] font-bold border-r border-zinc-800/70 text-center relative group transition ${
                            isHighlighted ? 'bg-amber-950/40 ring-1 ring-amber-500/50' : 'bg-[#0e1422]'
                          }`}
                        >
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center justify-between w-full">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: roleColor }}
                              />
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenKebabRoleId(openKebabRoleId === role.id ? null : role.id);
                                  }}
                                  className="p-1 rounded text-zinc-500 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
                                >
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </button>
                                {openKebabRoleId === role.id && (
                                  <div
                                    onClick={(e) => e.stopPropagation()}
                                    className="rc-tooltip-box absolute right-0 top-6 w-48 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl py-1 z-50 text-left normal-case tracking-normal"
                                  >
                                    {!isOwner && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setRoleGrants(role.id, [...allPermissionKeys]);
                                            setOpenKebabRoleId(null);
                                            showToast(`Semua halaman diaktifkan untuk ${role.name}.`);
                                          }}
                                          className="w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white flex items-center gap-2 cursor-pointer"
                                        >
                                          <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                                          <span>Pilih Semua</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setRoleGrants(role.id, []);
                                            setOpenKebabRoleId(null);
                                            showToast(`Semua halaman dicabut untuk ${role.name}.`);
                                          }}
                                          className="w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white flex items-center gap-2 cursor-pointer"
                                        >
                                          <Square className="w-3.5 h-3.5 text-rose-400" />
                                          <span>Cabut Semua</span>
                                        </button>
                                      </>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleDuplicate(role);
                                        setOpenKebabRoleId(null);
                                      }}
                                      className="w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white flex items-center gap-2 cursor-pointer"
                                    >
                                      <Copy className="w-3.5 h-3.5 text-blue-400" />
                                      <span>Duplikat Role</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                            <span className="font-black text-white text-xs truncate max-w-full">
                              {role.name}
                            </span>
                            <div className="flex items-center gap-1 mt-0.5">
                              {isOwner ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                  <Lock className="w-2.5 h-2.5" />
                                  <span>TERKUNCI (FULL)</span>
                                </span>
                              ) : (
                                <span className="font-mono text-[10px] text-zinc-400 bg-zinc-950/80 px-2 py-0.5 rounded border border-zinc-800">
                                  {roleGrantsCount} / {totalItemsCount}
                                </span>
                              )}
                            </div>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody className="divide-y divide-zinc-800/60 font-medium">
                  {filteredGroups.map((group) => {
                    const isGroupOpen = openGroups[group.key] ?? true;

                    return (
                      <React.Fragment key={group.key}>
                        <tr className="bg-[#101726]/90 hover:bg-[#131b2e] transition border-t-2 border-zinc-800">
                          <td className="py-2.5 px-4 sticky left-0 z-20 bg-[#101726] border-r border-zinc-800">
                            <div className="flex items-center justify-between">
                              <button
                                type="button"
                                onClick={() => toggleGroup(group.key)}
                                className="flex items-center gap-2.5 text-left text-zinc-100 hover:text-amber-400 transition cursor-pointer flex-1"
                              >
                                {isGroupOpen ? (
                                  <ChevronDown className="w-4 h-4 text-amber-400 shrink-0" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" />
                                )}
                                <span className="w-5 h-5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 font-black text-[11px] flex items-center justify-center shrink-0">
                                  {group.letter}
                                </span>
                                <span className="font-bold text-xs uppercase tracking-wide text-zinc-200">
                                  {group.title}
                                </span>
                              </button>
                              <span className="font-mono text-[10px] text-zinc-400 bg-zinc-900/80 px-1.5 py-0.5 rounded border border-zinc-800 shrink-0 ml-2">
                                {group.items.length} item
                              </span>
                            </div>
                          </td>

                          {roles.map((role) => {
                            const isOwner = role.terkunci || role.id === 'owner';
                            const state = getGroupCheckState(group, role.id);

                            return (
                              <td
                                key={`${group.key}-${role.id}`}
                                className="py-2.5 px-3 text-center border-r border-zinc-800/70"
                              >
                                <div className="flex items-center justify-center">
                                  {isOwner ? (
                                    <span className="w-5 h-5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-400 flex items-center justify-center cursor-not-allowed">
                                      <Lock className="w-3 h-3" />
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const enableAll = state !== 'all';
                                        setGroupGrants(role.id, group.key, enableAll);
                                      }}
                                      className={`w-5 h-5 rounded flex items-center justify-center transition cursor-pointer ${
                                        state === 'all'
                                          ? 'bg-amber-500 text-zinc-950 border border-amber-400'
                                          : state === 'some'
                                          ? 'bg-amber-900/60 text-amber-300 border border-amber-500'
                                          : 'bg-zinc-950 border border-zinc-700 hover:border-zinc-500 text-transparent'
                                      }`}
                                    >
                                      {state === 'all' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                      {state === 'some' && <MinusSquare className="w-3.5 h-3.5" />}
                                    </button>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>

                        {isGroupOpen &&
                          group.items.map((item) => (
                            <tr
                              key={item.id}
                              className="hover:bg-zinc-900/70 transition border-b border-zinc-800/40"
                            >
                              <td className="py-2.5 px-4 pl-9 sticky left-0 z-10 bg-[#0b101b] border-r border-zinc-800">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 truncate">
                                    <span className="font-mono text-[10px] text-amber-400 font-bold bg-amber-950/60 border border-amber-900/80 px-1.5 py-0.5 rounded shrink-0">
                                      {item.id}
                                    </span>
                                    <span className="text-zinc-200 font-medium text-xs truncate">
                                      {item.title}
                                    </span>
                                  </div>
                                  <div className="relative">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setActiveTooltip(
                                          activeTooltip?.id === item.id
                                            ? null
                                            : {
                                                id: item.id,
                                                title: item.title,
                                                text: item.description,
                                                route: item.subModule
                                                  ? `/dashboard/${item.subModule}`
                                                  : `/dashboard/${item.tab}`,
                                              }
                                        )
                                      }
                                      className="p-1 rounded text-zinc-500 hover:text-amber-400 hover:bg-zinc-800 transition cursor-pointer"
                                    >
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                    {activeTooltip?.id === item.id && (
                                      <div
                                        role="tooltip"
                                        className="rc-tooltip-box absolute left-6 top-0 w-64 bg-zinc-900 border border-amber-500/40 rounded-xl p-3 shadow-2xl z-50 text-left space-y-1"
                                      >
                                        <div className="rc-tooltip-title font-bold text-white text-xs border-b border-zinc-800 pb-1">
                                          {activeTooltip.title}
                                        </div>
                                        <p className="rc-tooltip-label text-[11px] text-zinc-400 leading-relaxed">
                                          {activeTooltip.text}
                                        </p>
                                        <div className="rc-tooltip-accent font-mono text-[10px] text-amber-400 pt-0.5">
                                          Route: {activeTooltip.route}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>

                              {roles.map((role) => {
                                const isOwner = role.terkunci || role.id === 'owner';
                                const roleGrants = grants[role.id] || [];
                                const isChecked = isOwner || roleGrants.includes(item.id);

                                return (
                                  <td
                                    key={`${item.id}-${role.id}`}
                                    className="py-2.5 px-3 text-center border-r border-zinc-800/70"
                                  >
                                    <div className="flex items-center justify-center">
                                      {isOwner ? (
                                        <span className="w-5 h-5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center cursor-not-allowed opacity-80">
                                          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => toggleGrant(role.id, item.id)}
                                          className={`w-5 h-5 rounded flex items-center justify-center transition cursor-pointer ${
                                            isChecked
                                              ? 'bg-amber-500 text-zinc-950 border border-amber-400 shadow-sm'
                                              : 'bg-zinc-950 border border-zinc-700 hover:border-zinc-500 text-transparent'
                                          }`}
                                        >
                                          {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* =====================================================================
            TAB 4: KATALOG RINGKASAN IZIN
           ===================================================================== */}
        {activeTab === 'catalog' && (
          <div className="bg-[#0b101b] border border-zinc-800 rounded-2xl shadow-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-3">
                <select
                  value={catalogGroupFilter}
                  onChange={(e) => setCatalogGroupFilter(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="all">Semua Kategori Modul</option>
                  {groups.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.letter}. {g.title}
                    </option>
                  ))}
                </select>
              </div>
              <span className="text-xs text-zinc-400">
                Menampilkan seluruh halaman beserta jabatan yang berhak mengaksesnya.
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-zinc-800/80">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-[#0e1422] text-zinc-300 font-bold border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4 w-72">Halaman / Sub-Fitur</th>
                    <th className="py-3 px-4">Deskripsi &amp; Fungsi Otorisasi</th>
                    <th className="py-3 px-4 w-96">Role yang Memiliki Akses</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 font-medium">
                  {groups
                    .filter((g) => catalogGroupFilter === 'all' || g.key === catalogGroupFilter)
                    .flatMap((g) =>
                      g.items.map((item) => ({
                        ...item,
                        groupTitle: g.title,
                        groupLetter: g.letter,
                      }))
                    )
                    .filter((item) => {
                      const q = searchQuery.toLowerCase().trim();
                      if (!q) return true;
                      return (
                        item.title.toLowerCase().includes(q) ||
                        item.id.toLowerCase().includes(q) ||
                        item.description.toLowerCase().includes(q) ||
                        item.groupTitle.toLowerCase().includes(q)
                      );
                    })
                    .map((item) => {
                      const rolesWithAccess = roles.filter((role) => {
                        if (role.terkunci || role.id === 'owner') return true;
                        const roleGrants = grants[role.id] || [];
                        return roleGrants.includes(item.id);
                      });

                      return (
                        <tr key={item.id} className="hover:bg-zinc-900/50 transition">
                          <td className="py-3 px-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[10px] text-amber-400 font-bold bg-amber-950/60 border border-amber-900 px-1.5 py-0.5 rounded">
                                  {item.id}
                                </span>
                                <span className="font-bold text-white">{item.title}</span>
                              </div>
                              <p className="text-[10px] text-zinc-500">
                                {item.groupLetter}. {item.groupTitle}
                              </p>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-zinc-300 text-xs leading-relaxed">
                            {item.description}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1.5">
                              {rolesWithAccess.map((r) => (
                                <span
                                  key={r.id}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border"
                                  style={{
                                    backgroundColor: `${r.color || '#f59e0b'}15`,
                                    borderColor: `${r.color || '#f59e0b'}40`,
                                    color: r.color || '#f59e0b',
                                  }}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full"
                                    style={{ backgroundColor: r.color || '#f59e0b' }}
                                  />
                                  <span>{r.name}</span>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 3. MODAL: + TAMBAH ROLE / JABATAN BARU */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0c111d] border border-amber-500/40 rounded-2xl w-full max-w-lg shadow-2xl p-6 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-400">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-white text-base">Tambah Role / Jabatan Baru</h3>
                  <p className="text-xs text-zinc-400">
                    Tersimpan langsung ke koleksi Firestore <code className="text-amber-300">rbac_roles</code>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddRoleSubmit} className="space-y-4 pt-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-zinc-300 mb-1">
                    Nama Role / Jabatan <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: Kepala Gudang, Supervisor Kasir..."
                    value={newRoleName}
                    onChange={(e) => {
                      setNewRoleName(e.target.value);
                      if (!newRoleCode) {
                        setNewRoleCode(
                          e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 20)
                        );
                      }
                    }}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-zinc-300 mb-1">Kode Role (Unik)</label>
                  <input
                    type="text"
                    placeholder="Contoh: HEAD_WAREHOUSE"
                    value={newRoleCode}
                    onChange={(e) =>
                      setNewRoleCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 font-mono text-amber-300 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-zinc-300 mb-1">
                  Deskripsi Tugas &amp; Tanggung Jawab
                </label>
                <textarea
                  rows={2}
                  placeholder="Jelaskan wewenang dan tanggung jawab jabatan ini..."
                  value={newRoleDesc}
                  onChange={(e) => setNewRoleDesc(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-zinc-300 mb-1">
                    Level Otoritas (1-99)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={newRoleLevel}
                    onChange={(e) => setNewRoleLevel(Number(e.target.value || 50))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-zinc-300 mb-1">Warna Badge</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={newRoleColor}
                      onChange={(e) => setNewRoleColor(e.target.value)}
                      className="w-9 h-9 rounded-lg bg-zinc-950 border border-zinc-800 cursor-pointer p-0.5"
                    />
                    <span className="font-mono text-xs text-zinc-400">{newRoleColor}</span>
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-zinc-300 mb-1">Salin Template Dari</label>
                  <select
                    value={newRoleCopyFrom}
                    onChange={(e) => setNewRoleCopyFrom(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-2 text-white focus:outline-none focus:border-amber-500"
                  >
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-black shadow-lg transition cursor-pointer"
                >
                  Simpan &amp; Tambah Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. MODAL: + TAMBAH ATURAN OTORITAS BARU */}
      {isAddRuleModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0c111d] border border-amber-500/40 rounded-2xl w-full max-w-lg shadow-2xl p-6 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-400">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-white text-base">Tambah Aturan Otoritas Baru</h3>
                  <p className="text-xs text-zinc-400">
                    Tersimpan langsung ke koleksi Firestore <code className="text-amber-300">rbac_rules</code>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAddRuleModalOpen(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddRuleSubmit} className="space-y-4 pt-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-zinc-300 mb-1">
                    Nama Aturan Otoritas <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: Wajib PIN untuk Hapus Produk..."
                    value={ruleTitle}
                    onChange={(e) => setRuleTitle(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-zinc-300 mb-1">Kode Aturan</label>
                  <input
                    type="text"
                    placeholder="Contoh: RULE_DELETE_PRODUCT_PIN"
                    value={ruleCode}
                    onChange={(e) =>
                      setRuleCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 font-mono text-amber-300 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-zinc-300 mb-1">Deskripsi Kebijakan</label>
                <textarea
                  rows={2}
                  placeholder="Penjelasan teknis aturan otoritas dan dampaknya..."
                  value={ruleDesc}
                  onChange={(e) => setRuleDesc(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-zinc-300 mb-1">Modul Ekosistem Target</label>
                  <select
                    value={ruleModuleId}
                    onChange={(e) => setRuleModuleId(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  >
                    {ecosystemModules.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-zinc-300 mb-1">Jenis Aksi / Proteksi</label>
                  <select
                    value={ruleActionType}
                    onChange={(e) => setRuleActionType(e.target.value as any)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="pin_override">Wajib Otorisasi PIN Supervisor</option>
                    <option value="limit_threshold">Batas Persentase / Nilai Maksimal</option>
                    <option value="view">Pembatasan Lihat Halaman (View)</option>
                    <option value="create">Pembatasan Tambah Data (Create)</option>
                    <option value="update">Pembatasan Edit Data (Update)</option>
                    <option value="delete">Pembatasan Hapus Data (Delete)</option>
                    <option value="approve">Wewenang Approval Khusus</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-zinc-300 mb-1.5">
                  Pilih Jabatan (Role) yang Dikenakan Aturan Ini:
                </label>
                <div className="flex flex-wrap gap-1.5 p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  {roles
                    .filter((r) => r.id !== 'owner')
                    .map((r) => {
                      const selected = ruleRoleIds.includes(r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setRuleRoleIds((prev) =>
                              prev.includes(r.id)
                                ? prev.filter((id) => id !== r.id)
                                : [...prev, r.id]
                            );
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                            selected
                              ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                              : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                          }`}
                        >
                          {r.name}
                        </button>
                      );
                    })}
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                <div>
                  <span className="font-bold text-white block">Wajib Verifikasi PIN 6-Digit Supervisor/Owner</span>
                  <span className="text-[11px] text-zinc-400">
                    Meminta pop-up PIN otorisasi saat staf menjalankan aksi ini
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={ruleRequirePin}
                  onChange={(e) => setRuleRequirePin(e.target.checked)}
                  className="w-4 h-4 accent-amber-500 cursor-pointer"
                />
              </div>

              <div className="pt-4 border-t border-zinc-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddRuleModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-black shadow-lg transition cursor-pointer"
                >
                  Simpan Aturan Otoritas
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. MODAL: EDIT ROLE */}
      {editRoleTarget && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0c111d] border border-amber-500/40 rounded-2xl w-full max-w-md shadow-2xl p-6 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Edit Role: {editRoleTarget.name}</h3>
                  <p className="text-xs text-zinc-400">Perbarui identitas, level otoritas, dan warna badge</p>
                </div>
              </div>
              <button
                onClick={() => setEditRoleTarget(null)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditRoleSubmit} className="space-y-4 pt-4 text-xs">
              <div>
                <label className="block font-bold text-zinc-300 mb-1">
                  Nama Role <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editRoleName}
                  onChange={(e) => setEditRoleName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-zinc-300 mb-1">Kode Role</label>
                  <input
                    type="text"
                    value={editRoleCode}
                    onChange={(e) => setEditRoleCode(e.target.value.toUpperCase())}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 font-mono text-amber-300 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-zinc-300 mb-1">Level Otoritas</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    disabled={editRoleTarget.id === 'owner'}
                    value={editRoleLevel}
                    onChange={(e) => setEditRoleLevel(Number(e.target.value || 50))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 font-mono text-white focus:outline-none focus:border-amber-500 disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-zinc-300 mb-1">
                  Deskripsi Tanggung Jawab
                </label>
                <textarea
                  rows={2}
                  value={editRoleDesc}
                  onChange={(e) => setEditRoleDesc(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-zinc-300 mb-1">Warna Badge</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={editRoleColor}
                    onChange={(e) => setEditRoleColor(e.target.value)}
                    className="w-8 h-8 rounded-lg bg-zinc-950 border border-zinc-800 cursor-pointer p-0.5"
                  />
                  <span className="font-mono text-xs text-zinc-400">{editRoleColor}</span>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditRoleTarget(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black shadow-md transition cursor-pointer"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. MODAL: KONFIRMASI HAPUS ROLE */}
      {deleteRoleTarget && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm shadow-2xl p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-white text-base">Hapus Role Ini?</h3>
            <p className="text-xs text-zinc-400 mt-1 mb-5">
              Apakah Anda yakin ingin menghapus role <strong>&quot;{deleteRoleTarget.name}&quot;</strong> dari koleksi Firestore `rbac_roles`?
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setDeleteRoleTarget(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleDeleteRole}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition cursor-pointer"
              >
                Ya, Hapus Role
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. MODAL: KONFIRMASI RESET DEFAULT */}
      {isResetConfirmOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm shadow-2xl p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto mb-3">
              <RotateCcw className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-white text-base">Reset ke Pengaturan Default?</h3>
            <p className="text-xs text-zinc-400 mt-1 mb-5">
              Tindakan ini akan mengembalikan daftar role beserta matriks otoritas `rbac_roles` &amp; `rbac_rules` ke konfigurasi standar RiskCart.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setIsResetConfirmOpen(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={async () => {
                  await resetToDefault();
                  setIsResetConfirmOpen(false);
                  showToast('Otoritas Akses berhasil dikembalikan ke standar pabrik.');
                }}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xs transition cursor-pointer"
              >
                Ya, Reset Standar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. FLOATING TOAST NOTIFICATION */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4">
          <div
            className={`px-4 py-3 rounded-2xl border shadow-2xl flex items-center gap-2.5 text-xs font-bold backdrop-blur-md ${
              toastMessage.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-600 text-emerald-200'
                : toastMessage.type === 'error'
                ? 'bg-rose-950/90 border-rose-600 text-rose-200'
                : 'bg-amber-950/90 border-amber-500 text-amber-200'
            }`}
          >
            {toastMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {toastMessage.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
            {toastMessage.type === 'info' && <Info className="w-4 h-4 text-amber-400 shrink-0" />}
            <span>{toastMessage.text}</span>
          </div>
        </div>
      )}
    </div>
  );
};
export default HakDanAksesView;
