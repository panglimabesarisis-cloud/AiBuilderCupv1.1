import React, { useState, useMemo, useEffect } from 'react';
import {
  Vault,
  Coins,
  TrendingUp,
  CreditCard,
  History,
  Plus,
  X,
  Eye,
  Edit2,
  Trash2,
  Calendar,
  UserCheck,
  ArrowUpCircle,
  ArrowDownCircle,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { useFirestoreList } from '../../hooks/useFirestoreList';
import { useAppNavigation } from '../../router';
import { useAppData } from '../../context/AppDataContext';
import { useAccessControl } from '../../context/AccessControlContext';
import { openTransactionDetailModal } from '../common/GlobalModals';

interface FinanceModuleProps {
  subModule:
    | 'brangkas_toko'
    | 'brangkas_modal'
    | 'brangkas_untung'
    | 'type_keuangan'
    | 'riwayat_keuangan'
    | string;
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

const INITIAL_SAFE_DEPOSITS: any[] = [];

const DEFAULT_DARI_SUMBER_OPTIONS: string[] = [];
const DEFAULT_JENIS_JURNAL_OPTIONS: string[] = [];

const LEGACY_PRESET_JENIS_JURNAL = new Set([
  'Uang Laci',
  'Transaksi Penjualan',
  'Setoran Kasir ke Brangkas Toko',
  'Pengeluaran Shift / Kas Keluar',
  'Modal Penjualan',
  'Alokasi Dana Cadangan Brangkas Modal',
  'Keuntungan Penjualan',
  'Pencairan / Dividen Brangkas Untung',
  'Operasional Toko',
  'Lainnya',
]);

const LEGACY_PRESET_DARI_SUMBER = new Set([
  'Uang Laci',
  'Hasil Penjualan',
  'Bonus',
  'Kopral',
  'Lainnya',
]);

const USER_JENIS_JURNAL_STORAGE_KEY = 'rc_user_jenis_jurnal_options_v2';
const USER_DARI_SUMBER_STORAGE_KEY = 'rc_user_dari_sumber_options_v2';
const LEGACY_OPTIONS_CLEANED_FLAG = 'rc_finance_legacy_presets_cleaned_v2';

const TUJUAN_ALOKASI_OPTIONS = [
  'Brangkas Modal',
  'Brangkas Untung',
  'Brangkas Toko',
] as const;

const FLOW_TYPE_OPTIONS = ['Kas Masuk', 'Kas Keluar'] as const;

function parseNominalValue(val: any): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? Math.abs(val) : 0;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return 0;
    // Handle Indonesian dot thousand separators like "200.000" or "Rp 1.500.000"
    const cleaned = trimmed.replace(/[^\d.,-]/g, '');
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
      const normalized = cleaned.replace(/\./g, '').replace(',', '.');
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
    }
    const digitsOnly = cleaned.replace(/\./g, '').replace(/,/g, '');
    const parsed = Number(digitsOnly);
    return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
  }
  return 0;
}

function resolveTimestampMs(item: any): number {
  if (item?.createdAt) {
    const t = new Date(item.createdAt).getTime();
    if (!Number.isNaN(t) && t > 0) return t;
  }
  if (item?.openedAt) {
    const t = new Date(item.openedAt).getTime();
    if (!Number.isNaN(t) && t > 0) return t;
  }
  if (item?.closedAt) {
    const t = new Date(item.closedAt).getTime();
    if (!Number.isNaN(t) && t > 0) return t;
  }
  const datePart = String(item?.tanggal || item?.orderDate || item?.shiftDate || item?.date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(datePart)) {
    const ymd = datePart.slice(0, 10);
    const rawTime = String(item?.jam || item?.time || item?.jamBuka || '00:00:00')
      .replace(/WIB/i, '')
      .trim()
      .replace(/\./g, ':');
    const timeMatch = rawTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    const hh = timeMatch ? timeMatch[1].padStart(2, '0') : '12';
    const mm = timeMatch ? timeMatch[2].padStart(2, '0') : '00';
    const ss = timeMatch && timeMatch[3] ? timeMatch[3].padStart(2, '0') : '00';
    const dt = new Date(`${ymd}T${hh}:${mm}:${ss}`);
    if (!Number.isNaN(dt.getTime())) return dt.getTime();
  }
  if (datePart) {
    const fallback = new Date(datePart).getTime();
    if (!Number.isNaN(fallback) && fallback > 0) return fallback;
  }
  return 0;
}

function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatCurrentTimeWib(): string {
  return `${new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })} WIB`;
}

function formatDisplayDate(isoOrDate: string): string {
  if (!isoOrDate) return '-';
  if (/^\d{4}-\d{2}-\d{2}/.test(isoOrDate)) {
    const [y, m, d] = isoOrDate.slice(0, 10).split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (!Number.isNaN(dt.getTime())) {
      return dt.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    }
  }
  return isoOrDate;
}

function extractTanggalAndJam(item: any): { tanggal: string; jam: string } {
  const rawTanggal = item.tanggal || item.orderDate || item.shiftDate || '';
  const rawJam = item.jam || item.time || item.jamBuka || '';
  if (rawTanggal && rawJam) {
    return {
      tanggal: formatDisplayDate(rawTanggal),
      jam: rawJam,
    };
  }
  if (rawTanggal) {
    const ts = item.createdAt || item.openedAt || item.closedAt;
    const jamFromCreated = ts
      ? `${new Date(ts).toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
        })} WIB`
      : '-';
    return {
      tanggal: formatDisplayDate(rawTanggal),
      jam: rawJam || jamFromCreated,
    };
  }
  if (item.date && typeof item.date === 'string' && item.date.includes(',')) {
    const parts = item.date.split(',');
    return {
      tanggal: parts[0].trim(),
      jam: parts.slice(1).join(',').trim() || '-',
    };
  }
  const ts = item.createdAt || item.openedAt || item.closedAt;
  if (ts) {
    const dt = new Date(ts);
    if (!Number.isNaN(dt.getTime())) {
      return {
        tanggal: dt.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
        jam:
          rawJam ||
          `${dt.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
          })} WIB`,
      };
    }
  }
  return {
    tanggal: item.date || '-',
    jam: rawJam || '-',
  };
}

function resolveFlowType(item: any): 'Kas Masuk' | 'Kas Keluar' {
  if (
    item.flowType === 'Kas Keluar' ||
    item.mutationType === 'Kas Keluar' ||
    item.type === 'Kas Keluar' ||
    item.type === 'OPERASIONAL' ||
    item.type === 'PENGELUARAN' ||
    item.sourceType === 'SHIFT_EXPENSE' ||
    item.sourceType === 'KAS_KELUAR' ||
    item.direction === 'out' ||
    item.category === 'Pengeluaran'
  ) {
    return 'Kas Keluar';
  }
  if (
    item.flowType === 'Kas Masuk' ||
    item.mutationType === 'Kas Masuk' ||
    item.type === 'Kas Masuk' ||
    item.sourceType === 'UANG_LACI' ||
    item.sourceType === 'SHIFT_SALES' ||
    item.direction === 'in'
  ) {
    return 'Kas Masuk';
  }
  return 'Kas Masuk';
}

function resolveJenisJurnal(item: any): string {
  if (item.jenisJurnal) return item.jenisJurnal;
  if (item.sourceType === 'UANG_LACI') return 'Uang Laci';
  if (item.sourceType === 'SHIFT_SALES') return 'Transaksi Penjualan';
  if (item.sourceType === 'SHIFT_EXPENSE' || item.sourceType === 'KAS_KELUAR') {
    return item.category || item.note || 'Pengeluaran Shift / Kas Keluar';
  }
  if (item.poNumber) return `Pembayaran Hutang PO (${item.poNumber})`;
  if (item.category === 'Pengeluaran') return 'Pengeluaran PO / Operasional';
  if (item.type === 'SETORAN_BRANKAS') return 'Setoran Kasir ke Brangkas Toko';
  if (item.type === 'MUTASI_MODAL') return 'Modal Penjualan';
  if (item.type === 'ALOKASI_LABA') return 'Pencairan / Dividen Brangkas Untung';
  return item.type || 'Setoran Kasir ke Brangkas Toko';
}

export const FinanceModule: React.FC<FinanceModuleProps> = ({
  subModule,
}) => {
  const { route, pathname, navigateTab } = useAppNavigation();
  const { transactions: ctxTransactions, products: ctxProducts, formatMoney } = useAppData();
  const { activeCashier } = useAccessControl();

  const lowerPath = String(pathname || '').toLowerCase();
  const rawSub = String(
    (route.activeTab === 'module_finance' ? route.activeSubModule : subModule) || 'brangkas_toko'
  ).toLowerCase();

  const activeSub = (
    lowerPath.includes('brangkas-toko') ||
    lowerPath.includes('bangkas-toko') ||
    rawSub === 'brangkas_toko' ||
    rawSub === 'brangkas-toko' ||
    rawSub === 'bangkas_toko' ||
    rawSub === 'bangkas-toko'
      ? 'brangkas_toko'
      : lowerPath.includes('brangkas-modal') || rawSub.includes('modal')
      ? 'brangkas_modal'
      : lowerPath.includes('brangkas-untung') || rawSub.includes('untung')
      ? 'brangkas_untung'
      : lowerPath.includes('tipe-keuangan') || rawSub === 'type_keuangan'
      ? 'type_keuangan'
      : lowerPath.includes('riwayat') || rawSub === 'riwayat_keuangan'
      ? 'riwayat_keuangan'
      : 'brangkas_toko'
  ) as 'brangkas_toko' | 'brangkas_modal' | 'brangkas_untung' | 'type_keuangan' | 'riwayat_keuangan';

  const setActiveSub = (
    next: 'brangkas_toko' | 'brangkas_modal' | 'brangkas_untung' | 'type_keuangan' | 'riwayat_keuangan'
  ) => {
    navigateTab('module_finance', next);
  };

  // Firestore collections
  const {
    data: safeDeposits,
    addItem: addSafeDeposit,
    updateItem: updateSafeDeposit,
    deleteItem: deleteSafeDeposit,
  } = useFirestoreList('safe_deposits', INITIAL_SAFE_DEPOSITS);
  const {
    data: financeMutations,
    updateItem: updateFinanceMutation,
    deleteItem: deleteFinanceMutation,
  } = useFirestoreList<any>('finance_mutations', []);
  const { data: shiftsDocs } = useFirestoreList<any>('shifts', []);
  const { data: shiftHistoryDocs } = useFirestoreList<any>('shift_history', []);
  const { data: shiftKasKeluarDocs } = useFirestoreList<any>('shift_kas_keluar', []);
  const { data: cashFlows } = useFirestoreList<any>('cash_flows', []);
  const { data: purchaseOrders } = useFirestoreList<any>('purchase_orders', []);
  const { data: staffList } = useFirestoreList<any>('staff', []);
  const transactions = ctxTransactions;
  const products = ctxProducts;

  // Resolve Logged-In Staff Full Name automatically
  const loggedInStaffFullName = useMemo(() => {
    if (Array.isArray(staffList) && staffList.length > 0 && activeCashier) {
      const matched = staffList.find(
        (s: any) =>
          (activeCashier.id && s.id === activeCashier.id) ||
          (activeCashier.email &&
            s.email &&
            String(s.email).toLowerCase() === String(activeCashier.email).toLowerCase()) ||
          (activeCashier.name &&
            s.name &&
            String(s.name).toLowerCase() === String(activeCashier.name).toLowerCase())
      );
      if (matched?.name) {
        return String(matched.name);
      }
    }
    return String(activeCashier?.name || staffList?.[0]?.name || '');
  }, [staffList, activeCashier]);

  // Modal State for Add / Edit Journal Entry (Catat Mutasi / Setoran Brankas)
  const [showSetorModal, setShowSetorModal] = useState(false);
  const [editingDeposit, setEditingDeposit] = useState<any | null>(null);
  const [detailDeposit, setDetailDeposit] = useState<any | null>(null);

  const [tanggalInput, setTanggalInput] = useState<string>(getTodayIsoDate);
  const [jenisJurnal, setJenisJurnal] = useState<string>('');
  const [setorAmount, setSetorAmount] = useState<number>(0);
  const [setorFrom, setSetorFrom] = useState<string>('');
  const [setorTo, setSetorTo] = useState<string>('Brangkas Toko');
  const [setorActor, setSetorActor] = useState<string>(loggedInStaffFullName);
  const [setorNote, setSetorNote] = useState<string>('');
  const [flowType, setFlowType] = useState<'Kas Masuk' | 'Kas Keluar'>('Kas Masuk');
  const [formValidationError, setFormValidationError] = useState<string>('');

  // User-managed custom options for Jenis Jurnal & Dari Sumber (Default = Empty [])
  const [jenisJurnalOptions, setJenisJurnalOptions] = useState<string[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_JENIS_JURNAL_OPTIONS;
    try {
      // Clean legacy localStorage keys that might contain old presets
      const legacyKeys = [
        'jenis_jurnal_options',
        'dari_sumber_options',
        'riskcart_jenis_jurnal_options',
        'riskcart_dari_sumber_options',
        'finance_jenis_jurnal_options',
        'finance_dari_sumber_options',
        'brangkas_jenis_jurnal',
        'brangkas_dari_sumber',
        'rc_jenis_jurnal_options',
        'rc_dari_sumber_options',
      ];
      legacyKeys.forEach((k) => window.localStorage.removeItem(k));

      const raw = window.localStorage.getItem(USER_JENIS_JURNAL_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const alreadyCleaned = window.localStorage.getItem(LEGACY_OPTIONS_CLEANED_FLAG) === 'true';
      const cleaned = parsed
        .map((v) => String(v || '').trim())
        .filter((v) => Boolean(v) && (alreadyCleaned || !LEGACY_PRESET_JENIS_JURNAL.has(v)));
      return Array.from(new Set(cleaned));
    } catch {
      return [];
    }
  });

  const [dariSumberOptions, setDariSumberOptions] = useState<string[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_DARI_SUMBER_OPTIONS;
    try {
      const raw = window.localStorage.getItem(USER_DARI_SUMBER_STORAGE_KEY);
      if (!raw) {
        window.localStorage.setItem(LEGACY_OPTIONS_CLEANED_FLAG, 'true');
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        window.localStorage.setItem(LEGACY_OPTIONS_CLEANED_FLAG, 'true');
        return [];
      }
      const alreadyCleaned = window.localStorage.getItem(LEGACY_OPTIONS_CLEANED_FLAG) === 'true';
      const cleaned = parsed
        .map((v) => String(v || '').trim())
        .filter((v) => Boolean(v) && (alreadyCleaned || !LEGACY_PRESET_DARI_SUMBER.has(v)));
      window.localStorage.setItem(LEGACY_OPTIONS_CLEANED_FLAG, 'true');
      return Array.from(new Set(cleaned));
    } catch {
      return [];
    }
  });

  // Inline "+ Tambah Baru" state for Jenis Jurnal & Dari Sumber
  const [showAddJenisJurnal, setShowAddJenisJurnal] = useState(false);
  const [newJenisJurnalInput, setNewJenisJurnalInput] = useState('');
  const [showAddDariSumber, setShowAddDariSumber] = useState(false);
  const [newDariSumberInput, setNewDariSumberInput] = useState('');

  // Persist user-added Jenis Jurnal options to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(USER_JENIS_JURNAL_STORAGE_KEY, JSON.stringify(jenisJurnalOptions));
      window.localStorage.setItem(LEGACY_OPTIONS_CLEANED_FLAG, 'true');
    } catch {
      // ignore storage errors
    }
  }, [jenisJurnalOptions]);

  // Persist user-added Dari Sumber options to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(USER_DARI_SUMBER_STORAGE_KEY, JSON.stringify(dariSumberOptions));
      window.localStorage.setItem(LEGACY_OPTIONS_CLEANED_FLAG, 'true');
    } catch {
      // ignore storage errors
    }
  }, [dariSumberOptions]);

  const handleAddJenisJurnalOption = () => {
    const trimmed = newJenisJurnalInput.trim();
    if (!trimmed) return;
    setJenisJurnalOptions((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setJenisJurnal(trimmed);
    setNewJenisJurnalInput('');
    setShowAddJenisJurnal(false);
    setFormValidationError('');
  };

  const handleDeleteJenisJurnalOption = (optToRemove: string) => {
    setJenisJurnalOptions((prev) => prev.filter((item) => item !== optToRemove));
    if (jenisJurnal === optToRemove) {
      setJenisJurnal('');
    }
  };

  const handleResetJenisJurnalOptions = () => {
    setJenisJurnalOptions([]);
    setJenisJurnal('');
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(USER_JENIS_JURNAL_STORAGE_KEY);
    }
  };

  const handleAddDariSumberOption = () => {
    const trimmed = newDariSumberInput.trim();
    if (!trimmed) return;
    setDariSumberOptions((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setSetorFrom(trimmed);
    setNewDariSumberInput('');
    setShowAddDariSumber(false);
    setFormValidationError('');
  };

  const handleDeleteDariSumberOption = (srcToRemove: string) => {
    setDariSumberOptions((prev) => prev.filter((item) => item !== srcToRemove));
    if (setorFrom === srcToRemove) {
      setSetorFrom('');
    }
  };

  const handleResetDariSumberOptions = () => {
    setDariSumberOptions([]);
    setSetorFrom('');
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(USER_DARI_SUMBER_STORAGE_KEY);
    }
  };

  // Keep auto-input staff name synced when not editing an existing record
  useEffect(() => {
    if (!editingDeposit) {
      setSetorActor(loggedInStaffFullName);
    }
  }, [loggedInStaffFullName, editingDeposit]);

  // Normalize finance_mutations records and classify vault strictly (PO payments belong to brangkas-modal)
  const normalizedFinanceMutations = useMemo(() => {
    return financeMutations.map((fm: any) => {
      const rawVault = String(fm.vault || '').toLowerCase();
      const rawType = String(fm.typeName || fm.paymentMethod || '').toLowerCase();
      const rawFrom = String(fm.from || '').toLowerCase();
      const rawTo = String(fm.to || '').toLowerCase();
      const rawJurnal = String(fm.jenisJurnal || fm.description || fm.note || '').toLowerCase();
      const isPoPayment =
        Boolean(fm.poNumber) ||
        String(fm.source || '').toUpperCase() === 'PROCUREMENT' ||
        rawJurnal.includes('hutang po') ||
        rawJurnal.includes('pembayaran po');

      const vaultKey =
        rawVault === 'brangkas-modal' ||
        rawVault === 'brangkas_modal' ||
        rawType.includes('modal') ||
        rawFrom.includes('modal') ||
        rawTo.includes('modal') ||
        isPoPayment
          ? 'brangkas-modal'
          : rawVault === 'brangkas-untung' ||
            rawVault === 'brangkas_untung' ||
            rawType.includes('untung') ||
            rawFrom.includes('untung') ||
            rawTo.includes('untung')
          ? 'brangkas-untung'
          : 'brangkas-toko';

      const targetBrangkasLabel =
        vaultKey === 'brangkas-modal'
          ? 'Brangkas Modal'
          : vaultKey === 'brangkas-untung'
          ? 'Brangkas Untung'
          : 'Brangkas Toko';
      const sourceLabel = fm.from || fm.typeName || fm.paymentMethod || targetBrangkasLabel;
      const toLabel = fm.supplierName
        ? `${targetBrangkasLabel} → ${fm.supplierName}`
        : fm.to || targetBrangkasLabel;

      return {
        ...fm,
        _isFinanceMutation: true,
        _isPoPayment: isPoPayment,
        vault: vaultKey,
        tanggal: fm.tanggal || fm.date || '',
        from: sourceLabel,
        to: toLabel,
        targetVaultLabel: targetBrangkasLabel,
        note: fm.description || fm.note || '-',
        actor: fm.actor || fm.staff || fm.createdBy || loggedInStaffFullName,
      };
    });
  }, [financeMutations, loggedInStaffFullName]);

  // Helper to compute chronological ledger rows with Running Balance (Saldo / Keseimbangan)
  // Saldo = Saldo Sebelumnya + Nominal (Kas Masuk) - Nominal (Kas Keluar)
  const buildLedgerWithRunningSaldo = (
    rawItems: any[],
    defaultTujuanLabel: string = 'Brangkas Toko'
  ) => {
    const validItems = rawItems.filter(
      (item: any) => parseNominalValue(item?.amount ?? item?.nominal ?? item?.totalAmount ?? 0) > 0
    );

    const priorityOrder = (item: any): number => {
      if (item?.sourceType === 'UANG_LACI' || String(item?.jenisJurnal || '').toLowerCase().includes('uang laci')) {
        return 1;
      }
      if (resolveFlowType(item) === 'Kas Masuk') {
        return 2;
      }
      return 3;
    };

    const sortedChronological = [...validItems].sort((a: any, b: any) => {
      const tA = resolveTimestampMs(a);
      const tB = resolveTimestampMs(b);
      if (tA !== tB) return tA - tB;
      const pA = priorityOrder(a);
      const pB = priorityOrder(b);
      if (pA !== pB) return pA - pB;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    let runningSaldo = 0;
    return sortedChronological.map((item: any) => {
      const nominal = parseNominalValue(item.amount ?? item.nominal ?? item.totalAmount ?? 0);
      const itemFlowType = resolveFlowType(item);
      if (itemFlowType === 'Kas Masuk') {
        runningSaldo += nominal;
      } else {
        runningSaldo -= nominal;
      }
      const { tanggal, jam } = extractTanggalAndJam(item);
      return {
        ...item,
        amount: nominal,
        displayTanggal: tanggal,
        displayJam: jam,
        displayStaff: item.actor || item.staff || item.createdBy || item.by || loggedInStaffFullName,
        displayJenisJurnal: resolveJenisJurnal(item),
        displayDariSumber: item.from || item.typeName || item.paymentMethod || 'Uang Laci',
        displayTujuanAlokasi: item.to || item.targetVaultLabel || defaultTujuanLabel,
        displayNominal: nominal,
        displayFlowType: itemFlowType,
        runningSaldo,
      };
    });
  };

  const validTransactions = useMemo(
    () =>
      transactions.filter(
        (tx) =>
          tx.status !== 'void' &&
          tx.status !== 'rejected' &&
          tx.status !== 'cancelled' &&
          tx.status !== 'refunded'
      ),
    [transactions]
  );

  // Merge shifts and shift_history so we have all open & closed shift records
  const allMergedShifts = useMemo(() => {
    const map = new Map<string, any>();
    shiftHistoryDocs.forEach((sh: any) => {
      if (sh?.id) map.set(sh.id, sh);
    });
    shiftsDocs.forEach((s: any) => {
      if (s?.id) {
        const prev = map.get(s.id) || {};
        map.set(s.id, { ...prev, ...s });
      }
    });
    return Array.from(map.values());
  }, [shiftsDocs, shiftHistoryDocs]);

  // Strict classifier to ensure Brangkas Modal, Brangkas Untung, and PO Debt payments NEVER leak into Brangkas Toko
  const isOtherVaultOrPoRecord = (item: any): boolean => {
    const idStr = String(item?.id || '').toLowerCase();
    const vaultStr = String(item?.vault || '').toLowerCase();
    const toStr = String(item?.to || item?.targetVaultLabel || '').toLowerCase();
    const fromStr = String(item?.from || '').toLowerCase();
    const jurnalStr = String(item?.jenisJurnal || '').toLowerCase();
    const typeStr = String(item?.type || '').toUpperCase();

    if (
      idStr.startsWith('dep_modal_') ||
      idStr.startsWith('dep_untung_') ||
      vaultStr === 'brangkas-modal' ||
      vaultStr === 'brangkas_modal' ||
      vaultStr === 'brangkas-untung' ||
      vaultStr === 'brangkas_untung' ||
      toStr.includes('brangkas modal') ||
      toStr.includes('brangkas untung') ||
      fromStr.includes('brangkas modal') ||
      fromStr.includes('brangkas untung') ||
      typeStr === 'MUTASI_MODAL' ||
      typeStr === 'ALOKASI_LABA' ||
      jurnalStr.includes('modal penjualan') ||
      jurnalStr.includes('brangkas modal') ||
      jurnalStr.includes('keuntungan penjualan') ||
      jurnalStr.includes('brangkas untung') ||
      jurnalStr.includes('hutang po') ||
      jurnalStr.includes('pembayaran po') ||
      Boolean(item?.poNumber) ||
      Boolean(item?._isPoPayment) ||
      String(item?.source || '').toUpperCase() === 'PROCUREMENT'
    ) {
      return true;
    }
    return false;
  };

  // Master ledger rows for /dashboard/keuangan/brangkas-toko
  // Strictly derived ONLY from:
  // 1. Uang Laci (Modal Laci Kasir / Float) -> Kas Masuk (+)
  // 2. Transaksi Penjualan -> Kas Masuk (+)
  // 3. Pengeluaran saat Tutup Shift (EndShiftView) & Kas Keluar (/dashboard/shift/kas-keluar) -> Kas Keluar (-)
  const ledgerRowsWithSaldo = useMemo(() => {
    const combinedTokoItems: any[] = [];
    const seenIds = new Set<string>();

    const pushUnique = (entry: any) => {
      const key = String(entry?.id || '');
      if (!key || seenIds.has(key)) return;
      if (parseNominalValue(entry?.amount ?? entry?.nominal ?? 0) <= 0) return;
      seenIds.add(key);
      combinedTokoItems.push(entry);
    };

    // Filter safeDeposits that genuinely belong to Brangkas Toko
    const cleanTokoDeposits = safeDeposits.filter((d: any) => !isOtherVaultOrPoRecord(d));

    // Track which shifts already have explicit Uang Laci, Sales Recap, or Shift Expense records in safe_deposits
    const shiftsWithExplicitLaci = new Set<string>();
    const shiftsWithExplicitSales = new Set<string>();
    const datesWithExplicitShiftSales = new Set<string>();
    const shiftsWithExplicitExpenses = new Set<string>();

    cleanTokoDeposits.forEach((d: any) => {
      const idStr = String(d.id || '');
      const jStr = String(d.jenisJurnal || '').toLowerCase();
      const noteStr = String(d.note || '').toLowerCase();
      const fromStr = String(d.from || '').toLowerCase();
      const flow = resolveFlowType(d);
      const shiftId = d.shiftId || '';

      const isLaciRecord =
        d.sourceType === 'UANG_LACI' ||
        idStr.endsWith('_laci') ||
        jStr.includes('uang laci') ||
        (fromStr === 'uang laci' && !noteStr.includes('penjualan'));

      const isSalesRecord =
        d.sourceType === 'SHIFT_SALES' ||
        idStr.endsWith('_in') ||
        jStr.includes('penjualan') ||
        jStr.includes('setoran kasir ke brangkas toko') ||
        noteStr.includes('hasil penjualan');

      const isExpenseRecord =
        flow === 'Kas Keluar' ||
        d.sourceType === 'SHIFT_EXPENSE' ||
        idStr.includes('_out_');

      if (isLaciRecord && shiftId) {
        shiftsWithExplicitLaci.add(shiftId);
      }
      if (isSalesRecord) {
        if (shiftId) shiftsWithExplicitSales.add(shiftId);
        if (d.tanggal && /^\d{4}-\d{2}-\d{2}/.test(String(d.tanggal))) {
          datesWithExplicitShiftSales.add(String(d.tanggal).slice(0, 10));
        }
      }
      if (isExpenseRecord && shiftId) {
        shiftsWithExplicitExpenses.add(shiftId);
      }

      // Normalize labels for Brangkas Toko display consistency
      if (isLaciRecord) {
        pushUnique({
          ...d,
          sourceType: 'UANG_LACI',
          jenisJurnal: d.jenisJurnal && !jStr.includes('modal') ? d.jenisJurnal : 'Uang Laci',
          from: 'Uang Laci',
          to: 'Brangkas Toko',
          flowType: 'Kas Masuk',
        });
      } else if (isSalesRecord && flow === 'Kas Masuk') {
        pushUnique({
          ...d,
          sourceType: 'SHIFT_SALES',
          jenisJurnal:
            jStr.includes('setoran kasir') || jStr.includes('penjualan')
              ? d.jenisJurnal
              : 'Transaksi Penjualan',
          from: d.from === 'Uang Laci' && noteStr.includes('penjualan') ? 'Hasil Penjualan' : d.from || 'Hasil Penjualan',
          to: 'Brangkas Toko',
          flowType: 'Kas Masuk',
        });
      } else if (isExpenseRecord) {
        pushUnique({
          ...d,
          sourceType: 'SHIFT_EXPENSE',
          jenisJurnal: d.jenisJurnal || d.note || 'Pengeluaran Shift / Kas Keluar',
          from: 'Brangkas Toko',
          to:
            d.to && d.to !== 'Brangkas Toko'
              ? d.to
              : 'Pengeluaran Toko / Kas Keluar',
          flowType: 'Kas Keluar',
        });
      } else {
        // Other manual Brangkas Toko mutations created via "+ Catat Mutasi"
        pushUnique({
          ...d,
          to: flow === 'Kas Masuk' ? 'Brangkas Toko' : d.to || 'Pengeluaran Toko / Kas Keluar',
          from: flow === 'Kas Keluar' ? 'Brangkas Toko' : d.from || 'Uang Laci',
        });
      }
    });

    // Include explicit Brangkas Toko financeMutations (excluding PO / Modal / Untung)
    normalizedFinanceMutations
      .filter((fm: any) => fm.vault === 'brangkas-toko' && !isOtherVaultOrPoRecord(fm))
      .forEach((fm: any) => {
        pushUnique(fm);
      });

    // A.1 Fallback Otomatis: Uang Laci dari Buka Shift / Tutup Shift (`shifts` & `shift_history`)
    allMergedShifts.forEach((sh: any) => {
      const shId = String(sh.id || '');
      const floatVal = parseNominalValue(sh.uangLaci ?? sh.initialFloat ?? sh.startingCash ?? 0);
      if (floatVal > 0 && !shiftsWithExplicitLaci.has(shId)) {
        const shTanggal =
          sh.tanggal ||
          sh.shiftDate ||
          (sh.openedAt && /^\d{4}-\d{2}-\d{2}/.test(String(sh.openedAt))
            ? String(sh.openedAt).slice(0, 10)
            : getTodayIsoDate());
        const shJam =
          sh.jamBuka ||
          sh.jam ||
          (sh.openedAt
            ? `${new Date(sh.openedAt).toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit',
              })} WIB`
            : '-');
        const cashier = sh.cashierName || sh.cashier || loggedInStaffFullName;
        pushUnique({
          id: `dep_toko_${shId}_laci`,
          shiftId: shId,
          tanggal: shTanggal,
          jam: shJam,
          date: `${formatDisplayDate(shTanggal)}, ${shJam}`,
          createdAt: sh.openedAt || sh.createdAt || sh.closedAt || new Date().toISOString(),
          sourceType: 'UANG_LACI',
          type: 'SETORAN_BRANKAS',
          jenisJurnal: 'Uang Laci',
          from: 'Uang Laci',
          to: 'Brangkas Toko',
          vault: 'brangkas-toko',
          amount: floatVal,
          flowType: 'Kas Masuk',
          note: `Setoran Uang Laci (Modal Kasir) Shift #${shId} (${cashier})`,
          actor: cashier,
          staff: cashier,
        });
      }
    });

    // A.2 Fallback Otomatis: Transaksi Penjualan (POS & PWA) yang belum ter-rekap di Setoran Shift
    const shiftDatesCoveredByTx = new Set<string>();
    validTransactions.forEach((tx: any) => {
      const txId = String(tx.id || tx.orderNumber || '');
      const txShiftId = String(tx.shiftId || '');
      const txDateYmd =
        (typeof tx.tanggal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(tx.tanggal)
          ? tx.tanggal.slice(0, 10)
          : typeof tx.orderDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(tx.orderDate)
          ? tx.orderDate.slice(0, 10)
          : tx.createdAt && !Number.isNaN(new Date(tx.createdAt).getTime())
          ? new Date(tx.createdAt).toISOString().slice(0, 10)
          : '') || getTodayIsoDate();

      // Avoid double counting if this transaction's shift or date was already deposited via EndShiftView recap
      if (
        (txShiftId && shiftsWithExplicitSales.has(txShiftId)) ||
        datesWithExplicitShiftSales.has(txDateYmd)
      ) {
        return;
      }

      const txAmount = parseNominalValue(tx.totalAmount ?? tx.totalRevenue ?? tx.subtotal ?? 0);
      if (txAmount <= 0) return;

      shiftDatesCoveredByTx.add(txDateYmd);
      const txJam =
        tx.jam ||
        (tx.createdAt && !Number.isNaN(new Date(tx.createdAt).getTime())
          ? `${new Date(tx.createdAt).toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
            })} WIB`
          : '-');
      const cashier = tx.cashierName || tx.cashier || tx.staffName || loggedInStaffFullName;

      pushUnique({
        id: `tx_toko_${txId}`,
        transactionId: txId,
        tanggal: txDateYmd,
        jam: txJam,
        date: `${formatDisplayDate(txDateYmd)}, ${txJam}`,
        createdAt: tx.createdAt || `${txDateYmd}T12:00:00.000Z`,
        sourceType: 'SHIFT_SALES',
        type: 'Kas Masuk',
        jenisJurnal: 'Transaksi Penjualan',
        from: 'Hasil Penjualan',
        to: 'Brangkas Toko',
        vault: 'brangkas-toko',
        amount: txAmount,
        flowType: 'Kas Masuk',
        note: `Penjualan #${tx.orderNumber || txId} (${tx.customerName || 'Pelanggan Umum'})`,
        actor: cashier,
        staff: cashier,
        items: tx.items,
        customerName: tx.customerName,
        paymentMethod: tx.paymentMethod,
        paymentStatus: tx.paymentStatus,
      });
    });

    // If a closed shift has recorded totalPenjualan/totalSales > 0 and neither explicit deposit nor tx covered it
    allMergedShifts.forEach((sh: any) => {
      const shId = String(sh.id || '');
      const shTanggal =
        sh.tanggal ||
        sh.shiftDate ||
        (sh.closedAt && /^\d{4}-\d{2}-\d{2}/.test(String(sh.closedAt))
          ? String(sh.closedAt).slice(0, 10)
          : '');
      const salesVal =
        parseNominalValue(sh.totalPenjualan ?? sh.totalSales ?? 0) +
        parseNominalValue(sh.pemasukanLain ?? 0) +
        parseNominalValue(sh.bonus ?? 0);

      if (
        salesVal > 0 &&
        !shiftsWithExplicitSales.has(shId) &&
        (!shTanggal || (!datesWithExplicitShiftSales.has(shTanggal) && !shiftDatesCoveredByTx.has(shTanggal)))
      ) {
        const cashier = sh.cashierName || sh.cashier || loggedInStaffFullName;
        pushUnique({
          id: `dep_toko_${shId}_in`,
          shiftId: shId,
          tanggal: shTanggal || getTodayIsoDate(),
          jam: sh.jam || '-',
          createdAt: sh.closedAt || sh.updatedAt || sh.createdAt || new Date().toISOString(),
          sourceType: 'SHIFT_SALES',
          type: 'SETORAN_BRANKAS',
          jenisJurnal: 'Transaksi Penjualan',
          from: 'Hasil Penjualan',
          to: 'Brangkas Toko',
          vault: 'brangkas-toko',
          amount: salesVal,
          flowType: 'Kas Masuk',
          note: `Setoran Hasil Penjualan Shift #${shId} (${cashier})`,
          actor: cashier,
          staff: cashier,
        });
      }
    });

    // B.1 Fallback Otomatis: Pengeluaran Tutup Shift (`expenses` / `totalPengeluaran` pada `shifts`)
    allMergedShifts.forEach((sh: any) => {
      const shId = String(sh.id || '');
      if (shiftsWithExplicitExpenses.has(shId)) return;

      const shTanggal =
        sh.tanggal ||
        sh.shiftDate ||
        (sh.closedAt && /^\d{4}-\d{2}-\d{2}/.test(String(sh.closedAt))
          ? String(sh.closedAt).slice(0, 10)
          : getTodayIsoDate());
      const cashier = sh.cashierName || sh.cashier || loggedInStaffFullName;

      if (Array.isArray(sh.expenses) && sh.expenses.length > 0) {
        sh.expenses.forEach((exp: any, idx: number) => {
          const expNom = parseNominalValue(exp.nominal ?? exp.amount ?? 0);
          if (expNom <= 0) return;
          pushUnique({
            id: `dep_toko_${shId}_out_${idx + 1}`,
            shiftId: shId,
            tanggal: shTanggal,
            jam: sh.jam || '-',
            createdAt: sh.closedAt || sh.updatedAt || sh.createdAt || new Date().toISOString(),
            sourceType: 'SHIFT_EXPENSE',
            type: 'OPERASIONAL',
            jenisJurnal: exp.keterangan || 'Pengeluaran Shift / Kas Keluar',
            from: 'Brangkas Toko',
            to: 'Pengeluaran Toko / Kas Keluar',
            vault: 'brangkas-toko',
            amount: expNom,
            flowType: 'Kas Keluar',
            note: exp.keterangan || `Pengeluaran Tutup Shift #${shId}`,
            actor: cashier,
            staff: cashier,
          });
        });
      } else {
        const totalExp = parseNominalValue(sh.totalPengeluaran ?? sh.totalKasKeluar ?? 0);
        if (totalExp > 0) {
          pushUnique({
            id: `dep_toko_${shId}_out_1`,
            shiftId: shId,
            tanggal: shTanggal,
            jam: sh.jam || '-',
            createdAt: sh.closedAt || sh.updatedAt || sh.createdAt || new Date().toISOString(),
            sourceType: 'SHIFT_EXPENSE',
            type: 'OPERASIONAL',
            jenisJurnal: 'Pengeluaran Shift / Kas Keluar',
            from: 'Brangkas Toko',
            to: 'Pengeluaran Toko / Kas Keluar',
            vault: 'brangkas-toko',
            amount: totalExp,
            flowType: 'Kas Keluar',
            note: `Pengeluaran Operasional Shift #${shId}`,
            actor: cashier,
            staff: cashier,
          });
        }
      }
    });

    // B.2 Fallback Otomatis: Kas Keluar dari `/dashboard/shift/kas-keluar` (`shift_kas_keluar`)
    shiftKasKeluarDocs.forEach((kk: any) => {
      const kkNom = parseNominalValue(kk.amount ?? kk.nominal ?? 0);
      if (kkNom <= 0) return;
      const kkId = String(kk.id || '');
      const kkTanggal =
        kk.tanggal ||
        (kk.createdAt && /^\d{4}-\d{2}-\d{2}/.test(String(kk.createdAt))
          ? String(kk.createdAt).slice(0, 10)
          : getTodayIsoDate());
      const kkJam = kk.time || kk.jam || '-';
      const cashier = kk.recordedBy || kk.staff || kk.actor || loggedInStaffFullName;

      pushUnique({
        id: `kk_toko_${kkId}`,
        shiftId: kk.shiftId || '',
        tanggal: kkTanggal,
        jam: kkJam,
        date: kk.date || formatDisplayDate(kkTanggal),
        createdAt: kk.createdAt || `${kkTanggal}T13:00:00.000Z`,
        sourceType: 'KAS_KELUAR',
        type: 'Kas Keluar',
        jenisJurnal: kk.category || 'Pengeluaran Shift / Kas Keluar',
        from: 'Brangkas Toko',
        to: kk.recipient ? `Pengeluaran Toko (${kk.recipient})` : 'Pengeluaran Toko / Kas Keluar',
        vault: 'brangkas-toko',
        amount: kkNom,
        flowType: 'Kas Keluar',
        note: kk.note && kk.note !== '-' ? `${kk.category || 'Kas Keluar'}: ${kk.note}` : kk.category || 'Kas Keluar Shift',
        actor: cashier,
        staff: cashier,
      });
    });

    return buildLedgerWithRunningSaldo(combinedTokoItems, 'Brangkas Toko');
  }, [
    safeDeposits,
    normalizedFinanceMutations,
    allMergedShifts,
    validTransactions,
    shiftKasKeluarDocs,
    loggedInStaffFullName,
  ]);

  // Ledger rows for /dashboard/keuangan/brangkas-modal
  const brangkasModalRows = useMemo(() => {
    const modalDeposits = safeDeposits.filter(
      (d: any) =>
        String(d.vault || '').toLowerCase() === 'brangkas-modal' ||
        String(d.to || '').toLowerCase().includes('modal') ||
        String(d.from || '').toLowerCase().includes('modal') ||
        d.type === 'MUTASI_MODAL'
    );
    const modalMutations = normalizedFinanceMutations.filter(
      (fm) => fm.vault === 'brangkas-modal'
    );
    return buildLedgerWithRunningSaldo([...modalDeposits, ...modalMutations], 'Brangkas Modal');
  }, [safeDeposits, normalizedFinanceMutations, loggedInStaffFullName]);

  // Ledger rows for /dashboard/keuangan/brangkas-untung
  const brangkasUntungRows = useMemo(() => {
    const untungDeposits = safeDeposits.filter(
      (d: any) =>
        String(d.vault || '').toLowerCase() === 'brangkas-untung' ||
        String(d.to || '').toLowerCase().includes('untung') ||
        String(d.from || '').toLowerCase().includes('untung') ||
        d.type === 'ALOKASI_LABA'
    );
    const untungMutations = normalizedFinanceMutations.filter(
      (fm) => fm.vault === 'brangkas-untung'
    );
    return buildLedgerWithRunningSaldo([...untungDeposits, ...untungMutations], 'Brangkas Untung');
  }, [safeDeposits, normalizedFinanceMutations, loggedInStaffFullName]);

  // Calculate Vault Balances from ledger rows so top cards & table running balance are 100% synchronized
  const totalKasMasuk = ledgerRowsWithSaldo
    .filter((r) => r.displayFlowType === 'Kas Masuk')
    .reduce((acc, r) => acc + r.displayNominal, 0);
  const totalKasKeluar = ledgerRowsWithSaldo
    .filter((r) => r.displayFlowType === 'Kas Keluar')
    .reduce((acc, r) => acc + r.displayNominal, 0);
  const currentTotalLedgerSaldo =
    ledgerRowsWithSaldo.length > 0
      ? ledgerRowsWithSaldo[ledgerRowsWithSaldo.length - 1].runningSaldo
      : totalKasMasuk - totalKasKeluar;

  const brangkasModalMutations = brangkasModalRows;
  const brangkasUntungMutations = brangkasUntungRows;

  const calcNetMutation = (rows: any[]) =>
    rows.length > 0
      ? rows[rows.length - 1].runningSaldo
      : rows.reduce(
          (acc, r) => acc + (r.displayFlowType === 'Kas Masuk' ? r.displayNominal : -r.displayNominal),
          0
        );

  const totalStockModal = products.reduce(
    (acc, p) => acc + Number(p.costPerUnit || 0) * Number(p.stockInUnits || 0),
    0
  );
  const totalNetProfit = validTransactions.reduce((acc, tx: any) => {
    const rev = Number(tx.totalAmount || tx.totalRevenue || 0);
    const cost = Number(tx.totalCost || 0);
    const profit = tx.totalProfit !== undefined ? Number(tx.totalProfit) : rev - cost;
    return acc + profit;
  }, 0);
  const totalCashRevenue = validTransactions.reduce((acc, tx: any) => {
    const totalVal = Number(tx.totalAmount || tx.totalRevenue || 0);
    const pm = String(tx.paymentMethod || 'cash').toLowerCase();
    const ps = String(
      tx.paymentStatus || (pm === 'debt' || pm === 'hutang' || pm === 'cod' ? 'unpaid' : 'paid')
    ).toLowerCase();
    if (pm === 'debt' || pm === 'hutang') {
      return acc + (ps === 'paid' ? totalVal : Number(tx.paidAmount || 0));
    }
    if (pm === 'cod') {
      return acc + (ps === 'paid' ? totalVal : 0);
    }
    return acc + totalVal;
  }, 0);
  const totalCustomerReceivables = validTransactions.reduce((acc, tx: any) => {
    const totalVal = Number(tx.totalAmount || tx.totalRevenue || 0);
    const pm = String(tx.paymentMethod || 'cash').toLowerCase();
    const ps = String(
      tx.paymentStatus || (pm === 'debt' || pm === 'hutang' || pm === 'cod' ? 'unpaid' : 'paid')
    ).toLowerCase();
    if ((pm === 'debt' || pm === 'hutang' || pm === 'cod') && ps !== 'paid') {
      return acc + Number(tx.remainingDebt ?? Math.max(0, totalVal - Number(tx.paidAmount || 0)));
    }
    return acc;
  }, 0);
  const totalPayables = purchaseOrders
    .filter((po) => (po.paymentStatus || '').toLowerCase().includes('tempo'))
    .reduce((acc, po) => acc + Number(po.totalAmount || 0), 0);

  const vaults = {
    brangkasToko: currentTotalLedgerSaldo,
    brangkasModal: calcNetMutation(brangkasModalMutations),
    brangkasUntung: calcNetMutation(brangkasUntungMutations),
  };

  // Combined financial mutations (Safe Deposits + Finance Mutations + POS Cash Flows) for Riwayat Keuangan
  const combinedFinancialHistory = useMemo(() => {
    const posCashEntries = cashFlows
      .filter((cf: any) => cf.source !== 'PROCUREMENT')
      .map((cf: any) => ({
        id: cf.id || cf.transactionId || 'CF-POS',
        date: cf.createdAt
          ? new Date(cf.createdAt).toLocaleString('id-ID', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '-',
        type: cf.type || 'MUTASI_KAS_POS',
        jenisJurnal: cf.category || 'Penjualan POS',
        from: cf.customerName || 'Pelanggan POS',
        to:
          cf.paymentMethod === 'cash'
            ? 'Laci Kasir POS (Tunai)'
            : `Kas Digital POS (${String(cf.paymentMethod || 'Non-Tunai').toUpperCase()})`,
        amount: Number(cf.amount || 0),
        flowType: cf.type === 'out' ? 'Kas Keluar' : 'Kas Masuk',
        note: cf.note || cf.description || `Penjualan POS (${cf.itemsCount || 1} item)`,
        actor: cf.cashierName || loggedInStaffFullName,
        createdAt: cf.createdAt || '',
        isCashFlow: true,
      }));

    const poMutationEntries = normalizedFinanceMutations.map((fm: any) => {
      const { tanggal, jam } = extractTanggalAndJam(fm);
      return {
        ...fm,
        date: `${tanggal}${jam && jam !== '-' ? `, ${jam}` : ''}`,
      };
    });

    return [...safeDeposits, ...poMutationEntries, ...posCashEntries].sort((a: any, b: any) => {
      const tA = new Date(a.createdAt || a.date || 0).getTime() || 0;
      const tB = new Date(b.createdAt || b.date || 0).getTime() || 0;
      return tB - tA;
    });
  }, [safeDeposits, normalizedFinanceMutations, cashFlows, loggedInStaffFullName]);

  const openCreateModal = (defaultTujuan?: 'Brangkas Modal' | 'Brangkas Untung' | 'Brangkas Toko') => {
    const targetDest = defaultTujuan || 'Brangkas Toko';
    setEditingDeposit(null);
    setTanggalInput(getTodayIsoDate());
    setJenisJurnal('');
    setSetorAmount(0);
    setSetorFrom('');
    setSetorTo(targetDest);
    setSetorActor(loggedInStaffFullName);
    setSetorNote('');
    setFlowType('Kas Masuk');
    setShowAddJenisJurnal(false);
    setNewJenisJurnalInput('');
    setShowAddDariSumber(false);
    setNewDariSumberInput('');
    setFormValidationError('');
    setShowSetorModal(true);
  };

  const openEditModal = (item: any) => {
    setEditingDeposit(item);
    setTanggalInput(
      item.tanggal && /^\d{4}-\d{2}-\d{2}$/.test(item.tanggal) ? item.tanggal : getTodayIsoDate()
    );
    const existingJurnal = String(item.jenisJurnal || '').trim();
    const existingFrom = String(item.from || item.displayDariSumber || '').trim();
    setJenisJurnal(jenisJurnalOptions.includes(existingJurnal) ? existingJurnal : '');
    setSetorAmount(parseNominalValue(item.amount ?? item.displayNominal ?? 0));
    setSetorFrom(dariSumberOptions.includes(existingFrom) ? existingFrom : '');
    setSetorTo(item.to || item.displayTujuanAlokasi || 'Brangkas Toko');
    setSetorActor(item.actor || item.staff || item.displayStaff || loggedInStaffFullName);
    setSetorNote(item.note || '');
    setFlowType(resolveFlowType(item));
    setShowAddJenisJurnal(false);
    setNewJenisJurnalInput('');
    setShowAddDariSumber(false);
    setNewDariSumberInput('');
    setFormValidationError('');
    setShowSetorModal(true);
  };

  const handleSaveSetor = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanJenisJurnal = jenisJurnal.trim();
    const cleanDariSumber = setorFrom.trim();

    if (!cleanJenisJurnal || !cleanDariSumber) {
      if (!cleanJenisJurnal && !cleanDariSumber) {
        setFormValidationError(
          'Peringatan: Silakan pilih atau tambahkan "Jenis Jurnal" dan "Dari Sumber" terlebih dahulu sebelum mengonfirmasi jurnal.'
        );
      } else if (!cleanJenisJurnal) {
        setFormValidationError(
          'Peringatan: Silakan pilih atau tambahkan "Jenis Jurnal" terlebih dahulu sebelum mengonfirmasi jurnal.'
        );
      } else {
        setFormValidationError(
          'Peringatan: Silakan pilih atau tambahkan "Dari Sumber" terlebih dahulu sebelum mengonfirmasi jurnal.'
        );
      }
      return;
    }

    if (!setorAmount || setorAmount <= 0) {
      setFormValidationError('Peringatan: Nominal (Rp) harus diisi lebih dari 0.');
      return;
    }

    setFormValidationError('');

    const nowJam = formatCurrentTimeWib();
    const formattedTanggal = formatDisplayDate(tanggalInput);
    const mappedLegacyType = setorTo.includes('Modal')
      ? 'MUTASI_MODAL'
      : setorTo.includes('Untung')
      ? 'ALOKASI_LABA'
      : 'SETORAN_BRANKAS';
    const resolvedVault = setorTo.includes('Modal')
      ? 'brangkas-modal'
      : setorTo.includes('Untung')
      ? 'brangkas-untung'
      : 'brangkas-toko';

    if (editingDeposit?.id) {
      if (editingDeposit._isFinanceMutation) {
        await updateFinanceMutation(editingDeposit.id, {
          tanggal: tanggalInput,
          date: tanggalInput,
          jam: editingDeposit.jam || nowJam,
          jenisJurnal,
          from: setorFrom,
          to: setorTo,
          vault: resolvedVault,
          typeName: setorFrom,
          paymentMethod: setorFrom,
          amount: Number(setorAmount),
          type: flowType,
          flowType,
          direction: flowType === 'Kas Keluar' ? 'out' : 'in',
          category: flowType === 'Kas Keluar' ? 'Pengeluaran' : 'Pemasukan',
          description: setorNote,
          note: setorNote,
          actor: setorActor || loggedInStaffFullName,
          staff: setorActor || loggedInStaffFullName,
          createdBy: setorActor || loggedInStaffFullName,
        });
      } else {
        await updateSafeDeposit(editingDeposit.id, {
          tanggal: tanggalInput,
          jam: editingDeposit.jam || nowJam,
          date: `${formattedTanggal}, ${editingDeposit.jam || nowJam}`,
          type: mappedLegacyType,
          vault: resolvedVault,
          jenisJurnal,
          from: setorFrom,
          to: setorTo,
          amount: Number(setorAmount),
          flowType,
          note: setorNote,
          actor: setorActor || loggedInStaffFullName,
          staff: setorActor || loggedInStaffFullName,
        });
      }
    } else {
      const newDeposit = {
        tanggal: tanggalInput,
        jam: nowJam,
        date: `${formattedTanggal}, ${nowJam}`,
        createdAt: new Date().toISOString(),
        type: mappedLegacyType,
        vault: resolvedVault,
        jenisJurnal,
        from: setorFrom,
        to: setorTo,
        amount: Number(setorAmount),
        flowType,
        note: setorNote || '-',
        actor: setorActor || loggedInStaffFullName,
        staff: setorActor || loggedInStaffFullName,
      };
      await addSafeDeposit(newDeposit);
    }
    setShowSetorModal(false);
    setEditingDeposit(null);
  };

  // Financial Account Types (Type Keuangan) derived from real balances
  const accountTypes = [
    {
      code: 'ACT-101',
      name: 'Kas Laci POS & Penerimaan Lunas (Tunai / QRIS / COD Lunas)',
      category: 'Aset Lancar (Kas & Bank)',
      balance: Math.max(0, totalCashRevenue - totalKasMasuk),
      status: 'Aktif',
    },
    {
      code: 'ACT-102',
      name: 'Brangkas Besi Toko (Brangkas Toko & Modal)',
      category: 'Aset Lancar (Kas & Bank)',
      balance: vaults.brangkasToko,
      status: 'Aktif',
    },
    {
      code: 'ACT-103',
      name: 'Nilai Aset Stok & Cadangan Modal',
      category: 'Persediaan & Modal Kerja',
      balance: vaults.brangkasModal,
      status: 'Aktif',
    },
    {
      code: 'ACT-104',
      name: 'Piutang Penjualan Pelanggan (Hutang POS & COD Dalam Pengiriman)',
      category: 'Piutang Usaha (Aset Lancar)',
      balance: totalCustomerReceivables,
      status: 'Aktif',
    },
    {
      code: 'ACT-201',
      name: 'Hutang Dagang Supplier (PO Tempo)',
      category: 'Kewajiban Jangka Pendek',
      balance: totalPayables,
      status: 'Aktif',
    },
    {
      code: 'ACT-301',
      name: 'Akumulasi Laba Bersih (Brangkas Untung)',
      category: 'Ekuitas / Laba Ditahan',
      balance: vaults.brangkasUntung,
      status: 'Aktif',
    },
  ];

  const renderActionButtons = (item: any) => (
    <div className="flex items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={() => {
          const isKeluar = item.displayFlowType === 'Kas Keluar' || item.flowType === 'Kas Keluar' || Number(item.amountOut || 0) > 0;
          openTransactionDetailModal(
            {
              ...item,
              amount: Number(item.displayNominal || item.amount || 0),
              description: item.note || item.displayJenisJurnal || item.journalType,
              source: item.displayDariSumber || item.fromSource,
              destinationVault: item.displayTujuanAlokasi || item.toAllocation,
              cashierName: item.displayStaff || item.staffName,
              createdAt: `${item.displayTanggal || item.date || ''} ${item.displayJam || ''}`.trim(),
            },
            isKeluar ? 'CASH_OUT' : 'CASH_IN'
          );
        }}
        title="Lihat Detail & Fulfillment"
        className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-amber-400 hover:text-amber-300 border border-amber-500/30 transition cursor-pointer"
      >
        <Eye className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => openEditModal(item)}
        title="Edit Data"
        className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
      >
        <Edit2 className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={async () => {
          if (!item.id) return;
          if (item._isFinanceMutation) {
            await deleteFinanceMutation(item.id);
          } else {
            await deleteSafeDeposit(item.id);
          }
        }}
        title="Hapus Data"
        className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  const renderBrangkasLedgerTable = (
    tableTitle: string,
    tableSubtitle: string,
    rows: typeof ledgerRowsWithSaldo,
    defaultTujuan: 'Brangkas Modal' | 'Brangkas Untung' | 'Brangkas Toko' = 'Brangkas Toko'
  ) => {
    const tableKasMasuk = rows
      .filter((r) => r.displayFlowType === 'Kas Masuk')
      .reduce((acc, r) => acc + r.displayNominal, 0);
    const tableKasKeluar = rows
      .filter((r) => r.displayFlowType === 'Kas Keluar')
      .reduce((acc, r) => acc + r.displayNominal, 0);
    const tableSaldoAkhir =
      rows.length > 0 ? rows[rows.length - 1].runningSaldo : tableKasMasuk - tableKasKeluar;

    return (
      <div className="bg-zinc-900 border border-amber-500/30 rounded-2xl p-6 space-y-4 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Vault className="w-5 h-5 text-amber-400" />
              <h3 className="font-black text-white text-lg tracking-tight">{tableTitle}</h3>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">{tableSubtitle}</p>
          </div>
          <button
            onClick={() => openCreateModal(defaultTujuan)}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-black text-xs font-black transition flex items-center gap-1.5 cursor-pointer shadow-lg shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>+ Catat Mutasi / Setoran Brankas</span>
          </button>
        </div>

        {/* Summary Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-zinc-950 border border-emerald-500/30 flex items-center justify-between">
            <div>
              <span className="text-zinc-400 block text-[11px]">Total Kas Masuk</span>
              <span className="text-base font-mono font-black text-emerald-400 mt-0.5 block">
                +{formatMoney(tableKasMasuk)}
              </span>
            </div>
            <ArrowUpCircle className="w-5 h-5 text-emerald-400 shrink-0" />
          </div>
          <div className="p-3.5 rounded-xl bg-zinc-950 border border-rose-500/30 flex items-center justify-between">
            <div>
              <span className="text-zinc-400 block text-[11px]">Total Kas Keluar</span>
              <span className="text-base font-mono font-black text-rose-400 mt-0.5 block">
                -{formatMoney(tableKasKeluar)}
              </span>
            </div>
            <ArrowDownCircle className="w-5 h-5 text-rose-400 shrink-0" />
          </div>
          <div className="p-3.5 rounded-xl bg-zinc-950 border border-amber-500/40 flex items-center justify-between">
            <div>
              <span className="text-amber-300 font-bold block text-[11px]">Saldo Akhir Brangkas</span>
              <span className="text-base font-mono font-black text-white mt-0.5 block">
                {formatMoney(tableSaldoAkhir)}
              </span>
            </div>
            <Vault className="w-5 h-5 text-amber-400 shrink-0" />
          </div>
        </div>

      {/* Data Table: Tanggal | Jam | Staff | Jenis Jurnal | Dari Sumber | Tujuan Alokasi | Nominal | Type | Saldo */}
      <div className="border border-zinc-800 rounded-xl overflow-x-auto bg-zinc-950">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-900/90 text-amber-300 border-b border-zinc-800 uppercase text-[11px] tracking-wider">
            <tr>
              <th className="py-3 px-3.5 font-bold whitespace-nowrap">Tanggal</th>
              <th className="py-3 px-3.5 font-bold whitespace-nowrap">Jam</th>
              <th className="py-3 px-3.5 font-bold whitespace-nowrap">Staff</th>
              <th className="py-3 px-3.5 font-bold whitespace-nowrap">Jenis Jurnal</th>
              <th className="py-3 px-3.5 font-bold whitespace-nowrap">Dari Sumber</th>
              <th className="py-3 px-3.5 font-bold whitespace-nowrap">Tujuan Alokasi</th>
              <th className="py-3 px-3.5 font-bold text-right whitespace-nowrap">Nominal</th>
              <th className="py-3 px-3.5 font-bold text-center whitespace-nowrap">Type</th>
              <th className="py-3 px-3.5 font-bold text-right whitespace-nowrap">Saldo</th>
              <th className="py-3 px-3.5 font-bold text-right whitespace-nowrap">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70 text-zinc-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-10 text-center text-zinc-500 text-xs">
                  Belum ada data mutasi brangkas. Klik tombol{' '}
                  <strong className="text-amber-400">+ Catat Mutasi / Setoran Brankas</strong> untuk
                  menambahkan data.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isMasuk = row.displayFlowType === 'Kas Masuk';
                return (
                  <tr
                    key={row.id}
                    onClick={() =>
                      openTransactionDetailModal(
                        {
                          ...row,
                          amount: Number(row.displayNominal || row.amount || 0),
                          description: row.note || row.displayJenisJurnal,
                          source: row.displayDariSumber,
                          destinationVault: row.displayTujuanAlokasi,
                          cashierName: row.displayStaff,
                          createdAt: `${row.displayTanggal || ''} ${row.displayJam || ''}`.trim(),
                        },
                        isMasuk ? 'CASH_IN' : 'CASH_OUT'
                      )
                    }
                    className="hover:bg-zinc-900/60 transition cursor-pointer"
                  >
                    <td className="py-3 px-3.5 whitespace-nowrap font-medium text-white">
                      {row.displayTanggal}
                    </td>
                    <td className="py-3 px-3.5 whitespace-nowrap font-mono text-zinc-400">
                      {row.displayJam}
                    </td>
                    <td className="py-3 px-3.5 whitespace-nowrap font-semibold text-amber-200">
                      {row.displayStaff}
                    </td>
                    <td className="py-3 px-3.5 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 font-semibold hover:underline">
                        {row.displayJenisJurnal}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 whitespace-nowrap text-zinc-300 font-medium">
                      {row.displayDariSumber}
                    </td>
                    <td className="py-3 px-3.5 whitespace-nowrap font-bold text-white">
                      {row.displayTujuanAlokasi}
                    </td>
                    <td
                      className={`py-3 px-3.5 whitespace-nowrap text-right font-mono font-bold ${
                        isMasuk ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {isMasuk ? '+' : '-'}
                      {formatMoney(row.displayNominal)}
                    </td>
                    <td className="py-3 px-3.5 whitespace-nowrap text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                          isMasuk
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                            : 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                        }`}
                      >
                        {row.displayFlowType}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 whitespace-nowrap text-right font-mono font-black text-white">
                      {formatMoney(row.runningSaldo)}
                    </td>
                    <td className="py-3 px-3.5 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                      {renderActionButtons(row)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-zinc-900/95 border-t border-amber-500/30 text-xs font-bold">
              <tr>
                <td colSpan={6} className="py-3 px-3.5 text-amber-300 uppercase tracking-wider">
                  Ringkasan Akhir {tableTitle} ({rows.length} Jurnal)
                </td>
                <td className="py-3 px-3.5 text-right font-mono whitespace-nowrap">
                  <span className="text-emerald-400 block">+{formatMoney(tableKasMasuk)}</span>
                  <span className="text-rose-400 block">-{formatMoney(tableKasKeluar)}</span>
                </td>
                <td className="py-3 px-3.5 text-center text-zinc-400">Saldo Akhir</td>
                <td className="py-3 px-3.5 text-right font-mono font-black text-amber-300 text-sm whitespace-nowrap">
                  {formatMoney(tableSaldoAkhir)}
                </td>
                <td className="py-3 px-3.5" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Vault className="w-6 h-6 text-amber-400" />
            <h1 className="text-2xl font-black text-white tracking-tight">
              MANAJEMEN KEUANGAN &amp; BRANGKAS
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Pengendalian brangkas kas fisik toko, brangkas modal kerja, alokasi laba keuntungan bersih, dan riwayat jurnal keuangan.
          </p>
        </div>
        <button
          onClick={() =>
            openCreateModal(
              activeSub === 'brangkas_toko'
                ? 'Brangkas Toko'
                : activeSub === 'brangkas_untung'
                ? 'Brangkas Untung'
                : 'Brangkas Modal'
            )
          }
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-black text-xs font-black transition flex items-center gap-1.5 cursor-pointer shadow-lg shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>+ Catat Mutasi / Setoran Brankas</span>
        </button>
      </div>

      {/* Sub-Tabs */}
      <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto w-full max-w-none mb-4">
        <button
          onClick={() => setActiveSub('brangkas_toko')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'brangkas_toko' ? 'bg-amber-500 text-black shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Vault className="w-3.5 h-3.5" />
          <span>Brangkas Toko</span>
        </button>
        <button
          onClick={() => setActiveSub('brangkas_modal')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'brangkas_modal' ? 'bg-amber-500 text-black shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Coins className="w-3.5 h-3.5" />
          <span>Brangkas Modal</span>
        </button>
        <button
          onClick={() => setActiveSub('brangkas_untung')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'brangkas_untung' ? 'bg-amber-500 text-black shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          <span>Brangkas Untung</span>
        </button>
        <button
          onClick={() => setActiveSub('type_keuangan')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'type_keuangan' ? 'bg-amber-500 text-black shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <CreditCard className="w-3.5 h-3.5" />
          <span>Type Keuangan</span>
        </button>
        <button
          onClick={() => setActiveSub('riwayat_keuangan')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'riwayat_keuangan' ? 'bg-amber-500 text-black shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>Riwayat Keuangan</span>
        </button>
      </div>

      {/* OVERVIEW THREE VAULTS WIDGET */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          onClick={() => setActiveSub('brangkas_toko')}
          className={`p-5 rounded-2xl border cursor-pointer transition ${
            activeSub === 'brangkas_toko' ? 'bg-[#16120b] border-amber-500' : 'bg-zinc-900 border-zinc-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-amber-400 uppercase">Brangkas Kas Fisik Toko</span>
            <Vault className="w-4 h-4 text-amber-400" />
          </div>
          <span className="text-2xl font-mono font-black text-white mt-2 block">
            {formatMoney(vaults.brangkasToko)}
          </span>
          <span className="text-[11px] text-zinc-400 mt-1 block">
            Saldo akumulasi Kas Masuk dikurangi Kas Keluar
          </span>
        </div>

        <div
          onClick={() => setActiveSub('brangkas_modal')}
          className={`p-5 rounded-2xl border cursor-pointer transition ${
            activeSub === 'brangkas_modal' ? 'bg-[#16120b] border-amber-500' : 'bg-zinc-900 border-zinc-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-amber-300 uppercase">Brangkas Modal Kerja (Working Capital)</span>
            <Coins className="w-4 h-4 text-amber-300" />
          </div>
          <span className="text-2xl font-mono font-black text-white mt-2 block">
            {formatMoney(vaults.brangkasModal)}
          </span>
          <span className="text-[11px] text-zinc-400 mt-1 block">
            Saldo akumulasi Kas Masuk dikurangi Kas Keluar Brangkas Modal
          </span>
        </div>

        <div
          onClick={() => setActiveSub('brangkas_untung')}
          className={`p-5 rounded-2xl border cursor-pointer transition ${
            activeSub === 'brangkas_untung' ? 'bg-[#16120b] border-amber-500' : 'bg-zinc-900 border-zinc-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-amber-400 uppercase">Brangkas Laba Bersih (Net Profit)</span>
            <TrendingUp className="w-4 h-4 text-amber-400" />
          </div>
          <span className="text-2xl font-mono font-black text-emerald-400 mt-2 block">
            {formatMoney(vaults.brangkasUntung)}
          </span>
          <span className="text-[11px] text-zinc-400 mt-1 block">
            Saldo akumulasi Kas Masuk dikurangi Kas Keluar Brangkas Untung
          </span>
        </div>
      </div>

      {/* VIEW: BRANGKAS TOKO (/dashboard/keuangan/brangkas-toko) -> Table Judul: Brangkas Toko */}
      {activeSub === 'brangkas_toko' &&
        renderBrangkasLedgerTable(
          'Brangkas Toko',
          'Rincian Uang Laci Kasir, Transaksi Penjualan, serta Pengeluaran Tutup Shift & Kas Keluar beserta saldo berjalan.',
          ledgerRowsWithSaldo,
          'Brangkas Toko'
        )}

      {/* VIEW: BRANGKAS MODAL */}
      {activeSub === 'brangkas_modal' &&
        renderBrangkasLedgerTable(
          'Brangkas Modal',
          'Rincian dana cadangan pembelian, modal penjualan, serta mutasi kas masuk dan kas keluar.',
          brangkasModalRows,
          'Brangkas Modal'
        )}

      {/* VIEW: BRANGKAS UNTUNG */}
      {activeSub === 'brangkas_untung' &&
        renderBrangkasLedgerTable(
          'Brangkas Untung',
          'Akumulasi laba bersih toko dan riwayat mutasi alokasi keuntungan.',
          brangkasUntungRows,
          'Brangkas Untung'
        )}

      {/* VIEW: TYPE KEUANGAN */}
      {activeSub === 'type_keuangan' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Daftar Akun Keuangan (Chart of Accounts)
            </h3>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Kode Akun</th>
                  <th className="py-3 px-4">Nama Rekening / Akun</th>
                  <th className="py-3 px-4">Klasifikasi</th>
                  <th className="py-3 px-4 text-right">Saldo Saat Ini</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {accountTypes.map((act) => (
                  <tr key={act.code} className="hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono font-bold text-amber-400">{act.code}</td>
                    <td className="py-3 px-4 font-bold text-white">{act.name}</td>
                    <td className="py-3 px-4 text-zinc-400">{act.category}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                      {formatMoney(act.balance)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                        {act.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW: RIWAYAT KEUANGAN */}
      {activeSub === 'riwayat_keuangan' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Riwayat Mutasi Jurnal Keuangan
            </h3>
            <button
              onClick={() => openCreateModal('Brangkas Modal')}
              className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Tambah Jurnal Keuangan</span>
            </button>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">No. Reff</th>
                  <th className="py-3 px-4">Waktu</th>
                  <th className="py-3 px-4">Jenis Jurnal</th>
                  <th className="py-3 px-4">Dari &rarr; Ke</th>
                  <th className="py-3 px-4">Keterangan</th>
                  <th className="py-3 px-4 text-right">Nominal</th>
                  <th className="py-3 px-4">Penanggung Jawab</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {combinedFinancialHistory.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-zinc-500">
                      Belum ada riwayat mutasi jurnal keuangan di database.
                    </td>
                  </tr>
                ) : (
                  combinedFinancialHistory.map((hl) => (
                    <tr key={hl.id} className="hover:bg-zinc-800/40">
                      <td className="py-3 px-4 font-mono font-bold text-amber-400">{hl.id}</td>
                      <td className="py-3 px-4 text-zinc-400">{hl.date}</td>
                      <td className="py-3 px-4 text-amber-200 font-semibold">
                        {resolveJenisJurnal(hl)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-zinc-300 font-bold block">{hl.from}</span>
                        <span className="text-[11px] text-zinc-500">&rarr; {hl.to}</span>
                      </td>
                      <td className="py-3 px-4 text-zinc-300">{hl.note}</td>
                      <td
                        className={`py-3 px-4 text-right font-mono font-bold ${
                          resolveFlowType(hl) === 'Kas Keluar' ? 'text-rose-400' : 'text-emerald-400'
                        }`}
                      >
                        {resolveFlowType(hl) === 'Kas Keluar' ? '-' : '+'}
                        {formatMoney(Number(hl.amount || 0))}
                      </td>
                      <td className="py-3 px-4 text-zinc-400">{hl.actor}</td>
                      <td className="py-3 px-4 text-right">
                        {hl.isCashFlow ? (
                          <button
                            type="button"
                            onClick={() => setDetailDeposit(hl)}
                            title="Lihat Detail Mutasi Kas POS"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          renderActionButtons(hl)
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Detail Mutasi */}
      {detailDeposit && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-amber-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Vault className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Detail Jurnal Keuangan</h3>
              </div>
              <button
                onClick={() => setDetailDeposit(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">ID Referensi:</span>
                <span className="font-mono font-bold text-amber-400">{detailDeposit.id}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Jenis Jurnal:</span>
                <span className="font-bold text-white">{resolveJenisJurnal(detailDeposit)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Waktu Pencatatan:</span>
                <span className="text-zinc-200">{detailDeposit.date}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Dari Sumber:</span>
                <span className="font-bold text-white">{detailDeposit.from}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Tujuan Alokasi:</span>
                <span className="font-bold text-amber-400">{detailDeposit.to}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Type Mutasi:</span>
                <span
                  className={`font-bold ${
                    resolveFlowType(detailDeposit) === 'Kas Masuk'
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {resolveFlowType(detailDeposit)}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Nominal:</span>
                <span className="font-mono font-black text-base text-white">
                  {formatMoney(Number(detailDeposit.amount || 0))}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Petugas / Staff:</span>
                <span className="text-zinc-200">{detailDeposit.actor || detailDeposit.staff}</span>
              </div>
              <div className="pt-1">
                <span className="text-zinc-400 block mb-1">Catatan / Keterangan:</span>
                <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200">
                  {detailDeposit.note || '-'}
                </div>
              </div>
            </div>
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setDetailDeposit(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create / Edit Catat Mutasi / Setoran Brankas */}
      {showSetorModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-amber-500/40 rounded-2xl max-w-lg w-full p-6 shadow-2xl my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Vault className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">
                  {editingDeposit ? 'Edit Mutasi / Setoran Brankas' : 'Catat Mutasi / Setoran Brankas'}
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowSetorModal(false);
                  setEditingDeposit(null);
                }}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSetor} noValidate className="space-y-3.5 pt-4 text-xs">
              {formValidationError && (
                <div className="p-3 rounded-xl bg-rose-950/90 border border-rose-500/60 text-rose-200 flex items-start gap-2.5 shadow-lg">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1 text-xs font-semibold leading-relaxed">
                    {formValidationError}
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormValidationError('')}
                    className="text-rose-400 hover:text-white p-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* 1. Tanggal (Calendar field) & 2. Jenis Jurnal */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-300 font-bold mb-1 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-amber-400" />
                    <span>Tanggal *</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={tanggalInput}
                    onChange={(e) => setTanggalInput(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1 gap-1">
                    <label className="block text-zinc-300 font-bold">Jenis Jurnal *</label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setShowAddJenisJurnal((prev) => !prev)}
                        className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold transition cursor-pointer flex items-center gap-0.5"
                      >
                        <Plus className="w-2.5 h-2.5" />
                        <span>+ Tambah Baru</span>
                      </button>
                      {jenisJurnal && (
                        <button
                          type="button"
                          onClick={() => handleDeleteJenisJurnalOption(jenisJurnal)}
                          title="Hapus opsi Jenis Jurnal yang dipilih"
                          className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-bold transition cursor-pointer"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      )}
                      {jenisJurnalOptions.length > 0 && (
                        <button
                          type="button"
                          onClick={handleResetJenisJurnalOptions}
                          title="Reset semua opsi Jenis Jurnal"
                          className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 font-bold transition cursor-pointer"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <select
                    value={jenisJurnal}
                    onChange={(e) => {
                      const val = e.target.value;
                      setJenisJurnal(val);
                      if (val) setFormValidationError('');
                    }}
                    className={`w-full bg-zinc-950 border rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500 ${
                      formValidationError && !jenisJurnal.trim()
                        ? 'border-rose-500'
                        : 'border-zinc-800'
                    }`}
                  >
                    <option value="">-- Pilih atau + Tambah Jenis Jurnal --</option>
                    {jenisJurnalOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>

                  {showAddJenisJurnal && (
                    <div className="mt-2 p-2.5 rounded-xl bg-zinc-950 border border-amber-500/40 space-y-2">
                      <input
                        type="text"
                        value={newJenisJurnalInput}
                        onChange={(e) => setNewJenisJurnalInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddJenisJurnalOption();
                          }
                        }}
                        placeholder="Ketik nama Jenis Jurnal baru..."
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-amber-500"
                        autoFocus
                      />
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddJenisJurnal(false);
                            setNewJenisJurnalInput('');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-bold cursor-pointer"
                        >
                          Batal
                        </button>
                        <button
                          type="button"
                          onClick={handleAddJenisJurnalOption}
                          className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-[11px] font-black cursor-pointer"
                        >
                          Simpan Opsi
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 3. Nominal (Rp) & 8. Type (Kas Masuk / Kas Keluar) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-300 font-bold mb-1">Nominal (Rp) *</label>
                  <input
                    type="number"
                    min={1}
                    placeholder="0"
                    value={setorAmount || ''}
                    onChange={(e) => setSetorAmount(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono text-base font-bold focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-zinc-300 font-bold mb-1">Type *</label>
                  <select
                    value={flowType}
                    onChange={(e) => setFlowType(e.target.value as 'Kas Masuk' | 'Kas Keluar')}
                    className={`w-full bg-zinc-950 border rounded-xl px-3 py-2 font-bold focus:outline-none ${
                      flowType === 'Kas Masuk'
                        ? 'border-emerald-500/50 text-emerald-400 focus:border-emerald-400'
                        : 'border-rose-500/50 text-rose-400 focus:border-rose-400'
                    }`}
                  >
                    {FLOW_TYPE_OPTIONS.map((tOpt) => (
                      <option key={tOpt} value={tOpt} className="bg-zinc-950 text-white">
                        {tOpt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 4. Dari Sumber & 5. Tujuan Alokasi (Dropdowns) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1 gap-1">
                    <label className="block text-zinc-300 font-bold">Dari Sumber *</label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setShowAddDariSumber((prev) => !prev)}
                        className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold transition cursor-pointer flex items-center gap-0.5"
                      >
                        <Plus className="w-2.5 h-2.5" />
                        <span>+ Tambah Baru</span>
                      </button>
                      {setorFrom && (
                        <button
                          type="button"
                          onClick={() => handleDeleteDariSumberOption(setorFrom)}
                          title="Hapus opsi Sumber yang dipilih"
                          className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-bold transition cursor-pointer"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      )}
                      {dariSumberOptions.length > 0 && (
                        <button
                          type="button"
                          onClick={handleResetDariSumberOptions}
                          title="Reset semua opsi Sumber"
                          className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 font-bold transition cursor-pointer"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <select
                    value={setorFrom}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSetorFrom(val);
                      if (val) setFormValidationError('');
                    }}
                    className={`w-full bg-zinc-950 border rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500 ${
                      formValidationError && !setorFrom.trim()
                        ? 'border-rose-500'
                        : 'border-zinc-800'
                    }`}
                  >
                    <option value="">-- Pilih atau + Tambah Sumber --</option>
                    {dariSumberOptions.map((src) => (
                      <option key={src} value={src}>
                        {src}
                      </option>
                    ))}
                  </select>

                  {showAddDariSumber && (
                    <div className="mt-2 p-2.5 rounded-xl bg-zinc-950 border border-amber-500/40 space-y-2">
                      <input
                        type="text"
                        value={newDariSumberInput}
                        onChange={(e) => setNewDariSumberInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddDariSumberOption();
                          }
                        }}
                        placeholder="Ketik nama Sumber baru..."
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-amber-500"
                        autoFocus
                      />
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddDariSumber(false);
                            setNewDariSumberInput('');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-bold cursor-pointer"
                        >
                          Batal
                        </button>
                        <button
                          type="button"
                          onClick={handleAddDariSumberOption}
                          className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-[11px] font-black cursor-pointer"
                        >
                          Simpan Opsi
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-zinc-300 font-bold mb-1">Tujuan Alokasi *</label>
                  <select
                    value={setorTo}
                    onChange={(e) => setSetorTo(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  >
                    {TUJUAN_ALOKASI_OPTIONS.map((dest) => (
                      <option key={dest} value={dest}>
                        {dest}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 6. Petugas / Penanggung Jawab (Autoinput > User Login / Staff Login > Nama Lengkap Karyawan) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-zinc-300 font-bold flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                    <span>Petugas / Penanggung Jawab</span>
                  </label>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">
                    Auto Login Staff
                  </span>
                </div>
                <input
                  type="text"
                  readOnly
                  value={setorActor}
                  className="w-full bg-zinc-950/90 border border-amber-500/30 rounded-xl px-3 py-2 text-amber-200 font-bold cursor-not-allowed focus:outline-none"
                />
              </div>

              {/* 7. Keterangan / Catatan (Textarea) */}
              <div>
                <label className="block text-zinc-300 font-bold mb-1">Keterangan / Catatan</label>
                <textarea
                  rows={3}
                  value={setorNote}
                  onChange={(e) => setSetorNote(e.target.value)}
                  placeholder="Tulis keterangan mutasi / setoran brangkas..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500 resize-y"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowSetorModal(false);
                    setEditingDeposit(null);
                    setFormValidationError('');
                  }}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-black font-black transition shadow-lg cursor-pointer"
                >
                  {editingDeposit ? 'Simpan Perubahan' : 'Konfirmasi Jurnal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
