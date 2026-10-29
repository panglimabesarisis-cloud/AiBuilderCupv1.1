import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock,
  ArrowDownRight,
  ArrowUpRight,
  History,
  Plus,
  CheckCircle,
  Lock,
  Unlock,
  Printer,
  User,
  Search,
  Eye,
  Edit2,
  Trash2,
  X,
  Tag,
  Receipt,
  CreditCard,
  Banknote,
  RefreshCw,
  Layers,
  ChefHat,
  Briefcase,
} from 'lucide-react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppNavigation } from '../../router';
import { useFirestoreList } from '../../hooks/useFirestoreList';
import { useAppData } from '../../context/AppDataContext';
import { useLanguage } from '../../context/LanguageContext';
import { useAccessControl } from '../../context/AccessControlContext';
import { fmtMoney, toIdr, formatRibuanInput, parseRibuanInput } from '../../utils/money';
import { DEFAULT_STAFF_MEMBERS, StaffMemberItem } from './StaffModule';
import { EndShiftView } from './EndShiftView';
import { StaffDivisionRoleSection } from './StaffDivisionRoleSection';
import {
  useStaffDivisionsAndRoles,
  inferDivisionFromRole,
} from '../../services/staffDivisionService';

const getJakartaDateYmd = (): string => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().split('T')[0];
  }
};

const getJakartaTimeWib = (): string => {
  try {
    const timePart = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(new Date())
      .replace(/\./g, ':');
    return `${timePart} WIB`;
  } catch {
    return `${new Date().toLocaleTimeString('id-ID', { hour12: false }).replace(/\./g, ':')} WIB`;
  }
};

interface ShiftModuleProps {
  subModule: 'cashir' | 'divisi_role' | 'kas_masuk' | 'kas_keluar' | 'riwayat_shit';
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

export const ShiftModule: React.FC<ShiftModuleProps> = ({
  subModule,
  currencyMode: propCurrencyMode,
  onNavigateTab,
}) => {
  const { currencyMode: ctxCurrencyMode, exchangeRate } = useLanguage();
  const activeCurrency = ctxCurrencyMode || propCurrencyMode || 'IDR';
  const activeRate = exchangeRate > 0 ? exchangeRate : 16250;

  const { route, navigateTab } = useAppNavigation();
  const activeSub = (
    route.activeTab === 'module_shift' ? route.activeSubModule : subModule
  ) as 'cashir' | 'divisi_role' | 'kas_masuk' | 'kas_keluar' | 'riwayat_shit';

  const setActiveSub = (
    next: 'cashir' | 'divisi_role' | 'kas_masuk' | 'kas_keluar' | 'riwayat_shit'
  ) => {
    navigateTab('module_shift', next);
  };

  const { divisions: staffDivisions, roster: divisionRoster, kitchenStaffOnDuty } =
    useStaffDivisionsAndRoles();

  const { transactions: ctxTransactions, purgeTodayShiftTransactions } = useAppData();
  const { activeCashier, setActiveCashier } = useAccessControl();
  const [isPurgingTodayShift, setIsPurgingTodayShift] = useState(false);
  const [confirmPurgeTodayHeaderOpen, setConfirmPurgeTodayHeaderOpen] = useState(false);

  // Real Firestore collections for Shifts, Shift History, Cash In, Cash Out, and Staff
  const {
    data: shiftsDocs,
    setData: setShiftsDocs,
  } = useFirestoreList<any>('shifts', []);

  const {
    data: shiftHistoryDocs,
    setData: setShiftHistoryDocs,
  } = useFirestoreList<any>('shift_history', []);

  const {
    data: kasMasukList,
    addItem: addKasMasukDoc,
    updateItem: updateKasMasukDoc,
    deleteItem: deleteKasMasukDoc,
  } = useFirestoreList<any>('shift_kas_masuk', []);

  const {
    data: kasKeluarList,
    addItem: addKasKeluarDoc,
    updateItem: updateKasKeluarDoc,
    deleteItem: deleteKasKeluarDoc,
  } = useFirestoreList<any>('shift_kas_keluar', []);

  const { data: staffList } = useFirestoreList<StaffMemberItem>('staff', DEFAULT_STAFF_MEMBERS);

  const DEFAULT_KAS_KELUAR_CATEGORIES = [
    { id: 'kk-1', name: 'Operasional Kasir (Kresek, Kertas Struk)' },
    { id: 'kk-2', name: 'Bongkar Muat / Parkir Supplier' },
    { id: 'kk-3', name: 'Konsumsi & Kebersihan Toko' },
    { id: 'kk-4', name: 'Setoran Tunai ke Bank' },
    { id: 'kk-5', name: 'Beban Listrik & Utilitas Toko' },
    { id: 'kk-6', name: 'Perlengkapan & ATK Kasir' },
  ];

  const {
    data: kasKeluarCategories,
    addItem: addKasKeluarCategoryDoc,
    deleteItem: deleteKasKeluarCategoryDoc,
  } = useFirestoreList<any>('shift_kas_keluar_categories', DEFAULT_KAS_KELUAR_CATEGORIES);

  // Track if user explicitly closed the shift in this session so we don't immediately re-create unless they click "Buka Shift"
  const [explicitlyClosedInSession, setExplicitlyClosedInSession] = useState(false);

  useEffect(() => {
    const onShiftClosedEvent = () => {
      setExplicitlyClosedInSession(true);
      setShiftsDocs((prev) =>
        prev.map((s) =>
          String(s.status || '').toLowerCase() === 'open' ||
          String(s.status || '').toLowerCase() === 'aktif'
            ? { ...s, status: 'closed', closedAt: new Date().toISOString() }
            : s
        )
      );
    };
    const onShiftOpenedEvent = (ev: Event) => {
      setExplicitlyClosedInSession(false);
      const custom = ev as CustomEvent<any>;
      if (custom?.detail?.id) {
        setShiftsDocs((prev) => [
          custom.detail,
          ...prev.filter((s) => s.id !== custom.detail.id),
        ]);
      }
    };
    const onShiftStatusChanged = () => {
      try {
        const activeRaw =
          localStorage.getItem('riskcart_active_shift') ||
          localStorage.getItem('riskcart_active_open_shift');
        if (!activeRaw) {
          setExplicitlyClosedInSession(true);
          setShiftsDocs((prev) =>
            prev.map((s) =>
              String(s.status || '').toLowerCase() === 'open' ||
              String(s.status || '').toLowerCase() === 'aktif'
                ? { ...s, status: 'closed', closedAt: new Date().toISOString() }
                : s
            )
          );
        } else {
          const parsed = JSON.parse(activeRaw);
          if (parsed && String(parsed.status || '').toLowerCase() === 'open') {
            setExplicitlyClosedInSession(false);
          }
        }
      } catch {}
    };

    const onTodayShiftTxPurged = (ev: Event) => {
      const custom = ev as CustomEvent<any>;
      const targetYmd = custom?.detail?.targetYmd || getJakartaDateYmd();
      const compactYmd = String(targetYmd).replace(/-/g, '');
      const filterNotToday = (s: any) => {
        const idStr = String(s?.id || '');
        if (compactYmd && idStr.includes(`SHF-${compactYmd}`)) return false;
        if (s?.tanggal === targetYmd || s?.shiftDate === targetYmd) return false;
        if (typeof s?.openedAt === 'string' && s.openedAt.slice(0, 10) === targetYmd) return false;
        if (typeof s?.closedAt === 'string' && s.closedAt.slice(0, 10) === targetYmd) return false;
        return true;
      };
      setShiftsDocs((prev) => prev.filter(filterNotToday));
      setShiftHistoryDocs((prev) => prev.filter(filterNotToday));
    };

    window.addEventListener('riskcart:shift-closed', onShiftClosedEvent);
    window.addEventListener('riskcart:shift-opened', onShiftOpenedEvent);
    window.addEventListener('shift-status-changed', onShiftStatusChanged);
    window.addEventListener('riskcart:today-shift-tx-purged', onTodayShiftTxPurged);
    return () => {
      window.removeEventListener('riskcart:shift-closed', onShiftClosedEvent);
      window.removeEventListener('riskcart:shift-opened', onShiftOpenedEvent);
      window.removeEventListener('shift-status-changed', onShiftStatusChanged);
      window.removeEventListener('riskcart:today-shift-tx-purged', onTodayShiftTxPurged);
    };
  }, [setShiftsDocs, setShiftHistoryDocs]);

  // Find current open shift from `shifts` collection
  const currentOpenShiftDoc = useMemo(() => {
    if (explicitlyClosedInSession) return null;
    const openList = shiftsDocs.filter(
      (s) =>
        String(s.status || '').toLowerCase() === 'open' ||
        String(s.status || '').toLowerCase() === 'aktif'
    );
    if (openList.length > 0) {
      return openList.sort((a, b) => {
        const ta = new Date(a.openedAt || a.createdAt || 0).getTime();
        const tb = new Date(b.openedAt || b.createdAt || 0).getTime();
        return tb - ta;
      })[0];
    }
    try {
      const savedRaw =
        localStorage.getItem('riskcart_active_shift') ||
        localStorage.getItem('riskcart_active_open_shift');
      if (savedRaw) {
        const parsed = JSON.parse(savedRaw);
        if (
          parsed &&
          (String(parsed.status || '').toLowerCase() === 'open' ||
            String(parsed.status || '').toLowerCase() === 'aktif')
        ) {
          const isClosedInDocs = shiftsDocs.some(
            (s) => s.id === parsed.id && String(s.status || '').toLowerCase() === 'closed'
          );
          if (!isClosedInDocs) return parsed;
        }
      }
    } catch {}
    return null;
  }, [shiftsDocs, explicitlyClosedInSession]);

  // Explicit Shift Requirement: Shift only opens when user explicitly submits "Buka Shift"

  // Transaction filter mode inside /dashboard/shift/kasir
  const [txScopeMode, setTxScopeMode] = useState<'shift' | 'all'>('shift');
  const [txSearchQuery, setTxSearchQuery] = useState('');
  const [selectedShiftDate, setSelectedShiftDate] = useState<string>(
    () => new Date().toISOString().split('T')[0]
  );
  const [hasShiftDateChanged, setHasShiftDateChanged] = useState<boolean>(false);

  // Determine the effective active shift metadata
  const effectiveOpenShift = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fallbackStartIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    if (currentOpenShiftDoc) {
      return {
        id: currentOpenShiftDoc.id || `SHF-${todayKey}-01`,
        status: 'open' as const,
        openedAtIso: currentOpenShiftDoc.openedAt || currentOpenShiftDoc.createdAt || fallbackStartIso,
        openedAtDisplay:
          currentOpenShiftDoc.openedAtDisplay ||
          new Date(currentOpenShiftDoc.openedAt || Date.now()).toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        initialFloat: Number(
          currentOpenShiftDoc.initialFloat ?? currentOpenShiftDoc.startingCash ?? 0
        ),
        cashierId: currentOpenShiftDoc.cashierId || activeCashier.id || 'staff_001',
        cashierName: String(
          currentOpenShiftDoc.cashierName ||
            currentOpenShiftDoc.cashier ||
            activeCashier.name ||
            'Dede Fajar Kurniawan'
        ).replace(/muhammad\s+irfan/gi, 'Dede Fajar Kurniawan'),
        outlet:
          currentOpenShiftDoc.outlet ||
          activeCashier.outlet ||
          'RiskCart Flagship Store (Pusat)',
        session: currentOpenShiftDoc.session || activeCashier.shift || 'Shift Reguler',
      };
    }

    return {
      id: `SHF-${todayKey}-${String(shiftsDocs.length + 1).padStart(2, '0')}`,
      status: 'closed' as const,
      openedAtIso: fallbackStartIso,
      openedAtDisplay: new Date().toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      initialFloat: 0,
      cashierId: activeCashier.id || 'staff_001',
      cashierName: String(activeCashier.name || 'Dede Fajar Kurniawan').replace(
        /muhammad\s+irfan/gi,
        'Dede Fajar Kurniawan'
      ),
      outlet: activeCashier.outlet || 'RiskCart Flagship Store (Pusat)',
      session: activeCashier.shift || 'Shift Reguler',
    };
  }, [currentOpenShiftDoc, activeCashier, shiftsDocs.length]);

  // Valid transactions from Firestore (AppDataContext)
  const validTransactions = useMemo(() => {
    return ctxTransactions.filter(
      (tx) =>
        tx.status !== 'rejected' &&
        tx.status !== 'cancelled' &&
        tx.status !== 'void'
    );
  }, [ctxTransactions]);

  // Transactions belonging to the active shift or selected shift date
  const shiftTransactions = useMemo(() => {
    const matchesTargetDate = (tx: any, targetYmd: string): boolean => {
      if (!targetYmd) return true;
      if (typeof tx.orderDate === 'string' && tx.orderDate.slice(0, 10) === targetYmd) return true;
      if (typeof tx.tanggal === 'string' && tx.tanggal.slice(0, 10) === targetYmd) return true;
      if (
        typeof tx.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}/.test(tx.date) &&
        tx.date.slice(0, 10) === targetYmd
      ) {
        return true;
      }
      if (tx.createdAt) {
        const d = new Date(tx.createdAt);
        if (!isNaN(d.getTime())) {
          const isoYmd = d.toISOString().split('T')[0];
          const localYmd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
            d.getDate()
          ).padStart(2, '0')}`;
          if (isoYmd === targetYmd || localYmd === targetYmd) return true;
        }
      }
      return false;
    };

    const todayIso = new Date().toISOString().split('T')[0];
    if (hasShiftDateChanged || (selectedShiftDate && selectedShiftDate !== todayIso)) {
      return validTransactions.filter((tx) => matchesTargetDate(tx, selectedShiftDate));
    }

    if (txScopeMode === 'all') {
      return validTransactions;
    }
    const openedTs = new Date(effectiveOpenShift.openedAtIso || 0).getTime();
    const matched = validTransactions.filter((tx) => {
      if (matchesTargetDate(tx, selectedShiftDate)) return true;
      if (tx.shiftId && tx.shiftId === effectiveOpenShift.id) return true;
      const txTs = new Date(tx.createdAt || 0).getTime();
      if (!isNaN(openedTs) && openedTs > 0 && txTs >= openedTs) return true;
      return false;
    });
    return matched;
  }, [validTransactions, effectiveOpenShift, txScopeMode, selectedShiftDate, hasShiftDateChanged]);

  const filteredShiftTransactions = useMemo(() => {
    const q = txSearchQuery.trim().toLowerCase();
    if (!q) return shiftTransactions;
    return shiftTransactions.filter((tx) => {
      const idMatch = (tx.id || '').toLowerCase().includes(q);
      const custMatch = (tx.customerName || '').toLowerCase().includes(q);
      const cashierMatch = (tx.cashierName || '').toLowerCase().includes(q);
      const methodMatch = (tx.paymentMethod || '').toLowerCase().includes(q);
      return idMatch || custMatch || cashierMatch || methodMatch;
    });
  }, [shiftTransactions, txSearchQuery]);

  // Real-time financial calculations for the active shift (stored in IDR scale)
  // Tunai enters cash drawer immediately; COD only enters cash drawer after paymentStatus === 'paid';
  // Hutang does not enter cash drawer (except any partial cash DP in paidAmount)
  const isCashPayment = (method?: string, paymentStatus?: string) => {
    const m = (method || 'cash').toLowerCase();
    if (m.includes('cash') || m.includes('tunai')) return true;
    if (m === 'cod') return String(paymentStatus || '').toLowerCase() === 'paid';
    return false;
  };

  const totalSalesCash = useMemo(() => {
    return shiftTransactions.reduce((acc, tx: any) => {
      const txTotal = Number(tx.totalAmount ?? tx.totalRevenue ?? tx.subtotal ?? 0);
      const pm = String(tx.paymentMethod || 'cash').toLowerCase();
      if (pm.includes('cash') || pm.includes('tunai')) {
        return acc + txTotal;
      }
      if (pm === 'cod' && String(tx.paymentStatus || '').toLowerCase() === 'paid') {
        return acc + txTotal;
      }
      if ((pm === 'debt' || pm === 'hutang') && Number(tx.paidAmount || 0) > 0) {
        return acc + Number(tx.paidAmount || 0);
      }
      return acc;
    }, 0);
  }, [shiftTransactions]);

  const totalSalesNonCash = useMemo(() => {
    return shiftTransactions.reduce((acc, tx: any) => {
      const txTotal = Number(tx.totalAmount ?? tx.totalRevenue ?? tx.subtotal ?? 0);
      const pm = String(tx.paymentMethod || 'cash').toLowerCase();
      if (pm.includes('cash') || pm.includes('tunai')) {
        return acc;
      }
      if (pm === 'cod' && String(tx.paymentStatus || '').toLowerCase() === 'paid') {
        return acc;
      }
      if (pm === 'debt' || pm === 'hutang') {
        const dp = Number(tx.paidAmount || 0);
        return acc + Math.max(0, txTotal - dp);
      }
      return acc + txTotal;
    }, 0);
  }, [shiftTransactions]);

  const totalSalesAll = totalSalesCash + totalSalesNonCash;
  const totalKasMasuk = useMemo(
    () => kasMasukList.reduce((acc, km) => acc + Number(km.amount || 0), 0),
    [kasMasukList]
  );
  const totalKasKeluar = useMemo(
    () => kasKeluarList.reduce((acc, kk) => acc + Number(kk.amount || 0), 0),
    [kasKeluarList]
  );

  const initialFloat = effectiveOpenShift.initialFloat;
  const expectedCash = (totalSalesAll - totalKasKeluar) + totalKasMasuk;

  const activeShift = {
    ...effectiveOpenShift,
    startingCash: initialFloat,
    expectedCash,
    totalSalesCash,
    totalSalesNonCash,
    totalSalesAll,
    totalKasMasuk,
    totalKasKeluar,
    totalTransactions: shiftTransactions.length,
  };

  // Merge closed shifts from `shifts` and `shift_history` for `/dashboard/shift/riwayat`
  const mergedShiftHistory = useMemo(() => {
    const map = new Map<string, any>();

    const normalizeShiftRecord = (raw: any) => {
      const id = raw.id || `SHF-${Date.now()}`;
      const initial = Number(raw.initialFloat ?? raw.startingCash ?? raw.uangLaci ?? 0);
      const salesCash = Number(raw.salesCash ?? raw.cashSales ?? 0);
      const salesNonCash = Number(raw.salesNonCash ?? raw.salesQris ?? raw.qrisSales ?? 0);
      const totalSales = Number(raw.totalPenjualan ?? raw.totalSales ?? salesCash + salesNonCash);
      const totalPengeluaran = Number(raw.totalPengeluaran ?? raw.totalKasKeluar ?? 0);
      const bonus = Number(raw.bonus ?? 0);
      const pemasukanLain = Number(raw.pemasukanLain ?? raw.totalKasMasuk ?? 0);

      // Rumus wajib: targetKasSistem = (totalPenjualan - totalPengeluaran) + bonus + pemasukanLain
      const computedTargetKas = (totalSales - totalPengeluaran) + bonus + pemasukanLain;
      const expected =
        raw.totalPenjualan !== undefined || raw.totalPengeluaran !== undefined
          ? computedTargetKas
          : Number(
              raw.targetKasSistem ?? raw.expectedCash ?? raw.targetCash ?? raw.expected ?? computedTargetKas
            );
      const actual = Number(raw.kasAktual ?? raw.actualCash ?? raw.actual ?? 0);
      const diff = actual - expected;

      const auditStatus = diff === 0 ? 'MATCH' : diff > 0 ? 'OVER' : 'SHORT';

      const statusLabel =
        diff === 0
          ? 'Sesuai (MATCH)'
          : diff > 0
          ? 'Lebih (OVER)'
          : 'Kurang (SHORT)';

      const closedIso = raw.closedAt || raw.updatedAt || raw.createdAt || '';
      const openedDisplay =
        raw.openedAtDisplay ||
        (raw.openedAt && !isNaN(new Date(raw.openedAt).getTime())
          ? new Date(raw.openedAt).toLocaleString('id-ID', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : raw.date || '-');

      const closedDisplay =
        raw.closedAtDisplay ||
        (closedIso && !isNaN(new Date(closedIso).getTime())
          ? new Date(closedIso).toLocaleString('id-ID', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : raw.closedAt || '-');

      return {
        ...raw,
        id,
        date:
          raw.date ||
          (closedIso && !isNaN(new Date(closedIso).getTime())
            ? new Date(closedIso).toLocaleDateString('id-ID', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })
            : new Date().toLocaleDateString('id-ID', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })),
        openedDisplay,
        closedDisplay,
        session: raw.session || raw.shift || 'Shift Kasir',
        cashierName: raw.cashierName || raw.cashier || 'Kasir POS',
        totalTransactions: Number(raw.totalTransactions ?? 0),
        initialFloat: initial,
        salesCash,
        salesNonCash,
        totalSales,
        totalKasMasuk: Number(raw.totalKasMasuk ?? 0),
        totalKasKeluar: Number(raw.totalKasKeluar ?? 0),
        expectedCash: expected,
        actualCash: actual,
        difference: diff,
        auditStatus,
        statusLabel,
        notes: raw.notes || '-',
        sortTime: new Date(closedIso || raw.createdAt || 0).getTime() || 0,
      };
    };

    shiftHistoryDocs.forEach((docItem) => {
      if (docItem?.id) {
        map.set(docItem.id, normalizeShiftRecord(docItem));
      }
    });

    shiftsDocs
      .filter((s) => s.status === 'closed')
      .forEach((docItem) => {
        if (docItem?.id) {
          const existing = map.get(docItem.id);
          map.set(docItem.id, normalizeShiftRecord({ ...existing, ...docItem }));
        }
      });

    return Array.from(map.values()).sort((a, b) => b.sortTime - a.sortTime);
  }, [shiftsDocs, shiftHistoryDocs]);

  // Modals & Form States
  const [showOpenShiftModal, setShowOpenShiftModal] = useState(false);
  const [openShiftFloatInput, setOpenShiftFloatInput] = useState<string>('');
  const [openShiftDate, setOpenShiftDate] = useState<string>(() => getJakartaDateYmd());
  const [jakartaClock, setJakartaClock] = useState<string>(() => getJakartaTimeWib());
  const [openShiftCashierId, setOpenShiftCashierId] = useState<string>(
    activeCashier.id || 'staff_001'
  );
  const [openShiftSession, setOpenShiftSession] = useState<string>(
    activeCashier.shift || 'Shift Pagi (07:30 - 15:00)'
  );
  const [openShiftDivisionId, setOpenShiftDivisionId] = useState<string>(() => {
    return inferDivisionFromRole(activeCashier?.role).divisionId || 'div_cashier';
  });
  const [openShiftRoleName, setOpenShiftRoleName] = useState<string>(
    activeCashier?.role || 'Head Cashier'
  );

  const openShiftDivisionRoles = useMemo(() => {
    const found = staffDivisions.find((d) => d.id === openShiftDivisionId);
    return found ? found.roles : [];
  }, [staffDivisions, openShiftDivisionId]);

  useEffect(() => {
    const timer = setInterval(() => {
      setJakartaClock(getJakartaTimeWib());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');

  const [detailModal, setDetailModal] = useState<{
    title: string;
    data: Record<string, any>;
  } | null>(null);
  const [editingKmId, setEditingKmId] = useState<string | null>(null);
  const [editingKkId, setEditingKkId] = useState<string | null>(null);
  const [editingShiftHist, setEditingShiftHist] = useState<any | null>(null);
  const [showKasMasukModal, setShowKasMasukModal] = useState(false);
  const [showKasKeluarModal, setShowKasKeluarModal] = useState(false);
  const [kmCategory, setKmCategory] = useState('Tambahan Modal Kasir');
  const [kmAmount, setKmAmount] = useState('');
  const [kmSource, setKmSource] = useState('');
  const [kmNote, setKmNote] = useState('');

  const [kkCategory, setKkCategory] = useState('Operasional Kasir (Kresek, Kertas Struk)');
  const [kkAmount, setKkAmount] = useState('');
  const [kkRecipient, setKkRecipient] = useState('');
  const [kkNote, setKkNote] = useState('');

  // Tutup Shift States
  const [showTutupShiftModal, setShowTutupShiftModal] = useState(false);
  const [actualCashCount, setActualCashCount] = useState<string>('');
  const [closingNotes, setClosingNotes] = useState<string>('');
  const [isClosingShift, setIsClosingShift] = useState<boolean>(false);
  const [shiftCloseSuccessToast, setShiftCloseSuccessToast] = useState<string | null>(null);

  const handleOpenTutupShiftModal = () => {
    const defaultCount =
      activeCurrency === 'USD'
        ? String(Number((activeShift.expectedCash / activeRate).toFixed(2)))
        : formatRibuanInput(Math.round(activeShift.expectedCash));
    setActualCashCount(defaultCount);
    setClosingNotes('');
    setShowTutupShiftModal(true);
  };

  const handleOpenOrUpdateShift = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawFloat =
      activeCurrency === 'USD'
        ? Number(openShiftFloatInput) || 0
        : parseRibuanInput(openShiftFloatInput);
    const floatIdr = toIdr(rawFloat, activeCurrency, activeRate);

    const cashierName = String(activeCashier?.name || 'Dede Fajar Kurniawan').replace(
      /muhammad\s+irfan/gi,
      'Dede Fajar Kurniawan'
    );
    const cashierId = activeCashier?.id || 'staff_001';

    const selectedDivObj = staffDivisions.find((d) => d.id === openShiftDivisionId);
    const chosenRole = openShiftRoleName || activeCashier?.role || 'Cashier POS';

    setActiveCashier({
      id: cashierId,
      name: cashierName,
      email: activeCashier?.email || 'dede.kasir@riskcart.com',
      role: chosenRole,
      outlet: activeCashier?.outlet || 'Cabang Utama (Pusat)',
      phone: activeCashier?.phone || '-',
      shift: openShiftSession,
    });

    const nowIso = new Date().toISOString();
    const chosenDate = openShiftDate || getJakartaDateYmd();
    const todayKey = chosenDate.replace(/-/g, '');
    const targetShiftId =
      currentOpenShiftDoc?.id ||
      `SHF-${todayKey}-${String(shiftsDocs.length + 1).padStart(2, '0')}`;
    const parsedDateObj = new Date(`${chosenDate}T12:00:00`);
    const formattedDateId = !isNaN(parsedDateObj.getTime())
      ? parsedDateObj.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : chosenDate;

    const shiftPayload = {
      id: targetShiftId,
      status: 'open',
      tanggal: chosenDate,
      shiftDate: chosenDate,
      date: formattedDateId,
      jam: jakartaClock,
      openedAt: currentOpenShiftDoc?.openedAt || nowIso,
      openedAtDisplay: `${formattedDateId}, ${jakartaClock}`,
      uangLaci: floatIdr,
      initialFloat: floatIdr,
      startingCash: floatIdr,
      cashierId,
      cashierName,
      cashier: cashierName,
      cashierRole: chosenRole,
      divisionId: selectedDivObj?.id || openShiftDivisionId,
      divisionName: selectedDivObj?.name || 'Divisi Front Office / Kasir',
      outlet: activeCashier?.outlet || 'RiskCart Flagship Store (Pusat)',
      session: openShiftSession,
      updatedAt: nowIso,
      createdAt: currentOpenShiftDoc?.createdAt || nowIso,
    };

    setExplicitlyClosedInSession(false);
    setShiftsDocs((prev) => {
      const filtered = prev.filter((s) => s.id !== targetShiftId);
      return [shiftPayload, ...filtered];
    });
    setShowOpenShiftModal(false);

    try {
      sessionStorage.setItem('riskcart_shift_opened_session', 'true');
      localStorage.setItem('riskcart_active_shift', JSON.stringify(shiftPayload));
      localStorage.setItem('riskcart_active_open_shift', JSON.stringify(shiftPayload));
      window.dispatchEvent(new Event('shift-status-changed'));
      window.dispatchEvent(new CustomEvent('riskcart:shift-opened', { detail: shiftPayload }));
    } catch {}

    try {
      const savePromises: Promise<any>[] = [
        setDoc(doc(db, 'shifts', targetShiftId), shiftPayload, { merge: true }),
      ];
      if (floatIdr > 0) {
        const depLaciId = `dep_toko_${targetShiftId}_laci`;
        savePromises.push(
          setDoc(
            doc(db, 'safe_deposits', depLaciId),
            {
              id: depLaciId,
              tanggal: chosenDate,
              jam: jakartaClock,
              date: `${formattedDateId}, ${jakartaClock}`,
              createdAt: nowIso,
              type: 'SETORAN_BRANKAS',
              sourceType: 'UANG_LACI',
              jenisJurnal: 'Uang Laci',
              from: 'Uang Laci',
              to: 'Brangkas Toko',
              vault: 'brangkas-toko',
              amount: floatIdr,
              flowType: 'Kas Masuk',
              note: `Setoran Uang Laci (Modal Awal Kasir) Shift #${targetShiftId} (${cashierName})`,
              actor: cashierName,
              staff: cashierName,
              shiftId: targetShiftId,
            },
            { merge: true }
          )
        );
      }
      await Promise.all(savePromises);
    } catch (err) {
      console.warn('Notice saving open shift to Firestore:', err);
    }

    setShiftCloseSuccessToast(
      `✓ Sesi Shift Aktif #${targetShiftId} (${cashierName}) siap dengan Uang Laci ${fmtMoney(floatIdr, activeCurrency)}.`
    );
    setTimeout(() => setShiftCloseSuccessToast(null), 4000);
  };

  const executeCloseShift = async () => {
    if (isClosingShift) return;
    setIsClosingShift(true);

    try {
      const rawInput =
        actualCashCount.trim() === ''
          ? activeCurrency === 'USD'
            ? Number((activeShift.expectedCash / activeRate).toFixed(2))
            : activeShift.expectedCash
          : activeCurrency === 'USD'
          ? Number(actualCashCount)
          : parseRibuanInput(actualCashCount);

      const countedIdr = toIdr(
        Number.isFinite(rawInput) ? rawInput : 0,
        activeCurrency,
        activeRate
      );
      const expectedIdr = Math.round(activeShift.expectedCash);
      const diffIdr = countedIdr - expectedIdr;
      const auditStatus = diffIdr === 0 ? 'MATCH' : diffIdr > 0 ? 'OVER' : 'SHORT';
      const statusLabel =
        diffIdr === 0
          ? 'Sesuai (MATCH)'
          : diffIdr > 0
          ? 'Lebih (OVER)'
          : 'Kurang (SHORT)';

      const nowIso = new Date().toISOString();
      const chosenDateIso = selectedShiftDate || nowIso.split('T')[0];
      const parsedChosenDate = new Date(`${chosenDateIso}T12:00:00`);
      const formattedChosenDate = !isNaN(parsedChosenDate.getTime())
        ? parsedChosenDate.toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : new Date().toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          });
      const shiftIdToClose =
        currentOpenShiftDoc?.id ||
        activeShift.id ||
        `SHF-${Date.now().toString().slice(-6)}`;

      const closedRecord = {
        id: shiftIdToClose,
        status: 'closed',
        date: formattedChosenDate,
        tanggal: chosenDateIso,
        shiftDate: chosenDateIso,
        openedAt: activeShift.openedAtIso || nowIso,
        openedAtDisplay: activeShift.openedAtDisplay,
        closedAt: nowIso,
        closedAtDisplay:
          formattedChosenDate +
          ' ' +
          new Date().toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
          }) +
          ' WIB',
        session: activeShift.session || 'Shift Kasir',
        shift: activeShift.session || 'Shift Kasir',
        cashierId: activeShift.cashierId || 'staff_001',
        cashierName: activeShift.cashierName || 'Dede Fajar Kurniawan',
        cashier: activeShift.cashierName || 'Dede Fajar Kurniawan',
        outlet: activeShift.outlet || 'RiskCart Flagship Store (Pusat)',
        initialFloat: activeShift.initialFloat,
        startingCash: activeShift.initialFloat,
        salesCash: activeShift.totalSalesCash,
        cashSales: activeShift.totalSalesCash,
        salesNonCash: activeShift.totalSalesNonCash,
        salesQris: activeShift.totalSalesNonCash,
        qrisSales: activeShift.totalSalesNonCash,
        totalKasMasuk: activeShift.totalKasMasuk,
        totalKasKeluar: activeShift.totalKasKeluar,
        totalTransactions: activeShift.totalTransactions,
        totalSales: activeShift.totalSalesAll,
        expectedCash: expectedIdr,
        targetCash: expectedIdr,
        expected: expectedIdr,
        actualCash: countedIdr,
        actual: countedIdr,
        difference: diffIdr,
        discrepancy: diffIdr,
        diff: diffIdr,
        auditStatus,
        statusAudit: statusLabel,
        notes:
          closingNotes.trim() ||
          (diffIdr === 0
            ? 'Kas fisik sesuai sistem (Z-Report OK)'
            : `Selisih kas ${diffIdr > 0 ? '+' : ''}${fmtMoney(diffIdr, activeCurrency)}`),
        createdAt: activeShift.openedAtIso || nowIso,
        updatedAt: nowIso,
      };

      // 1. Optimistic local state update so UI responds in 0ms
      setExplicitlyClosedInSession(true);
      try {
        localStorage.removeItem('riskcart_active_shift');
        localStorage.removeItem('riskcart_active_open_shift');
        localStorage.removeItem('activeShift');
        sessionStorage.removeItem('riskcart_shift_opened_session');
        sessionStorage.removeItem('riskcart_pos_pin_verified');
        window.dispatchEvent(new Event('shift-status-changed'));
        window.dispatchEvent(new CustomEvent('riskcart:shift-closed'));
      } catch {}
      const otherOpenShifts = shiftsDocs.filter(
        (s) =>
          s.id &&
          s.id !== shiftIdToClose &&
          (String(s.status || '').toLowerCase() === 'open' ||
            String(s.status || '').toLowerCase() === 'aktif')
      );
      setShiftsDocs((prev) => {
        const others = prev
          .filter((s) => s.id !== shiftIdToClose)
          .map((s) =>
            String(s.status || '').toLowerCase() === 'open' ||
            String(s.status || '').toLowerCase() === 'aktif'
              ? { ...s, status: 'closed', closedAt: nowIso, updatedAt: nowIso }
              : s
          );
        return [closedRecord, ...others];
      });
      setShiftHistoryDocs((prev) => {
        const others = prev.filter((s) => s.id !== shiftIdToClose);
        return [closedRecord, ...others];
      });

      // 2. Close modal & show toast immediately
      setShowTutupShiftModal(false);
      setActualCashCount('');
      setClosingNotes('');
      setShiftCloseSuccessToast(
        `✓ Shift kasir #${closedRecord.id} (${closedRecord.cashierName}) berhasil ditutup & tersimpan di Riwayat Shift!`
      );
      setTimeout(() => setShiftCloseSuccessToast(null), 4500);

      // 3. Persist to Firestore `shifts` and `shift_history`
      await Promise.all([
        setDoc(doc(db, 'shifts', shiftIdToClose), closedRecord, { merge: true }).catch((err) =>
          console.warn('Firestore shifts close notice:', err)
        ),
        setDoc(doc(db, 'shift_history', shiftIdToClose), closedRecord, { merge: true }).catch(
          (err) => console.warn('Firestore shift_history close notice:', err)
        ),
        ...otherOpenShifts.map((s) =>
          setDoc(
            doc(db, 'shifts', s.id),
            { ...s, status: 'closed', closedAt: nowIso, updatedAt: nowIso },
            { merge: true }
          ).catch(() => {})
        ),
      ]);

      // Navigate to Riwayat Shift tab so user sees the saved record
      setActiveSub('riwayat_shit');
    } finally {
      setIsClosingShift(false);
    }
  };

  const handleConfirmCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeCloseShift();
  };

  const handleAddKasMasuk = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawVal =
      activeCurrency === 'USD' ? Number(kmAmount) : parseRibuanInput(kmAmount);
    if (!rawVal || isNaN(rawVal)) return;
    const valIdr = toIdr(rawVal, activeCurrency, activeRate);
    if (editingKmId) {
      await updateKasMasukDoc(editingKmId, {
        category: kmCategory,
        amount: valIdr,
        source: kmSource || 'Kasir',
        note: kmNote || '-',
      });
      setEditingKmId(null);
    } else {
      const item = {
        id: `KM-${Date.now().toString().slice(-5)}`,
        shiftId: activeShift.id,
        time:
          new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
        category: kmCategory,
        amount: valIdr,
        source: kmSource || 'Kasir',
        note: kmNote || '-',
        recordedBy: activeShift.cashierName,
      };
      await addKasMasukDoc(item);
    }
    setShowKasMasukModal(false);
    setKmAmount('');
    setKmSource('');
    setKmNote('');
  };

  const handleAddKasKeluar = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawVal =
      activeCurrency === 'USD' ? Number(kkAmount) : parseRibuanInput(kkAmount);
    if (!rawVal || isNaN(rawVal)) return;
    const valIdr = toIdr(rawVal, activeCurrency, activeRate);
    const nowIso = new Date().toISOString();
    const chosenDate = selectedShiftDate || getJakartaDateYmd();
    const timeStr =
      new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
    if (editingKkId) {
      await updateKasKeluarDoc(editingKkId, {
        category: kkCategory,
        amount: valIdr,
        recipient: kkRecipient || 'Pihak Ketiga',
        note: kkNote || '-',
        updatedAt: nowIso,
      });
      setEditingKkId(null);
    } else {
      const kkId = `KK-${Date.now().toString().slice(-5)}`;
      const item = {
        id: kkId,
        shiftId: activeShift.id,
        tanggal: chosenDate,
        date: new Date().toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
        createdAt: nowIso,
        time: timeStr,
        jam: timeStr,
        category: kkCategory,
        amount: valIdr,
        recipient: kkRecipient || 'Pihak Ketiga',
        note: kkNote || '-',
        recordedBy: activeShift.cashierName,
        from: 'Brangkas Toko',
        to: 'Pengeluaran Toko / Kas Keluar',
        vault: 'brangkas-toko',
        flowType: 'Kas Keluar',
      };
      await addKasKeluarDoc(item);
    }
    setShowKasKeluarModal(false);
    setKkAmount('');
    setKkRecipient('');
    setKkNote('');
  };

  const handleAddKasKeluarCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    const newCat = {
      id: `kk-cat-${Date.now()}`,
      name: trimmed,
      createdAt: new Date().toISOString(),
    };
    await addKasKeluarCategoryDoc(newCat);
    setKkCategory(trimmed);
    setNewCategoryInput('');
  };

  const handleDeleteShiftRecord = async (shiftId: string) => {
    setShiftsDocs((prev) => prev.filter((s) => s.id !== shiftId));
    setShiftHistoryDocs((prev) => prev.filter((s) => s.id !== shiftId));
    await Promise.all([
      deleteDoc(doc(db, 'shifts', shiftId)).catch(() => {}),
      deleteDoc(doc(db, 'shift_history', shiftId)).catch(() => {}),
    ]);
  };

  // Calculate preview difference in Tutup Shift modal
  const previewActualIdr = useMemo(() => {
    const clean =
      activeCurrency === 'USD'
        ? Number(actualCashCount)
        : parseRibuanInput(actualCashCount);
    if (actualCashCount.trim() === '' || isNaN(clean)) {
      return null;
    }
    return toIdr(clean, activeCurrency, activeRate);
  }, [actualCashCount, activeCurrency, activeRate]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="w-6 h-6 text-emerald-400" />
            <h1 className="text-2xl font-black text-white tracking-tight">
              MANAJEMEN SHIFT &amp; KASIR
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Pengendalian laci uang (*cash drawer*), sinkronisasi transaksi shift aktif real-time, kas operasional, dan riwayat tutup shift kasir (Z-Report).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isPurgingTodayShift}
            onClick={() => setConfirmPurgeTodayHeaderOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-rose-950/90 hover:bg-rose-900 border border-rose-800/80 text-rose-300 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>
              {isPurgingTodayShift ? 'Menghapus...' : 'Hapus Transaksi Shift Hari Ini'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              const currentFloatDisplay =
                activeCurrency === 'USD'
                  ? String(Number((activeShift.initialFloat / activeRate).toFixed(2)))
                  : String(Math.round(activeShift.initialFloat));
              setOpenShiftFloatInput(currentFloatDisplay);
              setOpenShiftCashierId(activeShift.cashierId || activeCashier.id || 'staff_001');
              setOpenShiftSession(activeShift.session || 'Shift Pagi (07:30 - 15:00)');
              setShowOpenShiftModal(true);
            }}
            className="px-3.5 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
          >
            <Unlock className="w-3.5 h-3.5" />
            <span>
              {activeShift.status === 'open'
                ? 'Atur Modal Awal / Kasir Shift'
                : '+ Buka Shift Kasir Baru'}
            </span>
          </button>
        </div>
      </div>

      {confirmPurgeTodayHeaderOpen && (
        <div className="p-4 rounded-xl bg-rose-950/90 border border-rose-700/80 text-rose-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="font-black text-rose-300 text-sm">
              Hapus Transaksi Shift Hari Ini ({selectedShiftDate || getJakartaDateYmd()})?
            </div>
            <p className="text-rose-200/80 mt-0.5">
              Seluruh transaksi penjualan, kas masuk/keluar, dan catatan shift hari ini akan dibersihkan dari Firestore &amp; cache lokal. Data Produk, Kategori, Brand, dan Staff tetap 100% aman.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmPurgeTodayHeaderOpen(false)}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={isPurgingTodayShift}
              onClick={async () => {
                setIsPurgingTodayShift(true);
                try {
                  const targetYmd = selectedShiftDate || getJakartaDateYmd();
                  const res = await purgeTodayShiftTransactions(targetYmd);
                  setConfirmPurgeTodayHeaderOpen(false);
                  setShiftCloseSuccessToast(
                    `✓ Transaksi shift hari ini (${targetYmd}) berhasil dihapus (${res.totalDeleted} dokumen dibersihkan).`
                  );
                  setTimeout(() => setShiftCloseSuccessToast(null), 5000);
                } finally {
                  setIsPurgingTodayShift(false);
                }
              }}
              className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-black cursor-pointer disabled:opacity-50"
            >
              {isPurgingTodayShift ? 'Menghapus...' : 'Ya, Hapus Sekarang'}
            </button>
          </div>
        </div>
      )}

      {/* Sub-Tabs */}
      <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto w-full max-w-none mb-4">
        <button
          onClick={() => setActiveSub('cashir')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
            activeSub === 'cashir'
              ? 'bg-amber-400 text-zinc-950 shadow-sm font-black'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          <span>END SHIFT</span>
        </button>
        <button
          onClick={() => setActiveSub('divisi_role')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
            activeSub === 'divisi_role'
              ? 'bg-blue-600 text-white shadow-sm font-black'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <ChefHat className="w-3.5 h-3.5 text-amber-400" />
          <span>Divisi &amp; Role Staff</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
            {staffDivisions.length} Divisi &bull; {divisionRoster.filter((m) => m.onDuty).length} Aktif
          </span>
        </button>
        <button
          onClick={() => setActiveSub('kas_masuk')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'kas_masuk'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <ArrowDownRight className="w-3.5 h-3.5" />
          <span>Kas Masuk</span>
        </button>
        <button
          onClick={() => setActiveSub('kas_keluar')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'kas_keluar'
              ? 'bg-rose-600 text-white shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <ArrowUpRight className="w-3.5 h-3.5" />
          <span>Kas Keluar</span>
        </button>
        <button
          onClick={() => setActiveSub('riwayat_shit')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'riwayat_shit'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>Riwayat Shift ({mergedShiftHistory.length})</span>
        </button>
      </div>

      {/* VIEW: DIVISI & ROLE STAFF */}
      {activeSub === 'divisi_role' && (
        <StaffDivisionRoleSection onNavigateTab={navigateTab} />
      )}

      {/* VIEW: CASHIR -> END SHIFT */}
      {activeSub === 'cashir' && (
        <div className="space-y-4">
          {/* Quick Division & Kitchen Team Summary Bar */}
          <div className="p-4 rounded-2xl bg-zinc-900/95 border border-zinc-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-400 flex items-center justify-center shrink-0">
                <ChefHat className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-black text-white uppercase tracking-wider">
                    Tim Shift Aktif Lintas Divisi ({divisionRoster.filter((m) => m.onDuty).length} Staff On-Duty)
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/35">
                    Kitchen: {kitchenStaffOnDuty.length} Chef &amp; Kru
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Divisi Kitchen (Executive Chef, Sous Chef, Chef de Partie, Commis, Prep Cook, Pastry, Expediter, Dishwasher), Service/Floor, Bar, Kasir &amp; Gudang tersinkron ke <code className="text-amber-300 font-mono">/kitchen</code> &amp; POS.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveSub('divisi_role')}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0 w-fit shadow-sm"
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>Kelola Divisi &amp; Role Staff →</span>
            </button>
          </div>

          <EndShiftView
            currentOpenShiftDoc={currentOpenShiftDoc}
            shiftsDocs={shiftsDocs}
            setShiftsDocs={setShiftsDocs}
            setShiftHistoryDocs={setShiftHistoryDocs}
            staffList={staffList}
            selectedDate={selectedShiftDate}
            onChangeSelectedDate={(nextDate) => {
              setSelectedShiftDate(nextDate);
              setHasShiftDateChanged(true);
            }}
            onShiftClosed={() => {
              setExplicitlyClosedInSession(true);
            }}
            onOpenShiftClick={() => {
              const currentFloatDisplay =
                activeCurrency === 'USD'
                  ? String(Number((activeShift.initialFloat / activeRate).toFixed(2)))
                  : String(Math.round(activeShift.initialFloat));
              setOpenShiftFloatInput(currentFloatDisplay);
              setOpenShiftCashierId(activeShift.cashierId || 'staff_001');
              setOpenShiftSession(activeShift.session || 'Shift Pagi (07:30 - 15:00)');
              const inferred = inferDivisionFromRole(activeCashier?.role, staffDivisions);
              setOpenShiftDivisionId(inferred.divisionId);
              setOpenShiftRoleName(activeCashier?.role || 'Head Cashier');
              setShowOpenShiftModal(true);
            }}
            onNavigateTab={navigateTab}
          />
        </div>
      )}

      {false && activeSub === 'cashir' && (
        <div className="space-y-6">
          {/* Active Shift Card */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
              <div className="flex items-center gap-3">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${
                    activeShift.status === 'open'
                      ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-400'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                  }`}
                >
                  {activeShift.status === 'open' ? (
                    <Unlock className="w-6 h-6" />
                  ) : (
                    <Lock className="w-6 h-6" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-xs font-bold px-2 py-0.5 rounded border ${
                        activeShift.status === 'open'
                          ? 'text-emerald-400 bg-emerald-950/80 border-emerald-800'
                          : 'text-amber-400 bg-amber-950/80 border-amber-800'
                      }`}
                    >
                      {activeShift.status === 'open'
                        ? 'SHIFT BERJALAN (OPEN)'
                        : 'SESI SIAP DIBUKA'}
                    </span>
                    <span className="text-zinc-400 text-xs font-mono">{activeShift.id}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <h3 className="font-black text-white text-lg">{activeShift.cashierName}</h3>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold">
                      {activeShift.session}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    {activeShift.outlet} &bull; Dibuka: {activeShift.openedAtDisplay}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const currentFloatDisplay =
                      activeCurrency === 'USD'
                        ? String(Number((activeShift.initialFloat / activeRate).toFixed(2)))
                        : String(Math.round(activeShift.initialFloat));
                    setOpenShiftFloatInput(currentFloatDisplay);
                    setOpenShiftCashierId(activeShift.cashierId || 'staff_001');
                    setOpenShiftSession(activeShift.session || 'Shift Pagi (07:30 - 15:00)');
                    setShowOpenShiftModal(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-emerald-400 text-xs font-bold transition border border-zinc-700 cursor-pointer flex items-center gap-1.5"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>Buka / Ubah Modal &amp; Kasir</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenTutupShiftModal}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-md flex items-center gap-1.5 cursor-pointer"
                  title="Tutup Shift Kasir & Rekonsiliasi Uang Fisik Laci"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Tutup Shift Kasir</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab && onNavigateTab('pos_machine')}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition shadow-sm cursor-pointer"
                >
                  Ke Mesin Kasir POS
                </button>
              </div>
            </div>

            {/* Shift Balance Summary Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs">
              <div className="p-4 bg-zinc-950/70 border border-zinc-800 rounded-xl">
                <span className="text-zinc-500 block text-[10px] font-bold uppercase">
                  Modal Awal Laci (Float)
                </span>
                <span className="text-lg font-mono font-black text-white mt-1 block">
                  {fmtMoney(activeShift.startingCash, activeCurrency)}
                </span>
                <span className="text-[10px] text-zinc-500">Uang kembalian awal shift</span>
              </div>

              <div className="p-4 bg-zinc-950/70 border border-zinc-800 rounded-xl">
                <span className="text-zinc-500 block text-[10px] font-bold uppercase">
                  Penjualan Tunai (Cash)
                </span>
                <span className="text-lg font-mono font-black text-blue-400 mt-1 block">
                  {fmtMoney(activeShift.totalSalesCash, activeCurrency)}
                </span>
                <span className="text-[10px] text-zinc-500">
                  Masuk ke laci kasir ({shiftTransactions.filter((t: any) => isCashPayment(t.paymentMethod, t.paymentStatus)).length} struk)
                </span>
              </div>

              <div className="p-4 bg-zinc-950/70 border border-zinc-800 rounded-xl">
                <span className="text-zinc-500 block text-[10px] font-bold uppercase">
                  Non-Tunai / Hutang / COD Aktif
                </span>
                <span className="text-lg font-mono font-black text-cyan-400 mt-1 block">
                  {fmtMoney(activeShift.totalSalesNonCash, activeCurrency)}
                </span>
                <span className="text-[10px] text-zinc-500">
                  QRIS / Hutang / COD ({shiftTransactions.filter((t: any) => !isCashPayment(t.paymentMethod, t.paymentStatus)).length} struk)
                </span>
              </div>

              <div className="p-4 bg-zinc-950/70 border border-zinc-800 rounded-xl">
                <span className="text-zinc-500 block text-[10px] font-bold uppercase">
                  Kas Masuk / Kas Keluar
                </span>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    +{fmtMoney(activeShift.totalKasMasuk, activeCurrency)}
                  </span>
                  <span className="text-xs font-mono font-bold text-rose-400">
                    -{fmtMoney(activeShift.totalKasKeluar, activeCurrency)}
                  </span>
                </div>
                <span className="text-[10px] text-zinc-500">Mutasi operasional laci</span>
              </div>

              <div className="p-4 bg-emerald-950/20 border border-emerald-900/50 rounded-xl">
                <span className="text-emerald-400 block text-[10px] font-bold uppercase">
                  Target Saldo Laci Saat Ini
                </span>
                <span className="text-lg font-mono font-black text-emerald-400 mt-1 block">
                  {fmtMoney(activeShift.expectedCash, activeCurrency)}
                </span>
                <span className="text-[10px] text-emerald-300">Wajib ada di cash drawer</span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleOpenTutupShiftModal}
                className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-md"
                title="Rekonsiliasi Uang Fisik Laci & Tutup Shift Kasir"
              >
                <Lock className="w-4 h-4" />
                <span>Tutup Shift Kasir (Z-Report)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingKmId(null);
                  setShowKasMasukModal(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-emerald-400 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowDownRight className="w-4 h-4" />
                <span>+ Catat Kas Masuk</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingKkId(null);
                  setShowKasKeluarModal(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-rose-400 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowUpRight className="w-4 h-4" />
                <span>- Catat Kas Keluar</span>
              </button>
              <button
                type="button"
                onClick={() => setShowCategoryModal(true)}
                className="px-3.5 py-2 rounded-xl bg-zinc-850 hover:bg-zinc-800 text-amber-400 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border border-zinc-700 shadow-sm"
                title="Kelola Master Kategori Biaya Kas Keluar Operasional"
              >
                <Tag className="w-4 h-4 text-amber-400" />
                <span>Kategori Biaya</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 font-mono">
                  {kasKeluarCategories.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                title="Cetak X-Report Shift ke Printer"
              >
                <Printer className="w-4 h-4 text-zinc-400" />
                <span>Cetak X-Report Shift</span>
              </button>
            </div>
          </div>

          {/* Real-Time Active Shift Transactions Table */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-blue-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Daftar Transaksi Shift Aktif ({filteredShiftTransactions.length} Transaksi)
                  </h3>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Sinkronisasi real-time seluruh transaksi POS &amp; pesanan yang masuk pada periode shift berjalan. Total Penjualan Shift:{' '}
                  <span className="text-emerald-400 font-mono font-bold">
                    {fmtMoney(activeShift.totalSalesAll, activeCurrency)}
                  </span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Cari struk / pelanggan / kasir..."
                    value={txSearchQuery}
                    onChange={(e) => setTxSearchQuery(e.target.value)}
                    className="bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-xl p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setTxScopeMode('shift')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                      txScopeMode === 'shift'
                        ? 'bg-blue-600 text-white'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Shift Saat Ini
                  </button>
                  <button
                    type="button"
                    onClick={() => setTxScopeMode('all')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                      txScopeMode === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Semua ({validTransactions.length})
                  </button>
                </div>
              </div>
            </div>

            <div className="border border-zinc-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950/90 text-zinc-400 border-b border-zinc-800 uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-3 px-4">No. Struk</th>
                      <th className="py-3 px-4">Waktu</th>
                      <th className="py-3 px-4">Kasir &amp; Pengirim</th>
                      <th className="py-3 px-4">Pelanggan</th>
                      <th className="py-3 px-4">Item Terjual</th>
                      <th className="py-3 px-4">Metode Bayar</th>
                      <th className="py-3 px-4 text-right">Total Nominal</th>
                      <th className="py-3 px-4 text-center">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                    {filteredShiftTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-zinc-500">
                          <p className="text-sm font-medium text-zinc-400">
                            Belum ada transaksi tercatat pada filter ini.
                          </p>
                          <p className="text-xs text-zinc-600 mt-1">
                            Setiap transaksi pembayaran di Mesin Kasir POS akan langsung muncul di sini secara real-time.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      filteredShiftTransactions.map((tx: any) => {
                        const txAmount = Number(
                          tx.totalAmount ?? tx.totalRevenue ?? tx.subtotal ?? 0
                        );
                        const cashierDisplay = String(
                          tx.cashierName ||
                            tx.cashier ||
                            activeShift.cashierName ||
                            'Dede Fajar Kurniawan'
                        ).replace(/muhammad\s+irfan/gi, 'Dede Fajar Kurniawan');
                        const senderDisplay = tx.deliveryStaffName || null;
                        const pmLower = String(tx.paymentMethod || 'cash').toLowerCase();
                        const pStatus = String(tx.paymentStatus || (pmLower === 'debt' || pmLower === 'hutang' || pmLower === 'cod' ? 'unpaid' : 'paid')).toLowerCase();
                        const methodBadgeText =
                          pmLower === 'debt' || pmLower === 'hutang'
                            ? 'HUTANG'
                            : pmLower === 'cod'
                            ? pStatus === 'paid'
                              ? 'COD (LUNAS)'
                              : 'COD (DIKIRIM)'
                            : pmLower === 'qris'
                            ? 'QRIS'
                            : 'TUNAI';
                        const itemsList = Array.isArray(tx.items) ? tx.items : [];
                        const itemSummary =
                          itemsList.length > 0
                            ? itemsList
                                .map(
                                  (it: any) =>
                                    `${it.productName || it.name || 'Produk'} (${
                                      it.quantityOrdered || it.qty || it.quantity || 1
                                    })`
                                )
                                .join(', ')
                            : 'Transaksi POS';

                        return (
                          <tr key={tx.id} className="hover:bg-zinc-800/40 transition">
                            <td className="py-3 px-4 font-mono font-bold text-blue-400">
                              #{tx.orderNumber || tx.id.slice(-8).toUpperCase()}
                            </td>
                            <td className="py-3 px-4 text-zinc-400 whitespace-nowrap">
                              {tx.createdAt
                                ? new Date(tx.createdAt).toLocaleString('id-ID', {
                                    day: '2-digit',
                                    month: 'short',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : '-'}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-col gap-1">
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-zinc-800 text-zinc-200 font-semibold border border-zinc-700 w-fit">
                                  <User className="w-3 h-3 text-emerald-400" />
                                  {cashierDisplay}
                                </span>
                                {senderDisplay && (
                                  <span className="text-[10px] text-cyan-400 font-semibold">
                                    Kurir: {senderDisplay}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 font-medium text-white">
                              {tx.customerName || 'Pelanggan Umum'}
                            </td>
                            <td className="py-3 px-4 text-zinc-400 max-w-xs truncate" title={itemSummary}>
                              {itemSummary}
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  isCashPayment(tx.paymentMethod, tx.paymentStatus)
                                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                    : pmLower === 'qris'
                                    ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                                    : pmLower === 'cod'
                                    ? 'bg-purple-950 text-purple-300 border border-purple-800'
                                    : 'bg-amber-950 text-amber-400 border border-amber-800'
                                }`}
                              >
                                {methodBadgeText}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-white whitespace-nowrap">
                              {fmtMoney(txAmount, activeCurrency)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <button
                                type="button"
                                onClick={() =>
                                  setDetailModal({
                                    title: `Detail Transaksi Shift: #${tx.id.slice(-8).toUpperCase()}`,
                                    data: {
                                      'ID Transaksi': tx.id,
                                      'Waktu Transaksi': tx.createdAt
                                        ? new Date(tx.createdAt).toLocaleString('id-ID')
                                        : '-',
                                      'Kasir Bertugas': cashierDisplay,
                                      'Pengirim / Kurir': senderDisplay || 'Ambil Sendiri di Toko',
                                      Pelanggan: tx.customerName || 'Pelanggan Umum',
                                      'Metode Pembayaran': methodBadgeText,
                                      'Status Pembayaran': pStatus === 'paid' ? 'LUNAS (PAID)' : 'BELUM LUNAS (UNPAID)',
                                      'Rincian Produk': itemSummary,
                                      'Total Transaksi': fmtMoney(txAmount, activeCurrency),
                                      Status: (tx.status || 'completed').toUpperCase(),
                                    },
                                  })
                                }
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                                title="Lihat Detail Transaksi"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: KAS MASUK */}
      {activeSub === 'kas_masuk' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Daftar Kas Masuk Laci Toko (Inflow)
            </h3>
            <button
              onClick={() => {
                setEditingKmId(null);
                setShowKasMasukModal(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Kas Masuk</span>
            </button>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">No. Bukti</th>
                  <th className="py-3 px-4">Waktu</th>
                  <th className="py-3 px-4">Kategori</th>
                  <th className="py-3 px-4">Sumber Dana</th>
                  <th className="py-3 px-4">Catatan</th>
                  <th className="py-3 px-4 text-right">Nominal</th>
                  <th className="py-3 px-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {kasMasukList.map((km) => (
                  <tr key={km.id} className="hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono font-bold text-blue-400">{km.id}</td>
                    <td className="py-3 px-4 text-zinc-400">{km.time}</td>
                    <td className="py-3 px-4 font-bold text-white">{km.category}</td>
                    <td className="py-3 px-4 text-zinc-300">{km.source}</td>
                    <td className="py-3 px-4 text-zinc-400">{km.note}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                      +{fmtMoney(Number(km.amount || 0), activeCurrency)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setDetailModal({
                              title: `Detail Kas Masuk: ${km.id}`,
                              data: {
                                'No. Bukti': km.id,
                                Waktu: km.time,
                                Kategori: km.category,
                                'Sumber Dana': km.source,
                                Nominal: fmtMoney(Number(km.amount || 0), activeCurrency),
                                Catatan: km.note || '-',
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
                          onClick={() => {
                            setEditingKmId(km.id);
                            setKmCategory(km.category || 'Tambahan Modal Kasir');
                            setKmAmount(
                              activeCurrency === 'USD'
                                ? String(Number((Number(km.amount || 0) / activeRate).toFixed(2)))
                                : String(km.amount || 0)
                            );
                            setKmSource(km.source || '');
                            setKmNote(km.note || '');
                            setShowKasMasukModal(true);
                          }}
                          title="Edit Kas Masuk"
                          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteKasMasukDoc(km.id)}
                          title="Hapus Kas Masuk"
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
        </div>
      )}

      {/* VIEW: KAS KELUAR */}
      {activeSub === 'kas_keluar' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Daftar Kas Keluar &amp; Biaya Operasional Kasir (Outflow)
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setEditingKkId(null);
                  setShowKasKeluarModal(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Kas Keluar</span>
              </button>
              <button
                type="button"
                onClick={() => setShowCategoryModal(true)}
                className="px-3.5 py-2 rounded-xl bg-zinc-850 hover:bg-zinc-800 text-amber-400 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border border-zinc-700 shadow-sm"
                title="Kelola Master Kategori Biaya Kas Keluar Operasional"
              >
                <Tag className="w-4 h-4 text-amber-400" />
                <span>Kategori Biaya</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 font-mono">
                  {kasKeluarCategories.length}
                </span>
              </button>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">No. Bukti</th>
                  <th className="py-3 px-4">Waktu</th>
                  <th className="py-3 px-4">Kategori Biaya</th>
                  <th className="py-3 px-4">Penerima Dana</th>
                  <th className="py-3 px-4">Keterangan</th>
                  <th className="py-3 px-4 text-right">Nominal</th>
                  <th className="py-3 px-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {kasKeluarList.map((kk) => (
                  <tr key={kk.id} className="hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono font-bold text-rose-400">{kk.id}</td>
                    <td className="py-3 px-4 text-zinc-400">{kk.time}</td>
                    <td className="py-3 px-4 font-bold text-white">{kk.category}</td>
                    <td className="py-3 px-4 text-zinc-300">{kk.recipient}</td>
                    <td className="py-3 px-4 text-zinc-400">{kk.note}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-rose-400">
                      -{fmtMoney(Number(kk.amount || 0), activeCurrency)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setDetailModal({
                              title: `Detail Kas Keluar: ${kk.id}`,
                              data: {
                                'No. Bukti': kk.id,
                                Waktu: kk.time,
                                'Kategori Biaya': kk.category,
                                'Penerima Dana': kk.recipient,
                                Nominal: fmtMoney(Number(kk.amount || 0), activeCurrency),
                                Keterangan: kk.note || '-',
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
                          onClick={() => {
                            setEditingKkId(kk.id);
                            setKkCategory(kk.category || 'Operasional Kasir');
                            setKkAmount(
                              activeCurrency === 'USD'
                                ? String(Number((Number(kk.amount || 0) / activeRate).toFixed(2)))
                                : String(kk.amount || 0)
                            );
                            setKkRecipient(kk.recipient || '');
                            setKkNote(kk.note || '');
                            setShowKasKeluarModal(true);
                          }}
                          title="Edit Kas Keluar"
                          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteKasKeluarDoc(kk.id)}
                          title="Hapus Kas Keluar"
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
        </div>
      )}

      {/* VIEW: RIWAYAT SHIFT (/dashboard/shift/riwayat) */}
      {activeSub === 'riwayat_shit' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Riwayat Shift &amp; Tutup Kasir (Z-Report)
              </h3>
              <p className="text-xs text-zinc-400">
                Arsip audit laci uang, kesesuaian fisik kasir, dan rekonsiliasi selisih kas harian yang tersimpan di Firestore (`shifts` &amp; `shift_history`).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveSub('cashir')}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition cursor-pointer w-fit"
            >
              Kembali ke Shift Aktif
            </button>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800 uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4">ID Shift</th>
                    <th className="py-3 px-4">Waktu Buka &amp; Tutup</th>
                    <th className="py-3 px-4">Kasir Bertugas</th>
                    <th className="py-3 px-4 text-center">Transaksi</th>
                    <th className="py-3 px-4 text-right">Modal Awal</th>
                    <th className="py-3 px-4 text-right">Penjualan Tunai</th>
                    <th className="py-3 px-4 text-right">Non-Tunai / QRIS</th>
                    <th className="py-3 px-4 text-right">Target Sistem</th>
                    <th className="py-3 px-4 text-right">Uang Fisik</th>
                    <th className="py-3 px-4 text-right">Selisih</th>
                    <th className="py-3 px-4 text-center">Status Audit</th>
                    <th className="py-3 px-4">Catatan</th>
                    <th className="py-3 px-4 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {mergedShiftHistory.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="py-12 text-center text-zinc-500">
                        <p className="text-sm font-medium text-zinc-400">
                          Belum ada riwayat shift yang ditutup.
                        </p>
                        <p className="text-xs text-zinc-600 mt-1">
                          Gunakan tombol &quot;Tutup Shift Kasir&quot; di halaman Kasir &amp; Shift Aktif untuk menyimpan laporan rekonsiliasi shift.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    mergedShiftHistory.map((s) => (
                      <tr key={s.id} className="hover:bg-zinc-800/40 transition">
                        <td className="py-3 px-4 font-mono font-bold text-blue-400 whitespace-nowrap">
                          {s.id}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-bold text-white block">{s.closedDisplay || s.date}</span>
                          <span className="text-[11px] text-zinc-400">
                            {s.session} &bull; Buka: {s.openedDisplay}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-medium text-zinc-200 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-zinc-800 text-white border border-zinc-700">
                            <User className="w-3 h-3 text-emerald-400" />
                            {s.cashierName}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold text-zinc-200">
                          {s.totalTransactions}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-zinc-300 whitespace-nowrap">
                          {fmtMoney(s.initialFloat, activeCurrency)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-blue-400 font-semibold whitespace-nowrap">
                          {fmtMoney(s.salesCash, activeCurrency)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-cyan-400 whitespace-nowrap">
                          {fmtMoney(s.salesNonCash, activeCurrency)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-zinc-200 font-semibold whitespace-nowrap">
                          {fmtMoney(s.expectedCash, activeCurrency)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-white whitespace-nowrap">
                          {fmtMoney(s.actualCash, activeCurrency)}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono font-bold whitespace-nowrap ${
                            s.difference === 0
                              ? 'text-emerald-400'
                              : s.difference > 0
                              ? 'text-blue-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {s.difference > 0 ? '+' : ''}
                          {fmtMoney(s.difference, activeCurrency)}
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              s.difference === 0
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : s.difference > 0
                                ? 'bg-blue-950 text-blue-400 border border-blue-800'
                                : 'bg-rose-950 text-rose-400 border border-rose-800'
                            }`}
                          >
                            {s.statusLabel}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-zinc-400 max-w-[180px] truncate" title={s.notes}>
                          {s.notes}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                setDetailModal({
                                  title: `Detail Z-Report Shift: ${s.id}`,
                                  data: {
                                    'ID Shift': s.id,
                                    'Waktu Buka': s.openedDisplay,
                                    'Waktu Tutup': s.closedDisplay,
                                    Sesi: s.session,
                                    'Kasir Bertugas': s.cashierName,
                                    'Total Transaksi': `${s.totalTransactions} Transaksi`,
                                    'Modal Awal (Float)': fmtMoney(s.initialFloat, activeCurrency),
                                    'Penjualan Tunai (Laci)': fmtMoney(s.salesCash, activeCurrency),
                                    'Penjualan Non-Tunai / QRIS': fmtMoney(
                                      s.salesNonCash,
                                      activeCurrency
                                    ),
                                    'Total Seluruh Penjualan': fmtMoney(
                                      s.totalSales,
                                      activeCurrency
                                    ),
                                    'Kas Masuk Operasional': fmtMoney(
                                      s.totalKasMasuk,
                                      activeCurrency
                                    ),
                                    'Kas Keluar Operasional': fmtMoney(
                                      s.totalKasKeluar,
                                      activeCurrency
                                    ),
                                    'Target Saldo Laci (Sistem)': fmtMoney(
                                      s.expectedCash,
                                      activeCurrency
                                    ),
                                    'Uang Fisik Dihitung': fmtMoney(s.actualCash, activeCurrency),
                                    'Selisih Rekonsiliasi': `${
                                      s.difference > 0 ? '+' : ''
                                    }${fmtMoney(s.difference, activeCurrency)}`,
                                    'Status Audit': s.statusLabel,
                                    'Catatan Penutupan': s.notes || '-',
                                  },
                                })
                              }
                              title="Lihat Detail Shift"
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingShiftHist(s)}
                              title="Edit Riwayat Shift"
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteShiftRecord(s.id)}
                              title="Hapus Riwayat Shift"
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
        </div>
      )}

      {/* MODAL: BUKA SHIFT BARU / ATUR MODAL AWAL & KASIR */}
      {showOpenShiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Unlock className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-white text-base">
                  Buka Shift Kasir / Atur Modal Awal
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowOpenShiftModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleOpenOrUpdateShift} className="space-y-3.5 text-xs">
              {/* 1. Nama (Otomatis sesuai login & Disable) */}
              <div>
                <label className="block text-zinc-300 font-bold mb-1">
                  1. Nama Petugas Shift:
                </label>
                <input
                  type="text"
                  value={activeCashier?.name || 'Kasir POS'}
                  disabled={true}
                  readOnly
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-300 font-bold cursor-not-allowed opacity-85"
                />
              </div>

              {/* Pilih Divisi & Pilih Role / Jabatan Dinamis */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-xl bg-zinc-950/80 border border-zinc-800">
                <div>
                  <label className="block text-amber-400 font-bold mb-1">
                    Pilih Divisi:
                  </label>
                  <select
                    value={openShiftDivisionId}
                    onChange={(e) => {
                      const nextDivId = e.target.value;
                      setOpenShiftDivisionId(nextDivId);
                      const foundDiv = staffDivisions.find((d) => d.id === nextDivId);
                      if (foundDiv && foundDiv.roles.length > 0) {
                        setOpenShiftRoleName(foundDiv.roles[0].name);
                      }
                    }}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-white font-semibold focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    {staffDivisions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-emerald-400 font-bold mb-1">
                    Pilih Role / Jabatan:
                  </label>
                  <select
                    value={openShiftRoleName}
                    onChange={(e) => setOpenShiftRoleName(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-white font-semibold focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    {openShiftDivisionRoles.map((r) => (
                      <option key={r.id || r.name} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 2. Tanggal (Default Today Asia/Jakarta) */}
              <div>
                <label className="block text-zinc-300 font-bold mb-1">
                  2. Tanggal (Default Hari Ini - WIB):
                </label>
                <input
                  type="date"
                  required
                  value={openShiftDate}
                  onChange={(e) => setOpenShiftDate(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-white font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* 3. Jam (Waktu Jakarta WIB & Disable) */}
              <div>
                <label className="block text-zinc-300 font-bold mb-1">
                  3. Jam (Waktu Jakarta WIB):
                </label>
                <input
                  type="text"
                  value={jakartaClock}
                  disabled={true}
                  readOnly
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-amber-300 font-mono font-bold cursor-not-allowed opacity-90"
                />
              </div>

              {/* 4. Uang Laci (Format titik ribuan otomatis) */}
              <div>
                <label className="block text-zinc-300 font-bold mb-1">
                  4. Uang Laci ({activeCurrency === 'USD' ? 'USD $' : 'IDR Rp'}) *:
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-emerald-400 font-bold font-mono">
                    {activeCurrency === 'USD' ? '$' : 'Rp'}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    placeholder="Contoh: 500.000"
                    value={openShiftFloatInput}
                    onChange={(e) =>
                      setOpenShiftFloatInput(
                        activeCurrency === 'USD'
                          ? e.target.value.replace(/[^0-9.]/g, '')
                          : formatRibuanInput(e.target.value)
                      )
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-3.5 py-2.5 text-white font-mono font-bold text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowOpenShiftModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer shadow-md"
                >
                  Mulai Shift &amp; Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Kas Masuk */}
      {showKasMasukModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-white text-base">Catat Kas Masuk Laci</h3>
            <form onSubmit={handleAddKasMasuk} className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Kategori Kas Masuk:</label>
                <select
                  value={kmCategory}
                  onChange={(e) => setKmCategory(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                >
                  <option value="Tambahan Modal Kasir">Tambahan Modal Kasir</option>
                  <option value="Pelunasan Kasbon Member">Pelunasan Kasbon Member</option>
                  <option value="Pendapatan Jasa / Parkir">Pendapatan Jasa / Parkir</option>
                  <option value="Koreksi Selisih Kasir">Koreksi Selisih Kasir</option>
                </select>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">
                  Nominal ({activeCurrency === 'USD' ? 'USD $' : 'IDR Rp'}):
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  placeholder={activeCurrency === 'USD' ? '10' : '50.000'}
                  value={kmAmount}
                  onChange={(e) =>
                    setKmAmount(
                      activeCurrency === 'USD'
                        ? e.target.value.replace(/[^0-9.]/g, '')
                        : formatRibuanInput(e.target.value)
                    )
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">
                  Sumber Dana / Pihak Penyerah:
                </label>
                <input
                  type="text"
                  placeholder="Supervisor / Pelanggan"
                  value={kmSource}
                  onChange={(e) => setKmSource(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Keterangan:</label>
                <input
                  type="text"
                  placeholder="Keterangan tambahan..."
                  value={kmNote}
                  onChange={(e) => setKmNote(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowKasMasukModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 cursor-pointer"
                >
                  Simpan Kas Masuk
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Kas Keluar */}
      {showKasKeluarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <ArrowUpRight className="w-5 h-5 text-rose-400" />
                <h3 className="font-bold text-white text-base">
                  {editingKkId ? 'Edit Kas Keluar Operasional' : 'Catat Kas Keluar Operasional'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowKasKeluarModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddKasKeluar} className="space-y-3 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-zinc-400 font-bold">Kategori Biaya:</label>
                  <button
                    type="button"
                    onClick={() => setShowCategoryModal(true)}
                    className="text-amber-400 hover:text-amber-300 text-[11px] font-bold flex items-center gap-1 transition cursor-pointer"
                    title="Kelola Master Kategori Biaya"
                  >
                    <Plus className="w-3 h-3" />
                    <span>+ Kelola Kategori</span>
                  </button>
                </div>
                <select
                  value={kkCategory}
                  onChange={(e) => setKkCategory(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                >
                  {kasKeluarCategories.map((cat: any) => (
                    <option key={cat.id} value={cat.name}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">
                  Nominal ({activeCurrency === 'USD' ? 'USD $' : 'IDR Rp'}):
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  placeholder={activeCurrency === 'USD' ? '5' : '25.000'}
                  value={kkAmount}
                  onChange={(e) =>
                    setKkAmount(
                      activeCurrency === 'USD'
                        ? e.target.value.replace(/[^0-9.]/g, '')
                        : formatRibuanInput(e.target.value)
                    )
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold focus:outline-none focus:border-rose-500"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Penerima Dana:</label>
                <input
                  type="text"
                  placeholder="Nama toko / kuli / kurir / vendor"
                  value={kkRecipient}
                  onChange={(e) => setKkRecipient(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-zinc-700"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Keterangan Keperluan:</label>
                <input
                  type="text"
                  placeholder="Detail bukti pengeluaran / nota..."
                  value={kkNote}
                  onChange={(e) => setKkNote(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-zinc-700"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowKasKeluarModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold cursor-pointer transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-500 cursor-pointer transition shadow-md"
                >
                  {editingKkId ? 'Simpan Perubahan' : 'Simpan Kas Keluar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Edit Riwayat Shift */}
      {editingShiftHist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-white text-base">
                Edit Riwayat Shift ({editingShiftHist.id})
              </h3>
              <button
                onClick={() => setEditingShiftHist(null)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const updatedActual = Number(editingShiftHist.actualCash ?? editingShiftHist.actual ?? 0);
                const expectedVal = Number(editingShiftHist.expectedCash ?? editingShiftHist.expected ?? 0);
                const newDiff = updatedActual - expectedVal;
                const newAudit = newDiff === 0 ? 'MATCH' : newDiff > 0 ? 'OVER' : 'SHORT';
                const payload = {
                  cashierName: editingShiftHist.cashierName || editingShiftHist.cashier,
                  cashier: editingShiftHist.cashierName || editingShiftHist.cashier,
                  actualCash: updatedActual,
                  actual: updatedActual,
                  difference: newDiff,
                  discrepancy: newDiff,
                  diff: newDiff,
                  auditStatus: newAudit,
                  notes: editingShiftHist.notes || '-',
                  updatedAt: new Date().toISOString(),
                };
                setShiftsDocs((prev) =>
                  prev.map((s) => (s.id === editingShiftHist.id ? { ...s, ...payload } : s))
                );
                setShiftHistoryDocs((prev) =>
                  prev.map((s) => (s.id === editingShiftHist.id ? { ...s, ...payload } : s))
                );
                setEditingShiftHist(null);
                await Promise.all([
                  setDoc(doc(db, 'shifts', editingShiftHist.id), payload, { merge: true }).catch(
                    () => {}
                  ),
                  setDoc(doc(db, 'shift_history', editingShiftHist.id), payload, {
                    merge: true,
                  }).catch(() => {}),
                ]);
              }}
              className="space-y-3 text-xs"
            >
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Kasir Bertugas</label>
                <input
                  type="text"
                  value={editingShiftHist.cashierName || editingShiftHist.cashier || ''}
                  onChange={(e) =>
                    setEditingShiftHist({
                      ...editingShiftHist,
                      cashierName: e.target.value,
                      cashier: e.target.value,
                    })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">
                  Kas Fisik Dihitung (IDR Rp)
                </label>
                <input
                  type="number"
                  value={editingShiftHist.actualCash ?? editingShiftHist.actual ?? 0}
                  onChange={(e) =>
                    setEditingShiftHist({
                      ...editingShiftHist,
                      actualCash: Number(e.target.value),
                      actual: Number(e.target.value),
                    })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Catatan Shift</label>
                <input
                  type="text"
                  value={editingShiftHist.notes || ''}
                  onChange={(e) =>
                    setEditingShiftHist({ ...editingShiftHist, notes: e.target.value })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setEditingShiftHist(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-500 cursor-pointer"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Detail Shift / Transaksi */}
      {detailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-white text-base">{detailModal.title}</h3>
              <button
                onClick={() => setDetailModal(null)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              {Object.entries(detailModal.data).map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between py-1.5 border-b border-zinc-800/60 gap-4"
                >
                  <span className="text-zinc-400">{k}:</span>
                  <span className="font-bold text-white text-right">{String(v)}</span>
                </div>
              ))}
            </div>
            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Cetak</span>
              </button>
              <button
                onClick={() => setDetailModal(null)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Tutup Shift Kasir & Rekonsiliasi Uang Fisik (Z-Report) */}
      {showTutupShiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">
                    Rekonsiliasi &amp; Tutup Shift Kasir
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Kasir: <strong className="text-white">{activeShift.cashierName}</strong> &bull;{' '}
                    {activeShift.totalTransactions} Transaksi ({fmtMoney(activeShift.totalSalesAll, activeCurrency)})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTutupShiftModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Rincian Saldo Kasir Sistem */}
            <div className="space-y-2 text-xs bg-zinc-950 p-4 rounded-xl border border-zinc-800">
              <div className="flex justify-between text-zinc-400">
                <span>Modal Awal Kasir (Float):</span>
                <span className="font-mono text-white font-bold">
                  {fmtMoney(activeShift.startingCash, activeCurrency)}
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Total Penjualan Tunai Laci:</span>
                <span className="font-mono text-emerald-400 font-bold">
                  +{fmtMoney(activeShift.totalSalesCash, activeCurrency)}
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Total Penjualan Non-Tunai / QRIS / Transfer:</span>
                <span className="font-mono text-cyan-400 font-bold">
                  {fmtMoney(activeShift.totalSalesNonCash, activeCurrency)}
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Total Kas Masuk Operasional:</span>
                <span className="font-mono text-emerald-400 font-bold">
                  +{fmtMoney(activeShift.totalKasMasuk, activeCurrency)}
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Total Kas Keluar Operasional:</span>
                <span className="font-mono text-rose-400 font-bold">
                  -{fmtMoney(activeShift.totalKasKeluar, activeCurrency)}
                </span>
              </div>
              <div className="flex justify-between text-white font-bold pt-2 border-t border-zinc-800 text-sm">
                <span>Target Saldo Laci Kasir (Sistem):</span>
                <span className="font-mono text-emerald-400 text-base">
                  {fmtMoney(activeShift.expectedCash, activeCurrency)}
                </span>
              </div>
            </div>

            {/* Form Rekonsiliasi Kas Nyata */}
            <form onSubmit={handleConfirmCloseShift} className="space-y-3 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-zinc-300 font-bold">
                    Hasil Hitungan Uang Fisik Nyata di Laci ({activeCurrency === 'USD' ? 'USD $' : 'IDR Rp'}) *
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setActualCashCount(
                        activeCurrency === 'USD'
                          ? String(Number((activeShift.expectedCash / activeRate).toFixed(2)))
                          : formatRibuanInput(Math.round(activeShift.expectedCash))
                      )
                    }
                    className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 cursor-pointer"
                  >
                    Samakan dengan Target Sistem
                  </button>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={`Contoh: ${
                    activeCurrency === 'USD'
                      ? (activeShift.expectedCash / activeRate).toFixed(2)
                      : formatRibuanInput(Math.round(activeShift.expectedCash))
                  }`}
                  value={actualCashCount}
                  onChange={(e) =>
                    setActualCashCount(
                      activeCurrency === 'USD'
                        ? e.target.value.replace(/[^0-9.]/g, '')
                        : formatRibuanInput(e.target.value)
                    )
                  }
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-base font-black focus:outline-none focus:border-rose-500"
                  autoFocus
                />
              </div>

              {/* Status Selisih Real-Time */}
              {previewActualIdr !== null && (
                <div
                  className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-between ${
                    previewActualIdr === Math.round(activeShift.expectedCash)
                      ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                      : previewActualIdr > Math.round(activeShift.expectedCash)
                      ? 'bg-blue-950/60 border-blue-800 text-blue-300'
                      : 'bg-rose-950/60 border-rose-800 text-rose-300'
                  }`}
                >
                  <span>
                    {previewActualIdr === Math.round(activeShift.expectedCash)
                      ? '✓ Saldo Uang Fisik Sesuai 100% (Balance Sempurna)'
                      : previewActualIdr > Math.round(activeShift.expectedCash)
                      ? '▲ Kelebihan Uang Fisik di Laci (+Over)'
                      : '▼ Kekurangan Uang Fisik di Laci (-Short)'}
                  </span>
                  <span className="font-mono text-sm">
                    {previewActualIdr >= Math.round(activeShift.expectedCash) ? '+' : ''}
                    {fmtMoney(
                      previewActualIdr - Math.round(activeShift.expectedCash),
                      activeCurrency
                    )}
                  </span>
                </div>
              )}

              <div>
                <label className="block text-zinc-400 font-bold mb-1">
                  Catatan / Keterangan Penutupan Shift:
                </label>
                <textarea
                  rows={2}
                  placeholder="Catatan serah terima kasir, selisih uang receh kembalian, dll..."
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-rose-500 resize-none"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowTutupShiftModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    window.print();
                  }}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold flex items-center gap-1.5 cursor-pointer"
                  title="Cetak Saldo Laci Kasir"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Cetak Z-Report</span>
                </button>
                <button
                  type="submit"
                  disabled={isClosingShift}
                  onClick={(e) => {
                    e.preventDefault();
                    void executeCloseShift();
                  }}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white font-bold shadow-lg shadow-rose-900/30 cursor-pointer flex items-center gap-1.5"
                >
                  <Lock className="w-4 h-4" />
                  <span>{isClosingShift ? 'Menyimpan...' : 'Konfirmasi Tutup Shift'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: KELOLA MASTER KATEGORI BIAYA KAS KELUAR */}
      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-base">
                  Kelola Kategori Biaya Kas Keluar
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCategoryModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-zinc-400">
              Kategori yang ditambahkan di sini otomatis muncul pada pilihan dropdown{' '}
              <strong>Modal Catat Kas Keluar Operasional</strong>.
            </p>

            {/* Input Form Tambah Kategori */}
            <form onSubmit={handleAddKasKeluarCategory} className="flex gap-2">
              <input
                type="text"
                required
                placeholder="Nama kategori biaya baru..."
                value={newCategoryInput}
                onChange={(e) => setNewCategoryInput(e.target.value)}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer transition shrink-0 shadow-md"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah</span>
              </button>
            </form>

            {/* Daftar Kategori Aktif */}
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                Daftar Kategori Aktif ({kasKeluarCategories.length})
              </div>
              {kasKeluarCategories.map((cat: any) => (
                <div
                  key={cat.id}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/70 border border-zinc-850 hover:border-zinc-700 transition text-xs"
                >
                  <div className="flex items-center gap-2 text-zinc-200">
                    <Tag className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="font-medium">{cat.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteKasKeluarCategoryDoc(cat.id)}
                    className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition cursor-pointer"
                    title="Hapus Kategori"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-zinc-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowCategoryModal(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold cursor-pointer transition"
              >
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Feedback */}
      {shiftCloseSuccessToast && (
        <div className="fixed top-6 right-6 z-[60] bg-zinc-900 border border-emerald-500 text-emerald-300 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs font-bold animate-in fade-in slide-in-from-top-2">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{shiftCloseSuccessToast}</span>
        </div>
      )}
    </div>
  );
};
