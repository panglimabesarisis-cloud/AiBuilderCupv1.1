import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db, ensureFirebaseSession } from '../../firebase';
import { useAccessControl } from '../../context/AccessControlContext';
import { useFirestoreList } from '../../hooks/useFirestoreList';
import { formatRibuanInput, parseRibuanInput, fmtMoney } from '../../utils/money';

interface PosPinGateProps {
  onUnlocked?: () => void;
}

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

export const PosPinGate: React.FC<PosPinGateProps> = ({ onUnlocked }) => {
  const {
    verifyPosPin,
    posPinVerified,
    isDemoMode,
    activeRoleId,
    activeCashier,
    setActiveCashier,
    staffDirectory,
  } = useAccessControl();
  const navigate = useNavigate();

  const { data: shiftsDocs, setData: setShiftsDocs } = useFirestoreList<any>('shifts', []);

  // Semua role (Owner, Admin, Manager, Supervisor, Cashier) wajib melewati alur PIN & Mulai Shift Baru yang sama persis
  const isCashierUser = true;

  // Nama & role akun yang sedang login (otomatis mengisi Nama Petugas / Kasir)
  const loggedInUserName = useMemo(() => {
    const fbUser = auth?.currentUser;
    return (
      activeCashier?.name ||
      fbUser?.displayName ||
      (fbUser?.email ? fbUser.email.split('@')[0] : '') ||
      'Kasir POS'
    );
  }, [activeCashier?.name]);

  const loggedInUserEmail = useMemo(() => {
    const fbUser = auth?.currentUser;
    return activeCashier?.email || fbUser?.email || 'kasir@riskcart.ai';
  }, [activeCashier?.email]);

  const loggedInUserRole = useMemo(() => {
    return activeCashier?.role || activeRoleId || 'Cashier';
  }, [activeCashier?.role, activeRoleId]);

  const currentOpenShiftDoc = useMemo(() => {
    const openList = shiftsDocs.filter(
      (s) =>
        String(s.status || '').toLowerCase().trim() === 'open' ||
        String(s.status || '').toLowerCase().trim() === 'aktif'
    );
    if (openList.length > 0) {
      return openList.sort((a, b) => {
        const ta = new Date(a.openedAt || a.openTime || a.createdAt || 0).getTime();
        const tb = new Date(b.openedAt || b.openTime || b.createdAt || 0).getTime();
        return tb - ta;
      })[0];
    }
    try {
      const savedShift =
        localStorage.getItem('riskcart_active_shift') ||
        localStorage.getItem('riskcart_active_open_shift') ||
        localStorage.getItem('activeShift');
      if (savedShift) {
        const parsed = JSON.parse(savedShift);
        const st = String(parsed?.status || '').toLowerCase().trim();
        if (parsed && (st === 'open' || st === 'aktif')) {
          return parsed;
        }
      }
    } catch {}
    return null;
  }, [shiftsDocs]);

  const [pinDigits, setPinDigits] = useState<string[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const [status, setStatus] = useState<'idle' | 'error' | 'unlocked'>('idle');
  const [feedbackText, setFeedbackText] = useState<string>('');
  const [showMandatoryOpenShift, setShowMandatoryOpenShift] = useState<boolean>(false);
  const [shiftDate, setShiftDate] = useState<string>(() => getJakartaDateYmd());
  const [jakartaClock, setJakartaClock] = useState<string>(() => getJakartaTimeWib());
  const [uangLaciFormatted, setUangLaciFormatted] = useState<string>('');
  const [shiftFormError, setShiftFormError] = useState<string | null>(null);
  const [isStartingShift, setIsStartingShift] = useState<boolean>(false);
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  // Real-time WIB Clock & Date (berjalan otomatis setiap detik 1000ms)
  useEffect(() => {
    const timer = setInterval(() => {
      setJakartaClock(getJakartaTimeWib());
      setShiftDate((prev) => prev || getJakartaDateYmd());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const focusPinInput = useCallback(() => {
    if (showMandatoryOpenShift) return;
    try {
      hiddenInputRef.current?.focus();
    } catch {}
  }, [showMandatoryOpenShift]);

  useEffect(() => {
    const timer = setTimeout(() => {
      focusPinInput();
    }, 80);
    return () => clearTimeout(timer);
  }, [focusPinInput]);

  const handleValidatePin = useCallback(
    async (fullPin: string) => {
      const cleanPin = String(fullPin || '').replace(/\D/g, '');
      const result = await verifyPosPin(cleanPin);

      // Izinkan semua role (Owner, Admin, Manager, Supervisor, Cashier) melewati verifikasi PIN
      let isPinOk = result.ok;
      let unlockedName = result.staff?.name || loggedInUserName;

      if (!isPinOk && cleanPin.length === 6) {
        const matchedStaff = (staffDirectory || []).find(
          (s: any) => String(s.pin || '').trim() === cleanPin && s.status !== 'Nonaktif'
        );
        if (matchedStaff) {
          isPinOk = true;
          unlockedName = matchedStaff?.name || loggedInUserName;
          const staffProfile = {
            id: matchedStaff?.id || activeCashier?.id || 'staff_001',
            name: unlockedName,
            email: matchedStaff?.email || loggedInUserEmail,
            role: matchedStaff?.role || loggedInUserRole,
            outlet: matchedStaff?.outlet || activeCashier?.outlet || 'RiskCart Flagship Store (Pusat)',
            phone: matchedStaff?.phone || activeCashier?.phone || '-',
            shift: matchedStaff?.shift || activeCashier?.shift || 'Shift Kasir Aktif',
          };
          setActiveCashier(staffProfile);
          try {
            sessionStorage.setItem('riskcart_pos_pin_verified', 'true');
            localStorage.setItem('riskcart_active_cashier', JSON.stringify(staffProfile));
            window.dispatchEvent(new CustomEvent('riskcart:cashier-change', { detail: staffProfile }));
            window.dispatchEvent(new CustomEvent('riskcart_cashier_changed', { detail: staffProfile }));
          } catch {}
        }
      }

      if (isPinOk) {
        let tokenToSave = (result as any)?.token || (result as any)?.sessionToken || '';
        if (!tokenToSave) {
          try {
            const pinRes = await fetch('/api/auth/verify-pin', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: 'cashier', pin: cleanPin }),
            });
            const data = await pinRes.json().catch(() => ({}));
            if (data?.token || data?.sessionToken) {
              tokenToSave = String(data.token || data.sessionToken);
            }
          } catch {}
        }
        if (tokenToSave) {
          try {
            sessionStorage.setItem('riskcart_server_token', tokenToSave);
          } catch {}
          await ensureFirebaseSession();
        }

        setStatus('unlocked');
        try {
          sessionStorage.setItem('riskcart_pos_pin_verified', 'true');
          window.dispatchEvent(new CustomEvent('riskcart:pos-pin-verified', { detail: true }));
        } catch {}

        if (currentOpenShiftDoc) {
          setFeedbackText(`PIN Valid (${unlockedName})! Membuka Mesin Kasir POS...`);
          setTimeout(() => {
            if (onUnlocked) onUnlocked();
          }, 420);
        } else {
          setFeedbackText('PIN Valid! Silakan lengkapi Form Mulai Shift Baru terlebih dahulu.');
          setShiftDate(getJakartaDateYmd());
          setJakartaClock(getJakartaTimeWib());
          setTimeout(() => {
            setShowMandatoryOpenShift(true);
          }, 350);
        }
      } else {
        setStatus('error');
        setFeedbackText('PIN Keamanan Kasir salah! Silakan coba lagi.');
        setTimeout(() => {
          setPinDigits([]);
          setActiveIdx(0);
          setStatus('idle');
          focusPinInput();
        }, 600);
      }
    },
    [
      verifyPosPin,
      staffDirectory,
      loggedInUserName,
      loggedInUserEmail,
      loggedInUserRole,
      activeCashier,
      setActiveCashier,
      onUnlocked,
      focusPinInput,
      currentOpenShiftDoc,
    ]
  );

  const handleStartMandatoryShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setShiftFormError(null);
    const cleanRaw = String(uangLaciFormatted ?? '').replace(/\D/g, '');
    if (!cleanRaw) {
      setShiftFormError('Wajib mengisi nominal Modal Awal Laci Kasir sebelum memulai shift!');
      return;
    }
    const floatNum = parseRibuanInput(uangLaciFormatted);
    setIsStartingShift(true);
    try {
      const nowIso = new Date().toISOString();
      const currentWibClock = getJakartaTimeWib();
      const targetDate = shiftDate || getJakartaDateYmd();
      const dateCompact = targetDate.replace(/-/g, '');
      const shiftId = `SHF-${dateCompact}-${String(shiftsDocs.length + 1).padStart(2, '0')}`;
      const cashierName = loggedInUserName;
      const cashierId = activeCashier?.id || 'staff_001';
      const parsedDateObj = new Date(`${targetDate}T12:00:00`);
      const formattedDateId = !isNaN(parsedDateObj.getTime())
        ? parsedDateObj.toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : targetDate;

      const shiftPayload = {
        id: shiftId,
        status: 'open',
        tanggal: targetDate,
        shiftDate: targetDate,
        date: targetDate,
        dateDisplay: formattedDateId,
        jam: currentWibClock,
        startTime: currentWibClock,
        openTime: nowIso,
        openedAt: nowIso,
        openedAtDisplay: `${formattedDateId}, ${currentWibClock}`,
        openedBy: cashierName,
        initialCash: floatNum,
        openingCashBalance: floatNum,
        uangLaci: floatNum,
        initialFloat: floatNum,
        startingCash: floatNum,
        modalAwal: floatNum,
        expectedCashBalance: floatNum,
        cashierId,
        cashierName,
        staffName: cashierName,
        cashier: cashierName,
        cashierRole: loggedInUserRole,
        outlet: activeCashier?.outlet || 'RiskCart Flagship Store (Pusat)',
        session: activeCashier?.shift || 'Shift Kasir Aktif',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      setShiftsDocs((prev) => [shiftPayload, ...prev.filter((s) => s.id !== shiftId)]);
      setActiveCashier({
        id: cashierId,
        name: cashierName,
        email: loggedInUserEmail,
        role: loggedInUserRole,
        outlet: activeCashier?.outlet || 'RiskCart Flagship Store (Pusat)',
        phone: activeCashier?.phone || '-',
        shift: activeCashier?.shift || 'Shift Kasir Aktif',
      });

      // 1. Simpan shift baru ke Firestore `shifts`
      await setDoc(doc(db, 'shifts', shiftId), shiftPayload, { merge: true }).catch(() => {});

      // 2. Catat Uang Laci (Modal Awal Kasir) ke `brangkas_toko_logs` & `cash_flows` jika > 0
      if (floatNum > 0) {
        await Promise.all([
          setDoc(
            doc(db, 'brangkas_toko_logs', `BT-LACI-${shiftId}`),
            {
              id: `BT-LACI-${shiftId}`,
              shiftId,
              date: targetDate,
              time: currentWibClock,
              createdAt: nowIso,
              timestamp: nowIso,
              type: 'in',
              sourceType: 'UANG_LACI',
              category: 'Uang Laci (Modal Awal Kasir)',
              amount: floatNum,
              nominal: floatNum,
              staffName: cashierName,
              cashierName,
              method: 'Tunai (Laci Kasir)',
              referenceId: shiftId,
              notes: `Modal Awal Laci Kasir Shift #${shiftId} oleh ${cashierName}`,
              status: 'Completed',
            },
            { merge: true }
          ).catch(() => {}),
          setDoc(
            doc(db, 'cash_flows', `MODAL-AWAL-${shiftId}`),
            {
              id: `MODAL-AWAL-${shiftId}`,
              shiftId,
              type: 'in',
              category: 'Modal Awal Kasir (Tambah Dana Laci)',
              source: 'Buka Shift Kasir POS',
              staffName: cashierName,
              cashierName,
              method: 'Tunai (Laci Kasir)',
              amount: floatNum,
              description: `Modal Awal Laci Kasir Shift #${shiftId} - ${cashierName}`,
              date: formattedDateId,
              time: currentWibClock,
              createdAt: nowIso,
            },
            { merge: true }
          ).catch(() => {}),
        ]);
      }

      // 3. Simpan ke localStorage (`riskcart_active_shift`) & trigger `shift-status-changed`
      try {
        sessionStorage.setItem('riskcart_pos_pin_verified', 'true');
        sessionStorage.setItem('riskcart_shift_opened_session', 'true');
        localStorage.setItem('riskcart_active_shift', JSON.stringify(shiftPayload));
        localStorage.setItem('activeShift', JSON.stringify(shiftPayload));
        localStorage.setItem('riskcart_active_open_shift', JSON.stringify(shiftPayload));
        window.dispatchEvent(new CustomEvent('riskcart:shift-opened', { detail: shiftPayload }));
        window.dispatchEvent(new Event('shift-status-changed'));
      } catch {}

      setShowMandatoryOpenShift(false);
      if (onUnlocked) onUnlocked();
    } finally {
      setIsStartingShift(false);
    }
  };

  const appendDigit = useCallback(
    (digit: string) => {
      if (status === 'unlocked' || showMandatoryOpenShift) return;
      const clean = digit.replace(/\D/g, '');
      if (!clean) return;

      setPinDigits((prev) => {
        if (prev.length >= 6) return prev;
        const next = [...prev, ...clean.split('')].slice(0, 6);
        setActiveIdx(Math.min(next.length, 5));
        if (next.length === 6) {
          void handleValidatePin(next.join(''));
        }
        return next;
      });
    },
    [status, showMandatoryOpenShift, handleValidatePin]
  );

  const removeLastDigit = useCallback(() => {
    if (status === 'unlocked' || showMandatoryOpenShift) return;
    setPinDigits((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      setActiveIdx(Math.max(0, next.length));
      return next;
    });
    if (status === 'error') {
      setStatus('idle');
      setFeedbackText('');
    }
  }, [status, showMandatoryOpenShift]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (showMandatoryOpenShift) return;
      if (e.target === hiddenInputRef.current) return;
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        appendDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        removeLastDigit();
      } else if (e.key === 'Escape') {
        navigate('/dashboard');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [appendDigit, removeLastDigit, navigate, showMandatoryOpenShift, isCashierUser]);

  return (
    <div
      className="rc-pos-pin-root fixed inset-0 z-50 w-full h-[100dvh] overflow-y-auto overflow-x-hidden select-none"
      onClick={focusPinInput}
    >
      <style>{`
        .rc-pos-pin-root {
          --gold-1: #ffd76a;
          --gold-2: #f3c04a;
          --gold-3: #c98618;
          --gold-line: #d9a52a;
          --bg: #050403;
          --muted: #b5b0a4;
          font-family: "Inter", "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          background: var(--bg);
          color: #fff;
          -webkit-font-smoothing: antialiased;
        }

        /* ================= LATAR GELOMBANG EMAS ================= */
        .rc-pos-pin-root .bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          pointer-events: none;
          background:
            radial-gradient(ellipse at 50% 42%, rgba(255, 190, 60, 0.05), transparent 60%),
            #050403;
        }
        .rc-pos-pin-root .bg > svg {
          position: absolute;
          display: block;
          overflow: visible;
        }
        .rc-pos-pin-root .bg-top {
          top: 0;
          left: 0;
          width: 100%;
          height: 44vh;
        }
        .rc-pos-pin-root .bg-bottom {
          bottom: 0;
          right: 0;
          width: 100%;
          height: 60vh;
        }
        @media (min-aspect-ratio: 1/1) {
          .rc-pos-pin-root .bg-top    { height: 52vh; }
          .rc-pos-pin-root .bg-bottom { height: 66vh; }
        }

        .rc-pos-pin-root .orb {
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
        }
        .rc-pos-pin-root .orb-tl {
          left: -18vmax;
          top: -14vmax;
          width: 48vmax;
          height: 48vmax;
          background: radial-gradient(circle, rgba(255, 200, 80, 0.32) 0%, rgba(255, 170, 30, 0.09) 42%, transparent 68%);
        }
        .rc-pos-pin-root .orb-br {
          right: -18vmax;
          bottom: -16vmax;
          width: 52vmax;
          height: 52vmax;
          background: radial-gradient(circle, rgba(255, 185, 45, 0.28) 0%, rgba(255, 150, 20, 0.08) 45%, transparent 68%);
        }

        .rc-pos-pin-root .wave-float {
          animation: rcPosPinDrift 9s ease-in-out infinite alternate;
        }
        .rc-pos-pin-root .wave-float.slow {
          animation-duration: 13s;
          animation-direction: alternate-reverse;
        }
        @keyframes rcPosPinDrift {
          0%   { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(0, -8px, 0); }
        }

        .rc-pos-pin-root .spark {
          animation: rcPosPinTwinkle 3.2s ease-in-out infinite;
        }
        .rc-pos-pin-root .spark:nth-child(2n) { animation-delay: -1.1s; animation-duration: 4.1s; }
        .rc-pos-pin-root .spark:nth-child(3n) { animation-delay: -2.3s; animation-duration: 2.7s; }
        @keyframes rcPosPinTwinkle {
          0%, 100% { opacity: 0.25; }
          50%      { opacity: 1; }
        }

        .rc-pos-pin-root .dust-layer {
          position: absolute;
          inset: 0;
          overflow: hidden;
        }
        .rc-pos-pin-root .dust {
          position: absolute;
          bottom: -12px;
          border-radius: 50%;
          background: radial-gradient(circle, #fff3c4 0%, #ffc84a 60%, rgba(255, 190, 60, 0) 100%);
          box-shadow: 0 0 8px rgba(255, 205, 95, 0.9);
          opacity: 0;
          animation: rcPosPinRise linear infinite;
        }
        @keyframes rcPosPinRise {
          0%   { transform: translate3d(0, 0, 0) scale(0.6); opacity: 0; }
          15%  { opacity: 0.85; }
          85%  { opacity: 0.65; }
          100% { transform: translate3d(var(--sx, 20px), -105vh, 0) scale(1.1); opacity: 0; }
        }

        /* ================= HALAMAN PIN ================= */
        .rc-pos-pin-root .page {
          position: relative;
          z-index: 2;
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: clamp(20px, 4vh, 44px) clamp(16px, 4vw, 32px);
        }

        .rc-pos-pin-root .wrap {
          width: 100%;
          max-width: 440px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        /* Logo RiskCart */
        .rc-pos-pin-root .brand {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: clamp(12px, 2.6vw, 18px);
          margin-bottom: clamp(18px, 3vh, 26px);
          user-select: none;
          max-width: 100%;
        }
        .rc-pos-pin-root .brand-mark {
          width: clamp(54px, 12.5vw, 68px);
          height: auto;
          aspect-ratio: 100 / 110;
          flex-shrink: 0;
          filter:
            drop-shadow(0 6px 14px rgba(0, 0, 0, 0.7))
            drop-shadow(0 0 14px rgba(255, 195, 65, 0.25));
        }
        .rc-pos-pin-root .brand-divider {
          width: 1.5px;
          height: clamp(42px, 9.5vw, 54px);
          background: linear-gradient(180deg,
            rgba(255, 215, 110, 0.15),
            rgba(255, 215, 110, 0.75) 50%,
            rgba(255, 215, 110, 0.15));
          border-radius: 2px;
          flex-shrink: 0;
        }
        .rc-pos-pin-root .brand-text {
          display: flex;
          flex-direction: column;
          justify-content: center;
          line-height: 1;
        }
        .rc-pos-pin-root .brand-name {
          font-weight: 800;
          font-size: clamp(30px, 7.6vw, 42px);
          letter-spacing: -0.03em;
          color: #ffffff;
          text-shadow: 0 2px 14px rgba(0, 0, 0, 0.6);
          white-space: nowrap;
        }
        .rc-pos-pin-root .brand-name .cart {
          background: linear-gradient(180deg, #fff2be 0%, #ffd05b 45%, #e1991c 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          margin-left: 4px;
          filter: drop-shadow(0 0 12px rgba(255, 190, 55, 0.28));
        }
        .rc-pos-pin-root .brand-sub {
          margin-top: 6px;
          font-size: clamp(12.5px, 3vw, 16px);
          font-weight: 500;
          color: #e9e4d8;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }

        /* ================= KARTU PIN ================= */
        .rc-pos-pin-root .pin-card {
          position: relative;
          width: 100%;
          border-radius: 24px;
          padding: clamp(24px, 4.5vw, 34px) clamp(18px, 4.5vw, 28px) clamp(24px, 4.5vw, 32px);
          background:
            radial-gradient(120% 90% at 50% 0%, rgba(255, 200, 80, 0.10), rgba(16, 12, 8, 0.78) 55%, rgba(8, 6, 4, 0.90) 100%);
          border: 1.5px solid rgba(235, 180, 60, 0.82);
          box-shadow:
            0 22px 60px rgba(0, 0, 0, 0.85),
            0 0 32px rgba(255, 185, 45, 0.20),
            inset 0 1px 0 rgba(255, 230, 150, 0.4),
            inset 0 0 28px rgba(255, 190, 60, 0.06);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .rc-pos-pin-root .pin-card::before {
          content: "";
          position: absolute;
          top: -1.5px;
          left: 16%;
          right: 16%;
          height: 2px;
          background: linear-gradient(90deg, transparent, #ffe9a6, #ffc84a, transparent);
          filter: drop-shadow(0 0 8px #ffd26a);
          pointer-events: none;
        }

        .rc-pos-pin-root .lock-stage {
          position: relative;
          width: clamp(118px, 28vw, 146px);
          height: clamp(128px, 30vw, 158px);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 6px;
        }

        .rc-pos-pin-root .lock-stage::before {
          content: "";
          position: absolute;
          inset: 8%;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255, 195, 65, 0.34) 0%, rgba(255, 165, 25, 0.10) 50%, transparent 74%);
          filter: blur(8px);
          pointer-events: none;
        }

        .rc-pos-pin-root .lock-svg {
          width: 100%;
          height: 100%;
          overflow: visible;
          filter:
            drop-shadow(0 12px 18px rgba(0, 0, 0, 0.75))
            drop-shadow(0 0 18px rgba(255, 195, 65, 0.28));
        }

        .rc-pos-pin-root #shackle {
          transform-box: fill-box;
          transform-origin: 78% 100%;
          transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .rc-pos-pin-root .pin-card.unlock #shackle {
          transform: translateY(-12px) rotate(22deg);
        }

        .rc-pos-pin-root .title {
          font-size: clamp(23px, 5.5vw, 29px);
          font-weight: 700;
          letter-spacing: -0.01em;
          color: #ffffff;
          text-align: center;
        }

        .rc-pos-pin-root .sub {
          margin-top: 6px;
          margin-bottom: clamp(18px, 3vh, 24px);
          font-size: clamp(13px, 3.2vw, 14.5px);
          color: var(--muted);
          text-align: center;
        }

        /* 6 Kotak Titik PIN */
        .rc-pos-pin-root .pin-boxes {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: clamp(7px, 2vw, 11px);
          margin-bottom: 10px;
        }

        .rc-pos-pin-root .pin-box {
          aspect-ratio: 1 / 1.08;
          min-height: 48px;
          max-height: 60px;
          border-radius: 12px;
          background: rgba(8, 7, 5, 0.84);
          border: 1.4px solid rgba(217, 165, 42, 0.72);
          box-shadow:
            inset 0 2px 6px rgba(0, 0, 0, 0.75),
            0 0 10px rgba(255, 190, 55, 0.08);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.15s ease;
        }

        .rc-pos-pin-root .pin-box.active {
          border-color: #ffe596;
          box-shadow:
            inset 0 2px 6px rgba(0, 0, 0, 0.75),
            0 0 0 3px rgba(255, 205, 85, 0.20),
            0 0 18px rgba(255, 195, 60, 0.38);
          transform: translateY(-1px);
        }

        .rc-pos-pin-root .pin-box.filled {
          border-color: #f6c44b;
          background: radial-gradient(circle at 50% 50%, rgba(255, 200, 75, 0.16), rgba(10, 8, 5, 0.90));
        }

        .rc-pos-pin-root .pin-box .dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 30%, #fff6cf 0%, #ffd25a 55%, #d68b12 100%);
          box-shadow: 0 0 10px rgba(255, 205, 85, 0.85);
          transform: scale(0);
          opacity: 0;
          transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.14s ease;
        }

        .rc-pos-pin-root .pin-box.filled .dot {
          transform: scale(1);
          opacity: 1;
        }

        @keyframes rcPosPinShake {
          0%, 100% { transform: translateX(0); }
          20%      { transform: translateX(-8px); }
          40%      { transform: translateX(8px); }
          60%      { transform: translateX(-6px); }
          80%      { transform: translateX(6px); }
        }
        .rc-pos-pin-root .pin-boxes.shake {
          animation: rcPosPinShake 0.42s ease;
        }
        .rc-pos-pin-root .pin-boxes.shake .pin-box {
          border-color: #fb7185;
          box-shadow: 0 0 14px rgba(244, 63, 94, 0.45);
        }

        .rc-pos-pin-root .pin-hint {
          margin-top: 8px;
          font-size: 12.5px;
          color: #d6cebe;
          text-align: center;
        }
        .rc-pos-pin-root .pin-hint strong {
          color: #ffe28a;
          font-weight: 700;
        }

        .rc-pos-pin-root .pin-feedback {
          margin-top: 10px;
          font-size: 12.8px;
          font-weight: 600;
          text-align: center;
          min-height: 20px;
        }
        .rc-pos-pin-root .pin-feedback.error {
          color: #fda4af;
        }
        .rc-pos-pin-root .pin-feedback.ok {
          color: #6ee7b7;
        }

        /* Keypad numerik opsional untuk layar sentuh / klik cepat */
        .rc-pos-pin-root .keypad {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          margin-top: 14px;
        }
        .rc-pos-pin-root .key-btn {
          height: 44px;
          border-radius: 11px;
          border: 1px solid rgba(235, 180, 60, 0.38);
          background: rgba(16, 13, 8, 0.72);
          color: #fff6dc;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
        }
        .rc-pos-pin-root .key-btn:hover {
          background: rgba(255, 200, 75, 0.16);
          border-color: rgba(255, 215, 110, 0.75);
        }
        .rc-pos-pin-root .key-btn:active {
          transform: scale(0.97);
        }
        .rc-pos-pin-root .key-btn.sub-action {
          font-size: 12px;
          color: #e2b857;
          font-weight: 600;
        }
      `}</style>

      {/* Hidden input for mobile virtual keyboard */}
      <input
        ref={hiddenInputRef}
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value=""
        onChange={(e) => {
          const val = e.target.value;
          if (val) appendDigit(val);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Backspace') {
            e.preventDefault();
            removeLastDigit();
          }
        }}
        style={{
          position: 'fixed',
          top: '-100px',
          left: '-100px',
          width: '1px',
          height: '1px',
          opacity: 0,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />

      {/* Latar Gelombang Emas */}
      <div className="bg" aria-hidden="true">
        <div className="orb orb-tl" />
        <div className="orb orb-br" />

        <svg className="bg-top" viewBox="0 0 900 620" preserveAspectRatio="xMinYMin slice" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="rcPosPinGArc" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="900" y2="0">
              <stop offset="0" stopColor="#fff3c4" stopOpacity="1" />
              <stop offset="0.32" stopColor="#ffc844" stopOpacity="0.95" />
              <stop offset="0.7" stopColor="#e59a18" stopOpacity="0.45" />
              <stop offset="1" stopColor="#ffc844" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="rcPosPinGStreakL" gradientUnits="userSpaceOnUse" x1="0" y1="520" x2="520" y2="0">
              <stop offset="0" stopColor="#ffb422" stopOpacity="0.2" />
              <stop offset="0.55" stopColor="#ffd76e" stopOpacity="1" />
              <stop offset="1" stopColor="#fff4c8" stopOpacity="1" />
            </linearGradient>
            <filter id="rcPosPinGlowA" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="rcPosPinBlurBig" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="24" />
            </filter>
          </defs>
          <g className="wave-float slow">
            <path d="M-40,470 C80,240 240,90 470,-30" fill="none" stroke="url(#rcPosPinGStreakL)" strokeWidth="42" opacity="0.22" filter="url(#rcPosPinBlurBig)" />
            <path d="M-40,510 C90,260 240,100 450,-30" fill="none" stroke="url(#rcPosPinGStreakL)" strokeWidth="4.2" filter="url(#rcPosPinGlowA)" />
            <path d="M-40,450 C70,220 220,70 420,-30" fill="none" stroke="url(#rcPosPinGStreakL)" strokeWidth="2.4" opacity="0.9" filter="url(#rcPosPinGlowA)" />
            <path d="M-30,360 C190,190 470,70 760,30 C830,20 880,22 930,32" fill="none" stroke="url(#rcPosPinGArc)" strokeWidth="3.2" filter="url(#rcPosPinGlowA)" />
          </g>
        </svg>

        <svg className="bg-bottom" viewBox="0 900 900 900" preserveAspectRatio="xMaxYMax slice" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="rcPosPinGSweep" gradientUnits="userSpaceOnUse" x1="900" y1="1000" x2="0" y2="1780">
              <stop offset="0" stopColor="#fff3c2" stopOpacity="1" />
              <stop offset="0.45" stopColor="#ffc844" stopOpacity="0.95" />
              <stop offset="0.85" stopColor="#df9215" stopOpacity="0.75" />
              <stop offset="1" stopColor="#ffc844" stopOpacity="0.15" />
            </linearGradient>
            <filter id="rcPosPinGlowB" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="rcPosPinBlurBig2" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="28" />
            </filter>
          </defs>
          <g className="wave-float">
            <path d="M930,990 C900,1170 800,1300 640,1390 C470,1485 250,1510 -20,1600" fill="none" stroke="url(#rcPosPinGSweep)" strokeWidth="76" opacity="0.30" filter="url(#rcPosPinBlurBig2)" />
            <path d="M930,980 C900,1160 800,1290 640,1380 C470,1475 250,1500 -20,1590" fill="none" stroke="url(#rcPosPinGSweep)" strokeWidth="4.2" filter="url(#rcPosPinGlowB)" />
            <path d="M-20,1610 C100,1540 260,1560 420,1620 C560,1670 760,1700 930,1690" fill="none" stroke="url(#rcPosPinGSweep)" strokeWidth="3" filter="url(#rcPosPinGlowB)" />
          </g>
        </svg>

        <div className="dust-layer">
          {Array.from({ length: 18 }).map((_, i) => {
            const size = 1.8 + ((i * 7) % 24) / 10;
            const left = ((i * 37) % 98) + 1;
            const dur = 10 + ((i * 13) % 12);
            const delay = -((i * 19) % 20);
            const sx = ((i * 23) % 80) - 40;
            return (
              <span
                key={i}
                className="dust"
                style={
                  {
                    left: `${left}%`,
                    width: `${size}px`,
                    height: `${size}px`,
                    animationDuration: `${dur}s`,
                    animationDelay: `${delay}s`,
                    '--sx': `${sx}px`,
                  } as React.CSSProperties
                }
              />
            );
          })}
        </div>
      </div>

      {/* Konten Utama */}
      <main className="page">
        <div className="wrap">
          {/* Logo RiskCart */}
          <header
            translate="no"
            data-no-translate="true"
            className="brand notranslate bg-transparent"
            style={{ background: 'transparent', backgroundColor: 'transparent' }}
            aria-label="POS RiskCart Artificial Intelligence"
          >
            <svg className="brand-mark" viewBox="-8 -8 124 126" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="POS">
              <defs>
                <linearGradient id="rcPosPinHexGold" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#fff0b8" />
                  <stop offset="0.45" stopColor="#ffc83a" />
                  <stop offset="1" stopColor="#d98d12" />
                </linearGradient>
                <linearGradient id="rcPosPinWhite" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="1" stopColor="#c9c9c9" />
                </linearGradient>
              </defs>
              <path d="M100,27 L50,0 L0,27 L0,83 L50,110 L100,83" fill="none" stroke="url(#rcPosPinHexGold)" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
              <path d="M92,33 L50,10 L9,33 L9,77 L50,100 L92,77" fill="none" stroke="url(#rcPosPinHexGold)" strokeWidth="1.6" opacity="0.55" strokeLinejoin="round" strokeLinecap="round" />
              <text x="55" y="70" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontWeight="900" fontSize="46" letterSpacing="-2.5" fill="url(#rcPosPinWhite)">POS</text>
            </svg>
            <span className="brand-divider" />
            <div translate="no" data-no-translate="true" className="brand-text notranslate">
              <span className="brand-name notranslate">
                Risk<span className="cart notranslate">Cart</span>
              </span>
              <span className="brand-sub notranslate">Artificial Intelligence</span>
            </div>
          </header>

          {/* Kartu PIN Gembok 3D / Form Wajib Buka Shift */}
          <section
            className={`pin-card ${status === 'unlocked' ? 'unlock' : ''}`}
            aria-labelledby="pinTitle"
          >
            {showMandatoryOpenShift ? (
              <form onSubmit={handleStartMandatoryShift} className="w-full flex flex-col text-left">
                <div className="text-center mb-4">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-[11px] font-extrabold uppercase tracking-wider mb-2">
                    ✓ PIN Terverifikasi • Wajib Buka Shift
                  </span>
                  <h1 className="title !text-xl sm:!text-2xl" id="pinTitle">
                    Mulai Shift Baru (Buka Kasir)
                  </h1>
                  <p className="text-xs text-zinc-400 mt-1">
                    Lengkapi form modal laci awal sebelum membuka mesin kasir POS
                  </p>
                </div>

                {shiftFormError && (
                  <div className="mb-3 p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs font-semibold text-center">
                    {shiftFormError}
                  </div>
                )}

                <div className="space-y-3.5">
                  {/* 1. Nama Petugas / Kasir (Otomatis sesuai login) */}
                  <div>
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider text-amber-300/90 mb-1">
                      1. Nama Petugas / Kasir (Otomatis Sesuai Login)
                    </label>
                    <input
                      type="text"
                      value={`${loggedInUserName} (${loggedInUserRole})`}
                      disabled={true}
                      readOnly
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900/90 border border-amber-500/30 text-amber-200 font-bold text-sm cursor-not-allowed opacity-90"
                    />
                  </div>

                  {/* 2. Tanggal (Default Today Asia/Jakarta) */}
                  <div>
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider text-amber-300/90 mb-1">
                      2. Tanggal Shift (Waktu Jakarta WIB)
                    </label>
                    <input
                      type="date"
                      value={shiftDate}
                      onChange={(e) => setShiftDate(e.target.value)}
                      required
                      className="w-full px-3.5 py-2.5 rounded-xl bg-black/80 border border-amber-500/50 focus:border-amber-400 text-white font-bold text-sm outline-none"
                    />
                  </div>

                  {/* 3. Jam (Waktu Jakarta WIB Real-Time Berjalan Detik demi Detik) */}
                  <div>
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider text-amber-300/90 mb-1">
                      3. Jam Buka Shift (Real-Time WIB)
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={jakartaClock}
                        disabled={true}
                        readOnly
                        className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900/90 border border-emerald-500/40 text-emerald-400 font-mono font-bold text-sm cursor-not-allowed opacity-95"
                      />
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-[10px] font-bold text-emerald-400">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                        LIVE
                      </span>
                    </div>
                  </div>

                  {/* 4. Uang Laci (Format titik ribuan otomatis) */}
                  <div>
                    <label className="block text-[11px] font-extrabold uppercase tracking-wider text-amber-300 mb-1">
                      4. Modal Awal Laci Kasir (Rp) *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-black text-amber-400">
                        Rp
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={uangLaciFormatted}
                        onChange={(e) => {
                          setUangLaciFormatted(formatRibuanInput(e.target.value));
                          if (shiftFormError) setShiftFormError(null);
                        }}
                        placeholder="Contoh: 500.000"
                        autoFocus
                        required
                        className="w-full pl-10 pr-4 py-3 rounded-xl bg-black/90 border-2 border-amber-500/70 focus:border-amber-300 text-amber-200 font-mono font-black text-base outline-none shadow-[0_0_15px_rgba(245,158,11,0.15)]"
                      />
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {[200000, 300000, 500000, 1000000].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            setUangLaciFormatted(formatRibuanInput(preset));
                            if (shiftFormError) setShiftFormError(null);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/25 border border-amber-500/35 text-amber-200 text-[11px] font-mono font-bold transition cursor-pointer"
                        >
                          {fmtMoney(preset)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isStartingShift}
                  className="w-full mt-5 py-3.5 px-5 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-600 hover:from-amber-300 hover:to-yellow-500 text-black font-black text-sm uppercase tracking-wider shadow-[0_0_24px_rgba(245,158,11,0.35)] transition cursor-pointer disabled:opacity-50"
                >
                  {isStartingShift ? 'Memulai Shift & Membuka POS...' : '🚀 MULAI SHIFT & BUKA KASIR'}
                </button>
              </form>
            ) : (
              <>
                {/* Gembok Emas 3D */}
                <div className="lock-stage" aria-hidden="true">
                  <svg className="lock-svg" id="lockSvg" viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                      <linearGradient id="posLockShackle" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#fff7d1" />
                        <stop offset="0.3" stopColor="#ffd768" />
                        <stop offset="0.65" stopColor="#d89219" />
                        <stop offset="1" stopColor="#7a4c00" />
                      </linearGradient>
                      <linearGradient id="posLockBody" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#fff3be" />
                        <stop offset="0.28" stopColor="#ffd257" />
                        <stop offset="0.65" stopColor="#d99018" />
                        <stop offset="1" stopColor="#835002" />
                      </linearGradient>
                      <linearGradient id="posLockFace" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#ffe592" />
                        <stop offset="0.45" stopColor="#f3b632" />
                        <stop offset="1" stopColor="#9f6408" />
                      </linearGradient>
                      <radialGradient id="posKeyholeGlow" cx="0.5" cy="0.45" r="0.55">
                        <stop offset="0" stopColor="#2b1900" />
                        <stop offset="1" stopColor="#090500" />
                      </radialGradient>
                    </defs>

                    {/* Shackle (#shackle) */}
                    <g id="shackle">
                      <path
                        d="M62,96 L62,62 C62,36 79,20 100,20 C121,20 138,36 138,62 L138,96"
                        fill="none"
                        stroke="url(#posLockShackle)"
                        strokeWidth="20"
                        strokeLinecap="round"
                      />
                      <path
                        d="M66,94 L66,62 C66,40 81,25 100,25 C119,25 134,40 134,62 L134,94"
                        fill="none"
                        stroke="#fff9dc"
                        strokeWidth="3"
                        strokeLinecap="round"
                        opacity="0.65"
                      />
                    </g>

                    {/* Body Gembok */}
                    <rect x="38" y="88" width="124" height="104" rx="24" fill="url(#posLockBody)" stroke="#ffe89c" strokeWidth="2" />
                    <rect x="45" y="95" width="110" height="90" rx="19" fill="url(#posLockFace)" opacity="0.92" />
                    <path d="M52,100 L148,100" stroke="#fff8d8" strokeWidth="2.2" strokeLinecap="round" opacity="0.7" />

                    {/* Keyhole */}
                    <circle cx="100" cy="132" r="13" fill="url(#posKeyholeGlow)" stroke="#ffdc7b" strokeWidth="2" />
                    <path d="M94,138 L91,164 C91,167 94,170 97,170 L103,170 C106,170 109,167 109,164 L106,138 Z" fill="url(#posKeyholeGlow)" stroke="#ffdc7b" strokeWidth="1.6" />
                  </svg>
                </div>

                <h1 className="title" id="pinTitle">Enter Pin Cashier</h1>
                <p className="sub">Masukkan 6-digit PIN Kasir ({activeCashier?.name || 'Cashier'})</p>

                {/* 6 Kotak Titik PIN */}
                <div
                  className={`pin-boxes ${status === 'error' ? 'shake' : ''}`}
                  id="pinBoxes"
                  role="group"
                  aria-label="6-digit POS PIN"
                >
                  {[0, 1, 2, 3, 4, 5].map((idx) => {
                    const isFilled = idx < pinDigits.length;
                    const isCurrent = idx === activeIdx && pinDigits.length < 6;
                    return (
                      <div
                        key={idx}
                        className={`pin-box ${isFilled ? 'filled' : ''} ${isCurrent ? 'active' : ''}`}
                        onClick={() => {
                          setActiveIdx(Math.min(idx, pinDigits.length));
                          focusPinInput();
                        }}
                      >
                        <span className="dot" />
                      </div>
                    );
                  })}
                </div>

                <div className="pin-hint">
                  {isDemoMode ? (
                    <span>
                      Demo Mode PIN Cashier: <strong>123456</strong>
                    </span>
                  ) : (
                    <span>
                      Gunakan PIN 6 digit Kasir (Default/Demo: <strong>123456</strong>)
                    </span>
                  )}
                </div>

                {feedbackText && (
                  <div
                    className={`pin-feedback ${
                      status === 'error' ? 'error' : status === 'unlocked' ? 'ok' : ''
                    }`}
                  >
                    {feedbackText}
                  </div>
                )}

                {/* Touch Keypad for fast Cashier / Demo entry */}
                <div className="keypad" onClick={(e) => e.stopPropagation()}>
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                    <button
                      key={num}
                      type="button"
                      className="key-btn"
                      onClick={() => appendDigit(num)}
                    >
                      {num}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="key-btn sub-action"
                    onClick={() => navigate('/dashboard')}
                  >
                    Dashboard
                  </button>
                  <button
                    type="button"
                    className="key-btn"
                    onClick={() => appendDigit('0')}
                  >
                    0
                  </button>
                  <button
                    type="button"
                    className="key-btn sub-action"
                    onClick={removeLastDigit}
                  >
                    ⌫ Hapus
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
};

