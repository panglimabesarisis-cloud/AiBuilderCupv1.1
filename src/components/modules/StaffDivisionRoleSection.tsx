import React, { useState, useMemo } from 'react';
import {
  Users,
  ChefHat,
  Briefcase,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  Search,
  Shield,
  Clock,
  MapPin,
  Sparkles,
  X,
  UserPlus,
  Layers,
  Utensils,
} from 'lucide-react';
import {
  useStaffDivisionsAndRoles,
  StaffDivision,
  StaffRolePreset,
  StaffDivisionMember,
  getRoleBadgeThemeClasses,
} from '../../services/staffDivisionService';
import { useTheme } from '../../context/ThemeContext';

interface StaffDivisionRoleSectionProps {
  onNavigateTab?: (tab: string) => void;
}

export const StaffDivisionRoleSection: React.FC<StaffDivisionRoleSectionProps> = ({
  onNavigateTab,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const {
    divisions,
    roster,
    kitchenStaffOnDuty,
    addOrUpdateDivision,
    removeDivision,
    addRoleToDivision,
    removeRoleFromDivision,
    saveMember,
    removeMember,
    toggleMemberOnDuty,
  } = useStaffDivisionsAndRoles();

  const [selectedDivisionFilter, setSelectedDivisionFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Modal State: Tambah / Edit Divisi
  const [showDivisionModal, setShowDivisionModal] = useState<boolean>(false);
  const [editingDivision, setEditingDivision] = useState<StaffDivision | null>(null);
  const [divNameInput, setDivNameInput] = useState<string>('');
  const [divShortNameInput, setDivShortNameInput] = useState<string>('');
  const [divDescInput, setDivDescInput] = useState<string>('');
  const [divAccentInput, setDivAccentInput] = useState<
    'amber' | 'emerald' | 'blue' | 'purple' | 'cyan' | 'rose' | 'teal'
  >('amber');

  // Modal State: Tambah / Edit Role di dalam Divisi
  const [showRoleModal, setShowRoleModal] = useState<boolean>(false);
  const [roleTargetDivisionId, setRoleTargetDivisionId] = useState<string>('div_kitchen');
  const [editingRoleObj, setEditingRoleObj] = useState<StaffRolePreset | null>(null);
  const [roleNameInput, setRoleNameInput] = useState<string>('');
  const [roleDescInput, setRoleDescInput] = useState<string>('');
  const [roleStationInput, setRoleStationInput] = useState<string>('');
  const [roleBadgeCategoryInput, setRoleBadgeCategoryInput] = useState<
    StaffRolePreset['badgeCategory']
  >('culinary');

  // Modal State: Tambah / Edit Staff & Penugasan Shift Divisi
  const [showStaffModal, setShowStaffModal] = useState<boolean>(false);
  const [editingMember, setEditingMember] = useState<StaffDivisionMember | null>(null);
  const [memberName, setMemberName] = useState<string>('');
  const [memberEmail, setMemberEmail] = useState<string>('');
  const [memberPhone, setMemberPhone] = useState<string>('');
  const [memberPin, setMemberPin] = useState<string>('123456');
  const [memberDivisionId, setMemberDivisionId] = useState<string>('div_kitchen');
  const [memberRole, setMemberRole] = useState<string>('Executive Chef');
  const [memberStation, setMemberStation] = useState<string>('Pass & Command Center');
  const [memberShift, setMemberShift] = useState<string>('Pagi (07:30 - 15:00)');
  const [memberOutlet, setMemberOutlet] = useState<string>('Cabang Utama (Pusat)');
  const [memberOnDuty, setMemberOnDuty] = useState<boolean>(true);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  // Dynamic roles for selected division in Staff Modal
  const availableRolesForSelectedDivision = useMemo(() => {
    const found = divisions.find((d) => d.id === memberDivisionId);
    return found ? found.roles : [];
  }, [divisions, memberDivisionId]);

  const handleChangeMemberDivision = (newDivId: string) => {
    setMemberDivisionId(newDivId);
    const targetDiv = divisions.find((d) => d.id === newDivId);
    if (targetDiv && targetDiv.roles.length > 0) {
      const firstRole = targetDiv.roles[0];
      setMemberRole(firstRole.name);
      setMemberStation(firstRole.defaultStation || 'Operasional Utama');
    } else {
      setMemberRole('');
    }
  };

  const handleChangeMemberRole = (newRoleName: string) => {
    setMemberRole(newRoleName);
    const targetDiv = divisions.find((d) => d.id === memberDivisionId);
    const matchedRole = targetDiv?.roles.find((r) => r.name === newRoleName);
    if (matchedRole?.defaultStation) {
      setMemberStation(matchedRole.defaultStation);
    }
  };

  // Open Modals Helpers
  const openAddDivisionModal = () => {
    setEditingDivision(null);
    setDivNameInput('');
    setDivShortNameInput('');
    setDivDescInput('');
    setDivAccentInput('amber');
    setShowDivisionModal(true);
  };

  const openEditDivisionModal = (div: StaffDivision) => {
    setEditingDivision(div);
    setDivNameInput(div.name);
    setDivShortNameInput(div.shortName);
    setDivDescInput(div.description);
    setDivAccentInput(div.accentColor || 'amber');
    setShowDivisionModal(true);
  };

  const handleSaveDivision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!divNameInput.trim()) return;
    const id =
      editingDivision?.id ||
      `div_${divNameInput
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString().slice(-4)}`;
    const nextDiv: StaffDivision = {
      id,
      code: editingDivision?.code || id.replace(/^div_/, ''),
      name: divNameInput.trim(),
      shortName: divShortNameInput.trim() || divNameInput.trim(),
      description:
        divDescInput.trim() || 'Divisi operasional staf dan penugasan shift.',
      accentColor: divAccentInput,
      roles: editingDivision?.roles || [],
    };
    await addOrUpdateDivision(nextDiv);
    setShowDivisionModal(false);
    showToast(`Divisi "${nextDiv.name}" berhasil disimpan ke database!`);
  };

  const openAddRoleModal = (divisionId?: string) => {
    const targetId = divisionId || (selectedDivisionFilter !== 'ALL' ? selectedDivisionFilter : 'div_kitchen');
    setEditingRoleObj(null);
    setRoleTargetDivisionId(targetId);
    setRoleNameInput('');
    setRoleDescInput('');
    setRoleStationInput('');
    setRoleBadgeCategoryInput(targetId === 'div_kitchen' ? 'culinary' : 'service');
    setShowRoleModal(true);
  };

  const openEditRoleModal = (divisionId: string, role: StaffRolePreset) => {
    setEditingRoleObj(role);
    setRoleTargetDivisionId(divisionId);
    setRoleNameInput(role.name);
    setRoleDescInput(role.description);
    setRoleStationInput(role.defaultStation || '');
    setRoleBadgeCategoryInput(role.badgeCategory || 'culinary');
    setShowRoleModal(true);
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleNameInput.trim()) return;
    const rolePayload: StaffRolePreset = {
      id:
        editingRoleObj?.id ||
        `role_${roleNameInput
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString().slice(-4)}`,
      name: roleNameInput.trim(),
      description:
        roleDescInput.trim() || 'Jabatan operasional staf pada divisi terkait.',
      badgeCategory: roleBadgeCategoryInput,
      defaultStation: roleStationInput.trim() || 'Operasional Utama',
      isCustom: true,
    };
    await addRoleToDivision(roleTargetDivisionId, rolePayload);
    setShowRoleModal(false);
    const divName =
      divisions.find((d) => d.id === roleTargetDivisionId)?.name || 'Divisi';
    showToast(`Role "${rolePayload.name}" berhasil disimpan pada ${divName}!`);
  };

  const openAddStaffModal = (presetDivisionId?: string, presetRoleName?: string) => {
    const divId =
      presetDivisionId ||
      (selectedDivisionFilter !== 'ALL' ? selectedDivisionFilter : 'div_kitchen');
    const divObj = divisions.find((d) => d.id === divId) || divisions[0];
    const defaultRoleObj =
      divObj?.roles.find((r) => r.name === presetRoleName) || divObj?.roles[0];

    setEditingMember(null);
    setMemberName('');
    setMemberEmail('');
    setMemberPhone('+62 812-');
    setMemberPin(String(Math.floor(100000 + Math.random() * 900000)));
    setMemberDivisionId(divObj?.id || 'div_kitchen');
    setMemberRole(defaultRoleObj?.name || 'Executive Chef');
    setMemberStation(defaultRoleObj?.defaultStation || 'Pass & Command Center');
    setMemberShift('Pagi (07:30 - 15:00)');
    setMemberOutlet('Cabang Utama (Pusat)');
    setMemberOnDuty(true);
    setShowStaffModal(true);
  };

  const openEditStaffModal = (member: StaffDivisionMember) => {
    setEditingMember(member);
    setMemberName(member.name);
    setMemberEmail(member.email);
    setMemberPhone(member.phone);
    setMemberPin(member.pin || '123456');
    setMemberDivisionId(member.divisionId || 'div_kitchen');
    setMemberRole(member.role);
    setMemberStation(member.station || 'Operasional Utama');
    setMemberShift(member.shift || 'Pagi (07:30 - 15:00)');
    setMemberOutlet(member.outlet || 'Cabang Utama (Pusat)');
    setMemberOnDuty(member.onDuty);
    setShowStaffModal(true);
  };

  const handleSaveStaffMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberName.trim() || !memberRole.trim()) return;
    const divObj = divisions.find((d) => d.id === memberDivisionId);
    const saved = await saveMember({
      id: editingMember?.id,
      name: memberName.trim(),
      email: memberEmail.trim(),
      phone: memberPhone.trim(),
      pin: memberPin.trim(),
      divisionId: memberDivisionId,
      divisionName: divObj?.name || 'Divisi Kitchen (Dapur)',
      role: memberRole.trim(),
      station: memberStation.trim() || 'Operasional Utama',
      shift: memberShift,
      outlet: memberOutlet,
      onDuty: memberOnDuty,
      status: 'active',
    });
    setShowStaffModal(false);
    showToast(
      `Staff "${saved.name}" (${saved.role} - ${saved.divisionName}) berhasil disimpan & disinkronkan!`
    );
  };

  // Filtered divisions & roster
  const filteredDivisions = useMemo(() => {
    return divisions.filter((div) => {
      if (selectedDivisionFilter !== 'ALL' && div.id !== selectedDivisionFilter) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      if (
        div.name.toLowerCase().includes(q) ||
        div.description.toLowerCase().includes(q)
      ) {
        return true;
      }
      return div.roles.some(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          (r.defaultStation || '').toLowerCase().includes(q)
      );
    });
  }, [divisions, selectedDivisionFilter, searchQuery]);

  const filteredRoster = useMemo(() => {
    return roster.filter((m) => {
      if (selectedDivisionFilter !== 'ALL' && m.divisionId !== selectedDivisionFilter) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q) ||
        m.divisionName.toLowerCase().includes(q) ||
        (m.station || '').toLowerCase().includes(q) ||
        (m.shift || '').toLowerCase().includes(q)
      );
    });
  }, [roster, selectedDivisionFilter, searchQuery]);

  const totalRolesCount = useMemo(
    () => divisions.reduce((sum, d) => sum + d.roles.length, 0),
    [divisions]
  );

  const totalOnDutyCount = useMemo(
    () => roster.filter((m) => m.onDuty).length,
    [roster]
  );

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMsg && (
        <div
          className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 text-xs font-bold shadow-lg animate-in fade-in ${
            isDark
              ? 'bg-emerald-950/90 border-emerald-700 text-emerald-200'
              : 'bg-emerald-50 border-emerald-300 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>{toastMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMsg(null)}
            className="text-xs font-bold px-2 py-0.5 rounded hover:bg-black/10 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Banner & Action Header */}
      <div
        className={`rounded-2xl border p-5 sm:p-6 ${
          isDark
            ? 'bg-zinc-900/95 border-zinc-800'
            : 'bg-white border-slate-200 shadow-sm'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${
                  isDark
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                    : 'bg-amber-100 text-amber-900 border-amber-300'
                }`}
              >
                MASTER DIVISI &amp; ROLE F&amp;B / RETAIL
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold border ${
                  isDark
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                    : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                }`}
              >
                LIVE SYNC KE /KITCHEN &amp; POS
              </span>
            </div>
            <h2
              className={`text-lg sm:text-xl font-black tracking-tight ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            >
              Manajemen Divisi Staff &amp; Role Jabatan Operasional
            </h2>
            <p
              className={`text-xs leading-relaxed max-w-3xl ${
                isDark ? 'text-zinc-400' : 'text-slate-600'
              }`}
            >
              Kelola struktur organisasi per divisi (<strong>Divisi Kitchen / Dapur</strong>,{' '}
              <strong>Service / Floor</strong>, <strong>Bar &amp; Beverage</strong>,{' '}
              <strong>Front Office / Kasir</strong>, dan <strong>Warehouse / Gudang</strong>).
              Seluruh perubahan otomatis tersinkronisasi ke halaman{' '}
              <span className="font-mono font-bold text-amber-500">/kitchen</span>,{' '}
              <span className="font-mono font-bold text-emerald-500">/waiters/pos</span>, dan{' '}
              <span className="font-mono font-bold text-blue-500">/dashboard/pos</span>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={openAddDivisionModal}
              className={`px-3.5 py-2.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition cursor-pointer ${
                isDark
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-amber-500" />
              <span>+ Tambah Divisi Baru</span>
            </button>

            <button
              type="button"
              onClick={() => openAddRoleModal()}
              className="px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition shadow-sm cursor-pointer"
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>+ Tambah Role / Jabatan</span>
            </button>

            <button
              type="button"
              onClick={() => openAddStaffModal()}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition shadow-md cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>+ Tugaskan Staff &amp; Shift</span>
            </button>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mt-5 pt-5 border-t border-zinc-800/60">
          <div
            className={`p-4 rounded-xl border ${
              isDark
                ? 'bg-zinc-950/70 border-zinc-800'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${
                  isDark ? 'text-zinc-400' : 'text-slate-500'
                }`}
              >
                Total Divisi Aktif
              </span>
              <Layers className="w-4 h-4 text-blue-500" />
            </div>
            <div
              className={`text-xl font-black font-mono mt-1 ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            >
              {divisions.length} Divisi
            </div>
            <div
              className={`text-[11px] mt-0.5 ${
                isDark ? 'text-zinc-500' : 'text-slate-500'
              }`}
            >
              {totalRolesCount} jabatan standar &amp; custom
            </div>
          </div>

          <div
            className={`p-4 rounded-xl border ${
              isDark
                ? 'bg-amber-950/20 border-amber-500/30'
                : 'bg-amber-50/80 border-amber-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${
                  isDark ? 'text-amber-300' : 'text-amber-800'
                }`}
              >
                Tim Divisi Kitchen (Dapur)
              </span>
              <ChefHat className="w-4 h-4 text-amber-500" />
            </div>
            <div
              className={`text-xl font-black font-mono mt-1 ${
                isDark ? 'text-amber-300' : 'text-amber-900'
              }`}
            >
              {kitchenStaffOnDuty.length} Chef &amp; Kru Aktif
            </div>
            <div
              className={`text-[11px] mt-0.5 ${
                isDark ? 'text-amber-200/70' : 'text-amber-700'
              }`}
            >
              Tersinkron ke halaman Dapur (/kitchen)
            </div>
          </div>

          <div
            className={`p-4 rounded-xl border ${
              isDark
                ? 'bg-emerald-950/20 border-emerald-500/30'
                : 'bg-emerald-50/80 border-emerald-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${
                  isDark ? 'text-emerald-300' : 'text-emerald-800'
                }`}
              >
                Staff Bertugas (Shift Aktif)
              </span>
              <Clock className="w-4 h-4 text-emerald-500" />
            </div>
            <div
              className={`text-xl font-black font-mono mt-1 ${
                isDark ? 'text-emerald-400' : 'text-emerald-800'
              }`}
            >
              {totalOnDutyCount} / {roster.length} Staff
            </div>
            <div
              className={`text-[11px] mt-0.5 ${
                isDark ? 'text-emerald-200/70' : 'text-emerald-700'
              }`}
            >
              Siap bertugas di POS, Floor &amp; Dapur
            </div>
          </div>

          <div
            className={`p-4 rounded-xl border ${
              isDark
                ? 'bg-purple-950/20 border-purple-500/30'
                : 'bg-purple-50/80 border-purple-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${
                  isDark ? 'text-purple-300' : 'text-purple-800'
                }`}
              >
                Expediter &amp; Pass KDS
              </span>
              <Utensils className="w-4 h-4 text-purple-500" />
            </div>
            <div
              className={`text-sm font-black truncate mt-1.5 ${
                isDark ? 'text-purple-200' : 'text-purple-900'
              }`}
            >
              {kitchenStaffOnDuty.find((k) =>
                k.role.toLowerCase().includes('expediter')
              )?.name ||
                kitchenStaffOnDuty[0]?.name ||
                'Siap Ditugaskan'}
            </div>
            <div className="flex items-center justify-between mt-1">
              <span
                className={`text-[11px] ${
                  isDark ? 'text-purple-300/70' : 'text-purple-700'
                }`}
              >
                Koordinator tiket /kitchen
              </span>
              {onNavigateTab && (
                <button
                  type="button"
                  onClick={() => onNavigateTab('kitchen')}
                  className="text-[10px] font-bold underline text-purple-400 hover:text-purple-300 cursor-pointer"
                >
                  Buka /kitchen →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar per Divisi + Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSelectedDivisionFilter('ALL')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer border ${
              selectedDivisionFilter === 'ALL'
                ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                : isDark
                ? 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            Semua Divisi ({divisions.length})
          </button>
          {divisions.map((div) => {
            const activeCount = roster.filter(
              (m) => m.divisionId === div.id && m.onDuty
            ).length;
            const isSelected = selectedDivisionFilter === div.id;
            return (
              <button
                key={div.id}
                type="button"
                onClick={() => setSelectedDivisionFilter(div.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer border flex items-center gap-2 ${
                  isSelected
                    ? 'bg-amber-500 text-zinc-950 border-amber-400 shadow-sm font-black'
                    : isDark
                    ? 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <span>{div.shortName || div.name}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                    isSelected
                      ? 'bg-zinc-950 text-amber-300'
                      : isDark
                      ? 'bg-zinc-800 text-emerald-400'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {activeCount} aktif
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full md:w-72 shrink-0">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari role, nama chef, stasiun..."
            className={`w-full rounded-xl pl-8 pr-8 py-2 text-xs border focus:outline-none focus:border-blue-500 ${
              isDark
                ? 'bg-zinc-900 border-zinc-800 text-white placeholder-zinc-500'
                : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
            }`}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white text-xs cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Division Cards & Roles Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {filteredDivisions.map((div) => {
          const divMembers = roster.filter((m) => m.divisionId === div.id);
          const divActiveCount = divMembers.filter((m) => m.onDuty).length;
          const isKitchenDiv =
            div.id === 'div_kitchen' || div.code === 'kitchen';

          return (
            <div
              key={div.id}
              className={`rounded-2xl border p-5 flex flex-col justify-between transition ${
                isDark
                  ? isKitchenDiv
                    ? 'bg-zinc-900/95 border-amber-500/40 shadow-[0_0_25px_rgba(245,158,11,0.06)]'
                    : 'bg-zinc-900/95 border-zinc-800'
                  : isKitchenDiv
                  ? 'bg-white border-amber-300 shadow-sm'
                  : 'bg-white border-slate-200 shadow-sm'
              }`}
            >
              <div>
                {/* Card Header */}
                <div className="flex flex-wrap items-start justify-between gap-3 pb-3.5 border-b border-zinc-800/60">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3
                        className={`text-base font-black ${
                          isDark ? 'text-white' : 'text-slate-900'
                        }`}
                      >
                        {div.name}
                      </h3>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          isDark
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                            : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        }`}
                      >
                        {divActiveCount} Staff Aktif / {divMembers.length} Total
                      </span>
                    </div>
                    <p
                      className={`text-xs leading-relaxed ${
                        isDark ? 'text-zinc-400' : 'text-slate-600'
                      }`}
                    >
                      {div.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => openAddRoleModal(div.id)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border flex items-center gap-1 transition cursor-pointer ${
                        isDark
                          ? 'bg-zinc-800 hover:bg-zinc-700 text-blue-300 border-zinc-700'
                          : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                      }`}
                      title="Tambah Role / Jabatan ke Divisi Ini"
                    >
                      <Plus className="w-3 h-3" />
                      <span>+ Role</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openAddStaffModal(div.id)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border flex items-center gap-1 transition cursor-pointer ${
                        isDark
                          ? 'bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-300 border-emerald-800'
                          : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                      }`}
                      title="Tugaskan Staff ke Divisi Ini"
                    >
                      <UserPlus className="w-3 h-3" />
                      <span>+ Staff</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditDivisionModal(div)}
                      className={`p-1.5 rounded-lg border transition cursor-pointer ${
                        isDark
                          ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                      }`}
                      title="Edit Divisi"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {![
                      'div_kitchen',
                      'div_service',
                      'div_bar',
                      'div_cashier',
                      'div_warehouse',
                    ].includes(div.id) && (
                      <button
                        type="button"
                        onClick={() => removeDivision(div.id)}
                        className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 transition cursor-pointer"
                        title="Hapus Divisi Custom"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Roles List inside Division */}
                <div className="mt-4 space-y-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span
                      className={`font-bold uppercase tracking-wider ${
                        isDark ? 'text-zinc-400' : 'text-slate-500'
                      }`}
                    >
                      Daftar Role / Jabatan ({div.roles.length} Jabatan)
                    </span>
                    {isKitchenDiv && (
                      <span
                        className={`text-[10px] font-semibold ${
                          isDark ? 'text-amber-300' : 'text-amber-700'
                        }`}
                      >
                        Standar Brigade de Cuisine (F&amp;B Kitchen)
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {div.roles.map((role) => {
                      const badgeTheme = getRoleBadgeThemeClasses(role.name, isDark);
                      const roleMembers = divMembers.filter(
                        (m) => m.role.toLowerCase() === role.name.toLowerCase()
                      );

                      return (
                        <div
                          key={role.id || role.name}
                          className={`p-3 rounded-xl border flex flex-col justify-between gap-2 transition ${
                            isDark
                              ? 'bg-zinc-950/80 border-zinc-800/90 hover:border-zinc-700'
                              : 'bg-slate-50/90 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold border ${badgeTheme.badgeClass}`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${badgeTheme.dotClass}`}
                                />
                                <span>{role.name}</span>
                              </span>

                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => openEditRoleModal(div.id, role)}
                                  className={`p-1 rounded hover:bg-zinc-800/60 transition cursor-pointer ${
                                    isDark
                                      ? 'text-zinc-400 hover:text-white'
                                      : 'text-slate-500 hover:text-slate-900'
                                  }`}
                                  title="Edit Role"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeRoleFromDivision(div.id, role.id || role.name)}
                                  className="p-1 rounded text-zinc-500 hover:text-rose-400 transition cursor-pointer"
                                  title="Hapus Role"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>

                            <p
                              className={`text-[11px] mt-1.5 leading-snug ${
                                isDark ? 'text-zinc-400' : 'text-slate-600'
                              }`}
                            >
                              {role.description}
                            </p>
                          </div>

                          <div className="pt-2 border-t border-zinc-800/40 flex items-center justify-between gap-2 text-[10px]">
                            <span
                              className={`truncate flex items-center gap-1 ${
                                isDark ? 'text-zinc-500' : 'text-slate-500'
                              }`}
                              title={role.defaultStation || 'Operasional'}
                            >
                              <MapPin className="w-3 h-3 shrink-0" />
                              <span className="truncate">
                                {role.defaultStation || 'Area Operasional'}
                              </span>
                            </span>

                            <button
                              type="button"
                              onClick={() => openAddStaffModal(div.id, role.name)}
                              className={`px-2 py-0.5 rounded font-bold shrink-0 cursor-pointer transition ${
                                roleMembers.length > 0
                                  ? isDark
                                    ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/70'
                                    : 'bg-emerald-100 text-emerald-800'
                                  : isDark
                                  ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                                  : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                              }`}
                              title="Klik untuk menugaskan staff ke jabatan ini"
                            >
                              {roleMembers.length > 0
                                ? `${roleMembers.length} Staff`
                                : '+ Isi Posisi'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Table: Daftar Staff & Jadwal Shift Aktif Per Divisi */}
      <div
        className={`rounded-2xl border overflow-hidden ${
          isDark
            ? 'bg-zinc-900/95 border-zinc-800'
            : 'bg-white border-slate-200 shadow-sm'
        }`}
      >
        <div className="p-5 border-b border-zinc-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-500" />
              <h3
                className={`text-sm font-black uppercase tracking-wider ${
                  isDark ? 'text-white' : 'text-slate-900'
                }`}
              >
                Roster Penugasan Shift Staff &amp; Stasiun Kerja ({filteredRoster.length} Staff)
              </h3>
            </div>
            <p
              className={`text-xs mt-0.5 ${
                isDark ? 'text-zinc-400' : 'text-slate-600'
              }`}
            >
              Klik status <strong>Shift Aktif (On-Duty)</strong> untuk mengaktifkan/menonaktifkan petugas pada layar Dapur{' '}
              <code className="font-mono text-amber-500">/kitchen</code>, Waiter POS, dan Kasir POS secara real-time.
            </p>
          </div>

          <button
            type="button"
            onClick={() => openAddStaffModal()}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer w-fit shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Tambah Staff ke Shift</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead
              className={`uppercase text-[10px] tracking-wider border-b ${
                isDark
                  ? 'bg-zinc-950/90 text-zinc-400 border-zinc-800'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}
            >
              <tr>
                <th className="py-3 px-4">Nama Staff</th>
                <th className="py-3 px-4">Divisi</th>
                <th className="py-3 px-4">Role / Jabatan</th>
                <th className="py-3 px-4">Stasiun / Area Kerja</th>
                <th className="py-3 px-4">Jadwal Shift</th>
                <th className="py-3 px-4 text-center">Status Shift</th>
                <th className="py-3 px-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody
              className={`divide-y ${
                isDark
                  ? 'divide-zinc-800/60 text-zinc-200'
                  : 'divide-slate-200 text-slate-700'
              }`}
            >
              {filteredRoster.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-zinc-500">
                    Belum ada staff pada filter divisi ini. Klik &quot;+ Tambah Staff ke Shift&quot; untuk menambahkan.
                  </td>
                </tr>
              ) : (
                filteredRoster.map((member) => {
                  const badge = getRoleBadgeThemeClasses(member.role, isDark);
                  return (
                    <tr
                      key={member.id}
                      className={`transition ${
                        isDark ? 'hover:bg-zinc-800/40' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div
                          className={`font-bold ${
                            isDark ? 'text-white' : 'text-slate-900'
                          }`}
                        >
                          {member.name}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-mono">
                          {member.email} &bull; PIN: {member.pin || '123456'}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-semibold">
                        {member.divisionName}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-bold border ${badge.badgeClass}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${badge.dotClass}`}
                          />
                          {member.role}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 text-[11px]">
                          <MapPin className="w-3 h-3 text-amber-500 shrink-0" />
                          <span>{member.station || 'Operasional Utama'}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px]">
                        {member.shift}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => toggleMemberOnDuty(member.id)}
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition cursor-pointer inline-flex items-center gap-1.5 ${
                            member.onDuty
                              ? isDark
                                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700 hover:bg-emerald-900'
                                : 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200'
                              : isDark
                              ? 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                              : 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200'
                          }`}
                          title="Klik untuk ubah status bertugas (On-Duty / Off-Shift)"
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              member.onDuty ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'
                            }`}
                          />
                          <span>{member.onDuty ? 'BERTUGAS (ON-DUTY)' : 'OFF-SHIFT'}</span>
                        </button>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditStaffModal(member)}
                            className={`p-1.5 rounded-lg transition cursor-pointer ${
                              isDark
                                ? 'bg-zinc-800 hover:bg-amber-950/80 text-zinc-300 hover:text-amber-300'
                                : 'bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-800'
                            }`}
                            title="Edit Staff, Divisi & Role"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeMember(member.id)}
                            className={`p-1.5 rounded-lg transition cursor-pointer ${
                              isDark
                                ? 'bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400'
                                : 'bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-700'
                            }`}
                            title="Hapus Staff"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL 1: TAMBAH / EDIT DIVISI BARU */}
      {showDivisionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl space-y-4 ${
              isDark
                ? 'bg-zinc-900 border-zinc-800 text-white'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800/60">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-500" />
                <h3 className="text-base font-black">
                  {editingDivision ? 'Edit Divisi Staff' : 'Tambah Divisi Staff Baru'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDivisionModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveDivision} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold mb-1">Nama Divisi Lengkap *</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Divisi Kitchen (Dapur) / Divisi Bakery"
                  value={divNameInput}
                  onChange={(e) => setDivNameInput(e.target.value)}
                  className={`w-full rounded-xl px-3.5 py-2.5 border focus:outline-none focus:border-amber-500 ${
                    isDark
                      ? 'bg-zinc-950 border-zinc-800 text-white'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block font-bold mb-1">Label Singkat (Badge)</label>
                <input
                  type="text"
                  placeholder="Contoh: Kitchen / Service / Bar"
                  value={divShortNameInput}
                  onChange={(e) => setDivShortNameInput(e.target.value)}
                  className={`w-full rounded-xl px-3.5 py-2.5 border focus:outline-none focus:border-amber-500 ${
                    isDark
                      ? 'bg-zinc-950 border-zinc-800 text-white'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block font-bold mb-1">Deskripsi Tugas Divisi</label>
                <textarea
                  rows={3}
                  placeholder="Jelaskan tanggung jawab utama divisi ini..."
                  value={divDescInput}
                  onChange={(e) => setDivDescInput(e.target.value)}
                  className={`w-full rounded-xl px-3.5 py-2.5 border focus:outline-none focus:border-amber-500 resize-none ${
                    isDark
                      ? 'bg-zinc-950 border-zinc-800 text-white'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div className="pt-3 border-t border-zinc-800/60 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDivisionModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black cursor-pointer"
                >
                  Simpan Divisi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: TAMBAH / EDIT ROLE JABATAN DI DALAM DIVISI */}
      {showRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl space-y-4 ${
              isDark
                ? 'bg-zinc-900 border-zinc-800 text-white'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800/60">
              <div className="flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-black">
                  {editingRoleObj ? 'Edit Role / Jabatan' : 'Tambah Role / Jabatan Divisi'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowRoleModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRole} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold mb-1">Pilih Divisi Induk *</label>
                <select
                  value={roleTargetDivisionId}
                  onChange={(e) => setRoleTargetDivisionId(e.target.value)}
                  className={`w-full rounded-xl px-3.5 py-2.5 border font-semibold focus:outline-none focus:border-blue-500 ${
                    isDark
                      ? 'bg-zinc-950 border-zinc-800 text-white'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                >
                  {divisions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1">Nama Role / Jabatan *</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Executive Chef, Sous Chef, Expediter, Waiter..."
                  value={roleNameInput}
                  onChange={(e) => setRoleNameInput(e.target.value)}
                  className={`w-full rounded-xl px-3.5 py-2.5 border focus:outline-none focus:border-blue-500 ${
                    isDark
                      ? 'bg-zinc-950 border-zinc-800 text-white'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block font-bold mb-1">Stasiun / Area Kerja Default</label>
                <input
                  type="text"
                  placeholder="Contoh: Grill & Saute Station / KDS Pass Desk"
                  value={roleStationInput}
                  onChange={(e) => setRoleStationInput(e.target.value)}
                  className={`w-full rounded-xl px-3.5 py-2.5 border focus:outline-none focus:border-blue-500 ${
                    isDark
                      ? 'bg-zinc-950 border-zinc-800 text-white'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block font-bold mb-1">Deskripsi Tugas &amp; Wewenang</label>
                <textarea
                  rows={3}
                  placeholder="Jelaskan tanggung jawab jabatan ini..."
                  value={roleDescInput}
                  onChange={(e) => setRoleDescInput(e.target.value)}
                  className={`w-full rounded-xl px-3.5 py-2.5 border focus:outline-none focus:border-blue-500 resize-none ${
                    isDark
                      ? 'bg-zinc-950 border-zinc-800 text-white'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div className="pt-3 border-t border-zinc-800/60 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRoleModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold cursor-pointer"
                >
                  Simpan Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: TAMBAH / EDIT STAFF & PENUGASAN SHIFT PER DIVISI */}
      {showStaffModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in overflow-y-auto">
          <div
            className={`w-full max-w-lg rounded-2xl border p-6 shadow-2xl space-y-4 my-8 ${
              isDark
                ? 'bg-zinc-900 border-zinc-800 text-white'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black">
                    {editingMember
                      ? 'Edit Penugasan Divisi, Role & Shift Staff'
                      : 'Tambah / Tugaskan Staff ke Divisi & Shift'}
                  </h3>
                  <p
                    className={`text-xs ${
                      isDark ? 'text-zinc-400' : 'text-slate-500'
                    }`}
                  >
                    Pilih Divisi terlebih dahulu untuk memfilter daftar Role / Jabatan secara dinamis
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowStaffModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStaffMember} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold mb-1">
                  Nama Lengkap Staff / Chef / Waiter <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Chef Hendra Wijaya / Dimas Saputra"
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  className={`w-full rounded-xl px-3.5 py-2.5 border focus:outline-none focus:border-emerald-500 ${
                    isDark
                      ? 'bg-zinc-950 border-zinc-800 text-white'
                      : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              {/* Dropdown Pilih Divisi & Pilih Role Dinamis */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30">
                <div>
                  <label className="block font-bold mb-1 text-amber-400">
                    1. Pilih Divisi <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={memberDivisionId}
                    onChange={(e) => handleChangeMemberDivision(e.target.value)}
                    className={`w-full rounded-xl px-3 py-2.5 border font-bold focus:outline-none focus:border-amber-500 cursor-pointer ${
                      isDark
                        ? 'bg-zinc-950 border-zinc-800 text-white'
                        : 'bg-white border-slate-300 text-slate-900'
                    }`}
                  >
                    {divisions.map((div) => (
                      <option key={div.id} value={div.id}>
                        {div.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold mb-1 text-emerald-400">
                    2. Pilih Role / Jabatan <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={memberRole}
                    onChange={(e) => handleChangeMemberRole(e.target.value)}
                    className={`w-full rounded-xl px-3 py-2.5 border font-bold focus:outline-none focus:border-emerald-500 cursor-pointer ${
                      isDark
                        ? 'bg-zinc-950 border-zinc-800 text-white'
                        : 'bg-white border-slate-300 text-slate-900'
                    }`}
                  >
                    {availableRolesForSelectedDivision.map((r) => (
                      <option key={r.id || r.name} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Stasiun Kerja & Jadwal Shift */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Stasiun / Area Kerja</label>
                  <input
                    type="text"
                    placeholder="Contoh: Pass & Command Center / Grill"
                    value={memberStation}
                    onChange={(e) => setMemberStation(e.target.value)}
                    className={`w-full rounded-xl px-3.5 py-2 border focus:outline-none focus:border-emerald-500 ${
                      isDark
                        ? 'bg-zinc-950 border-zinc-800 text-white'
                        : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Jadwal Sesi Shift</label>
                  <select
                    value={memberShift}
                    onChange={(e) => setMemberShift(e.target.value)}
                    className={`w-full rounded-xl px-3 py-2 border focus:outline-none focus:border-emerald-500 cursor-pointer ${
                      isDark
                        ? 'bg-zinc-950 border-zinc-800 text-white'
                        : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  >
                    <option value="Pagi (07:30 - 15:00)">Pagi (07:30 - 15:00)</option>
                    <option value="Middle (11:00 - 19:00)">Middle (11:00 - 19:00)</option>
                    <option value="Sore / Malam (15:00 - 22:30)">Sore / Malam (15:00 - 22:30)</option>
                    <option value="Reguler (08:00 - 17:00)">Reguler (08:00 - 17:00)</option>
                  </select>
                </div>
              </div>

              {/* Kontak & PIN */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold mb-1">Email Akun</label>
                  <input
                    type="email"
                    placeholder="nama@riskcart.com"
                    value={memberEmail}
                    onChange={(e) => setMemberEmail(e.target.value)}
                    className={`w-full rounded-xl px-3 py-2 border focus:outline-none ${
                      isDark
                        ? 'bg-zinc-950 border-zinc-800 text-white'
                        : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">No. WhatsApp</label>
                  <input
                    type="text"
                    placeholder="+62 812..."
                    value={memberPhone}
                    onChange={(e) => setMemberPhone(e.target.value)}
                    className={`w-full rounded-xl px-3 py-2 border focus:outline-none ${
                      isDark
                        ? 'bg-zinc-950 border-zinc-800 text-white'
                        : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">PIN Akses (6 Angka)</label>
                  <input
                    type="text"
                    maxLength={6}
                    value={memberPin}
                    onChange={(e) =>
                      setMemberPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))
                    }
                    className={`w-full rounded-xl px-3 py-2 border font-mono font-bold tracking-widest focus:outline-none ${
                      isDark
                        ? 'bg-zinc-950 border-zinc-800 text-amber-400'
                        : 'bg-slate-50 border-slate-300 text-amber-700'
                    }`}
                  />
                </div>
              </div>

              {/* Status Shift Aktif Toggle */}
              <label
                className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer ${
                  memberOnDuty
                    ? isDark
                      ? 'bg-emerald-950/40 border-emerald-700/80 text-emerald-200'
                      : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : isDark
                    ? 'bg-zinc-950 border-zinc-800 text-zinc-400'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
                }`}
              >
                <div>
                  <span className="font-bold block">
                    Aktif Bertugas pada Shift Saat Ini (On-Duty)
                  </span>
                  <span className="text-[11px] opacity-80">
                    Jika dicentang, staff otomatis tampil pada daftar petugas aktif di Dapur (/kitchen), Waiter POS &amp; Kasir POS.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={memberOnDuty}
                  onChange={(e) => setMemberOnDuty(e.target.checked)}
                  className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
                />
              </label>

              <div className="pt-3 border-t border-zinc-800/60 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowStaffModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-md cursor-pointer"
                >
                  Simpan Staff &amp; Sinkronkan Database
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
