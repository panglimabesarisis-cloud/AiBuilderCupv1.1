import React, { useState, useMemo, useEffect } from 'react';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  UserCheck,
  Shield,
  Key,
  Award,
  Sparkles,
  Plus,
  Search,
  Phone,
  Briefcase,
  X,
  Edit2,
  Trash2,
  Cloud,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  Sliders,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Copy,
  Check,
  AlertCircle,
  Hash,
  Share2,
  Truck,
} from 'lucide-react';
import { useFirestoreList } from '../../hooks/useFirestoreList';
import { useAppNavigation } from '../../router';
import { useAppData } from '../../context/AppDataContext';
import { useAccessControl } from '../../context/AccessControlContext';
import { ACTIVE_STORE_ID } from '../../config/store';
import { HakDanAksesView } from './HakDanAksesView';
import { StaffDivisionRoleSection } from './StaffDivisionRoleSection';
import {
  useStaffDivisionsAndRoles,
  inferDivisionFromRole,
  saveStaffMemberWithDivisionInDb,
  deleteStaffMemberWithDivisionFromDb,
} from '../../services/staffDivisionService';
import { getDeletedFsIds } from '../../hooks/useFirestoreList';

interface StaffModuleProps {
  subModule: 'daftar_staff' | 'role_jabatan' | 'otoritas_akses' | 'hak_akses' | 'kpi_staff' | 'ai_setting_job_staff';
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

export interface RoleItem {
  id: string;
  name: string;
  description: string;
  canVoid: boolean;
  canExport: boolean;
  canEditPrice: boolean;
  canAccessFinance: boolean;
  membersCount?: number;
  color?: string;
  roleKey?: string;
}

export const DEFAULT_STAFF_ROLES: RoleItem[] = [
  {
    id: 'role_owner',
    name: 'Owner',
    description: 'Pemilik usaha dengan akses tertinggi tanpa batasan ke seluruh modul bisnis, laporan keuangan, dan konfigurasi master.',
    canVoid: true,
    canExport: true,
    canEditPrice: true,
    canAccessFinance: true,
    color: '#f59e0b',
    roleKey: 'owner',
  },
  {
    id: 'role_cashier',
    name: 'Cashier',
    description: 'Staf kasir depan yang mengoperasikan mesin kasir POS, menerima pembayaran pelanggan, cetak struk, dan rekonsiliasi shift kasir.',
    canVoid: false,
    canExport: false,
    canEditPrice: false,
    canAccessFinance: false,
    color: '#14b8a6',
    roleKey: 'cashier',
  },
  {
    id: 'role_inventory_keeper',
    name: 'Inventory Keeper',
    description: 'Penanggung jawab inventori gudang, audit stok opname, mutasi barang, penerimaan barang masuk supplier, dan stok rak.',
    canVoid: false,
    canExport: true,
    canEditPrice: false,
    canAccessFinance: false,
    color: '#f97316',
    roleKey: 'inventory_keeper',
  },
  {
    id: 'role_shipper',
    name: 'Shipper',
    description: 'Personel fulfillment gudang dan kurir pengantaran pesanan online, penyiapan packing, bukti serah terima, dan pelacakan armada.',
    canVoid: false,
    canExport: false,
    canEditPrice: false,
    canAccessFinance: false,
    color: '#22c55e',
    roleKey: 'shipper',
  },
  {
    id: 'role_finance',
    name: 'Finance',
    description: 'Divisi akuntansi dan keuangan toko, audit kas keluar/masuk, buku besar, rekonsiliasi mutasi rekening bank, dan laba rugi.',
    canVoid: true,
    canExport: true,
    canEditPrice: false,
    canAccessFinance: true,
    color: '#a855f7',
    roleKey: 'finance',
  },
  {
    id: 'role_purchase',
    name: 'Purchase',
    description: 'Spesialis pengadaan barang supplier, pembuatan Purchase Order (PO), verifikasi faktur pembelian, dan estimasi batas stok minimum.',
    canVoid: false,
    canExport: true,
    canEditPrice: false,
    canAccessFinance: false,
    color: '#06b6d4',
    roleKey: 'purchase',
  },
  {
    id: 'role_enginer',
    name: 'Enginer',
    description: 'Teknisi sistem IT dan pemeliharaan perangkat POS, troubleshooting printer bluetooth/thermal, integrasi API webhook, dan integritas database.',
    canVoid: true,
    canExport: true,
    canEditPrice: false,
    canAccessFinance: false,
    color: '#ec4899',
    roleKey: 'enginer',
  },
];

export interface StaffMemberItem {
  id?: string;
  name: string;
  email: string;
  password?: string;
  pin: string; // 6-digit numeric PIN
  role: string;
  divisionId?: string;
  divisionName?: string;
  station?: string;
  onDuty?: boolean;
  outlet: string;
  phone: string;
  shift: string;
  kpiScore?: number;
  status?: string;
  joinedDate?: string;
  createdAt?: any;
  updatedAt?: any;
}

export const DEFAULT_STAFF_MEMBERS: StaffMemberItem[] = [
  {
    id: 'staff_001',
    name: 'Dede Fajar Kurniawan',
    email: 'panglimabesarisis@gmail.com',
    pin: String(import.meta.env.VITE_OWNER_PIN || '123456'),
    role: 'Owner',
    outlet: 'Cabang Utama (Pusat)',
    phone: '0811-1000-001',
    shift: 'Full-Time / All Shift',
    kpiScore: 100,
    status: 'active',
    joinedDate: 'Januari 2026',
  },
];

export const StaffModule: React.FC<StaffModuleProps> = ({
  subModule,
  currencyMode = 'IDR',
  onNavigateTab,
}) => {
  const { route, navigateTab, navigateToPath } = useAppNavigation();
  const { transactions, orders, formatMoney } = useAppData();
  const { roles: rbacRoles } = useAccessControl();
  const activeSub = (
    route.activeTab === 'module_staff' ? route.activeSubModule : subModule
  ) as 'daftar_staff' | 'role_jabatan' | 'otoritas_akses' | 'hak_akses' | 'kpi_staff' | 'ai_setting_job_staff';
  const setActiveSub = (
    next: 'daftar_staff' | 'role_jabatan' | 'otoritas_akses' | 'hak_akses' | 'kpi_staff' | 'ai_setting_job_staff'
  ) => {
    navigateTab('module_staff', next);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [roleSearchQuery, setRoleSearchQuery] = useState('');
  const [isSyncingDb, setIsSyncingDb] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const { divisions: staffDivisions } = useStaffDivisionsAndRoles();

  // 1. Staff Employees via useFirestoreList
  const {
    data: staffList,
    addItem: addStaff,
    updateItem: updateStaff,
    deleteItem: deleteStaff,
  } = useFirestoreList<StaffMemberItem>('staff', DEFAULT_STAFF_MEMBERS);

  const topStaff = staffList.length > 0
    ? [...staffList].sort((a, b) => Number(b.kpiScore || 0) - Number(a.kpiScore || 0))[0]
    : null;

  // 2. Roles via useFirestoreList
  const {
    data: firestoreRoles,
    addItem: addRole,
    updateItem: updateRole,
    deleteItem: deleteRole,
  } = useFirestoreList<RoleItem>('staff_roles', DEFAULT_STAFF_ROLES);
  const { data: outletsList } = useFirestoreList<any>('outlets', []);

  // Migrate legacy 'Muhammad Irfan' -> 'Dede Fajar Kurniawan' and purge dummy Hendra Wijaya without re-seeding deleted records
  useEffect(() => {
    const syncStaffDataToFirestore = async () => {
      try {
        const deletedRoles = getDeletedFsIds('staff_roles');
        const rolesInitKey = 'riskcart_staff_roles_seeded_v1';
        if (localStorage.getItem(rolesInitKey) !== 'done') {
          localStorage.setItem(rolesInitKey, 'done');
          const colRolesRef = collection(db, 'staff_roles');
          const snapRoles = await getDocs(colRolesRef);
          if (snapRoles.empty) {
            for (const defaultRole of DEFAULT_STAFF_ROLES) {
              if (!deletedRoles.has(defaultRole.id)) {
                await setDoc(
                  doc(db, 'staff_roles', defaultRole.id),
                  {
                    ...defaultRole,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                  },
                  { merge: true }
                );
              }
            }
          }
        }

        const colStaffRef = collection(db, 'staff');
        const snapStaff = await getDocs(colStaffRef);
        for (const docSnap of snapStaff.docs) {
          const d = docSnap.data();
          if (
            docSnap.id === 'staff_kds_001' ||
            docSnap.id === 'staff_demo' ||
            /Hendra\s+Wijaya/i.test(String(d?.name || ''))
          ) {
            await deleteStaffMemberWithDivisionFromDb(docSnap.id);
            continue;
          }
          if (d?.name && /muhammad\s+irfan/i.test(String(d.name))) {
            const updatedName = String(d.name).replace(
              /muhammad\s+irfan/gi,
              'Dede Fajar Kurniawan'
            );
            await setDoc(
              doc(db, 'staff', docSnap.id),
              { name: updatedName, updatedAt: serverTimestamp() },
              { merge: true }
            );
          }
        }
      } catch (err) {
        console.warn('Sync staff data to Firestore warning:', err);
      }
    };

    syncStaffDataToFirestore();
  }, []);

  const handleManualSyncDatabase = async () => {
    setIsSyncingDb(true);
    try {
      for (const role of DEFAULT_STAFF_ROLES) {
        const docRef = doc(db, 'staff_roles', role.id);
        await setDoc(
          docRef,
          {
            ...role,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      setSyncMessage('Berhasil disinkronkan ke Database Firestore: 7 Role Master Aktif');
      setTimeout(() => setSyncMessage(null), 4000);
    } catch (err) {
      console.error('Error syncing staff roles to Firestore:', err);
      setSyncMessage('Gagal menyinkronkan ke Firestore, periksa koneksi');
      setTimeout(() => setSyncMessage(null), 4000);
    } finally {
      setIsSyncingDb(false);
    }
  };

  // Real-time merged roles with dynamic membersCount based on staffList and rbac_roles
  const roles: RoleItem[] = useMemo(() => {
    const baseList = firestoreRoles.length > 0 ? firestoreRoles : DEFAULT_STAFF_ROLES;
    const existingNames = new Set(baseList.map((r) => (r.name || '').toLowerCase().trim()));
    const merged = [...baseList];

    DEFAULT_STAFF_ROLES.forEach((defRole) => {
      if (!existingNames.has(defRole.name.toLowerCase().trim())) {
        merged.push(defRole);
        existingNames.add(defRole.name.toLowerCase().trim());
      }
    });

    rbacRoles.forEach((rbacRole) => {
      if (!existingNames.has((rbacRole.name || '').toLowerCase().trim())) {
        merged.push({
          id: rbacRole.id,
          name: rbacRole.name,
          description: rbacRole.description,
          canVoid: rbacRole.id === 'owner' || rbacRole.id === 'admin_toko',
          canExport: rbacRole.id === 'owner' || rbacRole.id === 'finance',
          canEditPrice: rbacRole.id === 'owner' || rbacRole.id === 'admin_toko',
          canAccessFinance: rbacRole.id === 'owner' || rbacRole.id === 'finance',
          color: rbacRole.color || '#f59e0b',
          roleKey: rbacRole.id,
        });
        existingNames.add((rbacRole.name || '').toLowerCase().trim());
      }
    });

    return merged.map((r) => {
      const count = staffList.filter(
        (s) => (s.role || '').toLowerCase().trim() === (r.name || '').toLowerCase().trim()
      ).length;
      const matchedDefault = DEFAULT_STAFF_ROLES.find(
        (d) => d.name.toLowerCase().trim() === (r.name || '').toLowerCase().trim()
      );
      return {
        ...r,
        membersCount: count,
        color: r.color || matchedDefault?.color || '#3b82f6',
        roleKey: r.roleKey || matchedDefault?.roleKey || r.name.toLowerCase().replace(/\s+/g, '_'),
      };
    });
  }, [firestoreRoles, staffList, rbacRoles]);

  // Filtered roles based on search
  const filteredRoles = useMemo(() => {
    if (!roleSearchQuery.trim()) return roles;
    const q = roleSearchQuery.toLowerCase();
    return roles.filter(
      (r) =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
    );
  }, [roles, roleSearchQuery]);

  // Modal State for Add/Edit Staff (Email, Password, 6-Digit PIN)
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<any | null>(null);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [newStaffPin, setNewStaffPin] = useState('');
  const [newStaffDivisionId, setNewStaffDivisionId] = useState('div_kitchen');
  const [newStaffRole, setNewStaffRole] = useState('Executive Chef');
  const [newStaffStation, setNewStaffStation] = useState('Pass & Command Center');
  const [newStaffOutlet, setNewStaffOutlet] = useState('Cabang Utama (Pusat)');
  const [newStaffPhone, setNewStaffPhone] = useState('');
  const [newStaffShift, setNewStaffShift] = useState('Pagi (07:30 - 15:00)');
  const [showPasswordInModal, setShowPasswordInModal] = useState(false);
  const [showPinInModal, setShowPinInModal] = useState(false);
  const [staffFormError, setStaffFormError] = useState<string | null>(null);

  const selectedDivisionRoles = useMemo(() => {
    const div = staffDivisions.find((d) => d.id === newStaffDivisionId);
    if (div && div.roles.length > 0) {
      return div.roles;
    }
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      badgeCategory: 'cashier' as const,
      defaultStation: 'Operasional Utama',
    }));
  }, [staffDivisions, newStaffDivisionId, roles]);

  // Card view interactive states
  const [revealedPins, setRevealedPins] = useState<Record<string, boolean>>({});
  const [selectedStaffCredentials, setSelectedStaffCredentials] = useState<any | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const togglePinVisibility = (staffId: string) => {
    setRevealedPins((prev) => ({
      ...prev,
      [staffId]: !prev[staffId],
    }));
  };

  const generateRandomPassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
    let pass = '';
    for (let i = 0; i < 10; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewStaffPassword(pass);
  };

  const generateRandomPin = () => {
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    setNewStaffPin(pin);
  };

  const handleCopyText = (text: string, keyName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleCopyAllCredentials = (stf: any) => {
    const text = `🔐 *KREDENSIAL LOGIN RISKCart — ${stf.name}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 Nama: ${stf.name}\n` +
      `🏢 Divisi: ${stf.divisionName || inferDivisionFromRole(stf.role, staffDivisions).divisionName}\n` +
      `💼 Jabatan: ${stf.role}\n` +
      `🏪 Outlet: ${stf.outlet}\n` +
      `📧 Email: ${stf.email || '-'}\n` +
      `🔑 Password: ${stf.password || '-'}\n` +
      `🔢 PIN POS (6 Digit): ${stf.pin || '-'}\n` +
      `⏰ Shift: ${stf.shift || '-'}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Gunakan email & password untuk login Dashboard, atau masukkan 6-digit PIN pada terminal kasir POS.`;
    navigator.clipboard.writeText(text);
    setCopiedKey(`all_${stf.id}`);
    setTimeout(() => setCopiedKey(null), 3000);
  };

  const handleOpenAddStaff = () => {
    setEditingStaff(null);
    setNewStaffName('');
    setNewStaffEmail('');
    setNewStaffPassword('Staff#123');
    // Pre-generate unique 6-digit PIN
    setNewStaffPin(Math.floor(100000 + Math.random() * 900000).toString());
    const defaultDiv = staffDivisions[0] || {
      id: 'div_kitchen',
      roles: [{ name: 'Executive Chef', defaultStation: 'Pass & Command Center' }],
    };
    setNewStaffDivisionId(defaultDiv.id);
    setNewStaffRole(defaultDiv.roles[0]?.name || 'Executive Chef');
    setNewStaffStation(defaultDiv.roles[0]?.defaultStation || 'Pass & Command Center');
    setNewStaffOutlet(outletsList[0]?.name || 'Cabang Utama (Pusat)');
    setNewStaffPhone('');
    setNewStaffShift('Pagi (07:30 - 15:00)');
    setShowPasswordInModal(false);
    setShowPinInModal(false);
    setStaffFormError(null);
    setShowAddStaffModal(true);
  };

  const handleOpenEditStaff = (stf: any) => {
    setEditingStaff(stf);
    setNewStaffName(stf.name || '');
    setNewStaffEmail(stf.email || '');
    setNewStaffPassword(stf.password || '');
    setNewStaffPin(stf.pin || '');
    const inferred = inferDivisionFromRole(stf.role, staffDivisions);
    setNewStaffDivisionId(stf.divisionId || inferred.divisionId);
    setNewStaffRole(stf.role || 'Executive Chef');
    setNewStaffStation(stf.station || 'Operasional Utama');
    setNewStaffOutlet(stf.outlet || outletsList[0]?.name || 'Cabang Utama (Pusat)');
    setNewStaffPhone(stf.phone === '-' ? '' : (stf.phone || ''));
    setNewStaffShift(stf.shift || 'Pagi (07:30 - 15:00)');
    setShowPasswordInModal(false);
    setShowPinInModal(false);
    setStaffFormError(null);
    setShowAddStaffModal(true);
  };

  // Compute real-time Cashier & Pengirim (Shipper) performance metrics from Firestore transactions & orders
  const staffPerformanceMap = useMemo(() => {
    const map = new Map<
      string,
      {
        cashierTxCount: number;
        cashierSalesAmount: number;
        deliveryCount: number;
        deliveryTotalValue: number;
        deliveryCommissionTotal: number;
      }
    >();

    const ensureEntry = (key: string) => {
      if (!map.has(key)) {
        map.set(key, {
          cashierTxCount: 0,
          cashierSalesAmount: 0,
          deliveryCount: 0,
          deliveryTotalValue: 0,
          deliveryCommissionTotal: 0,
        });
      }
      return map.get(key)!;
    };

    staffList.forEach((stf) => {
      const sAny = stf as any;
      const entry = ensureEntry(stf.id || stf.name);
      if (Number(sAny.totalDeliveries || 0) > 0) {
        entry.deliveryCount = Math.max(entry.deliveryCount, Number(sAny.totalDeliveries || 0));
      }
      if (Number(sAny.totalDeliveryCommission || 0) > 0) {
        entry.deliveryCommissionTotal = Math.max(
          entry.deliveryCommissionTotal,
          Number(sAny.totalDeliveryCommission || 0)
        );
      }
    });

    // Aggregate from live transactions
    let txDerivedDeliveries = new Map<string, { count: number; val: number; comm: number }>();
    transactions.forEach((tx: any) => {
      if (tx.status === 'void' || tx.status === 'cancelled' || tx.status === 'rejected') return;
      const amt = Number(tx.totalAmount ?? tx.total ?? 0);
      const matchedCashier = staffList.find(
        (s) =>
          (tx.cashierId && s.id === tx.cashierId) ||
          (tx.cashierName &&
            (s.name || '').trim().toLowerCase() === String(tx.cashierName).trim().toLowerCase())
      );
      if (matchedCashier) {
        const entry = ensureEntry(matchedCashier.id || matchedCashier.name);
        entry.cashierTxCount += 1;
        entry.cashierSalesAmount += amt;
      }

      if (tx.deliveryStaffId || tx.deliveryStaffName) {
        const matchedSender = staffList.find(
          (s) =>
            (tx.deliveryStaffId && s.id === tx.deliveryStaffId) ||
            (tx.deliveryStaffName &&
              (s.name || '').trim().toLowerCase() ===
                String(tx.deliveryStaffName).trim().toLowerCase())
        );
        if (matchedSender) {
          const k = matchedSender.id || matchedSender.name;
          const prev = txDerivedDeliveries.get(k) || { count: 0, val: 0, comm: 0 };
          prev.count += 1;
          prev.val += amt;
          prev.comm += Number(tx.deliveryCommission || 0);
          txDerivedDeliveries.set(k, prev);
        }
      }
    });

    // Also check orders for any assigned courier not yet counted in transactions
    const countedOrderIds = new Set(transactions.map((t) => t.id));
    orders.forEach((ord: any) => {
      if (countedOrderIds.has(ord.id)) return;
      if (ord.deliveryStaffId || ord.deliveryStaffName) {
        const matchedSender = staffList.find(
          (s) =>
            (ord.deliveryStaffId && s.id === ord.deliveryStaffId) ||
            (ord.deliveryStaffName &&
              (s.name || '').trim().toLowerCase() ===
                String(ord.deliveryStaffName).trim().toLowerCase())
        );
        if (matchedSender) {
          const k = matchedSender.id || matchedSender.name;
          const prev = txDerivedDeliveries.get(k) || { count: 0, val: 0, comm: 0 };
          prev.count += 1;
          prev.val += Number(ord.totalAmount ?? ord.total ?? 0);
          prev.comm += Number(ord.deliveryCommission || 0);
          txDerivedDeliveries.set(k, prev);
        }
      }
    });

    txDerivedDeliveries.forEach((stats, key) => {
      const entry = ensureEntry(key);
      entry.deliveryCount = Math.max(entry.deliveryCount, stats.count);
      entry.deliveryTotalValue = Math.max(entry.deliveryTotalValue, stats.val);
      entry.deliveryCommissionTotal = Math.max(entry.deliveryCommissionTotal, stats.comm);
    });

    return map;
  }, [staffList, transactions, orders]);

  const handleDeleteStaff = async (stf: any) => {
    await Promise.all([
      deleteStaff(stf.id),
      deleteStaffMemberWithDivisionFromDb(stf.id),
    ]);
    setSyncMessage(`Staff "${stf.name}" telah dihapus permanen dari database & daftar Pengirim POS.`);
    setTimeout(() => setSyncMessage(null), 3000);
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffFormError(null);

    const name = newStaffName.trim();
    const email = newStaffEmail.trim().toLowerCase();
    const password = newStaffPassword.trim();
    const pin = newStaffPin.trim();

    if (!name) {
      setStaffFormError('Nama lengkap karyawan wajib diisi.');
      return;
    }
    if (!email || !email.includes('@')) {
      setStaffFormError('Email login staf wajib diisi dengan format valid (misal: nama@riskcart.com).');
      return;
    }
    if (!password || password.length < 6) {
      setStaffFormError('Password login staf minimal harus 6 karakter.');
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setStaffFormError('PIN keamanan wajib persis 6 angka numerik (contoh: 123456).');
      return;
    }

    const staffId = editingStaff?.id || `staff_${Date.now().toString().slice(-5)}`;
    const chosenDivObj = staffDivisions.find((d) => d.id === newStaffDivisionId);
    const divisionName =
      chosenDivObj?.name ||
      inferDivisionFromRole(newStaffRole, staffDivisions).divisionName;
    const payload = {
      id: staffId,
      name,
      email,
      password,
      pin,
      divisionId: newStaffDivisionId,
      divisionName,
      role: newStaffRole,
      station: newStaffStation.trim() || 'Operasional Utama',
      onDuty: true,
      outlet: newStaffOutlet,
      phone: newStaffPhone.trim() || '-',
      shift: newStaffShift,
      kpiScore: editingStaff?.kpiScore ?? 100,
      status: editingStaff?.status ?? 'active',
      joinedDate:
        editingStaff?.joinedDate ??
        new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }),
      updatedAt: new Date().toISOString(),
    };

    try {
      await saveStaffMemberWithDivisionInDb(payload as any);
      if (editingStaff) {
        await Promise.all([
          updateStaff(editingStaff.id, payload),
          setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'staff', editingStaff.id), payload, {
            merge: true,
          }).catch(() => {}),
        ]);
        setSyncMessage(
          `Data staf "${name}" (${divisionName} - ${newStaffRole}) berhasil diperbarui & tersinkronisasi ke /kitchen dan POS!`
        );
      } else {
        await Promise.all([
          setDoc(doc(db, 'staff', staffId), payload, { merge: true }),
          setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'staff', staffId), payload, {
            merge: true,
          }).catch(() => {}),
        ]);
        setSyncMessage(
          `Karyawan baru "${name}" (${divisionName} - ${newStaffRole}) berhasil disimpan ke Firestore & langsung muncul di /kitchen dan POS!`
        );
      }

      setNewStaffName('');
      setNewStaffEmail('');
      setNewStaffPassword('');
      setNewStaffPin('');
      setNewStaffPhone('');
      setEditingStaff(null);
      setShowAddStaffModal(false);
      setTimeout(() => setSyncMessage(null), 4000);
    } catch (err: any) {
      console.error('Error saving staff to Firestore:', err);
      setStaffFormError(`Gagal menyimpan ke Firestore: ${err?.message || String(err)}`);
    }
  };

  // Modal State for Add / Edit Role
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleItem | null>(null);
  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [roleCanVoid, setRoleCanVoid] = useState(false);
  const [roleCanEditPrice, setRoleCanEditPrice] = useState(false);
  const [roleCanAccessFinance, setRoleCanAccessFinance] = useState(false);
  const [roleCanExport, setRoleCanExport] = useState(false);

  const handleOpenAddRole = () => {
    setEditingRole(null);
    setRoleName('');
    setRoleDescription('');
    setRoleCanVoid(false);
    setRoleCanEditPrice(false);
    setRoleCanAccessFinance(false);
    setRoleCanExport(false);
    setShowRoleModal(true);
  };

  const handleOpenEditRole = (role: RoleItem) => {
    setEditingRole(role);
    setRoleName(role.name || '');
    setRoleDescription(role.description || '');
    setRoleCanVoid(!!role.canVoid);
    setRoleCanEditPrice(!!role.canEditPrice);
    setRoleCanAccessFinance(!!role.canAccessFinance);
    setRoleCanExport(!!role.canExport);
    setShowRoleModal(true);
  };

  const handleDeleteRole = async (role: RoleItem) => {
    if (confirm(`Hapus role / jabatan "${role.name}"?`)) {
      await deleteRole(role.id);
    }
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleName.trim()) return;

    const payload: Partial<RoleItem> = {
      name: roleName.trim(),
      description: roleDescription.trim(),
      canVoid: roleCanVoid,
      canEditPrice: roleCanEditPrice,
      canAccessFinance: roleCanAccessFinance,
      canExport: roleCanExport,
    };

    if (editingRole) {
      await updateRole(editingRole.id, payload);
    } else {
      await addRole(payload as any);
    }

    setShowRoleModal(false);
    setEditingRole(null);
  };

  // AI Setting Job Staff state
  const [jobTitleInput, setJobTitleInput] = useState('Kasir Multi-Outlet dengan AI Fraud Sentinel');
  const [aiJobResult, setAiJobResult] = useState<{
    summary: string;
    responsibilities: string[];
    kpiMetrics: string[];
    riskSafeguards: string[];
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateJobAI = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setAiJobResult({
        summary: `Standar Kompetensi & SOP Kerja Otomatis untuk posisi ${jobTitleInput}. Dirancang sesuai arsitektur anti-fraud RiskCart POS 2026.`,
        responsibilities: [
          'Memproses transaksi belanja eceran dan grosir karton via POS Terminal secara cepat (<35 detik per pelanggan).',
          'Melakukan verifikasi tanda centang radius lokasi pelanggan saat pesanan online Client PWA masuk.',
          'Menghitung dan mencocokkan fisik uang laci tunai (*cash drawer*) dengan sistem saat pergantian shift kasir (X/Z Report).',
          'Menginput bukti nota kas kecil pengeluaran operasional toko pada menu Shift Kasir.',
        ],
        kpiMetrics: [
          'Tingkat Akurasi Saldo Laci Kasir: 99.8% (Maksimal selisih Rp 2.000 / shift).',
          'Kecepatan Layanan Kasir: Rata-rata 25 detik per struk belanja.',
          'Deteksi Penipuan (Fraud Prevention): 100% verifikasi QRIS sukses sebelum barang diserahkan.',
        ],
        riskSafeguards: [
          'Dilarang melakukan pembatalan transaksi (*Void*) tanpa otorisasi PIN Supervisor.',
          'Batas uang tunai laci maksimal Rp 3.000.000; kelebihan wajib disetor ke brankas toko (*Safe Drop*).',
        ],
      });
      setIsGenerating(false);
    }, 600);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <UserCheck className="w-6 h-6 text-purple-400" />
          <h1 className="text-2xl font-black text-white tracking-tight">
            STAFF, ROLE &amp; HAK AKSES OPERASIONAL
          </h1>
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          Manajemen direktori karyawan, pembatasan hak akses (*RBAC*), evaluasi KPI kinerja kasir, dan perumusan SOP kerja cerdas AI.
        </p>
      </div>

      {/* Sub-Tabs */}
      <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto w-full max-w-none mb-4">
        <button
          onClick={() => setActiveSub('daftar_staff')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
            activeSub === 'daftar_staff' ? 'bg-purple-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          Daftar Staff
        </button>
        <button
          onClick={() => setActiveSub('role_jabatan')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 ${
            activeSub === 'role_jabatan' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Briefcase className="w-3.5 h-3.5" />
          <span>Role / Jabatan</span>
        </button>
        <button
          onClick={() => navigateToPath('/dashboard/staff/otoritas-akses')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 ${
            activeSub === 'otoritas_akses' || activeSub === 'hak_akses'
              ? 'bg-amber-500 text-zinc-950 shadow-sm'
              : 'text-amber-400 hover:text-amber-300'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Otoritas Akses (RBAC)</span>
        </button>
        <button
          onClick={() => setActiveSub('kpi_staff')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 ${
            activeSub === 'kpi_staff' ? 'bg-amber-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Award className="w-3.5 h-3.5" />
          <span>KPI Staff</span>
        </button>
        <button
          onClick={() => setActiveSub('ai_setting_job_staff')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 ${
            activeSub === 'ai_setting_job_staff' ? 'bg-pink-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI Setting Job Staff</span>
        </button>
      </div>

      {/* VIEW: DAFTAR STAFF */}
      {activeSub === 'daftar_staff' && (
        <div className="space-y-4">
          {/* Cloud Database Status Banner */}
          <div className="bg-gradient-to-r from-zinc-900 via-zinc-900 to-purple-950/40 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg">
            <div className="flex items-start sm:items-center gap-3">
              <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 shrink-0">
                <UserCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <h3 className="font-bold text-white text-sm">
                    Database Cloud Terhubung: Firestore <code className="text-purple-400 text-xs font-mono">/staff</code>
                  </h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    {staffList.length} Karyawan Aktif
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Setiap staf memiliki Email, Password login, dan PIN 6 angka numerik untuk otorisasi mesin kasir POS.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleOpenAddStaff}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Tambah Karyawan Baru</span>
              </button>
            </div>
          </div>

          {/* Sync Success / Alert Toast */}
          {syncMessage && (
            <div className="p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-xl text-emerald-300 text-xs flex items-center justify-between gap-2 animate-in fade-in">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{syncMessage}</span>
              </div>
              <button
                onClick={() => setSyncMessage(null)}
                className="text-emerald-400 hover:text-emerald-200 text-xs font-bold px-1"
              >
                ✕
              </button>
            </div>
          )}

          {/* Toolbar: Search & Action buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Cari nama, role, email, outlet, pin..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={handleOpenAddRole}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600/90 hover:bg-blue-600 text-white text-xs font-bold shadow-md transition cursor-pointer"
              >
                <Briefcase className="w-4 h-4" />
                <span>+ Tambah Role</span>
              </button>
              <button
                onClick={handleOpenAddStaff}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Tambah Staff Baru</span>
              </button>
            </div>
          </div>

          {/* Grid Kartu Staff */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {staffList
              .filter((s) => {
                const q = searchQuery.toLowerCase().trim();
                if (!q) return true;
                return (
                  (s.name || '').toLowerCase().includes(q) ||
                  (s.role || '').toLowerCase().includes(q) ||
                  (s.email || '').toLowerCase().includes(q) ||
                  (s.phone || '').toLowerCase().includes(q) ||
                  (s.outlet || '').toLowerCase().includes(q) ||
                  (s.pin || '').includes(q)
                );
              })
              .map((stf) => {
                const matchedRole = roles.find(
                  (r) => (r.name || '').toLowerCase().trim() === (stf.role || '').toLowerCase().trim()
                );
                const roleColor = matchedRole?.color || '#a855f7';
                const isPinVisible = revealedPins[stf.id || ''] ?? false;

                return (
                  <div
                    key={stf.id}
                    className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-5 space-y-3.5 flex flex-col justify-between shadow-sm relative overflow-hidden transition"
                  >
                    {/* Top color bar */}
                    <div
                      className="absolute top-0 left-0 right-0 h-1"
                      style={{ backgroundColor: roleColor }}
                    />

                    <div>
                      {/* Header Card */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] font-bold text-purple-400 bg-purple-950/80 border border-purple-800 px-1.5 py-0.5 rounded">
                              {stf.id}
                            </span>
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded border"
                              style={{
                                backgroundColor: `${roleColor}15`,
                                borderColor: `${roleColor}40`,
                                color: roleColor,
                              }}
                            >
                              {stf.role}
                            </span>
                          </div>
                          <h3 className="font-bold text-white text-base mt-1.5">{stf.name}</h3>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 rounded">
                            KPI: {stf.kpiScore ?? 100}
                          </span>
                          <button
                            onClick={() => handleOpenEditStaff(stf)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
                            title="Edit Data Staff"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteStaff(stf)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer"
                            title="Hapus Staff"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Credentials Box (Email, Password, PIN 6 Angka) */}
                      <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl p-3 space-y-2 mt-3 text-xs">
                        {/* Email */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-zinc-400">
                            <Mail className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            <span>Email Login:</span>
                          </div>
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="font-mono text-white text-[11px] truncate max-w-[170px]" title={stf.email}>
                              {stf.email || 'Belum diatur'}
                            </span>
                            {stf.email && (
                              <button
                                onClick={() => handleCopyText(stf.email, `email_${stf.id}`)}
                                className="p-1 rounded text-zinc-500 hover:text-white hover:bg-zinc-800 cursor-pointer"
                                title="Salin Email"
                              >
                                {copiedKey === `email_${stf.id}` ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* PIN 6 Angka (POS Terminal & Supervisor) */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-zinc-400">
                            <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span>PIN Kasir (6 Angka):</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono tracking-widest px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700/80 text-amber-400 font-black text-xs">
                              {isPinVisible ? stf.pin : '••••••'}
                            </span>
                            <button
                              onClick={() => togglePinVisibility(stf.id || '')}
                              className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                              title={isPinVisible ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                            >
                              {isPinVisible ? (
                                <EyeOff className="w-3.5 h-3.5 text-amber-400" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </button>
                            {stf.pin && (
                              <button
                                onClick={() => handleCopyText(stf.pin, `pin_${stf.id}`)}
                                className="p-1 rounded text-zinc-500 hover:text-white hover:bg-zinc-800 cursor-pointer"
                                title="Salin PIN 6 Angka"
                              >
                                {copiedKey === `pin_${stf.id}` ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Password */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-zinc-400">
                            <Lock className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                            <span>Password:</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-zinc-300 text-[11px]">
                              {isPinVisible ? (stf.password || '••••••••') : '••••••••'}
                            </span>
                            {stf.password && (
                              <button
                                onClick={() => handleCopyText(stf.password || '', `pass_${stf.id}`)}
                                className="p-1 rounded text-zinc-500 hover:text-white hover:bg-zinc-800 cursor-pointer"
                                title="Salin Password"
                              >
                                {copiedKey === `pass_${stf.id}` ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Penempatan, Shift & Real-Time POS / Pengirim Activity */}
                      <div className="text-xs text-zinc-400 space-y-1.5 pt-2.5 mt-2.5 border-t border-zinc-800/80">
                        <div>Penempatan: <strong className="text-zinc-200">{stf.outlet}</strong></div>
                        <div>Shift Jadwal: <strong className="text-zinc-300">{stf.shift}</strong></div>
                        <div className="flex items-center gap-1 pt-0.5">
                          <Phone className="w-3 h-3 text-zinc-500" />
                          <span>{stf.phone}</span>
                        </div>
                        {(() => {
                          const perf = staffPerformanceMap.get(stf.id || stf.name);
                          if (!perf) return null;
                          return (
                            <div className="grid grid-cols-3 gap-1.5 pt-2 mt-1 border-t border-zinc-800/60 text-[10px]">
                              <div className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800">
                                <span className="text-zinc-500 block">Kasir POS</span>
                                <span className="font-mono font-bold text-blue-400">
                                  {perf.cashierTxCount} Struk
                                </span>
                              </div>
                              <div className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800">
                                <span className="text-zinc-500 block">Pengiriman</span>
                                <span className="font-mono font-bold text-cyan-400">
                                  {perf.deliveryCount} Order
                                </span>
                              </div>
                              <div className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800">
                                <span className="text-zinc-500 block">Komisi Kurir</span>
                                <span className="font-mono font-bold text-emerald-400">
                                  {formatMoney(perf.deliveryCommissionTotal)}
                                </span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Card Footer Actions */}
                    <div className="pt-3 border-t border-zinc-800 flex items-center justify-between text-xs gap-2">
                      <button
                        onClick={() => setSelectedStaffCredentials(stf)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-amber-400 hover:text-amber-300 font-bold transition cursor-pointer text-xs"
                        title="Lihat & Salin Kredensial Lengkap untuk WhatsApp"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Kredensial Akses</span>
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleOpenEditStaff(stf)}
                          className="flex items-center gap-1 text-xs font-bold text-purple-400 hover:text-purple-300 transition cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                        <button
                          onClick={() => handleDeleteStaff(stf)}
                          className="flex items-center gap-1 text-xs font-bold text-rose-400 hover:text-rose-300 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>

          {staffList.length === 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center text-zinc-400">
              <UserCheck className="w-10 h-10 text-purple-400 mx-auto mb-2 opacity-50" />
              <p className="font-bold text-white text-sm">Belum ada staff terdaftar di database</p>
              <p className="text-xs text-zinc-500 mt-1">Klik tombol &quot;+ Tambah Staff Baru&quot; di atas untuk mendaftarkan karyawan.</p>
            </div>
          )}
        </div>
      )}

      {/* VIEW: ROLE / JABATAN */}
      {activeSub === 'role_jabatan' && (
        <div className="space-y-6">
          {/* Master Divisi & Role F&B / Retail (Kitchen, Service, Bar, Kasir, Gudang) */}
          <StaffDivisionRoleSection onNavigateTab={onNavigateTab} />

          {/* Database Connection & Cloud Sync Banner */}
          <div className="bg-gradient-to-r from-zinc-900 via-zinc-900 to-blue-950/40 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg">
            <div className="flex items-start sm:items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 shrink-0">
                <Cloud className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <h3 className="font-bold text-white text-sm">
                    Database Cloud Terhubung: Firestore <code className="text-blue-400 text-xs font-mono">/staff_roles</code>
                  </h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    7 Master Aktif
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Owner, Cashier, Inventory Keeper, Shipper, Finance, Purchase, Enginer tersimpan di database dan tersinkron ke RBAC Hak & Akses.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleManualSyncDatabase}
                disabled={isSyncingDb}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold border border-zinc-700 shadow transition cursor-pointer disabled:opacity-50"
                title="Sinkronkan seluruh role master ke koleksi database Firestore"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isSyncingDb ? 'animate-spin' : ''}`} />
                <span>{isSyncingDb ? 'Menyinkronkan...' : 'Sinkronkan ke Database'}</span>
              </button>

              <button
                onClick={() => navigateToPath('/dashboard/hakdanakses')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-zinc-950 font-black text-xs shadow-md transition cursor-pointer"
                title="Buka Matriks Hak & Akses (RBAC)"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Matriks Hak & Akses</span>
                <ArrowRight className="w-3 h-3 ml-0.5" />
              </button>
            </div>
          </div>

          {/* Sync Success / Alert Toast */}
          {syncMessage && (
            <div className="p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-xl text-emerald-300 text-xs flex items-center justify-between gap-2 animate-in fade-in">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{syncMessage}</span>
              </div>
              <button
                onClick={() => setSyncMessage(null)}
                className="text-emerald-400 hover:text-emerald-200 text-xs font-bold px-1"
              >
                ✕
              </button>
            </div>
          )}

          {/* Toolbar: search + tambah role */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Cari role (Owner, Cashier, Inventory Keeper, dll)..."
                value={roleSearchQuery}
                onChange={(e) => setRoleSearchQuery(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              onClick={handleOpenAddRole}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Tambah Role / Jabatan</span>
            </button>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRoles.map((r) => {
              const roleColor = r.color || '#3b82f6';
              const isOwner = (r.name || '').toLowerCase() === 'owner';

              return (
                <div
                  key={r.id}
                  className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-3 flex flex-col justify-between hover:border-zinc-700 transition shadow-sm relative overflow-hidden group"
                >
                  {/* Color Accent Top Bar */}
                  <div
                    className="absolute top-0 left-0 right-0 h-1 transition-all"
                    style={{ backgroundColor: roleColor }}
                  />

                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                          style={{ backgroundColor: roleColor }}
                        />
                        <span className="text-[10px] font-bold text-zinc-300 bg-zinc-800/80 border border-zinc-700 px-2 py-0.5 rounded">
                          {r.membersCount} Pegawai
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenEditRole(r)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
                          title="Edit Role / Jabatan"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {!isOwner && (
                          <button
                            onClick={() => handleDeleteRole(r)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer"
                            title="Hapus Role / Jabatan"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-2">
                      <h3 className="font-bold text-white text-base">{r.name}</h3>
                      <span
                        className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border"
                        style={{
                          backgroundColor: `${roleColor}15`,
                          borderColor: `${roleColor}40`,
                          color: roleColor,
                        }}
                      >
                        {r.roleKey || r.name.toLowerCase()}
                      </span>
                    </div>

                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed min-h-[36px]">
                      {r.description || 'Tidak ada deskripsi tugas.'}
                    </p>

                    {/* RBAC Badges */}
                    <div className="grid grid-cols-2 gap-1.5 pt-3 mt-3 border-t border-zinc-800/80 text-[11px]">
                      <div className={`px-2 py-1 rounded-md border flex items-center justify-between font-medium ${r.canVoid ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400' : 'bg-zinc-950 border-zinc-800 text-zinc-500'}`}>
                        <span>Void Transaksi:</span>
                        <strong className="font-bold">{r.canVoid ? 'Ya' : 'Tidak'}</strong>
                      </div>
                      <div className={`px-2 py-1 rounded-md border flex items-center justify-between font-medium ${r.canEditPrice ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400' : 'bg-zinc-950 border-zinc-800 text-zinc-500'}`}>
                        <span>Ubah Harga:</span>
                        <strong className="font-bold">{r.canEditPrice ? 'Ya' : 'Tidak'}</strong>
                      </div>
                      <div className={`px-2 py-1 rounded-md border flex items-center justify-between font-medium ${r.canAccessFinance ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400' : 'bg-zinc-950 border-zinc-800 text-zinc-500'}`}>
                        <span>Akses Laba:</span>
                        <strong className="font-bold">{r.canAccessFinance ? 'Ya' : 'Tidak'}</strong>
                      </div>
                      <div className={`px-2 py-1 rounded-md border flex items-center justify-between font-medium ${r.canExport ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400' : 'bg-zinc-950 border-zinc-800 text-zinc-500'}`}>
                        <span>Export Data:</span>
                        <strong className="font-bold">{r.canExport ? 'Ya' : 'Tidak'}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Actions: Direct Link to Hak & Akses + Edit */}
                  <div className="pt-3 border-t border-zinc-800 flex items-center justify-between gap-2 text-xs">
                    <button
                      onClick={() => {
                        const targetKey = r.roleKey || (r.name || '').toLowerCase().replace(/\s+/g, '_');
                        navigateToPath(`/dashboard/hakdanakses?role=${targetKey}`);
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-amber-400 hover:text-amber-300 font-bold transition cursor-pointer text-xs"
                      title={`Konfigurasi detail izin ${r.name} di Hak & Akses`}
                    >
                      <Shield className="w-3.5 h-3.5 text-amber-400" />
                      <span>Atur Izin Hak & Akses</span>
                    </button>

                    <button
                      onClick={() => handleOpenEditRole(r)}
                      className="flex items-center gap-1 text-xs font-bold text-blue-400 hover:text-blue-300 transition cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredRoles.length === 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center text-zinc-400">
              <Briefcase className="w-10 h-10 text-blue-400 mx-auto mb-2 opacity-50" />
              <p className="font-bold text-white text-sm">Tidak ada role / jabatan yang sesuai</p>
              <p className="text-xs text-zinc-500 mt-1">Coba gunakan kata kunci pencarian lain atau klik tombol &quot;+ Tambah Role / Jabatan&quot;.</p>
            </div>
          )}
        </div>
      )}

      {/* VIEW: OTORITAS AKSES / HAK AKSES (RBAC MATRIX DYNAMIC) */}
      {(activeSub === 'hak_akses' || activeSub === 'otoritas_akses') && (
        <HakDanAksesView onNavigateTab={onNavigateTab} />
      )}

      {/* VIEW: KPI STAFF (REAL-TIME KASIR & PENGIRIM / SHIPPER PERFORMANCE) */}
      {activeSub === 'kpi_staff' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
            <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-zinc-500 block text-[10px] font-bold uppercase">Kasir Terbaik Bulan Ini</span>
              <span className="text-lg font-bold text-amber-400 mt-1 block">
                {topStaff ? `${topStaff.name} (${topStaff.outlet || 'Pusat'})` : 'Belum Ada Data Staff'}
              </span>
              <span className="text-emerald-400 text-[11px] font-bold mt-1 block">
                {topStaff ? `Skor KPI ${topStaff.kpiScore}` : 'Tambahkan staff untuk melihat KPI'}
              </span>
            </div>
            <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-zinc-500 block text-[10px] font-bold uppercase">Total Staff Aktif</span>
              <span className="text-xl font-mono font-bold text-white mt-1 block">{staffList.length} Staff</span>
              <span className="text-zinc-400 text-[11px] mt-1 block">Tersinkron ke POS &amp; Pengirim</span>
            </div>
            <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-zinc-500 block text-[10px] font-bold uppercase">Total Pengiriman Kurir (POS &amp; Order)</span>
              <span className="text-xl font-mono font-bold text-cyan-400 mt-1 block">
                {Array.from(staffPerformanceMap.values()).reduce((s, p) => s + p.deliveryCount, 0)} Pengiriman
              </span>
              <span className="text-zinc-400 text-[11px] mt-1 block">Dari dropdown Pengirim POS &amp; Orders</span>
            </div>
            <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <span className="text-zinc-500 block text-[10px] font-bold uppercase">Total Komisi Pengirim Terkumpul</span>
              <span className="text-xl font-mono font-bold text-emerald-400 mt-1 block">
                {formatMoney(
                  Array.from(staffPerformanceMap.values()).reduce(
                    (s, p) => s + p.deliveryCommissionTotal,
                    0
                  )
                )}
              </span>
              <span className="text-zinc-400 text-[11px] mt-1 block">Dihitung otomatis per produk dikirim</span>
            </div>
          </div>

          {/* Real-Time Staff Performance & Courier Commission Table */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Rekapitulasi Kinerja Kasir POS &amp; Komisi Pengirim (Real-Time)
                </h3>
              </div>
              <span className="text-[11px] text-zinc-400">
                Terhubung langsung dengan transaksi POS &amp; penugasan Pengirim
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Nama Staff</th>
                    <th className="py-3 px-4">Role / Jabatan</th>
                    <th className="py-3 px-4 text-center">Transaksi Kasir</th>
                    <th className="py-3 px-4 text-right">Omzet Kasir POS</th>
                    <th className="py-3 px-4 text-center">Jumlah Pengiriman</th>
                    <th className="py-3 px-4 text-right">Nilai Barang Dikirim</th>
                    <th className="py-3 px-4 text-right">Komisi Pengirim</th>
                    <th className="py-3 px-4 text-center">Skor KPI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {staffList.map((stf) => {
                    const perf = staffPerformanceMap.get(stf.id || stf.name) || {
                      cashierTxCount: 0,
                      cashierSalesAmount: 0,
                      deliveryCount: 0,
                      deliveryTotalValue: 0,
                      deliveryCommissionTotal: 0,
                    };
                    return (
                      <tr key={stf.id} className="hover:bg-zinc-800/40 transition">
                        <td className="py-3 px-4 font-bold text-white">{stf.name}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-200 border border-zinc-700">
                            {stf.role}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-blue-400 font-bold">
                          {perf.cashierTxCount} struk
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-zinc-200">
                          {formatMoney(perf.cashierSalesAmount)}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-cyan-400 font-bold">
                          {perf.deliveryCount} order
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-zinc-200">
                          {formatMoney(perf.deliveryTotalValue)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                          +{formatMoney(perf.deliveryCommissionTotal)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                            {stf.kpiScore ?? 100}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: AI SETTING JOB STAFF */}
      {activeSub === 'ai_setting_job_staff' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-pink-400" />
            <h3 className="font-bold text-white text-base">AI Job Setting &amp; SOP Generator (Gemini 3.8 Flash)</h3>
          </div>
          <p className="text-xs text-zinc-400">
            Rumuskan deskripsi pekerjaan, batasan wewenang pencegahan fraud, dan metrik target KPI untuk setiap staf toko secara instan.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={jobTitleInput}
              onChange={(e) => setJobTitleInput(e.target.value)}
              placeholder="Ketik jabatan, misal: Kasir Shift Malam atau Admin Gudang..."
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-pink-500"
            />
            <button
              onClick={handleGenerateJobAI}
              disabled={isGenerating}
              className="px-5 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              <span>{isGenerating ? 'AI Merumuskan SOP...' : 'Generate Standar Job AI'}</span>
            </button>
          </div>

          {aiJobResult && (
            <div className="p-5 bg-zinc-950 rounded-2xl border border-pink-900/50 space-y-4 text-xs">
              <div className="border-b border-zinc-800 pb-3">
                <span className="text-[10px] font-bold text-pink-400 bg-pink-950/80 border border-pink-800 px-2 py-0.5 rounded">
                  AI RECOMMENDATION READY
                </span>
                <p className="text-white font-medium mt-2">{aiJobResult.summary}</p>
              </div>

              <div>
                <h4 className="font-bold text-white uppercase text-[11px] mb-1.5 text-zinc-300">Tanggung Jawab Utama (SOP):</h4>
                <ul className="list-disc list-inside space-y-1 text-zinc-400">
                  {aiJobResult.responsibilities.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="font-bold text-white uppercase text-[11px] mb-1.5 text-amber-300">Target KPI Terukur:</h4>
                <ul className="list-disc list-inside space-y-1 text-zinc-400">
                  {aiJobResult.kpiMetrics.map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="font-bold text-white uppercase text-[11px] mb-1.5 text-rose-300">Prosedur Keamanan &amp; Pencegahan Fraud:</h4>
                <ul className="list-disc list-inside space-y-1 text-zinc-400">
                  {aiJobResult.riskSafeguards.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: Tambah / Edit Staff Baru (Email, Password, PIN 6-Digit) */}
      {showAddStaffModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {editingStaff ? 'Edit Data Karyawan & Akun' : 'Tambah Karyawan / Staf Baru'}
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Lengkapi nama, role, email, password, dan PIN 6 angka kasir
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowAddStaffModal(false);
                  setEditingStaff(null);
                  setStaffFormError(null);
                }}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error Banner */}
            {staffFormError && (
              <div className="mt-4 p-3 bg-rose-950/70 border border-rose-800 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{staffFormError}</span>
              </div>
            )}

            <form onSubmit={handleSaveStaff} className="space-y-4 pt-4 text-xs">
              {/* Nama Lengkap */}
              <div>
                <label className="block text-zinc-300 font-bold mb-1">
                  Nama Lengkap Karyawan <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Dede Fajar Kurniawan"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              {/* Pilih Divisi & Pilih Role / Jabatan Dinamis */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-2xl bg-zinc-950/90 border border-amber-500/30">
                <div>
                  <label className="block text-amber-400 font-bold mb-1">
                    1. Pilih Divisi <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={newStaffDivisionId}
                    onChange={(e) => {
                      const nextDivId = e.target.value;
                      setNewStaffDivisionId(nextDivId);
                      const foundDiv = staffDivisions.find((d) => d.id === nextDivId);
                      if (foundDiv && foundDiv.roles.length > 0) {
                        setNewStaffRole(foundDiv.roles[0].name);
                        setNewStaffStation(foundDiv.roles[0].defaultStation || 'Operasional Utama');
                      }
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    {staffDivisions.map((div) => (
                      <option key={div.id} value={div.id}>
                        {div.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-emerald-400 font-bold">
                      2. Pilih Role / Jabatan <span className="text-rose-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleOpenAddRole}
                      className="text-[10px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-0.5 cursor-pointer"
                      title="Tambah Role Baru"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Role Baru</span>
                    </button>
                  </div>
                  <select
                    value={newStaffRole}
                    onChange={(e) => {
                      const roleVal = e.target.value;
                      setNewStaffRole(roleVal);
                      const foundDiv = staffDivisions.find((d) => d.id === newStaffDivisionId);
                      const foundRole = foundDiv?.roles.find((r) => r.name === roleVal);
                      if (foundRole?.defaultStation) {
                        setNewStaffStation(foundRole.defaultStation);
                      }
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <optgroup label="Jabatan Sesuai Divisi Terpilih">
                      {selectedDivisionRoles.map((r) => (
                        <option key={r.id || r.name} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Role Sistem & RBAC Lainnya">
                      {roles.map((r) => (
                        <option key={`rbac_${r.id}`} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              </div>

              {/* Stasiun Kerja & Cabang Penempatan */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-300 font-bold mb-1">
                    Stasiun / Area Kerja
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: Pass & Command Center / Grill"
                    value={newStaffStation}
                    onChange={(e) => setNewStaffStation(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-zinc-300 font-bold mb-1">Cabang Penempatan</label>
                  <select
                    value={newStaffOutlet}
                    onChange={(e) => setNewStaffOutlet(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    {outletsList.length > 0 ? (
                      outletsList.map((o: any) => (
                        <option key={o.id} value={o.name}>{o.name}</option>
                      ))
                    ) : (
                      <option value="Cabang Utama (Pusat)">Cabang Utama (Pusat)</option>
                    )}
                  </select>
                </div>
              </div>

              {/* Kredensial: Email & Password */}
              <div className="p-3.5 bg-zinc-950/70 border border-zinc-800/80 rounded-2xl space-y-3">
                <div className="flex items-center gap-1.5 text-zinc-200 font-bold text-[11px] pb-1 border-b border-zinc-800">
                  <Lock className="w-3.5 h-3.5 text-purple-400" />
                  <span>Kredensial Login Akun (Email &amp; Kata Sandi)</span>
                </div>

                {/* Email Login */}
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">
                    Email Akun Staf <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5 pointer-events-none" />
                    <input
                      type="email"
                      required
                      placeholder="irfan.kasir@riskcart.com"
                      value={newStaffEmail}
                      onChange={(e) => setNewStaffEmail(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 text-xs font-mono"
                    />
                  </div>
                </div>

                {/* Password Login */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-zinc-400 font-bold">
                      Password Login <span className="text-rose-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={generateRandomPassword}
                      className="text-[10px] font-bold text-purple-400 hover:text-purple-300 flex items-center gap-1 cursor-pointer"
                      title="Buat password acak yang aman"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Acak Password</span>
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPasswordInModal ? 'text' : 'password'}
                      required
                      placeholder="Minimal 6 karakter"
                      value={newStaffPassword}
                      onChange={(e) => setNewStaffPassword(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 pr-10 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 text-xs font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordInModal(!showPasswordInModal)}
                      className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-200 cursor-pointer"
                    >
                      {showPasswordInModal ? (
                        <EyeOff className="w-4 h-4 text-purple-400" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* PIN Keamanan 6 Digit Angka (POS / Kasir / Void Otorisasi) */}
              <div className="p-3.5 bg-zinc-950/70 border border-amber-900/40 rounded-2xl space-y-3">
                <div className="flex items-center justify-between pb-1 border-b border-zinc-800">
                  <div className="flex items-center gap-1.5 text-amber-300 font-bold text-[11px]">
                    <Key className="w-3.5 h-3.5 text-amber-400" />
                    <span>PIN Kasir POS (Wajib 6 Angka)</span>
                  </div>
                  <button
                    type="button"
                    onClick={generateRandomPin}
                    className="text-[10px] font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                    title="Generate 6-digit angka unik acak"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Acak 6 Digit PIN</span>
                  </button>
                </div>

                <div>
                  <div className="relative">
                    <Hash className="w-4 h-4 text-amber-500/70 absolute left-3 top-2.5 pointer-events-none" />
                    <input
                      type={showPinInModal ? 'text' : 'password'}
                      maxLength={6}
                      required
                      placeholder="6 angka (contoh: 123456)"
                      value={newStaffPin}
                      onChange={(e) => setNewStaffPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-10 py-2 text-amber-400 placeholder-zinc-600 focus:outline-none focus:border-amber-500 text-sm font-mono tracking-widest font-black"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPinInModal(!showPinInModal)}
                      className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-200 cursor-pointer"
                    >
                      {showPinInModal ? (
                        <EyeOff className="w-4 h-4 text-amber-400" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {/* 6-box visual digit display */}
                  <div className="flex items-center gap-1.5 mt-2.5">
                    {[0, 1, 2, 3, 4, 5].map((idx) => {
                      const digit = newStaffPin[idx];
                      return (
                        <div
                          key={idx}
                          className={`flex-1 h-9 rounded-lg border flex items-center justify-center font-mono font-bold text-sm transition-all ${
                            digit
                              ? 'bg-amber-950/50 border-amber-500/80 text-amber-300 shadow-sm'
                              : 'bg-zinc-900 border-zinc-800 text-zinc-600'
                          }`}
                        >
                          {digit ? (showPinInModal ? digit : '•') : '-'}
                        </div>
                      );
                    })}
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ml-1 ${
                      newStaffPin.length === 6 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-zinc-900 text-zinc-500'
                    }`}>
                      {newStaffPin.length}/6 Digit
                    </span>
                  </div>

                  <p className="text-[10px] text-zinc-400 mt-1.5 leading-relaxed">
                    PIN 6 angka ini digunakan untuk login cepat kasir di mesin POS, pergantian shift, dan persetujuan otorisasi void transaksi.
                  </p>
                </div>
              </div>

              {/* Shift & Kontak */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-300 font-bold mb-1">Shift Kerja</label>
                  <select
                    value={newStaffShift}
                    onChange={(e) => setNewStaffShift(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    <option value="Pagi (07:30 - 15:00)">Pagi (07:30 - 15:00)</option>
                    <option value="Sore (15:00 - 22:30)">Sore (15:00 - 22:30)</option>
                    <option value="Reguler (08:00 - 17:00)">Reguler (08:00 - 17:00)</option>
                    <option value="On-Demand Antar">On-Demand Antar</option>
                  </select>
                </div>

                <div>
                  <label className="block text-zinc-300 font-bold mb-1">No. WhatsApp / HP</label>
                  <input
                    type="text"
                    placeholder="+62 8..."
                    value={newStaffPhone}
                    onChange={(e) => setNewStaffPhone(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddStaffModal(false);
                    setEditingStaff(null);
                    setStaffFormError(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold transition shadow-lg shadow-purple-900/30 cursor-pointer"
                >
                  {editingStaff ? 'Simpan Perubahan ke Database' : 'Simpan Karyawan ke Database'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Kredensial Akses Karyawan (Shareable / WhatsApp ready) */}
      {selectedStaffCredentials && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Kredensial Akses Staf</h3>
                  <p className="text-xs text-zinc-400">{selectedStaffCredentials.name}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedStaffCredentials(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="pt-4 space-y-3.5 text-xs">
              <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 space-y-2.5 font-mono">
                <div>
                  <span className="text-zinc-500 text-[10px] block uppercase font-sans font-bold">Nama Karyawan:</span>
                  <span className="text-white font-bold font-sans text-sm">{selectedStaffCredentials.name}</span>
                </div>

                <div>
                  <span className="text-zinc-500 text-[10px] block uppercase font-sans font-bold">Jabatan / Role:</span>
                  <span className="text-purple-400 font-bold">{selectedStaffCredentials.role}</span>
                </div>

                <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between">
                  <div>
                    <span className="text-zinc-500 text-[10px] block uppercase font-sans font-bold">Email Login:</span>
                    <span className="text-blue-400">{selectedStaffCredentials.email || '-'}</span>
                  </div>
                  {selectedStaffCredentials.email && (
                    <button
                      onClick={() => handleCopyText(selectedStaffCredentials.email, 'modal_email')}
                      className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 font-sans text-[11px] flex items-center gap-1 border border-zinc-700 cursor-pointer"
                    >
                      {copiedKey === 'modal_email' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'modal_email' ? 'Tersalin' : 'Salin'}</span>
                    </button>
                  )}
                </div>

                <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between">
                  <div>
                    <span className="text-zinc-500 text-[10px] block uppercase font-sans font-bold">Password Login:</span>
                    <span className="text-purple-300 font-bold">{selectedStaffCredentials.password || '-'}</span>
                  </div>
                  {selectedStaffCredentials.password && (
                    <button
                      onClick={() => handleCopyText(selectedStaffCredentials.password, 'modal_pass')}
                      className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 font-sans text-[11px] flex items-center gap-1 border border-zinc-700 cursor-pointer"
                    >
                      {copiedKey === 'modal_pass' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'modal_pass' ? 'Tersalin' : 'Salin'}</span>
                    </button>
                  )}
                </div>

                <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between">
                  <div>
                    <span className="text-zinc-500 text-[10px] block uppercase font-sans font-bold">PIN Kasir (6 Angka):</span>
                    <span className="text-amber-400 font-black tracking-widest text-base">{selectedStaffCredentials.pin || '-'}</span>
                  </div>
                  {selectedStaffCredentials.pin && (
                    <button
                      onClick={() => handleCopyText(selectedStaffCredentials.pin, 'modal_pin')}
                      className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-amber-300 font-sans text-[11px] flex items-center gap-1 border border-amber-800/60 cursor-pointer"
                    >
                      {copiedKey === 'modal_pin' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'modal_pin' ? 'Tersalin' : 'Salin'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Copy all button */}
              <button
                onClick={() => handleCopyAllCredentials(selectedStaffCredentials)}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 transition cursor-pointer"
              >
                {copiedKey === `all_${selectedStaffCredentials.id}` ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-200" />
                    <span>Tersalin ke Clipboard! (Siap Dikirim via WhatsApp)</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-4 h-4" />
                    <span>Salin Seluruh Kredensial (Format WhatsApp)</span>
                  </>
                )}
              </button>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setSelectedStaffCredentials(null)}
                  className="px-4 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Tambah / Edit Role / Jabatan */}
      {showRoleModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">
                  {editingRole ? 'Edit Role / Jabatan' : 'Tambah Role / Jabatan Baru'}
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowRoleModal(false);
                  setEditingRole(null);
                }}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRole} className="space-y-4 pt-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">
                  Nama Role / Jabatan *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Supervisor Shift, Store Manager, Kurir"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-bold mb-1">
                  Deskripsi Tugas &amp; Tanggung Jawab
                </label>
                <textarea
                  rows={3}
                  placeholder="Jelaskan ruang lingkup pekerjaan dan tanggung jawab posisi ini..."
                  value={roleDescription}
                  onChange={(e) => setRoleDescription(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-bold mb-2">
                  Otoritas Hak Akses Sistem (RBAC)
                </label>
                <div className="space-y-2.5 bg-zinc-950 border border-zinc-800/80 rounded-xl p-3">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={roleCanVoid}
                      onChange={(e) => setRoleCanVoid(e.target.checked)}
                      className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-zinc-200 block">Izin Void Transaksi (canVoid)</span>
                      <span className="text-[11px] text-zinc-500 block">Dapat membatalkan atau me-void struk belanja kasir.</span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={roleCanEditPrice}
                      onChange={(e) => setRoleCanEditPrice(e.target.checked)}
                      className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-zinc-200 block">Ubah Harga Jual &amp; Beli (canEditPrice)</span>
                      <span className="text-[11px] text-zinc-500 block">Dapat mengedit master harga produk, grosir, dan diskon.</span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={roleCanAccessFinance}
                      onChange={(e) => setRoleCanAccessFinance(e.target.checked)}
                      className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-zinc-200 block">Akses Laba &amp; Keuangan (canAccessFinance)</span>
                      <span className="text-[11px] text-zinc-500 block">Dapat melihat laba bersih toko, brangkas, dan mutasi saldo kas.</span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={roleCanExport}
                      onChange={(e) => setRoleCanExport(e.target.checked)}
                      className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-zinc-200 block">Export Data &amp; Laporan (canExport)</span>
                      <span className="text-[11px] text-zinc-500 block">Dapat mengunduh rekap transaksi dan kartu stok ke CSV/Excel.</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowRoleModal(false);
                    setEditingRole(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition shadow-lg cursor-pointer"
                >
                  {editingRole ? 'Simpan Perubahan' : 'Simpan Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
