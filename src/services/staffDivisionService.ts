import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ACTIVE_STORE_ID } from '../config/store';
import { publishRealtimeEvent, subscribeRealtimeEvent } from '../utils/realtimeSyncBus';

export interface StaffRolePreset {
  id: string;
  name: string;
  description: string;
  badgeCategory:
    | 'leadership'
    | 'culinary'
    | 'expediter'
    | 'steward'
    | 'service'
    | 'bar'
    | 'cashier'
    | 'warehouse';
  defaultStation?: string;
  canVoid?: boolean;
  canEditPrice?: boolean;
  canAccessFinance?: boolean;
  canExport?: boolean;
  isCustom?: boolean;
}

export interface StaffDivision {
  id: string;
  code: 'kitchen' | 'service' | 'bar' | 'cashier' | 'warehouse' | string;
  name: string;
  shortName: string;
  description: string;
  accentColor: 'amber' | 'emerald' | 'blue' | 'purple' | 'cyan' | 'rose' | 'teal';
  roles: StaffRolePreset[];
  updatedAt?: string;
}

export interface StaffDivisionMember {
  id: string;
  name: string;
  email: string;
  phone: string;
  pin: string;
  password?: string;
  divisionId: string;
  divisionName: string;
  role: string;
  station: string;
  shift: string;
  outlet: string;
  onDuty: boolean;
  status: 'active' | 'inactive' | 'off_shift';
  kpiScore?: number;
  updatedAt?: string;
}

export const STAFF_DIVISIONS_LS_KEY = 'riskcart_staff_divisions_v1';
export const STAFF_ROSTER_LS_KEY = 'riskcart_staff_division_roster_v1';
export const ACTIVE_KITCHEN_PIC_LS_KEY = 'riskcart_active_kitchen_pic_v1';
export const ACTIVE_WAITER_PIC_LS_KEY = 'riskcart_active_waiter_pic_v1';

export const DEFAULT_STAFF_DIVISIONS: StaffDivision[] = [
  {
    id: 'div_kitchen',
    code: 'kitchen',
    name: 'Divisi Kitchen (Dapur)',
    shortName: 'Kitchen',
    description:
      'Tim operasional kuliner, persiapan bahan baku BOM, pemasakan menu utama, pastry, pengatur antrean tiket pesanan (/kitchen), dan kebersihan peralatan.',
    accentColor: 'amber',
    roles: [
      {
        id: 'role_exec_chef',
        name: 'Executive Chef',
        description:
          'Kepala Dapur Utama / Akses Penuh Resep, BOM & Approval Stok Dapur',
        badgeCategory: 'leadership',
        defaultStation: 'Pass & Command Center',
        canVoid: true,
        canEditPrice: true,
        canAccessFinance: true,
        canExport: true,
      },
      {
        id: 'role_sous_chef',
        name: 'Sous Chef',
        description:
          'Wakil Kepala Dapur / Kontrol Operasional & Quality Control',
        badgeCategory: 'leadership',
        defaultStation: 'Hot Kitchen & QC',
        canVoid: true,
        canEditPrice: false,
        canAccessFinance: false,
        canExport: true,
      },
      {
        id: 'role_cdp',
        name: 'Chef de Partie',
        description:
          'Penanggung Jawab Stasiun Masak Spesifik (Grill / Saute / Fry / Cold Kitchen)',
        badgeCategory: 'culinary',
        defaultStation: 'Grill & Saute Station',
      },
      {
        id: 'role_commis',
        name: 'Commis Chef',
        description: 'Koki Pelaksana / Junior Chef Pendukung Stasiun Masak',
        badgeCategory: 'culinary',
        defaultStation: 'Main Cooking Line',
      },
      {
        id: 'role_prep_cook',
        name: 'Prep Cook',
        description: 'Persiapan Bahan Baku & Potong/Takaran BOM Harian',
        badgeCategory: 'culinary',
        defaultStation: 'Prep & Butcher Area',
      },
      {
        id: 'role_pastry_chef',
        name: 'Pastry Chef',
        description: 'Spesialis Dessert, Bakery & Pastry',
        badgeCategory: 'culinary',
        defaultStation: 'Pastry & Bakery Corner',
      },
      {
        id: 'role_expediter',
        name: 'Expediter',
        description:
          'Koordinator Antrean Tiket Pesanan Dapur (/kitchen) ke Waiter/Meja & Final Plating Check',
        badgeCategory: 'expediter',
        defaultStation: 'KDS Pass / Expediter Desk',
      },
      {
        id: 'role_dishwasher',
        name: 'Dishwasher',
        description: 'Steward / Kebersihan Peralatan & Area Dapur',
        badgeCategory: 'steward',
        defaultStation: 'Stewarding & Dish Pit',
      },
    ],
  },
  {
    id: 'div_service',
    code: 'service',
    name: 'Divisi Service / Floor (Pelayanan Meja)',
    shortName: 'Service / Floor',
    description:
      'Tim pelayanan pelanggan Dine-In, pencatatan pesanan Waiter POS (/waiters/pos), pengantaran hidangan ke meja, dan manajemen reservasi (/reservation).',
    accentColor: 'emerald',
    roles: [
      {
        id: 'role_floor_captain',
        name: 'Restaurant Captain / Floor Manager',
        description:
          'Koordinator Operasional Area Dining, VIP & Standar Pelayanan Meja',
        badgeCategory: 'leadership',
        defaultStation: 'All Floor & VIP Lounge',
        canVoid: true,
        canExport: true,
      },
      {
        id: 'role_senior_waiter',
        name: 'Senior Waiter',
        description:
          'Pelayan Senior, Penanganan Tamu VIP & Upselling Menu Spesial',
        badgeCategory: 'service',
        defaultStation: 'VIP & Main Dining',
      },
      {
        id: 'role_waiter',
        name: 'Waiter / Server',
        description:
          'Pelayan Meja, Input Order Waiter POS (/waiters/pos) & Pelayanan Tamu',
        badgeCategory: 'service',
        defaultStation: 'Indoor Dining Area',
      },
      {
        id: 'role_runner',
        name: 'Runner / Busser',
        description:
          'Pengantar Hidangan dari Expediter Dapur ke Meja & Table Clear-up',
        badgeCategory: 'service',
        defaultStation: 'Pass to Table Runner',
      },
      {
        id: 'role_host_reservasi',
        name: 'Host / Receptionist (Reservasi)',
        description:
          'Penyambut Tamu, Pengatur Denah Meja (/layout-table) & Konfirmasi Reservasi (/reservation)',
        badgeCategory: 'service',
        defaultStation: 'Reception & Reservation Desk',
      },
    ],
  },
  {
    id: 'div_bar',
    code: 'bar',
    name: 'Divisi Bar & Beverage',
    shortName: 'Bar & Beverage',
    description:
      'Tim peracik minuman kopi, teh, mocktail, jus segar, dan pengelolaan stok bahan baku bar.',
    accentColor: 'cyan',
    roles: [
      {
        id: 'role_head_barista',
        name: 'Head Barista / Bartender',
        description:
          'Kepala Bar, Kalibrasi Resep Minuman, Quality Control & Stok Bar',
        badgeCategory: 'leadership',
        defaultStation: 'Main Espresso & Beverage Bar',
      },
      {
        id: 'role_barista',
        name: 'Barista',
        description:
          'Peracik Kopi Espresso, Manual Brew, Signature Coffee & Tea',
        badgeCategory: 'bar',
        defaultStation: 'Coffee Bar Station',
      },
      {
        id: 'role_mixologist',
        name: 'Beverage Mixologist',
        description:
          'Spesialis Mocktail, Cold-Pressed Juice & Artisanal Refreshment',
        badgeCategory: 'bar',
        defaultStation: 'Mixology & Cold Drink Station',
      },
    ],
  },
  {
    id: 'div_cashier',
    code: 'cashier',
    name: 'Divisi Front Office / Kasir',
    shortName: 'Front Office / Kasir',
    description:
      'Tim operator Terminal Kasir POS (/dashboard/pos), pengelolaan modal laci (float), pembayaran Tunai/QRIS/Kartu, dan rekonsiliasi Z-Report shift.',
    accentColor: 'blue',
    roles: [
      {
        id: 'role_head_cashier',
        name: 'Head Cashier',
        description:
          'Koordinator Kasir, Otorisasi Laci Kas, Rekonsiliasi Shift (Z-Report) & Setoran Brankas',
        badgeCategory: 'leadership',
        defaultStation: 'Terminal Kasir Utama',
        canVoid: true,
        canAccessFinance: true,
        canExport: true,
      },
      {
        id: 'role_cashier_pos',
        name: 'Cashier POS',
        description:
          'Operator Terminal Kasir POS, Transaksi Pembayaran Pelanggan & Cetak Struk',
        badgeCategory: 'cashier',
        defaultStation: 'Terminal Kasir POS',
      },
    ],
  },
  {
    id: 'div_warehouse',
    code: 'warehouse',
    name: 'Divisi Warehouse & Inventory (Gudang)',
    shortName: 'Warehouse / Gudang',
    description:
      'Tim pengelola stok produk & bahan baku, rotasi batch FEFO, stok opname, dan penerimaan pengadaan PO supplier.',
    accentColor: 'purple',
    roles: [
      {
        id: 'role_inventory_fefo',
        name: 'Inventory & FEFO Officer',
        description:
          'Pengawas Stok Gudang, Kartu Stok, Stok Opname & Monitoring Kadaluarsa FEFO',
        badgeCategory: 'warehouse',
        defaultStation: 'Gudang Utama & Chiller',
        canExport: true,
      },
      {
        id: 'role_purchasing_staff',
        name: 'Purchasing & Receiving Staff',
        description:
          'Petugas Pengadaan PO Supplier, Penerimaan Barang Masuk & QC Bahan Baku',
        badgeCategory: 'warehouse',
        defaultStation: 'Receiving Dock & Logistik',
      },
    ],
  },
];

export const DEFAULT_STAFF_DIVISION_ROSTER: StaffDivisionMember[] = [
  {
    id: 'staff_001',
    name: 'Dede Fajar Kurniawan',
    email: 'dede.kasir@riskcart.com',
    phone: '+62 812-3456-7890',
    pin: '123456',
    divisionId: 'div_cashier',
    divisionName: 'Divisi Front Office / Kasir',
    role: 'Head Cashier',
    station: 'Terminal Kasir Utama',
    shift: 'Pagi (07:30 - 15:00)',
    outlet: 'Cabang Utama (Pusat)',
    onDuty: true,
    status: 'active',
    kpiScore: 98,
  },
];

const DELETED_DIVISIONS_LS_KEY = 'riskcart_deleted_division_ids_v1';
const DELETED_STAFF_LS_KEY = 'riskcart_deleted_fs_staff_v1';
const LEGACY_DUMMY_STAFF_IDS = new Set([
  'staff_kds_001',
  'staff_kds_002',
  'staff_kds_003',
  'staff_kds_004',
  'staff_kds_005',
  'staff_kds_006',
  'staff_kds_007',
  'staff_kds_008',
  'staff_srv_001',
  'staff_srv_002',
  'staff_bar_001',
  'staff_demo',
]);

function getDeletedDivisionIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_DIVISIONS_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.map(String));
    }
  } catch {}
  return new Set();
}

function addDeletedDivisionId(id: string): void {
  try {
    const set = getDeletedDivisionIds();
    set.add(String(id));
    localStorage.setItem(DELETED_DIVISIONS_LS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

function getDeletedStaffIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_STAFF_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.map(String));
    }
  } catch {}
  return new Set();
}

export function addDeletedStaffMemberId(id: string): void {
  try {
    if (!id) return;
    const set = getDeletedStaffIds();
    set.add(String(id));
    localStorage.setItem(DELETED_STAFF_LS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

export function removeDeletedStaffMemberId(id: string): void {
  try {
    if (!id) return;
    const set = getDeletedStaffIds();
    if (set.has(String(id))) {
      set.delete(String(id));
      localStorage.setItem(DELETED_STAFF_LS_KEY, JSON.stringify(Array.from(set)));
    }
  } catch {}
}

/**
 * Infers the most appropriate Division for a legacy staff record that only has `role`.
 */
export function inferDivisionFromRole(
  roleName?: string,
  divisions: StaffDivision[] = DEFAULT_STAFF_DIVISIONS
): { divisionId: string; divisionName: string } {
  const cleanRole = String(roleName || '').trim().toLowerCase();
  if (!cleanRole) {
    return {
      divisionId: 'div_cashier',
      divisionName: 'Divisi Front Office / Kasir',
    };
  }

  for (const div of divisions) {
    const matched = div.roles.some(
      (r) => r.name.trim().toLowerCase() === cleanRole
    );
    if (matched) {
      return { divisionId: div.id, divisionName: div.name };
    }
  }

  if (
    cleanRole.includes('chef') ||
    cleanRole.includes('cook') ||
    cleanRole.includes('expediter') ||
    cleanRole.includes('dishwasher') ||
    cleanRole.includes('steward') ||
    cleanRole.includes('pastry') ||
    cleanRole.includes('kitchen') ||
    cleanRole.includes('dapur')
  ) {
    return {
      divisionId: 'div_kitchen',
      divisionName: 'Divisi Kitchen (Dapur)',
    };
  }

  if (
    cleanRole.includes('waiter') ||
    cleanRole.includes('server') ||
    cleanRole.includes('captain') ||
    cleanRole.includes('runner') ||
    cleanRole.includes('busser') ||
    cleanRole.includes('host') ||
    cleanRole.includes('reservasi') ||
    cleanRole.includes('pelayan')
  ) {
    return {
      divisionId: 'div_service',
      divisionName: 'Divisi Service / Floor (Pelayanan Meja)',
    };
  }

  if (
    cleanRole.includes('barista') ||
    cleanRole.includes('bartender') ||
    cleanRole.includes('mixologist') ||
    cleanRole.includes('beverage')
  ) {
    return {
      divisionId: 'div_bar',
      divisionName: 'Divisi Bar & Beverage',
    };
  }

  if (
    cleanRole.includes('inventory') ||
    cleanRole.includes('gudang') ||
    cleanRole.includes('warehouse') ||
    cleanRole.includes('purchasing') ||
    cleanRole.includes('receiving') ||
    cleanRole.includes('fefo')
  ) {
    return {
      divisionId: 'div_warehouse',
      divisionName: 'Divisi Warehouse & Inventory (Gudang)',
    };
  }

  return {
    divisionId: 'div_cashier',
    divisionName: 'Divisi Front Office / Kasir',
  };
}

/**
 * Returns harmonious badge styling for Kitchen & Staff Roles in both Dark and Light themes.
 * - Executive Chef & Sous Chef: Gold / Amber
 * - Chef de Partie, Pastry Chef, Commis Chef, Prep Cook: Emerald / Sky-Blue
 * - Expediter: Purple
 * - Dishwasher: Slate
 */
export function getRoleBadgeThemeClasses(
  roleName?: string,
  isDark: boolean = true
): {
  badgeClass: string;
  dotClass: string;
  categoryLabel: string;
} {
  const r = String(roleName || '').toLowerCase();

  // 1. Executive Chef & Sous Chef -> Gold / Amber
  if (
    r.includes('executive chef') ||
    r.includes('sous chef') ||
    r.includes('captain') ||
    r.includes('head ') ||
    r.includes('owner') ||
    r.includes('manager')
  ) {
    return {
      badgeClass: isDark
        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
        : 'bg-amber-100 text-amber-900 border-amber-300',
      dotClass: isDark ? 'bg-amber-400' : 'bg-amber-600',
      categoryLabel: 'Leadership',
    };
  }

  // 2. Expediter -> Purple
  if (r.includes('expediter')) {
    return {
      badgeClass: isDark
        ? 'bg-purple-500/20 text-purple-300 border-purple-500/50'
        : 'bg-purple-100 text-purple-900 border-purple-300',
      dotClass: isDark ? 'bg-purple-400' : 'bg-purple-600',
      categoryLabel: 'Expediter KDS',
    };
  }

  // 3. Chef de Partie & Pastry Chef -> Emerald
  if (r.includes('chef de partie') || r.includes('pastry chef')) {
    return {
      badgeClass: isDark
        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
        : 'bg-emerald-100 text-emerald-900 border-emerald-300',
      dotClass: isDark ? 'bg-emerald-400' : 'bg-emerald-600',
      categoryLabel: 'Specialist Chef',
    };
  }

  // 4. Commis Chef & Prep Cook -> Sky-Blue
  if (r.includes('commis') || r.includes('prep cook') || r.includes('cook')) {
    return {
      badgeClass: isDark
        ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
        : 'bg-sky-100 text-sky-900 border-sky-300',
      dotClass: isDark ? 'bg-sky-400' : 'bg-sky-600',
      categoryLabel: 'Culinary Line',
    };
  }

  // 5. Dishwasher / Steward -> Slate
  if (r.includes('dishwasher') || r.includes('steward')) {
    return {
      badgeClass: isDark
        ? 'bg-slate-500/25 text-slate-300 border-slate-500/50'
        : 'bg-slate-200 text-slate-800 border-slate-300',
      dotClass: isDark ? 'bg-slate-400' : 'bg-slate-600',
      categoryLabel: 'Steward',
    };
  }

  // 6. Service / Waiter / Runner / Host -> Teal / Emerald
  if (
    r.includes('waiter') ||
    r.includes('server') ||
    r.includes('runner') ||
    r.includes('busser') ||
    r.includes('host')
  ) {
    return {
      badgeClass: isDark
        ? 'bg-teal-500/20 text-teal-300 border-teal-500/45'
        : 'bg-teal-100 text-teal-900 border-teal-300',
      dotClass: isDark ? 'bg-teal-400' : 'bg-teal-600',
      categoryLabel: 'Service Floor',
    };
  }

  // 7. Barista / Mixologist -> Cyan
  if (r.includes('barista') || r.includes('mixologist') || r.includes('bartender')) {
    return {
      badgeClass: isDark
        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/45'
        : 'bg-cyan-100 text-cyan-900 border-cyan-300',
      dotClass: isDark ? 'bg-cyan-400' : 'bg-cyan-600',
      categoryLabel: 'Bar & Beverage',
    };
  }

  // 8. Default / Cashier / Warehouse -> Blue / Indigo
  return {
    badgeClass: isDark
      ? 'bg-blue-500/20 text-blue-300 border-blue-500/45'
      : 'bg-blue-100 text-blue-900 border-blue-300',
    dotClass: isDark ? 'bg-blue-400' : 'bg-blue-600',
    categoryLabel: 'Operational',
  };
}

export function loadStaffDivisionsFromLocal(): StaffDivision[] {
  const deletedDivs = getDeletedDivisionIds();
  try {
    const raw = localStorage.getItem(STAFF_DIVISIONS_LS_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((d: StaffDivision) => d && d.id && !deletedDivs.has(d.id));
      }
    }
  } catch {}
  return DEFAULT_STAFF_DIVISIONS.filter((d) => !deletedDivs.has(d.id));
}

export function saveStaffDivisionsToLocal(divisions: StaffDivision[]): void {
  try {
    localStorage.setItem(STAFF_DIVISIONS_LS_KEY, JSON.stringify(divisions));
    window.dispatchEvent(
      new CustomEvent('riskcart:staff-divisions-updated', { detail: divisions })
    );
  } catch {}
}

export function normalizeStaffDisplayName(rawName?: string): string {
  const trimmed = String(rawName || '').trim();
  if (!trimmed) return 'Dede Fajar Kurniawan';
  if (/muhammad\s+irfan/i.test(trimmed) || /^irfan\s+kasir$/i.test(trimmed)) {
    return trimmed.replace(/muhammad\s+irfan/gi, 'Dede Fajar Kurniawan').replace(/^irfan\s+kasir$/i, 'Dede Fajar Kurniawan');
  }
  return trimmed;
}

export function loadStaffRosterFromLocal(): StaffDivisionMember[] {
  const deletedStaff = getDeletedStaffIds();
  try {
    const raw = localStorage.getItem(STAFF_ROSTER_LS_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (m: StaffDivisionMember) =>
              m &&
              m.id &&
              !deletedStaff.has(m.id) &&
              !/Hendra\s+Wijaya/i.test(String(m.name || ''))
          )
          .map((m: StaffDivisionMember) => ({
            ...m,
            name: normalizeStaffDisplayName(m.name),
          }));
      }
    }
  } catch {}
  return DEFAULT_STAFF_DIVISION_ROSTER.filter((m) => !deletedStaff.has(m.id));
}

export function saveStaffRosterToLocal(roster: StaffDivisionMember[]): void {
  try {
    localStorage.setItem(STAFF_ROSTER_LS_KEY, JSON.stringify(roster));
    window.dispatchEvent(
      new CustomEvent('riskcart:staff-roster-updated', { detail: roster })
    );
  } catch {}
}

export async function saveStaffDivisionInDb(division: StaffDivision): Promise<void> {
  const nowIso = new Date().toISOString();
  const cleanDiv: StaffDivision = {
    ...division,
    id: division.id || `div_${Date.now()}`,
    roles: Array.isArray(division.roles) ? division.roles : [],
    updatedAt: nowIso,
  };

  const current = loadStaffDivisionsFromLocal();
  const exists = current.some((d) => d.id === cleanDiv.id);
  const next = exists
    ? current.map((d) => (d.id === cleanDiv.id ? cleanDiv : d))
    : [...current, cleanDiv];
  saveStaffDivisionsToLocal(next);

  const payload = JSON.parse(JSON.stringify(cleanDiv));
  await Promise.all([
    setDoc(doc(db, 'staff_divisions', cleanDiv.id), payload, { merge: true }).catch(
      () => {}
    ),
    setDoc(
      doc(db, 'stores', ACTIVE_STORE_ID, 'staff_divisions', cleanDiv.id),
      payload,
      { merge: true }
    ).catch(() => {}),
  ]);

  publishRealtimeEvent('staff_divisions_updated', { division: cleanDiv });
}

export async function deleteStaffDivisionFromDb(divisionId: string): Promise<void> {
  addDeletedDivisionId(divisionId);
  const current = loadStaffDivisionsFromLocal().filter((d) => d.id !== divisionId);
  saveStaffDivisionsToLocal(current);

  await Promise.all([
    deleteDoc(doc(db, 'staff_divisions', divisionId)).catch(() => {}),
    deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'staff_divisions', divisionId)).catch(
      () => {}
    ),
  ]);

  publishRealtimeEvent('staff_divisions_updated', { deletedId: divisionId });
}

export async function saveStaffMemberWithDivisionInDb(
  member: Partial<StaffDivisionMember> & { name: string; role: string }
): Promise<StaffDivisionMember> {
  const divisions = loadStaffDivisionsFromLocal();
  const inferred = inferDivisionFromRole(member.role, divisions);
  const targetDiv = divisions.find((d) => d.id === (member.divisionId || inferred.divisionId));
  const nowIso = new Date().toISOString();
  const memberId = member.id || `staff_${Date.now()}`;
  removeDeletedStaffMemberId(memberId);

  const fullMember: StaffDivisionMember = {
    id: memberId,
    name: member.name.trim(),
    email:
      member.email?.trim() ||
      `${member.name.trim().toLowerCase().replace(/[^a-z0-9]/g, '.')}@riskcart.com`,
    phone: member.phone?.trim() || '+62 812-0000-0000',
    pin:
      member.pin && /^\d{6}$/.test(String(member.pin))
        ? String(member.pin)
        : '123456',
    ...(member.password ? { password: member.password } : {}),
    divisionId: targetDiv?.id || member.divisionId || inferred.divisionId,
    divisionName: targetDiv?.name || member.divisionName || inferred.divisionName,
    role: member.role.trim(),
    station:
      member.station?.trim() ||
      targetDiv?.roles.find(
        (r) => r.name.toLowerCase() === member.role.trim().toLowerCase()
      )?.defaultStation ||
      'Operasional Utama',
    shift: member.shift || 'Pagi (07:30 - 15:00)',
    outlet: member.outlet || 'Cabang Utama (Pusat)',
    onDuty: member.onDuty !== undefined ? Boolean(member.onDuty) : true,
    status: member.status || 'active',
    kpiScore: typeof member.kpiScore === 'number' ? member.kpiScore : 95,
    updatedAt: nowIso,
  };

  const currentRoster = loadStaffRosterFromLocal();
  const exists = currentRoster.some((m) => m.id === fullMember.id);
  const nextRoster = exists
    ? currentRoster.map((m) => (m.id === fullMember.id ? fullMember : m))
    : [fullMember, ...currentRoster];
  saveStaffRosterToLocal(nextRoster);

  const payload = JSON.parse(JSON.stringify(fullMember));
  await Promise.all([
    setDoc(doc(db, 'staff', fullMember.id), payload, { merge: true }).catch(() => {}),
    setDoc(doc(db, 'staff_members', fullMember.id), payload, { merge: true }).catch(
      () => {}
    ),
    setDoc(
      doc(db, 'stores', ACTIVE_STORE_ID, 'staff', fullMember.id),
      payload,
      { merge: true }
    ).catch(() => {}),
  ]);

  publishRealtimeEvent('staff_roster_updated', { member: fullMember });
  return fullMember;
}

export async function deleteStaffMemberWithDivisionFromDb(
  memberId: string
): Promise<void> {
  if (!memberId) return;
  addDeletedStaffMemberId(memberId);
  const currentRoster = loadStaffRosterFromLocal().filter((m) => m.id !== memberId);
  saveStaffRosterToLocal(currentRoster);

  await Promise.all([
    deleteDoc(doc(db, 'staff', memberId)).catch(() => {}),
    deleteDoc(doc(db, 'staff_members', memberId)).catch(() => {}),
    deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'staff', memberId)).catch(() => {}),
    deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'staff_members', memberId)).catch(() => {}),
  ]);

  publishRealtimeEvent('staff_roster_updated', { deletedId: memberId });
}

/**
 * Formats a staff member label for POS / Waiter / Kitchen dropdowns:
 * e.g. "Andi Pratama — [Service / Floor] Waiter / Server"
 */
export function formatStaffWithDivisionLabel(
  staff: {
    name?: string;
    role?: string;
    divisionId?: string;
    divisionName?: string;
  },
  divisions: StaffDivision[] = DEFAULT_STAFF_DIVISIONS
): string {
  const name = staff.name || 'Staff';
  const role = staff.role || 'Staff';
  const inferred = inferDivisionFromRole(role, divisions);
  const divId = staff.divisionId || inferred.divisionId;
  const divObj = divisions.find((d) => d.id === divId);
  const shortDiv =
    divObj?.shortName ||
    (staff.divisionName || inferred.divisionName)
      .replace(/^Divisi\s+/i, '')
      .replace(/\s*\(.*?\)\s*/g, '')
      .trim();

  return `${name} — [${shortDiv}] ${role}`;
}

/**
 * Custom React Hook providing real-time synchronized Staff Divisions, Roles, and Staff Roster.
 */
export function useStaffDivisionsAndRoles() {
  const [divisions, setDivisions] = useState<StaffDivision[]>(() =>
    loadStaffDivisionsFromLocal()
  );
  const [roster, setRoster] = useState<StaffDivisionMember[]>(() =>
    loadStaffRosterFromLocal()
  );

  useEffect(() => {
    // One-time cleanup of legacy dummy staff (e.g., Chef Hendra Wijaya)
    try {
      const purgeFlag = 'riskcart_purge_dummy_staff_v2';
      if (localStorage.getItem(purgeFlag) !== 'done') {
        localStorage.setItem(purgeFlag, 'done');
        addDeletedStaffMemberId('staff_kds_001');
        addDeletedStaffMemberId('staff_demo');
        const current = loadStaffRosterFromLocal().filter(
          (m) => m.id !== 'staff_kds_001' && !/Hendra\s+Wijaya/i.test(String(m.name || ''))
        );
        localStorage.setItem(STAFF_ROSTER_LS_KEY, JSON.stringify(current));
        void deleteDoc(doc(db, 'staff', 'staff_kds_001')).catch(() => {});
        void deleteDoc(doc(db, 'staff_members', 'staff_kds_001')).catch(() => {});
        void deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'staff', 'staff_kds_001')).catch(() => {});
      }
    } catch {}

    const syncLocalDivisions = () => {
      setDivisions(loadStaffDivisionsFromLocal());
    };
    const syncLocalRoster = () => {
      setRoster(loadStaffRosterFromLocal());
    };

    window.addEventListener('riskcart:staff-divisions-updated', syncLocalDivisions);
    window.addEventListener('riskcart:staff-roster-updated', syncLocalRoster);
    window.addEventListener('storage', () => {
      syncLocalDivisions();
      syncLocalRoster();
    });

    const unsubBusDiv = subscribeRealtimeEvent('staff_divisions_updated', () => {
      syncLocalDivisions();
    });
    const unsubBusRoster = subscribeRealtimeEvent('staff_roster_updated', () => {
      syncLocalRoster();
    });

    const unsubDivisionsFs = onSnapshot(
      collection(db, 'staff_divisions'),
      (snap) => {
        const deletedDivs = getDeletedDivisionIds();
        if (snap.empty) {
          return;
        }
        const byId = new Map<string, StaffDivision>();
        DEFAULT_STAFF_DIVISIONS.forEach((d) => {
          if (!deletedDivs.has(d.id)) byId.set(d.id, d);
        });
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() as StaffDivision;
          const id = docSnap.id;
          if (deletedDivs.has(id)) return;
          const preset = byId.get(id);
          if (preset) {
            const roleMap = new Map<string, StaffRolePreset>();
            preset.roles.forEach((r) => roleMap.set(r.name.toLowerCase(), r));
            (Array.isArray(data.roles) ? data.roles : []).forEach((r) => {
              if (r && r.name) roleMap.set(r.name.toLowerCase(), r);
            });
            byId.set(id, {
              ...preset,
              ...data,
              id,
              roles: Array.from(roleMap.values()),
            });
          } else {
            byId.set(id, { ...data, id });
          }
        });
        const merged = Array.from(byId.values());
        setDivisions(merged);
        try {
          localStorage.setItem(STAFF_DIVISIONS_LS_KEY, JSON.stringify(merged));
        } catch {}
      },
      () => {}
    );

    const unsubStaffFs = onSnapshot(
      collection(db, 'staff'),
      (snap) => {
        const deletedStaff = getDeletedStaffIds();
        const currentDivs = loadStaffDivisionsFromLocal();
        const byId = new Map<string, StaffDivisionMember>();

        if (!snap.empty) {
          snap.docs.forEach((docSnap) => {
            const raw = docSnap.data() as any;
            const id = docSnap.id;
            if (deletedStaff.has(id)) return;
            if (/Hendra\s+Wijaya/i.test(String(raw?.name || ''))) {
              void deleteDoc(doc(db, 'staff', id)).catch(() => {});
              return;
            }
            const role = raw.role || 'Cashier POS';
            const inferred = inferDivisionFromRole(role, currentDivs);
            const divId = raw.divisionId || inferred.divisionId;
            const divObj = currentDivs.find((d) => d.id === divId);
            const divName =
              raw.divisionName ||
              divObj?.name ||
              inferred.divisionName;

            const rawNameStr = String(raw.name || 'Staff');
            const normalizedName = normalizeStaffDisplayName(rawNameStr);
            if (raw.name && normalizedName !== raw.name) {
              setDoc(
                doc(db, 'staff', id),
                { name: normalizedName, updatedAt: new Date().toISOString() },
                { merge: true }
              ).catch(() => {});
              setDoc(
                doc(db, 'staff_members', id),
                { name: normalizedName, updatedAt: new Date().toISOString() },
                { merge: true }
              ).catch(() => {});
              setDoc(
                doc(db, 'users', id),
                { name: normalizedName, updatedAt: new Date().toISOString() },
                { merge: true }
              ).catch(() => {});
            }

            byId.set(id, {
              id,
              name: normalizedName,
              email: raw.email || '',
              phone: raw.phone || '-',
              pin: raw.pin || '123456',
              ...(raw.password ? { password: raw.password } : {}),
              divisionId: divId,
              divisionName: divName,
              role,
              station:
                raw.station ||
                divObj?.roles.find(
                  (r) => r.name.toLowerCase() === String(role).toLowerCase()
                )?.defaultStation ||
                'Operasional Utama',
              shift: raw.shift || 'Pagi (07:30 - 15:00)',
              outlet: raw.outlet || 'Cabang Utama (Pusat)',
              onDuty:
                raw.onDuty !== undefined
                  ? Boolean(raw.onDuty)
                  : true,
              status: raw.status || 'active',
              kpiScore: Number(raw.kpiScore ?? 95),
              updatedAt: raw.updatedAt,
            });
          });
        }

        const mergedRoster = Array.from(byId.values()).filter(
          (m) => m.status !== 'inactive' && !deletedStaff.has(m.id)
        );
        setRoster(mergedRoster);
        try {
          localStorage.setItem(STAFF_ROSTER_LS_KEY, JSON.stringify(mergedRoster));
        } catch {}
      },
      () => {}
    );

    return () => {
      window.removeEventListener('riskcart:staff-divisions-updated', syncLocalDivisions);
      window.removeEventListener('riskcart:staff-roster-updated', syncLocalRoster);
      unsubBusDiv();
      unsubBusRoster();
      unsubDivisionsFs();
      unsubStaffFs();
    };
  }, []);

  const addOrUpdateDivision = useCallback(async (division: StaffDivision) => {
    await saveStaffDivisionInDb(division);
  }, []);

  const removeDivision = useCallback(async (divisionId: string) => {
    await deleteStaffDivisionFromDb(divisionId);
  }, []);

  const addRoleToDivision = useCallback(
    async (divisionId: string, role: StaffRolePreset) => {
      const target = divisions.find((d) => d.id === divisionId);
      if (!target) return;
      const cleanName = role.name.trim();
      if (!cleanName) return;
      const existingIdx = target.roles.findIndex(
        (r) =>
          r.id === role.id || r.name.toLowerCase() === cleanName.toLowerCase()
      );
      const nextRoles =
        existingIdx >= 0
          ? target.roles.map((r, i) => (i === existingIdx ? { ...r, ...role, name: cleanName } : r))
          : [...target.roles, { ...role, id: role.id || `role_${Date.now()}`, name: cleanName }];
      await saveStaffDivisionInDb({
        ...target,
        roles: nextRoles,
      });
    },
    [divisions]
  );

  const removeRoleFromDivision = useCallback(
    async (divisionId: string, roleIdOrName: string) => {
      const target = divisions.find((d) => d.id === divisionId);
      if (!target) return;
      const nextRoles = target.roles.filter(
        (r) =>
          r.id !== roleIdOrName &&
          r.name.toLowerCase() !== roleIdOrName.toLowerCase()
      );
      await saveStaffDivisionInDb({
        ...target,
        roles: nextRoles,
      });
    },
    [divisions]
  );

  const saveMember = useCallback(
    async (member: Partial<StaffDivisionMember> & { name: string; role: string }) => {
      return await saveStaffMemberWithDivisionInDb(member);
    },
    []
  );

  const removeMember = useCallback(async (memberId: string) => {
    await deleteStaffMemberWithDivisionFromDb(memberId);
  }, []);

  const toggleMemberOnDuty = useCallback(
    async (memberId: string, nextOnDuty?: boolean) => {
      const found = roster.find((m) => m.id === memberId);
      if (!found) return;
      const updated: StaffDivisionMember = {
        ...found,
        onDuty: nextOnDuty !== undefined ? nextOnDuty : !found.onDuty,
      };
      await saveStaffMemberWithDivisionInDb(updated);
    },
    [roster]
  );

  const kitchenStaffOnDuty = useMemo(
    () =>
      roster.filter(
        (m) =>
          (m.divisionId === 'div_kitchen' ||
            m.divisionName.toLowerCase().includes('kitchen') ||
            m.divisionName.toLowerCase().includes('dapur')) &&
          m.onDuty
      ),
    [roster]
  );

  const serviceStaffOnDuty = useMemo(
    () =>
      roster.filter(
        (m) =>
          (m.divisionId === 'div_service' ||
            m.divisionName.toLowerCase().includes('service') ||
            m.divisionName.toLowerCase().includes('floor')) &&
          m.onDuty
      ),
    [roster]
  );

  return {
    divisions,
    roster,
    kitchenStaffOnDuty,
    serviceStaffOnDuty,
    addOrUpdateDivision,
    removeDivision,
    addRoleToDivision,
    removeRoleFromDivision,
    saveMember,
    removeMember,
    toggleMemberOnDuty,
  };
}
