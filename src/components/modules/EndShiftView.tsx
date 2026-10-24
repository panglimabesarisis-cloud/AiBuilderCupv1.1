import React, { useState, useMemo, useEffect } from 'react';
import {
  DollarSign,
  TrendingUp,
  ArrowUpRight,
  Receipt,
  Plus,
  Trash2,
  Lock,
  Unlock,
  CheckCircle,
  AlertTriangle,
  Calendar,
  Clock,
  User,
  ShoppingBag,
  Package,
  Layers,
  ArrowDownRight,
  Printer,
  Search,
  Check,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { getPosSettings, onPosSettings, logAudit } from '../../services/posRuntime';
import { useAppData } from '../../context/AppDataContext';
import { useAccessControl } from '../../context/AccessControlContext';
import { formatRupiah, fmtMoney, toIdr, formatRibuanInput, parseRibuanInput } from '../../utils/money';
import { StaffMemberItem } from './StaffModule';

function getJakartaDateYmd(): string {
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
}

function getJakartaTimeWib(): string {
  try {
    const timeStr = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(new Date())
      .replace(/\./g, ':');
    return `${timeStr} WIB`;
  } catch {
    return `${new Date().toTimeString().slice(0, 8)} WIB`;
  }
}

interface ExpenseItem {
  id: string;
  keterangan: string;
  nominal: number;
  formattedNominal: string;
}

interface EndShiftViewProps {
  currentOpenShiftDoc: any | null;
  shiftsDocs: any[];
  setShiftsDocs: React.Dispatch<React.SetStateAction<any[]>>;
  setShiftHistoryDocs: React.Dispatch<React.SetStateAction<any[]>>;
  staffList: StaffMemberItem[];
  onOpenShiftClick?: () => void;
  onShiftClosed?: () => void;
  onNavigateTab?: (tab: string, sub?: string) => void;
  selectedDate?: string;
  onChangeSelectedDate?: (date: string) => void;
}

/**
 * Format string/number to Indonesian dot thousands separator.
 * e.g. "6000" -> "6.000"
 */
function formatNumberWithDots(val: number | string): string {
  return formatRibuanInput(val);
}

function parseFormattedNumber(val: string | number | undefined | null): number {
  return parseRibuanInput(val ?? '');
}

export const EndShiftView: React.FC<EndShiftViewProps> = ({
  currentOpenShiftDoc,
  shiftsDocs,
  setShiftsDocs,
  setShiftHistoryDocs,
  staffList,
  onOpenShiftClick,
  onShiftClosed,
  onNavigateTab,
  selectedDate: propSelectedDate,
  onChangeSelectedDate,
}) => {
  const { transactions: ctxTransactions, products: ctxProducts } = useAppData();
  const { activeCashier, setActiveCashier, currentUser, lockPosSession } = useAccessControl();
  const navigate = useNavigate();

  // 1. OPEN SHIFT MODAL STATE (If no active open shift)
  const [localShiftClosed, setLocalShiftClosed] = useState(false);
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState(activeCashier?.id || 'staff_001');
  const [sessionName, setSessionName] = useState('Shift Pagi (07:30 - 15:30)');
  const [openFloatFormatted, setOpenFloatFormatted] = useState('');
  const [openShiftDate, setOpenShiftDate] = useState<string>(() => getJakartaDateYmd());
  const [jakartaClock, setJakartaClock] = useState<string>(() => getJakartaTimeWib());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setJakartaClock(getJakartaTimeWib());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loggedInCashierName = useMemo(() => {
    if (activeCashier?.name) return activeCashier.name;
    if (currentUser?.displayName) return currentUser.displayName;
    if (currentUser?.email) return currentUser.email.split('@')[0];
    return 'Muhammad Irfan';
  }, [activeCashier, currentUser]);

  // 2. CASHIER INPUT FORM STATE
  // Uang Laci, Kas Aktual, Bonus, Pemasukan Lain, Catatan Shift
  const [uangLaciInput, setUangLaciInput] = useState<string>('0');
  const [kasAktualInput, setKasAktualInput] = useState<string>('');
  // Pengaturan > Pembayaran: wajib hitung uang fisik per pecahan saat tutup shift
  const [requireCashCount, setRequireCashCount] = useState<boolean>(
    () => getPosSettings().requireCashCountOnShiftClose !== false
  );
  useEffect(() => onPosSettings((st) => setRequireCashCount(st.requireCashCountOnShiftClose !== false)), []);
  const DENOMS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100];
  const [denomCounts, setDenomCounts] = useState<Record<number, string>>({});
  const denomTotal = useMemo(
    () => DENOMS.reduce((sum, d) => sum + d * (parseInt(denomCounts[d] || '0', 10) || 0), 0),
    [denomCounts]
  );
  const [bonusInput, setBonusInput] = useState<string>('');
  const [pemasukanLainInput, setPemasukanLainInput] = useState<string>('');
  const [catatanShift, setCatatanShift] = useState<string>('');

  // 3. PENGELUARAN TOKO (Store Expenses)
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);

  // 4. SUBMISSION & FEEDBACK STATE
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{
    shiftId: string;
    totalPenjualan: number;
    totalModal: number;
    keuntungan: number;
    selisih: number;
    date: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 5. TRANSACTION SEARCH / FILTER & INTERACTIVE SHIFT DATE
  const [txSearch, setTxSearch] = useState('');
  const [internalShiftDate, setInternalShiftDate] = useState<string>(
    () => new Date().toISOString().split('T')[0]
  );
  const [hasUserChangedDate, setHasUserChangedDate] = useState<boolean>(false);

  const selectedShiftDate = propSelectedDate || internalShiftDate;
  const setSelectedShiftDate = (nextDate: string) => {
    setInternalShiftDate(nextDate);
    if (onChangeSelectedDate) {
      onChangeSelectedDate(nextDate);
    }
  };

  // Auto-initialize Uang Laci from active open shift's initial float
  useEffect(() => {
    if (currentOpenShiftDoc) {
      const initial = Number(
        currentOpenShiftDoc.initialFloat ?? currentOpenShiftDoc.startingCash ?? 0
      );
      if (initial > 0) {
        setUangLaciInput(formatNumberWithDots(initial));
      }
    }
  }, [currentOpenShiftDoc]);

  // Derived numeric values from inputs (strictly stripping dot thousands separators)
  const uangLaci = useMemo(() => parseFormattedNumber(uangLaciInput), [uangLaciInput]);
  const kasAktual = useMemo(() => parseFormattedNumber(kasAktualInput), [kasAktualInput]);
  const bonus = useMemo(() => parseFormattedNumber(bonusInput), [bonusInput]);
  const pemasukanLain = useMemo(() => parseFormattedNumber(pemasukanLainInput), [pemasukanLainInput]);

  const uangLaciNum = uangLaci;
  const kasAktualNum = kasAktual;
  const bonusNum = bonus;
  const pemasukanLainNum = pemasukanLain;

  // Sum of Pengeluaran Toko
  const totalPengeluaranToko = useMemo(() => {
    return expenses.reduce(
      (sum, item) => sum + parseFormattedNumber(item.formattedNominal || item.nominal),
      0
    );
  }, [expenses]);

  // AUTO-REVEAL CONDITION:
  // Begitu kolom Kas Aktual sudah diisi angka, sembunyikan peringatan merah,
  // tampilkan semua angka yang sebelumnya hidden, dan aktifkan tombol END SHIFT
  const hasKasAktualInput = useMemo(() => {
    const clean = String(kasAktualInput ?? '').replace(/\./g, '').replace(/[^0-9]/g, '');
    return clean.length > 0;
  }, [kasAktualInput]);

  const isRevealed = useMemo(() => {
    return hasKasAktualInput;
  }, [hasKasAktualInput]);

  useEffect(() => {
    if (hasKasAktualInput && errorMessage) {
      setErrorMessage(null);
    }
  }, [hasKasAktualInput, errorMessage]);

  // Get active shift object
  const activeShift = useMemo(() => {
    if (localShiftClosed || !currentOpenShiftDoc) return null;
    const statusStr = String(currentOpenShiftDoc.status || '').toLowerCase();
    if (statusStr === 'closed' || statusStr === 'selesai') return null;
    return {
      id: currentOpenShiftDoc.id,
      cashierName: currentOpenShiftDoc.cashierName || activeCashier?.name || 'Kasir Toko',
      cashierId: currentOpenShiftDoc.cashierId || activeCashier?.id || 'staff_001',
      session: currentOpenShiftDoc.session || 'Shift Reguler',
      outlet: currentOpenShiftDoc.outlet || 'RiskCart Flagship Store',
      openedAt: currentOpenShiftDoc.openedAt || new Date().toISOString(),
      openedAtDisplay:
        currentOpenShiftDoc.openedAtDisplay ||
        new Date(currentOpenShiftDoc.openedAt || Date.now()).toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      initialFloat: Number(currentOpenShiftDoc.initialFloat ?? currentOpenShiftDoc.startingCash ?? 0),
    };
  }, [currentOpenShiftDoc, activeCashier, localShiftClosed]);

  // Filter transactions belonging to current shift or selected date
  const shiftTransactions = useMemo(() => {
    if (!activeShift) return [];
    const openTimeMs = new Date(activeShift.openedAt).getTime();
    const todayIso = new Date().toISOString().split('T')[0];

    const validTxs = ctxTransactions.filter(
      (tx) => tx.status !== 'rejected' && tx.status !== 'cancelled' && tx.status !== 'void'
    );

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

    if (hasUserChangedDate || (selectedShiftDate && selectedShiftDate !== todayIso)) {
      return validTxs.filter((tx) => matchesTargetDate(tx, selectedShiftDate));
    }

    const matched = validTxs.filter((tx) => {
      if (matchesTargetDate(tx, selectedShiftDate)) return true;
      if (tx.shiftId && tx.shiftId === activeShift.id) return true;
      const txMs = new Date(tx.createdAt || 0).getTime();
      if (!isNaN(openTimeMs) && openTimeMs > 0 && txMs >= openTimeMs) return true;
      return false;
    });

    // Fallback: if matched empty, show today's valid transactions
    return matched.length > 0 ? matched : validTxs;
  }, [ctxTransactions, activeShift, selectedShiftDate, hasUserChangedDate]);

  // REAL-TIME FINANCIAL METRICS FOR ACTIVE SHIFT
  // 1. Total Penjualan (Turnover POS + PWA)
  const totalPenjualan = useMemo(() => {
    return shiftTransactions.reduce((acc, tx: any) => {
      const val = Number(tx.totalAmount ?? tx.totalRevenue ?? tx.subtotal ?? 0);
      return acc + val;
    }, 0);
  }, [shiftTransactions]);

  // 2. Total Modal Penjualan (Accumulated HPP of goods sold)
  const totalModalPenjualan = useMemo(() => {
    return shiftTransactions.reduce((acc, tx: any) => {
      let txCost = Number(tx.totalCost ?? tx.totalHpp ?? 0);
      if (txCost <= 0 && Array.isArray(tx.items) && tx.items.length > 0) {
        txCost = tx.items.reduce((sum: number, it: any) => {
          const matchedProd = ctxProducts.find(
            (p) => p.id === it.productId || p.sku === it.sku || p.name === it.name
          );
          const unitCost = Number(
            it.costPrice || it.cost || it.modal || matchedProd?.costPrice || matchedProd?.costPerUnit || 0
          );
          const qty = Number(it.quantityOrdered || it.quantity || it.qty || 1);
          return sum + unitCost * qty;
        }, 0);
      }
      return acc + txCost;
    }, 0);
  }, [shiftTransactions, ctxProducts]);

  // 3. Total Pengeluaran (from Pengeluaran Toko list)
  const totalPengeluaran = totalPengeluaranToko;

  // 4. KEUNTUNGAN (Bersih Shift):
  // Formula wajib: keuntungan = (totalPenjualan - totalModalPenjualan) + pemasukanLain - totalPengeluaran + bonus
  const keuntungan = useMemo(() => {
    return (totalPenjualan - totalModalPenjualan) + pemasukanLain - totalPengeluaran + bonus;
  }, [totalPenjualan, totalModalPenjualan, pemasukanLain, totalPengeluaran, bonus]);
  const keuntunganBersih = keuntungan;

  // Target Kas Sistem & Selisih (Tanpa menambahkan Uang Laci ke Target Kas Sistem)
  // Formula wajib: targetKasSistem = (totalPenjualan - totalPengeluaran) + bonus + pemasukanLain
  const targetKasSistem = useMemo(() => {
    return (totalPenjualan - totalPengeluaran) + bonus + pemasukanLain;
  }, [totalPenjualan, totalPengeluaran, bonus, pemasukanLain]);

  // Formula wajib: selisih = kasAktual - targetKasSistem
  const selisih = useMemo(() => {
    return kasAktual - targetKasSistem;
  }, [kasAktual, targetKasSistem]);

  // Hourly Chart Data (00:00 - 23:00) with 4 real-time curves
  const hourlyChartData = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, i) => {
      const hStr = String(i).padStart(2, '0');
      return {
        jam: `${hStr}:00`,
        hourNum: i,
        penjualan: 0,
        modal: 0,
        pengeluaran: 0,
        keuntungan: 0,
      };
    });

    // Populate from shiftTransactions
    shiftTransactions.forEach((tx: any) => {
      const date = tx.createdAt ? new Date(tx.createdAt) : null;
      if (!date || isNaN(date.getTime())) return;
      const h = date.getHours();
      if (h >= 0 && h < 24) {
        const val = Number(tx.totalAmount ?? tx.totalRevenue ?? tx.subtotal ?? 0);
        let cost = Number(tx.totalCost ?? tx.totalHpp ?? 0);
        if (cost <= 0 && Array.isArray(tx.items)) {
          cost = tx.items.reduce((s: number, it: any) => {
            const prod = ctxProducts.find((p) => p.id === it.productId || p.sku === it.sku);
            const uCost = Number(it.costPrice || it.cost || prod?.costPrice || 0);
            return s + uCost * Number(it.quantity || it.qty || 1);
          }, 0);
        }
        hours[h].penjualan += val;
        hours[h].modal += cost;
      }
    });

    // Attribute expenses roughly to current hour if any
    const currentHour = new Date().getHours();
    if (totalPengeluaran > 0 && currentHour >= 0 && currentHour < 24) {
      hours[currentHour].pengeluaran += totalPengeluaran;
    }

    // Calculate hourly keuntungan
    hours.forEach((h) => {
      h.keuntungan = h.penjualan - h.modal - h.pengeluaran;
    });

    return hours;
  }, [shiftTransactions, ctxProducts, totalPengeluaran]);

  // Filtered transactions for the bottom table
  const filteredTransactions = useMemo(() => {
    const q = txSearch.trim().toLowerCase();
    if (!q) return shiftTransactions;
    return shiftTransactions.filter((tx: any) => {
      const nota = String(tx.orderNumber || tx.id || '').toLowerCase();
      const cust = String(tx.customerName || '').toLowerCase();
      const totalStr = String(tx.totalAmount || tx.totalRevenue || '');
      return nota.includes(q) || cust.includes(q) || totalStr.includes(q);
    });
  }, [shiftTransactions, txSearch]);

  // ADD EXPENSE ROW
  const handleAddExpenseRow = () => {
    const newRow: ExpenseItem = {
      id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      keterangan: '',
      nominal: 0,
      formattedNominal: '',
    };
    setExpenses((prev) => [...prev, newRow]);
  };

  const handleUpdateExpenseKeterangan = (id: string, text: string) => {
    setExpenses((prev) =>
      prev.map((item) => (item.id === id ? { ...item, keterangan: text } : item))
    );
  };

  const handleUpdateExpenseNominal = (id: string, formattedText: string) => {
    const num = parseFormattedNumber(formattedText);
    setExpenses((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              nominal: num,
              formattedNominal: formatNumberWithDots(num),
            }
          : item
      )
    );
  };

  const handleDeleteExpenseRow = (id: string) => {
    setExpenses((prev) => prev.filter((item) => item.id !== id));
  };

  // OPEN SHIFT SUBMISSION
  const handleExecuteOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openFloatFormatted.trim()) return;
    const floatNum = parseFormattedNumber(openFloatFormatted);
    const chosenDate = openShiftDate || getJakartaDateYmd();
    const currentJamWib = getJakartaTimeWib();
    const staff: any =
      staffList.find((s) => s.id === selectedStaffId) || {
        id: activeCashier?.id || selectedStaffId || 'staff_001',
        name: loggedInCashierName,
        role: activeCashier?.role || 'Cashier',
        outlet: activeCashier?.outlet || 'RiskCart Flagship Store (Pusat)',
        shift: sessionName,
        email: activeCashier?.email || 'irfan.kasir@riskcart.com',
        phone: activeCashier?.phone || '-',
      };

    const cashierDisplayName = loggedInCashierName || staff.name;

    setActiveCashier({
      id: staff.id || 'staff_001',
      name: cashierDisplayName,
      email: staff.email || '',
      role: staff.role || 'Cashier',
      outlet: staff.outlet || 'Cabang Utama (Pusat)',
      phone: staff.phone || '-',
      shift: sessionName,
    });

    const nowIso = new Date().toISOString();
    const todayKey = chosenDate.replace(/-/g, '');
    const newShiftId = `SHF-${todayKey}-${String(shiftsDocs.length + 1).padStart(2, '0')}`;

    const shiftPayload = {
      id: newShiftId,
      status: 'open',
      tanggal: chosenDate,
      shiftDate: chosenDate,
      jamBuka: currentJamWib,
      openedAt: nowIso,
      openedAtDisplay: `${chosenDate} • ${currentJamWib}`,
      uangLaci: floatNum,
      initialFloat: floatNum,
      startingCash: floatNum,
      cashierId: staff.id || 'staff_001',
      cashierName: cashierDisplayName,
      cashier: cashierDisplayName,
      cashierRole: staff.role || 'Cashier',
      outlet: staff.outlet || 'RiskCart Flagship Store (Pusat)',
      session: sessionName,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setLocalShiftClosed(false);
    try {
      sessionStorage.setItem('riskcart_shift_opened_session', 'true');
      localStorage.setItem('riskcart_active_shift', JSON.stringify(shiftPayload));
      localStorage.setItem('riskcart_active_open_shift', JSON.stringify(shiftPayload));
      window.dispatchEvent(new Event('shift-status-changed'));
      window.dispatchEvent(new CustomEvent('riskcart:shift-opened', { detail: shiftPayload }));
      window.dispatchEvent(new Event('riskcart:shift-updated'));
    } catch {}

    setShiftsDocs((prev) => [shiftPayload, ...prev.filter((s) => s.id !== newShiftId)]);
    setShowOpenModal(false);
    setUangLaciInput(formatNumberWithDots(floatNum));

    try {
      const openSavePromises: Promise<any>[] = [
        setDoc(doc(db, 'shifts', newShiftId), shiftPayload, { merge: true }),
      ];
      if (floatNum > 0) {
        const depLaciId = `dep_toko_${newShiftId}_laci`;
        openSavePromises.push(
          setDoc(
            doc(db, 'safe_deposits', depLaciId),
            {
              id: depLaciId,
              tanggal: chosenDate,
              jam: currentJamWib,
              date: `${chosenDate}, ${currentJamWib}`,
              createdAt: nowIso,
              type: 'SETORAN_BRANKAS',
              sourceType: 'UANG_LACI',
              jenisJurnal: 'Uang Laci',
              from: 'Uang Laci',
              to: 'Brangkas Toko',
              vault: 'brangkas-toko',
              amount: floatNum,
              flowType: 'Kas Masuk',
              note: `Setoran Uang Laci (Modal Awal Kasir) Shift #${newShiftId} (${cashierDisplayName})`,
              actor: cashierDisplayName,
              staff: cashierDisplayName,
              shiftId: newShiftId,
            },
            { merge: true }
          )
        );
      }
      await Promise.all(openSavePromises);
    } catch (err) {
      console.warn('Error saving open shift:', err);
    }
  };

  // EXECUTE END SHIFT
  const handleExecuteEndShift = async () => {
    if (!activeShift) {
      setErrorMessage('Sesi shift belum aktif. Silakan buka shift terlebih dahulu.');
      return;
    }

    if (requireCashCount && denomTotal <= 0) {
      setErrorMessage('⚠️ Wajib menghitung uang fisik per pecahan (Pengaturan POS > Pembayaran).');
      return;
    }
    if (!hasKasAktualInput) {
      setErrorMessage('⚠️ Harap isi kolom Kas Aktual dengan nominal uang fisik laci kasir');
      return;
    }

    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    const shiftId = activeShift.id;
    const idempotencyKey = `shift_close_${shiftId}_${selectedShiftDate}`;
    const nowIso = new Date().toISOString();
    const chosenDateIso = selectedShiftDate || nowIso.split('T')[0];
    const parsedChosenDate = new Date(`${chosenDateIso}T12:00:00`);
    const todayDateStr = !isNaN(parsedChosenDate.getTime())
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
    const nowJam = `${new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })} WIB`;

    void logAudit({
      action: 'SHIFT_CLOSE',
      target: `Tutup shift ${shiftId} — kas aktual Rp ${kasAktualNum.toLocaleString('id-ID')}`,
    });
    const closedRecord = {
      cashDenominations: requireCashCount
        ? Object.fromEntries(DENOMS.map((d) => [String(d), parseInt(denomCounts[d] || '0', 10) || 0]))
        : null,
      id: shiftId,
      status: 'closed',
      idempotencyKey,
      date: todayDateStr,
      tanggal: chosenDateIso,
      shiftDate: chosenDateIso,
      openedAt: activeShift.openedAt,
      openedAtDisplay: activeShift.openedAtDisplay,
      closedAt: nowIso,
      closedAtDisplay: `${todayDateStr} ${nowJam}`,
      session: activeShift.session,
      shift: activeShift.session,
      cashierId: activeShift.cashierId,
      cashierName: activeShift.cashierName,
      cashier: activeShift.cashierName,
      outlet: activeShift.outlet,
      uangLaci: uangLaciNum,
      initialFloat: uangLaciNum,
      startingCash: uangLaciNum,
      totalPenjualan,
      totalSales: totalPenjualan,
      totalModalPenjualan,
      totalHpp: totalModalPenjualan,
      totalPengeluaran,
      totalKasKeluar: totalPengeluaran,
      bonus: bonusNum,
      pemasukanLain: pemasukanLainNum,
      totalKasMasuk: bonusNum + pemasukanLainNum,
      keuntungan,
      keuntunganBersih,
      targetKasSistem,
      expectedCash: targetKasSistem,
      targetCash: targetKasSistem,
      expected: targetKasSistem,
      kasAktual: kasAktualNum,
      actualCash: kasAktualNum,
      actual: kasAktualNum,
      selisih,
      difference: selisih,
      discrepancy: selisih,
      diff: selisih,
      auditStatus: selisih === 0 ? 'MATCH' : selisih > 0 ? 'OVER' : 'SHORT',
      catatanShift: catatanShift.trim() || `Tutup shift kasir (${chosenDateIso}) via END SHIFT`,
      expenses: expenses.map((e) => ({
        keterangan: e.keterangan,
        nominal: e.nominal,
      })),
      totalTransactions: shiftTransactions.length,
      createdAt: activeShift.openedAt || nowIso,
      updatedAt: nowIso,
    };

    try {
      // 1. UPDATE `shifts` (including any other open/Aktif shifts) & `shift_history` in Firestore
      const otherOpenShifts = shiftsDocs.filter(
        (s) =>
          s.id &&
          s.id !== shiftId &&
          (String(s.status || '').toLowerCase() === 'open' ||
            String(s.status || '').toLowerCase() === 'aktif')
      );
      await Promise.all([
        setDoc(doc(db, 'shifts', shiftId), closedRecord, { merge: true }),
        setDoc(doc(db, 'shift_history', shiftId), closedRecord, { merge: true }),
        ...otherOpenShifts.map((s) =>
          setDoc(
            doc(db, 'shifts', s.id),
            {
              ...s,
              status: 'closed',
              closedAt: nowIso,
              closedAtDisplay: `${todayDateStr} ${nowJam}`,
              updatedAt: nowIso,
            },
            { merge: true }
          )
        ),
      ]);

      // 2. AUTO-SPLIT TO ALL VAULTS (`safe_deposits` collection)
      // A1. Ke Brangkas Toko (Kas Masuk dari Uang Laci / Modal Kasir)
      const depLaciId = `dep_toko_${shiftId}_laci`;
      const depLaciPromise =
        uangLaciNum > 0
          ? setDoc(
              doc(db, 'safe_deposits', depLaciId),
              {
                id: depLaciId,
                tanggal: chosenDateIso,
                jam: nowJam,
                date: `${todayDateStr}, ${nowJam}`,
                createdAt: activeShift.openedAt || nowIso,
                type: 'SETORAN_BRANKAS',
                sourceType: 'UANG_LACI',
                jenisJurnal: 'Uang Laci',
                from: 'Uang Laci',
                to: 'Brangkas Toko',
                vault: 'brangkas-toko',
                amount: uangLaciNum,
                flowType: 'Kas Masuk',
                note: `Setoran Uang Laci Shift #${shiftId} (${activeShift.cashierName}) [${chosenDateIso}]`,
                actor: activeShift.cashierName,
                staff: activeShift.cashierName,
                shiftId,
                idempotencyKey: `${idempotencyKey}_toko_laci`,
              },
              { merge: true }
            )
          : Promise.resolve();

      // A2. Ke Brangkas Toko (Kas Masuk dari Hasil Transaksi Penjualan Shift)
      const depTokoInId = `dep_toko_${shiftId}_in`;
      const depTokoInPayload = {
        id: depTokoInId,
        tanggal: chosenDateIso,
        jam: nowJam,
        date: `${todayDateStr}, ${nowJam}`,
        createdAt: nowIso,
        type: 'SETORAN_BRANKAS',
        sourceType: 'SHIFT_SALES',
        jenisJurnal: 'Transaksi Penjualan',
        from: 'Hasil Penjualan',
        to: 'Brangkas Toko',
        vault: 'brangkas-toko',
        amount: totalPenjualan + pemasukanLainNum + bonusNum,
        flowType: 'Kas Masuk',
        note: `Setoran Hasil Penjualan Shift #${shiftId} (${activeShift.cashierName}) [${chosenDateIso}]`,
        actor: activeShift.cashierName,
        staff: activeShift.cashierName,
        shiftId,
        idempotencyKey: `${idempotencyKey}_toko_in`,
      };

      // B. Ke Brangkas Toko: Baris Kas Keluar untuk setiap rincian Pengeluaran Toko
      const expenseDepositPromises = expenses
        .filter((exp) => Number(exp.nominal || 0) > 0)
        .map((exp, idx) => {
          const expId = `dep_toko_${shiftId}_out_${idx + 1}`;
          return setDoc(
            doc(db, 'safe_deposits', expId),
            {
              id: expId,
              tanggal: chosenDateIso,
              jam: nowJam,
              date: `${todayDateStr}, ${nowJam}`,
              createdAt: nowIso,
              type: 'OPERASIONAL',
              sourceType: 'SHIFT_EXPENSE',
              jenisJurnal: exp.keterangan || 'Pengeluaran Shift / Kas Keluar',
              from: 'Brangkas Toko',
              to: 'Pengeluaran Toko / Kas Keluar',
              vault: 'brangkas-toko',
              amount: exp.nominal,
              flowType: 'Kas Keluar',
              note: exp.keterangan || `Pengeluaran Toko Shift #${shiftId} (${chosenDateIso})`,
              actor: activeShift.cashierName,
              staff: activeShift.cashierName,
              shiftId,
              idempotencyKey: `${idempotencyKey}_exp_${idx + 1}`,
            },
            { merge: true }
          );
        });

      // C. Ke Brangkas Modal (Kas Masuk sebesar Total Modal Penjualan HPP)
      const depModalId = `dep_modal_${shiftId}`;
      const depModalPayload = {
        id: depModalId,
        tanggal: chosenDateIso,
        jam: nowJam,
        date: `${todayDateStr}, ${nowJam}`,
        createdAt: nowIso,
        type: 'Kas Masuk',
        jenisJurnal: 'Modal Penjualan',
        from: 'Hasil Penjualan',
        to: 'Brangkas Modal',
        vault: 'brangkas-modal',
        amount: totalModalPenjualan,
        flowType: 'Kas Masuk',
        note: `Alokasi HPP Modal Penjualan Shift #${shiftId} (${chosenDateIso})`,
        actor: activeShift.cashierName,
        staff: activeShift.cashierName,
        shiftId,
        idempotencyKey: `${idempotencyKey}_modal`,
      };

      // D. Ke Brangkas Untung (Kas Masuk sebesar KEUNTUNGAN Bersih)
      const depUntungId = `dep_untung_${shiftId}`;
      const depUntungPayload = {
        id: depUntungId,
        tanggal: chosenDateIso,
        jam: nowJam,
        date: `${todayDateStr}, ${nowJam}`,
        createdAt: nowIso,
        type: 'Kas Masuk',
        jenisJurnal: 'Keuntungan Penjualan',
        from: 'Hasil Penjualan',
        to: 'Brangkas Untung',
        vault: 'brangkas-untung',
        amount: Math.max(0, keuntunganBersih),
        flowType: 'Kas Masuk',
        note: `Alokasi Laba Bersih Penjualan Shift #${shiftId} (${chosenDateIso})`,
        actor: activeShift.cashierName,
        staff: activeShift.cashierName,
        shiftId,
        idempotencyKey: `${idempotencyKey}_untung`,
      };

      // Write all deposits to Firestore concurrently
      await Promise.all([
        depLaciPromise,
        setDoc(doc(db, 'safe_deposits', depTokoInId), depTokoInPayload, { merge: true }),
        ...expenseDepositPromises,
        setDoc(doc(db, 'safe_deposits', depModalId), depModalPayload, { merge: true }),
        setDoc(doc(db, 'safe_deposits', depUntungId), depUntungPayload, { merge: true }),
      ]);

      // 3. Clear all active shift & PIN caches in localStorage / sessionStorage and notify globally
      setLocalShiftClosed(true);
      if (onShiftClosed) {
        onShiftClosed();
      }
      try {
        localStorage.removeItem('riskcart_active_shift');
        localStorage.removeItem('riskcart_active_open_shift');
        localStorage.removeItem('activeShift');
        sessionStorage.removeItem('riskcart_shift_opened_session');
        sessionStorage.removeItem('riskcart_pos_pin_verified');
        lockPosSession();
        window.dispatchEvent(new Event('shift-status-changed'));
        window.dispatchEvent(new CustomEvent('riskcart:shift-closed'));
        window.dispatchEvent(new Event('riskcart:shift-updated'));
      } catch {}

      setShiftsDocs((prev) =>
        [
          closedRecord,
          ...prev
            .filter((s) => s.id !== shiftId)
            .map((s) =>
              String(s.status || '').toLowerCase() === 'open' ||
              String(s.status || '').toLowerCase() === 'aktif'
                ? { ...s, status: 'closed', closedAt: nowIso, updatedAt: nowIso }
                : s
            ),
        ]
      );
      setShiftHistoryDocs((prev) => [closedRecord, ...prev.filter((s) => s.id !== shiftId)]);

      // 4. Redirect immediately to /dashboard/shift/riwayat so End Shift page never re-appears
      if (onNavigateTab) {
        onNavigateTab('module_shift', 'riwayat_shit');
      }
      navigate('/dashboard/shift/riwayat', { replace: true });
    } catch (err: any) {
      console.error('Error executing END SHIFT:', err);
      setErrorMessage(`Gagal menutup shift: ${err?.message || 'Kesalahan jaringan Firestore'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Today formatted string for Auto setting today
  const todayFormatted = useMemo(() => {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }, []);

  // RENDER: If shift is NOT open yet (or has been closed), show Shift Telah Ditutup / Mulai Shift Baru screen
  if (!activeShift || localShiftClosed) {
    return (
      <div className="space-y-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center max-w-2xl mx-auto space-y-6 shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto shadow-inner">
            <Lock className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-black text-white">Shift Telah Ditutup / Belum Ada Shift Aktif</h2>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Sesi shift sebelumnya telah ditutup. Untuk melakukan transaksi kembali, silakan klik <strong>Mulai Shift Baru</strong> di Mesin Kasir POS atau lihat rekapan di <strong>Riwayat Shift</strong>.
            </p>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.removeItem('riskcart_pos_pin_verified');
                  lockPosSession();
                } catch {}
                navigate('/dashboard/pos');
              }}
              className="px-6 py-3.5 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-600 hover:from-amber-300 hover:to-yellow-500 text-zinc-950 font-black text-sm shadow-lg shadow-amber-500/30 transition flex items-center gap-2 cursor-pointer"
            >
              <Unlock className="w-4 h-4" />
              <span>Mulai Shift Baru (Buka POS)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (onNavigateTab) onNavigateTab('module_shift', 'riwayat_shit');
                navigate('/dashboard/shift/riwayat', { replace: true });
              }}
              className="px-5 py-3.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-bold text-sm transition cursor-pointer"
            >
              Lihat Riwayat Shift
            </button>
          </div>
        </div>

        {/* Modal Buka Shift Standalone */}
        {showOpenModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md space-y-5 shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Unlock className="w-5 h-5 text-emerald-400" />
                  <span>Buka Sesi Shift Kasir</span>
                </h3>
                <button
                  onClick={() => setShowOpenModal(false)}
                  className="text-zinc-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleExecuteOpenShift} className="space-y-4 text-xs">
                {/* 1. Nama (Otomatis & Disable) */}
                <div>
                  <label className="block text-zinc-300 font-semibold mb-1">
                    1. Nama Kasir / Staf
                  </label>
                  <input
                    type="text"
                    value={loggedInCashierName}
                    disabled={true}
                    readOnly
                    className="w-full bg-zinc-950/80 border border-zinc-700/80 rounded-xl px-3 py-2 text-amber-300 text-xs font-bold opacity-85 cursor-not-allowed"
                  />
                </div>

                {/* 2. Tanggal (Default Today Jakarta) */}
                <div>
                  <label className="block text-zinc-300 font-semibold mb-1">
                    2. Tanggal Shift (WIB)
                  </label>
                  <input
                    type="date"
                    value={openShiftDate}
                    onChange={(e) => setOpenShiftDate(e.target.value || getJakartaDateYmd())}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-white text-xs font-mono font-bold focus:outline-none focus:border-emerald-500 [color-scheme:dark]"
                  />
                </div>

                {/* 3. Jam (Waktu Jakarta WIB, Disable) */}
                <div>
                  <label className="block text-zinc-300 font-semibold mb-1">
                    3. Jam Mulai Shift (Waktu Jakarta)
                  </label>
                  <input
                    type="text"
                    value={jakartaClock}
                    disabled={true}
                    readOnly
                    className="w-full bg-zinc-950/80 border border-zinc-700/80 rounded-xl px-3 py-2 text-emerald-400 text-xs font-mono font-bold opacity-85 cursor-not-allowed"
                  />
                </div>

                {/* 4. Uang Laci (Wajib Isi & Format Titik Ribuan Otomatis) */}
                <div>
                  <label className="block text-zinc-300 font-semibold mb-1">
                    4. Uang Laci (Modal Awal Kasir) <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-zinc-400 font-bold">Rp</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      required
                      value={openFloatFormatted}
                      onChange={(e) => setOpenFloatFormatted(formatRibuanInput(e.target.value))}
                      placeholder="Contoh: 200.000"
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-xl pl-9 pr-3 py-2 text-white text-sm font-mono font-bold focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="pt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowOpenModal(false)}
                    className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 hover:text-white font-bold transition"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>Mulai Shift</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // RENDER: ACTIVE SHIFT MAIN "END SHIFT" INTERFACE
  return (
    <div className="space-y-6">
      {/* SHIFT STATUS BANNER */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-400 flex items-center justify-center shadow-inner">
            <Unlock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                SHIFT BERJALAN (OPEN)
              </span>
              <span className="text-zinc-400 text-xs font-mono">{activeShift.id}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <h3 className="font-black text-white text-base">{activeShift.cashierName}</h3>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold">
                {activeShift.session}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Dibuka: {activeShift.openedAtDisplay} &bull; Modal Laci:{' '}
              <span className="text-white font-mono font-bold">
                {formatRupiah(uangLaciNum)}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigateTab && onNavigateTab('pos_machine')}
            className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold transition border border-zinc-700 cursor-pointer flex items-center gap-1.5"
          >
            <ShoppingBag className="w-3.5 h-3.5 text-blue-400" />
            <span>Mesin Kasir POS</span>
          </button>
        </div>
      </div>

      {/* 1. 4 KARTU RINGKASAN ATAS (REAL-TIME UPDATE SETIAP ADA TRANSAKSI) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Kartu 1: Total Penjualan */}
        <div className="bg-zinc-900 border border-blue-900/40 rounded-2xl p-5 relative overflow-hidden shadow-sm">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-bold uppercase tracking-wider text-blue-400">
              Total Penjualan
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black font-mono text-white tracking-tight">
              {formatRupiah(totalPenjualan)}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              Akumulasi omzet transaksi POS &amp; PWA shift aktif
            </p>
          </div>
        </div>

        {/* Kartu 2: Total Modal (HPP) */}
        <div className="bg-zinc-900 border border-purple-900/40 rounded-2xl p-5 relative overflow-hidden shadow-sm">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-bold uppercase tracking-wider text-purple-400">
              Total Modal
            </span>
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black font-mono text-white tracking-tight">
              {formatRupiah(totalModalPenjualan)}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              Akumulasi HPP barang terjual pada shift ini
            </p>
          </div>
        </div>

        {/* Kartu 3: Total Pengeluaran */}
        <div className="bg-zinc-900 border border-rose-900/40 rounded-2xl p-5 relative overflow-hidden shadow-sm">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-bold uppercase tracking-wider text-rose-400">
              Total Pengeluaran
            </span>
            <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black font-mono text-white tracking-tight">
              {formatRupiah(totalPengeluaran)}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              Akumulasi pengeluaran toko dari laci kasir
            </p>
          </div>
        </div>

        {/* Kartu 4: Total Keuntungan */}
        <div className="bg-zinc-900 border border-emerald-900/40 rounded-2xl p-5 relative overflow-hidden shadow-sm">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-bold uppercase tracking-wider text-emerald-400">
              Total Keuntungan
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black font-mono text-emerald-400 tracking-tight">
              {formatRupiah(keuntunganBersih)}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              (Penjualan - Modal) - Pengeluaran + Lain
            </p>
          </div>
        </div>
      </div>

      {/* 2. AREA CHART LINE BERDASARKAN JAM (4 GARIS REAL-TIME: 00:00 - 23:00) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-amber-400" />
              <span>Penjualan (Area Chart Line Berdasarkan Jam Operasional Shift: 00:00 - 23:00)</span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Perbandingan 4 kurva real-time: Total Penjualan vs Total Modal vs Total Pengeluaran vs Total Keuntungan
            </p>
          </div>
        </div>

        <div className="h-72 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={hourlyChartData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="colorPenjualan" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorModal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorPengeluaran" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorKeuntungan" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="jam" stroke="#71717a" fontSize={10} tickLine={false} />
              <YAxis
                stroke="#71717a"
                fontSize={10}
                tickLine={false}
                tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toLocaleString('id-ID')}k` : v)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  borderColor: '#3f3f46',
                  borderRadius: '0.75rem',
                  fontSize: '11px',
                  color: '#fff',
                }}
                formatter={(value: any, name: any) => [formatRupiah(Number(value) || 0), name]}
              />
              <Legend
                verticalAlign="top"
                height={36}
                wrapperStyle={{ fontSize: '11px', color: '#a1a1aa' }}
              />
              <Area
                type="monotone"
                dataKey="penjualan"
                name="Total Penjualan"
                stroke="#3b82f6"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorPenjualan)"
              />
              <Area
                type="monotone"
                dataKey="modal"
                name="Total Modal"
                stroke="#8b5cf6"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorModal)"
              />
              <Area
                type="monotone"
                dataKey="pengeluaran"
                name="Total Pengeluaran"
                stroke="#f43f5e"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorPengeluaran)"
              />
              <Area
                type="monotone"
                dataKey="keuntungan"
                name="Total Keuntungan"
                stroke="#10b981"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorKeuntungan)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 3. BOX "REKAPAN PENJUALAN HARIAN" (BLIND COUNT & AUTO-REVEAL LOGIC) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-6 shadow-md">
        <div>
          <h2 className="text-lg font-black text-white tracking-wide">
            Rekapan Penjualan Harian
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Data otomatis dihitung sistem; kolom input diisi kasir sebelum tutup shift.
          </p>
        </div>

        {/* A. BARIS "DATA OTOMATIS SISTEM" (4 KOLOM READ-ONLY) */}
        <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-4 space-y-3">
          <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
            DATA OTOMATIS SISTEM
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            {/* 1. Tanggal (Interactive Calendar Field) */}
            <div>
              <label
                htmlFor="endshift-date-input"
                className="block text-zinc-400 text-[11px] mb-1 font-medium"
              >
                Tanggal
              </label>
              <div className="relative">
                <input
                  id="endshift-date-input"
                  type="date"
                  value={selectedShiftDate}
                  onChange={(e) => {
                    const nextDate = e.target.value || new Date().toISOString().split('T')[0];
                    setSelectedShiftDate(nextDate);
                    setHasUserChangedDate(true);
                  }}
                  onClick={(e) => {
                    try {
                      (e.currentTarget as any).showPicker?.();
                    } catch {
                      // Ignore if showPicker is not supported by browser
                    }
                  }}
                  className="w-full bg-zinc-900 border border-zinc-700 hover:border-amber-500/60 focus:border-amber-400 rounded-xl px-3.5 py-2 font-mono font-bold text-white text-xs focus:outline-none cursor-pointer transition [color-scheme:dark]"
                />
              </div>
            </div>

            {/* 2. Total Modal Penjualan (HIDDEN NOMINAL BEFORE INPUT) */}
            <div>
              <span className="block text-zinc-400 text-[11px] mb-1 font-medium">Total Modal Penjualan</span>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2 font-mono font-bold text-white flex items-center justify-between">
                <span>{isRevealed ? formatRupiah(totalModalPenjualan) : 'Rp'}</span>
                {!isRevealed && (
                  <span className="text-[10px] text-zinc-500 font-sans italic font-normal">
                    (Tersembunyi)
                  </span>
                )}
              </div>
            </div>

            {/* 3. Total Penjualan (HIDDEN NOMINAL BEFORE INPUT) */}
            <div>
              <span className="block text-zinc-400 text-[11px] mb-1 font-medium">Total Penjualan</span>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2 font-mono font-bold text-white flex items-center justify-between">
                <span>{isRevealed ? formatRupiah(totalPenjualan) : 'Rp'}</span>
                {!isRevealed && (
                  <span className="text-[10px] text-zinc-500 font-sans italic font-normal">
                    (Tersembunyi)
                  </span>
                )}
              </div>
            </div>

            {/* 4. Total Pengeluaran */}
            <div>
              <span className="block text-zinc-400 text-[11px] mb-1 font-medium">Total Pengeluaran</span>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2 font-mono font-bold text-white flex items-center justify-between">
                <span>{isRevealed ? formatRupiah(totalPengeluaran) : 'Rp'}</span>
                {!isRevealed && (
                  <span className="text-[10px] text-zinc-500 font-sans italic font-normal">
                    (Tersembunyi)
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* B. BARIS "INPUT KASIR" & "Catatan Shift" (WAJIB TEXT-WHITE) */}
        <div className="space-y-4">
          <div className="text-sm font-bold text-white uppercase tracking-wider">
            INPUT KASIR
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            {/* Input 1: Uang Laci */}
            <div>
              <label className="block text-white font-bold mb-1.5 text-xs">
                Uang Laci
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-zinc-400 font-bold font-mono">Rp</span>
                <input
                  type="text"
                  value={uangLaciInput}
                  onChange={(e) => setUangLaciInput(formatNumberWithDots(e.target.value))}
                  placeholder="0"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl pl-9 pr-3 py-2 text-white font-mono font-bold text-sm focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>

            {requireCashCount && (
              <div className="p-3 rounded-xl bg-zinc-950 border border-amber-500/40 space-y-2">
                <div className="text-xs font-bold text-amber-300">Hitung Uang Fisik per Pecahan (wajib)</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {DENOMS.map((d) => (
                    <label key={d} className="flex items-center justify-between gap-2 text-[11px] text-zinc-300">
                      <span className="font-mono">Rp {d.toLocaleString('id-ID')} ×</span>
                      <input
                        type="number"
                        min={0}
                        value={denomCounts[d] || ''}
                        onChange={(e) => {
                          const next = { ...denomCounts, [d]: e.target.value };
                          setDenomCounts(next);
                          const sum = DENOMS.reduce((acc, x) => acc + x * (parseInt(next[x] || '0', 10) || 0), 0);
                          setKasAktualInput(formatNumberWithDots(String(sum)));
                          setErrorMessage(null);
                        }}
                        className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-right text-white font-mono"
                      />
                    </label>
                  ))}
                </div>
                <div className="text-right text-xs font-bold text-white font-mono">Total: Rp {denomTotal.toLocaleString('id-ID')}</div>
              </div>
            )}

            {/* Input 2: Kas Aktual */}
            <div>
              <label className="block text-white font-bold mb-1.5 text-xs">
                Kas Aktual <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-zinc-400 font-bold font-mono">Rp</span>
                <input
                  type="text"
                  value={kasAktualInput}
                  readOnly={requireCashCount}
                  onChange={(e) => {
                    const formatted = formatNumberWithDots(e.target.value);
                    setKasAktualInput(formatted);
                    if (String(formatted).replace(/\./g, '').replace(/[^0-9]/g, '').length > 0) {
                      setErrorMessage(null);
                    }
                  }}
                  placeholder="0 (Ketik nominal kas fisik)"
                  className="w-full bg-zinc-950 border border-amber-500/80 rounded-xl pl-9 pr-3 py-2 text-white font-mono font-bold text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 shadow-inner"
                />
              </div>
            </div>

            {/* Input 3: Bonus */}
            <div>
              <label className="block text-white font-bold mb-1.5 text-xs">
                Bonus
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-zinc-400 font-bold font-mono">Rp</span>
                <input
                  type="text"
                  value={bonusInput}
                  onChange={(e) => setBonusInput(formatNumberWithDots(e.target.value))}
                  placeholder="0"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl pl-9 pr-3 py-2 text-white font-mono font-bold text-sm focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>

            {/* Input 4: Pemasukan Lain */}
            <div>
              <label className="block text-white font-bold mb-1.5 text-xs">
                Pemasukan Lain
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-zinc-400 font-bold font-mono">Rp</span>
                <input
                  type="text"
                  value={pemasukanLainInput}
                  onChange={(e) => setPemasukanLainInput(formatNumberWithDots(e.target.value))}
                  placeholder="0"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl pl-9 pr-3 py-2 text-white font-mono font-bold text-sm focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>
          </div>

          {/* Catatan Shift */}
          <div>
            <label className="block text-white font-bold mb-1.5 text-xs">
              Catatan Shift
            </label>
            <textarea
              rows={2}
              value={catatanShift}
              onChange={(e) => setCatatanShift(e.target.value)}
              placeholder="Catatan shift..."
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2 text-white text-xs placeholder-zinc-500 focus:outline-none focus:border-amber-400 resize-none"
            />
          </div>
        </div>

        {/* C. PENGELUARAN TOKO & TOMBOL MERAH + TAMBAH PENGELUARAN */}
        <div className="space-y-3 pt-2 border-t border-zinc-800">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Pengeluaran Toko</span>
                <span className="text-xs text-zinc-400 font-normal">
                  (Total: <strong className="text-rose-400 font-mono">{formatRupiah(totalPengeluaranToko)}</strong>)
                </span>
              </h3>
              <p className="text-[11px] text-zinc-500">
                Pengeluaran kas operasional yang diambil dari laci kasir selama shift berlangsung.
              </p>
            </div>

            {/* TOMBOL MERAH + Tambah Pengeluaran */}
            <button
              type="button"
              onClick={handleAddExpenseRow}
              className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-sm transition flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Tambah Pengeluaran</span>
            </button>
          </div>

          {/* LIST EXPENSE INPUT ROWS */}
          {expenses.length === 0 ? (
            <div className="py-4 text-center text-xs text-zinc-500 bg-zinc-950/40 rounded-xl border border-dashed border-zinc-800">
              Belum ada pengeluaran toko yang ditambahkan. Klik tombol merah <strong>+ Tambah Pengeluaran</strong> jika kasir mengeluarkan uang dari laci.
            </div>
          ) : (
            <div className="space-y-2.5">
              {expenses.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex flex-col sm:flex-row items-center gap-2.5 bg-zinc-950/70 p-2.5 rounded-xl border border-zinc-800"
                >
                  <span className="text-zinc-500 text-xs font-mono w-6 text-center">
                    #{idx + 1}
                  </span>

                  {/* Keterangan Pengeluaran (Kiri) */}
                  <div className="flex-1 w-full">
                    <input
                      type="text"
                      value={item.keterangan}
                      onChange={(e) => handleUpdateExpenseKeterangan(item.id, e.target.value)}
                      placeholder="Keterangan Pengeluaran (contoh: Kertas Struk, Galon Aqua)"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500"
                    />
                  </div>

                  {/* Nominal Pengeluaran (Kanan) - Format Ribuan Rupiah Otomatis */}
                  <div className="w-full sm:w-48 relative">
                    <span className="absolute left-3 top-2 text-zinc-500 text-xs font-bold font-mono">
                      Rp
                    </span>
                    <input
                      type="text"
                      value={item.formattedNominal}
                      onChange={(e) => handleUpdateExpenseNominal(item.id, e.target.value)}
                      placeholder="0 (Contoh: 6.000)"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-3 py-1.5 text-xs font-mono font-bold text-white focus:outline-none focus:border-rose-500 text-right"
                    />
                  </div>

                  {/* Delete Button */}
                  <button
                    type="button"
                    onClick={() => handleDeleteExpenseRow(item.id)}
                    className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-900/40 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                    title="Hapus baris pengeluaran ini"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* D. 3 KARTU BESAR DI ATAS TOMBOL END SHIFT (Total Penjualan, KEUNTUNGAN, Selisih) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          {/* Kartu Kiri: Total Penjualan */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5 flex flex-col justify-between shadow-md">
            <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider">
              Total Penjualan
            </span>
            <div className="mt-2">
              <span className="text-2xl font-black font-mono text-white tracking-tight">
                {isRevealed ? formatRupiah(totalPenjualan) : 'Rp'}
              </span>
              {!isRevealed && (
                <p className="text-[11px] text-zinc-500 mt-1 italic">
                  Isi kolom Kas Aktual untuk melihat angka
                </p>
              )}
            </div>
          </div>

          {/* Kartu Tengah: KEUNTUNGAN */}
          <div className="bg-zinc-950 border border-emerald-900/60 rounded-2xl p-5 flex flex-col justify-between shadow-md">
            <span className="text-emerald-400 text-xs font-bold uppercase tracking-wider">
              KEUNTUNGAN
            </span>
            <div className="mt-2">
              <span className="text-2xl font-black font-mono text-emerald-400 tracking-tight">
                {isRevealed ? formatRupiah(keuntunganBersih) : 'Rp'}
              </span>
              {!isRevealed ? (
                <p className="text-[11px] text-zinc-500 mt-1 italic">
                  Isi kolom Kas Aktual untuk melihat angka
                </p>
              ) : (
                <p className="text-[11px] text-zinc-400 mt-1">
                  Keuntungan Bersih Sesi Shift
                </p>
              )}
            </div>
          </div>

          {/* Kartu Kanan: Selisih (Nuansa Merah Gelap) */}
          <div className="bg-[#1b0a0e] border border-rose-900/80 rounded-2xl p-5 flex flex-col justify-between shadow-md">
            <div className="flex items-center justify-between gap-2">
              <span className="text-rose-400 text-xs font-bold uppercase tracking-wider">
                Selisih
              </span>
              {isRevealed && (
                <span className="text-[10px] font-mono text-zinc-300 bg-zinc-900/80 border border-zinc-800 px-2 py-0.5 rounded">
                  Target Kas Sistem: {formatRupiah(targetKasSistem)}
                </span>
              )}
            </div>
            <div className="mt-2">
              <span
                className={`text-2xl font-black font-mono tracking-tight ${
                  !isRevealed
                    ? 'text-rose-300'
                    : selisih > 0
                    ? 'text-emerald-400'
                    : selisih === 0
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {isRevealed
                  ? selisih === 0
                    ? 'Rp 0'
                    : selisih > 0
                    ? `+${formatRupiah(selisih)}`
                    : `-${formatRupiah(Math.abs(selisih))}`
                  : 'Rp'}
              </span>
              {!isRevealed ? (
                <p className="text-[11px] text-rose-500/70 mt-1 italic">
                  Kas Aktual - Target Kas Sistem
                </p>
              ) : (
                <p className="text-[11px] text-zinc-300 mt-1 leading-relaxed">
                  {selisih > 0
                    ? `Uang fisik LEBIH dari Target Kas Sistem (Target: ${formatRupiah(targetKasSistem)} vs Aktual: ${formatRupiah(kasAktual)})`
                    : selisih === 0
                    ? `Uang fisik SESUAI dengan Target Kas Sistem (${formatRupiah(targetKasSistem)})`
                    : `Uang fisik KURANG dari Target Kas Sistem (Target: ${formatRupiah(targetKasSistem)} vs Aktual: ${formatRupiah(kasAktual)})`}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* PERINGATAN KAS AKTUAL / ERROR MESSAGE NOTIFICATION */}
        {(!isRevealed || errorMessage) && (
          <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>
              {errorMessage || '⚠️ Harap isi kolom Kas Aktual dengan nominal uang fisik laci kasir'}
            </span>
          </div>
        )}

        {/* TOMBOL PANJANG KUNING EMAS: END SHIFT */}
        <div className="pt-2">
          <button
            type="button"
            disabled={!isRevealed || isSubmitting}
            onClick={handleExecuteEndShift}
            className="w-full py-4 px-6 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-300 hover:to-yellow-300 text-zinc-950 font-black text-sm uppercase tracking-wider shadow-xl shadow-amber-500/20 active:scale-[0.99] transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                <span>Menutup Shift &amp; Membagi Saldo ke Semua Brangkas...</span>
              </>
            ) : (
              <>
                <Lock className="w-5 h-5 text-zinc-950" />
                <span>END SHIFT (TUTUP SHIFT &amp; DISTRIBUSI DANA)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* SUCCESS MODAL POPUP SETELAH END SHIFT */}
      {successInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-lg space-y-5 shadow-2xl text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500 text-emerald-400 flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-black text-white">Shift Kasir Berhasil Ditutup!</h3>
              <p className="text-xs text-zinc-400">
                Sesi <strong>#{successInfo.shiftId}</strong> telah dikunci dan seluruh mutasi keuangan otomatis terdistribusi ke Firestore.
              </p>
            </div>

            {/* Distribution Summary */}
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-4 text-left text-xs space-y-2">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <span className="text-zinc-400">Brangkas Toko (Setoran Bersih):</span>
                <span className="font-mono font-bold text-white">
                  {formatRupiah(successInfo.totalPenjualan + pemasukanLainNum + bonusNum)}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <span className="text-zinc-400">Brangkas Modal (Alokasi HPP):</span>
                <span className="font-mono font-bold text-purple-400">
                  {formatRupiah(successInfo.totalModal)}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <span className="text-zinc-400">Brangkas Untung (Alokasi Laba):</span>
                <span className="font-mono font-bold text-emerald-400">
                  {formatRupiah(successInfo.keuntungan)}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-zinc-400">Status Selisih Kas:</span>
                <span
                  className={`font-mono font-bold ${
                    successInfo.selisih === 0
                      ? 'text-emerald-400'
                      : successInfo.selisih > 0
                      ? 'text-cyan-400'
                      : 'text-rose-400'
                  }`}
                >
                  {successInfo.selisih === 0
                    ? 'Sesuai (Rp 0)'
                    : successInfo.selisih > 0
                    ? `+${formatRupiah(successInfo.selisih)}`
                    : `-${formatRupiah(Math.abs(successInfo.selisih))}`}
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setSuccessInfo(null);
                  if (onNavigateTab) onNavigateTab('module_shift', 'riwayat_shit');
                }}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition"
              >
                Lihat Riwayat Shift
              </button>
              <button
                type="button"
                onClick={() => {
                  setSuccessInfo(null);
                  if (onNavigateTab) onNavigateTab('module_finance', 'brangkas_toko');
                }}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs transition"
              >
                Cek Brangkas Keuangan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. TABEL TRANSAKSI DI BAGIAN BAWAH HALAMAN */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Receipt className="w-4 h-4 text-blue-400" />
              <span>Transaksi ({shiftTransactions.length} Transaksi Shift Ini)</span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Daftar transaksi penjualan POS &amp; PWA pada periode shift kasir saat ini.
            </p>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              value={txSearch}
              onChange={(e) => setTxSearch(e.target.value)}
              placeholder="Cari nota / pelanggan..."
              className="bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 w-56"
            />
          </div>
        </div>

        <div className="border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/90 text-zinc-400 border-b border-zinc-800 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4 font-semibold">Nota</th>
                  <th className="py-3 px-4 font-semibold">Tanggal</th>
                  <th className="py-3 px-4 font-semibold">Pelanggan</th>
                  <th className="py-3 px-4 font-semibold">Sumber (POS / PWA)</th>
                  <th className="py-3 px-4 font-semibold text-center">Qty</th>
                  <th className="py-3 px-4 font-semibold text-right">Total</th>
                  <th className="py-3 px-4 font-semibold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-zinc-500">
                      <p className="text-sm font-medium text-zinc-400">
                        Belum ada transaksi pada shift ini.
                      </p>
                      <p className="text-xs text-zinc-600 mt-1">
                        Setiap transaksi di kasir POS maupun pesanan Client PWA akan langsung muncul di sini.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx: any) => {
                    const nota = tx.orderNumber || tx.id.slice(-8).toUpperCase();
                    const dateStr = tx.createdAt
                      ? new Date(tx.createdAt).toLocaleDateString('id-ID', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })
                      : '-';

                    const isPwa =
                      tx.channel === 'pwa' ||
                      tx.source === 'pwa' ||
                      tx.isPwa ||
                      String(tx.id || '').startsWith('ORD-');

                    const totalItems =
                      tx.totalItems ||
                      (Array.isArray(tx.items)
                        ? tx.items.reduce(
                            (s: number, it: any) =>
                              s + Number(it.quantityOrdered || it.quantity || it.qty || 1),
                            0
                          )
                        : 1);

                    const totalNominal = Number(
                      tx.totalAmount ?? tx.totalRevenue ?? tx.subtotal ?? 0
                    );

                    const pmLower = String(tx.paymentMethod || 'cash').toLowerCase();
                    const isDebt = pmLower === 'debt' || pmLower === 'hutang';
                    const isLunas = !isDebt && String(tx.paymentStatus || '').toLowerCase() !== 'unpaid';

                    return (
                      <tr key={tx.id} className="hover:bg-zinc-800/40 transition">
                        {/* Nota */}
                        <td className="py-3 px-4 font-mono font-bold text-blue-400">
                          #{nota}
                        </td>

                        {/* Tanggal */}
                        <td className="py-3 px-4 text-zinc-400 whitespace-nowrap">
                          {dateStr}
                        </td>

                        {/* Pelanggan */}
                        <td className="py-3 px-4 font-medium text-white">
                          {tx.customerName || 'Pelanggan Umum'}
                        </td>

                        {/* Sumber (POS / PWA) */}
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              isPwa
                                ? 'bg-purple-950 text-purple-400 border border-purple-800'
                                : 'bg-blue-950 text-blue-400 border border-blue-800'
                            }`}
                          >
                            {isPwa ? 'PWA' : 'POS'}
                          </span>
                        </td>

                        {/* Qty */}
                        <td className="py-3 px-4 font-mono text-center text-zinc-300">
                          {totalItems}
                        </td>

                        {/* Total */}
                        <td className="py-3 px-4 font-mono font-bold text-white text-right">
                          {formatRupiah(totalNominal)}
                        </td>

                        {/* Status (Lunas / Hutang) */}
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              isLunas
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : 'bg-rose-950 text-rose-400 border border-rose-800'
                            }`}
                          >
                            {isLunas ? 'Lunas' : 'Hutang'}
                          </span>
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
  );
};
