import React, { useState, useEffect } from 'react';
import {
  Store,
  Menu,
  DollarSign,
  Lock,
  Unlock,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { PWAInstallButton } from './PWAInstallButton';
import { ThemeToggleButton } from './ThemeToggleButton';
import { RiskCartLogo } from './RiskCartLogo';
import { useLanguage } from '../../context/LanguageContext';
import { useAccessControl } from '../../context/AccessControlContext';
import { AppLink, getPathForTab } from '../../router';

function getJakartaHourWib(): number {
  try {
    const hourStr = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      hour12: false,
    }).format(new Date());
    const h = parseInt(hourStr, 10);
    return isNaN(h) ? new Date().getHours() : h % 24;
  } catch {
    return new Date().getHours();
  }
}

function readCachedOpenShift(): any | null {
  try {
    const raw =
      localStorage.getItem('riskcart_active_shift') ||
      localStorage.getItem('riskcart_active_open_shift');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const st = String(parsed?.status || '').toLowerCase();
    if (parsed && (st === 'open' || st === 'aktif')) {
      return parsed;
    }
  } catch {}
  return null;
}

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onToggleSidebar?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onToggleSidebar,
}) => {
  const { currencyMode, setCurrencyMode, toggleCurrency, exchangeRate, isRateLive, tr } = useLanguage();
  const { isDemoMode, resetDemoData, activeRoleId, logout, lockPosSession } = useAccessControl();
  const navigate = useNavigate();
  const [pendingPwaCount, setPendingPwaCount] = useState<number>(0);
  const [resetToast, setResetToast] = useState<boolean>(false);
  const [activeShift, setActiveShift] = useState<any | null>(() => readCachedOpenShift());
  const [isAfter18Wib, setIsAfter18Wib] = useState<boolean>(() => getJakartaHourWib() >= 18);

  const handleResetDemo = () => {
    resetDemoData();
    setResetToast(true);
    setTimeout(() => setResetToast(false), 2500);
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIsAfter18Wib(getJakartaHourWib() >= 18);
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let latestFirestoreOpenShift: any | null = null;

    const syncShiftState = () => {
      const cached = readCachedOpenShift();
      if (cached) {
        setActiveShift(cached);
      } else {
        setActiveShift(latestFirestoreOpenShift);
      }
    };

    const handleShiftClosed = () => {
      latestFirestoreOpenShift = null;
      setActiveShift(null);
    };

    const handleShiftOpened = (ev: Event) => {
      const custom = ev as CustomEvent<any>;
      if (custom?.detail) {
        latestFirestoreOpenShift = custom.detail;
        setActiveShift(custom.detail);
      } else {
        syncShiftState();
      }
    };

    const handleShiftStatusChanged = () => {
      const cached = readCachedOpenShift();
      if (!cached) {
        latestFirestoreOpenShift = null;
        setActiveShift(null);
      } else {
        latestFirestoreOpenShift = cached;
        setActiveShift(cached);
      }
    };

    window.addEventListener('shift-status-changed', handleShiftStatusChanged);
    window.addEventListener('riskcart:shift-closed', handleShiftClosed);
    window.addEventListener('riskcart:shift-opened', handleShiftOpened);
    window.addEventListener('riskcart:shift-updated', syncShiftState);
    window.addEventListener('storage', syncShiftState);

    const unsubShifts = onSnapshot(
      collection(db, 'shifts'),
      (snap) => {
        const openDocs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((s) => {
            const st = String(s.status || '').toLowerCase();
            return st === 'open' || st === 'aktif';
          });
        if (openDocs.length > 0) {
          openDocs.sort((a, b) => {
            const ta = new Date(a.openedAt || a.createdAt || 0).getTime();
            const tb = new Date(b.openedAt || b.createdAt || 0).getTime();
            return tb - ta;
          });
          latestFirestoreOpenShift = openDocs[0];
          setActiveShift(openDocs[0]);
        } else {
          latestFirestoreOpenShift = null;
          const cached = readCachedOpenShift();
          // Verify cached shift is not explicitly marked closed in Firestore
          const isCachedClosed =
            cached &&
            snap.docs.some(
              (d) =>
                d.id === cached.id &&
                String((d.data() as any)?.status || '').toLowerCase() === 'closed'
            );
          if (isCachedClosed) {
            try {
              localStorage.removeItem('riskcart_active_shift');
              localStorage.removeItem('riskcart_active_open_shift');
            } catch {}
            setActiveShift(null);
          } else {
            setActiveShift(cached);
          }
        }
      },
      (err) => console.warn('Navbar shifts listener notice:', err)
    );

    return () => {
      window.removeEventListener('shift-status-changed', handleShiftStatusChanged);
      window.removeEventListener('riskcart:shift-closed', handleShiftClosed);
      window.removeEventListener('riskcart:shift-opened', handleShiftOpened);
      window.removeEventListener('riskcart:shift-updated', syncShiftState);
      window.removeEventListener('storage', syncShiftState);
      unsubShifts();
    };
  }, []);

  useEffect(() => {
    const qTx = query(collection(db, 'transactions'), orderBy('createdAt', 'desc'), limit(25));
    const unsub = onSnapshot(
      qTx,
      (snapshot) => {
        let count = 0;
        snapshot.forEach((d) => {
          const data = d.data();
          if (
            data.channel === 'pwa_client' &&
            (data.status === 'pending_approval' || data.status === 'pending')
          ) {
            count++;
          }
        });
        setPendingPwaCount(count);
      },
      (err) => console.warn('Navbar transactions listener notice:', err)
    );
    return () => unsub();
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {}
    } finally {
      window.location.replace('/login');
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-amber-500/40 bg-[#0d0b07]/95 backdrop-blur-md shadow-[0_0_18px_rgba(245,158,11,0.12)]">
      <nav className="navbar w-full px-3 sm:px-6 py-1 sm:py-2.5 flex items-center justify-between min-h-[44px] sm:h-16">
        {/* Left Section: Hamburger Menu & Brand Logo */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="p-1.5 sm:p-2 rounded-xl bg-[#14110b] border border-amber-500/40 hover:bg-amber-500/15 text-amber-300 hover:text-amber-100 transition flex items-center justify-center shadow-[0_0_10px_rgba(245,158,11,0.12)] cursor-pointer"
              title={tr('Toggle & Minimize Sidebar', 'Buka / Ciutkan Sidebar')}
              aria-label="Toggle Sidebar Menu"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}

          <AppLink
            to={getPathForTab('landing')}
            className="cursor-pointer group shrink-0"
            title="RiskCart Artificial Intelligence"
          >
            <RiskCartLogo size="md" />
          </AppLink>
        </div>

        {/* Right CTA: Sandbox Demo Indicator, Shift Action Button (Tutup Shift / Mulai Shift Baru), Install App & Logout */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {isDemoMode && (
            <div className="flex items-center gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-xl bg-amber-500/15 border border-amber-400/60 shadow-[0_0_12px_rgba(245,158,11,0.18)]">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
              <span className="text-[11px] font-black tracking-wider text-amber-300 uppercase whitespace-nowrap">
                SANDBOX DEMO {activeRoleId === 'cashier' ? '(KASIR)' : '(ADMIN)'}
              </span>
              <button
                type="button"
                onClick={handleResetDemo}
                className="ml-1 px-2 py-0.5 rounded-lg bg-amber-400/20 hover:bg-amber-400/35 border border-amber-300/50 text-amber-100 text-[11px] font-bold transition cursor-pointer whitespace-nowrap"
                title="Kembalikan data sesi Sandbox Demo ke kondisi awal tanpa mengubah Cloud Firestore"
              >
                {resetToast ? '✓ Data Direset' : '↻ Reset Data Demo'}
              </button>
            </div>
          )}

          {/* Shift Status Action Button: "Tutup Shift" if activeShift is open, otherwise "Mulai Shift Baru" */}
          {activeShift ? (
            <AppLink
              to="/dashboard/shift/kasir/endshift"
              className={`flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer border ${
                isAfter18Wib
                  ? 'bg-rose-600/25 text-rose-100 border-rose-500 hover:bg-rose-600/35 animate-pulse shadow-[0_0_16px_rgba(244,63,94,0.45)]'
                  : activeTab === 'module_shift'
                  ? 'bg-[#18130a] text-amber-200 border-amber-400/70 shadow-[0_0_14px_rgba(245,158,11,0.22)]'
                  : 'bg-[#110f0a] text-amber-100 border-amber-500/40 hover:text-amber-200 hover:border-amber-400/70 hover:bg-amber-500/15 shadow-[0_0_10px_rgba(245,158,11,0.12)]'
              }`}
              title={tr('Close Active Cashier Shift (End Shift)', 'Tutup Shift Kasir Aktif (End Shift)')}
            >
              <Lock
                className={`w-3.5 h-3.5 shrink-0 ${
                  isAfter18Wib ? 'text-rose-400' : 'text-amber-400'
                }`}
              />
              <span>{tr('Tutup Shift', 'Tutup Shift')}</span>
            </AppLink>
          ) : (
            <AppLink
              to={getPathForTab('pos_machine')}
              onClick={() => {
                try {
                  sessionStorage.removeItem('riskcart_pos_pin_verified');
                  lockPosSession();
                } catch {}
              }}
              className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-xl text-xs font-black transition whitespace-nowrap cursor-pointer border bg-gradient-to-r from-emerald-500/25 via-teal-500/20 to-amber-500/25 text-emerald-200 border-emerald-400/70 hover:border-amber-300 hover:text-white shadow-[0_0_14px_rgba(16,185,129,0.28)]"
              title={tr('Start New Cashier Shift (Open POS)', 'Mulai Shift Kasir Baru (Buka POS)')}
            >
              <Unlock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>{tr('Mulai Shift Baru', 'Mulai Shift Baru')}</span>
            </AppLink>
          )}

          <ThemeToggleButton />

          <PWAInstallButton />

          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-xl bg-[#14110b] hover:bg-rose-500/15 border border-amber-500/35 hover:border-rose-500/50 text-amber-200 hover:text-rose-300 text-xs font-bold transition cursor-pointer"
            title={tr('Sign Out / Switch Account', 'Keluar / Ganti Akun')}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden lg:inline">{tr('Logout', 'Keluar')}</span>
          </button>
        </div>
      </nav>
    </header>
  );
};
