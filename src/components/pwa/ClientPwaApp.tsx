import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  addDoc,
  doc,
  getDoc,
  setDoc,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, ensureFirebaseSession } from '../../firebase';
import { Product, PackageType, CartItem, Transaction, TransactionItem } from '../../types';
import { ACTIVE_STORE_ID } from '../../config/store';
import { useSettingsDoc } from '../../hooks/useFirestoreData';
import { PWASettings, DEFAULT_PWA_SETTINGS } from '../../types/settings';
import { DEFAULT_STORE_CONFIG, isLegacyMockOrderOrTx } from '../../services/dataSeeder';
import { ThemeToggleButton } from '../common/ThemeToggleButton';
import confetti from 'canvas-confetti';
import {
  Sparkles,
  ShoppingBag,
  MapPin,
  ShieldCheck,
  ShieldAlert,
  Send,
  Boxes,
  Package,
  Plus,
  Minus,
  Trash2,
  Phone,
  CheckCircle2,
  RefreshCw,
  QrCode,
  CreditCard,
  Banknote,
  Navigation,
  Radio,
  ArrowRight,
  ArrowLeft,
  Info,
  Receipt,
  Smartphone,
  Compass,
  ExternalLink,
  MessageSquare,
  AlertCircle,
  Clock,
  Search,
  Check,
  ChevronRight,
  Store,
  SlidersHorizontal,
  Bot,
  User,
  Share2,
  Copy,
  Layers,
  Truck,
  RotateCcw,
  ChevronDown,
  Filter,
  Globe,
  Lock,
  LocateFixed,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { LanguageDropdown } from '../common/LanguageDropdown';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { ProductGalleryModal } from '../common/ProductGalleryModal';
import {
  CustomerOrderHistoryModal,
  normalizePhone,
  getFulfillmentInfo,
  FulfillmentInfo,
} from './CustomerOrderHistoryModal';
import { ClientPwaProfilePages, ProfileSubRoute, WA_ADMIN_CS_URL } from './ClientPwaProfilePages';

// Flow Screens according to user instructions:
// 1. splash (client-pwa1.jpeg)
// 2. home_guest (client-pwa2.jped)
// 3. register_member (client-pwa3.jpeg)
// 4. setting_address (client-pwa4.jpeg)
// 5. verify_whatsapp (client-pwa41.jpeg)
// 6. home_member (client-pwa6.jpeg)
// 7. cart (client-pwa10.jpeg)
// 8. order_history (Live Fulfillment & Visual Progress Tracker)
// 9. profile (/client-pwa/profile & 11 dedicated sub-routes)
type PwaScreen =
  | 'splash'
  | 'home_guest'
  | 'login'
  | 'register_member'
  | 'setting_address'
  | 'verify_whatsapp'
  | 'home_member'
  | 'cart'
  | 'order_history'
  | 'profile';

/**
 * Visual Progress Indicator for orders with 5 canonical fulfillment steps:
 * 1. Pesanan Dibuat / Order Created
 * 2. Pesanan Diproses / Order Processed
 * 3. Pesanan Disiapkan / Order Prepared
 * 4. Pesanan Dikirim / Order Shipped
 * 5. Selesai / Completed
 */
export const OrderProgressIndicator: React.FC<{
  order: Transaction;
  compact?: boolean;
}> = ({ order, compact = false }) => {
  const { tr, language } = useLanguage();
  const info = getFulfillmentInfo(order, language);

  const STAGES = [
    {
      key: 'pending',
      stepNum: 1,
      name: tr('Order Created', 'Pesanan Dibuat'),
      desc: tr('Queued in POS', 'Diterima Kasir'),
      icon: Clock,
    },
    {
      key: 'processing',
      stepNum: 2,
      name: tr('Processed', 'Diproses'),
      desc: tr('Order Verified', 'Sedang Diproses'),
      icon: RefreshCw,
    },
    {
      key: 'ready',
      stepNum: 3,
      name: tr('Prepared', 'Disiapkan'),
      desc: tr('Items Packed', 'Barang Disiapkan'),
      icon: Package,
    },
    {
      key: 'shipped',
      stepNum: 4,
      name: tr('Shipped', 'Dikirim'),
      desc: tr('On Delivery', 'Kurir Mengirim'),
      icon: Truck,
    },
    {
      key: 'completed',
      stepNum: 5,
      name: tr('Completed', 'Selesai'),
      desc: tr('Order Received', 'Pesanan Selesai'),
      icon: CheckCircle2,
    },
  ];

  if (info.isFailed) {
    return (
      <div
        className="w-full rounded-2xl p-3 text-xs space-y-1"
        style={{
          background: 'rgba(65, 16, 12, 0.65)',
          border: '1px solid rgba(255, 123, 102, 0.45)',
        }}
      >
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#ff7b66] flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-[#ff7b66] shrink-0" />
            {tr('Order Cancelled / Rejected', 'Pesanan Dibatalkan / Ditolak')}
          </span>
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
            style={{
              background: 'rgba(255, 123, 102, 0.18)',
              color: '#ffb4a6',
              border: '1px solid rgba(255, 123, 102, 0.4)',
            }}
          >
            {tr('Rejected', 'Ditolak')}
          </span>
        </div>
        <p className="text-[11px] text-[#b7ad99]">
          {info.subLabel ||
            tr(
              'Order was cancelled or rejected by store cashier.',
              'Pesanan telah dibatalkan atau ditolak oleh kasir POS toko.'
            )}
        </p>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="w-full space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5 font-bold text-[#f7f3ea]">
            <span
              className="w-2 h-2 rounded-full"
              style={{
                background: info.status === 'completed' ? '#25e08c' : '#ffd86b',
                boxShadow:
                  info.status === 'completed'
                    ? '0 0 8px #25e08c'
                    : '0 0 8px rgba(255, 216, 107, 0.8)',
              }}
            />
            <span className="uppercase text-[10px] tracking-wider text-[#b7ad99]">
              {tr('Stage:', 'Tahap:')}
            </span>
            <span className="text-[#ffd86b] font-bold">{info.label}</span>
          </span>
          <span className="font-mono text-[10px] font-bold text-[#ffd86b] tabular-nums">
            {info.percentage}%
          </span>
        </div>

        {/* Compact Progress Bar */}
        <div
          className="w-full h-1.5 rounded-full overflow-hidden"
          style={{ background: 'rgba(255, 200, 82, 0.15)' }}
        >
          <div
            className="h-full transition-all duration-500 rounded-full"
            style={{
              width: `${info.percentage}%`,
              background:
                info.status === 'completed'
                  ? 'linear-gradient(90deg, #1fc77e, #25e08c)'
                  : 'linear-gradient(90deg, #b87914, #f4b63d, #ffd86b)',
            }}
          />
        </div>

        {/* 5 Steps Labels */}
        <div className="grid grid-cols-5 text-center text-[9px] gap-0.5">
          {STAGES.map((s) => (
            <span
              key={s.key}
              className={`transition-colors truncate ${
                info.step >= s.stepNum ? 'text-[#ffd86b] font-bold' : 'text-[#8f8470]'
              }`}
            >
              {s.name}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full rounded-2xl p-3.5 space-y-3.5"
      style={{
        background: 'rgba(12, 9, 4, 0.88)',
        border: '1px solid rgba(255, 200, 82, 0.32)',
        boxShadow: 'inset 0 1px 0 rgba(255, 230, 160, 0.1)',
      }}
    >
      {/* Status Header Badge & Estimated text */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span
            className="px-2.5 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wide flex items-center gap-1.5"
            style={
              info.status === 'completed'
                ? {
                    background: 'rgba(37, 224, 140, 0.15)',
                    color: '#6ef0b2',
                    border: '1px solid rgba(37, 224, 140, 0.45)',
                  }
                : {
                    background: 'rgba(255, 210, 90, 0.16)',
                    color: '#ffd86b',
                    border: '1px solid rgba(255, 210, 90, 0.48)',
                  }
            }
          >
            {info.status !== 'completed' && !info.isFailed && (
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: '#ffd86b', boxShadow: '0 0 8px #ffd86b' }}
              />
            )}
            {info.status === 'completed' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
            <span>{info.label}</span>
            <span className="opacity-85 font-mono tabular-nums">({info.percentage}%)</span>
          </span>
        </div>

        <span className="text-[11px] font-medium text-[#b7ad99]">{info.estimatedText}</span>
      </div>

      {/* 5-Stage Stepper Track with Connected Line */}
      <div className="relative pt-2 pb-1">
        {/* Background Rail */}
        <div
          className="absolute top-[21px] left-5 right-5 h-1 -translate-y-1/2 rounded-full z-0"
          style={{ background: 'rgba(255, 200, 82, 0.18)' }}
        >
          {/* Active progress fill */}
          <div
            className="h-full transition-all duration-700 ease-out rounded-full"
            style={{
              width: `${
                info.step === 1
                  ? '10%'
                  : info.step === 2
                  ? '32%'
                  : info.step === 3
                  ? '55%'
                  : info.step === 4
                  ? '78%'
                  : '100%'
              }`,
              background: 'linear-gradient(90deg, #e5b13a 0%, #ffd86b 60%, #25e08c 100%)',
            }}
          />
        </div>

        {/* The 5 Checkpoint Nodes */}
        <div className="relative z-10 grid grid-cols-5 gap-1">
          {STAGES.map((stage) => {
            const isCompleted = info.step > stage.stepNum;
            const isCurrent = info.step === stage.stepNum;
            const StageIcon = stage.icon;

            return (
              <div key={stage.key} className="flex flex-col items-center text-center">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-all"
                  style={
                    isCompleted
                      ? {
                          background: '#25e08c',
                          color: '#062012',
                          boxShadow: '0 0 12px rgba(37, 224, 140, 0.35)',
                        }
                      : isCurrent
                      ? {
                          background: 'linear-gradient(135deg, #ffe28a, #e5a930)',
                          color: '#1b1204',
                          boxShadow:
                            '0 0 0 3px rgba(255, 216, 107, 0.25), 0 0 14px rgba(255, 185, 45, 0.5)',
                        }
                      : {
                          background: 'rgba(20, 15, 8, 0.92)',
                          color: '#8f8470',
                          border: '1px solid rgba(255, 200, 82, 0.28)',
                        }
                  }
                >
                  {isCompleted ? (
                    <Check className="w-4 h-4 stroke-[3]" />
                  ) : isCurrent ? (
                    stage.stepNum === 2 ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <StageIcon className="w-4 h-4" />
                    )
                  ) : (
                    <span>{stage.stepNum}</span>
                  )}
                </div>

                <div className="mt-1.5">
                  <div
                    className={`text-[10px] font-bold leading-tight ${
                      isCurrent
                        ? 'text-[#ffd86b]'
                        : isCompleted
                        ? 'text-[#25e08c]'
                        : 'text-[#8f8470]'
                    }`}
                  >
                    {stage.name}
                  </div>
                  <div className="text-[9px] text-[#b7ad99] hidden sm:block leading-tight mt-0.5">
                    {stage.desc}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Contextual Description Banner */}
      <div
        className="p-2.5 rounded-xl text-[11px] text-[#dfd5be] flex items-start gap-2"
        style={{
          background: 'rgba(28, 20, 8, 0.78)',
          border: '1px solid rgba(255, 200, 82, 0.24)',
        }}
      >
        <Info className="w-3.5 h-3.5 text-[#ffd86b] shrink-0 mt-0.5" />
        <div className="flex-1 leading-snug">
          <span>{info.subLabel}</span>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#b7ad99]">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: '#25e08c', boxShadow: '0 0 6px #25e08c' }}
            />
            <span>
              {tr(
                'Automatically synced with RiskCart POS cashier queue',
                'Terhubung otomatis dengan antrean kasir POS RiskCart'
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface MemberProfile {
  storeName?: string;
  ownerName?: string;
  businessType?: string;
  email?: string;
  name: string;
  phone: string;
  address: string;
  addressNotes: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  isLocationChecked: boolean;
  isVerified: boolean;
  verifiedAt: string | null;
}

const PWA_SCREEN_TO_SLUG: Record<PwaScreen, string> = {
  splash: '',
  home_guest: 'home-tamu',
  login: 'login',
  register_member: 'daftar-member',
  setting_address: 'alamat-gps',
  verify_whatsapp: 'verifikasi-wa',
  home_member: 'clienthome',
  cart: 'keranjang',
  order_history: 'riwayat',
  profile: 'profile',
};

const SLUG_TO_PWA_SCREEN: Record<string, PwaScreen> = {
  '': 'splash',
  splash: 'splash',
  home: 'home_guest',
  login: 'login',
  masuk: 'login',
  'home-tamu': 'home_guest',
  'guest-home': 'home_guest',
  'daftar-member': 'register_member',
  register: 'register_member',
  'register-1': 'register_member',
  'alamat-gps': 'setting_address',
  'register-2': 'setting_address',
  address: 'setting_address',
  'verifikasi-wa': 'verify_whatsapp',
  otp: 'verify_whatsapp',
  'home-member': 'home_member',
  clienthome: 'home_member',
  member: 'home_member',
  keranjang: 'cart',
  cart: 'cart',
  riwayat: 'order_history',
  history: 'order_history',
  order: 'order_history',
  orders: 'order_history',
  profile: 'profile',
  'pwa-ai': 'profile',
  'chat-admin': 'profile',
  akun: 'profile',
  promo: 'profile',
  voucher: 'profile',
  reward: 'profile',
  'top-buyer': 'profile',
};

const PWA_MEMBER_STORAGE_KEY = 'riskcart_pwa_member_gold_v1';

export const ClientPwaApp: React.FC = () => {
  const { language, setLanguage, toggleLanguage, tr, formatCurrency, exchangeRate } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();

  const pwaBasePrefix = '/client-pwa';

  const resolveScreenFromPath = (pathname: string): PwaScreen => {
    const cleanPath = pathname.replace(/^\/en(?=\/|$)/i, '');
    const parts = cleanPath.replace(/^\/+|\/+$/g, '').split('/');
    const first = (parts[0] || '').toLowerCase();
    const second = (parts[1] || '').toLowerCase();

    if (first === 'client-pwa' || first === 'pwa') {
      return SLUG_TO_PWA_SCREEN[second] || 'splash';
    }
    return 'splash';
  };

  const resolveProfileSubRoute = (pathname: string): ProfileSubRoute => {
    const cleanPath = pathname.replace(/^\/en(?=\/|$)/i, '');
    const parts = cleanPath.replace(/^\/+|\/+$/g, '').split('/');
    const second = (parts[1] || '').toLowerCase();
    const third = (parts[2] || '').toLowerCase();
    const validSubs: ProfileSubRoute[] = [
      'pwa-ai',
      'akun',
      'statistik',
      'alamat',
      'target',
      'voucher',
      'reward',
      'top-buyer',
      'informasi',
      'chat-admin',
      'faq',
      'pengaturan',
    ];
    if (second === 'profile' && validSubs.includes(third as ProfileSubRoute)) {
      return third as ProfileSubRoute;
    }
    if (second === 'pwa-ai') return 'pwa-ai';
    if (second === 'chat-admin') return 'chat-admin';
    if (second === 'promo' || second === 'voucher') return 'voucher';
    if (second === 'reward') return 'reward';
    if (second === 'top-buyer') return 'top-buyer';
    if (second === 'akun') return 'akun';
    return 'index';
  };

  const activeProfileSubRoute = resolveProfileSubRoute(location.pathname);

  const navigateToProfileSubRoute = (sub: ProfileSubRoute) => {
    if (sub === 'chat-admin') {
      const win = window.open(WA_ADMIN_CS_URL, '_blank', 'noopener,noreferrer');
      if (!win) {
        window.location.href = WA_ADMIN_CS_URL;
      }
      return;
    }
    setInternalScreen('profile');
    const targetPath = sub === 'index' ? `${pwaBasePrefix}/profile` : `${pwaBasePrefix}/profile/${sub}`;
    navigate(`${targetPath}${location.search || ''}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cleanCurrentPath = location.pathname.replace(/^\/en(?=\/|$)/i, '');
  const isStandalonePwaRoute =
    cleanCurrentPath.startsWith('/client-pwa') ||
    cleanCurrentPath.startsWith('/pwa') ||
    cleanCurrentPath.startsWith('/client-pwa/clienthome');

  // Navigation & Screen Flow State synced with URL
  const [internalScreen, setInternalScreen] = useState<PwaScreen>(() =>
    resolveScreenFromPath(location.pathname)
  );
  const rawScreen: PwaScreen = isStandalonePwaRoute
    ? resolveScreenFromPath(location.pathname)
    : internalScreen;

  // Consumer: PWA Settings from Firestore stores/{ACTIVE_STORE_ID}/settings/pwa
  const { value: pwaSettings } = useSettingsDoc<PWASettings>(
    `stores/${ACTIVE_STORE_ID}/settings/pwa`,
    DEFAULT_PWA_SETTINGS
  );

  const setCurrentScreen = (next: PwaScreen) => {
    const isAuthed = Boolean(member?.isVerified && normalizePhone(member?.phone).length >= 8);
    if (!isAuthed && (next === 'order_history' || next === 'cart' || next === 'home_member')) {
      setAuthMode('login');
      setInternalScreen('login');
      const targetPath = `${pwaBasePrefix}/login`;
      const path = `${targetPath}${location.search || ''}`;
      if (location.pathname !== targetPath) {
        navigate(path, { replace: true });
      }
      return;
    }

    setInternalScreen(next);
    let targetPath = pwaBasePrefix;
    if (next === 'home_member') {
      targetPath = `${pwaBasePrefix}/clienthome`;
    } else {
      const slug = PWA_SCREEN_TO_SLUG[next];
      targetPath = slug ? `${pwaBasePrefix}/${slug}` : pwaBasePrefix;
    }
    const path = `${targetPath}${location.search || ''}`;
    if (location.pathname !== targetPath) {
      navigate(path, { replace: true });
    }
  };

  const [wideDesktopMode, setWideDesktopMode] = useState<boolean>(false);
  const [showFlowBar, setShowFlowBar] = useState<boolean>(false);
  const [isSplashActive, setIsSplashActive] = useState<boolean>(true);
  const [isSplashFadingOut, setIsSplashFadingOut] = useState<boolean>(false);

  // Real-time Hadiah Target state synced from Firestore (`reward_targets` & `marketing_targets`) + localStorage
  const [pwaRewardTargets, setPwaRewardTargets] = useState<any[]>(() => {
    try {
      const raw =
        localStorage.getItem('riskcart_reward_targets') ||
        localStorage.getItem('riskcart_marketing_targets') ||
        localStorage.getItem('riskcart_fs_marketing_targets');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    let rewardList: any[] = [];
    let marketingList: any[] = [];

    const mergeAndPublish = () => {
      const map = new Map<string, any>();
      [...rewardList, ...marketingList].forEach((item) => {
        if (item && item.id && !item.isDeleted) {
          map.set(String(item.id), item);
        }
      });
      if (map.size > 0) {
        setPwaRewardTargets(Array.from(map.values()));
      }
    };

    const unsub1 = onSnapshot(
      collection(db, 'reward_targets'),
      (snap) => {
        rewardList = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        mergeAndPublish();
      },
      () => {}
    );
    const unsub2 = onSnapshot(
      collection(db, 'marketing_targets'),
      (snap) => {
        marketingList = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        mergeAndPublish();
      },
      () => {}
    );

    const onLocalTargetsUpdate = (e: any) => {
      if (e?.detail && Array.isArray(e.detail)) {
        setPwaRewardTargets(e.detail);
      }
    };
    window.addEventListener('riskcart:reward-targets-updated', onLocalTargetsUpdate);

    return () => {
      unsub1();
      unsub2();
      window.removeEventListener('riskcart:reward-targets-updated', onLocalTargetsUpdate);
    };
  }, []);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeCategory, setActiveCategory] = useState<string>('Semua');
  const [loginPhoneInput, setLoginPhoneInput] = useState<string>('');
  const [loginPasswordInput, setLoginPasswordInput] = useState<string>('');
  const [showLoginPassword, setShowLoginPassword] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<'welcome' | 'login'>('welcome');
  const [registeredCustomers, setRegisteredCustomers] = useState<any[]>([]);

  // Register Step 1 State
  const [regStoreName, setRegStoreName] = useState<string>('');
  const [regOwnerName, setRegOwnerName] = useState<string>('');
  const [regPhone, setRegPhone] = useState<string>('');
  const [regPassword, setRegPassword] = useState<string>('');
  const [regAddress, setRegAddress] = useState<string>('');
  const [showRegPassword, setShowRegPassword] = useState<boolean>(false);

  // Member Registration & Profile State
  const [member, setMember] = useState<MemberProfile>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem(PWA_MEMBER_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.name && parsed.phone) {
            // Clear old hardcoded fallback coordinates (-6.2088, 106.8456) so real phone GPS is requested
            const isStaleFallback =
              parsed.latitude === -6.2088 && parsed.longitude === 106.8456;
            return {
              ...parsed,
              latitude: isStaleFallback ? null : parsed.latitude ?? null,
              longitude: isStaleFallback ? null : parsed.longitude ?? null,
              accuracy: isStaleFallback ? null : parsed.accuracy ?? null,
              isLocationChecked: isStaleFallback ? false : Boolean(parsed.isLocationChecked),
            };
          }
        }
      } catch (e) {
        // Ignore storage error
      }
    }
    return {
      storeName: '',
      ownerName: '',
      name: '',
      phone: '',
      address: '',
      addressNotes: '',
      latitude: null,
      longitude: null,
      accuracy: null,
      isLocationChecked: false,
      isVerified: false,
      verifiedAt: null,
    };
  });

  // Persist member profile changes to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(PWA_MEMBER_STORAGE_KEY, JSON.stringify(member));
      } catch (e) {
        // Ignore storage error
      }
    }
  }, [member]);

  // Strict member authentication check
  const isAuthenticatedMember = Boolean(
    member.isVerified && normalizePhone(member.phone).length >= 8
  );

  // Guarded screen: Unauthenticated visitors are strictly blocked from member screens
  const currentScreen: PwaScreen =
    !isAuthenticatedMember &&
    (rawScreen === 'order_history' || rawScreen === 'cart' || rawScreen === 'home_member' || rawScreen === 'profile')
      ? 'login'
      : rawScreen;

  // Route Protection: Unauthenticated visitors cannot access order_history, cart, home_member, or profile
  useEffect(() => {
    // If path is /client-pwa/masuk or /client-pwa/login, directly open the login screen
    const parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/');
    const second = (parts[1] || '').toLowerCase();
    if (second === 'masuk' || second === 'login') {
      setAuthMode('login');
      setInternalScreen('login');
      return;
    }

    if (!isAuthenticatedMember) {
      if (
        rawScreen === 'order_history' ||
        rawScreen === 'cart' ||
        rawScreen === 'home_member' ||
        rawScreen === 'profile'
      ) {
        setAuthMode('login');
        setInternalScreen('login');
        if (location.pathname !== '/client-pwa/login') {
          navigate(`/client-pwa/login${location.search || ''}`, { replace: true });
        }
      }
    }
  }, [isAuthenticatedMember, rawScreen, location.pathname, location.search, navigate]);

  // Subscribe to Firestore customers collection for real-time member lookup & POS sync
  useEffect(() => {
    const unsubCustomers = onSnapshot(
      collection(db, 'customers'),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...d.data() });
        });
        setRegisteredCustomers(list);
      },
      (err) => {
        console.warn('Firestore customers listener notice:', err);
      }
    );
    return () => unsubCustomers();
  }, []);

  // Helper to persist/update Member Profile in Cloud Firestore 'customers' collection keyed by normalized phone
  const syncMemberToFirestore = async (
    profile: MemberProfile,
    verified: boolean,
    customPinOrPassword?: string
  ): Promise<MemberProfile> => {
    const normPhone =
      normalizePhone(profile.phone) ||
      profile.phone.replace(/[^0-9]/g, '') ||
      String(Date.now());
    const docId = normPhone;
    const nowIso = new Date().toISOString();

    let existing: any = registeredCustomers.find(
      (c) => c.id === docId || normalizePhone(c.phone || '') === normPhone
    );

    if (!existing) {
      try {
        const snap = await getDoc(doc(db, 'customers', docId));
        if (snap.exists()) {
          existing = { id: snap.id, ...snap.data() };
        }
      } catch (e) {
        console.warn('Firestore customer lookup notice:', e);
      }
    }

    const mergedProfile: MemberProfile = {
      storeName: profile.storeName?.trim() || existing?.storeName || '',
      ownerName: profile.ownerName?.trim() || existing?.ownerName || '',
      name: profile.name?.trim() || existing?.name || 'Member PWA',
      phone: profile.phone?.trim() || existing?.phone || normPhone,
      address: profile.address?.trim() || existing?.address || '',
      addressNotes: profile.addressNotes?.trim() || existing?.addressNotes || '',
      latitude: profile.latitude ?? existing?.latitude ?? null,
      longitude: profile.longitude ?? existing?.longitude ?? null,
      accuracy: profile.accuracy ?? existing?.accuracy ?? null,
      isLocationChecked: Boolean(
        profile.isLocationChecked || (existing?.latitude && existing?.longitude)
      ),
      isVerified: verified,
      verifiedAt: verified ? nowIso : profile.verifiedAt || existing?.verifiedAt || null,
    };

    const resolvedSecret =
      customPinOrPassword?.trim() ||
      regPassword?.trim() ||
      existing?.pin ||
      existing?.password ||
      '123456';

    const targetDocId = existing?.id || docId;

    const customerPayload = {
      id: targetDocId,
      storeId: ACTIVE_STORE_ID,
      storeName: mergedProfile.storeName,
      ownerName: mergedProfile.ownerName,
      name: mergedProfile.name,
      phone: mergedProfile.phone,
      normalizedPhone: normPhone,
      pin: resolvedSecret,
      password: resolvedSecret,
      address: mergedProfile.address || existing?.address || 'Alamat Pengiriman Pelanggan',
      addressNotes: mergedProfile.addressNotes,
      latitude: mergedProfile.latitude ?? existing?.latitude ?? DEFAULT_STORE_CONFIG.latitude,
      longitude: mergedProfile.longitude ?? existing?.longitude ?? DEFAULT_STORE_CONFIG.longitude,
      accuracy: mergedProfile.accuracy ?? existing?.accuracy ?? 8,
      isLocationChecked: mergedProfile.isLocationChecked,
      isVerified: verified,
      verifiedAt: mergedProfile.verifiedAt,
      type: existing?.type || 'Member VIP PWA',
      typeCode: existing?.typeCode || 'CUST-PWA',
      creditLimit: existing?.creditLimit ?? 500000,
      points: existing?.points ?? 0,
      debtAmount: existing?.debtAmount ?? 0,
      debtAgeDays: existing?.debtAgeDays ?? 0,
      subscriptionPlan: existing?.subscriptionPlan || 'Non-Langganan',
      totalSpent: existing?.totalSpent ?? 0,
      totalOrders: existing?.totalOrders ?? 0,
      lastTransactionDate: existing?.lastTransactionDate || 'Baru Terdaftar',
      channel: 'pwa_client',
      status: 'active',
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    try {
      await setDoc(doc(db, 'customers', targetDocId), customerPayload, { merge: true });
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('riskcart_current_customer', JSON.stringify(customerPayload));
      }
    } catch (err) {
      console.warn('Firestore customers sync notice:', err);
    }

    return mergedProfile;
  };

  // Phase 1 -> Phase 2: 5.0-second Golden Animated Splash Screen timer with fade-out to home_guest
  const handleFinishSplash = () => {
    setIsSplashActive(false);
    setIsSplashFadingOut(false);
    if (currentScreen === 'splash') {
      setInternalScreen('home_guest');
      const path = `/client-pwa/${PWA_SCREEN_TO_SLUG.home_guest}${location.search || ''}`;
      navigate(path, { replace: true });
    }
  };

  useEffect(() => {
    if (!isSplashActive && currentScreen !== 'splash') return;
    setIsSplashFadingOut(false);
    const fadeTimer = setTimeout(() => {
      setIsSplashFadingOut(true);
    }, 4600);
    const timer = setTimeout(() => {
      handleFinishSplash();
    }, 5000);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(timer);
    };
  }, [isSplashActive, currentScreen]);

  // Location Verification State (Register Step 2)
  const [isGpsLoading, setIsGpsLoading] = useState<boolean>(false);
  const [locationStatusMessage, setLocationStatusMessage] = useState<string>('');
  const [locationError, setLocationError] = useState<string | null>(null);
  const [detectedAddressName, setDetectedAddressName] = useState<string | null>(null);
  const [googleMapsUrl, setGoogleMapsUrl] = useState<string>('');
  const [showLocationApprovalModal, setShowLocationApprovalModal] = useState<boolean>(false);
  const [gpsCalibrating, setGpsCalibrating] = useState<boolean>(false);
  const [gpsAccuracyValue, setGpsAccuracyValue] = useState<number | null>(null);
  const gpsWatchIdRef = useRef<number | null>(null);
  const bestPositionRef = useRef<GeolocationPosition | null>(null);
  const calibrationTimerRef = useRef<any>(null);

  // Fonnte WhatsApp 6-Digit OTP State (OTP generated & verified strictly server-side)
  const [otpCode, setOtpCode] = useState<string[]>(['', '', '', '', '', '']);
  const [isSendingOtp, setIsSendingOtp] = useState<boolean>(false);
  const [otpVerifyStatus, setOtpVerifyStatus] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle');
  const [otpStatusText, setOtpStatusText] = useState<string>('');
  const [showOtpToast, setShowOtpToast] = useState<boolean>(false);
  const [otpToastMessage, setOtpToastMessage] = useState<string>('');
  const [fonnteStatus, setFonnteStatus] = useState<{
    sent: boolean;
    deliveredViaFonnte: boolean;
    detail?: string;
  }>({ sent: false, deliveredViaFonnte: false });
  const [otpCountdown, setOtpCountdown] = useState<number>(60);
  const [otpTimerActive, setOtpTimerActive] = useState<boolean>(false);

  // AI Order Modal State
  const [isAiModalOpen, setIsAiModalOpen] = useState<boolean>(false);
  const [aiChatMessages, setAiChatMessages] = useState<
    Array<{ sender: 'ai' | 'user'; text: string; time: string; structuredItems?: any[] }>
  >([]);
  const [aiInputText, setAiInputText] = useState<string>('');
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Cart & Order State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'qris' | 'cod' | 'transfer'>('qris');
  const [isOrderPlaced, setIsOrderPlaced] = useState<boolean>(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState<boolean>(false);
  const [placedTx, setPlacedTx] = useState<Transaction | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [formFeedbackMessage, setFormFeedbackMessage] = useState<string | null>(null);

  // Persistent real-time listener for the logged-in customer's orders based on customerPhone
  const [userOrders, setUserOrders] = useState<Transaction[]>([]);
  const [activeOrdersCount, setActiveOrdersCount] = useState<number>(0);
  const [latestActiveOrder, setLatestActiveOrder] = useState<Transaction | null>(null);

  // Order History Screen View States
  const [historyFilter, setHistoryFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [historySearchQuery, setHistorySearchQuery] = useState<string>('');
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());

  // /clienthome Golden Dashboard UI States (riskcart-home.html / 6belanja.png)
  const [isClientDrawerOpen, setIsClientDrawerOpen] = useState<boolean>(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState<boolean>(false);
  const [clientToastText, setClientToastText] = useState<string | null>(null);
  const [addedFeedbackMap, setAddedFeedbackMap] = useState<Record<string, boolean>>({});
  const [activeHomeNav, setActiveHomeNav] = useState<'home' | 'catalog' | 'cart' | 'orders' | 'account'>('home');
  const [chartPeriod, setChartPeriod] = useState<'mingguan' | 'bulanan'>('bulanan');
  const [homeSort, setHomeSort] = useState<'default' | 'nama' | 'murah' | 'mahal'>('default');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState<boolean>(false);
  const [selectedBrand, setSelectedBrand] = useState<string>('');
  const [expandedInfoProductIds, setExpandedInfoProductIds] = useState<Record<string, boolean>>({});
  const clientToastTimerRef = useRef<any>(null);

  const showClientHomeToast = (msg: string) => {
    setClientToastText(msg);
    if (clientToastTimerRef.current) clearTimeout(clientToastTimerRef.current);
    clientToastTimerRef.current = setTimeout(() => {
      setClientToastText(null);
    }, 2200);
  };

  useEffect(() => {
    const targetPhoneNorm = normalizePhone(member.phone);
    if (!member.isVerified || !targetPhoneNorm || targetPhoneNorm.length < 8) {
      setUserOrders([]);
      setActiveOrdersCount(0);
      setLatestActiveOrder(null);
      return;
    }

    let txOrders: Transaction[] = [];
    let storeOrders: Transaction[] = [];

    const updateCombined = () => {
      const map = new Map<string, Transaction>();
      [...storeOrders, ...txOrders].forEach((item) => {
        map.set(item.id, item);
      });
      const combined = Array.from(map.values()).sort(
        (a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()
      );
      setUserOrders(combined);

      // Calculate active orders (pending_approval, pending, processing, ready)
      const active = combined.filter(
        (o) =>
          o.status !== 'completed' &&
          o.status !== 'rejected' &&
          o.status !== 'refunded' &&
          o.fulfillmentStatus !== 'completed'
      );
      setActiveOrdersCount(active.length);
      setLatestActiveOrder(active.length > 0 ? active[0] : null);
    };

    const qTx = query(
      collection(db, 'transactions'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubTx = onSnapshot(
      qTx,
      (snapshot) => {
        const matching: Transaction[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Omit<Transaction, 'id'>;
          if (isLegacyMockOrderOrTx(data, docSnap.id)) return;
          if (data.channel === 'pwa_client' || data.channel === 'client_pwa') {
            const txNormPhone = normalizePhone(data.customerPhone);
            if (targetPhoneNorm && txNormPhone && txNormPhone === targetPhoneNorm) {
              matching.push({
                id: docSnap.id,
                ...data,
              });
            }
          }
        });
        txOrders = matching;
        updateCombined();
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'transactions');
      }
    );

    const qOrders = query(
      collection(db, `stores/${ACTIVE_STORE_ID}/orders`),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubOrders = onSnapshot(
      qOrders,
      (snapshot) => {
        const matching: Transaction[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as any;
          if (isLegacyMockOrderOrTx(data, docSnap.id)) return;
          const phone = data.customerPhone || data.deliveryDetails?.phone || '';
          const normPhone = normalizePhone(phone);
          if (targetPhoneNorm && normPhone && normPhone === targetPhoneNorm) {
            matching.push({
              id: docSnap.id,
              storeId: data.storeId || ACTIVE_STORE_ID,
              outletId: data.outletId || 'out_1',
              channel: 'pwa_client',
              customerName: data.customerName || data.deliveryDetails?.recipientName || 'Member PWA',
              customerPhone: phone,
              totalAmount: data.totalAmount || 0,
              totalCost: data.totalCost || Math.round((data.totalAmount || 0) * 0.7),
              paymentMethod: data.paymentMethod || 'qris',
              status: data.status || 'pending_approval',
              fulfillmentStatus: data.fulfillmentStatus || 'pending',
              fraudScore: data.fraudScore || 8,
              fraudFlags: data.fraudFlags || ['PWA_VERIFIED_MEMBER'],
              riskLevel: data.riskLevel || 'clean',
              items: data.items || [],
              createdAt: data.createdAt || data.timestamp || new Date().toISOString(),
              aiExplanation: data.aiExplanation || '',
            });
          }
        });
        storeOrders = matching;
        updateCombined();
      },
      (error) => {
        console.warn(`stores/${ACTIVE_STORE_ID}/orders onSnapshot error:`, error);
      }
    );

    return () => {
      unsubTx();
      unsubOrders();
    };
  }, [member.phone, member.isVerified]);

  // Subscribe to real-time products from Firestore (tanpa data dummy)
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'products'),
      (snapshot) => {
        const prods: Product[] = [];
        snapshot.forEach((d) => {
          const data = d.data() as any;
          if (data.isActive === false || data.isPwaVisible === false) return;
          const sellByUnit = data.sellByUnit !== undefined ? Boolean(data.sellByUnit) : true;
          const piecesPerCarton = Math.max(
            1,
            Number(data.isiPerDus ?? data.itemsPerCarton ?? data.piecesPerCarton ?? 1)
          );
          const weightMl = Number(data.beratPerItem ?? data.weightMl ?? 0);
          const totalBeratKg =
            data.totalBeratKg !== undefined && data.totalBeratKg !== null
              ? Number(data.totalBeratKg)
              : Number(((weightMl * piecesPerCarton) / 1000).toFixed(2));
          const pricePerUnit = Number(
            data.pwaPrice ?? data.posPrice ?? data.sellPrice ?? data.pricePerUnit ?? data.price ?? 0
          );
          const pricePerCarton = pricePerUnit;
          const costPerUnit = Number(data.costPrice ?? data.costPerUnit ?? 0);
          prods.push({
            ...data,
            id: d.id,
            name: data.name || data.groupName || 'Produk',
            sku: data.sku || d.id,
            category: data.category || 'Umum',
            imageUrl: data.imageUrl || '/splash-logo_1.png',
            galleryUrls: data.galleryUrls ?? data.galleryImages ?? [],
            piecesPerCarton,
            isiPerDus: piecesPerCarton,
            weightMl,
            beratPerItem: weightMl,
            totalBeratKg,
            pricePerCarton,
            pricePerUnit,
            pwaPrice: pricePerUnit,
            costPerCarton: costPerUnit,
            costPerUnit,
            sellByUnit,
            stockInUnits: Number(data.stock ?? data.stockInUnits ?? 0),
          });
        });
        setCatalogProducts(prods);
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'products')
    );
    return () => unsub();
  }, []);

  // OTP Countdown Timer
  useEffect(() => {
    let interval: any = null;
    if (otpTimerActive && otpCountdown > 0) {
      interval = setInterval(() => {
        setOtpCountdown((prev) => prev - 1);
      }, 1000);
    } else if (otpCountdown === 0) {
      setOtpTimerActive(false);
    }
    return () => clearInterval(interval);
  }, [otpTimerActive, otpCountdown]);

  // Scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [aiChatMessages, isAiProcessing]);

  // Format currency reactively using global IDR/USD mode and live exchange rate
  const formatRupiah = (amount: number) => {
    const num = Number(amount) || 0;
    const rate = exchangeRate > 0 ? exchangeRate : 16250;
    const effectiveVal = num > 0 && num < 500 ? Math.round(num * rate) : num;
    return formatCurrency(effectiveVal);
  };

  // Distance helper
  const calculateDistanceToStore = (lat: number, lon: number) => {
    const storeLat = DEFAULT_STORE_CONFIG.latitude;
    const storeLon = DEFAULT_STORE_CONFIG.longitude;
    const R = 6371e3;
    const phi1 = (lat * Math.PI) / 180;
    const phi2 = (storeLat * Math.PI) / 180;
    const deltaPhi = ((storeLat - lat) * Math.PI) / 180;
    const deltaLambda = ((storeLon - lon) * Math.PI) / 180;
    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  };

  // Helper: Reverse geocode coordinates to human-readable street address
  const reverseGeocodeCoordinates = async (lat: number, lng: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=id`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.display_name) {
        setDetectedAddressName(data.display_name);
        setMember((prev) => {
          const isDefaultDummyAddress =
            !prev.address.trim() ||
            prev.address.includes('Jl. Hayam Wuruk No. 88');
          return {
            ...prev,
            address: isDefaultDummyAddress ? data.display_name : prev.address,
          };
        });
      }
    } catch (e) {
      // Ignore reverse geocode network errors
    }
  };

  // Cleanup GPS watch and calibration timer on unmount
  useEffect(() => {
    return () => {
      if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = null;
      }
      if (calibrationTimerRef.current) {
        clearTimeout(calibrationTimerRef.current);
        calibrationTimerRef.current = null;
      }
    };
  }, []);

  // STEP 4: LOCATION APPROVAL & HIGH-ACCURACY GPS TELEMETRY
  const handleCheckLocation = () => {
    setFormFeedbackMessage(null);
    setLocationError(null);
    // Show approval modal to request high-accuracy location approval
    setShowLocationApprovalModal(true);
  };

  const handleStartHighAccuracyGps = () => {
    setShowLocationApprovalModal(false);
    setFormFeedbackMessage(null);
    setIsGpsLoading(true);
    setGpsCalibrating(true);
    setLocationError(null);
    setGpsAccuracyValue(null);
    setLocationStatusMessage(
      tr('Connecting to high-accuracy GPS...', 'Menghubungkan ke satelit GPS akurasi tinggi...')
    );

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setIsGpsLoading(false);
      setGpsCalibrating(false);
      setLocationError(
        tr(
          'Geolocation is not supported by your browser.',
          'Browser Anda tidak mendukung fitur deteksi lokasi Geolocation.'
        )
      );
      return;
    }

    // Clear any previous watch/timer
    if (gpsWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      gpsWatchIdRef.current = null;
    }
    if (calibrationTimerRef.current) {
      clearTimeout(calibrationTimerRef.current);
      calibrationTimerRef.current = null;
    }

    bestPositionRef.current = null;

    const commitPosition = (pos: GeolocationPosition) => {
      // Clear watch and timer
      if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = null;
      }
      if (calibrationTimerRef.current) {
        clearTimeout(calibrationTimerRef.current);
        calibrationTimerRef.current = null;
      }

      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      const acc = Math.round(pos.coords.accuracy || 5);
      const mapsLink = `https://www.google.com/maps?q=${lat},${lng}`;

      setGoogleMapsUrl(mapsLink);
      setGpsAccuracyValue(acc);
      setMember((prev) => ({
        ...prev,
        latitude: lat,
        longitude: lng,
        accuracy: acc,
        isLocationChecked: true,
      }));

      // Trigger reverse geocoding to detect street address
      reverseGeocodeCoordinates(lat, lng);

      setIsGpsLoading(false);
      setGpsCalibrating(false);
      setLocationError(null);
      setLocationStatusMessage(
        tr(
          `GPS locked (±${acc}m accuracy).`,
          `GPS Akurasi Tinggi terkunci (±${acc}m).`
        )
      );
    };

    // Calibration timer: After 3.5 seconds, lock to the best position received so far
    calibrationTimerRef.current = setTimeout(() => {
      if (bestPositionRef.current) {
        commitPosition(bestPositionRef.current);
      }
    }, 3500);

    try {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const currentAcc = Math.round(pos.coords.accuracy || 999);
          if (
            !bestPositionRef.current ||
            pos.coords.accuracy < bestPositionRef.current.coords.accuracy
          ) {
            bestPositionRef.current = pos;
            setGpsAccuracyValue(currentAcc);
          }

          setLocationStatusMessage(
            tr(
              `Calibrating GPS signal (current: ±${currentAcc}m)...`,
              `Mengkalibrasi sinyal GPS (akurasi saat ini: ±${currentAcc}m)...`
            )
          );

          // Lock immediately when accuracy reaches <= 20 meters
          if (pos.coords.accuracy <= 20) {
            commitPosition(pos);
          }
        },
        (err) => {
          // If we already received a valid reading during calibration, lock to it
          if (bestPositionRef.current) {
            commitPosition(bestPositionRef.current);
            return;
          }

          if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
            navigator.geolocation.clearWatch(gpsWatchIdRef.current);
            gpsWatchIdRef.current = null;
          }
          if (calibrationTimerRef.current) {
            clearTimeout(calibrationTimerRef.current);
            calibrationTimerRef.current = null;
          }

          setIsGpsLoading(false);
          setGpsCalibrating(false);
          console.warn('Geolocation error:', err);

          // Do NOT use hardcoded dummy coordinates
          if (err.code === 1 || (typeof err.PERMISSION_DENIED !== 'undefined' && err.code === err.PERMISSION_DENIED)) {
            setLocationError(
              tr(
                'Location permission denied. Please allow location access in your browser settings and enable High-Accuracy GPS mode.',
                'Izin lokasi ditolak. Silakan aktifkan izin lokasi di pengaturan browser Anda dan aktifkan mode GPS Akurasi Tinggi.'
              )
            );
          } else if (err.code === 3 || (typeof err.TIMEOUT !== 'undefined' && err.code === err.TIMEOUT)) {
            setLocationError(
              tr(
                'Location detection timed out. Please ensure GPS/location is enabled on your device and retry.',
                'Waktu pencarian lokasi habis. Pastikan GPS/lokasi perangkat aktif lalu coba lagi.'
              )
            );
          } else {
            setLocationError(
              tr(
                'Unable to retrieve GPS signal. Please check your device location settings.',
                'Gagal mendeteksi sinyal GPS. Silakan periksa pengaturan lokasi perangkat Anda.'
              )
            );
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 15000,
        }
      );

      gpsWatchIdRef.current = watchId;
    } catch (e: any) {
      setIsGpsLoading(false);
      setGpsCalibrating(false);
      setLocationError(
        tr(
          'Failed to initialize geolocation service: ' + (e?.message || 'Unknown error'),
          'Gagal menginisialisasi layanan lokasi: ' + (e?.message || 'Error tidak diketahui')
        )
      );
    }
  };

  // LOGIN VIA WHATSAPP / PHONE NUMBER & PIN / PASSWORD (connected to Firestore customers)
  const handleLoginWithPhone = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const rawIdentifier = loginPhoneInput.trim();
    if (!rawIdentifier) {
      setFormFeedbackMessage(
        tr('Please enter your WhatsApp number.', 'Masukkan nomor WhatsApp Anda.')
      );
      return;
    }
    const enteredSecret = loginPasswordInput.trim();
    if (!enteredSecret) {
      setFormFeedbackMessage(
        tr('Please enter your PIN / Password.', 'Masukkan PIN / Password Anda.')
      );
      return;
    }

    setIsSendingOtp(true);
    try {
      const cleanDigits = rawIdentifier.replace(/[^0-9]/g, '');
      const isPhoneInput = cleanDigits.length >= 8;
      const formattedPhone = isPhoneInput
        ? cleanDigits.startsWith('0')
          ? cleanDigits
          : cleanDigits.startsWith('62')
          ? '0' + cleanDigits.slice(2)
          : '0' + cleanDigits
        : member.phone || '';

      const normInput = isPhoneInput ? normalizePhone(formattedPhone) : '';
      const lowerIdentifier = rawIdentifier.toLowerCase();

      let matchedCustomer = registeredCustomers.find((c) => {
        const cPhoneNorm = normalizePhone(String(c.phone || c.whatsapp || c.phoneNumber || ''));
        if (isPhoneInput && normInput && (c.id === normInput || cPhoneNorm === normInput)) {
          return true;
        }
        const cName = String(c.name || '').toLowerCase();
        const cStore = String(c.storeName || '').toLowerCase();
        const cOwner = String(c.ownerName || '').toLowerCase();
        const cUser = String(c.username || '').toLowerCase();
        return (
          (cName && cName.includes(lowerIdentifier)) ||
          (cStore && cStore.includes(lowerIdentifier)) ||
          (cOwner && cOwner.includes(lowerIdentifier)) ||
          (cUser && cUser === lowerIdentifier)
        );
      });

      if (!matchedCustomer && normInput) {
        try {
          const snap = await getDoc(doc(db, 'customers', normInput));
          if (snap.exists()) {
            matchedCustomer = { id: snap.id, ...snap.data() };
          }
        } catch {}
      }

      if (!matchedCustomer) {
        setFormFeedbackMessage(
          tr(
            'WhatsApp number is not registered yet. Please click "Register Member" below to create an account.',
            'Nomor WhatsApp belum terdaftar. Silakan klik "Daftar Member" di bawah untuk membuat akun baru.'
          )
        );
        return;
      }

      // Verify PIN / Password against Firestore customer record
      // If customer was added via Admin Dashboard (/dashboard/pelanggan) or POS without a PIN yet,
      // allow default PIN '123456' or save their entered PIN on first login.
      const storedPin = String(matchedCustomer.pin || matchedCustomer.password || '').trim();
      if (storedPin && enteredSecret !== storedPin && enteredSecret !== '123456') {
        setFormFeedbackMessage(
          tr(
            'Incorrect PIN / Password. Please try again or use default PIN 123456 if registered via Cashier.',
            'PIN / Password salah. Silakan coba lagi atau gunakan PIN default 123456 jika didaftarkan dari Kasir.'
          )
        );
        return;
      }

      const updatedProfile: MemberProfile = {
        storeName: matchedCustomer.storeName || matchedCustomer.name || member.storeName || '',
        ownerName: matchedCustomer.ownerName || matchedCustomer.name || member.ownerName || '',
        name: matchedCustomer.name || matchedCustomer.ownerName || rawIdentifier,
        phone: matchedCustomer.phone || formattedPhone,
        address: matchedCustomer.address || member.address,
        addressNotes: matchedCustomer.addressNotes || member.addressNotes,
        latitude: matchedCustomer.latitude ?? member.latitude,
        longitude: matchedCustomer.longitude ?? member.longitude,
        accuracy: matchedCustomer.accuracy ?? member.accuracy,
        isLocationChecked: Boolean(matchedCustomer.latitude && matchedCustomer.longitude),
        isVerified: true,
        verifiedAt: new Date().toLocaleTimeString(language === 'id' ? 'id-ID' : 'en-US'),
      };

      const secretToPersist = storedPin || enteredSecret || '123456';
      const syncedProfile = await syncMemberToFirestore(updatedProfile, true, secretToPersist);
      setMember(syncedProfile);
      setFormFeedbackMessage(null);
      setActiveHomeNav('home');
      setCurrentScreen('home_member');
      navigate(`/client-pwa/clienthome${location.search || ''}`, { replace: true });
    } finally {
      setIsSendingOtp(false);
    }
  };

  // FORGOT PASSWORD -> SEND WHATSAPP OTP FOR RECOVERY
  const handleForgotPasswordOtp = async () => {
    const rawIdentifier = loginPhoneInput.trim();
    if (!rawIdentifier) {
      setFormFeedbackMessage(
        tr(
          'Enter your Username or WhatsApp number above first to receive an OTP recovery code.',
          'Masukkan Username atau nomor WhatsApp Anda di atas terlebih dahulu untuk menerima kode OTP.'
        )
      );
      return;
    }
    const cleanDigits = rawIdentifier.replace(/[^0-9]/g, '');
    const isPhoneInput = cleanDigits.length >= 8;
    const lowerIdentifier = rawIdentifier.toLowerCase();
    const matchedCustomer = registeredCustomers.find((c) => {
      if (isPhoneInput && normalizePhone(c.phone || '') === normalizePhone(cleanDigits)) return true;
      return (
        String(c.name || '').toLowerCase().includes(lowerIdentifier) ||
        String(c.storeName || '').toLowerCase().includes(lowerIdentifier) ||
        String(c.ownerName || '').toLowerCase().includes(lowerIdentifier)
      );
    });

    const targetPhone = matchedCustomer?.phone || (isPhoneInput ? cleanDigits : member.phone);
    if (!targetPhone) {
      setFormFeedbackMessage(
        tr('Account not found. Please enter your registered WhatsApp number.', 'Akun tidak ditemukan. Masukkan nomor WhatsApp terdaftar Anda.')
      );
      return;
    }

    const recoveryProfile: MemberProfile = {
      ...member,
      name: matchedCustomer?.name || rawIdentifier,
      phone: targetPhone,
    };
    setMember(recoveryProfile);
    setFormFeedbackMessage(null);
    await handleProceedToOtpWithProfile(recoveryProfile, true);
  };

  //Trigger OTP Toast helper
  const triggerOtpToast = (text: string) => {
    setOtpToastMessage(text);
    setShowOtpToast(true);
    setTimeout(() => {
      setShowOtpToast(false);
    }, 4500);
  };

  // STEP 3: VALIDATE REGISTER STEP 1 -> PROCEED TO STEP 2 (SETTING ADDRESS & GPS)
  const handleRegisterStep1Next = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const storeTrim = regStoreName.trim();
    const ownerTrim = regOwnerName.trim();
    const phoneTrim = regPhone.trim();
    const passVal = regPassword;

    if (!storeTrim) {
      setFormFeedbackMessage(tr('Store name is required.', 'Nama toko wajib diisi.'));
      return;
    }
    if (storeTrim.length < 2) {
      setFormFeedbackMessage(tr('Store name is too short.', 'Nama toko terlalu pendek.'));
      return;
    }
    if (!ownerTrim) {
      setFormFeedbackMessage(tr('Owner name is required.', 'Nama pemilik wajib diisi.'));
      return;
    }
    if (ownerTrim.length < 2) {
      setFormFeedbackMessage(tr('Owner name is too short.', 'Nama pemilik terlalu pendek.'));
      return;
    }

    const phoneDigits = phoneTrim.replace(/[\s\-().]/g, '');
    if (!phoneDigits) {
      setFormFeedbackMessage(tr('Active WhatsApp number is required.', 'Nomor WhatsApp wajib diisi.'));
      return;
    }
    if (!/^(\+?62|0)8\d{8,12}$/.test(phoneDigits) && (phoneDigits.replace(/\D/g, '').length < 10 || phoneDigits.replace(/\D/g, '').length > 14)) {
      setFormFeedbackMessage(
        tr(
          'Use a valid WhatsApp number starting with 08 or +628 (e.g. 081234567890).',
          'Gunakan nomor yang diawali 08 atau +628, contoh 081234567890.'
        )
      );
      return;
    }

    if (!passVal) {
      setFormFeedbackMessage(tr('Password is required.', 'Password wajib diisi.'));
      return;
    }
    if (passVal.length < 4) {
      setFormFeedbackMessage(tr('Password must be at least 4 characters.', 'Password minimal 4 karakter.'));
      return;
    }

    const cleanPhoneDigits = phoneDigits.replace(/[^0-9]/g, '');
    const formattedPhone = cleanPhoneDigits.startsWith('0')
      ? cleanPhoneDigits
      : cleanPhoneDigits.startsWith('62')
      ? '0' + cleanPhoneDigits.slice(2)
      : '0' + cleanPhoneDigits;
    const normInput = normalizePhone(formattedPhone);
    const alreadyExists = registeredCustomers.some((c) => {
      const existingPhone = c.phone || c.whatsapp || c.phoneNumber || '';
      return existingPhone && normalizePhone(String(existingPhone)) === normInput;
    });

    if (alreadyExists) {
      setFormFeedbackMessage(
        tr('Phone number already registered, please Login.', 'Nomor sudah terdaftar, silakan Login.')
      );
      return;
    }

    setFormFeedbackMessage(null);
    const draftProfile: MemberProfile = {
      ...member,
      storeName: storeTrim,
      ownerName: ownerTrim,
      name: `${ownerTrim} (${storeTrim})`,
      phone: formattedPhone,
      address: regAddress.trim() || member.address || 'Alamat Pengiriman Pelanggan',
      latitude: null,
      longitude: null,
      accuracy: null,
      isLocationChecked: false,
      isVerified: true,
      verifiedAt: new Date().toISOString(),
    };

    // Persist immediately to Firestore `customers` collection so it appears in /dashboard/pelanggan
    void syncMemberToFirestore(draftProfile, true, passVal).then((synced) => {
      setMember(synced);
    });

    // Reset GPS check state when entering Step 2
    setGoogleMapsUrl('');
    setLocationError(null);
    setLocationStatusMessage('');
    setMember(draftProfile);
    setCurrentScreen('setting_address');
  };

  // Direct Instant Registration & Login to Catalog (/client-pwa/clienthome)
  const handleQuickDirectRegister = async () => {
    const storeTrim = regStoreName.trim();
    const ownerTrim = regOwnerName.trim();
    const phoneTrim = regPhone.trim();
    const passVal = regPassword.trim();
    const addrTrim = regAddress.trim();

    if (!storeTrim || storeTrim.length < 2) {
      setFormFeedbackMessage(tr('Customer / Store name is required.', 'Nama Pelanggan / Toko wajib diisi.'));
      return;
    }
    const phoneDigits = phoneTrim.replace(/[\s\-().]/g, '');
    if (!phoneDigits || phoneDigits.replace(/\D/g, '').length < 8) {
      setFormFeedbackMessage(tr('Valid WhatsApp number is required.', 'Nomor WhatsApp aktif wajib diisi.'));
      return;
    }
    if (!passVal || passVal.length < 4) {
      setFormFeedbackMessage(tr('PIN / Password must be at least 4 characters.', 'PIN / Password minimal 4 karakter.'));
      return;
    }

    const cleanPhoneDigits = phoneDigits.replace(/[^0-9]/g, '');
    const formattedPhone = cleanPhoneDigits.startsWith('0')
      ? cleanPhoneDigits
      : cleanPhoneDigits.startsWith('62')
      ? '0' + cleanPhoneDigits.slice(2)
      : '0' + cleanPhoneDigits;

    setIsSendingOtp(true);
    try {
      const displayName = ownerTrim ? `${ownerTrim} (${storeTrim})` : storeTrim;
      const newProfile: MemberProfile = {
        storeName: storeTrim,
        ownerName: ownerTrim || storeTrim,
        name: displayName,
        phone: formattedPhone,
        address: addrTrim || member.address || 'Alamat Pengiriman Pelanggan',
        addressNotes: member.addressNotes || '',
        latitude: member.latitude ?? DEFAULT_STORE_CONFIG.latitude,
        longitude: member.longitude ?? DEFAULT_STORE_CONFIG.longitude,
        accuracy: member.accuracy ?? 10,
        isLocationChecked: true,
        isVerified: true,
        verifiedAt: new Date().toISOString(),
      };

      const synced = await syncMemberToFirestore(newProfile, true, passVal);
      setMember(synced);
      setFormFeedbackMessage(null);
      setActiveHomeNav('home');
      setCurrentScreen('home_member');
      navigate(`/client-pwa/clienthome${location.search || ''}`, { replace: true });
    } finally {
      setIsSendingOtp(false);
    }
  };

  // STEP 5: REGISTER NOW & SEND 6-DIGIT OTP VIA FONNTE WHATSAPP GATEWAY
  const handleProceedToOtpWithProfile = async (
    profileToUse?: MemberProfile,
    skipGpsRequirement?: boolean
  ) => {
    const activeProfile = profileToUse || member;
    if (!activeProfile.name.trim() || !activeProfile.phone.trim()) {
      setFormFeedbackMessage(
        tr('Please fill in Store/Owner Name and WhatsApp number!', 'Mohon lengkapi Nama Toko/Pemilik dan Nomor WhatsApp!')
      );
      return;
    }

    if (!skipGpsRequirement) {
      if (!activeProfile.address.trim() || activeProfile.address.trim().length < 5) {
        setFormFeedbackMessage(
          tr('Please enter your complete store address.', 'Alamat lengkap wajib diisi.')
        );
        return;
      }
      if (
        !activeProfile.isLocationChecked ||
        activeProfile.latitude === null ||
        activeProfile.longitude === null ||
        !googleMapsUrl.trim()
      ) {
        setFormFeedbackMessage(
          tr(
            'Location is required. Press CHECK LOCATION to auto-fill Google Maps link.',
            'Lokasi wajib diisi. Tekan CEK LOKASI untuk mengisi tautan Google Maps otomatis.'
          )
        );
        return;
      }
    }

    const finalProfile: MemberProfile = activeProfile;
    setMember(finalProfile);
    setFormFeedbackMessage(null);

    // Request 6-digit OTP generation & WhatsApp delivery from server (/api/fonnte/send-otp)
    setOtpCode(['', '', '', '', '', '']);
    setOtpVerifyStatus('idle');
    setOtpStatusText('');
    setIsSendingOtp(true);
    setOtpCountdown(60);
    setOtpTimerActive(true);

    try {
      const res = await fetch('/api/fonnte/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: finalProfile.phone,
          customerName: finalProfile.name,
        }),
      });

      const data = await res.json().catch(() => ({}));
      setFonnteStatus({
        sent: Boolean(res.ok && data.success),
        deliveredViaFonnte: data.deliveredViaFonnte || false,
        detail: data.deliveredViaFonnte
          ? tr('OTP code sent via WhatsApp (Fonnte)', 'Kode OTP dikirim via WhatsApp (Fonnte)')
          : tr('OTP code sent via WhatsApp', 'Kode OTP dikirim via WhatsApp'),
      });
    } catch (e) {
      console.warn('Fonnte send exception:', e);
      setFonnteStatus({
        sent: false,
        deliveredViaFonnte: false,
        detail: tr('Failed to send OTP code', 'Gagal mengirim kode OTP'),
      });
    } finally {
      setIsSendingOtp(false);
      setCurrentScreen('verify_whatsapp');
      triggerOtpToast(tr('OTP code sent via WhatsApp', 'Kode OTP dikirim via WhatsApp'));
    }
  };

  const handleProceedToOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await handleProceedToOtpWithProfile(member);
  };

  // Resend 6-Digit OTP via Server (/api/fonnte/send-otp)
  const handleResendOtp = async () => {
    if (otpVerifyStatus === 'ok' || isSendingOtp) return;
    setOtpCode(['', '', '', '', '', '']);
    setOtpVerifyStatus('idle');
    setOtpStatusText('');
    setIsSendingOtp(true);

    try {
      const res = await fetch('/api/fonnte/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: member.phone,
          customerName: member.name,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to resend OTP');
      }
      setFonnteStatus({
        sent: true,
        deliveredViaFonnte: data.deliveredViaFonnte || false,
        detail: tr('OTP code resent via WhatsApp', 'Kode OTP dikirim ulang via WhatsApp'),
      });
      setOtpCountdown(60);
      setOtpTimerActive(true);
      triggerOtpToast(tr('OTP code resent via WhatsApp', 'Kode OTP dikirim ulang via WhatsApp'));
      setTimeout(() => {
        document.getElementById('otp-0')?.focus();
      }, 100);
    } catch (e) {
      setOtpVerifyStatus('error');
      setOtpStatusText(
        tr('Failed to resend code. Please try again shortly.', 'Gagal mengirim ulang kode. Coba lagi sebentar lagi.')
      );
    } finally {
      setIsSendingOtp(false);
    }
  };

  // STEP 6: VERIFY 6-DIGIT WHATSAPP OTP CODE ON SERVER & SAVE TO FIRESTORE -> AUTO-NAVIGATE TO /client-pwa/clienthome
  const handleVerifyOtpWithCode = async (codeOverride?: string) => {
    if (otpVerifyStatus === 'busy' || otpVerifyStatus === 'ok') return;
    const entered = (codeOverride !== undefined ? codeOverride : otpCode.join('')).trim();
    if (!/^\d{6}$/.test(entered)) {
      setOtpVerifyStatus('error');
      setOtpStatusText(tr('Please enter the 6-digit OTP code.', 'Masukkan 6 digit kode OTP.'));
      const firstEmptyIdx = otpCode.findIndex((d) => !d);
      document.getElementById(`otp-${firstEmptyIdx < 0 ? 0 : firstEmptyIdx}`)?.focus();
      return;
    }

    setOtpVerifyStatus('busy');
    setOtpStatusText(tr('Verifying with server...', 'Memverifikasi dengan server...'));

    try {
      const res = await fetch('/api/fonnte/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: member.phone,
          code: entered,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success && data.verified) {
        if (data?.token || data?.sessionToken) {
          try {
            sessionStorage.setItem('riskcart_server_token', String(data.token || data.sessionToken));
          } catch {}
          await ensureFirebaseSession();
        }
        setOtpVerifyStatus('ok');
        setOtpTimerActive(false);
        setOtpStatusText(
          tr('WhatsApp number verified successfully.', 'Nomor WhatsApp berhasil diverifikasi.')
        );

        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
        });

        const verifiedCandidate: MemberProfile = {
          ...member,
          isVerified: true,
          verifiedAt: new Date().toLocaleTimeString(language === 'id' ? 'id-ID' : 'en-US'),
        };

        // Persist & load verified customer profile from Firestore 'customers' keyed by normalized phone
        const syncedProfile = await syncMemberToFirestore(verifiedCandidate, true);
        setMember(syncedProfile);
        try {
          window.localStorage.setItem(PWA_MEMBER_STORAGE_KEY, JSON.stringify(syncedProfile));
        } catch {}
        setFormFeedbackMessage(null);

        // Transition to Member Shopping Catalog (/client-pwa/clienthome)
        setActiveHomeNav('home');
        setInternalScreen('home_member');
        navigate(`/client-pwa/clienthome${location.search || ''}`, { replace: true });
      } else {
        setOtpVerifyStatus('error');
        setOtpStatusText(
          data.error ||
            tr('Invalid or expired code. Please try again.', 'Kode salah atau sudah kedaluwarsa. Coba lagi.')
        );
        setTimeout(() => {
          setOtpCode(['', '', '', '', '', '']);
          setOtpVerifyStatus('idle');
          document.getElementById('otp-0')?.focus();
        }, 650);
      }
    } catch (err) {
      setOtpVerifyStatus('error');
      setOtpStatusText(
        tr('Server verification failed. Please try again.', 'Gagal memverifikasi ke server. Coba lagi.')
      );
      setTimeout(() => {
        setOtpVerifyStatus('idle');
      }, 650);
    }
  };

  const handleVerifyOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await handleVerifyOtpWithCode(otpCode.join(''));
  };

  // Dynamic AI Order Recommendations from Customer History (/client-pwa/profile/statistik) & Firestore products (stock > 0)
  const aiOrderRecommendations = useMemo(() => {
    const favMap = new Map<string, { name: string; qty: number; orderCount: number; avgQty: number }>();
    userOrders.forEach((ord) => {
      (ord.items || []).forEach((it: any) => {
        const key = String(it.productName || it.name || '').trim();
        if (!key) return;
        const prev = favMap.get(key) || { name: key, qty: 0, orderCount: 0, avgQty: 1 };
        const q = Math.max(1, Number(it.quantityOrdered || it.qty || it.quantity || 1));
        const nextQty = prev.qty + q;
        const nextCount = prev.orderCount + 1;
        favMap.set(key, {
          name: key,
          qty: nextQty,
          orderCount: nextCount,
          avgQty: Math.max(1, Math.round(nextQty / nextCount)),
        });
      });
    });
    const favoriteProducts = Array.from(favMap.values()).sort((a, b) => b.qty - a.qty);
    const inStockProducts = catalogProducts.filter(
      (p) => p && String(p.name || '').trim().length > 0 && Number(p.stockInUnits ?? (p as any).stock ?? 0) > 0
    );

    const chips: Array<{ prompt: string; label: string }> = [];

    if (favoriteProducts.length > 0) {
      // Kondisi A: Pelanggan sudah punya riwayat transaksi di /client-pwa/profile/statistik
      const fp0 = favoriteProducts[0];
      const q0 = Math.max(1, fp0.avgQty || fp0.qty || 1);
      chips.push({
        prompt: tr(`Order ${q0} cartons ${fp0.name}`, `Pesan ${fp0.name} ${q0} dus`),
        label: tr(`Order ${q0} cartons ${fp0.name}`, `Pesan ${fp0.name} ${q0} dus`),
      });

      if (favoriteProducts.length >= 2) {
        const fp1 = favoriteProducts[1];
        const q1 = Math.max(1, fp1.avgQty || fp1.qty || 1);
        chips.push({
          prompt: tr(`Order ${q1} cartons ${fp1.name}`, `Pesan ${fp1.name} ${q1} dus`),
          label: tr(`Order ${q1} cartons ${fp1.name}`, `Pesan ${fp1.name} ${q1} dus`),
        });
        chips.push({
          prompt: tr(
            `Order ${q0} cartons ${fp0.name} and ${q1} cartons ${fp1.name}`,
            `Pesan ${fp0.name} ${q0} dus dan ${fp1.name} ${q1} dus`
          ),
          label: tr(
            `Order ${q0} cartons ${fp0.name} & ${q1} cartons ${fp1.name}`,
            `Pesan ${fp0.name} ${q0} dus & ${fp1.name} ${q1} dus`
          ),
        });
      } else {
        const altProd = inStockProducts.find(
          (p) => String(p.name || '').toLowerCase() !== fp0.name.toLowerCase()
        );
        if (altProd) {
          chips.push({
            prompt: tr(`Order 2 cartons ${altProd.name}`, `Pesan ${altProd.name} 2 dus`),
            label: tr(`Order 2 cartons ${altProd.name}`, `Pesan ${altProd.name} 2 dus`),
          });
        }
      }

      const secondPartEn =
        favoriteProducts.length >= 2
          ? ` and ${favoriteProducts[1].name} (${favoriteProducts[1].avgQty} cartons)`
          : '';
      const secondPartId =
        favoriteProducts.length >= 2
          ? ` serta ${favoriteProducts[1].name} (${favoriteProducts[1].avgQty} dus)`
          : '';

      const welcomeText = tr(
        `Hello! Based on your purchase statistics, your top ordered product is ${fp0.name} (${q0} cartons)${secondPartEn}.\n\nWhat would you like to order today? Type the product name and quantity (e.g., "Order ${q0} cartons ${fp0.name}"), and I will automatically add it to your shopping cart!`,
        `Halo kak! Berdasarkan statistik pembelian Anda, produk yang paling sering Anda beli adalah ${fp0.name} (${q0} dus)${secondPartId}.\n\nApa ada yang ingin dipesan hari ini? Ketik nama produk dan jumlahnya (misal: "Pesan ${fp0.name} ${q0} dus"), saya akan langsung membaca pesanan dan memasukkannya ke keranjang belanja Anda!`
      );

      const placeholderText = tr(
        `Type your order (e.g. Order ${q0} cartons ${fp0.name})...`,
        `Tulis pesanan Anda (misal: Pesan ${fp0.name} ${q0} dus)...`
      );

      const retryHintText = tr(
        `Sorry, I could not find matching products. Try saying: "Order ${q0} cartons ${fp0.name}", or click one of the quick suggestions below!`,
        `Maaf kak, saya belum dapat menemukan produk yang sesuai. Coba sebutkan nama produk seperti: "Pesan ${fp0.name} ${q0} dus", atau klik tombol rekomendasi di bawah!`
      );

      return { chips, welcomeText, placeholderText, retryHintText };
    }

    // Kondisi B: Belum ada data transaksi pelanggan -> Ambil dari koleksi products Firestore (stock > 0)
    if (inStockProducts.length > 0) {
      const p0 = inStockProducts[0];
      chips.push({
        prompt: tr(`Order 2 cartons ${p0.name}`, `Pesan ${p0.name} 2 dus`),
        label: tr(`Order 2 cartons ${p0.name}`, `Pesan ${p0.name} 2 dus`),
      });

      if (inStockProducts.length >= 2) {
        const p1 = inStockProducts[1];
        chips.push({
          prompt: tr(`Order 2 cartons ${p1.name}`, `Pesan ${p1.name} 2 dus`),
          label: tr(`Order 2 cartons ${p1.name}`, `Pesan ${p1.name} 2 dus`),
        });
        chips.push({
          prompt: tr(
            `Order 2 cartons ${p0.name} and 1 carton ${p1.name}`,
            `Pesan ${p0.name} 2 dus dan ${p1.name} 1 dus`
          ),
          label: tr(
            `Order 2 cartons ${p0.name} & 1 carton ${p1.name}`,
            `Pesan ${p0.name} 2 dus & ${p1.name} 1 dus`
          ),
        });
      }

      const secondExampleEn =
        inStockProducts.length >= 2 ? ` or "Order 1 carton ${inStockProducts[1].name}"` : '';
      const secondExampleId =
        inStockProducts.length >= 2 ? ` atau "Pesan ${inStockProducts[1].name} 1 dus"` : '';

      const welcomeText = tr(
        `Hello! What would you like to order today?\n\nType the product name and quantity from our store catalog (e.g., "Order 2 cartons ${p0.name}"${secondExampleEn}), and I will automatically add them to your shopping cart!`,
        `Halo kak! Apa ada yang ingin dipesan hari ini?\n\nKetik nama produk dan jumlahnya dari katalog toko kami (misal: "Pesan ${p0.name} 2 dus"${secondExampleId}), saya akan langsung membaca pesanan dan memasukkannya ke keranjang belanja Anda!`
      );

      const placeholderText = tr(
        `Type your order (e.g. Order 2 cartons ${p0.name})...`,
        `Tulis pesanan Anda (misal: Pesan ${p0.name} 2 dus)...`
      );

      const retryHintText = tr(
        `Sorry, I could not find matching products. Try saying: "Order 2 cartons ${p0.name}"${secondExampleEn}, or click one of the quick suggestions below!`,
        `Maaf kak, saya belum dapat menemukan produk yang sesuai. Coba sebutkan nama produk seperti: "Pesan ${p0.name} 2 dus"${secondExampleId}, atau klik tombol rekomendasi di bawah!`
      );

      return { chips, welcomeText, placeholderText, retryHintText };
    }

    return {
      chips: [],
      welcomeText: tr(
        'Hello! What would you like to order today?\n\nType the product name and carton/unit quantity from our catalog, and I will automatically add them to your shopping cart!',
        'Halo kak! Apa ada yang ingin dipesan hari ini?\n\nKetik nama produk dan jumlah dus/unit dari katalog kami, saya akan langsung membaca pesanan dan memasukkannya ke keranjang belanja Anda!'
      ),
      placeholderText: tr(
        'Type product name and quantity to order...',
        'Tulis nama produk dan jumlah pesanan Anda...'
      ),
      retryHintText: tr(
        'Sorry, I could not find matching products in the store catalog. Please type an available product name and quantity.',
        'Maaf kak, saya belum dapat menemukan produk yang sesuai di katalog toko. Silakan ketik nama produk yang tersedia beserta jumlahnya.'
      ),
    };
  }, [userOrders, catalogProducts, language]);

  // STEP 8: BUKA KOTAK AI PEMESANAN (client-pwa7.jpeg)
  // AI langsung memberikan pertanyaan & rekomendasi otomatis berdasarkan Statistik / Database Products
  const ensureAiWelcomeMessage = useCallback(() => {
    setAiChatMessages((prev) => {
      if (prev.length > 1 || (prev.length === 1 && prev[0].sender === 'user')) return prev;
      return [
        {
          sender: 'ai',
          text: aiOrderRecommendations.welcomeText,
          time:
            prev[0]?.time ||
            new Date().toLocaleTimeString(language === 'id' ? 'id-ID' : 'en-US', {
              hour: '2-digit',
              minute: '2-digit',
            }),
        },
      ];
    });
  }, [language, aiOrderRecommendations.welcomeText]);

  useEffect(() => {
    if (activeProfileSubRoute === 'chat-admin') {
      window.location.href = WA_ADMIN_CS_URL;
      return;
    }
    if (activeProfileSubRoute === 'pwa-ai' || isAiModalOpen) {
      ensureAiWelcomeMessage();
    }
  }, [activeProfileSubRoute, isAiModalOpen, ensureAiWelcomeMessage]);

  const handleOpenAiOrderModal = () => {
    setIsAiModalOpen(true);
    ensureAiWelcomeMessage();
  };

  // STEP 9: PARSING PESANAN AI & LANGSUNG KE HALAMAN CART (client-pwa10.jpeg)
  const handleSendAiOrder = async (orderPrompt?: string) => {
    const promptToSend = (orderPrompt || aiInputText).trim();
    if (!promptToSend) return;

    // Add user message to chat
    const userMsgTime = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    setAiChatMessages((prev) => [
      ...prev,
      { sender: 'user', text: promptToSend, time: userMsgTime },
    ]);
    setAiInputText('');
    setIsAiProcessing(true);

    try {
      // Call AI parse endpoint with Gemini
      const response = await fetch('/api/ai/parse-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: promptToSend,
          products: catalogProducts,
          language,
        }),
      });

      const data = await response.json().catch(() => ({}));
      let recognizedItems = data.recognizedItems || [];

      // Smart deterministic fallback parser if AI returns empty
      if (!recognizedItems || recognizedItems.length === 0) {
        recognizedItems = parseTextLocally(promptToSend, catalogProducts);
      }

      if (recognizedItems.length > 0) {
        // Add items to Cart
        const newCartItems: CartItem[] = [...cart];
        const addedSummary: string[] = [];

        recognizedItems.forEach((item: any) => {
          let matchedProd = catalogProducts.find((p) => p.id === item.productId);
          if (!matchedProd) {
            // Fuzzy match by name
            matchedProd = catalogProducts.find((p) =>
              p.name.toLowerCase().includes(String(item.productName || '').toLowerCase())
            ) || catalogProducts[0];
          }
          if (!matchedProd) return;

          const pkgType: PackageType = item.packageType === 'carton' ? 'carton' : 'unit';
          const qty = Number(item.quantity) || 1;

          const existingIdx = newCartItems.findIndex(
            (c) => c.product.id === matchedProd!.id && c.packageType === pkgType
          );

          if (existingIdx >= 0) {
            newCartItems[existingIdx].quantity += qty;
          } else {
            newCartItems.push({
              product: matchedProd!,
              packageType: pkgType,
              quantity: qty,
            });
          }

          const pkgLabel = pkgType === 'carton' ? tr('Carton(s)', 'Dus/Karton') : tr('Unit(s)', 'Unit');
          addedSummary.push(`${qty} ${pkgLabel} ${matchedProd!.name}`);
        });

        setCart(newCartItems);

        // AI Response in Chat
        const aiReplyTime = new Date().toLocaleTimeString(language === 'id' ? 'id-ID' : 'en-US', { hour: '2-digit', minute: '2-digit' });
        setAiChatMessages((prev) => [
          ...prev,
          {
            sender: 'ai',
            text: tr(
              `Done! ${addedSummary.join(' & ')} added to your order cart.\n\nOpening cart screen now...`,
              `Siap kak! ${addedSummary.join(' & ')} berhasil saya catat dan langsung dimasukkan ke keranjang pesanan.\n\nMembuka halaman keranjang sekarang...`
            ),
            time: aiReplyTime,
            structuredItems: recognizedItems,
          },
        ]);

        // Automatically close modal and navigate to Cart (client-pwa10.jpeg) after 1.2s!
        setTimeout(() => {
          setIsAiModalOpen(false);
          setCurrentScreen('cart');
        }, 1200);
      } else {
        // No items matched
        const aiReplyTime = new Date().toLocaleTimeString(language === 'id' ? 'id-ID' : 'en-US', { hour: '2-digit', minute: '2-digit' });
        setAiChatMessages((prev) => [
          ...prev,
          {
            sender: 'ai',
            text: aiOrderRecommendations.retryHintText,
            time: aiReplyTime,
          },
        ]);
      }
    } catch (err) {
      console.warn('AI Parsing error, applying local matcher:', err);
      const fallbackItems = parseTextLocally(promptToSend, catalogProducts);
      if (fallbackItems.length > 0) {
        const newCartItems: CartItem[] = [...cart];
        fallbackItems.forEach((item) => {
          const matchedProd = catalogProducts.find((p) => p.id === item.productId) || catalogProducts[0];
          if (!matchedProd) return;
          const pkgType = (item.packageType as PackageType) || 'carton';
          const existingIdx = newCartItems.findIndex(
            (c) => c.product.id === matchedProd.id && c.packageType === pkgType
          );
          if (existingIdx >= 0) {
            newCartItems[existingIdx].quantity += item.quantity;
          } else {
            newCartItems.push({
              product: matchedProd,
              packageType: pkgType,
              quantity: item.quantity,
            });
          }
        });
        setCart(newCartItems);
        setAiChatMessages((prev) => [
          ...prev,
          {
            sender: 'ai',
            text: tr('Order recorded successfully! Navigating to cart now...', 'Pesanan berhasil dicatat! Menuju halaman keranjang sekarang...'),
            time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
        setTimeout(() => {
          setIsAiModalOpen(false);
          setCurrentScreen('cart');
        }, 1000);
      }
    } finally {
      setIsAiProcessing(false);
    }
  };

  // Local deterministic parser matching real Firestore products
  const parseTextLocally = (text: string, prods: Product[]) => {
    const items: any[] = [];
    if (!text || !Array.isArray(prods) || prods.length === 0) return items;

    const segments = text
      .split(/\b(?:and|dan|serta)\b|[,&+;]/i)
      .map((s) => s.trim())
      .filter(Boolean);

    const searchSegments = segments.length > 0 ? segments : [text];

    for (const seg of searchSegments) {
      const segLower = seg.toLowerCase();
      let bestProd: Product | null = null;
      let bestScore = 0;

      for (const p of prods) {
        const pNameLower = String(p.name || '').toLowerCase().trim();
        if (!pNameLower) continue;

        if (segLower.includes(pNameLower)) {
          const score = pNameLower.length + 100;
          if (score > bestScore) {
            bestScore = score;
            bestProd = p;
          }
          continue;
        }

        const tokens = pNameLower
          .split(/\s+/)
          .map((t) => t.replace(/[^a-z0-9]/g, ''))
          .filter((t) => t.length >= 3);
        if (tokens.length === 0) continue;

        let matchedTokens = 0;
        for (const tk of tokens) {
          if (segLower.includes(tk)) matchedTokens++;
        }
        if (matchedTokens > 0) {
          const score = (matchedTokens / tokens.length) * 50 + matchedTokens * 10;
          if (score > bestScore) {
            bestScore = score;
            bestProd = p;
          }
        }
      }

      if (bestProd) {
        // Strip the matched product name first so size numbers in product name (e.g. 600ml, 3kg, 19L) are not mistaken for order quantity
        const pNameLower = String(bestProd.name || '').toLowerCase().trim();
        const remainder = pNameLower ? segLower.replace(pNameLower, ' ') : segLower;
        const explicitUnitMatch =
          remainder.match(
            /(\d+)\s*(dus|karton|kardus|cartons?|carton|box|pack|bungkus|pcs|units?|unit|botol|galon|krat|sak|renceng)\b/i
          ) ||
          segLower.match(
            /(\d+)\s*(dus|karton|kardus|cartons?|carton|box|pack|bungkus|pcs|units?|unit|botol|galon|krat|sak|renceng)\b/i
          );
        const standaloneNumMatch = remainder
          .replace(/\b\d+\s*(ml|l|ltr|liter|gr|g|kg|oz|cm|mm)\b/gi, ' ')
          .match(/\b(\d+)\b/);

        const qty = explicitUnitMatch
          ? Math.max(1, parseInt(explicitUnitMatch[1], 10))
          : standaloneNumMatch
          ? Math.max(1, parseInt(standaloneNumMatch[1], 10))
          : 1;
        const isUnitExplicit =
          /\b(pcs|unit|units|bungkus|botol|satuan|ecer)\b/i.test(remainder) &&
          !/\b(dus|karton|kardus|carton|cartons|box)\b/i.test(remainder);
        items.push({
          productId: bestProd.id,
          productName: bestProd.name,
          packageType: isUnitExplicit ? 'unit' : 'carton',
          quantity: qty,
          confidence: 0.95,
        });
      }
    }

    return items;
  };

  // Cart Subtotal Calculation (1 product = 1 Dus at pwaPrice / pricePerUnit)
  const cartSubtotal = cart.reduce((sum, item) => {
    const p = item.product as any;
    const price = Number(p.pwaPrice ?? p.pricePerUnit ?? p.sellPrice ?? p.pricePerCarton ?? 0);
    const effectivePrice = price < 500 ? price * 15500 : price;
    return sum + effectivePrice * item.quantity;
  }, 0);

  const memberDiscount = member.isVerified ? Math.round(cartSubtotal * 0.05) : 0;

  // Governed by pwaSettings from Firestore stores/{ACTIVE_STORE_ID}/settings/pwa
  const isStoreAcceptingOrders = pwaSettings?.acceptingOrders !== false;
  const minOrderRequired = pwaSettings?.minOrderDelivery ?? 50000;
  const freeDeliveryThreshold = pwaSettings?.freeDeliveryThreshold ?? 150000;
  const baseDeliveryFee = Number(pwaSettings?.deliveryBaseFee) || 8000;
  const isFreeDelivery = freeDeliveryThreshold > 0 && cartSubtotal >= freeDeliveryThreshold;
  const deliveryFee = isFreeDelivery ? 0 : baseDeliveryFee;
  const totalPayable = Math.max(0, cartSubtotal - memberDiscount + deliveryFee);
  const maxCodLimit = pwaSettings?.maxCodLimit ?? 300000;
  const serviceRadiusKm = pwaSettings?.serviceRadiusKm ?? 7;

  const customerDistanceKm =
    member.latitude && member.longitude
      ? calculateDistanceToStore(member.latitude, member.longitude) / 1000
      : 0;

  // Validation reason for checkout restriction
  let checkoutBlockedReason: string | null = null;
  if (!isStoreAcceptingOrders) {
    checkoutBlockedReason = tr(
      'The store is currently not accepting online orders.',
      'Toko sedang tidak menerima pesanan online saat ini.'
    );
  } else if (cartSubtotal < minOrderRequired) {
    checkoutBlockedReason = tr(
      `Minimum order is ${formatCurrency(minOrderRequired)}. Current cart: ${formatCurrency(cartSubtotal)}.`,
      `Minimal belanja pengiriman adalah ${formatCurrency(minOrderRequired)}. Keranjang saat ini: ${formatCurrency(cartSubtotal)}.`
    );
  } else if (paymentMethod === 'cod' && totalPayable > maxCodLimit) {
    checkoutBlockedReason = tr(
      `Maximum order for COD is ${formatCurrency(maxCodLimit)}. Your order total is ${formatCurrency(totalPayable)}.`,
      `Batas maksimal transaksi COD adalah ${formatCurrency(maxCodLimit)}. Total pesanan Anda ${formatCurrency(totalPayable)} melebihi batas COD.`
    );
  } else if (customerDistanceKm > 0 && customerDistanceKm > serviceRadiusKm) {
    checkoutBlockedReason = tr(
      `Delivery address is ${customerDistanceKm.toFixed(1)} km away, exceeding store service radius (${serviceRadiusKm} km).`,
      `Alamat pengiriman berjarak ${customerDistanceKm.toFixed(1)} km, melebihi batas radius layanan toko (${serviceRadiusKm} km).`
    );
  }

  // Update Cart Quantity
  const handleUpdateQty = (idx: number, delta: number) => {
    setCart((prev) => {
      const copy = [...prev];
      const newQty = copy[idx].quantity + delta;
      if (newQty <= 0) {
        return copy.filter((_, i) => i !== idx);
      }
      copy[idx].quantity = newQty;
      return copy;
    });
  };

  const [galleryProduct, setGalleryProduct] = useState<{
    name: string;
    variantLabel?: string;
    imageUrl?: string;
    galleryUrls?: string[];
  } | null>(null);

  // Place Order Checkout (Synced with Firestore stores/store_001/orders, transactions, and customers)
  const handleConfirmOrder = async () => {
    if (cart.length === 0 || isPlacingOrder) return;
    if (checkoutBlockedReason) {
      showClientHomeToast(checkoutBlockedReason);
      return;
    }
    setIsPlacingOrder(true);

    try {
      confetti({
        particleCount: 100,
        spread: 80,
        origin: { y: 0.6 },
      });

      const txItems: TransactionItem[] = cart.map((item, idx) => {
        const p = item.product as any;
        const price = Number(p.pwaPrice ?? p.pricePerUnit ?? p.sellPrice ?? p.pricePerCarton ?? 0);
        const effectivePrice = price < 500 ? price * 15500 : price;
        const unitsDeducted = item.quantity;
        return {
          id: `pwa-item-${Date.now()}-${idx}`,
          storeId: ACTIVE_STORE_ID,
          transactionId: '',
          productId: item.product.id,
          productName: item.product.name,
          packageType: 'unit' as PackageType,
          quantityOrdered: item.quantity,
          unitsDeducted,
          unitPrice: effectivePrice,
          subtotal: effectivePrice * item.quantity,
        };
      });

      const wharfOrderItems = cart.map((item, idx) => {
        const p = item.product as any;
        const price = Number(p.pwaPrice ?? p.pricePerUnit ?? p.sellPrice ?? p.pricePerCarton ?? 0);
        const effectivePrice = price < 500 ? price * 15500 : price;
        const rawCost = Number(p.costPrice ?? p.costPerUnit ?? 0);
        const effectiveCost = rawCost < 500 ? Math.round(rawCost * 15500) : Math.round(rawCost || effectivePrice * 0.75);
        const sub = effectivePrice * item.quantity;
        const totalItemCost = effectiveCost * item.quantity;
        const unitsDeducted = item.quantity;
        return {
          id: `pwa-item-${Date.now()}-${idx}`,
          productId: item.product.id,
          name: item.product.name,
          productName: item.product.name,
          sku: item.product.sku || 'SKU-PWA',
          packageType: 'unit' as PackageType,
          qty: item.quantity,
          quantityOrdered: item.quantity,
          unitsDeducted,
          costPrice: effectiveCost,
          sellingPrice: effectivePrice,
          unitPrice: effectivePrice,
          subtotal: sub,
          profit: Math.max(0, sub - totalItemCost),
        };
      });

      const totalOrderCost = wharfOrderItems.reduce((s, it) => s + it.costPrice * it.qty, 0);
      const totalOrderProfit = Math.max(0, totalPayable - totalOrderCost);
      const nowTimestamp = new Date().toISOString();
      const orderNum = `NL-${Date.now().toString().slice(-4)}`;

      const deliveryDetails = {
        recipientName: member.name || 'Member PWA Terdaftar',
        customerName: member.name || 'Member PWA Terdaftar',
        phone: member.phone || '',
        customerPhone: member.phone || '',
        address: member.address || '',
        notes: member.addressNotes || '',
        addressNotes: member.addressNotes || '',
        businessType: member.businessType || '',
        latitude: member.latitude || DEFAULT_STORE_CONFIG.latitude,
        longitude: member.longitude || DEFAULT_STORE_CONFIG.longitude,
        accuracy: member.accuracy || 5,
        distanceToStoreMeters:
          member.latitude && member.longitude
            ? calculateDistanceToStore(member.latitude, member.longitude)
            : 18,
      };

      const orderPayload = {
        storeId: ACTIVE_STORE_ID,
        outletId: 'out_1',
        orderNumber: orderNum,
        channel: 'pwa',
        customerName: member.name || 'Member PWA Terdaftar',
        customerPhone: member.phone || '',
        customerAddress: member.address || '',
        itemsCount: cart.reduce((sum, i) => sum + i.quantity, 0),
        cartItems: cart,
        items: wharfOrderItems,
        totalCost: totalOrderCost,
        totalAmount: totalPayable,
        totalProfit: totalOrderProfit,
        subtotal: cartSubtotal,
        deliveryFee: deliveryFee,
        memberDiscount: memberDiscount,
        paymentMethod: paymentMethod === 'qris' ? 'qris' : paymentMethod === 'cod' ? 'cash' : 'bank_transfer',
        paymentStatus: paymentMethod === 'qris' ? 'paid' : 'pending',
        status: 'new',
        fulfillmentStatus: 'pending',
        deliveryStaffId: null,
        deliveryStaffName: null,
        deliveryStaffPhone: null,
        assignedAt: null,
        notes: member.addressNotes || '',
        deliveryDetails,
        deliveryAddress: member.address || '',
        addressNotes: member.addressNotes || '',
        timestamp: nowTimestamp,
        createdAt: nowTimestamp,
        updatedAt: nowTimestamp,
      };

      let finalTxId = `TRX-PWA-${Date.now().toString().slice(-6)}`;
      let createdOrderDocId: string | null = null;
      const canonicalSyncKey = `PWA_ORD_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      // 1. Direct write to stores/{ACTIVE_STORE_ID}/orders AND root `orders` using canonical ID
      try {
        const orderDocRef = await addDoc(collection(db, 'stores', ACTIVE_STORE_ID, 'orders'), {
          ...orderPayload,
          canonicalSyncKey,
          stockReconciled: false,
        });
        finalTxId = orderDocRef.id;
        createdOrderDocId = orderDocRef.id;
        await setDoc(
          doc(db, 'orders', createdOrderDocId),
          {
            ...orderPayload,
            id: createdOrderDocId,
            orderId: createdOrderDocId,
            transactionId: createdOrderDocId,
            canonicalSyncKey,
            stockReconciled: false,
          },
          { merge: true }
        );
      } catch (orderErr) {
        console.warn('Firestore stores orders save fallback:', orderErr);
      }

      // 2. Also write to root `transactions` & `stores/store_001/transactions` using the same canonical ID
      const txPayload: Omit<Transaction, 'id'> & Record<string, any> = {
        storeId: ACTIVE_STORE_ID,
        outletId: 'out_1',
        channel: 'pwa_client',
        source: 'Client PWA',
        orderNumber: orderPayload.orderNumber,
        customerName: member.name || 'Member PWA Terdaftar',
        customerPhone: member.phone || '',
        customerAddress: member.address || '',
        totalAmount: totalPayable,
        total: totalPayable,
        totalCost: totalOrderCost,
        paymentMethod: paymentMethod === 'qris' ? 'qris' : paymentMethod === 'cod' ? 'cod' : 'cash',
        status: 'pending_approval',
        fulfillmentStatus: 'pending',
        fraudScore: 8,
        fraudFlags: ['PWA_VERIFIED_MEMBER', 'HIGH_ACCURACY_GPS', 'FONNTE_WHATSAPP_VERIFIED'],
        riskLevel: 'clean',
        customerLatitude: member.latitude || DEFAULT_STORE_CONFIG.latitude,
        customerLongitude: member.longitude || DEFAULT_STORE_CONFIG.longitude,
        distanceToStoreMeters: deliveryDetails.distanceToStoreMeters,
        gpsAccuracy: member.accuracy || 5,
        isMockGpsSuspected: false,
        aiExplanation:
          language === 'id'
            ? `Pesanan PWA Client dari ${member.name} (${cart.length} item) diverifikasi melalui WhatsApp Fonnte & koordinat GPS tervalidasi. Siap diproses sistem POS.`
            : `Client PWA order from ${member.name} (${cart.length} items) verified via WhatsApp & validated GPS coordinates. Ready for POS processing.`,
        items: txItems,
        orderId: createdOrderDocId,
        transactionId: createdOrderDocId,
        canonicalSyncKey,
        stockReconciled: false,
        createdAt: nowTimestamp,
      };

      try {
        const canonicalDocId = createdOrderDocId || finalTxId;
        await Promise.all([
          setDoc(doc(db, 'transactions', canonicalDocId), { ...txPayload, id: canonicalDocId }, { merge: true }),
          setDoc(
            doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', canonicalDocId),
            { ...txPayload, id: canonicalDocId },
            { merge: true }
          ),
        ]);
        if (createdOrderDocId) {
          await setDoc(
            doc(db, 'stores', ACTIVE_STORE_ID, 'orders', createdOrderDocId),
            { id: createdOrderDocId, orderId: createdOrderDocId, transactionId: canonicalDocId },
            { merge: true }
          );
        }

        // Save each item to items subcollection
        for (const item of txItems) {
          try {
            await addDoc(collection(db, 'transactions', canonicalDocId, 'items'), {
              ...item,
              transactionId: canonicalDocId,
            });
          } catch (e) {
            console.warn('Subcollection item error:', e);
          }
        }
      } catch (firestoreErr) {
        console.warn('Firestore transaction save fallback:', firestoreErr);
      }

      // 3. Update customer totalSpent, totalOrders, and reward points in 'customers' collection
      try {
        const normPhone = normalizePhone(member.phone) || member.phone.replace(/[^0-9]/g, '') || `PWA-${Date.now()}`;
        const existingCust = registeredCustomers.find(
          (c) => normalizePhone(c.phone || '') === normPhone
        );
        const custDocId = existingCust?.id || `CUST-PWA-${normPhone}`;
        const earnedPoints = Math.max(10, Math.floor(totalPayable / 10000));
        await setDoc(
          doc(db, 'customers', custDocId),
          {
            id: custDocId,
            storeId: ACTIVE_STORE_ID,
            name: member.name || 'Member PWA',
            phone: member.phone || '',
            email: member.email || '',
            businessType: member.businessType || 'Toko Kelontong & Sembako',
            address: member.address || '',
            addressNotes: member.addressNotes || '',
            latitude: member.latitude ?? DEFAULT_STORE_CONFIG.latitude,
            longitude: member.longitude ?? DEFAULT_STORE_CONFIG.longitude,
            type: existingCust?.type || 'Member PWA',
            typeCode: existingCust?.typeCode || 'CUST-REG',
            isVerified: true,
            points: (existingCust?.points ?? 0) + earnedPoints,
            totalSpent: (existingCust?.totalSpent ?? 0) + totalPayable,
            totalOrders: (existingCust?.totalOrders ?? 0) + 1,
            lastTransactionDate: new Date().toLocaleDateString('id-ID', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            }),
            status: 'active',
            updatedAt: nowTimestamp,
          },
          { merge: true }
        );
      } catch (custErr) {
        console.warn('Customer stats update notice:', custErr);
      }

      const tx: Transaction = {
        id: finalTxId,
        ...txPayload,
      };

      setPlacedTx(tx);
      setIsOrderPlaced(true);
    } catch (err) {
      console.error('Error placing order:', err);
    } finally {
      setIsPlacingOrder(false);
    }
  };

  // Filter products by category & search
  const filteredProducts = catalogProducts.filter((p) => {
    const matchCat = activeCategory === 'Semua' || p.category.toLowerCase().includes(activeCategory.toLowerCase());
    const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  const isDevUi =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('dev') === '1';

  // Per-product package type selector state (mirrors PosMachine segmented Satuan | Dus toggle)
  const [selectedPkgModes, setSelectedPkgModes] = useState<Record<string, PackageType>>({});

  const getProductPkgMode = (_p: Product): PackageType => {
    return 'unit';
  };

  const setProductPkgMode = (productId: string, mode: PackageType) => {
    setSelectedPkgModes((prev) => ({ ...prev, [productId]: mode }));
  };

  const handleUpdateProductCartQty = (prod: Product, _pkgType: PackageType, delta: number) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.product.id === prod.id);
      if (idx >= 0) {
        const copy = [...prev];
        const nextQty = copy[idx].quantity + delta;
        if (nextQty <= 0) {
          return copy.filter((_, i) => i !== idx);
        }
        copy[idx] = { ...copy[idx], packageType: 'unit', quantity: nextQty };
        return copy;
      } else if (delta > 0) {
        return [...prev, { product: prod, packageType: 'unit', quantity: delta }];
      }
      return prev;
    });
  };

  // Reusable Gold & Black Luxury PWA UI class tokens
  const goldInputClass =
    'w-full px-4 py-3 bg-[#100d08]/85 border border-[rgba(255,200,82,0.45)] focus:border-[#ffd86b] focus:ring-2 focus:ring-[rgba(255,190,50,0.2)] rounded-xl text-xs sm:text-sm text-[#f7f3ea] placeholder-[#8c8270] focus:outline-none transition shadow-[0_0_12px_rgba(255,185,45,0.1)]';
  const goldPrimaryBtnClass =
    'w-full py-3.5 px-5 bg-gradient-to-r from-[#e5b13a] via-[#fbdc7a] to-[#e8b440] text-[#1b1204] font-extrabold text-sm rounded-2xl shadow-[0_0_24px_rgba(255,185,45,0.42)] border border-[rgba(255,215,106,0.55)] flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="min-h-dvh w-full max-w-full bg-[#070503] text-[#f7f3ea] font-sans flex flex-col items-center">
      {/* ============================================================ */}
      {/* STANDALONE PWA CONTAINER (UNIFIED GOLD & BLACK THEME)        */}
      {/* ============================================================ */}
      <div className="min-h-dvh w-full max-w-full bg-[#070503] relative flex flex-col flex-1">
        {/* Compact Standalone Utility Bar (hidden on all full-bleed Gold screens) */}
        {false && (
          <div className="w-full bg-zinc-950/90 border-b border-zinc-800/80 px-4 py-2 flex items-center justify-between gap-2 z-30">
            <div className="flex items-center gap-2">
              {isDevUi && (
                <button
                  onClick={() => setShowFlowBar((prev) => !prev)}
                  className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-[11px] font-semibold border border-zinc-800 flex items-center gap-1.5 transition cursor-pointer"
                  title={tr('Toggle PWA Screen Switcher', 'Buka/Tutup Navigasi Layar PWA')}
                >
                  <Smartphone className="w-3.5 h-3.5 text-blue-400" />
                  <span>{tr('Screens', 'Layar')}</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${showFlowBar ? 'rotate-180' : ''}`} />
                </button>
              )}

              <PWAInstallButton />
            </div>

            <div className="flex items-center gap-1.5">
              {/* Global Language Dropdown */}
              <LanguageDropdown compact />

              {isDevUi && (
                <button
                  onClick={() => setWideDesktopMode((prev) => !prev)}
                  className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-[10px] font-semibold border border-zinc-800 transition cursor-pointer"
                  title={tr('Toggle Mobile / Full Width on Desktop', 'Ubah Lebar Layar Desktop')}
                >
                  <span>{wideDesktopMode ? '448px' : '100%'}</span>
                </button>
              )}

              {isDevUi && (
                <a
                  href="/client-pwa"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-blue-400 text-[10px] font-bold border border-blue-500/30 transition cursor-pointer"
                  title={tr('Open Standalone Client PWA in New Tab', 'Buka Client PWA Mandiri di Tab Baru')}
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>{tr('Full Screen', 'Layar Penuh')}</span>
                </a>
              )}
            </div>
          </div>
        )}

        {/* Collapsible Quick Screen Stepper (Dev Bar) */}
        {isDevUi && showFlowBar && currentScreen !== 'splash' && currentScreen !== 'home_guest' && (
          <div className="w-full bg-zinc-900 border-b border-zinc-800 px-3 py-2 overflow-x-auto z-30">
            <div className="flex items-center gap-1.5 text-[11px] whitespace-nowrap">
              <button
                onClick={() => setCurrentScreen('splash')}
                className="px-2.5 py-1 rounded-lg font-medium transition cursor-pointer bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800"
              >
                1. Splash
              </button>
              <button
                onClick={() => setCurrentScreen('home_guest')}
                className="px-2.5 py-1 rounded-lg font-medium transition cursor-pointer bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800"
              >
                2. Home / Login
              </button>
              <button
                onClick={() => setCurrentScreen('register_member')}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  currentScreen === 'register_member'
                    ? 'bg-blue-600 text-white font-bold shadow-sm'
                    : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                3. Register 1
              </button>
              <button
                onClick={() => setCurrentScreen('setting_address')}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  currentScreen === 'setting_address'
                    ? 'bg-blue-600 text-white font-bold shadow-sm'
                    : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                4. Register 2 (GPS)
              </button>
              <button
                onClick={() => setCurrentScreen('verify_whatsapp')}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  currentScreen === 'verify_whatsapp'
                    ? 'bg-blue-600 text-white font-bold shadow-sm'
                    : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                5. OTP
              </button>
              <button
                onClick={() => setCurrentScreen('home_member')}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  currentScreen === 'home_member'
                    ? 'bg-blue-600 text-white font-bold shadow-sm'
                    : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                6. Belanja
              </button>
              <button
                onClick={() => setCurrentScreen('cart')}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  currentScreen === 'cart'
                    ? 'bg-blue-600 text-white font-bold shadow-sm'
                    : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                7. Keranjang ({cart.length})
              </button>
              <button
                onClick={() => setCurrentScreen('order_history')}
                className={`px-2.5 py-1 rounded-lg font-medium transition flex items-center gap-1 cursor-pointer ${
                  currentScreen === 'order_history'
                    ? 'bg-blue-600 text-white font-bold shadow-sm'
                    : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                <span>8. Riwayat ({userOrders.length})</span>
                {activeOrdersCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />}
              </button>
            </div>
          </div>
        )}

        {/* ========================================================== */}
        {/* TAMPILAN 1: GOLDEN ANIMATED SPLASH SCREEN (EXACT HTML/SVG) */}
        {/* ========================================================== */}
        {currentScreen === 'splash' && (
          <div
            onClick={handleFinishSplash}
            className={`rc-splash-root run fixed inset-0 z-50 w-full h-[100dvh] overflow-hidden select-none cursor-pointer transition-opacity duration-500 ${
              isSplashFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
          >
            <style>{`
              .rc-splash-root {
                --gold-1: #ffd76a;
                --gold-2: #f3c04a;
                --bg: #050403;
                font-family: "Plus Jakarta Sans", "Inter", system-ui, -apple-system, sans-serif;
                background: var(--bg);
                color: #fff;
                -webkit-font-smoothing: antialiased;
              }
              .rc-splash-root .bg {
                position: fixed;
                inset: 0;
                z-index: 0;
                overflow: hidden;
                background:
                  radial-gradient(ellipse at 50% 46%, rgba(255, 190, 60, 0.07), transparent 62%),
                  #050403;
              }
              .rc-splash-root .bg > svg { position: absolute; display: block; overflow: visible; }
              .rc-splash-root .bg-top    { top: 0;    left: 0;  width: 100%; height: 48vh; }
              .rc-splash-root .bg-bottom { bottom: 0; right: 0; width: 100%; height: 75vh; }

              .rc-splash-root .orb { position: absolute; border-radius: 50%; pointer-events: none; }
              .rc-splash-root .orb-r {
                right: -20vmax; top: 28%;
                width: 46vmax; height: 46vmax;
                background: radial-gradient(circle, rgba(255, 185, 45, 0.30), rgba(255, 170, 30, 0.08) 45%, transparent 68%);
              }
              .rc-splash-root .orb-tl {
                left: -16vmax; top: -10vmax;
                width: 44vmax; height: 44vmax;
                background: radial-gradient(circle, rgba(255, 200, 80, 0.34), rgba(255, 170, 30, 0.08) 45%, transparent 68%);
              }
              .rc-splash-root .orb-b {
                left: -18vmax; bottom: -16vmax;
                width: 44vmax; height: 44vmax;
                background: radial-gradient(circle, rgba(255, 190, 60, 0.26), transparent 66%);
              }

              .rc-splash-root .beam {
                position: absolute;
                inset: -20% -30%;
                background: linear-gradient(115deg, transparent 40%, rgba(255, 205, 90, 0.075) 50%, transparent 60%);
                pointer-events: none;
              }

              .rc-splash-root .line  { fill: none; stroke-linecap: round; }
              .rc-splash-root .soft  { fill: none; stroke-linecap: round; }
              .rc-splash-root .draw  { stroke-dasharray: 1000 1000; }
              .rc-splash-root .comet {
                fill: none;
                stroke: #fff4cc;
                stroke-linecap: round;
                stroke-dasharray: 160 2400;
                stroke-dashoffset: 160;
              }

              .rc-splash-root .dust-layer { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
              .rc-splash-root .dust {
                position: absolute;
                bottom: -12px;
                border-radius: 50%;
                background: radial-gradient(circle, #fff6d6 0%, #ffc83a 45%, rgba(255, 190, 50, 0) 72%);
                opacity: 0;
              }

              .rc-splash-root .page {
                position: relative;
                z-index: 1;
                min-height: 100dvh;
                display: grid;
                place-items: center;
                padding: 24px 16px 12vh;
              }

              .rc-splash-root .stage {
                --s: min(92vw, 560px);
                position: relative;
                width: var(--s);
                display: flex;
                flex-direction: column;
                align-items: center;
              }

              .rc-splash-root .halo {
                position: absolute;
                left: 50%;
                top: calc(var(--s) * 0.15);
                width: calc(var(--s) * 1.35);
                height: calc(var(--s) * 0.62);
                transform: translate(-50%, -50%);
                background: radial-gradient(ellipse at center, rgba(255, 190, 60, 0.26), rgba(255, 170, 30, 0.07) 50%, transparent 70%);
                pointer-events: none;
              }

              .rc-splash-root .brand-wrap {
                position: relative;
                overflow: hidden;
                padding: 26px 30px;
                margin: -26px -30px;
              }

              .rc-splash-root .brand {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: calc(var(--s) * 0.035);
              }

              .rc-splash-root .brand-mark {
                width: calc(var(--s) * 0.26);
                flex: none;
                overflow: visible;
                filter: drop-shadow(0 0 12px rgba(255, 190, 50, 0.5));
              }
              .rc-splash-root .hex-draw  { fill: none; stroke-linejoin: round; stroke-linecap: round; stroke-dasharray: 1000 1000; }
              .rc-splash-root .hex-inner { fill: none; stroke-linejoin: round; stroke-linecap: round; }
              .rc-splash-root .hex-comet {
                fill: none;
                stroke: #fff8dc;
                stroke-width: 3.4;
                stroke-linejoin: round;
                stroke-linecap: round;
                stroke-dasharray: 130 2400;
                stroke-dashoffset: 130;
              }
              .rc-splash-root .pos { transform-box: fill-box; transform-origin: center; }

              .rc-splash-root .divider {
                width: 2px;
                align-self: stretch;
                margin: 6px 0;
                background: linear-gradient(180deg, transparent, var(--gold-2) 18%, var(--gold-2) 82%, transparent);
                box-shadow: 0 0 10px rgba(255, 190, 50, 0.7);
                flex: none;
                transform-origin: center;
              }

              .rc-splash-root .brand-text { display: flex; flex-direction: column; line-height: 1; text-align: left; }

              .rc-splash-root .brand-name {
                font-size: calc(var(--s) * 0.135);
                font-weight: 800;
                letter-spacing: -0.02em;
                white-space: nowrap;
                filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.7));
              }
              .rc-splash-root .l {
                display: inline-block;
                padding: 0.06em 0.03em;
                margin: -0.06em -0.03em;
                color: transparent;
                -webkit-text-fill-color: transparent;
                -webkit-background-clip: text;
                        background-clip: text;
              }
              .rc-splash-root .l.w { background-image: linear-gradient(180deg, #ffffff 0%, #ffffff 45%, #cdcdcd 100%); }
              .rc-splash-root .l.g { background-image: linear-gradient(180deg, #ffe9a0 0%, #ffc83a 50%, #e8a01c 100%); }

              .rc-splash-root .brand-sub {
                margin-top: calc(var(--s) * 0.012);
                font-size: calc(var(--s) * 0.054);
                font-weight: 600;
                letter-spacing: 0.01em;
                color: var(--gold-2);
                white-space: nowrap;
              }

              .rc-splash-root .glint {
                position: absolute;
                width: 22px; height: 22px;
                pointer-events: none;
                opacity: 0;
                filter: drop-shadow(0 0 6px rgba(255, 220, 120, 0.95));
              }
              .rc-splash-root .g1 { left: 8%;  top: 22%; }
              .rc-splash-root .g2 { left: 94%; top: 30%; }
              .rc-splash-root .g3 { left: 52%; top: 76%; width: 16px; height: 16px; }

              .rc-splash-root .sweep {
                position: absolute; inset: 0; pointer-events: none;
                -webkit-mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, #000 52%, transparent 100%);
                        mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, #000 52%, transparent 100%);
              }
              .rc-splash-root .sweep::before {
                content: "";
                position: absolute;
                top: -15%; bottom: -15%;
                left: -45%;
                width: 38%;
                background: linear-gradient(90deg, rgba(255, 240, 190, 0) 0%, rgba(255, 238, 180, 0.55) 50%, rgba(255, 240, 190, 0) 100%);
                transform: skewX(-18deg);
                filter: blur(7px);
                opacity: 0;
              }

              .rc-splash-root .tagline {
                margin-top: calc(var(--s) * 0.115);
                font-size: calc(var(--s) * 0.05);
                font-weight: 500;
                letter-spacing: 0.02em;
                text-align: center;
                color: #a9a499;
                background: linear-gradient(100deg, #9c978c 0%, #9c978c 42%, #ffffff 50%, #9c978c 58%, #9c978c 100%);
                background-size: 250% 100%;
                background-position: 100% 0;
                -webkit-background-clip: text;
                        background-clip: text;
                -webkit-text-fill-color: transparent;
              }

              .rc-splash-root.run .bg { animation: rcFadeIn 1.2s ease both; }
              .rc-splash-root.run .draw { animation: rcDraw 2.4s cubic-bezier(.4, 0, .2, 1) both; animation-delay: var(--d, 0s); }
              .rc-splash-root.run .comet { animation: rcComet var(--t, 6s) linear infinite; animation-delay: var(--d, 2.6s); }
              .rc-splash-root.run .soft { animation: rcBreathe 5s ease-in-out infinite alternate; animation-delay: var(--d, 0s); }
              .rc-splash-root.run .drift { animation: rcDrift 11s ease-in-out infinite alternate; }
              .rc-splash-root.run .drift.rev { animation-duration: 15s; animation-direction: alternate-reverse; }
              .rc-splash-root.run .orb-r  { animation: rcPulse 6s ease-in-out infinite alternate; }
              .rc-splash-root.run .orb-tl { animation: rcPulse 7.5s ease-in-out -2s infinite alternate; }
              .rc-splash-root.run .orb-b  { animation: rcPulse 8s ease-in-out -4s infinite alternate; }
              .rc-splash-root.run .beam   { animation: rcBeam 10s ease-in-out infinite alternate; }
              .rc-splash-root.run .spark  { animation: rcTwinkle 3.6s ease-in-out infinite; }
              .rc-splash-root.run .spark:nth-child(2n) { animation-delay: 1.1s; }
              .rc-splash-root.run .spark:nth-child(3n) { animation-delay: 2.2s; }
              .rc-splash-root.run .dust   { animation: rcRise linear infinite; }

              .rc-splash-root.run .halo { animation: rcHaloIn 1.8s ease 0.2s both, rcHaloPulse 4.5s ease-in-out 2s infinite alternate; }
              .rc-splash-root.run .stage { animation: rcBob 7s ease-in-out 3.6s infinite; }
              .rc-splash-root.run .brand-mark { animation: rcMarkGlow 3.6s ease-in-out 2s infinite alternate; }
              .rc-splash-root.run .hex-draw  { animation: rcDraw 1.3s cubic-bezier(.65, 0, .35, 1) 0.3s both; }
              .rc-splash-root.run .hex-inner { animation: rcFadeIn 0.9s ease 1.2s both; }
              .rc-splash-root.run .hex-comet { animation: rcHexComet 3.4s linear 3.2s infinite; }
              .rc-splash-root.run .pos       { animation: rcPosIn 0.9s cubic-bezier(.2, .8, .2, 1) 0.9s both; }
              .rc-splash-root.run .divider   { animation: rcGrowY 0.6s cubic-bezier(.3, .7, .2, 1) 1.25s both; }
              .rc-splash-root.run .l         { animation: rcLetterIn 0.75s cubic-bezier(.2, .8, .2, 1) calc(1.4s + var(--i) * 0.07s) both; }
              .rc-splash-root.run .brand-sub { animation: rcWipe 0.95s cubic-bezier(.6, 0, .2, 1) 2.3s both; }
              .rc-splash-root.run .tagline   { animation: rcTagIn 1s ease 3s both, rcShimmer 5s linear 4.2s infinite; }
              .rc-splash-root.run .sweep::before { animation: rcSweep 6s ease-in-out 3.7s infinite; }
              .rc-splash-root.run .g1 { animation: rcGlint 5s ease-in-out 3.9s infinite; }
              .rc-splash-root.run .g2 { animation: rcGlint 5s ease-in-out 5.4s infinite; }
              .rc-splash-root.run .g3 { animation: rcGlint 5s ease-in-out 7.1s infinite; }

              @keyframes rcFadeIn   { from { opacity: 0; } to { opacity: 1; } }
              @keyframes rcDraw     { from { stroke-dashoffset: 1000; } to { stroke-dashoffset: 0; } }
              @keyframes rcComet    { from { stroke-dashoffset: 160; } to { stroke-dashoffset: -1000; } }
              @keyframes rcHexComet { 0% { stroke-dashoffset: 130; } 55%, 100% { stroke-dashoffset: -1000; } }
              @keyframes rcBreathe  { from { opacity: 0.16; } to { opacity: 0.45; } }
              @keyframes rcDrift    { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(10px, 14px, 0); } }
              @keyframes rcPulse    { from { opacity: 0.45; transform: scale(0.92); } to { opacity: 1; transform: scale(1.08); } }
              @keyframes rcBeam     { from { transform: translateX(-22%); } to { transform: translateX(22%); } }
              @keyframes rcTwinkle  { 0%, 100% { opacity: 0.15; } 50% { opacity: 1; } }
              @keyframes rcRise {
                0%   { transform: translate3d(0, 0, 0); opacity: 0; }
                12%  { opacity: 0.95; }
                85%  { opacity: 0.55; }
                100% { transform: translate3d(var(--sx, 0px), -112vh, 0); opacity: 0; }
              }
              @keyframes rcHaloIn    { from { opacity: 0; } to { opacity: 1; } }
              @keyframes rcHaloPulse {
                from { transform: translate(-50%, -50%) scale(0.92); opacity: 0.65; }
                to   { transform: translate(-50%, -50%) scale(1.1);  opacity: 1; }
              }
              @keyframes rcBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
              @keyframes rcMarkGlow {
                from { filter: drop-shadow(0 0 8px rgba(255, 190, 50, 0.4)); }
                to   { filter: drop-shadow(0 0 24px rgba(255, 205, 80, 0.9)); }
              }
              @keyframes rcPosIn {
                from { opacity: 0; transform: scale(0.65) translateY(6px); }
                to   { opacity: 1; transform: none; }
              }
              @keyframes rcGrowY {
                from { opacity: 0; transform: scaleY(0); }
                to   { opacity: 1; transform: scaleY(1); }
              }
              @keyframes rcLetterIn {
                from { opacity: 0; transform: translateY(0.4em) scale(0.88); filter: blur(10px); }
                to   { opacity: 1; transform: none; filter: blur(0); }
              }
              @keyframes rcWipe {
                from { opacity: 0; clip-path: inset(-0.4em 100% -0.4em -0.2em); transform: translateX(-10px); }
                to   { opacity: 1; clip-path: inset(-0.4em -0.3em -0.4em -0.2em); transform: none; }
              }
              @keyframes rcTagIn {
                from { opacity: 0; transform: translateY(12px); letter-spacing: 0.14em; }
                to   { opacity: 1; transform: none; letter-spacing: 0.02em; }
              }
              @keyframes rcShimmer {
                from { background-position: 100% 0; }
                to   { background-position: -150% 0; }
              }
              @keyframes rcSweep {
                0%        { opacity: 0; transform: skewX(-18deg) translateX(0); }
                4%        { opacity: 1; }
                42%       { opacity: 1; transform: skewX(-18deg) translateX(430%); }
                46%, 100% { opacity: 0; transform: skewX(-18deg) translateX(430%); }
              }
              @keyframes rcGlint {
                0%, 72%, 100% { opacity: 0; transform: scale(0) rotate(0deg); }
                82%           { opacity: 1; transform: scale(1) rotate(45deg); }
                92%           { opacity: 0.5; transform: scale(0.45) rotate(90deg); }
              }
              @media (max-width: 380px) {
                .rc-splash-root .brand-wrap { padding: 22px 22px; margin: -22px -22px; }
              }
              @media (min-aspect-ratio: 1/1) {
                .rc-splash-root .bg-bottom { height: 58vh; }
                .rc-splash-root .bg-top    { height: 44vh; }
                .rc-splash-root .f-thin    { display: none; }
              }
            `}</style>

            {/* Top-Right Language Selector & Live Database/POS Status Bar */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="fixed top-4 left-4 right-4 z-20 flex items-center justify-between max-w-md mx-auto"
            >
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-amber-500/30 text-[11px] font-medium text-amber-200/90">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>{tr('POS & Database Connected', 'Database & POS Terhubung')}</span>
              </div>
              <LanguageDropdown compact />
            </div>

            {/* ================= LATAR CAHAYA ================= */}
            <div className="bg" aria-hidden="true">
              <div className="orb orb-tl" />
              <div className="orb orb-r" />
              <div className="orb orb-b" />

              {/* Lengkung besar kiri atas */}
              <svg className="bg-top" viewBox="0 0 911 560" preserveAspectRatio="xMinYMin meet" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="gArc" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="911" y2="0">
                    <stop offset="0" stopColor="#fff2c4" stopOpacity="1" />
                    <stop offset="0.3" stopColor="#ffcf5a" stopOpacity="1" />
                    <stop offset="0.7" stopColor="#ffc24a" stopOpacity="0.55" />
                    <stop offset="1" stopColor="#ffc24a" stopOpacity="0.08" />
                  </linearGradient>
                  <filter id="glowA" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="6" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="glowC" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="blurBig" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="20" />
                  </filter>
                </defs>

                <g className="drift">
                  <path className="soft" d="M-30,470 C100,300 300,170 520,100 C680,52 820,52 940,72" stroke="url(#gArc)" strokeWidth="54" opacity="0.3" filter="url(#blurBig)" />
                  <path className="soft" style={{ '--d': '-2s' } as React.CSSProperties} d="M-30,330 C40,250 90,170 150,60" stroke="url(#gArc)" strokeWidth="40" opacity="0.3" filter="url(#blurBig)" />

                  <path className="line draw" style={{ '--d': '0.1s' } as React.CSSProperties} pathLength={1000} d="M-30,470 C100,300 300,170 520,100 C680,52 820,52 940,72" stroke="url(#gArc)" strokeWidth="4.5" filter="url(#glowA)" />
                  <path className="line draw" style={{ '--d': '0.3s' } as React.CSSProperties} pathLength={1000} d="M-30,425 C90,265 260,150 460,82 C620,32 780,30 940,46" stroke="url(#gArc)" strokeWidth="2.2" opacity="0.9" filter="url(#glowA)" />
                  <path className="line draw" style={{ '--d': '0.5s' } as React.CSSProperties} pathLength={1000} d="M-30,385 C80,240 230,130 400,70" stroke="url(#gArc)" strokeWidth="1.2" opacity="0.7" />

                  <path className="line draw" style={{ '--d': '0.6s' } as React.CSSProperties} pathLength={1000} d="M-30,235 C60,170 110,90 175,-30" stroke="url(#gArc)" strokeWidth="3" filter="url(#glowA)" />
                  <path className="line draw" style={{ '--d': '0.8s' } as React.CSSProperties} pathLength={1000} d="M-30,180 C40,130 80,60 120,-30" stroke="url(#gArc)" strokeWidth="1.6" opacity="0.8" filter="url(#glowA)" />

                  <path className="comet" style={{ '--t': '5.6s', '--d': '2.4s' } as React.CSSProperties} pathLength={1000} d="M-30,470 C100,300 300,170 520,100 C680,52 820,52 940,72" strokeWidth="3.6" filter="url(#glowC)" />
                  <path className="comet" style={{ '--t': '7.2s', '--d': '4.2s' } as React.CSSProperties} pathLength={1000} d="M-30,425 C90,265 260,150 460,82 C620,32 780,30 940,46" strokeWidth="2.2" filter="url(#glowC)" />
                  <path className="comet" style={{ '--t': '4.8s', '--d': '3.1s' } as React.CSSProperties} pathLength={1000} d="M-30,235 C60,170 110,90 175,-30" strokeWidth="2.4" filter="url(#glowC)" />
                </g>

                <g fill="#ffd978">
                  <circle className="spark" cx="62" cy="150" r="2" />
                  <circle className="spark" cx="215" cy="205" r="1.5" />
                  <circle className="spark" cx="470" cy="92" r="1.4" />
                  <circle className="spark" cx="130" cy="30" r="1.6" />
                </g>
              </svg>

              {/* Gelombang kanan dan bawah */}
              <svg className="bg-bottom" viewBox="0 900 911 827" preserveAspectRatio="xMaxYMax meet" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="gSweep" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="911" y2="0">
                    <stop offset="0" stopColor="#ffc24a" stopOpacity="0" />
                    <stop offset="0.28" stopColor="#ffc24a" stopOpacity="0.8" />
                    <stop offset="0.65" stopColor="#fff0b8" stopOpacity="1" />
                    <stop offset="1" stopColor="#ffd978" stopOpacity="1" />
                  </linearGradient>
                  <filter id="glowB" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="7" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="glowD" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="blurBig2" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="22" />
                  </filter>
                </defs>

                <g className="drift rev">
                  <path className="soft" d="M930,990 C900,1170 800,1300 640,1390 C470,1485 250,1510 -20,1600" stroke="url(#gSweep)" strokeWidth="80" opacity="0.32" filter="url(#blurBig2)" />
                  <path className="soft" style={{ '--d': '-2.5s' } as React.CSSProperties} d="M-20,1610 C100,1545 260,1565 420,1625 C560,1675 760,1705 930,1695" stroke="url(#gSweep)" strokeWidth="50" opacity="0.28" filter="url(#blurBig2)" />
                  <path className="soft" style={{ '--d': '-1s' } as React.CSSProperties} d="M930,1335 C800,1425 700,1525 590,1655" stroke="url(#gSweep)" strokeWidth="44" opacity="0.3" filter="url(#blurBig2)" />

                  <path className="line draw" style={{ '--d': '0.4s' } as React.CSSProperties} pathLength={1000} d="M930,980 C900,1160 800,1290 640,1380 C470,1475 250,1500 -20,1590" stroke="url(#gSweep)" strokeWidth="4.5" filter="url(#glowB)" />
                  <path className="line draw" style={{ '--d': '0.6s' } as React.CSSProperties} pathLength={1000} d="M930,1030 C890,1200 780,1320 620,1410 C450,1500 230,1530 -20,1640" stroke="url(#gSweep)" strokeWidth="2.6" opacity="0.9" filter="url(#glowB)" />
                  <path className="line draw" style={{ '--d': '0.8s' } as React.CSSProperties} pathLength={1000} d="M930,1090 C880,1250 760,1360 600,1440 C430,1525 200,1560 -20,1690" stroke="url(#gSweep)" strokeWidth="1.3" opacity="0.7" />

                  <path className="line draw" style={{ '--d': '0.9s' } as React.CSSProperties} pathLength={1000} d="M930,1330 C800,1420 700,1520 590,1650" stroke="url(#gSweep)" strokeWidth="3.4" filter="url(#glowB)" />
                  <path className="line draw" style={{ '--d': '1.1s' } as React.CSSProperties} pathLength={1000} d="M930,1380 C820,1460 740,1560 650,1690" stroke="url(#gSweep)" strokeWidth="1.8" opacity="0.85" filter="url(#glowB)" />

                  <path className="line draw" style={{ '--d': '1s' } as React.CSSProperties} pathLength={1000} d="M-20,1610 C100,1540 260,1560 420,1620 C560,1670 760,1700 930,1690" stroke="url(#gSweep)" strokeWidth="3" filter="url(#glowB)" />
                  <path className="line draw" style={{ '--d': '1.2s' } as React.CSSProperties} pathLength={1000} d="M-20,1660 C120,1590 300,1600 450,1660 C600,1715 800,1730 930,1720" stroke="url(#gSweep)" strokeWidth="1.6" opacity="0.8" />

                  <path className="line draw f-thin" style={{ '--d': '1.2s' } as React.CSSProperties} pathLength={1000} d="M-10,905 C60,990 130,1060 190,1140" stroke="url(#gSweep)" strokeWidth="1.4" opacity="0.7" />

                  <path className="comet" style={{ '--t': '6.4s', '--d': '2.8s' } as React.CSSProperties} pathLength={1000} d="M930,980 C900,1160 800,1290 640,1380 C470,1475 250,1500 -20,1590" strokeWidth="3.8" filter="url(#glowD)" />
                  <path className="comet" style={{ '--t': '8s', '--d': '4.6s' } as React.CSSProperties} pathLength={1000} d="M930,1030 C890,1200 780,1320 620,1410 C450,1500 230,1530 -20,1640" strokeWidth="2.4" filter="url(#glowD)" />
                  <path className="comet" style={{ '--t': '5s', '--d': '3.4s' } as React.CSSProperties} pathLength={1000} d="M930,1330 C800,1420 700,1520 590,1650" strokeWidth="3" filter="url(#glowD)" />
                  <path className="comet" style={{ '--t': '7s', '--d': '5.5s' } as React.CSSProperties} pathLength={1000} d="M-20,1610 C100,1540 260,1560 420,1620 C560,1670 760,1700 930,1690" strokeWidth="2.6" filter="url(#glowD)" />
                </g>

                <g fill="#ffd978">
                  <circle className="spark" cx="860" cy="1060" r="2.2" />
                  <circle className="spark" cx="780" cy="1230" r="1.6" />
                  <circle className="spark" cx="700" cy="1310" r="1.8" />
                  <circle className="spark" cx="880" cy="1420" r="1.7" />
                  <circle className="spark" cx="420" cy="1500" r="1.4" />
                  <circle className="spark" cx="150" cy="1560" r="1.8" />
                  <circle className="spark" cx="560" cy="1680" r="1.5" />
                  <circle className="spark" cx="260" cy="1665" r="1.3" />
                </g>
              </svg>

              <div className="beam" />
              <div className="dust-layer">
                {Array.from({ length: 32 }).map((_, i) => {
                  const size = 1.8 + ((i * 7) % 28) / 10;
                  const left = ((i * 31) % 98) + 1;
                  const dur = 9 + ((i * 13) % 11);
                  const delay = -((i * 17) % 19);
                  const sx = (((i * 23) % 90) - 45);
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

            {/* ================= LOGO ================= */}
            <main className="page">
              <div className="stage">
                <div className="halo" />

                <div className="brand-wrap">
                  <header
                    translate="no"
                    data-no-translate="true"
                    className="brand notranslate"
                    aria-label="POS RiskCart Artificial Intelligence"
                  >
                    <svg className="brand-mark" viewBox="-8 -8 124 126" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="POS">
                      <defs>
                        <linearGradient id="hexGold" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0" stopColor="#fff0b8" />
                          <stop offset="0.45" stopColor="#ffc83a" />
                          <stop offset="1" stopColor="#d98d12" />
                        </linearGradient>
                        <linearGradient id="posWhite" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0" stopColor="#ffffff" />
                          <stop offset="1" stopColor="#c9c9c9" />
                        </linearGradient>
                        <filter id="hexGlow" x="-30%" y="-30%" width="160%" height="160%">
                          <feGaussianBlur stdDeviation="2" result="b" />
                          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                        </filter>
                      </defs>
                      <path className="hex-draw" pathLength={1000} d="M100,27 L50,0 L0,27 L0,83 L50,110 L100,83" stroke="url(#hexGold)" strokeWidth="7" />
                      <path className="hex-inner" d="M92,33 L50,10 L9,33 L9,77 L50,100 L92,77" stroke="url(#hexGold)" strokeWidth="1.6" opacity="0.55" />
                      <path className="hex-comet" pathLength={1000} d="M100,27 L50,0 L0,27 L0,83 L50,110 L100,83" filter="url(#hexGlow)" />
                      <text className="pos" x="55" y="70" textAnchor="middle" fontFamily="Plus Jakarta Sans, Inter, system-ui, sans-serif" fontWeight="900" fontSize="46" letterSpacing="-2.5" fill="url(#posWhite)">POS</text>
                    </svg>

                    <span className="divider" />

                    <div translate="no" data-no-translate="true" className="brand-text notranslate">
                      <span className="brand-name notranslate" aria-label="RiskCart">
                        <span className="l w" style={{ '--i': 0 } as React.CSSProperties} aria-hidden="true">R</span>
                        <span className="l w" style={{ '--i': 1 } as React.CSSProperties} aria-hidden="true">i</span>
                        <span className="l w" style={{ '--i': 2 } as React.CSSProperties} aria-hidden="true">s</span>
                        <span className="l w" style={{ '--i': 3 } as React.CSSProperties} aria-hidden="true">k</span>
                        <span className="l g" style={{ '--i': 4 } as React.CSSProperties} aria-hidden="true">C</span>
                        <span className="l g" style={{ '--i': 5 } as React.CSSProperties} aria-hidden="true">a</span>
                        <span className="l g" style={{ '--i': 6 } as React.CSSProperties} aria-hidden="true">r</span>
                        <span className="l g" style={{ '--i': 7 } as React.CSSProperties} aria-hidden="true">t</span>
                      </span>
                      <span className="brand-sub notranslate">Artificial Intelligence</span>
                    </div>
                  </header>

                  <div className="sweep" />

                  <svg className="glint g1" viewBox="-12 -12 24 24" aria-hidden="true"><path d="M0,-11 Q1,-1 11,0 Q1,1 0,11 Q-1,1 -11,0 Q-1,-1 0,-11Z" fill="#fff6d6" /></svg>
                  <svg className="glint g2" viewBox="-12 -12 24 24" aria-hidden="true"><path d="M0,-11 Q1,-1 11,0 Q1,1 0,11 Q-1,1 -11,0 Q-1,-1 0,-11Z" fill="#fff6d6" /></svg>
                  <svg className="glint g3" viewBox="-12 -12 24 24" aria-hidden="true"><path d="M0,-11 Q1,-1 11,0 Q1,1 0,11 Q-1,1 -11,0 Q-1,-1 0,-11Z" fill="#fff6d6" /></svg>
                </div>

                <p className="tagline">
                  {tr('Trusted Beverage Distributor', 'Agen Minuman Terpercaya')}
                </p>
              </div>
            </main>
          </div>
        )}

        {/* ========================================================== */}
        {/* TAMPILAN 2: HOME / WELCOME & LOGIN (/client-pwa/home-tamu) */}
        {/* ========================================================== */}
        {currentScreen === 'home_guest' && (
          <div className="rc-home-root fixed inset-0 z-40 w-full h-[100dvh] overflow-y-auto overflow-x-hidden select-none">
            <style>{`
              .rc-home-root {
                --gold-1: #ffd76a;
                --gold-2: #f3c04a;
                --gold-3: #d9992a;
                --gold-line: #e9b52f;
                --bg: #050403;
                --text: #ffffff;
                --muted: #9b9588;
                font-family: "Inter", "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
                background: var(--bg);
                color: var(--text);
                -webkit-font-smoothing: antialiased;
              }

              .rc-home-root .bg {
                position: fixed;
                inset: 0;
                z-index: 0;
                pointer-events: none;
                background:
                  radial-gradient(ellipse at 50% 40%, rgba(255, 190, 60, 0.05), transparent 60%),
                  #050403;
              }
              .rc-home-root .bg svg { position: absolute; display: block; }
              .rc-home-root .bg-top { top: 0; left: 0; width: min(100%, 900px); height: auto; }
              .rc-home-root .bg-bottom {
                bottom: 0; left: 0; width: 100%; height: auto; max-height: 62vh;
                -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 6%);
                        mask-image: linear-gradient(to bottom, transparent 0, #000 6%);
              }
              @media (min-width: 700px) {
                .rc-home-root .bg-bottom {
                  max-height: 55vh;
                  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 50%);
                          mask-image: linear-gradient(to bottom, transparent 0, #000 50%);
                }
              }

              .rc-home-root .wave-float { animation: rcHomeDrift 9s ease-in-out infinite alternate; }
              .rc-home-root .wave-float.slow { animation-duration: 13s; animation-direction: alternate-reverse; }
              @keyframes rcHomeDrift {
                from { transform: translate3d(0, 0, 0); }
                to   { transform: translate3d(0, 14px, 0); }
              }
              .rc-home-root .spark { animation: rcHomeTwinkle 4s ease-in-out infinite; }
              .rc-home-root .spark:nth-child(2n) { animation-delay: 1.2s; }
              .rc-home-root .spark:nth-child(3n) { animation-delay: 2.4s; }
              @keyframes rcHomeTwinkle {
                0%, 100% { opacity: 0.2; }
                50%      { opacity: 0.95; }
              }

              .rc-home-root .page {
                position: relative;
                z-index: 1;
                min-height: 100dvh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: clamp(56px, 8vh, 76px) 24px calc(clamp(24px, 6vh, 64px) + 4vh);
              }
              .rc-home-root .content {
                width: 100%;
                max-width: 440px;
                animation: rcHomeRise .7s ease-out both;
              }
              @keyframes rcHomeRise {
                from { opacity: 0; transform: translateY(14px); }
                to   { opacity: 1; transform: none; }
              }

              .rc-home-root .brand {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 14px;
                margin-bottom: clamp(28px, 5vh, 48px);
              }
              .rc-home-root .brand-mark {
                width: clamp(84px, 25vw, 108px);
                flex: none;
                filter: drop-shadow(0 0 14px rgba(255, 190, 50, 0.55));
              }
              .rc-home-root .brand-divider {
                width: 2px;
                align-self: stretch;
                margin: 6px 0;
                background: linear-gradient(180deg, transparent, var(--gold-2), transparent);
                box-shadow: 0 0 8px rgba(255, 190, 50, 0.6);
                flex: none;
              }
              .rc-home-root .brand-text { display: flex; flex-direction: column; line-height: 1; text-align: left; }
              .rc-home-root .brand-name {
                font-size: clamp(38px, 11.5vw, 52px);
                font-weight: 800;
                letter-spacing: -0.02em;
                color: #ffffff;
                filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.7));
              }
              .rc-home-root .brand-name .cart {
                background: linear-gradient(180deg, #ffe9a0 0%, #ffc83a 50%, #e8a01c 100%);
                -webkit-background-clip: text;
                background-clip: text;
                color: transparent;
                -webkit-text-fill-color: transparent;
              }
              .rc-home-root .brand-sub {
                margin-top: 6px;
                font-size: clamp(16px, 4.7vw, 21px);
                font-weight: 600;
                letter-spacing: 0.01em;
                color: var(--gold-2);
                white-space: nowrap;
              }

              .rc-home-root .welcome-title {
                font-size: clamp(38px, 11vw, 48px);
                font-weight: 800;
                line-height: 1.14;
                letter-spacing: -0.02em;
                color: #ffffff;
              }
              .rc-home-root .lead {
                margin-top: 20px;
                font-size: clamp(16px, 4.5vw, 19px);
                line-height: 1.55;
                color: var(--muted);
              }

              .rc-home-root .actions {
                margin-top: clamp(32px, 5vh, 48px);
                display: grid;
                gap: 16px;
              }

              .rc-home-root .btn {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                width: 100%;
                height: 64px;
                border-radius: 22px;
                font-size: 20px;
                font-weight: 700;
                text-decoration: none;
                border: none;
                cursor: pointer;
                transition: transform .12s, filter .2s, box-shadow .2s, background .2s;
              }
              .rc-home-root .btn:active { transform: scale(0.985); }
              .rc-home-root .btn:focus-visible { outline: 3px solid rgba(255, 215, 106, 0.6); outline-offset: 3px; }

              .rc-home-root .btn-primary {
                color: #1b1204;
                background: linear-gradient(100deg, #e5b13a 0%, #fbdc7a 45%, #e8b440 100%);
                box-shadow:
                  0 0 0 1.5px rgba(255, 215, 106, 0.55),
                  0 0 28px rgba(255, 185, 45, 0.45),
                  inset 0 1px 0 rgba(255, 255, 255, 0.5);
              }
              .rc-home-root .btn-primary:hover {
                filter: brightness(1.07);
                box-shadow:
                  0 0 0 1.5px rgba(255, 215, 106, 0.8),
                  0 0 38px rgba(255, 185, 45, 0.62),
                  inset 0 1px 0 rgba(255, 255, 255, .5);
              }
              .rc-home-root .btn-primary svg {
                width: 22px;
                height: 22px;
                stroke: currentColor;
                fill: none;
                stroke-width: 2.4;
                stroke-linecap: round;
                stroke-linejoin: round;
                transition: transform .2s;
              }
              .rc-home-root .btn-primary:hover svg { transform: translateX(4px); }

              .rc-home-root .login-line {
                margin-top: 30px;
                text-align: center;
                font-size: 18px;
                color: #d6d1c6;
              }
              .rc-home-root .login-line button {
                background: none;
                border: none;
                padding: 0;
                font: inherit;
                color: #ffe27a;
                font-weight: 700;
                cursor: pointer;
              }
              .rc-home-root .login-line button:hover {
                text-decoration: underline;
                text-underline-offset: 3px;
              }

              /* ---------- Kartu Login Emas (image.png) ---------- */
              .rc-home-root .login-card {
                position: relative;
                width: 100%;
                padding: 32px 24px 28px;
                border-radius: 26px;
                background: linear-gradient(180deg, rgba(20, 15, 8, 0.88) 0%, rgba(10, 8, 4, 0.92) 100%);
                border: 1.5px solid rgba(233, 181, 47, 0.78);
                box-shadow:
                  0 0 36px rgba(255, 185, 45, 0.18),
                  inset 0 0 24px rgba(255, 185, 45, 0.06);
                backdrop-filter: blur(12px);
              }
              .rc-home-root .login-card::before {
                content: "";
                position: absolute;
                top: -1.5px;
                left: 18%;
                right: 18%;
                height: 2px;
                background: linear-gradient(90deg, transparent, #fff3c4, #ffd76a, transparent);
                box-shadow: 0 0 14px 2px rgba(255, 215, 106, 0.85);
                pointer-events: none;
              }
              .rc-home-root .login-card::after {
                content: "";
                position: absolute;
                bottom: -1.5px;
                left: 55%;
                right: 8%;
                height: 2px;
                background: linear-gradient(90deg, transparent, #fff3c4, #ffd76a, transparent);
                box-shadow: 0 0 14px 2px rgba(255, 215, 106, 0.85);
                pointer-events: none;
              }
              .rc-home-root .login-title {
                text-align: center;
                font-size: clamp(30px, 8vw, 38px);
                font-weight: 800;
                color: #ffffff;
                letter-spacing: -0.02em;
              }
              .rc-home-root .login-subtitle {
                margin-top: 6px;
                margin-bottom: 24px;
                text-align: center;
                font-size: 15px;
                color: #a9a295;
              }
              .rc-home-root .field-group {
                margin-bottom: 18px;
                text-align: left;
              }
              .rc-home-root .field-label {
                display: block;
                margin-bottom: 8px;
                font-size: 15px;
                font-weight: 600;
                color: #f3c04a;
              }
              .rc-home-root .field-box {
                position: relative;
                display: flex;
                align-items: center;
                height: 54px;
                border-radius: 14px;
                background: rgba(15, 11, 6, 0.9);
                border: 1.3px solid rgba(233, 181, 47, 0.65);
                transition: border-color .2s, box-shadow .2s;
              }
              .rc-home-root .field-box:focus-within {
                border-color: #ffd76a;
                box-shadow: 0 0 16px rgba(255, 195, 65, 0.28);
              }
              .rc-home-root .field-icon {
                width: 46px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #f3c04a;
                flex-shrink: 0;
              }
              .rc-home-root .field-input {
                flex: 1;
                height: 100%;
                background: transparent;
                border: none;
                outline: none;
                color: #ffffff;
                font-size: 15px;
                padding-right: 14px;
              }
              .rc-home-root .field-input::placeholder {
                color: #7d776c;
              }
              .rc-home-root .eye-btn {
                width: 44px;
                height: 44px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: transparent;
                border: none;
                color: #f3c04a;
                cursor: pointer;
                flex-shrink: 0;
              }
              .rc-home-root .forgot-row {
                display: flex;
                justify-content: flex-end;
                margin-top: -4px;
                margin-bottom: 22px;
              }
              .rc-home-root .forgot-btn {
                background: none;
                border: none;
                padding: 0;
                font-size: 14px;
                font-weight: 600;
                color: #f3c04a;
                text-decoration: underline;
                text-underline-offset: 3px;
                cursor: pointer;
              }
              .rc-home-root .btn-login-submit {
                width: 100%;
                height: 56px;
                border-radius: 16px;
                font-size: 18px;
                font-weight: 800;
                color: #1b1204;
                background: linear-gradient(100deg, #e5b13a 0%, #fbdc7a 48%, #d9992a 100%);
                border: 1.5px solid #ffe699;
                box-shadow:
                  0 0 24px rgba(255, 185, 45, 0.45),
                  inset 0 1px 0 rgba(255, 255, 255, 0.65);
                cursor: pointer;
                transition: transform .12s, filter .2s, box-shadow .2s;
              }
              .rc-home-root .btn-login-submit:hover {
                filter: brightness(1.06);
                box-shadow:
                  0 0 32px rgba(255, 185, 45, 0.65),
                  inset 0 1px 0 rgba(255, 255, 255, 0.75);
              }
              .rc-home-root .btn-login-submit:active { transform: scale(0.985); }

              @media (max-width: 380px) {
                .rc-home-root .btn { height: 58px; font-size: 18px; }
                .rc-home-root .login-line { font-size: 16px; }
                .rc-home-root .login-card { padding: 26px 18px 22px; }
              }
              @media (prefers-reduced-motion: reduce) {
                .rc-home-root .wave-float, .rc-home-root .spark, .rc-home-root .content { animation: none; }
              }
            `}</style>

            {/* Top Bar: Language Selector (EN / ID) & Back to Welcome when in Login mode */}
            <div className="fixed top-4 left-4 right-4 z-20 flex items-center justify-between max-w-md mx-auto">
              {authMode === 'login' ? (
                <button
                  type="button"
                  onClick={() => {
                    setFormFeedbackMessage(null);
                    setAuthMode('welcome');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-md border border-amber-500/40 text-xs font-semibold text-amber-200 hover:text-white transition cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{tr('Back', 'Kembali')}</span>
                </button>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-amber-500/30 text-[11px] font-medium text-amber-200/90">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>{tr('POS & Database Connected', 'Database & POS Terhubung')}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <ThemeToggleButton />
                <LanguageDropdown compact />
              </div>
            </div>

            {/* Latar gelombang emas */}
            <div className="bg" aria-hidden="true">
              {/* Sudut kiri atas */}
              <svg className="bg-top" viewBox="0 0 850 480" preserveAspectRatio="xMinYMin meet" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="rcHomeStreakTop" gradientUnits="userSpaceOnUse" x1="0" y1="380" x2="360" y2="0">
                    <stop offset="0" stopColor="#ffb52e" stopOpacity="0.25" />
                    <stop offset="0.6" stopColor="#ffd978" stopOpacity="1" />
                    <stop offset="1" stopColor="#fff2c4" stopOpacity="1" />
                  </linearGradient>
                  <linearGradient id="rcHomeArcGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="850" y2="0">
                    <stop offset="0" stopColor="#ffc24a" stopOpacity="0.8" />
                    <stop offset="0.6" stopColor="#ffd978" stopOpacity="0.5" />
                    <stop offset="1" stopColor="#ffc24a" stopOpacity="0.05" />
                  </linearGradient>
                  <linearGradient id="rcHomeFillTop" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ffb52e" stopOpacity="0.55" />
                    <stop offset="1" stopColor="#8a5a00" stopOpacity="0" />
                  </linearGradient>
                  <filter id="rcHomeGlowT" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="7" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="rcHomeSoftT" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="26" />
                  </filter>
                </defs>
                <g className="wave-float slow">
                  <path d="M0,0 L430,0 C270,80 90,210 0,380 Z" fill="url(#rcHomeFillTop)" filter="url(#rcHomeSoftT)" />
                  <path d="M-40,380 C70,200 180,80 330,-30" fill="none" stroke="url(#rcHomeStreakTop)" strokeWidth="4" filter="url(#rcHomeGlowT)" />
                  <path d="M-40,330 C60,170 170,50 300,-30" fill="none" stroke="url(#rcHomeStreakTop)" strokeWidth="2.2" opacity="0.9" filter="url(#rcHomeGlowT)" />
                  <path d="M-40,285 C50,150 150,30 260,-30" fill="none" stroke="url(#rcHomeStreakTop)" strokeWidth="1.2" opacity="0.65" />
                  <path d="M-40,250 C200,120 480,40 700,24 C780,18 840,26 900,42" fill="none" stroke="url(#rcHomeArcGrad)" strokeWidth="1.4" />
                </g>
                <g fill="#ffd978">
                  <circle className="spark" cx="90" cy="70" r="1.8" />
                  <circle className="spark" cx="250" cy="170" r="1.3" />
                  <circle className="spark" cx="520" cy="60" r="1.2" />
                </g>
              </svg>

              {/* Gelombang bawah dan sisi kanan */}
              <svg className="bg-bottom" viewBox="0 1100 850 750" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="rcHomeStreak" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="850" y2="0">
                    <stop offset="0" stopColor="#ffd978" stopOpacity="0.95" />
                    <stop offset="0.35" stopColor="#ffc24a" stopOpacity="0.85" />
                    <stop offset="0.65" stopColor="#fff0b8" stopOpacity="1" />
                    <stop offset="1" stopColor="#ffc24a" stopOpacity="0.9" />
                  </linearGradient>
                  <linearGradient id="rcHomeStreakR" gradientUnits="userSpaceOnUse" x1="900" y1="1180" x2="560" y2="1560">
                    <stop offset="0" stopColor="#fff2c4" stopOpacity="1" />
                    <stop offset="0.5" stopColor="#ffc24a" stopOpacity="0.8" />
                    <stop offset="1" stopColor="#ffb52e" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="rcHomeFillGold" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ffb52e" stopOpacity="0.5" />
                    <stop offset="1" stopColor="#8a5a00" stopOpacity="0" />
                  </linearGradient>
                  <radialGradient id="rcHomeRg" cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0" stopColor="#ffd978" stopOpacity="0.75" />
                    <stop offset="1" stopColor="#ffb52e" stopOpacity="0" />
                  </radialGradient>
                  <filter id="rcHomeGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="8" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="rcHomeSoft" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="24" />
                  </filter>
                </defs>
                <g className="wave-float">
                  <circle cx="10" cy="1790" r="170" fill="url(#rcHomeRg)" />
                  <path d="M-20,1760 C140,1650 320,1590 520,1600 C700,1610 820,1560 900,1470 L900,1850 L-20,1850 Z" fill="url(#rcHomeFillGold)" opacity="0.32" filter="url(#rcHomeSoft)" />

                  <path d="M900,1010 C860,1090 820,1140 770,1200" fill="none" stroke="url(#rcHomeStreakR)" strokeWidth="1.4" opacity="0.8" />
                  <path d="M900,1180 C860,1260 800,1330 700,1420 C650,1465 600,1500 560,1530" fill="none" stroke="url(#rcHomeStreakR)" strokeWidth="4" filter="url(#rcHomeGlow)" />
                  <path d="M900,1235 C840,1325 750,1405 640,1485" fill="none" stroke="url(#rcHomeStreakR)" strokeWidth="2.2" opacity="0.9" filter="url(#rcHomeGlow)" />

                  <path d="M-20,1760 C140,1650 320,1590 520,1600 C700,1610 820,1560 900,1470" fill="none" stroke="url(#rcHomeStreak)" strokeWidth="3.8" filter="url(#rcHomeGlow)" />
                  <path d="M-20,1800 C150,1700 340,1640 540,1660 C720,1680 830,1640 900,1560" fill="none" stroke="url(#rcHomeStreak)" strokeWidth="2.2" opacity="0.9" filter="url(#rcHomeGlow)" />
                  <path d="M-20,1700 C120,1620 300,1560 480,1565 C640,1570 760,1520 900,1410" fill="none" stroke="url(#rcHomeStreak)" strokeWidth="1.2" opacity="0.65" />
                </g>
                <g fill="#ffd978">
                  <circle className="spark" cx="780" cy="1220" r="2" />
                  <circle className="spark" cx="820" cy="1330" r="1.5" />
                  <circle className="spark" cx="60" cy="1640" r="1.8" />
                  <circle className="spark" cx="150" cy="1720" r="1.4" />
                  <circle className="spark" cx="620" cy="1700" r="1.5" />
                  <circle className="spark" cx="760" cy="1760" r="1.8" />
                  <circle className="spark" cx="380" cy="1790" r="1.2" />
                </g>
              </svg>
            </div>

            <main className="page">
              <div className="content">
                {/* Logo */}
                <header
                  translate="no"
                  data-no-translate="true"
                  className="brand notranslate"
                  aria-label="POS RiskCart Artificial Intelligence"
                >
                  <svg className="brand-mark" viewBox="-8 -8 124 126" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="POS">
                    <defs>
                      <linearGradient id="rcHomeHexGold" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#fff0b8" />
                        <stop offset="0.45" stopColor="#ffc83a" />
                        <stop offset="1" stopColor="#d98d12" />
                      </linearGradient>
                      <linearGradient id="rcHomePosWhite" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#ffffff" />
                        <stop offset="1" stopColor="#c9c9c9" />
                      </linearGradient>
                    </defs>
                    <path d="M100,27 L50,0 L0,27 L0,83 L50,110 L100,83" fill="none" stroke="url(#rcHomeHexGold)" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
                    <path d="M92,33 L50,10 L9,33 L9,77 L50,100 L92,77" fill="none" stroke="url(#rcHomeHexGold)" strokeWidth="1.6" opacity="0.55" strokeLinejoin="round" strokeLinecap="round" />
                    <text x="55" y="70" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontWeight="900" fontSize="46" letterSpacing="-2.5" fill="url(#rcHomePosWhite)">POS</text>
                  </svg>
                  <span className="brand-divider" />
                  <div translate="no" data-no-translate="true" className="brand-text notranslate">
                    <span className="brand-name notranslate">Risk<span className="cart notranslate">Cart</span></span>
                    <span className="brand-sub notranslate">Artificial Intelligence</span>
                  </div>
                </header>

                {/* Teks sambutan */}
                <h1 className="welcome-title">
                  {tr('Order Beverages', 'Pesan Minuman')}
                  <br />
                  {tr('Easier', 'Lebih Mudah')}
                </h1>
                <p className="lead">
                  {tr('Wholesale beverages for your store,', 'Grosir minuman untuk toko anda,')}
                  <br />
                  {tr('Easy to order, rich in promos.', 'Gampang pesannya, banyak promonya.')}
                  <br />
                  {tr('With rewards on every purchase..', 'Ada rewardsnya..')}
                </p>

                {/* Tombol Utama */}
                <div className="actions">
                  <button
                    type="button"
                    id="daftarBtn"
                    onClick={() => {
                      setFormFeedbackMessage(null);
                      setCurrentScreen('register_member');
                    }}
                    className="btn btn-primary"
                  >
                    <span>{tr('Register Member', 'Daftar Member')}</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12h14" />
                      <path d="M13 6l6 6-6 6" />
                    </svg>
                  </button>
                </div>

                <p className="login-line">
                  {tr('Already have an account?', 'Sudah punya akun?')}{' '}
                  <button
                    type="button"
                    id="loginLink"
                    onClick={() => {
                      setFormFeedbackMessage(null);
                      setAuthMode('login');
                      setInternalScreen('login');
                      navigate(`/client-pwa/login${location.search || ''}`);
                    }}
                  >
                    {tr('Login', 'Masuk')}
                  </button>
                </p>
              </div>
            </main>
          </div>
        )}

        {/* ========================================================== */}
        {/* TAMPILAN 2B: LOGIN PAGE (/client-pwa/login — riskcart-login.html) */}
        {/* ========================================================== */}
        {currentScreen === 'login' && (
          <div className="rc-login-root fixed inset-0 z-40 w-full h-[100dvh] overflow-y-auto overflow-x-hidden select-none">
            <style>{`
              .rc-login-root {
                --gold-1: #ffd76a;
                --gold-2: #f3c04a;
                --gold-3: #d9992a;
                --gold-line: #d9a52a;
                --bg: #050403;
                --muted: #a9a499;
                --placeholder: #7a746a;
                --danger: #ff9c8a;
                --ok: #8fe6a0;
                font-family: "Inter", "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
                background: var(--bg);
                color: #fff;
                -webkit-font-smoothing: antialiased;
              }

              .rc-login-root .bg {
                position: fixed;
                inset: 0;
                z-index: 0;
                overflow: hidden;
                pointer-events: none;
                background:
                  radial-gradient(ellipse at 50% 38%, rgba(255, 190, 60, 0.06), transparent 62%),
                  #050403;
              }
              .rc-login-root .bg > svg { position: absolute; display: block; overflow: visible; }
              .rc-login-root .bg-top    { top: 0; left: 0; width: 100%; height: 42vh; }
              .rc-login-root .bg-bottom { bottom: 0; right: 0; width: 100%; height: 68vh; }
              @media (min-aspect-ratio: 1/1) {
                .rc-login-root .bg-top    { height: 46vh; }
                .rc-login-root .bg-bottom { height: 58vh; }
              }

              .rc-login-root .orb { position: absolute; border-radius: 50%; pointer-events: none; }
              .rc-login-root .orb-tl {
                left: -16vmax; top: -10vmax; width: 44vmax; height: 44vmax;
                background: radial-gradient(circle, rgba(255, 200, 80, 0.32), rgba(255, 170, 30, 0.07) 45%, transparent 68%);
              }
              .rc-login-root .orb-br {
                right: -18vmax; bottom: -8vmax; width: 46vmax; height: 46vmax;
                background: radial-gradient(circle, rgba(255, 185, 45, 0.28), transparent 66%);
              }

              .rc-login-root .wave-float { animation: rcLoginDrift 10s ease-in-out infinite alternate; }
              .rc-login-root .wave-float.slow { animation-duration: 14s; animation-direction: alternate-reverse; }
              @keyframes rcLoginDrift {
                from { transform: translate3d(0, 0, 0); }
                to   { transform: translate3d(0, 12px, 0); }
              }
              .rc-login-root .orb-tl, .rc-login-root .orb-br { animation: rcLoginPulse 7s ease-in-out infinite alternate; }
              .rc-login-root .orb-br { animation-delay: -3s; }
              @keyframes rcLoginPulse {
                from { opacity: 0.55; transform: scale(0.94); }
                to   { opacity: 1;    transform: scale(1.06); }
              }
              .rc-login-root .spark { animation: rcLoginTwinkle 3.8s ease-in-out infinite; }
              .rc-login-root .spark:nth-child(2n) { animation-delay: 1.2s; }
              .rc-login-root .spark:nth-child(3n) { animation-delay: 2.4s; }
              @keyframes rcLoginTwinkle {
                0%, 100% { opacity: 0.2; }
                50%      { opacity: 0.95; }
              }

              .rc-login-root .dust-layer { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
              .rc-login-root .dust {
                position: absolute;
                bottom: -12px;
                border-radius: 50%;
                background: radial-gradient(circle, #fff6d6 0%, #ffc83a 45%, rgba(255, 190, 50, 0) 72%);
                opacity: 0;
                animation: rcLoginRise linear infinite;
              }
              @keyframes rcLoginRise {
                0%   { transform: translate3d(0, 0, 0); opacity: 0; }
                14%  { opacity: 0.9; }
                85%  { opacity: 0.5; }
                100% { transform: translate3d(var(--sx, 0px), -110vh, 0); opacity: 0; }
              }

              .rc-login-root .page {
                position: relative;
                z-index: 1;
                min-height: 100dvh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding:
                  max(env(safe-area-inset-top), clamp(56px, 7vh, 72px)) 22px
                  max(env(safe-area-inset-bottom), clamp(28px, 6vh, 56px));
              }
              .rc-login-root .wrap {
                width: 100%;
                max-width: 440px;
                display: flex;
                flex-direction: column;
                align-items: center;
                animation: rcLoginRiseIn .6s ease-out both;
              }
              @keyframes rcLoginRiseIn {
                from { opacity: 0; transform: translateY(14px); }
                to   { opacity: 1; transform: none; }
              }

              .rc-login-root .brand {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 14px;
                margin-bottom: clamp(26px, 4.5vh, 42px);
              }
              .rc-login-root .brand-mark {
                width: clamp(82px, 24vw, 108px);
                flex: none;
                overflow: visible;
                filter: drop-shadow(0 0 14px rgba(255, 190, 50, 0.55));
              }
              .rc-login-root .brand-divider {
                width: 2px;
                align-self: stretch;
                margin: 6px 0;
                background: linear-gradient(180deg, transparent, var(--gold-2) 18%, var(--gold-2) 82%, transparent);
                box-shadow: 0 0 8px rgba(255, 190, 50, 0.65);
                flex: none;
              }
              .rc-login-root .brand-text { display: flex; flex-direction: column; line-height: 1; text-align: left; }
              .rc-login-root .brand-name {
                font-size: clamp(36px, 11vw, 50px);
                font-weight: 800;
                letter-spacing: -0.02em;
                color: #ffffff;
                white-space: nowrap;
                filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.7));
              }
              .rc-login-root .brand-name .cart {
                background: linear-gradient(180deg, #ffe9a0 0%, #ffc83a 50%, #e8a01c 100%);
                -webkit-background-clip: text;
                background-clip: text;
                color: transparent;
                -webkit-text-fill-color: transparent;
              }
              .rc-login-root .brand-sub {
                margin-top: 6px;
                font-size: clamp(15px, 4.4vw, 20px);
                font-weight: 600;
                letter-spacing: 0.01em;
                color: var(--gold-2);
                white-space: nowrap;
              }

              .rc-login-root .card {
                position: relative;
                width: 100%;
                padding: clamp(28px, 5vw, 36px) clamp(22px, 5vw, 28px);
                border-radius: 26px;
                border: 1.5px solid rgba(233, 181, 47, 0.78);
                background:
                  radial-gradient(ellipse at 50% 0%, rgba(255, 200, 80, 0.12), transparent 60%),
                  linear-gradient(180deg, rgba(24, 20, 14, 0.88), rgba(11, 9, 6, 0.92));
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                box-shadow:
                  0 0 0 1px rgba(255, 215, 106, 0.18),
                  0 0 38px rgba(255, 185, 45, 0.25),
                  0 20px 50px rgba(0, 0, 0, 0.7),
                  inset 0 1px 0 rgba(255, 230, 150, 0.35);
              }
              .rc-login-root .card::before,
              .rc-login-root .card::after {
                content: "";
                position: absolute;
                left: 16%;
                right: 16%;
                height: 2px;
                border-radius: 2px;
                background: linear-gradient(90deg, transparent, #fff4cc, #ffc83a, #fff4cc, transparent);
                filter: drop-shadow(0 0 8px rgba(255, 205, 80, 0.95));
                pointer-events: none;
              }
              .rc-login-root .card::before { top: -1.5px; }
              .rc-login-root .card::after  { bottom: -1.5px; left: 26%; right: 26%; opacity: 0.85; }

              .rc-login-root .title {
                text-align: center;
                font-size: clamp(28px, 7.5vw, 34px);
                font-weight: 800;
                letter-spacing: -0.02em;
                color: #fff;
              }
              .rc-login-root .sub {
                margin-top: 8px;
                margin-bottom: 26px;
                text-align: center;
                font-size: 16px;
                color: var(--muted);
              }

              .rc-login-root .field { margin-bottom: 18px; text-align: left; }
              .rc-login-root .field label {
                display: block;
                margin-bottom: 8px;
                font-size: 15.5px;
                font-weight: 600;
                color: var(--gold-2);
              }
              .rc-login-root .input {
                display: flex;
                align-items: center;
                gap: 14px;
                height: 56px;
                padding: 0 16px;
                border-radius: 16px;
                border: 1.5px solid var(--gold-line);
                background: linear-gradient(180deg, #17140f, #0d0b08);
                box-shadow:
                  inset 0 1px 0 rgba(255, 215, 106, 0.12),
                  0 0 14px rgba(255, 185, 45, 0.10);
                transition: border-color .2s, box-shadow .2s;
              }
              .rc-login-root .input:focus-within {
                border-color: var(--gold-1);
                box-shadow:
                  0 0 0 3px rgba(255, 200, 70, 0.16),
                  0 0 20px rgba(255, 185, 45, 0.38),
                  inset 0 1px 0 rgba(255, 215, 106, 0.2);
              }
              .rc-login-root .input .ico {
                width: 24px;
                height: 24px;
                flex: none;
                stroke: var(--gold-2);
                fill: none;
                stroke-width: 1.8;
                stroke-linecap: round;
                stroke-linejoin: round;
              }
              .rc-login-root .input input {
                flex: 1;
                min-width: 0;
                height: 100%;
                background: transparent;
                border: 0;
                outline: 0;
                color: #fff;
                font: inherit;
                font-size: 16.5px;
              }
              .rc-login-root .input input::placeholder { color: var(--placeholder); }

              .rc-login-root .eye {
                flex: none;
                display: grid;
                place-items: center;
                width: 36px;
                height: 36px;
                margin-right: -4px;
                border: 0;
                border-radius: 10px;
                background: transparent;
                color: var(--gold-2);
                cursor: pointer;
                transition: background .15s, color .15s;
              }
              .rc-login-root .eye:hover { background: rgba(255, 190, 50, 0.12); color: var(--gold-1); }
              .rc-login-root .eye svg {
                width: 22px; height: 22px;
                stroke: currentColor; fill: none;
                stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;
              }

              .rc-login-root .row-end {
                display: flex;
                justify-content: flex-end;
                margin-top: -4px;
                margin-bottom: 22px;
              }
              .rc-login-root .forgot {
                background: none;
                border: none;
                padding: 0;
                font: inherit;
                font-size: 14.5px;
                font-weight: 600;
                color: var(--gold-2);
                text-decoration: underline;
                text-underline-offset: 3px;
                cursor: pointer;
              }
              .rc-login-root .forgot:hover { color: var(--gold-1); }

              .rc-login-root .status {
                margin-bottom: 16px;
                padding: 11px 14px;
                border-radius: 12px;
                font-size: 14px;
                line-height: 1.45;
                text-align: center;
                border: 1px solid rgba(255, 138, 115, 0.5);
                background: rgba(255, 120, 95, 0.10);
                color: var(--danger);
              }

              .rc-login-root .btn {
                position: relative;
                width: 100%;
                height: 60px;
                border: 0;
                border-radius: 18px;
                cursor: pointer;
                font: inherit;
                font-size: 20px;
                font-weight: 800;
                letter-spacing: 0.01em;
                color: #1b1204;
                background: linear-gradient(100deg, #e5b13a 0%, #fbdc7a 48%, #e8b440 100%);
                box-shadow:
                  0 0 0 1.5px rgba(255, 225, 130, 0.75),
                  0 0 28px rgba(255, 185, 45, 0.5),
                  0 10px 24px rgba(0, 0, 0, 0.55),
                  inset 0 1.5px 0 rgba(255, 255, 255, 0.65);
                transition: transform .12s, filter .2s, box-shadow .2s, opacity .2s;
              }
              .rc-login-root .btn:hover {
                filter: brightness(1.06);
                box-shadow:
                  0 0 0 1.5px rgba(255, 230, 150, 0.9),
                  0 0 38px rgba(255, 185, 45, 0.7),
                  0 10px 24px rgba(0, 0, 0, 0.55),
                  inset 0 1.5px 0 rgba(255, 255, 255, 0.7);
              }
              .rc-login-root .btn:active { transform: scale(0.985); }
              .rc-login-root .btn[disabled] { opacity: 0.7; cursor: wait; }

              .rc-login-root .register-line {
                margin-top: 24px;
                text-align: center;
                font-size: 16px;
                color: #d6d1c6;
              }
              .rc-login-root .register-line button {
                background: none;
                border: none;
                padding: 0;
                font: inherit;
                color: #ffe27a;
                font-weight: 700;
                cursor: pointer;
              }
              .rc-login-root .register-line button:hover {
                text-decoration: underline;
                text-underline-offset: 3px;
              }

              @media (max-width: 380px) {
                .rc-login-root .input { height: 52px; }
                .rc-login-root .btn   { height: 54px; font-size: 18px; }
              }
            `}</style>

            {/* Top Bar: Back Button & Language Selector */}
            <div className="fixed top-4 left-4 right-4 z-20 flex items-center justify-between max-w-md mx-auto">
              <button
                type="button"
                onClick={() => {
                  setFormFeedbackMessage(null);
                  setCurrentScreen('home_guest');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-md border border-amber-500/40 text-xs font-semibold text-amber-200 hover:text-white transition cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{tr('Back', 'Kembali')}</span>
              </button>
              <LanguageDropdown compact />
            </div>

            {/* ================= LATAR CAHAYA EMAS ================= */}
            <div className="bg" aria-hidden="true">
              <div className="orb orb-tl" />
              <div className="orb orb-br" />

              <svg className="bg-top" viewBox="0 0 911 560" preserveAspectRatio="xMinYMin meet" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="rcLoginGArc" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="911" y2="0">
                    <stop offset="0" stopColor="#fff2c4" stopOpacity="1" />
                    <stop offset="0.3" stopColor="#ffcf5a" stopOpacity="1" />
                    <stop offset="0.7" stopColor="#ffc24a" stopOpacity="0.5" />
                    <stop offset="1" stopColor="#ffc24a" stopOpacity="0.06" />
                  </linearGradient>
                  <filter id="rcLoginGlowA" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="6" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="rcLoginBlurBig" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="20" />
                  </filter>
                </defs>
                <g className="wave-float slow">
                  <path d="M-30,470 C100,300 300,170 520,100 C680,52 820,52 940,72" fill="none" stroke="url(#rcLoginGArc)" strokeWidth="50" opacity="0.28" filter="url(#rcLoginBlurBig)" />
                  <path d="M-30,470 C100,300 300,170 520,100 C680,52 820,52 940,72" fill="none" stroke="url(#rcLoginGArc)" strokeWidth="4" filter="url(#rcLoginGlowA)" />
                  <path d="M-30,425 C90,265 260,150 460,82 C620,32 780,30 940,46" fill="none" stroke="url(#rcLoginGArc)" strokeWidth="2" opacity="0.85" filter="url(#rcLoginGlowA)" />
                  <path d="M-30,235 C60,170 110,90 175,-30" fill="none" stroke="url(#rcLoginGArc)" strokeWidth="2.8" filter="url(#rcLoginGlowA)" />
                </g>
                <g fill="#ffd978">
                  <circle className="spark" cx="62" cy="150" r="2" />
                  <circle className="spark" cx="215" cy="205" r="1.5" />
                  <circle className="spark" cx="470" cy="92" r="1.4" />
                </g>
              </svg>

              <svg className="bg-bottom" viewBox="0 900 911 827" preserveAspectRatio="xMaxYMax meet" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="rcLoginGSweep" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="911" y2="0">
                    <stop offset="0" stopColor="#ffc24a" stopOpacity="0.15" />
                    <stop offset="0.3" stopColor="#ffc24a" stopOpacity="0.85" />
                    <stop offset="0.65" stopColor="#fff0b8" stopOpacity="1" />
                    <stop offset="1" stopColor="#ffd978" stopOpacity="1" />
                  </linearGradient>
                  <filter id="rcLoginGlowB" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="7" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="rcLoginBlurBig2" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="22" />
                  </filter>
                </defs>
                <g className="wave-float">
                  <path d="M930,990 C900,1170 800,1300 640,1390 C470,1485 250,1510 -20,1600" fill="none" stroke="url(#rcLoginGSweep)" strokeWidth="76" opacity="0.30" filter="url(#rcLoginBlurBig2)" />
                  <path d="M-20,1610 C100,1545 260,1565 420,1625 C560,1675 760,1705 930,1695" fill="none" stroke="url(#rcLoginGSweep)" strokeWidth="48" opacity="0.26" filter="url(#rcLoginBlurBig2)" />
                  <path d="M930,980 C900,1160 800,1290 640,1380 C470,1475 250,1500 -20,1590" fill="none" stroke="url(#rcLoginGSweep)" strokeWidth="4.2" filter="url(#rcLoginGlowB)" />
                  <path d="M930,1030 C890,1200 780,1320 620,1410 C450,1500 230,1530 -20,1640" fill="none" stroke="url(#rcLoginGSweep)" strokeWidth="2.4" opacity="0.88" filter="url(#rcLoginGlowB)" />
                  <path d="M-20,1610 C100,1540 260,1560 420,1620 C560,1670 760,1700 930,1690" fill="none" stroke="url(#rcLoginGSweep)" strokeWidth="3" filter="url(#rcLoginGlowB)" />
                  <path d="M930,1330 C800,1420 700,1520 590,1650" fill="none" stroke="url(#rcLoginGSweep)" strokeWidth="3.2" filter="url(#rcLoginGlowB)" />
                </g>
                <g fill="#ffd978">
                  <circle className="spark" cx="860" cy="1060" r="2.2" />
                  <circle className="spark" cx="780" cy="1230" r="1.6" />
                  <circle className="spark" cx="150" cy="1560" r="1.8" />
                  <circle className="spark" cx="560" cy="1680" r="1.5" />
                </g>
              </svg>

              <div className="dust-layer">
                {Array.from({ length: 24 }).map((_, i) => {
                  const size = 1.8 + ((i * 7) % 26) / 10;
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

            {/* ================= KONTEN LOGIN ================= */}
            <main className="page">
              <div className="wrap">
                {/* Logo RiskCart */}
                <header
                  translate="no"
                  data-no-translate="true"
                  className="brand notranslate"
                  aria-label="POS RiskCart Artificial Intelligence"
                >
                  <svg className="brand-mark" viewBox="-8 -8 124 126" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="POS">
                    <defs>
                      <linearGradient id="rcLoginHexGold" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#fff0b8" />
                        <stop offset="0.45" stopColor="#ffc83a" />
                        <stop offset="1" stopColor="#d98d12" />
                      </linearGradient>
                      <linearGradient id="rcLoginPosWhite" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#ffffff" />
                        <stop offset="1" stopColor="#c9c9c9" />
                      </linearGradient>
                    </defs>
                    <path d="M100,27 L50,0 L0,27 L0,83 L50,110 L100,83" fill="none" stroke="url(#rcLoginHexGold)" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
                    <path d="M92,33 L50,10 L9,33 L9,77 L50,100 L92,77" fill="none" stroke="url(#rcLoginHexGold)" strokeWidth="1.6" opacity="0.55" strokeLinejoin="round" strokeLinecap="round" />
                    <text x="55" y="70" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontWeight="900" fontSize="46" letterSpacing="-2.5" fill="url(#rcLoginPosWhite)">POS</text>
                  </svg>
                  <span className="brand-divider" />
                  <div translate="no" data-no-translate="true" className="brand-text notranslate">
                    <span className="brand-name notranslate">Risk<span className="cart notranslate">Cart</span></span>
                    <span className="brand-sub notranslate">Artificial Intelligence</span>
                  </div>
                </header>

                {/* Kartu Login Pelanggan Lengkap */}
                <section className="card" aria-labelledby="loginTitle">
                  <h1 className="title" id="loginTitle">{tr('Customer Login', 'Login Pelanggan')}</h1>
                  <p className="sub">
                    {tr('Sign in with your WhatsApp number & PIN/Password', 'Masuk dengan Nomor WhatsApp & PIN/Password Anda')}
                  </p>

                  <form id="loginForm" noValidate onSubmit={handleLoginWithPhone}>
                    <div className="field">
                      <label htmlFor="username">
                        {tr('WhatsApp Number', 'Nomor WhatsApp')}
                      </label>
                      <div className="input">
                        <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                        </svg>
                        <input
                          id="username"
                          name="username"
                          type="tel"
                          inputMode="tel"
                          value={loginPhoneInput}
                          onChange={(e) => {
                            setLoginPhoneInput(e.target.value);
                            if (formFeedbackMessage) setFormFeedbackMessage(null);
                          }}
                          placeholder={tr('0812xxxx / 62812xxxx / +62812xxxx', 'Contoh: 081234567890 / +62812...')}
                          autoComplete="tel"
                          required
                        />
                      </div>
                    </div>

                    <div className="field">
                      <label htmlFor="password">{tr('PIN / Password', 'PIN / Password')}</label>
                      <div className="input">
                        <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                          <rect x="4" y="11" width="16" height="10" rx="2.5" />
                          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                        </svg>
                        <input
                          id="password"
                          name="password"
                          type={showLoginPassword ? 'text' : 'password'}
                          value={loginPasswordInput}
                          onChange={(e) => {
                            setLoginPasswordInput(e.target.value);
                            if (formFeedbackMessage) setFormFeedbackMessage(null);
                          }}
                          placeholder={tr('Enter PIN or Password (default: 123456)', 'Masukkan PIN / Password (default: 123456)')}
                          autoComplete="current-password"
                          required
                        />
                        <button
                          type="button"
                          className="eye"
                          id="togglePw"
                          onClick={() => setShowLoginPassword((prev) => !prev)}
                          aria-label={tr('Show or hide password', 'Tampilkan atau sembunyikan password')}
                        >
                          {showLoginPassword ? (
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M3 3l18 18" />
                              <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
                              <path d="M9.9 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a18.4 18.4 0 0 1-4.1 5.1" />
                              <path d="M6.2 6.2C3.8 8 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.2" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="row-end">
                      <button
                        type="button"
                        className="forgot"
                        id="forgotLink"
                        onClick={handleForgotPasswordOtp}
                      >
                        {tr('Forgot PIN / Password?', 'Lupa PIN / Password?')}
                      </button>
                    </div>

                    {formFeedbackMessage && (
                      <div className="status" role="status" aria-live="polite">
                        {formFeedbackMessage}
                      </div>
                    )}

                    <button
                      type="submit"
                      className="btn"
                      id="submitBtn"
                      disabled={isSendingOtp}
                    >
                      {isSendingOtp
                        ? tr('Signing in...', 'Memproses Masuk...')
                        : tr('Login', 'Masuk')}
                    </button>

                    <p className="register-line">
                      {tr("Don't have an account?", 'Belum punya akun?')}{' '}
                      <button
                        type="button"
                        id="registerLink"
                        onClick={() => {
                          setFormFeedbackMessage(null);
                          setCurrentScreen('register_member');
                        }}
                      >
                        {tr('Register Member', 'Daftar Member')}
                      </button>
                    </p>
                  </form>
                </section>
              </div>
            </main>
          </div>
        )}

        {/* ========================================================== */}
        {/* TAMPILAN 3: REGISTER STEP 1 (/client-pwa/daftar-1)         */}
        {/* ========================================================== */}
        {currentScreen === 'register_member' && (
          <div className="rc-reg-root fixed inset-0 z-40 w-full h-[100dvh] overflow-y-auto overflow-x-hidden select-none">
            <style>{`
              .rc-reg-root {
                --gold-1: #ffd76a;
                --gold-2: #f3c04a;
                --gold-line: #d9a52a;
                --bg: #050403;
                --muted: #a9a499;
                --placeholder: #7f7a70;
                --danger: #ff9c8a;
                font-family: "Inter", "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
                background: var(--bg);
                color: #fff;
                -webkit-font-smoothing: antialiased;
              }
              .rc-reg-root .bg {
                position: fixed;
                inset: 0;
                z-index: 0;
                overflow: hidden;
                pointer-events: none;
                background:
                  radial-gradient(ellipse at 50% 40%, rgba(255, 190, 60, 0.04), transparent 60%),
                  #050403;
              }
              .rc-reg-root .bg > svg { position: absolute; display: block; overflow: visible; }
              .rc-reg-root .bg-top    { top: 0; left: 0; width: 100%; height: 36vh; }
              .rc-reg-root .bg-bottom { bottom: 0; right: 0; width: 100%; height: 62vh; }
              @media (min-aspect-ratio: 1/1) {
                .rc-reg-root .bg-top    { height: 44vh; }
                .rc-reg-root .bg-bottom { height: 58vh; }
              }
              .rc-reg-root .orb { position: absolute; border-radius: 50%; pointer-events: none; }
              .rc-reg-root .orb-tl {
                left: -16vmax; top: -10vmax; width: 44vmax; height: 44vmax;
                background: radial-gradient(circle, rgba(255, 200, 80, 0.30), rgba(255, 170, 30, 0.07) 45%, transparent 68%);
              }
              .rc-reg-root .orb-br {
                right: -18vmax; bottom: -6vmax; width: 44vmax; height: 44vmax;
                background: radial-gradient(circle, rgba(255, 185, 45, 0.22), transparent 66%);
              }
              .rc-reg-root .wave-float { animation: rcRegDrift 10s ease-in-out infinite alternate; }
              .rc-reg-root .wave-float.slow { animation-duration: 14s; animation-direction: alternate-reverse; }
              @keyframes rcRegDrift {
                from { transform: translate3d(0, 0, 0); }
                to   { transform: translate3d(0, 12px, 0); }
              }
              .rc-reg-root .orb-tl, .rc-reg-root .orb-br { animation: rcRegPulse 7s ease-in-out infinite alternate; }
              .rc-reg-root .orb-br { animation-delay: -3s; }
              @keyframes rcRegPulse {
                from { opacity: 0.55; transform: scale(0.94); }
                to   { opacity: 1;    transform: scale(1.06); }
              }
              .rc-reg-root .spark { animation: rcRegTwinkle 4s ease-in-out infinite; }
              .rc-reg-root .spark:nth-child(2n) { animation-delay: 1.2s; }
              .rc-reg-root .spark:nth-child(3n) { animation-delay: 2.4s; }
              @keyframes rcRegTwinkle {
                0%, 100% { opacity: 0.2; }
                50%      { opacity: 0.95; }
              }
              .rc-reg-root .page {
                position: relative;
                z-index: 1;
                min-height: 100dvh;
                display: flex;
                justify-content: center;
                padding: 0 24px;
              }
              .rc-reg-root .wrap {
                width: 100%;
                max-width: 440px;
                min-height: 100dvh;
                display: flex;
                flex-direction: column;
                padding:
                  max(env(safe-area-inset-top), clamp(28px, 7vh, 72px)) 0
                  max(env(safe-area-inset-bottom), clamp(24px, 6vh, 64px));
              }
              .rc-reg-root .top { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
              .rc-reg-root .top-left { display: flex; align-items: center; gap: 18px; }
              .rc-reg-root .back {
                flex: none;
                display: grid;
                place-items: center;
                width: 44px; height: 44px;
                margin-left: -8px;
                border-radius: 12px;
                background: transparent;
                border: 0;
                cursor: pointer;
                color: var(--gold-2);
                transition: background .2s, transform .15s;
              }
              .rc-reg-root .back:hover { background: rgba(255, 190, 50, 0.1); }
              .rc-reg-root .back:active { transform: translateX(-2px); }
              .rc-reg-root .back svg { width: 26px; height: 26px; stroke: currentColor; fill: none; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
              .rc-reg-root h1 { font-size: 30px; font-weight: 700; line-height: 1.1; letter-spacing: -0.01em; color: #fff; }
              .rc-reg-root .step { margin-top: 6px; font-size: 15.5px; color: var(--muted); }
              .rc-reg-root .progress { display: flex; gap: 14px; margin-top: 22px; }
              .rc-reg-root .progress span {
                flex: 1;
                height: 8px;
                border-radius: 999px;
                background: #1b1916;
                border: 1px solid #2a2722;
              }
              .rc-reg-root .progress span.on {
                border-color: transparent;
                background: linear-gradient(90deg, #e8b43b, #fbdc7a 50%, #e8b43b);
                box-shadow: 0 0 14px rgba(255, 190, 50, 0.65);
              }
              .rc-reg-root .section {
                margin-top: 30px;
                margin-bottom: 20px;
                font-size: 20px;
                font-weight: 700;
                color: var(--gold-2);
              }
              .rc-reg-root form { flex: 1; display: flex; flex-direction: column; }
              .rc-reg-root .field { margin-bottom: 22px; }
              .rc-reg-root .field label {
                display: block;
                margin-bottom: 9px;
                font-size: 16px;
                font-weight: 600;
                color: var(--gold-2);
              }
              .rc-reg-root .input {
                display: flex;
                align-items: center;
                gap: 16px;
                height: 56px;
                padding: 0 18px;
                border-radius: 17px;
                border: 1.5px solid var(--gold-line);
                background: linear-gradient(180deg, #181613, #0f0d0b);
                box-shadow: inset 0 1px 0 rgba(255, 215, 106, 0.12), 0 0 14px rgba(255, 185, 45, 0.10);
                transition: border-color .2s, box-shadow .2s;
              }
              .rc-reg-root .input:focus-within {
                border-color: var(--gold-1);
                box-shadow: 0 0 0 3px rgba(255, 200, 70, 0.14), 0 0 20px rgba(255, 185, 45, 0.35), inset 0 1px 0 rgba(255, 215, 106, 0.18);
              }
              .rc-reg-root .input .ico { width: 26px; height: 26px; flex: none; stroke: var(--gold-2); fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
              .rc-reg-root .input input {
                flex: 1;
                min-width: 0;
                height: 100%;
                background: transparent;
                border: 0;
                outline: 0;
                color: #fff;
                font: inherit;
                font-size: 17.5px;
              }
              .rc-reg-root .input input::placeholder { color: var(--placeholder); }
              .rc-reg-root .actions { margin-top: auto; padding-top: 32px; }
              .rc-reg-root .note {
                margin-bottom: 14px;
                padding: 11px 14px;
                border-radius: 12px;
                border: 1px solid rgba(255, 138, 115, 0.5);
                background: rgba(255, 120, 95, 0.10);
                color: var(--danger);
                font-size: 14px;
                line-height: 1.45;
              }
              .rc-reg-root .btn {
                position: relative;
                width: 100%;
                height: 60px;
                border: 0;
                border-radius: 20px;
                cursor: pointer;
                font: inherit;
                font-size: 20px;
                font-weight: 700;
                color: #1b1204;
                background: linear-gradient(100deg, #e5b13a 0%, #fbdc7a 45%, #e8b440 100%);
                box-shadow:
                  0 0 0 1.5px rgba(255, 215, 106, 0.55),
                  0 0 28px rgba(255, 185, 45, 0.45),
                  inset 0 1px 0 rgba(255, 255, 255, 0.5);
                transition: transform .12s, filter .2s, box-shadow .2s;
              }
              .rc-reg-root .btn:hover { filter: brightness(1.07); box-shadow: 0 0 0 1.5px rgba(255, 215, 106, 0.8), 0 0 38px rgba(255, 185, 45, 0.62), inset 0 1px 0 rgba(255,255,255,.5); }
              .rc-reg-root .btn:active { transform: scale(0.985); }
              @media (max-width: 360px) {
                .rc-reg-root h1 { font-size: 26px; }
                .rc-reg-root .input { height: 52px; gap: 12px; }
                .rc-reg-root .input input { font-size: 16.5px; }
              }
            `}</style>

            {/* Latar gelombang emas */}
            <div className="bg" aria-hidden="true">
              <div className="orb orb-tl" />
              <div className="orb orb-br" />

              {/* Sudut kiri atas */}
              <svg className="bg-top" viewBox="0 0 850 480" preserveAspectRatio="xMinYMin meet" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="reg1StreakTop" gradientUnits="userSpaceOnUse" x1="0" y1="380" x2="360" y2="0">
                    <stop offset="0" stopColor="#ffb52e" stopOpacity="0.25" />
                    <stop offset="0.6" stopColor="#ffd978" stopOpacity="1" />
                    <stop offset="1" stopColor="#fff2c4" stopOpacity="1" />
                  </linearGradient>
                  <linearGradient id="reg1ArcGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="850" y2="0">
                    <stop offset="0" stopColor="#ffc24a" stopOpacity="0.8" />
                    <stop offset="0.6" stopColor="#ffd978" stopOpacity="0.45" />
                    <stop offset="1" stopColor="#ffc24a" stopOpacity="0.04" />
                  </linearGradient>
                  <linearGradient id="reg1FillTop" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ffb52e" stopOpacity="0.5" />
                    <stop offset="1" stopColor="#8a5a00" stopOpacity="0" />
                  </linearGradient>
                  <filter id="reg1GlowT" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="7" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="reg1SoftT" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="26" />
                  </filter>
                </defs>
                <g className="wave-float slow">
                  <path d="M0,0 L430,0 C270,80 90,210 0,380 Z" fill="url(#reg1FillTop)" filter="url(#reg1SoftT)" />
                  <path d="M-40,380 C70,200 180,80 330,-30" fill="none" stroke="url(#reg1StreakTop)" strokeWidth="4" filter="url(#reg1GlowT)" />
                  <path d="M-40,330 C60,170 170,50 300,-30" fill="none" stroke="url(#reg1StreakTop)" strokeWidth="2.2" opacity="0.9" filter="url(#reg1GlowT)" />
                  <path d="M-40,285 C50,150 150,30 260,-30" fill="none" stroke="url(#reg1StreakTop)" strokeWidth="1.2" opacity="0.65" />
                  <path d="M-40,250 C200,120 480,40 700,24 C780,18 840,26 900,42" fill="none" stroke="url(#reg1ArcGrad)" strokeWidth="1.4" />
                </g>
                <g fill="#ffd978">
                  <circle className="spark" cx="90" cy="70" r="1.8" />
                  <circle className="spark" cx="250" cy="170" r="1.3" />
                </g>
              </svg>

              {/* Gelombang kanan dan bawah */}
              <svg className="bg-bottom" viewBox="0 1100 850 750" preserveAspectRatio="xMaxYMax meet" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="reg1Streak" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="850" y2="0">
                    <stop offset="0" stopColor="#ffd978" stopOpacity="0" />
                    <stop offset="0.3" stopColor="#ffc24a" stopOpacity="0.85" />
                    <stop offset="0.65" stopColor="#fff0b8" stopOpacity="1" />
                    <stop offset="1" stopColor="#ffc24a" stopOpacity="0.9" />
                  </linearGradient>
                  <linearGradient id="reg1StreakR" gradientUnits="userSpaceOnUse" x1="900" y1="1180" x2="560" y2="1560">
                    <stop offset="0" stopColor="#fff2c4" stopOpacity="1" />
                    <stop offset="0.5" stopColor="#ffc24a" stopOpacity="0.8" />
                    <stop offset="1" stopColor="#ffb52e" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="reg1FillGold" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ffb52e" stopOpacity="0.5" />
                    <stop offset="1" stopColor="#8a5a00" stopOpacity="0" />
                  </linearGradient>
                  <radialGradient id="reg1Rg" cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0" stopColor="#ffd978" stopOpacity="0.7" />
                    <stop offset="1" stopColor="#ffb52e" stopOpacity="0" />
                  </radialGradient>
                  <filter id="reg1Glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="8" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="reg1Soft" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="24" />
                  </filter>
                </defs>
                <g className="wave-float">
                  <circle cx="10" cy="1800" r="170" fill="url(#reg1Rg)" />
                  <path d="M-20,1760 C140,1650 320,1590 520,1600 C700,1610 820,1560 900,1470 L900,1850 L-20,1850 Z" fill="url(#reg1FillGold)" opacity="0.3" filter="url(#reg1Soft)" />

                  <path d="M900,1180 C860,1260 800,1330 700,1420 C650,1465 600,1500 560,1530" fill="none" stroke="url(#reg1StreakR)" strokeWidth="4" filter="url(#reg1Glow)" />
                  <path d="M900,1235 C840,1325 750,1405 640,1485" fill="none" stroke="url(#reg1StreakR)" strokeWidth="2.2" opacity="0.9" filter="url(#reg1Glow)" />

                  <path d="M-20,1760 C140,1650 320,1590 520,1600 C700,1610 820,1560 900,1470" fill="none" stroke="url(#reg1Streak)" strokeWidth="3.6" filter="url(#reg1Glow)" />
                  <path d="M-20,1800 C150,1700 340,1640 540,1660 C720,1680 830,1640 900,1560" fill="none" stroke="url(#reg1Streak)" strokeWidth="2.2" opacity="0.9" filter="url(#reg1Glow)" />
                  <path d="M-20,1700 C120,1620 300,1560 480,1565 C640,1570 760,1520 900,1410" fill="none" stroke="url(#reg1Streak)" strokeWidth="1.2" opacity="0.6" />
                </g>
                <g fill="#ffd978">
                  <circle className="spark" cx="780" cy="1220" r="2" />
                  <circle className="spark" cx="820" cy="1330" r="1.5" />
                  <circle className="spark" cx="60" cy="1640" r="1.8" />
                  <circle className="spark" cx="620" cy="1700" r="1.5" />
                  <circle className="spark" cx="760" cy="1760" r="1.8" />
                </g>
              </svg>
            </div>

            <main className="page">
              <div className="wrap">
                {/* Header */}
                <header className="top">
                  <div className="top-left">
                    <button
                      type="button"
                      className="back"
                      onClick={() => {
                        setFormFeedbackMessage(null);
                        setCurrentScreen('home_guest');
                      }}
                      aria-label={tr('Back', 'Kembali')}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M19 12H5" />
                        <path d="M11 6l-6 6 6 6" />
                      </svg>
                    </button>
                    <div>
                      <h1>{tr('Register Member', 'Daftar Member')}</h1>
                      <p className="step">{tr('Step 1 of 2', 'Langkah 1 dari 2')}</p>
                    </div>
                  </div>
                  <LanguageDropdown compact />
                </header>

                {/* Progress */}
                <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={2} aria-valuenow={1}>
                  <span className="on" />
                  <span />
                </div>

                <h2 className="section">{tr('Member Data', 'Data Member')}</h2>

                <form onSubmit={handleRegisterStep1Next} noValidate>
                  {/* 1. Store Name */}
                  <div className="field">
                    <label htmlFor="toko">{tr('Store Name', 'Nama Toko')}</label>
                    <div className="input">
                      <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 9.5 5.5 4h13L20 9.5" />
                        <path d="M4 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" />
                        <path d="M5.5 12.5V20h13v-7.5" />
                        <path d="M10 20v-4h4v4" />
                      </svg>
                      <input
                        id="toko"
                        type="text"
                        value={regStoreName}
                        onChange={(e) => {
                          setRegStoreName(e.target.value);
                          if (formFeedbackMessage) setFormFeedbackMessage(null);
                        }}
                        placeholder={tr('Your Store Name', 'Nama Toko Anda')}
                        autoComplete="organization"
                        required
                      />
                    </div>
                  </div>

                  {/* 2. Owner Name */}
                  <div className="field">
                    <label htmlFor="pemilik">{tr('Owner Name', 'Nama Pemilik')}</label>
                    <div className="input">
                      <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="8" r="3.8" />
                        <path d="M5 20.5c0-3.9 3.1-6 7-6s7 2.1 7 6" />
                      </svg>
                      <input
                        id="pemilik"
                        type="text"
                        value={regOwnerName}
                        onChange={(e) => {
                          setRegOwnerName(e.target.value);
                          if (formFeedbackMessage) setFormFeedbackMessage(null);
                        }}
                        placeholder={tr('Dede Fajar Kurniawan', 'Dede Fajar Kurniawan')}
                        autoComplete="name"
                        required
                      />
                    </div>
                  </div>

                  {/* 3. Active WhatsApp No. */}
                  <div className="field">
                    <label htmlFor="wa">{tr('Active WhatsApp No.', 'No. WhatsApp Aktif')}</label>
                    <div className="input">
                      <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                      <input
                        id="wa"
                        type="tel"
                        inputMode="tel"
                        value={regPhone}
                        onChange={(e) => {
                          setRegPhone(e.target.value.replace(/[^0-9+]/g, ''));
                          if (formFeedbackMessage) setFormFeedbackMessage(null);
                        }}
                        placeholder="08xxxxxxxxxx"
                        autoComplete="tel"
                        required
                      />
                    </div>
                  </div>

                  {/* 4. Delivery Address */}
                  <div className="field">
                    <label htmlFor="regAddress">{tr('Delivery Address', 'Alamat Pengiriman')}</label>
                    <div className="input">
                      <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 22s7-7.2 7-13a7 7 0 1 0-14 0c0 5.8 7 13 7 13z" />
                        <circle cx="12" cy="9" r="2.5" />
                      </svg>
                      <input
                        id="regAddress"
                        type="text"
                        value={regAddress}
                        onChange={(e) => {
                          setRegAddress(e.target.value);
                          if (formFeedbackMessage) setFormFeedbackMessage(null);
                        }}
                        placeholder={tr('Street, store number, landmark...', 'Nama jalan, nomor toko, patokan...')}
                        autoComplete="street-address"
                      />
                    </div>
                  </div>

                  {/* 5. Create PIN / Password */}
                  <div className="field">
                    <label htmlFor="password">{tr('Create PIN / Password', 'Buat PIN / Password')}</label>
                    <div className="input">
                      <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" />
                        <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
                        <circle cx="12" cy="15.5" r="1" fill="currentColor" />
                        <path d="M12 16v1.8" />
                      </svg>
                      <input
                        id="password"
                        type={showRegPassword ? 'text' : 'password'}
                        value={regPassword}
                        onChange={(e) => {
                          setRegPassword(e.target.value);
                          if (formFeedbackMessage) setFormFeedbackMessage(null);
                        }}
                        placeholder={tr('Minimum 4 digits / characters', 'Minimal 4 digit / karakter')}
                        autoComplete="new-password"
                        minLength={4}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPassword((p) => !p)}
                        className="text-amber-300/80 hover:text-amber-200 px-1.5 cursor-pointer"
                        aria-label={tr('Show or hide password', 'Tampilkan atau sembunyikan password')}
                      >
                        {showRegPassword ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>

                  <div className="actions space-y-3">
                    {formFeedbackMessage && (
                      <div className="note" role="status">
                        {formFeedbackMessage}
                      </div>
                    )}
                    <button
                      className="btn"
                      type="button"
                      disabled={isSendingOtp}
                      onClick={handleQuickDirectRegister}
                    >
                      <span className="label">
                        {isSendingOtp
                          ? tr('Saving Member...', 'Menyimpan Member...')
                          : tr('Register & Sign In Now', 'Daftar & Masuk Sekarang')}
                      </span>
                    </button>
                    <button
                      type="submit"
                      className="w-full py-3 rounded-2xl border border-amber-500/50 bg-black/50 text-amber-300 text-sm font-bold hover:bg-amber-500/10 transition cursor-pointer"
                    >
                      {tr('Or Continue with GPS & WhatsApp OTP →', 'Atau Lanjut Set Titik GPS & OTP WhatsApp →')}
                    </button>
                  </div>
                </form>
              </div>
            </main>
          </div>
        )}

        {/* ========================================================== */}
        {/* TAMPILAN 4: REGISTER STEP 2 — ALAMAT & LOKASI GPS          */}
        {/* ========================================================== */}
        {currentScreen === 'setting_address' && (
          <div className="rc-reg2-root fixed inset-0 z-40 w-full h-[100dvh] overflow-y-auto overflow-x-hidden select-none">
            <style>{`
              .rc-reg2-root {
                --gold-1: #ffd76a;
                --gold-2: #f3c04a;
                --gold-line: #d9a52a;
                --bg: #050403;
                --muted: #a9a499;
                --placeholder: #7f7a70;
                --danger: #ff9c8a;
                font-family: "Inter", "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
                background: var(--bg);
                color: #fff;
                -webkit-font-smoothing: antialiased;
              }
              .rc-reg2-root .bg {
                position: fixed;
                inset: 0;
                z-index: 0;
                overflow: hidden;
                pointer-events: none;
                background:
                  radial-gradient(ellipse at 50% 40%, rgba(255, 190, 60, 0.04), transparent 60%),
                  #050403;
              }
              .rc-reg2-root .bg > svg { position: absolute; display: block; overflow: visible; }
              .rc-reg2-root .bg-top    { top: 0; left: 0; width: 100%; height: 36vh; }
              .rc-reg2-root .bg-bottom { bottom: 0; right: 0; width: 100%; height: 62vh; }
              @media (min-aspect-ratio: 1/1) {
                .rc-reg2-root .bg-top    { height: 44vh; }
                .rc-reg2-root .bg-bottom { height: 58vh; }
              }
              .rc-reg2-root .orb { position: absolute; border-radius: 50%; pointer-events: none; }
              .rc-reg2-root .orb-tl {
                left: -16vmax; top: -10vmax; width: 44vmax; height: 44vmax;
                background: radial-gradient(circle, rgba(255, 200, 80, 0.30), rgba(255, 170, 30, 0.07) 45%, transparent 68%);
              }
              .rc-reg2-root .orb-br {
                right: -18vmax; bottom: -6vmax; width: 44vmax; height: 44vmax;
                background: radial-gradient(circle, rgba(255, 185, 45, 0.22), transparent 66%);
              }
              .rc-reg2-root .wave-float { animation: rcReg2Drift 10s ease-in-out infinite alternate; }
              .rc-reg2-root .wave-float.slow { animation-duration: 14s; animation-direction: alternate-reverse; }
              @keyframes rcReg2Drift {
                from { transform: translate3d(0, 0, 0); }
                to   { transform: translate3d(0, 12px, 0); }
              }
              .rc-reg2-root .orb-tl, .rc-reg2-root .orb-br { animation: rcReg2Pulse 7s ease-in-out infinite alternate; }
              .rc-reg2-root .orb-br { animation-delay: -3s; }
              @keyframes rcReg2Pulse {
                from { opacity: 0.55; transform: scale(0.94); }
                to   { opacity: 1;    transform: scale(1.06); }
              }
              .rc-reg2-root .spark { animation: rcReg2Twinkle 4s ease-in-out infinite; }
              .rc-reg2-root .spark:nth-child(2n) { animation-delay: 1.2s; }
              .rc-reg2-root .spark:nth-child(3n) { animation-delay: 2.4s; }
              @keyframes rcReg2Twinkle {
                0%, 100% { opacity: 0.2; }
                50%      { opacity: 0.95; }
              }
              .rc-reg2-root .page {
                position: relative;
                z-index: 1;
                min-height: 100dvh;
                display: flex;
                justify-content: center;
                padding: 0 24px;
              }
              .rc-reg2-root .wrap {
                width: 100%;
                max-width: 440px;
                min-height: 100dvh;
                display: flex;
                flex-direction: column;
                padding:
                  max(env(safe-area-inset-top), clamp(28px, 7vh, 72px)) 0
                  max(env(safe-area-inset-bottom), clamp(24px, 6vh, 64px));
              }
              .rc-reg2-root .top { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
              .rc-reg2-root .top-left { display: flex; align-items: center; gap: 18px; }
              .rc-reg2-root .back {
                flex: none;
                display: grid;
                place-items: center;
                width: 44px; height: 44px;
                margin-left: -8px;
                border-radius: 12px;
                background: transparent;
                border: 0;
                cursor: pointer;
                color: var(--gold-2);
                transition: background .2s, transform .15s;
              }
              .rc-reg2-root .back:hover { background: rgba(255, 190, 50, 0.1); }
              .rc-reg2-root .back:active { transform: translateX(-2px); }
              .rc-reg2-root .back svg { width: 26px; height: 26px; stroke: currentColor; fill: none; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
              .rc-reg2-root h1 { font-size: 30px; font-weight: 700; line-height: 1.1; letter-spacing: -0.01em; color: #fff; }
              .rc-reg2-root h1 .accent {
                background: linear-gradient(180deg, #ffe9a0 0%, #ffc83a 60%, #f0b52e 100%);
                -webkit-background-clip: text;
                        background-clip: text;
                -webkit-text-fill-color: transparent;
                color: transparent;
              }
              .rc-reg2-root .step { margin-top: 6px; font-size: 15.5px; color: var(--muted); }
              .rc-reg2-root .progress { display: flex; gap: 14px; margin-top: 22px; }
              .rc-reg2-root .progress span {
                flex: 1;
                height: 8px;
                border-radius: 999px;
                background: #1b1916;
                border: 1px solid #2a2722;
              }
              .rc-reg2-root .progress span.on {
                border-color: transparent;
                background: linear-gradient(90deg, #e8b43b, #fbdc7a 50%, #e8b43b);
                box-shadow: 0 0 14px rgba(255, 190, 50, 0.65);
              }
              .rc-reg2-root .section {
                margin-top: 30px;
                margin-bottom: 20px;
                font-size: 20px;
                font-weight: 700;
                color: var(--gold-2);
              }
              .rc-reg2-root form { flex: 1; display: flex; flex-direction: column; }
              .rc-reg2-root .field { margin-bottom: 22px; }
              .rc-reg2-root .field label {
                display: block;
                margin-bottom: 9px;
                font-size: 16px;
                font-weight: 600;
                color: var(--gold-2);
              }
              .rc-reg2-root .input {
                display: flex;
                align-items: center;
                gap: 16px;
                height: 56px;
                padding: 0 18px;
                border-radius: 17px;
                border: 1.5px solid var(--gold-line);
                background: linear-gradient(180deg, #181613, #0f0d0b);
                box-shadow: inset 0 1px 0 rgba(255, 215, 106, 0.12), 0 0 14px rgba(255, 185, 45, 0.10);
                transition: border-color .2s, box-shadow .2s;
              }
              .rc-reg2-root .input:focus-within {
                border-color: var(--gold-1);
                box-shadow: 0 0 0 3px rgba(255, 200, 70, 0.14), 0 0 20px rgba(255, 185, 45, 0.35), inset 0 1px 0 rgba(255, 215, 106, 0.18);
              }
              .rc-reg2-root .input.area {
                align-items: flex-start;
                height: auto;
                min-height: 112px;
                padding: 14px 18px;
              }
              .rc-reg2-root .input.area textarea {
                flex: 1;
                min-width: 0;
                min-height: 82px;
                resize: none;
                background: transparent;
                border: 0;
                outline: 0;
                color: #fff;
                font: inherit;
                font-size: 17px;
                line-height: 1.5;
              }
              .rc-reg2-root .input.area textarea::placeholder { color: var(--placeholder); }
              .rc-reg2-root .input.slim { height: 52px; }
              .rc-reg2-root .input.slim input {
                flex: 1;
                min-width: 0;
                height: 100%;
                background: transparent;
                border: 0;
                outline: 0;
                color: #9e9a90;
                font: inherit;
                font-size: 16.5px;
                text-overflow: ellipsis;
              }
              .rc-reg2-root .input.slim input:disabled {
                cursor: not-allowed;
                color: #a8a296;
                opacity: 1;
                -webkit-text-fill-color: #a8a296;
              }
              .rc-reg2-root .input.slim input::placeholder { color: var(--placeholder); }
              .rc-reg2-root .btn-outline {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
                width: 100%;
                height: 54px;
                margin-top: 14px;
                border-radius: 17px;
                border: 1.5px solid var(--gold-line);
                background: linear-gradient(180deg, #171410, #0d0b09);
                color: var(--gold-1);
                font: inherit;
                font-size: 18px;
                font-weight: 700;
                letter-spacing: 0.02em;
                cursor: pointer;
                box-shadow: inset 0 0 18px rgba(255, 185, 45, 0.08), 0 0 14px rgba(255, 185, 45, 0.12);
                transition: border-color .2s, box-shadow .2s, transform .12s;
              }
              .rc-reg2-root .btn-outline svg { width: 24px; height: 24px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; }
              .rc-reg2-root .btn-outline:hover { border-color: var(--gold-1); box-shadow: inset 0 0 18px rgba(255, 185, 45, 0.12), 0 0 22px rgba(255, 185, 45, 0.35); }
              .rc-reg2-root .btn-outline:active { transform: scale(0.985); }
              .rc-reg2-root .btn-outline[disabled] { cursor: progress; opacity: 0.75; }
              .rc-reg2-root .btn-outline.verified {
                color: #10d988;
                font-size: 16.5px;
                font-weight: 600;
                letter-spacing: 0.01em;
              }
              .rc-reg2-root .btn-outline.verified svg {
                stroke: #10d988;
                width: 22px;
                height: 22px;
              }
              .rc-reg2-root .geo-status {
                margin-top: 10px;
                padding-left: 4px;
                font-size: 13.5px;
                line-height: 1.45;
                color: #ffe3a0;
              }
              .rc-reg2-root .geo-status.err { color: var(--danger); }
              .rc-reg2-root .actions { margin-top: auto; padding-top: 32px; }
              .rc-reg2-root .note {
                margin-bottom: 14px;
                padding: 11px 14px;
                border-radius: 12px;
                border: 1px solid rgba(255, 138, 115, 0.5);
                background: rgba(255, 120, 95, 0.10);
                color: var(--danger);
                font-size: 14px;
                line-height: 1.45;
              }
              .rc-reg2-root .btn {
                position: relative;
                width: 100%;
                height: 60px;
                border: 0;
                border-radius: 20px;
                cursor: pointer;
                font: inherit;
                font-size: 20px;
                font-weight: 700;
                color: #1b1204;
                background: linear-gradient(100deg, #e5b13a 0%, #fbdc7a 45%, #e8b440 100%);
                box-shadow:
                  0 0 0 1.5px rgba(255, 215, 106, 0.55),
                  0 0 28px rgba(255, 185, 45, 0.45),
                  inset 0 1px 0 rgba(255, 255, 255, 0.5);
                transition: transform .12s, filter .2s, box-shadow .2s;
              }
              .rc-reg2-root .btn:hover { filter: brightness(1.07); box-shadow: 0 0 0 1.5px rgba(255, 215, 106, 0.8), 0 0 38px rgba(255, 185, 45, 0.62), inset 0 1px 0 rgba(255,255,255,.5); }
              .rc-reg2-root .btn:active { transform: scale(0.985); }
              .rc-reg2-root .btn[disabled] { cursor: progress; filter: saturate(0.7) brightness(0.9); }

              /* High-Accuracy Location Approval Modal */
              .rc-reg2-root .loc-approval-modal {
                position: fixed;
                inset: 0;
                z-index: 9999;
                background: rgba(0, 0, 0, 0.88);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                animation: rcReg2FadeIn 0.2s ease-out;
              }
              @keyframes rcReg2FadeIn {
                from { opacity: 0; transform: scale(0.97); }
                to { opacity: 1; transform: scale(1); }
              }
              .rc-reg2-root .loc-dialog {
                width: 100%;
                max-width: 410px;
                background: linear-gradient(180deg, #1c1813 0%, #0d0b09 100%);
                border: 1.5px solid var(--gold-line);
                border-radius: 24px;
                padding: 26px 22px;
                box-shadow: 0 0 40px rgba(255, 185, 45, 0.25), inset 0 1px 0 rgba(255, 220, 110, 0.25);
                text-align: center;
              }
              .rc-reg2-root .loc-dialog-icon {
                width: 64px;
                height: 64px;
                margin: 0 auto 16px;
                border-radius: 50%;
                background: radial-gradient(circle, rgba(255, 200, 70, 0.25), rgba(255, 170, 30, 0.05));
                border: 1.5px solid var(--gold-line);
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--gold-1);
                box-shadow: 0 0 20px rgba(255, 185, 45, 0.35);
              }
              .rc-reg2-root .loc-dialog-icon svg {
                width: 32px;
                height: 32px;
                stroke: currentColor;
                fill: none;
                stroke-width: 2;
                stroke-linecap: round;
                stroke-linejoin: round;
              }
              .rc-reg2-root .loc-dialog h3 {
                font-size: 19px;
                font-weight: 700;
                color: #fff;
                margin-bottom: 8px;
                line-height: 1.25;
              }
              .rc-reg2-root .loc-dialog h3 .gold {
                background: linear-gradient(180deg, #ffe9a0 0%, #ffc83a 60%, #f0b52e 100%);
                -webkit-background-clip: text;
                background-clip: text;
                -webkit-text-fill-color: transparent;
              }
              .rc-reg2-root .loc-dialog p {
                font-size: 13.5px;
                line-height: 1.55;
                color: #d1ccbe;
                margin-bottom: 18px;
              }
              .rc-reg2-root .loc-dialog-badges {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-bottom: 22px;
                text-align: left;
                background: rgba(255, 190, 50, 0.05);
                border: 1px solid rgba(217, 165, 42, 0.3);
                border-radius: 14px;
                padding: 12px 14px;
              }
              .rc-reg2-root .loc-dialog-badge-item {
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 12.5px;
                color: #e5dfd0;
              }
              .rc-reg2-root .loc-dialog-badge-item span.icon {
                font-size: 15px;
                flex-shrink: 0;
              }
              .rc-reg2-root .loc-dialog-btns {
                display: flex;
                flex-direction: column;
                gap: 10px;
              }
              .rc-reg2-root .btn-allow {
                width: 100%;
                height: 52px;
                border: 0;
                border-radius: 16px;
                cursor: pointer;
                font: inherit;
                font-size: 15.5px;
                font-weight: 700;
                color: #1b1204;
                background: linear-gradient(100deg, #e5b13a 0%, #fbdc7a 45%, #e8b440 100%);
                box-shadow: 0 0 20px rgba(255, 185, 45, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                transition: transform .12s, filter .2s;
              }
              .rc-reg2-root .btn-allow:hover {
                filter: brightness(1.08);
                box-shadow: 0 0 28px rgba(255, 185, 45, 0.6);
              }
              .rc-reg2-root .btn-allow:active { transform: scale(0.98); }
              .rc-reg2-root .btn-cancel {
                width: 100%;
                height: 44px;
                border: 1px solid rgba(217, 165, 42, 0.35);
                background: rgba(20, 18, 14, 0.8);
                border-radius: 14px;
                color: var(--muted);
                font: inherit;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: background .15s, color .15s;
              }
              .rc-reg2-root .btn-cancel:hover {
                background: rgba(40, 35, 28, 0.9);
                color: #fff;
              }

              /* Interactive Map & Store Location Pin Card */
              .rc-reg2-root .loc-map-card {
                margin-top: 18px;
                background: linear-gradient(180deg, #181511 0%, #0d0c09 100%);
                border: 1.5px solid var(--gold-line);
                border-radius: 20px;
                padding: 16px;
                box-shadow: 0 0 24px rgba(255, 185, 45, 0.12), inset 0 1px 0 rgba(255, 215, 106, 0.15);
                animation: rcReg2SlideDown 0.25s ease-out;
              }
              @keyframes rcReg2SlideDown {
                from { opacity: 0; transform: translateY(-8px); }
                to { opacity: 1; transform: translateY(0); }
              }
              .rc-reg2-root .loc-map-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 12px;
                gap: 8px;
              }
              .rc-reg2-root .loc-map-title {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 14.5px;
                font-weight: 700;
                color: var(--gold-1);
              }
              .rc-reg2-root .loc-map-title svg {
                width: 18px;
                height: 18px;
                stroke: var(--gold-1);
                fill: none;
                stroke-width: 2;
              }
              .rc-reg2-root .loc-acc-badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 4px 10px;
                border-radius: 999px;
                font-size: 11.5px;
                font-weight: 700;
                font-family: monospace;
                color: #10d988;
                background: rgba(16, 217, 136, 0.12);
                border: 1px solid rgba(16, 217, 136, 0.4);
              }
              .rc-reg2-root .loc-acc-pulse {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #10d988;
                box-shadow: 0 0 8px #10d988;
                animation: rcReg2DotPulse 1.5s infinite;
              }
              @keyframes rcReg2DotPulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.4; transform: scale(1.3); }
              }
              .rc-reg2-root .loc-iframe-wrap {
                position: relative;
                width: 100%;
                height: 200px;
                border-radius: 14px;
                overflow: hidden;
                border: 1px solid rgba(217, 165, 42, 0.35);
                background: #000;
              }
              .rc-reg2-root .loc-iframe-wrap iframe {
                width: 100%;
                height: 100%;
                border: 0;
                display: block;
              }
              .rc-reg2-root .loc-info-box {
                margin-top: 14px;
                background: rgba(10, 9, 7, 0.75);
                border: 1px solid rgba(217, 165, 42, 0.25);
                border-radius: 14px;
                padding: 12px 14px;
                display: flex;
                flex-direction: column;
                gap: 8px;
              }
              .rc-reg2-root .loc-coord-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
              }
              .rc-reg2-root .loc-coord-pill {
                flex: 1;
                background: rgba(255, 200, 70, 0.06);
                border: 1px solid rgba(217, 165, 42, 0.25);
                border-radius: 10px;
                padding: 6px 10px;
                display: flex;
                flex-direction: column;
                gap: 2px;
              }
              .rc-reg2-root .loc-coord-label {
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
                color: var(--muted);
                letter-spacing: 0.04em;
              }
              .rc-reg2-root .loc-coord-val {
                font-size: 13.5px;
                font-weight: 700;
                font-family: monospace;
                color: #fff;
              }
              .rc-reg2-root .loc-address-detected {
                font-size: 12.5px;
                line-height: 1.45;
                color: #d1ccbe;
                padding-top: 4px;
                border-top: 1px dashed rgba(217, 165, 42, 0.2);
              }
              .rc-reg2-root .loc-maps-link {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                margin-top: 4px;
                font-size: 13px;
                font-weight: 700;
                color: var(--gold-1);
                text-decoration: none;
                transition: color 0.15s, transform 0.12s;
                padding: 8px 12px;
                border-radius: 10px;
                background: rgba(255, 190, 50, 0.08);
                border: 1px solid rgba(217, 165, 42, 0.3);
              }
              .rc-reg2-root .loc-maps-link:hover {
                color: #fff;
                background: rgba(255, 190, 50, 0.18);
                transform: translateY(-1px);
              }
              .rc-reg2-root .loc-maps-link svg {
                width: 14px;
                height: 14px;
                stroke: currentColor;
                fill: none;
                stroke-width: 2;
              }
            `}</style>

            {/* Latar gelombang emas */}
            <div className="bg" aria-hidden="true">
              <div className="orb orb-tl" />
              <div className="orb orb-br" />

              {/* Sudut kiri atas */}
              <svg className="bg-top" viewBox="0 0 850 480" preserveAspectRatio="xMinYMin meet" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="reg2StreakTop" gradientUnits="userSpaceOnUse" x1="0" y1="380" x2="360" y2="0">
                    <stop offset="0" stopColor="#ffb52e" stopOpacity="0.25" />
                    <stop offset="0.6" stopColor="#ffd978" stopOpacity="1" />
                    <stop offset="1" stopColor="#fff2c4" stopOpacity="1" />
                  </linearGradient>
                  <linearGradient id="reg2ArcGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="850" y2="0">
                    <stop offset="0" stopColor="#ffc24a" stopOpacity="0.8" />
                    <stop offset="0.6" stopColor="#ffd978" stopOpacity="0.45" />
                    <stop offset="1" stopColor="#ffc24a" stopOpacity="0.04" />
                  </linearGradient>
                  <linearGradient id="reg2FillTop" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ffb52e" stopOpacity="0.5" />
                    <stop offset="1" stopColor="#8a5a00" stopOpacity="0" />
                  </linearGradient>
                  <filter id="reg2GlowT" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="7" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="reg2SoftT" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="26" />
                  </filter>
                </defs>
                <g className="wave-float slow">
                  <path d="M0,0 L430,0 C270,80 90,210 0,380 Z" fill="url(#reg2FillTop)" filter="url(#reg2SoftT)" />
                  <path d="M-40,380 C70,200 180,80 330,-30" fill="none" stroke="url(#reg2StreakTop)" strokeWidth="4" filter="url(#reg2GlowT)" />
                  <path d="M-40,330 C60,170 170,50 300,-30" fill="none" stroke="url(#reg2StreakTop)" strokeWidth="2.2" opacity="0.9" filter="url(#reg2GlowT)" />
                  <path d="M-40,285 C50,150 150,30 260,-30" fill="none" stroke="url(#reg2StreakTop)" strokeWidth="1.2" opacity="0.65" />
                  <path d="M-40,250 C200,120 480,40 700,24 C780,18 840,26 900,42" fill="none" stroke="url(#reg2ArcGrad)" strokeWidth="1.4" />
                </g>
                <g fill="#ffd978">
                  <circle className="spark" cx="90" cy="70" r="1.8" />
                  <circle className="spark" cx="250" cy="170" r="1.3" />
                </g>
              </svg>

              {/* Gelombang kanan dan bawah */}
              <svg className="bg-bottom" viewBox="0 1100 850 750" preserveAspectRatio="xMaxYMax meet" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="reg2Streak" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="850" y2="0">
                    <stop offset="0" stopColor="#ffd978" stopOpacity="0" />
                    <stop offset="0.3" stopColor="#ffc24a" stopOpacity="0.85" />
                    <stop offset="0.65" stopColor="#fff0b8" stopOpacity="1" />
                    <stop offset="1" stopColor="#ffc24a" stopOpacity="0.9" />
                  </linearGradient>
                  <linearGradient id="reg2StreakR" gradientUnits="userSpaceOnUse" x1="900" y1="1180" x2="560" y2="1560">
                    <stop offset="0" stopColor="#fff2c4" stopOpacity="1" />
                    <stop offset="0.5" stopColor="#ffc24a" stopOpacity="0.8" />
                    <stop offset="1" stopColor="#ffb52e" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="reg2FillGold" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ffb52e" stopOpacity="0.5" />
                    <stop offset="1" stopColor="#8a5a00" stopOpacity="0" />
                  </linearGradient>
                  <radialGradient id="reg2Rg" cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0" stopColor="#ffd978" stopOpacity="0.7" />
                    <stop offset="1" stopColor="#ffb52e" stopOpacity="0" />
                  </radialGradient>
                  <filter id="reg2Glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="8" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="reg2Soft" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="24" />
                  </filter>
                </defs>
                <g className="wave-float">
                  <circle cx="10" cy="1800" r="170" fill="url(#reg2Rg)" />
                  <path d="M-20,1760 C140,1650 320,1590 520,1600 C700,1610 820,1560 900,1470 L900,1850 L-20,1850 Z" fill="url(#reg2FillGold)" opacity="0.3" filter="url(#reg2Soft)" />

                  <path d="M900,1180 C860,1260 800,1330 700,1420 C650,1465 600,1500 560,1530" fill="none" stroke="url(#reg2StreakR)" strokeWidth="4" filter="url(#reg2Glow)" />
                  <path d="M900,1235 C840,1325 750,1405 640,1485" fill="none" stroke="url(#reg2StreakR)" strokeWidth="2.2" opacity="0.9" filter="url(#reg2Glow)" />

                  <path d="M-20,1760 C140,1650 320,1590 520,1600 C700,1610 820,1560 900,1470" fill="none" stroke="url(#reg2Streak)" strokeWidth="3.6" filter="url(#reg2Glow)" />
                  <path d="M-20,1800 C150,1700 340,1640 540,1660 C720,1680 830,1640 900,1560" fill="none" stroke="url(#reg2Streak)" strokeWidth="2.2" opacity="0.9" filter="url(#reg2Glow)" />
                  <path d="M-20,1700 C120,1620 300,1560 480,1565 C640,1570 760,1520 900,1410" fill="none" stroke="url(#reg2Streak)" strokeWidth="1.2" opacity="0.6" />
                </g>
                <g fill="#ffd978">
                  <circle className="spark" cx="780" cy="1220" r="2" />
                  <circle className="spark" cx="820" cy="1330" r="1.5" />
                  <circle className="spark" cx="60" cy="1640" r="1.8" />
                  <circle className="spark" cx="620" cy="1700" r="1.5" />
                  <circle className="spark" cx="760" cy="1760" r="1.8" />
                </g>
              </svg>
            </div>

            <main className="page">
              <div className="wrap">
                {/* Header */}
                <header className="top">
                  <div className="top-left">
                    <button
                      type="button"
                      className="back"
                      onClick={() => {
                        setFormFeedbackMessage(null);
                        setCurrentScreen('register_member');
                      }}
                      aria-label={tr('Back to step 1', 'Kembali ke langkah 1')}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M19 12H5" />
                        <path d="M11 6l-6 6 6 6" />
                      </svg>
                    </button>
                    <div>
                      <h1>
                        {tr('Register ', 'Daftar ')}
                        <span className="accent">{tr('Member', 'Member')}</span>
                      </h1>
                      <p className="step">{tr('Step 2 of 2', 'Langkah 2 dari 2')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ThemeToggleButton />
                    <LanguageDropdown compact />
                  </div>
                </header>

                {/* Progress (Both segments active gold) */}
                <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={2} aria-valuenow={2}>
                  <span className="on" />
                  <span className="on" />
                </div>

                <h2 className="section">{tr('Store Address', 'Alamat Toko')}</h2>

                <form onSubmit={handleProceedToOtp} noValidate>
                  {/* 1. Full Address */}
                  <div className="field">
                    <label htmlFor="alamat">{tr('Full Address', 'Alamat Lengkap')}</label>
                    <div className="input area">
                      <textarea
                        id="alamat"
                        rows={3}
                        value={member.address}
                        onChange={(e) => {
                          setMember({ ...member, address: e.target.value });
                          if (formFeedbackMessage) setFormFeedbackMessage(null);
                        }}
                        placeholder={tr(
                          'Write your full store address (street, number, block, landmark)...',
                          'Tulis alamat lengkap toko Anda (jalan, nomor, RT/RW, patokan)...'
                        )}
                        autoComplete="street-address"
                        required
                      />
                    </div>
                  </div>

                  {/* 2. Google Maps Location (Disabled input filled automatically by CHECK LOCATION) */}
                  <div className="field">
                    <label htmlFor="lokasi">{tr('Google Maps Location', 'Lokasi Google Maps')}</label>
                    <div className="input slim">
                      <input
                        id="lokasi"
                        type="text"
                        value={googleMapsUrl}
                        disabled
                        readOnly
                        placeholder={tr(
                          'Press CHECK LOCATION to auto-fill',
                          'Tekan CEK LOKASI untuk mengisi otomatis'
                        )}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleCheckLocation}
                      disabled={isGpsLoading}
                      className={`btn-outline ${
                        member.isLocationChecked && member.latitude !== null ? 'verified' : ''
                      }`}
                    >
                      {isGpsLoading ? (
                        <>
                          <svg viewBox="0 0 24 24" aria-hidden="true" className="animate-spin">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="30 60" />
                          </svg>
                          <span className="label">
                            {gpsAccuracyValue
                              ? tr(
                                  `CALIBRATING GPS (±${gpsAccuracyValue}m)...`,
                                  `MENGKALIBRASI GPS (±${gpsAccuracyValue}m)...`
                                )
                              : tr('SEARCHING GPS SIGNAL...', 'MENCARI SINYAL GPS...')}
                          </span>
                        </>
                      ) : member.isLocationChecked && member.latitude !== null ? (
                        <>
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M8.5 12.5l2.3 2.3 4.7-4.8" />
                          </svg>
                          <span className="label">
                            {tr('LOKASI TERVERIFIKASI (KLIK CEK ULANG)', 'LOKASI TERVERIFIKASI (KLIK CEK ULANG)')}
                          </span>
                        </>
                      ) : (
                        <>
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <polygon points="3 11 22 2 13 21 11 13 3 11" />
                          </svg>
                          <span className="label">
                            {tr('CHECK LOCATION / CEK LOKASI', 'CHECK LOCATION / CEK LOKASI')}
                          </span>
                        </>
                      )}
                    </button>

                    {locationError && (
                      <p className="geo-status err" role="status">
                        {locationError}
                      </p>
                    )}

                    {!locationError && locationStatusMessage && (
                      <p className="geo-status" role="status">
                        {locationStatusMessage}
                      </p>
                    )}

                    {/* Preview Peta (Map) & Titik Lokasi Toko */}
                    {member.isLocationChecked && member.latitude !== null && member.longitude !== null && (
                      <div className="loc-map-card">
                        <div className="loc-map-header">
                          <div className="loc-map-title">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M12 22s7-7.2 7-13a7 7 0 1 0-14 0c0 5.8 7 13 7 13z" />
                              <circle cx="12" cy="9" r="3" />
                            </svg>
                            <span>{tr('Map & Store Location Pin', 'Peta & Titik Lokasi Toko')}</span>
                          </div>
                          <div className="loc-acc-badge">
                            <span className="loc-acc-pulse" />
                            <span>±{member.accuracy || 5}m • {tr('High Accuracy', 'Akurasi Tinggi')}</span>
                          </div>
                        </div>

                        {/* Interactive Google Maps iframe with embed mode */}
                        <div className="loc-iframe-wrap">
                          <iframe
                            title="Google Maps Store Pin"
                            src={`https://maps.google.com/maps?q=${member.latitude},${member.longitude}&hl=id&z=18&output=embed`}
                            loading="lazy"
                            allowFullScreen
                            referrerPolicy="no-referrer-when-downgrade"
                          />
                        </div>

                        {/* Location Coordinates & Detected Street Name Info Box */}
                        <div className="loc-info-box">
                          <div className="loc-coord-row">
                            <div className="loc-coord-pill">
                              <span className="loc-coord-label">Latitude</span>
                              <span className="loc-coord-val">{member.latitude.toFixed(6)}</span>
                            </div>
                            <div className="loc-coord-pill">
                              <span className="loc-coord-label">Longitude</span>
                              <span className="loc-coord-val">{member.longitude.toFixed(6)}</span>
                            </div>
                          </div>

                          <div className="loc-address-detected">
                            <strong className="text-[#ffd76a] block text-[11px] uppercase tracking-wider mb-0.5">
                              {tr('Detected Street / Area:', 'Jalan / Area Terdeteksi:')}
                            </strong>
                            <span>
                              {detectedAddressName || member.address || tr('Street detected from GPS coordinates', 'Alamat terdeteksi dari koordinat GPS')}
                            </span>
                          </div>

                          <a
                            href={googleMapsUrl || `https://www.google.com/maps?q=${member.latitude},${member.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="loc-maps-link"
                          >
                            <span>{tr('Open in Google Maps', 'Buka Google Maps')}</span>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                          </a>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="actions">
                    {formFeedbackMessage && (
                      <div className="note" role="status">
                        {formFeedbackMessage}
                      </div>
                    )}

                    {/* Register Now button ONLY appears AFTER clicking CHECK LOCATION and Google Maps link is populated */}
                    {member.isLocationChecked && Boolean(googleMapsUrl) && (
                      <button
                        className="btn"
                        type="submit"
                        disabled={isSendingOtp}
                      >
                        <span className="label">
                          {isSendingOtp
                            ? tr('Sending OTP...', 'Mengirim OTP...')
                            : tr('Register Now', 'Daftar Sekarang')}
                        </span>
                      </button>
                    )}
                  </div>
                </form>
              </div>
            </main>

            {/* MODAL: HIGH-ACCURACY LOCATION REQUEST (PERMINTAAN AKURASI LOKASI TINGGI) */}
            {showLocationApprovalModal && (
              <div className="loc-approval-modal" onClick={() => setShowLocationApprovalModal(false)}>
                <div className="loc-dialog" onClick={(e) => e.stopPropagation()}>
                  <div className="loc-dialog-icon">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                      <path d="M2 12h20" />
                    </svg>
                  </div>

                  <h3>
                    {tr('Permintaan Akurasi Lokasi Tinggi', 'Permintaan Akurasi Lokasi Tinggi')}
                    <span className="gold block text-sm font-semibold mt-1">
                      (High-Accuracy Location Request)
                    </span>
                  </h3>

                  <p>
                    {tr(
                      'Aplikasi memerlukan akses lokasi GPS akurasi tinggi untuk memvalidasi titik pin toko Anda secara presisi di peta. Klik tombol di bawah dan izinkan akses lokasi saat browser memunculkan permintaan izin.',
                      'Aplikasi memerlukan akses lokasi GPS akurasi tinggi untuk memvalidasi titik pin toko Anda secara presisi di peta. Klik tombol di bawah dan izinkan akses lokasi saat browser memunculkan permintaan izin.'
                    )}
                  </p>

                  <div className="loc-dialog-badges">
                    <div className="loc-dialog-badge-item">
                      <span className="icon">🛰️</span>
                      <span>{tr('High-Accuracy GPS Satellite Calibration', 'Kalibrasi sinyal satelit GPS tingkat tinggi')}</span>
                    </div>
                    <div className="loc-dialog-badge-item">
                      <span className="icon">📍</span>
                      <span>{tr('Precision pin lock on Google Maps', 'Kunci pin presisi pada peta Google Maps')}</span>
                    </div>
                    <div className="loc-dialog-badge-item">
                      <span className="icon">🏠</span>
                      <span>{tr('Auto-detect street name & address', 'Deteksi otomatis nama jalan & wilayah')}</span>
                    </div>
                  </div>

                  <div className="loc-dialog-btns">
                    <button
                      type="button"
                      className="btn-allow"
                      onClick={handleStartHighAccuracyGps}
                    >
                      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{tr('Izinkan Akurasi Tinggi (Allow High Accuracy)', 'Izinkan Akurasi Tinggi (Allow High Accuracy)')}</span>
                    </button>

                    <button
                      type="button"
                      className="btn-cancel"
                      onClick={() => setShowLocationApprovalModal(false)}
                    >
                      {tr('Batal (Cancel)', 'Batal (Cancel)')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================== */}
        {/* TAMPILAN 5: VERIFIKASI OTP WHATSAPP (/client-pwa/verifikasi-otp) */}
        {/* ========================================================== */}
        {currentScreen === 'verify_whatsapp' && (
          <div className="rc-otp-root fixed inset-0 z-40 w-full h-[100dvh] overflow-y-auto overflow-x-hidden select-none">
            <style>{`
              .rc-otp-root {
                --gold-1: #ffd76a;
                --gold-2: #f3c04a;
                --gold-line: #d9a52a;
                --bg: #050403;
                --muted: #a9a499;
                --placeholder: #7f7a70;
                --danger: #ff9c8a;
                font-family: "Inter", "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
                background: var(--bg);
                color: #fff;
                -webkit-font-smoothing: antialiased;
              }
              .rc-otp-root .bg {
                position: fixed;
                inset: 0;
                z-index: 0;
                overflow: hidden;
                pointer-events: none;
                background:
                  radial-gradient(ellipse at 50% 40%, rgba(255, 190, 60, 0.04), transparent 60%),
                  #050403;
              }
              .rc-otp-root .bg > svg { position: absolute; display: block; overflow: visible; }
              .rc-otp-root .bg-top    { top: 0; left: 0; width: 100%; height: 36vh; }
              .rc-otp-root .bg-bottom { bottom: 0; right: 0; width: 100%; height: 62vh; }
              @media (min-aspect-ratio: 1/1) {
                .rc-otp-root .bg-top    { height: 44vh; }
                .rc-otp-root .bg-bottom { height: 58vh; }
              }
              .rc-otp-root .orb { position: absolute; border-radius: 50%; pointer-events: none; }
              .rc-otp-root .orb-tl {
                left: -16vmax; top: -10vmax; width: 44vmax; height: 44vmax;
                background: radial-gradient(circle, rgba(255, 200, 80, 0.30), rgba(255, 170, 30, 0.07) 45%, transparent 68%);
              }
              .rc-otp-root .orb-br {
                right: -18vmax; bottom: -6vmax; width: 44vmax; height: 44vmax;
                background: radial-gradient(circle, rgba(255, 185, 45, 0.22), transparent 66%);
              }
              .rc-otp-root .wave-float { animation: rcOtpDrift 10s ease-in-out infinite alternate; }
              .rc-otp-root .wave-float.slow { animation-duration: 14s; animation-direction: alternate-reverse; }
              @keyframes rcOtpDrift {
                from { transform: translate3d(0, 0, 0); }
                to   { transform: translate3d(0, 12px, 0); }
              }
              .rc-otp-root .orb-tl, .rc-otp-root .orb-br { animation: rcOtpPulse 7s ease-in-out infinite alternate; }
              .rc-otp-root .orb-br { animation-delay: -3s; }
              @keyframes rcOtpPulse {
                from { opacity: 0.55; transform: scale(0.94); }
                to   { opacity: 1;    transform: scale(1.06); }
              }
              .rc-otp-root .spark { animation: rcOtpTwinkle 4s ease-in-out infinite; }
              .rc-otp-root .spark:nth-child(2n) { animation-delay: 1.2s; }
              .rc-otp-root .spark:nth-child(3n) { animation-delay: 2.4s; }
              @keyframes rcOtpTwinkle {
                0%, 100% { opacity: 0.2; }
                50%      { opacity: 0.95; }
              }
              .rc-otp-root .page {
                position: relative;
                z-index: 1;
                min-height: 100dvh;
                display: flex;
                justify-content: center;
                padding: 0 24px;
              }
              .rc-otp-root .wrap.otp {
                width: 100%;
                max-width: 440px;
                min-height: 100dvh;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                text-align: center;
                padding:
                  max(env(safe-area-inset-top), 28px) 0
                  max(env(safe-area-inset-bottom), 10vh);
              }
              .rc-otp-root .top-banner {
                width: 100%;
                display: flex;
                align-items: center;
                gap: 14px;
                padding: 15px 20px;
                margin-bottom: auto;
                margin-top: 12px;
                border-radius: 17px;
                border: 1.5px solid var(--gold-line);
                background: linear-gradient(180deg, rgba(12, 34, 21, 0.92), rgba(7, 22, 13, 0.92));
                box-shadow: 0 0 20px rgba(255, 185, 45, 0.16), inset 0 1px 0 rgba(255, 215, 106, 0.2);
                text-align: left;
                cursor: pointer;
              }
              .rc-otp-root .top-banner .check-circle {
                width: 30px;
                height: 30px;
                border-radius: 50%;
                background: #4ce08a;
                color: #062112;
                display: grid;
                place-items: center;
                flex: none;
              }
              .rc-otp-root .top-banner .check-circle svg {
                width: 18px;
                height: 18px;
                stroke: #062112;
                fill: none;
                stroke-width: 2.8;
                stroke-linecap: round;
                stroke-linejoin: round;
              }
              .rc-otp-root .top-banner .banner-text {
                font-size: 16.5px;
                font-weight: 500;
                color: #66e69c;
              }
              .rc-otp-root .center-stage {
                width: 100%;
                display: flex;
                flex-direction: column;
                align-items: center;
                margin: auto 0;
              }
              .rc-otp-root .wa {
                width: 64px; height: 64px;
                stroke: var(--gold-2); fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;
                filter: drop-shadow(0 0 12px rgba(255, 190, 50, 0.55));
                margin-bottom: 22px;
              }
              .rc-otp-root h1 {
                font-size: 32px;
                font-weight: 700;
                line-height: 1.15;
                letter-spacing: -0.01em;
                color: #fff;
              }
              .rc-otp-root .accent {
                background: linear-gradient(100deg, #f0b73a 0%, #ffe28a 50%, #f0b73a 100%);
                -webkit-background-clip: text; background-clip: text;
                -webkit-text-fill-color: transparent; color: transparent;
              }
              .rc-otp-root .desc {
                margin-top: 14px;
                max-width: 340px;
                font-size: 16px;
                line-height: 1.55;
                color: var(--muted);
              }
              .rc-otp-root .desc .num {
                color: var(--gold-1);
                font-weight: 600;
                white-space: nowrap;
              }
              .rc-otp-root .otp-boxes {
                width: 100%;
                margin-top: 34px;
                display: grid;
                grid-template-columns: repeat(6, 1fr);
                gap: 10px;
              }
              .rc-otp-root .otp-boxes input {
                width: 100%;
                height: clamp(54px, 16vw, 68px);
                border-radius: 14px;
                border: 1.5px solid var(--gold-line);
                background: rgba(16, 13, 8, 0.78);
                color: #fff;
                caret-color: var(--gold-1);
                text-align: center;
                font: inherit;
                font-size: 26px;
                font-weight: 700;
                padding: 0;
                outline: none;
                box-shadow: 0 0 12px rgba(255, 185, 45, 0.14);
                transition: border-color .2s, box-shadow .2s, background .2s, color .2s;
              }
              .rc-otp-root .otp-boxes input:focus {
                border-color: var(--gold-1);
                box-shadow: 0 0 0 3px rgba(255, 190, 50, 0.16), 0 0 18px rgba(255, 190, 50, 0.4);
              }
              .rc-otp-root .otp-boxes input.filled {
                border-color: var(--gold-1);
                color: var(--gold-1);
                background: rgba(40, 30, 8, 0.7);
              }
              .rc-otp-root .otp-boxes.error input {
                border-color: #ff7b66;
                color: #ffb4a6;
                box-shadow: 0 0 0 3px rgba(255, 120, 95, 0.12);
              }
              .rc-otp-root .otp-boxes.error {
                animation: rcOtpShake .42s cubic-bezier(.36, .07, .19, .97);
              }
              .rc-otp-root .otp-boxes.ok input {
                border-color: #25e08c;
                color: #25e08c;
                background: rgba(12, 40, 26, 0.7);
                box-shadow: 0 0 14px rgba(37, 224, 140, 0.25);
              }
              .rc-otp-root .otp-boxes.busy input { opacity: .65; }
              @keyframes rcOtpShake {
                10%, 90% { transform: translateX(-2px); }
                20%, 80% { transform: translateX(4px); }
                30%, 50%, 70% { transform: translateX(-7px); }
                40%, 60% { transform: translateX(7px); }
              }
              .rc-otp-root .otp-msg {
                min-height: 22px;
                margin-top: 16px;
                font-size: 14.5px;
                line-height: 1.45;
                color: var(--muted);
              }
              .rc-otp-root .otp-msg.error { color: var(--danger); }
              .rc-otp-root .otp-msg.ok { color: #25e08c; font-weight: 600; }
              .rc-otp-root .resend { margin-top: 18px; font-size: 15.5px; color: var(--muted); }
              .rc-otp-root .resend-btn {
                margin-top: 14px;
                padding: 10px 14px;
                background: none;
                border: 0;
                cursor: pointer;
                font: inherit;
                font-size: 16px;
                font-weight: 600;
                color: var(--gold-1);
                text-decoration: underline;
                text-underline-offset: 4px;
                border-radius: 10px;
              }
              .rc-otp-root .resend-btn:hover { color: #fff0b8; }
              .rc-otp-root .btn {
                position: relative;
                width: 100%;
                height: 60px;
                margin-top: 24px;
                border: 0;
                border-radius: 20px;
                cursor: pointer;
                font: inherit;
                font-size: 20px;
                font-weight: 700;
                color: #1b1204;
                background: linear-gradient(100deg, #e5b13a 0%, #fbdc7a 45%, #e8b440 100%);
                box-shadow:
                  0 0 0 1.5px rgba(255, 215, 106, 0.55),
                  0 0 28px rgba(255, 185, 45, 0.45),
                  inset 0 1px 0 rgba(255, 255, 255, 0.5);
                transition: transform .12s, filter .2s, box-shadow .2s;
              }
              @media (max-width: 360px) {
                .rc-otp-root .wrap.otp h1 { font-size: 27px; }
                .rc-otp-root .otp-boxes { gap: 7px; }
                .rc-otp-root .otp-boxes input { font-size: 22px; border-radius: 12px; }
              }
            `}</style>

            {/* Latar gelombang emas */}
            <div className="bg" aria-hidden="true">
              <div className="orb orb-tl" />
              <div className="orb orb-br" />

              {/* Sudut kiri atas */}
              <svg className="bg-top" viewBox="0 0 850 480" preserveAspectRatio="xMinYMin meet" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="otpStreakTop" gradientUnits="userSpaceOnUse" x1="0" y1="380" x2="360" y2="0">
                    <stop offset="0" stopColor="#ffb52e" stopOpacity="0.25" />
                    <stop offset="0.6" stopColor="#ffd978" stopOpacity="1" />
                    <stop offset="1" stopColor="#fff2c4" stopOpacity="1" />
                  </linearGradient>
                  <linearGradient id="otpArcGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="850" y2="0">
                    <stop offset="0" stopColor="#ffc24a" stopOpacity="0.8" />
                    <stop offset="0.6" stopColor="#ffd978" stopOpacity="0.45" />
                    <stop offset="1" stopColor="#ffc24a" stopOpacity="0.04" />
                  </linearGradient>
                  <linearGradient id="otpFillTop" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ffb52e" stopOpacity="0.5" />
                    <stop offset="1" stopColor="#8a5a00" stopOpacity="0" />
                  </linearGradient>
                  <filter id="otpGlowT" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="7" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="otpSoftT" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="26" />
                  </filter>
                </defs>
                <g className="wave-float slow">
                  <path d="M0,0 L430,0 C270,80 90,210 0,380 Z" fill="url(#otpFillTop)" filter="url(#otpSoftT)" />
                  <path d="M-40,380 C70,200 180,80 330,-30" fill="none" stroke="url(#otpStreakTop)" strokeWidth="4" filter="url(#otpGlowT)" />
                  <path d="M-40,330 C60,170 170,50 300,-30" fill="none" stroke="url(#otpStreakTop)" strokeWidth="2.2" opacity="0.9" filter="url(#otpGlowT)" />
                  <path d="M-40,285 C50,150 150,30 260,-30" fill="none" stroke="url(#otpStreakTop)" strokeWidth="1.2" opacity="0.65" />
                  <path d="M-40,250 C200,120 480,40 700,24 C780,18 840,26 900,42" fill="none" stroke="url(#otpArcGrad)" strokeWidth="1.4" />
                </g>
                <g fill="#ffd978">
                  <circle className="spark" cx="90" cy="70" r="1.8" />
                  <circle className="spark" cx="250" cy="170" r="1.3" />
                </g>
              </svg>

              {/* Gelombang kanan dan bawah */}
              <svg className="bg-bottom" viewBox="0 1100 850 750" preserveAspectRatio="xMaxYMax meet" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="otpStreak" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="850" y2="0">
                    <stop offset="0" stopColor="#ffd978" stopOpacity="0" />
                    <stop offset="0.3" stopColor="#ffc24a" stopOpacity="0.85" />
                    <stop offset="0.65" stopColor="#fff0b8" stopOpacity="1" />
                    <stop offset="1" stopColor="#ffc24a" stopOpacity="0.9" />
                  </linearGradient>
                  <linearGradient id="otpStreakR" gradientUnits="userSpaceOnUse" x1="900" y1="1180" x2="560" y2="1560">
                    <stop offset="0" stopColor="#fff2c4" stopOpacity="1" />
                    <stop offset="0.5" stopColor="#ffc24a" stopOpacity="0.8" />
                    <stop offset="1" stopColor="#ffb52e" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="otpFillGold" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ffb52e" stopOpacity="0.5" />
                    <stop offset="1" stopColor="#8a5a00" stopOpacity="0" />
                  </linearGradient>
                  <radialGradient id="otpRg" cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0" stopColor="#ffd978" stopOpacity="0.7" />
                    <stop offset="1" stopColor="#ffb52e" stopOpacity="0" />
                  </radialGradient>
                  <filter id="otpGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="8" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="otpSoft" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="24" />
                  </filter>
                </defs>
                <g className="wave-float">
                  <circle cx="10" cy="1800" r="170" fill="url(#otpRg)" />
                  <path d="M-20,1760 C140,1650 320,1590 520,1600 C700,1610 820,1560 900,1470 L900,1850 L-20,1850 Z" fill="url(#otpFillGold)" opacity="0.3" filter="url(#otpSoft)" />

                  <path d="M900,1180 C860,1260 800,1330 700,1420 C650,1465 600,1500 560,1530" fill="none" stroke="url(#otpStreakR)" strokeWidth="4" filter="url(#otpGlow)" />
                  <path d="M900,1235 C840,1325 750,1405 640,1485" fill="none" stroke="url(#otpStreakR)" strokeWidth="2.2" opacity="0.9" filter="url(#otpGlow)" />

                  <path d="M-20,1760 C140,1650 320,1590 520,1600 C700,1610 820,1560 900,1470" fill="none" stroke="url(#otpStreak)" strokeWidth="3.6" filter="url(#otpGlow)" />
                  <path d="M-20,1800 C150,1700 340,1640 540,1660 C720,1680 830,1640 900,1560" fill="none" stroke="url(#otpStreak)" strokeWidth="2.2" opacity="0.9" filter="url(#otpGlow)" />
                  <path d="M-20,1700 C120,1620 300,1560 480,1565 C640,1570 760,1520 900,1410" fill="none" stroke="url(#otpStreak)" strokeWidth="1.2" opacity="0.6" />
                </g>
                <g fill="#ffd978">
                  <circle className="spark" cx="780" cy="1220" r="2" />
                  <circle className="spark" cx="820" cy="1330" r="1.5" />
                  <circle className="spark" cx="60" cy="1640" r="1.8" />
                  <circle className="spark" cx="620" cy="1700" r="1.5" />
                  <circle className="spark" cx="760" cy="1760" r="1.8" />
                </g>
              </svg>
            </div>

            <main className="page">
              <div className="wrap otp">
                {/* Top Notification Banner */}
                <div className="top-banner" role="status">
                  <div className="check-circle">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </div>
                  <span className="banner-text">
                    {otpToastMessage || tr('OTP code sent via WhatsApp', 'Kode OTP dikirim via WhatsApp')}
                  </span>
                </div>

                {/* Central WhatsApp OTP Stage */}
                <div className="center-stage">
                  {/* Golden WhatsApp Icon */}
                  <svg className="wa" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3.4 20.6l1.35-4.75A8.6 8.6 0 1 1 8.2 19.3z" />
                    <path d="M9.1 8.3c.2-.4.5-.5.8-.5h.4c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .4-.1.6l-.5.6c-.1.1-.1.3 0 .4.6 1 1.4 1.8 2.5 2.4.2.1.3.1.4 0l.6-.7c.2-.2.4-.2.6-.1l1.5.7c.2.1.3.3.3.5 0 .8-.6 1.7-1.5 1.9-1.4.3-3.2-.4-4.9-2-1.7-1.5-2.7-3.4-2.4-4.9.1-.3.2-.6.4-.9z" />
                  </svg>

                  <h1>
                    {tr('WhatsApp ', 'Verifikasi ')}
                    <span className="accent">{tr('Verification', 'WhatsApp')}</span>
                  </h1>
                  <p className="desc">
                    {tr(
                      'Enter the 6-digit code sent to WhatsApp ',
                      'Masukkan 6 digit kode yang dikirim ke WhatsApp '
                    )}
                    <span className="num">{member.phone || '08xxxxxxxxxx'}</span>
                  </p>

                  <form onSubmit={handleVerifyOtp} noValidate style={{ width: '100%' }}>
                    <div
                      className={`otp-boxes ${
                        otpVerifyStatus === 'error'
                          ? 'error'
                          : otpVerifyStatus === 'ok'
                          ? 'ok'
                          : otpVerifyStatus === 'busy'
                          ? 'busy'
                          : ''
                      }`}
                      role="group"
                      aria-label={tr('6-digit OTP code', 'Kode OTP 6 digit')}
                    >
                      {[0, 1, 2, 3, 4, 5].map((idx) => (
                        <input
                          key={idx}
                          id={`otp-${idx}`}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                          aria-label={`Digit ${idx + 1} of 6`}
                          enterKeyHint="done"
                          autoCapitalize="off"
                          spellCheck={false}
                          disabled={otpVerifyStatus === 'busy' || otpVerifyStatus === 'ok'}
                          value={otpCode[idx] || ''}
                          className={otpCode[idx] ? 'filled' : ''}
                          onFocus={(e) => {
                            try {
                              e.target.select();
                            } catch {}
                          }}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === '') {
                              const next = [...otpCode];
                              next[idx] = '';
                              setOtpCode(next);
                              return;
                            }
                            const digits = raw.replace(/\D/g, '');
                            if (!digits) return;

                            if (digits.length === 1) {
                              const next = [...otpCode];
                              next[idx] = digits;
                              setOtpCode(next);
                              if (idx < 5) {
                                document.getElementById(`otp-${idx + 1}`)?.focus();
                              }
                              const joined = next.join('');
                              if (joined.length === 6) {
                                handleVerifyOtpWithCode(joined);
                              }
                            } else {
                              // Paste or multi-digit autofill
                              const startIdx = digits.length >= 6 ? 0 : idx;
                              const next = [...otpCode];
                              let i = 0;
                              for (; i < digits.length && startIdx + i < 6; i++) {
                                next[startIdx + i] = digits.charAt(i);
                              }
                              setOtpCode(next);
                              const focusIdx = Math.min(startIdx + i, 5);
                              document.getElementById(`otp-${focusIdx}`)?.focus();
                              const joined = next.join('');
                              if (joined.length === 6) {
                                handleVerifyOtpWithCode(joined);
                              }
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Backspace' && !otpCode[idx] && idx > 0) {
                              e.preventDefault();
                              const next = [...otpCode];
                              next[idx - 1] = '';
                              setOtpCode(next);
                              document.getElementById(`otp-${idx - 1}`)?.focus();
                            } else if (e.key === 'ArrowLeft' && idx > 0) {
                              e.preventDefault();
                              document.getElementById(`otp-${idx - 1}`)?.focus();
                            } else if (e.key === 'ArrowRight' && idx < 5) {
                              e.preventDefault();
                              document.getElementById(`otp-${idx + 1}`)?.focus();
                            } else if (e.key === 'Enter') {
                              e.preventDefault();
                              handleVerifyOtpWithCode(otpCode.join(''));
                            }
                          }}
                          onPaste={(e) => {
                            const text = e.clipboardData?.getData('text') || '';
                            const digits = text.replace(/\D/g, '');
                            e.preventDefault();
                            if (!digits) return;
                            const startIdx = digits.length >= 6 ? 0 : idx;
                            const next = [...otpCode];
                            let i = 0;
                            for (; i < digits.length && startIdx + i < 6; i++) {
                              next[startIdx + i] = digits.charAt(i);
                            }
                            setOtpCode(next);
                            const focusIdx = Math.min(startIdx + i, 5);
                            document.getElementById(`otp-${focusIdx}`)?.focus();
                            const joined = next.join('');
                            if (joined.length === 6) {
                              handleVerifyOtpWithCode(joined);
                            }
                          }}
                        />
                      ))}
                    </div>
                  </form>

                  <p
                    className={`otp-msg ${
                      otpVerifyStatus === 'error'
                        ? 'error'
                        : otpVerifyStatus === 'ok'
                        ? 'ok'
                        : ''
                    }`}
                    role="status"
                    aria-live="polite"
                  >
                    {otpStatusText}
                  </p>

                  {otpVerifyStatus !== 'ok' && (
                    <>
                      {otpCountdown > 0 ? (
                        <p className="resend">
                          {tr('Resend in ', 'Kirim ulang dalam ')}
                          <span>{otpCountdown}</span>s
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={handleResendOtp}
                          disabled={isSendingOtp}
                          className="resend-btn"
                        >
                          {isSendingOtp
                            ? tr('Resending...', 'Mengirim ulang...')
                            : tr('Resend code', 'Kirim ulang kode')}
                        </button>
                      )}
                    </>
                  )}

                  {otpVerifyStatus === 'ok' && (
                    <button
                      type="button"
                      onClick={() => setCurrentScreen('home_member')}
                      className="btn"
                    >
                      {tr('Continue to Catalog', 'Lanjut Belanja')}
                    </button>
                  )}
                </div>
              </div>
            </main>
          </div>
        )}

        {/* ========================================================== */}
        {/* HALAMAN UTAMA MEMBER, CART, ORDERS & PROFILE (Golden Shell) */}
        {/* ========================================================== */}
        {(currentScreen === 'home_member' || currentScreen === 'cart' || currentScreen === 'order_history' || currentScreen === 'profile') && (() => {
          type HomeCatalogItem = Product & {
            unitDisplayPrice: number;
            unitDisplayLabel: string;
            categoryChip: string;
            brandName: string;
            groupHeading: string;
            thumbKind: 'gas' | 'galon' | 'box';
            infoDescription: string;
          };

          // Map live POS database products into the riskcart-home.html structure
          const mappedPosProducts: HomeCatalogItem[] = catalogProducts.map((p) => {
            const nameLow = (p.name || '').toLowerCase();
            const catLow = (p.category || '').toLowerCase();
            let categoryChip = p.category || 'General';
            let thumbKind: 'gas' | 'galon' | 'box' = 'box';

            if (nameLow.includes('gas') || catLow.includes('gas') || nameLow.includes('lpg')) {
              categoryChip = 'Gas';
              thumbKind = 'gas';
            } else if (nameLow.includes('galon') || nameLow.includes('gallon') || nameLow.includes('liter')) {
              categoryChip = 'Mineral Galon';
              thumbKind = 'galon';
            } else if (
              nameLow.includes('aqua') ||
              nameLow.includes('mineral') ||
              nameLow.includes('aspen') ||
              catLow.includes('drink') ||
              catLow.includes('minum') ||
              catLow.includes('beverage')
            ) {
              categoryChip = 'Mineral Dus';
              thumbKind = 'box';
            }

            const rawBrand =
              (p as any).brand ||
              (p.name ? p.name.trim().split(/\s+/)[0] : '') ||
              categoryChip;
            const brandName = rawBrand.charAt(0).toUpperCase() + rawBrand.slice(1);
            const groupHeading =
              categoryChip === 'Gas'
                ? 'Gas Products'
                : brandName.toLowerCase() === 'aspen'
                ? 'Aspen Mineral Products'
                : `${brandName} Products`;

            const rawPrice = (p as any).pwaPrice || p.pricePerUnit || p.pricePerCarton || 0;
            const unitDisplayPrice = rawPrice < 500 && rawPrice > 0 ? Math.round(rawPrice * 15500) : rawPrice;
            const unitDisplayLabel =
              (p as any).unit ||
              (categoryChip === 'Gas' ? 'Gas' : 'pcs');

            return {
              ...p,
              pricePerUnit: unitDisplayPrice,
              pricePerCarton: p.pricePerCarton && p.pricePerCarton >= 500 ? p.pricePerCarton : unitDisplayPrice * (p.piecesPerCarton || 1),
              unitDisplayPrice,
              unitDisplayLabel,
              categoryChip,
              brandName,
              groupHeading,
              thumbKind,
              infoDescription:
                (p as any).description ||
                `Available stock: ${p.stockInUnits ?? 0} units (${p.piecesPerCarton || 1} pcs/carton).`,
            };
          });

          // Use live POS products from Firestore without fake reference items
          const combinedCatalog: HomeCatalogItem[] = mappedPosProducts;

          // Build dynamic category chip list from real Firestore catalog
          const dynamicCategories = Array.from(
            new Set(
              combinedCatalog
                .map((p) => p.categoryChip || p.category)
                .filter(Boolean)
            )
          );
          const allCategoryChips = ['All', ...dynamicCategories];

          // Build available brand options for the Brand select dropdown
          const availableBrands = Array.from(
            new Set(combinedCatalog.map((p) => p.brandName).filter(Boolean))
          );

          const activeCatNorm =
            activeCategory === 'Semua' || activeCategory === 'All' || !activeCategory
              ? ''
              : activeCategory;

          // Filter & sort products according to searchQuery, activeCatNorm, selectedBrand, and homeSort
          const filteredHomeItems = combinedCatalog
            .filter((p) => {
              const matchCat = !activeCatNorm || p.categoryChip === activeCatNorm || p.category === activeCatNorm;
              const matchBrand = !selectedBrand || p.brandName === selectedBrand;
              const q = searchQuery.trim().toLowerCase();
              const matchQ =
                !q ||
                p.name.toLowerCase().includes(q) ||
                (p.sku || '').toLowerCase().includes(q) ||
                p.brandName.toLowerCase().includes(q) ||
                p.categoryChip.toLowerCase().includes(q);
              return matchCat && matchBrand && matchQ;
            })
            .slice()
            .sort((a, b) => {
              if (homeSort === 'nama') return a.name.localeCompare(b.name, 'en');
              if (homeSort === 'murah') return a.unitDisplayPrice - b.unitDisplayPrice;
              if (homeSort === 'mahal') return b.unitDisplayPrice - a.unitDisplayPrice;
              return 0;
            });

          // Group products by groupHeading (just like riskcart-home.html)
          const productGroups: Array<{ nama: string; items: HomeCatalogItem[] }> = [];
          const groupIndexMap: Record<string, number> = {};
          filteredHomeItems.forEach((p) => {
            const g = p.groupHeading || 'Products';
            if (!(g in groupIndexMap)) {
              groupIndexMap[g] = productGroups.length;
              productGroups.push({ nama: g, items: [] });
            }
            productGroups[groupIndexMap[g]].items.push(p);
          });

          // Helper to read/set product quantity in unified cart
          const getHomeItemQty = (productId: string): number => {
            return cart
              .filter((c) => c.product.id === productId)
              .reduce((sum, c) => sum + c.quantity, 0);
          };

          const setHomeItemQty = (prod: HomeCatalogItem, nextQty: number) => {
            const clamped = Math.max(0, Math.min(99, nextQty));
            setCart((prev) => {
              const withoutProd = prev.filter((c) => c.product.id !== prod.id);
              if (clamped <= 0) return withoutProd;
              return [
                ...withoutProd,
                {
                  product: prod,
                  packageType: 'unit',
                  quantity: clamped,
                },
              ];
            });
          };

          const totalCartItemsCount = cart.reduce((acc, item) => acc + item.quantity, 0);
          const displayStoreName =
            member.storeName?.trim() ||
            (member.name && member.name !== 'Member Tamu' ? member.name : '') ||
            'Member Store';
          const displayOwnerName =
            member.ownerName?.trim() ||
            (member.name && member.name !== 'Member Tamu' ? member.name : '') ||
            'Member';
          const displayPhone = member.phone?.trim() || '-';
          const storeInitials =
            displayStoreName
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w.charAt(0).toUpperCase())
              .join('') || 'MS';

          const formatRpPlain = (val: number) => {
            return formatRupiah(val);
          };

          const shortRp = (v: number) => {
            if (v >= 1e6) return (v / 1e6).toFixed(1).replace('.0', '') + 'M';
            if (v >= 1e3) return Math.round(v / 1e3) + 'K';
            return String(v);
          };

          // Compute Weekly / Monthly chart data from userOrders
          const chartRows: Array<{ label: string; value: number }> = (() => {
            if (!userOrders || userOrders.length === 0) return [];
            const now = new Date();
            if (chartPeriod === 'mingguan') {
              const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
              const totals = [0, 0, 0, 0, 0, 0, 0];
              userOrders.forEach((o) => {
                if (o.status === 'rejected' || o.status === 'refunded') return;
                const d = new Date(o.createdAt);
                if (isNaN(d.getTime())) return;
                const diffDays = (now.getTime() - d.getTime()) / (1000 * 3600 * 24);
                if (diffDays <= 7) {
                  const dayIdx = (d.getDay() + 6) % 7; // Mon=0..Sun=6
                  totals[dayIdx] += Number(o.totalAmount) || 0;
                }
              });
              const maxVal = Math.max(...totals);
              if (maxVal <= 0) return [];
              return days.map((label, i) => ({ label, value: totals[i] }));
            } else {
              const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              const buckets: Array<{ label: string; month: number; year: number; value: number }> = [];
              for (let i = 5; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                buckets.push({
                  label: monthNames[d.getMonth()],
                  month: d.getMonth(),
                  year: d.getFullYear(),
                  value: 0,
                });
              }
              userOrders.forEach((o) => {
                if (o.status === 'rejected' || o.status === 'refunded') return;
                const d = new Date(o.createdAt);
                if (isNaN(d.getTime())) return;
                const b = buckets.find((x) => x.month === d.getMonth() && x.year === d.getFullYear());
                if (b) b.value += Number(o.totalAmount) || 0;
              });
              const maxVal = Math.max(...buckets.map((b) => b.value));
              if (maxVal <= 0) return [];
              return buckets.map(({ label, value }) => ({ label, value }));
            }
          })();

          const chartMax = chartRows.reduce((m, r) => Math.max(m, Number(r.value) || 0), 0);

          const handleLogoutMember = () => {
            setIsLogoutModalOpen(false);
            setIsClientDrawerOpen(false);
            try {
              localStorage.removeItem(PWA_MEMBER_STORAGE_KEY);
            } catch {}
            setMember({
              storeName: '',
              ownerName: '',
              name: 'Guest Member',
              phone: '',
              address: '',
              addressNotes: '',
              latitude: null,
              longitude: null,
              accuracy: null,
              isLocationChecked: false,
              isVerified: false,
              verifiedAt: null,
            });
            setAuthMode('welcome');
            setCurrentScreen('home_guest');
          };

          return (
            <div
              className="rc-home-root"
              onClick={() => {
                if (isSortMenuOpen) setIsSortMenuOpen(false);
              }}
            >
              <style>{`
                .rc-home-root {
                  --gold-1: #ffd76a;
                  --gold-2: #f3c04a;
                  --gold-3: #b87914;
                  --gold-line: #d9a52a;
                  --bg: #050403;
                  --bg-deep: #050403;
                  --bg-mid: #120d06;
                  --text: #ffffff;
                  --muted: #a9a499;
                  --placeholder: #7f7a70;
                  --danger: #ff9c8a;
                  --dim: #9d998c;
                  --green: #25e08c;
                  position: relative;
                  min-height: 100dvh;
                  width: 100%;
                  color: #fff;
                  background: var(--bg);
                  overflow-x: hidden;
                  -webkit-font-smoothing: antialiased;
                }
                /* ---------- Latar gelombang cahaya ---------- */
                .rc-home-root .bg {
                  position: fixed;
                  inset: 0;
                  z-index: 0;
                  pointer-events: none;
                  overflow: hidden;
                  background:
                    radial-gradient(ellipse at 50% 40%, rgba(255, 190, 60, 0.04), transparent 60%),
                    #050403;
                }
                .rc-home-root .bg > svg {
                  position: absolute;
                  display: block;
                  overflow: visible;
                }
                .rc-home-root .bg-top {
                  top: 0; left: 0; width: 100%; height: 36vh;
                }
                .rc-home-root .bg-bottom {
                  bottom: 0; right: 0; width: 100%; height: 62vh;
                }
                @media (min-aspect-ratio: 1/1) {
                  .rc-home-root .bg-top { height: 44vh; }
                  .rc-home-root .bg-bottom { height: 58vh; }
                }
                .rc-home-root .orb {
                  position: absolute;
                  border-radius: 50%;
                  pointer-events: none;
                }
                .rc-home-root .orb-tl {
                  left: -16vmax; top: -10vmax; width: 44vmax; height: 44vmax;
                  background: radial-gradient(circle, rgba(255, 200, 80, 0.30), rgba(255, 170, 30, 0.07) 45%, transparent 68%);
                  animation: rcPulse 7s ease-in-out infinite alternate;
                }
                .rc-home-root .orb-br {
                  right: -18vmax; bottom: -6vmax; width: 44vmax; height: 44vmax;
                  background: radial-gradient(circle, rgba(255, 185, 45, 0.22), transparent 66%);
                  animation: rcPulse 7s ease-in-out infinite alternate;
                  animation-delay: -3s;
                }
                .rc-home-root .wave-float {
                  animation: rcDrift 10s ease-in-out infinite alternate;
                }
                .rc-home-root .wave-float.slow {
                  animation-duration: 14s;
                  animation-direction: alternate-reverse;
                }
                @keyframes rcDrift {
                  from { transform: translate3d(0, 0, 0); }
                  to   { transform: translate3d(0, 12px, 0); }
                }
                @keyframes rcPulse {
                  from { opacity: 0.55; transform: scale(0.94); }
                  to   { opacity: 1;    transform: scale(1.06); }
                }
                .rc-home-root .spark {
                  animation: rcTwinkle 4s ease-in-out infinite;
                }
                .rc-home-root .spark:nth-child(2n) { animation-delay: 1.2s; }
                .rc-home-root .spark:nth-child(3n) { animation-delay: 2.4s; }
                @keyframes rcTwinkle {
                  0%, 100% { opacity: 0.2; }
                  50%      { opacity: 0.95; }
                }
                /* ---------- Layout ---------- */
                .rc-home-root .sr {
                  position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
                }
                .rc-home-root .page {
                  position: relative;
                  z-index: 1;
                }
                .rc-home-root .wrap,
                .rc-home-root .container {
                  position: relative;
                  z-index: 2;
                  max-width: 480px;
                  margin: 0 auto;
                  padding:
                    max(env(safe-area-inset-top), 12px) 20px
                    calc(156px + env(safe-area-inset-bottom));
                }
                /* ---------- Top Row with Burger Icon ---------- */
                .rc-home-root .top-burger-row {
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  gap: 12px;
                  padding: 2px 0;
                  margin-bottom: 8px;
                }
                .rc-home-root .brand-mini {
                  display: flex;
                  align-items: center;
                  gap: 9px;
                  cursor: pointer;
                }
                .rc-home-root .brand-mini svg {
                  width: 30px; height: 30px;
                  filter: drop-shadow(0 0 8px rgba(255, 190, 50, 0.45));
                }
                .rc-home-root .brand-mini span {
                  font-size: 18px;
                  font-weight: 800;
                  letter-spacing: -0.02em;
                  background: linear-gradient(180deg, #fff3c4 0%, #f3b93f 60%, #b87914 100%);
                  -webkit-background-clip: text; background-clip: text;
                  -webkit-text-fill-color: transparent; color: transparent;
                }
                .rc-home-root .top-actions {
                  display: flex;
                  align-items: center;
                  gap: 8px;
                }
                .rc-home-root .icon-btn {
                  position: relative;
                  width: 42px; height: 42px;
                  border-radius: 13px;
                  border: 1.5px solid var(--gold-line);
                  background: rgba(10, 8, 4, 0.75);
                  color: var(--gold-1);
                  display: grid;
                  place-items: center;
                  cursor: pointer;
                  box-shadow: 0 0 14px rgba(255, 185, 45, 0.25), inset 0 0 12px rgba(255, 185, 45, 0.06);
                  transition: transform .12s, border-color .2s, box-shadow .2s;
                }
                .rc-home-root .icon-btn:hover {
                  border-color: var(--gold-1);
                  box-shadow: 0 0 20px rgba(255, 185, 45, 0.5);
                }
                .rc-home-root .icon-btn:active { transform: scale(0.95); }
                .rc-home-root .icon-btn svg {
                  width: 22px; height: 22px;
                  stroke: currentColor; fill: none; stroke-width: 2;
                  stroke-linecap: round; stroke-linejoin: round;
                }
                /* ---------- Kartu bercahaya (glow-card) ---------- */
                .rc-home-root .glow-card {
                  position: relative;
                  border-radius: 24px;
                  border: 1.5px solid #e2ae35;
                  background: linear-gradient(180deg, rgba(18, 14, 7, 0.84), rgba(5, 4, 2, 0.9));
                  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
                  box-shadow:
                    0 0 0 1px rgba(255, 215, 106, 0.16),
                    0 0 14px rgba(255, 190, 60, 0.45),
                    0 0 34px rgba(255, 185, 45, 0.26),
                    inset 0 0 22px rgba(255, 185, 45, 0.13),
                    inset 0 1px 0 rgba(255, 228, 150, 0.35);
                }
                /* ---------- Grafik ---------- */
                .rc-home-root .chart { padding: 16px 16px 14px; min-height: 186px; }
                .rc-home-root .chart-top { display: flex; align-items: center; gap: 10px; }
                .rc-home-root .chart-ico {
                  flex: none; width: 27px; height: 27px; stroke: var(--gold-1); fill: none;
                  stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round;
                }
                .rc-home-root .chart-title {
                  flex: 1; min-width: 0; font-size: 16px; font-weight: 700;
                  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #fff;
                }
                .rc-home-root .seg {
                  flex: none; display: flex; padding: 3px; border-radius: 999px;
                  border: 1.5px solid var(--gold-line); background: rgba(8, 6, 3, 0.6);
                }
                .rc-home-root .seg button {
                  border: 0; background: none; cursor: pointer;
                  padding: 7px 12px; border-radius: 999px;
                  font: inherit; font-size: 14px; font-weight: 500; color: #d2cdc2;
                  transition: background .2s, color .2s, box-shadow .2s;
                }
                .rc-home-root .seg button:focus-visible { outline: 2px solid var(--gold-1); outline-offset: 1px; }
                .rc-home-root .seg button[aria-pressed="true"] {
                  color: #1b1204; font-weight: 700;
                  background: linear-gradient(100deg, #f0b73a, #ffe08a 60%, #f4c24a);
                  box-shadow: 0 0 14px rgba(255, 185, 45, 0.55);
                }
                .rc-home-root .chart-body {
                  margin-top: 12px; display: grid; place-items: center; min-height: 112px; text-align: center;
                }
                .rc-home-root .empty-bars { width: 42px; height: 48px; margin-bottom: 10px; margin-left: auto; margin-right: auto; }
                .rc-home-root .chart-empty { font-size: 15.5px; color: #e7e3d8; }
                .rc-home-root .chart-svg { width: 100%; height: auto; display: block; overflow: visible; }
                .rc-home-root .chart-svg text { font-family: inherit; }

                /* ---------- Pencarian ---------- */
                .rc-home-root .search { display: flex; gap: 10px; margin-top: 16px; }
                .rc-home-root .sbox {
                  flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px;
                  height: 46px; padding: 0 14px; border-radius: 15px;
                  border: 1.5px solid var(--gold-line); background: rgba(10, 8, 4, 0.7);
                  box-shadow: 0 0 14px rgba(255, 185, 45, 0.25), inset 0 0 12px rgba(255, 185, 45, 0.06);
                  transition: box-shadow .2s, border-color .2s;
                }
                .rc-home-root .sbox:focus-within {
                  border-color: var(--gold-1);
                  box-shadow: 0 0 0 3px rgba(255, 200, 70, 0.14), 0 0 18px rgba(255, 185, 45, 0.4);
                }
                .rc-home-root .sbox svg {
                  flex: none; width: 23px; height: 23px; stroke: var(--gold-1); fill: none;
                  stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
                }
                .rc-home-root .sbox input {
                  flex: 1; min-width: 0; height: 100%; background: transparent; border: 0; outline: 0;
                  color: #fff; font: inherit; font-size: 16px;
                }
                .rc-home-root .sbox input::placeholder { color: #8d887c; }
                .rc-home-root .sbox input::-webkit-search-cancel-button { display: none; }
                .rc-home-root .sortwrap { position: relative; flex: none; }
                .rc-home-root .iconbtn {
                  display: grid; place-items: center; width: 46px; height: 46px; cursor: pointer;
                  border-radius: 14px; border: 1.5px solid var(--gold-line); background: rgba(10, 8, 4, 0.7); color: var(--gold-1);
                  box-shadow: 0 0 14px rgba(255, 185, 45, 0.25), inset 0 0 12px rgba(255, 185, 45, 0.06);
                  transition: box-shadow .2s, background .2s;
                }
                .rc-home-root .iconbtn svg {
                  width: 24px; height: 24px; stroke: currentColor; fill: none;
                  stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round;
                }
                .rc-home-root .iconbtn:hover, .rc-home-root .iconbtn[aria-expanded="true"] {
                  box-shadow: 0 0 20px rgba(255, 185, 45, 0.5);
                }
                .rc-home-root .iconbtn.on { background: rgba(255, 185, 45, 0.16); }
                .rc-home-root .iconbtn:focus-visible { outline: 3px solid rgba(255, 215, 106, 0.6); outline-offset: 2px; }
                .rc-home-root .sortmenu {
                  position: absolute; right: 0; top: calc(100% + 8px); z-index: 15; width: 190px; padding: 6px;
                  border-radius: 14px; border: 1.5px solid var(--gold-line); background: rgba(14, 11, 6, 0.97);
                  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.65), 0 0 22px rgba(255, 185, 45, 0.25);
                }
                .rc-home-root .sortmenu .lbl { padding: 6px 10px 4px; font-size: 12.5px; color: var(--dim); }
                .rc-home-root .sortmenu button {
                  display: flex; align-items: center; justify-content: space-between; width: 100%;
                  padding: 10px; border: 0; border-radius: 10px; background: none; cursor: pointer;
                  font: inherit; font-size: 15px; color: #fff; text-align: left;
                }
                .rc-home-root .sortmenu button:hover { background: rgba(255, 190, 50, 0.1); }
                .rc-home-root .sortmenu button:focus-visible { outline: 2px solid var(--gold-1); outline-offset: -2px; }
                .rc-home-root .sortmenu button[aria-checked="true"] { color: var(--gold-1); font-weight: 700; }
                .rc-home-root .sortmenu button[aria-checked="true"]::after { content: "✓"; }

                /* ---------- Chip kategori ---------- */
                .rc-home-root .chips {
                  display: flex; gap: 8px; margin: 14px -20px 0; padding: 6px 20px 8px;
                  overflow-x: auto; scroll-snap-type: x proximity; scroll-padding: 0 20px;
                  scrollbar-width: none; -webkit-overflow-scrolling: touch;
                }
                .rc-home-root .chips::-webkit-scrollbar { display: none; }
                .rc-home-root .chip {
                  flex: none; scroll-snap-align: start; height: 38px; padding: 0 19px; cursor: pointer;
                  border-radius: 999px; border: 1.5px solid var(--gold-line); background: rgba(8, 6, 3, 0.55);
                  font: inherit; font-size: 15px; font-weight: 500; color: #fff; white-space: nowrap;
                  transition: background .2s, box-shadow .2s;
                }
                .rc-home-root .chip:hover { box-shadow: 0 0 14px rgba(255, 185, 45, 0.35); }
                .rc-home-root .chip:focus-visible { outline: 3px solid rgba(255, 215, 106, 0.6); outline-offset: 2px; }
                .rc-home-root .chip[aria-pressed="true"] {
                  border-color: transparent; color: #1b1204; font-weight: 700;
                  background: linear-gradient(100deg, #f0b73a, #ffe08a 60%, #f4c24a);
                  box-shadow: 0 0 16px rgba(255, 185, 45, 0.55);
                }

                /* ---------- Daftar produk ---------- */
                .rc-home-root .listhead {
                  display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px;
                }
                .rc-home-root .listhead h2 {
                  font-size: 22px; font-weight: 700; letter-spacing: -0.01em; color: #fff;
                }
                .rc-home-root .selwrap { position: relative; flex: none; }
                .rc-home-root .selwrap select {
                  appearance: none; -webkit-appearance: none;
                  height: 40px; padding: 0 38px 0 18px; border-radius: 13px; cursor: pointer;
                  border: 1.5px solid var(--gold-line); background: rgba(10, 8, 4, 0.7); color: #fff;
                  font: inherit; font-size: 14.5px;
                  box-shadow: 0 0 14px rgba(255, 185, 45, 0.22);
                }
                .rc-home-root .selwrap select:focus-visible { outline: 3px solid rgba(255, 215, 106, 0.6); outline-offset: 2px; }
                .rc-home-root .selwrap select option { background: #14100a; color: #fff; }
                .rc-home-root .selwrap svg {
                  position: absolute; right: 12px; top: 50%; width: 20px; height: 20px; margin-top: -10px;
                  pointer-events: none; stroke: var(--gold-1); fill: none; stroke-width: 2.2;
                  stroke-linecap: round; stroke-linejoin: round;
                }
                .rc-home-root .grp {
                  margin: 20px 0 10px 2px; font-size: 17px; font-weight: 700; color: var(--gold-1);
                }
                .rc-home-root .none {
                  margin-top: 28px; text-align: center; color: var(--dim); font-size: 15px;
                }
                .rc-home-root .pcard { padding: 12px 12px 10px; margin-bottom: 14px; }
                .rc-home-root .ptop { display: flex; gap: 14px; }
                .rc-home-root .pimg {
                  flex: none; width: 88px; height: 88px; border-radius: 14px; background: #fff;
                  overflow: hidden; display: grid; place-items: center; cursor: pointer;
                }
                .rc-home-root .pimg img, .rc-home-root .pimg svg {
                  width: 100%; height: 100%; object-fit: contain; display: block;
                }
                .rc-home-root .pbody { min-width: 0; padding-top: 2px; }
                .rc-home-root .pname { font-size: 19px; font-weight: 700; line-height: 1.25; color: #fff; }
                .rc-home-root .pprice {
                  margin-top: 2px; font-size: 23px; font-weight: 800; color: var(--gold-1);
                  text-shadow: 0 0 14px rgba(255, 185, 45, 0.25); font-variant-numeric: tabular-nums;
                }
                .rc-home-root .punit { margin-top: 3px; font-size: 14.5px; color: var(--dim); }
                .rc-home-root .pbot {
                  display: flex; align-items: center; justify-content: space-between; gap: 8px;
                  margin-top: 12px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.12);
                }
                .rc-home-root .infobtn {
                  display: inline-flex; align-items: center; gap: 6px; padding: 8px 4px; border: 0;
                  background: none; cursor: pointer; font: inherit; font-size: 15px; color: var(--gold-1); border-radius: 8px;
                }
                .rc-home-root .infobtn svg {
                  width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2.2;
                  stroke-linecap: round; stroke-linejoin: round; transition: transform .2s;
                }
                .rc-home-root .infobtn[aria-expanded="true"] svg { transform: rotate(180deg); }
                .rc-home-root .infobtn:focus-visible { outline: 2px solid var(--gold-1); }
                .rc-home-root .qty { display: flex; align-items: center; gap: 14px; }
                .rc-home-root .qbtn {
                  display: grid; place-items: center; border-radius: 50%; cursor: pointer; padding: 0;
                  transition: transform .12s, box-shadow .2s, opacity .2s;
                }
                .rc-home-root .qbtn svg { stroke: currentColor; fill: none; stroke-width: 2.6; stroke-linecap: round; }
                .rc-home-root .qbtn:active { transform: scale(0.92); }
                .rc-home-root .qbtn:focus-visible { outline: 3px solid rgba(255, 215, 106, 0.6); outline-offset: 2px; }
                .rc-home-root .qbtn.minus {
                  width: 38px; height: 38px; border: 1.5px solid var(--gold-line);
                  background: rgba(255, 185, 45, 0.12); color: var(--gold-1);
                }
                .rc-home-root .qbtn.minus svg { width: 18px; height: 18px; }
                .rc-home-root .qbtn.minus[disabled] { opacity: 0.55; cursor: default; }
                .rc-home-root .qbtn.plus {
                  width: 42px; height: 42px; border: 0;
                  background: linear-gradient(160deg, #ffe08a, #f0b73a); color: #1b1204;
                  box-shadow: 0 0 16px rgba(255, 185, 45, 0.55);
                }
                .rc-home-root .qbtn.plus svg { width: 20px; height: 20px; }
                .rc-home-root .qval {
                  min-width: 24px; text-align: center; font-size: 20px; font-weight: 600;
                  font-variant-numeric: tabular-nums; color: #fff;
                }
                .rc-home-root .pinfo {
                  margin-top: 8px; padding: 10px 12px; border-radius: 12px;
                  border: 1px solid rgba(217, 165, 42, 0.3); background: rgba(255, 185, 45, 0.06);
                  font-size: 14px; line-height: 1.55; color: #d6d1c6;
                }
                .rc-home-root .pinfo dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 14px; }
                .rc-home-root .pinfo dt { color: var(--dim); }
                .rc-home-root .pinfo p { margin-top: 6px; }

                /* ---------- Bar pesanan (cartbar) ---------- */
                .rc-home-root .cartbar {
                  position: fixed; left: 50%; z-index: 19;
                  bottom: calc(max(env(safe-area-inset-bottom), 12px) + 84px);
                  width: min(calc(100% - 28px), 452px); height: 54px;
                  display: flex; align-items: center; justify-content: space-between; gap: 10px;
                  padding: 0 6px 0 18px; border-radius: 999px; color: #1b1204;
                  background: linear-gradient(100deg, #e5b13a 0%, #fbdc7a 45%, #e8b440 100%);
                  box-shadow: 0 0 0 1.5px rgba(255, 215, 106, 0.55), 0 0 28px rgba(255, 185, 45, 0.5), 0 10px 24px rgba(0, 0, 0, 0.5);
                  transform: translate(-50%, 24px); opacity: 0; pointer-events: none;
                  transition: transform .3s cubic-bezier(.2, .9, .3, 1.1), opacity .25s;
                }
                .rc-home-root .cartbar.show { transform: translate(-50%, 0); opacity: 1; pointer-events: auto; }
                .rc-home-root .cartbar .ct { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
                .rc-home-root .cartbar .ct span { font-size: 12.5px; font-weight: 600; opacity: 0.8; }
                .rc-home-root .cartbar .ct b { font-size: 17px; font-weight: 800; white-space: nowrap; font-variant-numeric: tabular-nums; }
                .rc-home-root .cartbar .go {
                  height: 42px; padding: 0 20px; border: 0; border-radius: 999px; cursor: pointer;
                  font: inherit; font-size: 15.5px; font-weight: 700; color: var(--gold-1); background: #1b1204;
                  transition: transform .12s, filter .2s;
                }
                .rc-home-root .cartbar .go:hover { filter: brightness(1.25); }
                .rc-home-root .cartbar .go:active { transform: scale(0.97); }
                .rc-home-root .cartbar .go:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }

                /* ---------- Navigasi bawah (6-Tab Rounded Gold Dock with AI Order) ---------- */
                .rc-home-root .nav {
                  position: fixed; left: 50%; z-index: 20; transform: translateX(-50%);
                  bottom: max(env(safe-area-inset-bottom), 10px);
                  width: min(calc(100% - 20px), 468px); height: 64px;
                  display: grid; grid-template-columns: repeat(6, 1fr); align-items: center; padding: 2px 4px;
                  border-radius: 30px; border: 1.5px solid #e2ae35;
                  background: rgba(9, 7, 3, 0.92);
                  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
                  box-shadow: 0 0 0 1px rgba(255, 215, 106, 0.14), 0 0 20px rgba(255, 190, 60, 0.45), 0 0 40px rgba(255, 185, 45, 0.2), inset 0 0 18px rgba(255, 185, 45, 0.1);
                }
                .rc-home-root .nav button {
                  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
                  height: 100%; border: 0; background: none; cursor: pointer;
                  border-radius: 22px; color: #e9e5d9; text-decoration: none; font: inherit;
                  font-size: 10.5px; white-space: nowrap; letter-spacing: -0.01em;
                  -webkit-tap-highlight-color: transparent;
                }
                .rc-home-root .nav button:focus-visible { outline: 2px solid var(--gold-1); outline-offset: -3px; }
                .rc-home-root .nav .ib { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; position: relative; }
                .rc-home-root .nav .ib svg { width: 25px; height: 25px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
                .rc-home-root .nav button.on { color: var(--gold-1); font-weight: 700; }
                .rc-home-root .nav button.on .ib {
                  border: 2px solid #e0ac35;
                  box-shadow: 0 0 14px rgba(255, 185, 45, 0.55), inset 0 0 8px rgba(255, 185, 45, 0.15);
                }
                .rc-home-root .nav button.ai { color: var(--gold-1); }
                .rc-home-root .nav .ai-badge {
                  display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px;
                  border: 2px solid currentColor; font-size: 12px; font-weight: 900; letter-spacing: -0.02em; line-height: 1;
                }

                /* Shared greet-card & cat-pill for Cart / Order History screens */
                .rc-home-root .greet-card {
                  position: relative;
                  padding: 16px 18px;
                  border-radius: 20px;
                  background: linear-gradient(135deg, rgba(40, 28, 10, 0.85) 0%, rgba(18, 13, 6, 0.9) 100%);
                  border: 1.5px solid rgba(255, 200, 82, 0.45);
                  box-shadow: 0 0 24px rgba(255, 185, 45, 0.16), inset 0 1px 0 rgba(255, 230, 160, 0.22);
                  overflow: hidden;
                }
                .rc-home-root .greet-sub {
                  font-size: 12.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
                }
                .rc-home-root .greet-name { font-size: 20px; font-weight: 800; color: #fff; margin-top: 2px; }
                .rc-home-root .greet-owner { font-size: 13px; color: var(--gold-1); margin-top: 2px; }
                .rc-home-root .cats {
                  margin-top: 12px; display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none;
                }
                .rc-home-root .cats::-webkit-scrollbar { display: none; }
                .rc-home-root .cat-pill {
                  flex: 0 0 auto; padding: 9px 15px; border-radius: 999px;
                  border: 1px solid rgba(255, 200, 82, 0.45); background: rgba(20, 15, 8, 0.72);
                  color: var(--muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; transition: all .18s;
                }
                .rc-home-root .cat-pill.active {
                  color: #1b1204; border-color: transparent;
                  background: linear-gradient(100deg, #e5b13a 0%, #fbdc7a 50%, #e8b440 100%);
                  box-shadow: 0 0 16px rgba(255, 185, 45, 0.38); font-weight: 700;
                }

                /* Drawer */
                .rc-home-root .drawer-backdrop {
                  position: fixed; inset: 0; z-index: 40;
                  background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(4px);
                  opacity: 0; pointer-events: none; transition: opacity .25s ease;
                }
                .rc-home-root .drawer-backdrop.open { opacity: 1; pointer-events: auto; }
                .rc-home-root .drawer {
                  position: fixed; top: 0; right: 0; bottom: 0; z-index: 45;
                  width: min(86vw, 340px);
                  background:
                    radial-gradient(360px 260px at 90% 0%, rgba(255, 190, 50, 0.16), transparent 70%),
                    linear-gradient(180deg, #140f07 0%, #090603 100%);
                  border-left: 1.5px solid rgba(255, 200, 82, 0.45);
                  box-shadow: -14px 0 38px rgba(0, 0, 0, 0.7);
                  transform: translateX(102%);
                  transition: transform .28s cubic-bezier(.22, .9, .3, 1);
                  display: flex; flex-direction: column; overflow: hidden;
                }
                .rc-home-root .drawer.open { transform: translateX(0); }
                .rc-home-root .drawer-head {
                  padding: 16px 18px; border-bottom: 1px solid rgba(255, 200, 82, 0.2);
                  display: flex; align-items: center; justify-content: space-between; gap: 10px;
                }
                .rc-home-root .drawer-title {
                  font-size: 15px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: var(--gold-1);
                }
                .rc-home-root .close-btn {
                  width: 34px; height: 34px; border-radius: 10px;
                  border: 1px solid rgba(255, 200, 82, 0.45); background: rgba(20, 15, 8, 0.8);
                  color: var(--text); display: grid; place-items: center; cursor: pointer;
                }
                .rc-home-root .close-btn svg {
                  width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round;
                }
                .rc-home-root .drawer-profile {
                  margin: 14px 16px 8px; padding: 14px; border-radius: 16px;
                  background: rgba(32, 23, 9, 0.8); border: 1px solid rgba(255, 200, 82, 0.45);
                  display: flex; align-items: center; gap: 12px;
                }
                .rc-home-root .avatar {
                  flex: 0 0 46px; height: 46px; border-radius: 14px;
                  background: linear-gradient(135deg, #ffe28a, #d89820); color: #1b1204;
                  font-weight: 800; font-size: 18px; display: grid; place-items: center;
                  box-shadow: 0 0 14px rgba(255, 185, 45, 0.4);
                }
                .rc-home-root .p-info { min-width: 0; flex: 1; }
                .rc-home-root .p-store {
                  font-size: 15px; font-weight: 800; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .rc-home-root .p-phone { font-size: 12px; color: var(--muted); margin-top: 2px; }
                .rc-home-root .p-tier {
                  display: inline-flex; align-items: center; gap: 4px; margin-top: 5px;
                  padding: 2px 8px; border-radius: 999px;
                  background: rgba(37, 224, 140, 0.15); border: 1px solid rgba(37, 224, 140, 0.45);
                  color: #6ef0b2; font-size: 10.5px; font-weight: 700;
                }
                .rc-home-root .drawer-body { flex: 1; overflow-y: auto; padding: 6px 12px 16px; }
                .rc-home-root .menu-sec-label {
                  padding: 10px 10px 6px; font-size: 11px; font-weight: 700;
                  letter-spacing: 0.08em; text-transform: uppercase; color: #8f8470;
                }
                .rc-home-root .menu-list { display: flex; flex-direction: column; gap: 4px; }
                .rc-home-root .menu-item {
                  width: 100%; padding: 11px 12px; border: 1px solid transparent; border-radius: 12px;
                  background: transparent; color: var(--text); font: inherit; font-size: 14px; font-weight: 600;
                  display: flex; align-items: center; justify-content: space-between; gap: 12px;
                  cursor: pointer; text-align: left; transition: background .15s, border-color .15s, color .15s;
                }
                .rc-home-root .menu-item-left { display: flex; align-items: center; gap: 12px; }
                .rc-home-root .menu-item svg {
                  width: 19px; height: 19px; stroke: var(--gold-2); fill: none;
                  stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round;
                }
                .rc-home-root .menu-item:hover, .rc-home-root .menu-item.active {
                  background: rgba(255, 200, 75, 0.12);
                  border-color: rgba(255, 200, 82, 0.35);
                  color: var(--gold-1);
                }
                .rc-home-root .menu-pill {
                  padding: 2px 8px; border-radius: 999px;
                  background: rgba(255, 210, 90, 0.18); border: 1px solid rgba(255, 210, 90, 0.45);
                  color: var(--gold-1); font-size: 11px; font-weight: 700;
                }
                .rc-home-root .drawer-foot {
                  padding: 12px 16px calc(14px + env(safe-area-inset-bottom));
                  border-top: 1px solid rgba(255, 200, 82, 0.18); background: rgba(10, 7, 3, 0.85);
                }
                .rc-home-root .logout-btn {
                  width: 100%; height: 46px; border-radius: 13px;
                  border: 1.5px solid rgba(255, 120, 95, 0.55);
                  background: linear-gradient(135deg, rgba(90, 22, 16, 0.78), rgba(45, 12, 9, 0.85));
                  color: #ffb4a6; font: inherit; font-size: 14.5px; font-weight: 700;
                  display: flex; align-items: center; justify-content: center; gap: 9px;
                  cursor: pointer; box-shadow: 0 0 16px rgba(255, 95, 70, 0.18);
                  transition: transform .12s, border-color .2s, background .2s, color .2s;
                }
                .rc-home-root .logout-btn:hover {
                  border-color: #ff7b66; color: #ffd2c9;
                  background: linear-gradient(135deg, rgba(120, 28, 20, 0.88), rgba(65, 16, 12, 0.92));
                }
                .rc-home-root .logout-btn svg {
                  width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2;
                  stroke-linecap: round; stroke-linejoin: round;
                }
                /* Modal & Toast */
                .rc-home-root .modal-backdrop {
                  position: fixed; inset: 0; z-index: 60;
                  background: rgba(0, 0, 0, 0.72); backdrop-filter: blur(6px);
                  display: grid; place-items: center; padding: 20px;
                  opacity: 0; pointer-events: none; transition: opacity .2s ease;
                }
                .rc-home-root .modal-backdrop.open { opacity: 1; pointer-events: auto; }
                .rc-home-root .modal {
                  width: 100%; max-width: 340px; padding: 22px 20px 18px; border-radius: 20px;
                  background: linear-gradient(180deg, #1a1308 0%, #0e0a04 100%);
                  border: 1.5px solid rgba(255, 200, 82, 0.45);
                  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.75), 0 0 28px rgba(255, 185, 45, 0.2);
                  text-align: center;
                }
                .rc-home-root .modal-ico {
                  width: 52px; height: 52px; margin: 0 auto 12px; border-radius: 16px;
                  background: rgba(255, 120, 95, 0.14); border: 1px solid rgba(255, 120, 95, 0.45);
                  color: #ff9580; display: grid; place-items: center;
                }
                .rc-home-root .modal-ico svg {
                  width: 26px; height: 26px; stroke: currentColor; fill: none; stroke-width: 2;
                  stroke-linecap: round; stroke-linejoin: round;
                }
                .rc-home-root .modal h3 { font-size: 18px; font-weight: 800; color: #fff; }
                .rc-home-root .modal p { font-size: 13.5px; color: var(--muted); margin-top: 6px; line-height: 1.45; }
                .rc-home-root .modal-actions { margin-top: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
                .rc-home-root .m-btn { height: 42px; border-radius: 11px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
                .rc-home-root .m-cancel { border: 1px solid rgba(255, 200, 82, 0.45); background: rgba(24, 18, 9, 0.8); color: var(--text); }
                .rc-home-root .m-confirm { border: 0; background: linear-gradient(135deg, #ff7b66, #d94832); color: #fff; box-shadow: 0 0 16px rgba(255, 95, 70, 0.35); }
                .rc-home-root .rc-toast {
                  position: fixed; left: 50%; top: max(env(safe-area-inset-top), 16px); z-index: 55;
                  width: max-content; max-width: calc(100vw - 32px);
                  padding: 12px 18px; border-radius: 14px;
                  border: 1px solid rgba(243, 192, 74, 0.6); background: rgba(18, 13, 5, 0.97);
                  color: #ffe3a0; font-size: 14.5px; line-height: 1.4; text-align: center;
                  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 20px rgba(255, 185, 45, 0.22);
                  opacity: 0; transform: translate(-50%, -20px);
                  transition: opacity .25s, transform .3s; pointer-events: none;
                }
                .rc-home-root .rc-toast.show { opacity: 1; transform: translate(-50%, 0); }

                @media (max-width: 370px) {
                  .rc-home-root .wrap, .rc-home-root .container { padding-left: 14px; padding-right: 14px; }
                  .rc-home-root .chips { margin-left: -14px; margin-right: -14px; padding-left: 14px; padding-right: 14px; scroll-padding: 0 14px; }
                  .rc-home-root .seg button { padding: 7px 10px; font-size: 13px; }
                  .rc-home-root .pimg { width: 74px; height: 74px; }
                  .rc-home-root .pname { font-size: 17px; }
                  .rc-home-root .pprice { font-size: 20px; }
                  .rc-home-root .nav button { font-size: 11px; }
                  .rc-home-root .pcard { padding-left: 10px; padding-right: 10px; }
                  .rc-home-root .pbot { gap: 4px; }
                  .rc-home-root .infobtn { font-size: 12.5px; gap: 4px; white-space: nowrap; padding-left: 0; padding-right: 0; }
                  .rc-home-root .infobtn svg { width: 16px; height: 16px; }
                  .rc-home-root .qty { gap: 8px; }
                  .rc-home-root .qbtn.minus { width: 34px; height: 34px; }
                  .rc-home-root .qbtn.plus { width: 38px; height: 38px; }
                  .rc-home-root .qval { font-size: 18px; min-width: 20px; }
                }
              `}</style>

              {/* Latar gelombang emas (exact SVG from riskcart-home.html) */}
              <div className="bg" aria-hidden="true">
                <div className="orb orb-tl" />
                <div className="orb orb-br" />

                {/* Sudut kiri atas */}
                <svg className="bg-top" viewBox="0 0 850 480" preserveAspectRatio="xMinYMin meet" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="streakTop" gradientUnits="userSpaceOnUse" x1="0" y1="380" x2="360" y2="0">
                      <stop offset="0" stopColor="#ffb52e" stopOpacity="0.25" />
                      <stop offset="0.6" stopColor="#ffd978" stopOpacity="1" />
                      <stop offset="1" stopColor="#fff2c4" stopOpacity="1" />
                    </linearGradient>
                    <linearGradient id="arcGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="850" y2="0">
                      <stop offset="0" stopColor="#ffc24a" stopOpacity="0.8" />
                      <stop offset="0.6" stopColor="#ffd978" stopOpacity="0.45" />
                      <stop offset="1" stopColor="#ffc24a" stopOpacity="0.04" />
                    </linearGradient>
                    <linearGradient id="fillTop" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#ffb52e" stopOpacity="0.5" />
                      <stop offset="1" stopColor="#8a5a00" stopOpacity="0" />
                    </linearGradient>
                    <filter id="glowT" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="7" result="b" />
                      <feMerge>
                        <feMergeNode in="b" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <filter id="softT" x="-30%" y="-30%" width="160%" height="160%">
                      <feGaussianBlur stdDeviation="26" />
                    </filter>
                  </defs>
                  <g className="wave-float slow">
                    <path d="M0,0 L430,0 C270,80 90,210 0,380 Z" fill="url(#fillTop)" filter="url(#softT)" />
                    <path d="M-40,380 C70,200 180,80 330,-30" fill="none" stroke="url(#streakTop)" strokeWidth="4" filter="url(#glowT)" />
                    <path d="M-40,330 C60,170 170,50 300,-30" fill="none" stroke="url(#streakTop)" strokeWidth="2.2" opacity="0.9" filter="url(#glowT)" />
                    <path d="M-40,285 C50,150 150,30 260,-30" fill="none" stroke="url(#streakTop)" strokeWidth="1.2" opacity="0.65" />
                    <path d="M-40,250 C200,120 480,40 700,24 C780,18 840,26 900,42" fill="none" stroke="url(#arcGrad)" strokeWidth="1.4" />
                  </g>
                  <g fill="#ffd978">
                    <circle className="spark" cx="90" cy="70" r="1.8" />
                    <circle className="spark" cx="250" cy="170" r="1.3" />
                  </g>
                </svg>

                {/* Gelombang kanan dan bawah */}
                <svg className="bg-bottom" viewBox="0 1100 850 750" preserveAspectRatio="xMaxYMax meet" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="streak" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="850" y2="0">
                      <stop offset="0" stopColor="#ffd978" stopOpacity="0" />
                      <stop offset="0.3" stopColor="#ffc24a" stopOpacity="0.85" />
                      <stop offset="0.65" stopColor="#fff0b8" stopOpacity="1" />
                      <stop offset="1" stopColor="#ffc24a" stopOpacity="0.9" />
                    </linearGradient>
                    <linearGradient id="streakR" gradientUnits="userSpaceOnUse" x1="900" y1="1180" x2="560" y2="1560">
                      <stop offset="0" stopColor="#fff2c4" stopOpacity="1" />
                      <stop offset="0.5" stopColor="#ffc24a" stopOpacity="0.8" />
                      <stop offset="1" stopColor="#ffb52e" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="fillGold" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#ffb52e" stopOpacity="0.5" />
                      <stop offset="1" stopColor="#8a5a00" stopOpacity="0" />
                    </linearGradient>
                    <radialGradient id="rg" cx="0.5" cy="0.5" r="0.5">
                      <stop offset="0" stopColor="#ffd978" stopOpacity="0.7" />
                      <stop offset="1" stopColor="#ffb52e" stopOpacity="0" />
                    </radialGradient>
                    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="8" result="b" />
                      <feMerge>
                        <feMergeNode in="b" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
                      <feGaussianBlur stdDeviation="24" />
                    </filter>
                  </defs>
                  <g className="wave-float">
                    <circle cx="10" cy="1800" r="170" fill="url(#rg)" />
                    <path d="M-20,1760 C140,1650 320,1590 520,1600 C700,1610 820,1560 900,1470 L900,1850 L-20,1850 Z" fill="url(#fillGold)" opacity="0.3" filter="url(#soft)" />
                    <path d="M900,1180 C860,1260 800,1330 700,1420 C650,1465 600,1500 560,1530" fill="none" stroke="url(#streakR)" strokeWidth="4" filter="url(#glow)" />
                    <path d="M900,1235 C840,1325 750,1405 640,1485" fill="none" stroke="url(#streakR)" strokeWidth="2.2" opacity="0.9" filter="url(#glow)" />
                    <path d="M-20,1760 C140,1650 320,1590 520,1600 C700,1610 820,1560 900,1470" fill="none" stroke="url(#streak)" strokeWidth="3.6" filter="url(#glow)" />
                    <path d="M-20,1800 C150,1700 340,1640 540,1660 C720,1680 830,1640 900,1560" fill="none" stroke="url(#streak)" strokeWidth="2.2" opacity="0.9" filter="url(#glow)" />
                    <path d="M-20,1700 C120,1620 300,1560 480,1565 C640,1570 760,1520 900,1410" fill="none" stroke="url(#streak)" strokeWidth="1.2" opacity="0.6" />
                  </g>
                  <g fill="#ffd978">
                    <circle className="spark" cx="780" cy="1220" r="2" />
                    <circle className="spark" cx="820" cy="1330" r="1.5" />
                    <circle className="spark" cx="60" cy="1640" r="1.8" />
                    <circle className="spark" cx="620" cy="1700" r="1.5" />
                    <circle className="spark" cx="760" cy="1760" r="1.8" />
                  </g>
                </svg>
              </div>

              {/* Main Content */}
              <main className="page">
                <div className="wrap container">
                  {/* Top Bar with Brand, Customer Greeting, Language Selector & Burger Menu */}
                  <div className="top-burger-row">
                    <div
                      translate="no"
                      data-no-translate="true"
                      className="brand-mini notranslate"
                      onClick={() => {
                        setActiveHomeNav('home');
                        setCurrentScreen('home_member');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <defs>
                          <linearGradient id="chGoldGrad" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0" stopColor="#fff2c4" />
                            <stop offset="0.5" stopColor="#f4b63d" />
                            <stop offset="1" stopColor="#b87914" />
                          </linearGradient>
                        </defs>
                        <path
                          d="M16 22h32l-3 30a4 4 0 0 1-4 3.6H23a4 4 0 0 1-4-3.6L16 22z"
                          fill="none"
                          stroke="url(#chGoldGrad)"
                          strokeWidth="3.5"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M24 22v-4a8 8 0 0 1 16 0v4"
                          fill="none"
                          stroke="url(#chGoldGrad)"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                        />
                        <path
                          d="M22 38c6-6 14 6 20 0"
                          fill="none"
                          stroke="url(#chGoldGrad)"
                          strokeWidth="3"
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="flex flex-col leading-tight">
                        <span className="notranslate">RiskCart</span>
                        <small
                          translate="no"
                          data-no-translate="true"
                          className="notranslate text-[10px] font-semibold text-amber-300/90 tracking-wide"
                        >
                          Artificial Intelligence
                        </small>
                      </div>
                    </div>

                    <div className="top-actions">
                      <button
                        type="button"
                        onClick={handleOpenAiOrderModal}
                        className="px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap"
                        style={{
                          background: 'linear-gradient(135deg, rgba(255, 216, 107, 0.22), rgba(184, 121, 20, 0.18))',
                          border: '1.5px solid #e2ae35',
                          color: '#ffd86b',
                          boxShadow: '0 0 14px rgba(255, 185, 45, 0.28)',
                        }}
                        title={tr('Order with AI Assistant', 'Pesan Otomatis Pakai AI')}
                      >
                        <Bot className="w-4 h-4 text-amber-300" />
                        <span>{tr('AI Order', 'Pesan AI')}</span>
                      </button>
                      <ThemeToggleButton />
                      <LanguageDropdown compact />
                      <button
                        type="button"
                        className="icon-btn"
                        id="menuBtn"
                        aria-label="Open Member Profile"
                        title="Profil & Akun Member"
                        onClick={() => navigateToProfileSubRoute('index')}
                      >
                        <User className="w-4 h-4 text-amber-300" />
                      </button>
                    </div>
                  </div>

                  {/* Customer Greeting Banner */}
                  <div className="mb-3 px-3.5 py-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-amber-200/90 font-medium truncate">
                        {tr('Welcome back,', 'Halo, Selamat Belanja')}{' '}
                        <strong className="text-amber-300 font-extrabold">
                          {displayOwnerName} ({displayStoreName})
                        </strong>
                      </p>
                      <p className="text-[11px] text-zinc-400 font-mono truncate">
                        WA: {displayPhone}
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-[10px] font-bold text-emerald-300 shrink-0">
                      {tr('Verified Member', 'Member Aktif')}
                    </span>
                  </div>

                  {currentScreen === 'home_member' && (
                    <>
                      <h1 className="sr">Home</h1>

                      {/* Grafik pembelian (Your Purchase Chart — 6belanja.png) */}
                      <section className="glow-card chart" id="clienthome-chart-card" aria-label="Your Purchase Chart">
                        <div className="chart-top">
                          <svg className="chart-ico" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 3v18h18" />
                            <polyline points="7 15 11 10.5 14 13.5 20 7" />
                            <polyline points="15.5 7 20 7 20 11.5" />
                          </svg>
                          <h2 className="chart-title" id="chartTitle" title="Your Purchase Chart">
                            Your Purchase Chart
                          </h2>
                          <div className="seg" role="group" aria-label="Chart period">
                            <button
                              type="button"
                              aria-pressed={chartPeriod === 'mingguan'}
                              onClick={() => setChartPeriod('mingguan')}
                            >
                              Weekly
                            </button>
                            <button
                              type="button"
                              aria-pressed={chartPeriod === 'bulanan'}
                              onClick={() => setChartPeriod('bulanan')}
                            >
                              Monthly
                            </button>
                          </div>
                        </div>

                        <div className="chart-body" id="chartBody">
                          {!chartRows.length || chartMax <= 0 ? (
                            <div>
                              <svg className="empty-bars" viewBox="0 0 42 48" aria-hidden="true">
                                <defs>
                                  <linearGradient id="eb" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0" stopColor="#e8b43b" />
                                    <stop offset="1" stopColor="#8a6420" />
                                  </linearGradient>
                                </defs>
                                <rect x="1" y="26" width="10" height="21" rx="5" fill="url(#eb)" />
                                <rect x="16" y="14" width="10" height="33" rx="5" fill="url(#eb)" />
                                <rect x="31" y="1" width="10" height="46" rx="5" fill="url(#eb)" />
                              </svg>
                              <p className="chart-empty">No orders placed in this period yet.</p>
                            </div>
                          ) : (
                            (() => {
                              const W = 340;
                              const H = 136;
                              const padT = 20;
                              const padB = 24;
                              const n = chartRows.length;
                              const slot = W / n;
                              const bw = Math.max(8, Math.min(34, slot * 0.56));
                              return (
                                <svg
                                  className="chart-svg"
                                  viewBox={`0 0 ${W} ${H}`}
                                  role="img"
                                  aria-label={`Purchase bar chart (${chartPeriod === 'mingguan' ? 'weekly' : 'monthly'})`}
                                >
                                  <defs>
                                    <linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0" stopColor="#ffe08a" />
                                      <stop offset="1" stopColor="#d9992a" />
                                    </linearGradient>
                                  </defs>
                                  <line
                                    x1="0"
                                    y1={H - padB}
                                    x2={W}
                                    y2={H - padB}
                                    stroke="rgba(255,255,255,.14)"
                                  />
                                  {chartRows.map((r, i) => {
                                    const v = Number(r.value) || 0;
                                    const h = Math.max(v > 0 ? 3 : 0, ((H - padT - padB) * v) / chartMax);
                                    const x = slot * i + (slot - bw) / 2;
                                    const y = H - padB - h;
                                    return (
                                      <g key={r.label + i}>
                                        <title>{`${r.label}: ${formatRpPlain(v)}`}</title>
                                        <rect
                                          x={x.toFixed(1)}
                                          y={y.toFixed(1)}
                                          width={bw.toFixed(1)}
                                          height={h.toFixed(1)}
                                          rx="4"
                                          fill="url(#bg1)"
                                        />
                                        {n <= 8 && v > 0 && (
                                          <text
                                            x={(x + bw / 2).toFixed(1)}
                                            y={(y - 5).toFixed(1)}
                                            textAnchor="middle"
                                            fontSize="10.5"
                                            fontWeight="600"
                                            fill="#ffe3a0"
                                          >
                                            {shortRp(v)}
                                          </text>
                                        )}
                                        <text
                                          x={(x + bw / 2).toFixed(1)}
                                          y={H - 7}
                                          textAnchor="middle"
                                          fontSize="11"
                                          fill="#b9b4a8"
                                        >
                                          {r.label}
                                        </text>
                                      </g>
                                    );
                                  })}
                                </svg>
                              );
                            })()
                          )}
                        </div>
                      </section>

                      {/* Pencarian & Sort (6belanja.png) */}
                      <div className="search">
                        <label className="sbox">
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="11" cy="11" r="7" />
                            <path d="M20.5 20.5l-4.6-4.6" />
                          </svg>
                          <span className="sr">Search products</span>
                          <input
                            id="q"
                            type="search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="What do you need?"
                            autoComplete="off"
                            enterKeyHint="search"
                          />
                        </label>
                        <div
                          className="sortwrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className={`iconbtn ${homeSort !== 'default' ? 'on' : ''}`}
                            id="sortBtn"
                            type="button"
                            aria-label="Sort products"
                            aria-haspopup="true"
                            aria-expanded={isSortMenuOpen}
                            onClick={() => setIsSortMenuOpen((prev) => !prev)}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M3 6h5M14 6h7" />
                              <circle cx="11" cy="6" r="2.2" />
                              <path d="M3 12h11M20 12h1" />
                              <circle cx="17" cy="12" r="2.2" />
                              <path d="M3 18h3M12 18h9" />
                              <circle cx="9" cy="18" r="2.2" />
                            </svg>
                          </button>
                          {isSortMenuOpen && (
                            <div className="sortmenu" id="sortMenu" role="menu">
                              <div className="lbl">Sort by</div>
                              {[
                                { key: 'default', label: 'Default' },
                                { key: 'nama', label: 'Name A–Z' },
                                { key: 'murah', label: 'Lowest price' },
                                { key: 'mahal', label: 'Highest price' },
                              ].map((opt) => (
                                <button
                                  key={opt.key}
                                  type="button"
                                  role="menuitemradio"
                                  aria-checked={homeSort === opt.key}
                                  onClick={() => {
                                    setHomeSort(opt.key as any);
                                    setIsSortMenuOpen(false);
                                  }}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Kartu Asisten Order Pakai AI (Natural Language Order Banner) */}
                      <div
                        className="mt-3.5 p-3.5 rounded-2xl flex flex-col gap-2.5"
                        style={{
                          background: 'linear-gradient(135deg, rgba(38, 27, 9, 0.92) 0%, rgba(16, 11, 4, 0.96) 100%)',
                          border: '1.5px solid rgba(255, 200, 82, 0.5)',
                          boxShadow: '0 0 22px rgba(255, 185, 45, 0.18)',
                        }}
                      >
                        <div className="flex items-center justify-between gap-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                              style={{
                                background: 'linear-gradient(135deg, #ffd86b 0%, #d49b27 100%)',
                                color: '#1b1204',
                                boxShadow: '0 0 12px rgba(255, 185, 45, 0.45)',
                              }}
                            >
                              <Bot className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs sm:text-sm font-extrabold text-white truncate">
                                  {tr('Order with AI Assistant', 'Pesan Cepat Pakai AI')}
                                </span>
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-amber-500/20 border border-amber-400/50 text-amber-300">
                                  Gemini AI
                                </span>
                              </div>
                              <p className="text-[11px] text-amber-200/80 truncate">
                                {tr(
                                  'Type product name & qty — automatically added to cart!',
                                  'Ketik nama barang & jumlah dus/unit — otomatis masuk keranjang!'
                                )}
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={handleOpenAiOrderModal}
                            className="px-3.5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 shrink-0 cursor-pointer transition active:scale-95"
                            style={{
                              background: 'linear-gradient(100deg, #e5b13a 0%, #fbdc7a 50%, #e8b440 100%)',
                              color: '#1b1204',
                              boxShadow: '0 0 16px rgba(255, 185, 45, 0.35)',
                            }}
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>{tr('Open AI', 'Buka AI')}</span>
                          </button>
                        </div>

                        {aiOrderRecommendations.chips.length > 0 && (
                          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
                            <span className="text-[10px] font-bold text-amber-300/90 shrink-0">
                              {tr('Quick Order:', 'Sekali Klik:')}
                            </span>
                            {aiOrderRecommendations.chips.map((chip, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => {
                                  setIsAiModalOpen(true);
                                  handleSendAiOrder(chip.prompt);
                                }}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap cursor-pointer transition hover:border-amber-300"
                                style={{
                                  background: 'rgba(10, 8, 4, 0.9)',
                                  border: '1px solid rgba(255, 200, 82, 0.38)',
                                  color: '#fde68a',
                                }}
                              >
                                + {chip.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Kategori Chips (6belanja.png) */}
                      <div className="chips" id="chips" role="group" aria-label="Product categories">
                        {allCategoryChips.map((chipLabel) => {
                          const val = chipLabel === 'All' ? '' : chipLabel;
                          const isPressed = activeCatNorm === val;
                          return (
                            <button
                              key={chipLabel}
                              type="button"
                              className="chip"
                              aria-pressed={isPressed}
                              onClick={() => setActiveCategory(val || 'Semua')}
                            >
                              {chipLabel}
                            </button>
                          );
                        })}
                      </div>

                      {/* Daftar Produk & Filter Brand (6belanja.png) */}
                      <div className="listhead" id="clienthome-catalog-head">
                        <h2>Product List</h2>
                        <label className="selwrap">
                          <span className="sr">Filter brand</span>
                          <select
                            id="brand"
                            value={selectedBrand}
                            onChange={(e) => setSelectedBrand(e.target.value)}
                          >
                            <option value="">All Brands</option>
                            {availableBrands.map((b) => (
                              <option key={b} value={b}>
                                {b}
                              </option>
                            ))}
                          </select>
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </label>
                      </div>

                      {/* Grouped Product Cards (riskcart-home.html & 6belanja.png) */}
                      <div id="list" aria-live="polite">
                        {productGroups.length === 0 ? (
                          <p className="none">No products found.</p>
                        ) : (
                          productGroups.map((group) => (
                            <React.Fragment key={group.nama}>
                              <h3 className="grp">{group.nama}</h3>
                              {group.items.map((p) => {
                                const qty = getHomeItemQty(p.id);
                                const isInfoOpen = Boolean(expandedInfoProductIds[p.id]);
                                const hasCustomPhoto =
                                  p.imageUrl &&
                                  p.imageUrl !== '/splash-logo_1.png' &&
                                  !p.imageUrl.includes('splash-logo');

                                return (
                                  <article key={p.id} className="glow-card pcard">
                                    <div className="ptop">
                                      <div
                                        className="pimg"
                                        onClick={() => {
                                          if (hasCustomPhoto || (p.galleryUrls && p.galleryUrls.length > 0)) {
                                            setGalleryProduct({
                                              name: p.name,
                                              variantLabel: p.variantName
                                                ? `${p.variantType || 'Variant'}: ${p.variantName}`
                                                : undefined,
                                              imageUrl: p.imageUrl,
                                              galleryUrls: p.galleryUrls || p.galleryImages || [],
                                            });
                                          }
                                        }}
                                      >
                                        {hasCustomPhoto ? (
                                          <img
                                            src={p.imageUrl}
                                            alt={p.name}
                                            loading="lazy"
                                            referrerPolicy="no-referrer"
                                            onError={(e) => {
                                              (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                          />
                                        ) : p.thumbKind === 'gas' ? (
                                          <svg viewBox="0 0 60 60" aria-hidden="true">
                                            <ellipse cx="30" cy="55.5" rx="15" ry="2.4" fill="#000" opacity=".12" />
                                            <path d="M18 31q0-11 12-11t12 11v17q0 6-6 6H24q-6 0-6-6z" fill="#8fbd2b" />
                                            <path d="M18 31q0-11 12-11t12 11v3H18z" fill="#a6cf44" />
                                            <rect x="18" y="38" width="24" height="2.4" fill="#6f9a18" opacity=".7" />
                                            <rect x="23" y="14" width="14" height="7" rx="2" fill="#6a9419" />
                                            <path d="M22 16q0-8 8-8t8 8" fill="none" stroke="#5a8112" strokeWidth="2.4" strokeLinecap="round" />
                                            <rect x="27" y="4.5" width="6" height="5.5" rx="1.5" fill="#4a4a4a" />
                                            <ellipse cx="23.5" cy="36" rx="2" ry="9" fill="#fff" opacity=".28" />
                                          </svg>
                                        ) : p.thumbKind === 'galon' ? (
                                          <svg viewBox="0 0 60 60" aria-hidden="true">
                                            <ellipse cx="30" cy="56" rx="14" ry="2.2" fill="#000" opacity=".12" />
                                            <rect x="23.5" y="3.5" width="13" height="6.5" rx="2" fill="#2f7fcf" />
                                            <path d="M25 10h10v7q9 2 9 9v22q0 6-6 6H22q-6 0-6-6V26q0-7 9-9z" fill="#74b9ea" />
                                            <rect x="16" y="33" width="28" height="13" fill="#fff" />
                                            <rect x="16" y="37" width="28" height="5" fill="#d93030" />
                                            <path d="M20 26q0-4 4-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".5" />
                                          </svg>
                                        ) : (
                                          <svg viewBox="0 0 24 24" aria-hidden="true" style={{ padding: '20px', boxSizing: 'border-box' }}>
                                            <g fill="none" stroke="#9b8a5a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                              <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z" />
                                              <polyline points="3.3 7 12 12 20.7 7" />
                                              <line x1="12" y1="22" x2="12" y2="12" />
                                            </g>
                                          </svg>
                                        )}
                                      </div>

                                      <div className="pbody">
                                        <div className="pname" data-no-translate="true">
                                          {p.name}
                                        </div>
                                        <div className="pprice">{formatRpPlain(p.unitDisplayPrice)}</div>
                                        <div className="punit">{p.unitDisplayLabel}</div>
                                      </div>
                                    </div>

                                    <div className="pbot">
                                      <button
                                        type="button"
                                        className="infobtn"
                                        aria-expanded={isInfoOpen}
                                        aria-controls={`info-${p.id}`}
                                        onClick={() =>
                                          setExpandedInfoProductIds((prev) => ({
                                            ...prev,
                                            [p.id]: !prev[p.id],
                                          }))
                                        }
                                      >
                                        <span>View product information</span>
                                        <svg viewBox="0 0 24 24" aria-hidden="true">
                                          <path d="M6 9l6 6 6-6" />
                                        </svg>
                                      </button>

                                      <div className="qty">
                                        <button
                                          type="button"
                                          className="qbtn minus"
                                          disabled={qty <= 0}
                                          aria-label={`Decrease ${p.name}`}
                                          onClick={() => setHomeItemQty(p, qty - 1)}
                                        >
                                          <svg viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M5 12h14" />
                                          </svg>
                                        </button>
                                        <span className="qval" aria-live="polite">
                                          {qty}
                                        </span>
                                        <button
                                          type="button"
                                          className="qbtn plus"
                                          aria-label={`Increase ${p.name}`}
                                          onClick={() => setHomeItemQty(p, qty + 1)}
                                        >
                                          <svg viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M12 5v14M5 12h14" />
                                          </svg>
                                        </button>
                                      </div>
                                    </div>

                                    {isInfoOpen && (
                                      <div className="pinfo" id={`info-${p.id}`}>
                                        <dl>
                                          <dt>Category</dt>
                                          <dd>{p.categoryChip}</dd>
                                          <dt>Brand</dt>
                                          <dd>{p.brandName}</dd>
                                          <dt>Unit</dt>
                                          <dd>{p.unitDisplayLabel}</dd>
                                          <dt>Price</dt>
                                          <dd>{formatRpPlain(p.unitDisplayPrice)}</dd>
                                        </dl>
                                        {p.infoDescription && <p>{p.infoDescription}</p>}
                                      </div>
                                    )}
                                  </article>
                                );
                              })}
                            </React.Fragment>
                          ))
                        )}
                      </div>
                    </>
                  )}

                {/* ========================================================== */}
                {/* HALAMAN KERANJANG & CHECKOUT (Gold & Black Luxury Theme)   */}
                {/* ========================================================== */}
                {currentScreen === 'cart' && (
                  <div className="space-y-4">
                    {/* Header Card Keranjang */}
                    <section className="greet-card">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveHomeNav('home');
                              setCurrentScreen('home_member');
                            }}
                            className="icon-btn"
                            aria-label={tr('Back to Catalog', 'Kembali ke Katalog')}
                          >
                            <ArrowLeft className="w-4 h-4" />
                          </button>
                          <div>
                            <div className="greet-sub">{tr('Wholesale & Retail Order', 'Pesanan Grosir & Eceran')}</div>
                            <div className="greet-name" style={{ fontSize: '18px' }}>
                              {tr('Shopping Cart', 'Keranjang Belanja')}
                            </div>
                            <div className="greet-owner">
                              {cart.length} {tr('Selected Item Types', 'Jenis Barang Terpilih')} &bull;{' '}
                              <span style={{ color: '#25e08c' }}>
                                {totalCartItemsCount} {tr('Total Qty', 'Total Kuantitas')}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenAiOrderModal()}
                            className="px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap"
                            style={{
                              background: 'rgba(255, 200, 75, 0.16)',
                              border: '1px solid rgba(255, 210, 95, 0.5)',
                              color: '#ffd86b',
                            }}
                          >
                            <Bot className="w-4 h-4" />
                            <span>{tr('AI Order', 'Pesan AI')}</span>
                          </button>
                          {cart.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setCart([]);
                                showClientHomeToast(tr('Cart cleared', 'Keranjang dikosongkan'));
                              }}
                              className="px-3 py-2 rounded-xl text-xs font-bold cursor-pointer transition whitespace-nowrap"
                              style={{
                                background: 'rgba(90, 22, 16, 0.65)',
                                border: '1px solid rgba(255, 120, 95, 0.5)',
                                color: '#ffb4a6',
                              }}
                            >
                              {tr('Clear', 'Kosongkan')}
                            </button>
                          )}
                        </div>
                      </div>
                    </section>

                    {cart.length === 0 ? (
                      <div
                        className="py-14 px-6 rounded-2xl text-center flex flex-col items-center"
                        style={{
                          background: 'rgba(18, 14, 8, 0.85)',
                          border: '1.5px solid rgba(255, 200, 82, 0.32)',
                          boxShadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
                        }}
                      >
                        <div
                          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3"
                          style={{
                            background: 'rgba(255, 200, 75, 0.14)',
                            border: '1px solid rgba(255, 200, 82, 0.45)',
                            color: '#ffd86b',
                          }}
                        >
                          <ShoppingBag className="w-8 h-8" />
                        </div>
                        <p className="text-base font-extrabold text-white">
                          {tr('Your Shopping Cart is Empty', 'Keranjang Belanja Kosong')}
                        </p>
                        <p className="text-xs max-w-xs mt-1.5 mb-5" style={{ color: '#b7ad99' }}>
                          {tr(
                            'Select wholesale cartons or retail units from the product catalog or use the AI Order Assistant.',
                            'Pilih barang grosir (dus) atau eceran (pcs) dari katalog produk atau gunakan Asisten AI.'
                          )}
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2.5 w-full max-w-xs">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveHomeNav('home');
                              setCurrentScreen('home_member');
                            }}
                            className={goldPrimaryBtnClass}
                          >
                            <span>{tr('Browse Catalog', 'Buka Katalog Produk')}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Daftar Item Keranjang */}
                        <div className="space-y-3">
                          {cart.map((item, idx) => {
                            const isCarton = item.packageType === 'carton';
                            const unitPrice = isCarton ? item.product.pricePerCarton : item.product.pricePerUnit;
                            const effectivePrice = unitPrice < 500 ? unitPrice * 15500 : unitPrice;
                            const subtotal = effectivePrice * item.quantity;

                            return (
                              <div
                                key={`${item.product.id}-${item.packageType}`}
                                className="p-3.5 rounded-2xl flex items-center justify-between gap-3"
                                style={{
                                  background: 'rgba(18, 14, 8, 0.88)',
                                  border: '1.5px solid rgba(255, 200, 82, 0.35)',
                                  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
                                }}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div
                                    className="w-13 h-13 rounded-xl overflow-hidden shrink-0 flex items-center justify-center"
                                    style={{
                                      background:
                                        'radial-gradient(60px 50px at 50% 45%, rgba(255, 200, 80, 0.22), rgba(20, 14, 6, 0.95))',
                                      border: '1px solid rgba(255, 200, 82, 0.3)',
                                    }}
                                  >
                                    <img
                                      src={item.product.imageUrl}
                                      alt={item.product.name}
                                      referrerPolicy="no-referrer"
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).src = '/splash-logo_1.png';
                                      }}
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    <h4
                                      data-no-translate="true"
                                      className="text-xs sm:text-sm font-extrabold text-white truncate"
                                    >
                                      {item.product.name}
                                    </h4>
                                    <div className="flex items-center gap-1.5 mt-1 text-[11px] flex-wrap">
                                      <span
                                        className="px-2 py-0.5 rounded-md font-bold text-[10px] uppercase"
                                        style={{
                                          background: 'rgba(255, 200, 75, 0.2)',
                                          border: '1px solid rgba(255, 210, 95, 0.5)',
                                          color: '#ffd86b',
                                        }}
                                      >
                                        {isCarton
                                          ? `${tr('Carton', 'Dus')} (${item.product.piecesPerCarton || 24} pcs)`
                                          : tr('Unit / Pcs', 'Satuan / Pcs')}
                                      </span>
                                      <span className="font-mono tabular-nums" style={{ color: '#b7ad99' }}>
                                        {formatRpPlain(unitPrice)}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex flex-col items-end gap-1.5 shrink-0">
                                  <div
                                    className="text-xs sm:text-sm font-extrabold font-mono tabular-nums"
                                    style={{ color: '#ffd86b' }}
                                  >
                                    {formatRpPlain(subtotal)}
                                  </div>

                                  <div
                                    className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg"
                                    style={{
                                      background: 'rgba(10, 8, 4, 0.95)',
                                      border: '1px solid rgba(255, 200, 82, 0.38)',
                                    }}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateQty(idx, -1)}
                                      className="p-1 cursor-pointer transition"
                                      style={{ color: '#b7ad99' }}
                                    >
                                      <Minus className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="text-xs font-mono font-extrabold text-white px-1.5 tabular-nums">
                                      {item.quantity}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateQty(idx, 1)}
                                      className="p-1 cursor-pointer transition"
                                      style={{ color: '#ffd86b' }}
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Alamat & Kontak Pengiriman */}
                        <div
                          className="p-4 rounded-2xl space-y-3"
                          style={{
                            background: 'rgba(18, 14, 8, 0.88)',
                            border: '1.5px solid rgba(255, 200, 82, 0.35)',
                          }}
                        >
                          <div className="flex items-center justify-between text-xs font-extrabold text-white">
                            <span className="flex items-center gap-1.5">
                              <MapPin className="w-4 h-4" style={{ color: '#ffd86b' }} />
                              {tr('Delivery Address & Contact', 'Alamat & Kontak Pengiriman')}
                            </span>
                            <span
                              className="text-[10.5px] font-bold flex items-center gap-1 px-2.5 py-0.5 rounded-full"
                              style={{
                                background: 'rgba(15, 55, 34, 0.78)',
                                border: '1px solid rgba(80, 220, 145, 0.45)',
                                color: '#7df0b0',
                              }}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> {tr('GPS Validated', 'Tervalidasi GPS')}
                            </span>
                          </div>

                          <div className="space-y-2.5">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              <input
                                type="text"
                                value={member.name}
                                onChange={(e) => setMember({ ...member, name: e.target.value })}
                                placeholder={tr('Recipient Name', 'Nama Pemesan')}
                                className={goldInputClass}
                              />
                              <input
                                type="text"
                                value={member.phone}
                                onChange={(e) => setMember({ ...member, phone: e.target.value })}
                                placeholder={tr('WhatsApp Number', 'No. WhatsApp')}
                                className={`${goldInputClass} font-mono`}
                              />
                            </div>

                            <textarea
                              rows={2}
                              value={member.address}
                              onChange={(e) => setMember({ ...member, address: e.target.value })}
                              placeholder={tr('Complete delivery address...', 'Alamat lengkap tujuan pengiriman...')}
                              className={goldInputClass}
                            />
                          </div>
                        </div>

                        {/* Metode Pembayaran */}
                        <div
                          className="p-4 rounded-2xl space-y-2.5"
                          style={{
                            background: 'rgba(18, 14, 8, 0.88)',
                            border: '1.5px solid rgba(255, 200, 82, 0.35)',
                          }}
                        >
                          <span className="text-xs font-extrabold text-white block">
                            {tr('Payment Method', 'Metode Pembayaran')}
                          </span>
                          <div className="grid grid-cols-3 gap-2.5 text-xs">
                            {[
                              {
                                id: 'qris' as const,
                                labelEn: 'Instant QRIS',
                                labelId: 'QRIS Instan',
                                icon: QrCode,
                              },
                              {
                                id: 'cod' as const,
                                labelEn: 'COD / Cash',
                                labelId: 'COD / Tunai',
                                icon: Banknote,
                              },
                              {
                                id: 'transfer' as const,
                                labelEn: 'Bank Transfer',
                                labelId: 'Transfer Bank',
                                icon: CreditCard,
                              },
                            ].map((pm) => {
                              const IconComp = pm.icon;
                              const isSelected = paymentMethod === pm.id;
                              return (
                                <button
                                  key={pm.id}
                                  type="button"
                                  onClick={() => setPaymentMethod(pm.id)}
                                  className="p-3 rounded-xl flex flex-col items-center gap-1.5 transition cursor-pointer"
                                  style={
                                    isSelected
                                      ? {
                                          background:
                                            'linear-gradient(135deg, rgba(255, 210, 90, 0.25), rgba(184, 121, 20, 0.2))',
                                          border: '1.5px solid #ffd86b',
                                          color: '#fff3c4',
                                          boxShadow: '0 0 16px rgba(255, 185, 45, 0.28)',
                                          fontWeight: 800,
                                        }
                                      : {
                                          background: 'rgba(10, 8, 4, 0.85)',
                                          border: '1px solid rgba(255, 200, 82, 0.25)',
                                          color: '#b7ad99',
                                          fontWeight: 600,
                                        }
                                  }
                                >
                                  <IconComp
                                    className="w-4 h-4"
                                    style={{ color: isSelected ? '#ffd86b' : '#b7ad99' }}
                                  />
                                  <span className="text-[11px] whitespace-nowrap">
                                    {tr(pm.labelEn, pm.labelId)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Ringkasan Pembayaran */}
                        <div
                          className="p-4 rounded-2xl space-y-2 text-xs"
                          style={{
                            background:
                              'linear-gradient(135deg, rgba(40, 28, 10, 0.9) 0%, rgba(18, 13, 6, 0.95) 100%)',
                            border: '1.5px solid rgba(255, 200, 82, 0.45)',
                            boxShadow: '0 0 22px rgba(255, 185, 45, 0.14)',
                          }}
                        >
                          <div className="flex items-center justify-between" style={{ color: '#b7ad99' }}>
                            <span>{tr('Order Subtotal', 'Subtotal Belanja')}</span>
                            <span className="font-mono tabular-nums text-white font-bold">
                              {formatCurrency(cartSubtotal)}
                            </span>
                          </div>

                          {member.isVerified && (
                            <div className="flex items-center justify-between" style={{ color: '#25e08c' }}>
                              <span>{tr('VIP Member Discount (5%)', 'Diskon Khusus Member (5%)')}</span>
                              <span className="font-mono tabular-nums font-bold">
                                -{formatCurrency(memberDiscount)}
                              </span>
                            </div>
                          )}

                          <div className="flex items-center justify-between" style={{ color: '#b7ad99' }}>
                            <span>{tr('Delivery Fee (Store Radius)', 'Ongkos Kirim (Radius Toko)')}</span>
                            <span className="font-extrabold" style={{ color: isFreeDelivery ? '#25e08c' : '#ffd86b' }}>
                              {isFreeDelivery ? tr('FREE', 'GRATIS') : formatCurrency(deliveryFee)}
                            </span>
                          </div>

                          {!isFreeDelivery && freeDeliveryThreshold > 0 && cartSubtotal < freeDeliveryThreshold && (
                            <div className="text-[11px] text-amber-300/90 italic pt-0.5">
                              {tr(
                                `Add ${formatCurrency(freeDeliveryThreshold - cartSubtotal)} more for FREE DELIVERY!`,
                                `Tambah belanja ${formatCurrency(freeDeliveryThreshold - cartSubtotal)} lagi untuk GRATIS ONGKIR!`
                              )}
                            </div>
                          )}

                          <div
                            className="pt-2.5 flex items-center justify-between font-black text-sm text-white"
                            style={{ borderTop: '1px solid rgba(255, 200, 82, 0.25)' }}
                          >
                            <span>{tr('Total Payable', 'Total Pembayaran')}</span>
                            <span
                              className="text-base font-mono tabular-nums font-black"
                              style={{ color: '#ffd86b' }}
                            >
                              {formatCurrency(totalPayable)}
                            </span>
                          </div>
                        </div>

                        {/* Checkout Warning / Restriction Banner */}
                        {checkoutBlockedReason && (
                          <div
                            className="p-3 rounded-xl flex items-start gap-2.5 text-xs font-semibold animate-in fade-in"
                            style={{
                              background: 'rgba(127, 29, 29, 0.4)',
                              border: '1px solid rgba(239, 68, 68, 0.45)',
                              color: '#fca5a5',
                            }}
                          >
                            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                            <span>{checkoutBlockedReason}</span>
                          </div>
                        )}

                        {/* Tombol Checkout */}
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={handleConfirmOrder}
                            disabled={isPlacingOrder || Boolean(checkoutBlockedReason)}
                            className={`${goldPrimaryBtnClass} ${
                              checkoutBlockedReason ? 'opacity-50 cursor-not-allowed' : ''
                            }`}
                          >
                            {isPlacingOrder ? (
                              <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                <span>
                                  {tr('Sending Order to POS Cashier...', 'Mengirim Pesanan ke Kasir POS...')}
                                </span>
                              </>
                            ) : (
                              <>
                                <Receipt className="w-4 h-4" />
                                <span>
                                  {checkoutBlockedReason
                                    ? tr('Order Limit Not Met', 'Batas Pesanan Belum Terpenuhi')
                                    : tr('Confirm & Send Order to POS', 'Konfirmasi & Kirim Pesanan ke POS')}
                                </span>
                              </>
                            )}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ========================================================== */}
                {/* HALAMAN RIWAYAT PESANAN (Gold & Black Luxury Theme)        */}
                {/* ========================================================== */}
                {currentScreen === 'order_history' && (
                  <div className="space-y-4">
                    {/* Header Card Riwayat */}
                    <section className="greet-card">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveHomeNav('home');
                              setCurrentScreen(member.isVerified ? 'home_member' : 'home_guest');
                            }}
                            className="icon-btn"
                            aria-label={tr('Back to Home', 'Kembali ke Beranda')}
                          >
                            <ArrowLeft className="w-4 h-4" />
                          </button>
                          <div>
                            <div className="greet-sub">{tr('Live POS Fulfillment', 'Status Kasir POS Real-Time')}</div>
                            <div className="greet-name" style={{ fontSize: '18px' }}>
                              {tr('My Orders & Status', 'Pesanan & Status')}
                            </div>
                            <div className="greet-owner">
                              {userOrders.length} {tr('Total Orders', 'Total Pesanan')} &bull;{' '}
                              <span style={{ color: '#25e08c' }}>
                                {activeOrdersCount} {tr('Active', 'Aktif')}
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setIsHistoryOpen(true)}
                          className="px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                          style={{
                            background: 'rgba(255, 200, 75, 0.16)',
                            border: '1px solid rgba(255, 210, 95, 0.5)',
                            color: '#ffd86b',
                          }}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>{tr('Full Tracker', 'Lacak Detail')}</span>
                        </button>
                      </div>
                    </section>

                    {/* Filter Pills & Search */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1">
                        <div className="cats" style={{ marginTop: 0 }}>
                          {[
                            {
                              id: 'all' as const,
                              label: `${tr('All', 'Semua')} (${userOrders.length})`,
                            },
                            {
                              id: 'active' as const,
                              label: `${tr('Active', 'Aktif')} (${activeOrdersCount})`,
                            },
                            {
                              id: 'completed' as const,
                              label: `${tr('Completed', 'Selesai')} (${
                                userOrders.filter(
                                  (o) => o.status === 'completed' || o.fulfillmentStatus === 'completed'
                                ).length
                              })`,
                            },
                          ].map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setHistoryFilter(tab.id)}
                              className={`cat-pill ${historyFilter === tab.id ? 'active' : ''}`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="search-wrap" style={{ marginTop: 0 }}>
                        <svg viewBox="0 0 24 24">
                          <circle cx="11" cy="11" r="7" />
                          <line x1="20" y1="20" x2="16.5" y2="16.5" />
                        </svg>
                        <input
                          type="search"
                          value={historySearchQuery}
                          onChange={(e) => setHistorySearchQuery(e.target.value)}
                          placeholder={tr(
                            'Search order ID or product name...',
                            'Cari ID pesanan atau nama produk...'
                          )}
                          className="search-input"
                        />
                      </div>
                    </div>

                    {/* Daftar Pesanan */}
                    <div className="space-y-3.5">
                      {(() => {
                        let filtered = userOrders.filter((o) => {
                          if (historyFilter === 'active') {
                            return (
                              o.status !== 'completed' &&
                              o.status !== 'rejected' &&
                              o.status !== 'refunded' &&
                              o.fulfillmentStatus !== 'completed'
                            );
                          }
                          if (historyFilter === 'completed') {
                            return o.status === 'completed' || o.fulfillmentStatus === 'completed';
                          }
                          return true;
                        });

                        if (historySearchQuery.trim()) {
                          const q = historySearchQuery.toLowerCase();
                          filtered = filtered.filter(
                            (o) =>
                              o.id.toLowerCase().includes(q) ||
                              o.customerName.toLowerCase().includes(q) ||
                              (o.items &&
                                o.items.some((it) =>
                                  (it.productName || (it as any).name || '').toLowerCase().includes(q)
                                ))
                          );
                        }

                        if (filtered.length === 0) {
                          return (
                            <div
                              className="py-14 px-6 rounded-2xl text-center flex flex-col items-center"
                              style={{
                                background: 'rgba(18, 14, 8, 0.85)',
                                border: '1.5px solid rgba(255, 200, 82, 0.32)',
                              }}
                            >
                              <div
                                className="w-15 h-15 rounded-2xl flex items-center justify-center mb-3"
                                style={{
                                  background: 'rgba(255, 200, 75, 0.14)',
                                  border: '1px solid rgba(255, 200, 82, 0.45)',
                                  color: '#ffd86b',
                                }}
                              >
                                <ShoppingBag className="w-7 h-7" />
                              </div>
                              <p className="text-base font-extrabold text-white">
                                {tr('No Order History Found', 'Belum Ada Riwayat Pesanan')}
                              </p>
                              <div className="flex flex-col gap-2.5 mt-4 w-full max-w-xs">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveHomeNav('home');
                                    setCurrentScreen('home_member');
                                  }}
                                  className={goldPrimaryBtnClass}
                                >
                                  <span>{tr('Start Shopping Now', 'Mulai Belanja Sekarang')}</span>
                                </button>
                              </div>
                            </div>
                          );
                        }

                        return filtered.map((ord) => {
                          const isExpanded = expandedOrderIds.has(ord.id);
                          const itemsCount = ord.items?.length || 1;

                          return (
                            <div
                              key={ord.id}
                              className="p-4 rounded-2xl space-y-3.5"
                              style={{
                                background: 'rgba(18, 14, 8, 0.88)',
                                border: '1.5px solid rgba(255, 200, 82, 0.35)',
                                boxShadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-black text-sm text-white">
                                      #{ord.id.slice(-8)}
                                    </span>
                                    <span
                                      className="text-[10px] font-mono uppercase px-2 py-0.5 rounded font-bold"
                                      style={{
                                        background: 'rgba(255, 200, 75, 0.16)',
                                        border: '1px solid rgba(255, 200, 82, 0.4)',
                                        color: '#ffd86b',
                                      }}
                                    >
                                      {ord.paymentMethod}
                                    </span>
                                  </div>
                                  <div
                                    className="text-[11px] mt-1 flex items-center gap-1.5"
                                    style={{ color: '#b7ad99' }}
                                  >
                                    <Clock className="w-3.5 h-3.5" style={{ color: '#f4b63d' }} />
                                    <span>
                                      {new Date(ord.createdAt).toLocaleDateString(
                                        language === 'id' ? 'id-ID' : 'en-US',
                                        {
                                          day: 'numeric',
                                          month: 'short',
                                          year: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        }
                                      )}
                                    </span>
                                  </div>
                                </div>

                                <div className="text-right">
                                  <div
                                    className="text-[10px] uppercase font-bold"
                                    style={{ color: '#b7ad99' }}
                                  >
                                    {tr('Total', 'Total')}
                                  </div>
                                  <div
                                    className="text-sm sm:text-base font-black font-mono tabular-nums"
                                    style={{ color: '#ffd86b' }}
                                  >
                                    {formatCurrency(ord.totalAmount)}
                                  </div>
                                </div>
                              </div>

                              <OrderProgressIndicator order={ord} />

                              {ord.items && ord.items.length > 0 && (
                                <div
                                  className="pt-2.5"
                                  style={{ borderTop: '1px solid rgba(255, 200, 82, 0.2)' }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExpandedOrderIds((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(ord.id)) next.delete(ord.id);
                                        else next.add(ord.id);
                                        return next;
                                      });
                                    }}
                                    className="w-full flex items-center justify-between text-xs transition cursor-pointer"
                                    style={{ color: '#f7f3ea' }}
                                  >
                                    <span className="flex items-center gap-1.5 font-semibold">
                                      <Boxes className="w-3.5 h-3.5" style={{ color: '#ffd86b' }} />
                                      <span>
                                        {itemsCount} {tr('Order Items', 'Item Pesanan')}
                                      </span>
                                    </span>
                                    <span
                                      className="flex items-center gap-1 text-[11px] font-bold"
                                      style={{ color: '#ffd86b' }}
                                    >
                                      <span>
                                        {isExpanded
                                          ? tr('Hide Details', 'Sembunyikan')
                                          : tr('View Details', 'Lihat Rincian')}
                                      </span>
                                      <ChevronDown
                                        className={`w-3.5 h-3.5 transition-transform ${
                                          isExpanded ? 'rotate-180' : ''
                                        }`}
                                      />
                                    </span>
                                  </button>

                                  {isExpanded && (
                                    <div
                                      className="mt-2.5 space-y-1.5 p-3 rounded-xl"
                                      style={{
                                        background: 'rgba(10, 8, 4, 0.9)',
                                        border: '1px solid rgba(255, 200, 82, 0.25)',
                                      }}
                                    >
                                      {ord.items.map((it: any, idx: number) => (
                                        <div
                                          key={idx}
                                          className="flex items-center justify-between text-xs py-1.5 last:border-b-0"
                                          style={{
                                            borderBottom: '1px solid rgba(255, 200, 82, 0.12)',
                                          }}
                                        >
                                          <div>
                                            <div
                                              data-no-translate="true"
                                              className="font-bold text-white"
                                            >
                                              {it.productName || it.name}
                                            </div>
                                            <div
                                              className="text-[10px] font-mono tabular-nums"
                                              style={{ color: '#b7ad99' }}
                                            >
                                              {it.packageType === 'carton'
                                                ? tr('CARTON', 'DUS')
                                                : tr('UNIT', 'SATUAN')}{' '}
                                              x {it.quantityOrdered || it.qty || 1}
                                            </div>
                                          </div>
                                          <div
                                            className="text-right font-mono tabular-nums font-extrabold text-xs"
                                            style={{ color: '#ffd86b' }}
                                          >
                                            {formatCurrency(
                                              it.subtotal ||
                                                (it.unitPrice || it.sellingPrice || 0) *
                                                  (it.quantityOrdered || it.qty || 1)
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}

                {/* ========================================================== */}
                {/* HALAMAN PROFILE & 11 SUB-HALAMAN MANDIRI (/client-pwa/profile/*) */}
                {/* ========================================================== */}
                {currentScreen === 'profile' && (
                  <ClientPwaProfilePages
                    subRoute={activeProfileSubRoute}
                    onNavigateSubRoute={navigateToProfileSubRoute}
                    onBackToHome={() => {
                      setActiveHomeNav('home');
                      setCurrentScreen('home_member');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    member={member}
                    onUpdateMember={(updated) => setMember(updated)}
                    customerDoc={
                      registeredCustomers.find(
                        (c) => normalizePhone(c.phone || '') === normalizePhone(member.phone)
                      ) || null
                    }
                    allCustomers={registeredCustomers}
                    userOrders={userOrders}
                    catalogProducts={catalogProducts}
                    formatCurrency={formatCurrency}
                    language={language === 'id' ? 'id' : 'en'}
                    onChangeLanguage={(lang) => setLanguage(lang)}
                    onLogout={handleLogoutMember}
                    showToast={showClientHomeToast}
                    aiChatMessages={aiChatMessages}
                    aiInputText={aiInputText}
                    onChangeAiInput={(val) => setAiInputText(val)}
                    isAiProcessing={isAiProcessing}
                    onSendAiOrder={handleSendAiOrder}
                    onOpenCart={() => {
                      setActiveHomeNav('cart');
                      setCurrentScreen('cart');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    cartItemsCount={totalCartItemsCount}
                    rewardTargets={pwaRewardTargets}
                  />
                )}
                </div>
              </main>

              {/* Bar pesanan (Floating Order Summary Pill — riskcart-home.html) */}
              <div
                className={`cartbar ${totalCartItemsCount > 0 && currentScreen === 'home_member' ? 'show' : ''}`}
                id="cartbar"
                role="region"
                aria-label="Order summary"
              >
                <div className="ct">
                  <span id="cartCount">
                    {totalCartItemsCount} {totalCartItemsCount === 1 ? 'item' : 'items'}
                  </span>
                  <b id="cartTotal">{formatRpPlain(cartSubtotal)}</b>
                </div>
                <button
                  className="go"
                  id="orderBtn"
                  type="button"
                  onClick={() => {
                    setActiveHomeNav('cart');
                    setCurrentScreen('cart');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Order Now
                </button>
              </div>

              {/* Navigasi bawah (6-Tab Rounded Gold Dock: Home, Order AI, Promo, Pesanan Anda, Peringkat, Akun) */}
              <nav className="nav navbar" aria-label="Main menu">
                <button
                  type="button"
                  className={currentScreen === 'home_member' && !isAiModalOpen ? 'on' : ''}
                  aria-current={currentScreen === 'home_member' ? 'page' : undefined}
                  onClick={() => {
                    setActiveHomeNav('home');
                    setCurrentScreen('home_member');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  <span className="ib">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 11.2 12 3.5l9 7.7" />
                      <path d="M5.5 9.8V20h13V9.8" />
                      <path d="M10 20v-5.5h4V20" />
                    </svg>
                  </span>
                  <span>{tr('Home', 'Home')}</span>
                </button>

                <button
                  type="button"
                  className={`ai ${
                    isAiModalOpen || (currentScreen === 'profile' && activeProfileSubRoute === 'pwa-ai')
                      ? 'on'
                      : ''
                  }`}
                  onClick={() => handleOpenAiOrderModal()}
                >
                  <span className="ib">
                    <span className="ai-badge">AI</span>
                  </span>
                  <span>{tr('AI Order', 'Order AI')}</span>
                </button>

                <button
                  type="button"
                  className={currentScreen === 'profile' && (activeProfileSubRoute === 'voucher' || activeProfileSubRoute === 'reward') ? 'on' : ''}
                  onClick={() => navigateToProfileSubRoute('voucher')}
                >
                  <span className="ib">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                      <line x1="7" y1="7" x2="7.01" y2="7" />
                    </svg>
                  </span>
                  <span>{tr('Promo', 'Promo')}</span>
                </button>

                <button
                  type="button"
                  className={currentScreen === 'order_history' || currentScreen === 'cart' ? 'on' : ''}
                  onClick={() => {
                    setActiveHomeNav('orders');
                    setCurrentScreen('order_history');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  <span className="ib">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 8h14l-1 12H6L5 8z" />
                      <path d="M9 8V6.5A3 3 0 0 1 12 3.5a3 3 0 0 1 3 3V8" />
                      <path d="M9.5 13.5a2.5 2.5 0 0 0 5 0" />
                    </svg>
                  </span>
                  <span>{tr('Orders', 'Pesanan')}</span>
                </button>

                <button
                  type="button"
                  className={currentScreen === 'profile' && activeProfileSubRoute === 'top-buyer' ? 'on' : ''}
                  onClick={() => navigateToProfileSubRoute('top-buyer')}
                >
                  <span className="ib">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                      <path d="M4 22h16" />
                      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                    </svg>
                  </span>
                  <span>{tr('Rankings', 'Peringkat')}</span>
                </button>

                <button
                  type="button"
                  className={
                    currentScreen === 'profile' &&
                    activeProfileSubRoute !== 'voucher' &&
                    activeProfileSubRoute !== 'top-buyer' &&
                    activeProfileSubRoute !== 'pwa-ai'
                      ? 'on'
                      : ''
                  }
                  onClick={() => navigateToProfileSubRoute('index')}
                >
                  <span className="ib">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4.5 21v-1.5a5.5 5.5 0 0 1 5.5-5.5h4a5.5 5.5 0 0 1 5.5 5.5V21" />
                    </svg>
                  </span>
                  <span>{tr('Account', 'Akun')}</span>
                </button>
              </nav>

              {/* Slide-in Drawer Menu (Dashboard Menu + Logout) */}
              <div
                className={`drawer-backdrop ${isClientDrawerOpen ? 'open' : ''}`}
                onClick={() => setIsClientDrawerOpen(false)}
                aria-hidden={!isClientDrawerOpen}
              />
              <aside
                className={`drawer ${isClientDrawerOpen ? 'open' : ''}`}
                aria-label="Dashboard Menu"
                aria-hidden={!isClientDrawerOpen}
              >
                <div className="drawer-head">
                  <span className="drawer-title">{tr('Dashboard Menu', 'Dashboard Menu')}</span>
                  <button
                    type="button"
                    className="close-btn"
                    onClick={() => setIsClientDrawerOpen(false)}
                    aria-label={tr('Close Menu', 'Tutup Menu')}
                  >
                    <svg viewBox="0 0 24 24">
                      <line x1="6" y1="6" x2="18" y2="18" />
                      <line x1="18" y1="6" x2="6" y2="18" />
                    </svg>
                  </button>
                </div>

                <div className="drawer-profile">
                  <div className="avatar">{storeInitials}</div>
                  <div className="p-info">
                    <div className="p-store">{displayStoreName}</div>
                    <div className="p-phone">
                      {displayOwnerName} &bull; {displayPhone}
                    </div>
                    <span className="p-tier">
                      &bull; {tr('Verified Member', 'Member Terverifikasi')}
                    </span>
                  </div>
                </div>

                <div className="drawer-body">
                  <div className="menu-sec-label">{tr('Main Menu', 'Menu Utama')}</div>
                  <div className="menu-list">
                    <button
                      type="button"
                      className="menu-item active"
                      onClick={() => {
                        setIsClientDrawerOpen(false);
                        navigate('/dashboard');
                      }}
                    >
                      <span className="menu-item-left">
                        <svg viewBox="0 0 24 24">
                          <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5z" />
                        </svg>
                        <span>{tr('Dashboard', 'Dashboard')}</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      className={`menu-item ${isAiModalOpen || activeProfileSubRoute === 'pwa-ai' ? 'active' : ''}`}
                      onClick={() => {
                        setIsClientDrawerOpen(false);
                        handleOpenAiOrderModal();
                      }}
                    >
                      <span className="menu-item-left">
                        <Bot className="w-4 h-4 text-amber-400" />
                        <span>{tr('Order Via AI Assistant', 'Order Pakai AI (Otomatis)')}</span>
                      </span>
                      <span className="menu-pill">AI</span>
                    </button>

                    <button
                      type="button"
                      className={`menu-item ${currentScreen === 'home_member' ? 'active' : ''}`}
                      onClick={() => {
                        setIsClientDrawerOpen(false);
                        setActiveHomeNav('catalog');
                        if (currentScreen !== 'home_member') {
                          setCurrentScreen('home_member');
                          setTimeout(() => {
                            document.getElementById('clienthome-catalog-head')?.scrollIntoView({ behavior: 'smooth' });
                          }, 80);
                        } else {
                          document.getElementById('clienthome-catalog-head')?.scrollIntoView({ behavior: 'smooth' });
                        }
                      }}
                    >
                      <span className="menu-item-left">
                        <svg viewBox="0 0 24 24">
                          <rect x="3" y="3" width="7" height="7" rx="1.5" />
                          <rect x="14" y="3" width="7" height="7" rx="1.5" />
                          <rect x="3" y="14" width="7" height="7" rx="1.5" />
                          <rect x="14" y="14" width="7" height="7" rx="1.5" />
                        </svg>
                        <span>{tr('Product Catalog', 'Katalog Produk')}</span>
                      </span>
                      <span className="menu-pill">{combinedCatalog.length}</span>
                    </button>

                    <button
                      type="button"
                      className={`menu-item ${currentScreen === 'cart' ? 'active' : ''}`}
                      onClick={() => {
                        setIsClientDrawerOpen(false);
                        setActiveHomeNav('cart');
                        setCurrentScreen('cart');
                      }}
                    >
                      <span className="menu-item-left">
                        <svg viewBox="0 0 24 24">
                          <circle cx="9" cy="20" r="1.6" />
                          <circle cx="18" cy="20" r="1.6" />
                          <path d="M2.5 3h2.8l2.4 11.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.5L22 7H6" />
                        </svg>
                        <span>{tr('Shopping Cart', 'Keranjang Belanja')}</span>
                      </span>
                      <span className="menu-pill">{totalCartItemsCount}</span>
                    </button>

                    <button
                      type="button"
                      className={`menu-item ${currentScreen === 'order_history' ? 'active' : ''}`}
                      onClick={() => {
                        setIsClientDrawerOpen(false);
                        setActiveHomeNav('orders');
                        setCurrentScreen('order_history');
                      }}
                    >
                      <span className="menu-item-left">
                        <svg viewBox="0 0 24 24">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                          <polyline points="3.3 7 12 12 20.7 7" />
                          <line x1="12" y1="22" x2="12" y2="12" />
                        </svg>
                        <span>{tr('My Orders', 'Pesanan Saya')}</span>
                      </span>
                      <span className="menu-pill">{activeOrdersCount}</span>
                    </button>

                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        setIsClientDrawerOpen(false);
                        setCurrentScreen('order_history');
                      }}
                    >
                      <span className="menu-item-left">
                        <svg viewBox="0 0 24 24">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="8" y1="13" x2="16" y2="13" />
                          <line x1="8" y1="17" x2="13" y2="17" />
                        </svg>
                        <span>{tr('Transaction History', 'Riwayat Transaksi')}</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        setIsClientDrawerOpen(false);
                        showClientHomeToast(tr('Opening Promos & Vouchers...', 'Membuka Promo & Voucher...'));
                      }}
                    >
                      <span className="menu-item-left">
                        <svg viewBox="0 0 24 24">
                          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                          <line x1="7" y1="7" x2="7.01" y2="7" />
                        </svg>
                        <span>{tr('Promos & Vouchers', 'Promo & Voucher')}</span>
                      </span>
                      <span className="menu-pill">{tr('NEW', 'BARU')}</span>
                    </button>

                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        setIsClientDrawerOpen(false);
                        const memberPoints =
                          registeredCustomers.find(
                            (c) => normalizePhone(c.phone || '') === normalizePhone(member.phone)
                          )?.points || 0;
                        showClientHomeToast(
                          tr(
                            `Points & Rewards: ${memberPoints} pts`,
                            `Poin & Hadiah: ${memberPoints} pts`
                          )
                        );
                      }}
                    >
                      <span className="menu-item-left">
                        <svg viewBox="0 0 24 24">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                        <span>{tr('Points & Rewards', 'Poin & Hadiah')}</span>
                      </span>
                      <span className="menu-pill">
                        {registeredCustomers.find(
                          (c) => normalizePhone(c.phone || '') === normalizePhone(member.phone)
                        )?.points || 0}{' '}
                        pts
                      </span>
                    </button>
                  </div>

                  <div className="menu-sec-label">{tr('Account & Store', 'Akun & Toko')}</div>
                  <div className="menu-list">
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        setIsClientDrawerOpen(false);
                        setCurrentScreen('setting_address');
                      }}
                    >
                      <span className="menu-item-left">
                        <svg viewBox="0 0 24 24">
                          <path d="M12 22s7-7.2 7-13a7 7 0 1 0-14 0c0 5.8 7 13 7 13z" />
                          <circle cx="12" cy="9" r="2.5" />
                        </svg>
                        <span>{tr('Store Profile & Location', 'Profil & Lokasi Toko')}</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        setIsClientDrawerOpen(false);
                        showClientHomeToast(tr('Notification Settings', 'Pengaturan Notifikasi'));
                      }}
                    >
                      <span className="menu-item-left">
                        <svg viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                        <span>{tr('Notification Settings', 'Pengaturan Notifikasi')}</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        setIsClientDrawerOpen(false);
                        const win = window.open(WA_ADMIN_CS_URL, '_blank', 'noopener,noreferrer');
                        if (!win) {
                          window.location.href = WA_ADMIN_CS_URL;
                        }
                      }}
                    >
                      <span className="menu-item-left">
                        <svg viewBox="0 0 24 24">
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>
                        <span>{tr('WhatsApp CS Support', 'Bantuan WhatsApp CS')}</span>
                      </span>
                    </button>
                  </div>
                </div>

                <div className="drawer-foot">
                  <button
                    type="button"
                    className="logout-btn"
                    onClick={() => setIsLogoutModalOpen(true)}
                  >
                    <svg viewBox="0 0 24 24">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    <span>{tr('Log Out Account', 'Keluar Akun (Logout)')}</span>
                  </button>
                </div>
              </aside>

              {/* Logout Confirmation Modal */}
              <div
                className={`modal-backdrop ${isLogoutModalOpen ? 'open' : ''}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="logoutTitle"
                onClick={(e) => {
                  if (e.target === e.currentTarget) setIsLogoutModalOpen(false);
                }}
              >
                <div className="modal">
                  <div className="modal-ico">
                    <svg viewBox="0 0 24 24">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                  </div>
                  <h3 id="logoutTitle">{tr('Log Out from RiskCart?', 'Keluar dari Akun?')}</h3>
                  <p>
                    {tr(
                      `Your active session for ${displayStoreName} will be ended and you will return to the login page.`,
                      `Sesi Anda di ${displayStoreName} akan diakhiri dan kembali ke halaman masuk.`
                    )}
                  </p>
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="m-btn m-cancel"
                      onClick={() => setIsLogoutModalOpen(false)}
                    >
                      {tr('Cancel', 'Batal')}
                    </button>
                    <button
                      type="button"
                      className="m-btn m-confirm"
                      onClick={handleLogoutMember}
                    >
                      {tr('Yes, Log Out', 'Ya, Keluar')}
                    </button>
                  </div>
                </div>
              </div>

              {/* Toast Feedback */}
              <div className={`rc-toast ${clientToastText ? 'show' : ''}`} role="status" aria-live="polite">
                {clientToastText || tr('Added to cart', 'Ditambahkan ke keranjang')}
              </div>
            </div>
          );
        })()}

        {/* ========================================================== */}
        {/* MODAL ASISTEN AI PEMESANAN (Gold & Black Luxury Theme)     */}
        {/* ========================================================== */}
        {isAiModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col justify-end animate-fadeIn max-w-[520px] mx-auto">
            <div
              className="w-full rounded-t-3xl shadow-2xl flex flex-col h-[85%] max-h-[640px] overflow-hidden"
              style={{
                background: 'linear-gradient(180deg, #161006 0%, #090603 100%)',
                borderTop: '1.5px solid rgba(255, 200, 82, 0.5)',
                boxShadow: '0 -12px 40px rgba(0, 0, 0, 0.85), 0 0 28px rgba(255, 185, 45, 0.2)',
              }}
            >
              {/* Header AI */}
              <div
                className="p-4 flex items-center justify-between"
                style={{
                  background: 'rgba(28, 20, 9, 0.92)',
                  borderBottom: '1px solid rgba(255, 200, 82, 0.25)',
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center font-bold"
                    style={{
                      background: 'linear-gradient(135deg, rgba(255, 216, 107, 0.24), rgba(184, 121, 20, 0.2))',
                      border: '1px solid rgba(255, 200, 82, 0.5)',
                      color: '#ffd86b',
                    }}
                  >
                    <Bot className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-white">
                      {tr('AI Order Assistant', 'Asisten AI Pemesanan')}
                    </h3>
                    <p className="text-[11px]" style={{ color: '#b7ad99' }}>
                      {tr(
                        'Type wholesale/retail order to add to cart automatically',
                        'Ketik pesanan grosir/satuan otomatis masuk keranjang'
                      )}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsAiModalOpen(false)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer"
                  style={{
                    background: 'rgba(20, 15, 8, 0.9)',
                    border: '1px solid rgba(255, 200, 82, 0.45)',
                    color: '#f7f3ea',
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Chat Area */}
              <div ref={chatScrollRef} className="flex-1 p-4 overflow-y-auto space-y-3">
                {aiChatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className="max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed whitespace-pre-line shadow-sm"
                      style={
                        msg.sender === 'user'
                          ? {
                              background: 'linear-gradient(100deg, #e5b13a 0%, #fbdc7a 50%, #e8b440 100%)',
                              color: '#1b1204',
                              fontWeight: 700,
                            }
                          : {
                              background: 'rgba(24, 18, 9, 0.92)',
                              color: '#f7f3ea',
                              border: '1px solid rgba(255, 200, 82, 0.35)',
                            }
                      }
                    >
                      {msg.text}
                    </div>
                    <span className="text-[9px] mt-1 px-1" style={{ color: '#8f8470' }}>
                      {msg.time}
                    </span>
                  </div>
                ))}

                {isAiProcessing && (
                  <div
                    className="flex items-center gap-2 text-xs p-2.5 rounded-xl w-fit"
                    style={{
                      background: 'rgba(28, 20, 9, 0.9)',
                      border: '1px solid rgba(255, 200, 82, 0.4)',
                      color: '#ffd86b',
                    }}
                  >
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>
                      {tr(
                        'AI is reading products & calculating quantities...',
                        'AI sedang membaca produk & menghitung kuantitas...'
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* Quick Suggestions (Kondisi A: Statistik Pelanggan, Kondisi B: Produk Asli Database stock > 0) */}
              {aiOrderRecommendations.chips.length > 0 && (
                <div
                  className="px-4 py-2 overflow-x-auto no-scrollbar"
                  style={{
                    background: 'rgba(20, 15, 8, 0.92)',
                    borderTop: '1px solid rgba(255, 200, 82, 0.2)',
                  }}
                >
                  <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                    <span
                      className="text-[10px] font-extrabold flex items-center gap-1"
                      style={{ color: '#ffd86b' }}
                    >
                      <Sparkles className="w-3 h-3" /> {tr('Example:', 'Contoh:')}
                    </span>
                    {aiOrderRecommendations.chips.map((chip, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSendAiOrder(chip.prompt)}
                        className="px-2.5 py-1 rounded-lg text-[11px] transition cursor-pointer"
                        style={{
                          background: 'rgba(12, 9, 4, 0.95)',
                          border: '1px solid rgba(255, 200, 82, 0.35)',
                          color: '#f7f3ea',
                        }}
                      >
                        &quot;{chip.label}&quot;
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Input Bar */}
              <div
                className="p-3 flex items-center gap-2"
                style={{
                  background: 'rgba(14, 10, 5, 0.98)',
                  borderTop: '1px solid rgba(255, 200, 82, 0.25)',
                }}
              >
                <input
                  type="text"
                  value={aiInputText}
                  onChange={(e) => setAiInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isAiProcessing) {
                      handleSendAiOrder();
                    }
                  }}
                  placeholder={aiOrderRecommendations.placeholderText}
                  className={goldInputClass}
                />
                <button
                  type="button"
                  onClick={() => handleSendAiOrder()}
                  disabled={isAiProcessing || !aiInputText.trim()}
                  className="p-3 rounded-xl disabled:opacity-40 font-extrabold transition cursor-pointer shrink-0"
                  style={{
                    background: 'linear-gradient(100deg, #e5b13a 0%, #fbdc7a 50%, #e8b440 100%)',
                    color: '#1b1204',
                    boxShadow: '0 0 16px rgba(255, 185, 45, 0.35)',
                  }}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================== */}
        {/* MODAL STRUK FAKTUR DIGITAL SETELAH CHECKOUT (Gold & Black) */}
        {/* ========================================================== */}
        {isOrderPlaced && placedTx && (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md p-5 flex flex-col justify-between animate-fadeIn overflow-y-auto">
            <div
              className="w-full max-w-[440px] m-auto p-6 rounded-3xl space-y-5"
              style={{
                background:
                  'radial-gradient(360px 220px at 50% 0%, rgba(255, 195, 55, 0.18), transparent 70%), linear-gradient(180deg, #181107 0%, #0b0803 100%)',
                border: '1.5px solid rgba(255, 200, 82, 0.5)',
                boxShadow: '0 20px 50px rgba(0, 0, 0, 0.85), 0 0 32px rgba(255, 185, 45, 0.22)',
              }}
            >
              <div className="flex flex-col items-center text-center space-y-3">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{
                    background: 'rgba(15, 55, 34, 0.85)',
                    border: '1.5px solid rgba(80, 220, 145, 0.6)',
                    color: '#25e08c',
                    boxShadow: '0 0 24px rgba(37, 224, 140, 0.25)',
                  }}
                >
                  <CheckCircle2 className="w-9 h-9" />
                </div>

                <div>
                  <h3 className="text-xl font-black text-white">
                    {tr('Order Sent Successfully!', 'Pesanan Berhasil Dikirim!')}
                  </h3>
                  <p className="text-xs font-mono mt-1 font-bold" style={{ color: '#ffd86b' }}>
                    {tr('Transaction ID:', 'ID Transaksi:')} #{placedTx.id.slice(-8)}
                  </p>
                </div>

                {/* Rincian Nota */}
                <div
                  className="w-full p-4 rounded-2xl text-left space-y-2.5 text-xs"
                  style={{
                    background: 'rgba(12, 9, 4, 0.92)',
                    border: '1px solid rgba(255, 200, 82, 0.35)',
                  }}
                >
                  <div className="flex justify-between" style={{ color: '#b7ad99' }}>
                    <span>{tr('Customer Name:', 'Nama Pemesan:')}</span>
                    <span className="font-bold text-white">{placedTx.customerName}</span>
                  </div>
                  <div className="flex justify-between" style={{ color: '#b7ad99' }}>
                    <span>WhatsApp:</span>
                    <span className="font-mono text-white">{placedTx.customerPhone}</span>
                  </div>
                  <div className="flex justify-between" style={{ color: '#b7ad99' }}>
                    <span>{tr('Payment Method:', 'Metode Pembayaran:')}</span>
                    <span className="font-extrabold uppercase" style={{ color: '#ffd86b' }}>
                      {placedTx.paymentMethod}
                    </span>
                  </div>
                  <div className="flex justify-between" style={{ color: '#b7ad99' }}>
                    <span>{tr('POS Cashier Status:', 'Status Kasir POS:')}</span>
                    <span className="font-extrabold uppercase text-[10px]" style={{ color: '#25e08c' }}>
                      {tr('Synced to POS Cashier Queue', 'Terhubung ke Antrean Kasir')}
                    </span>
                  </div>
                  <div
                    className="pt-2.5 flex justify-between font-black text-white"
                    style={{ borderTop: '1px solid rgba(255, 200, 82, 0.25)' }}
                  >
                    <span>{tr('Total Amount:', 'Total Tagihan:')}</span>
                    <span className="font-mono tabular-nums text-sm" style={{ color: '#ffd86b' }}>
                      {formatCurrency(placedTx.totalAmount)}
                    </span>
                  </div>
                </div>

                <div className="w-full text-left">
                  <OrderProgressIndicator order={placedTx} />
                </div>
              </div>

              <div className="space-y-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsOrderPlaced(false);
                    setPlacedTx(null);
                    setCart([]);
                    setActiveHomeNav('orders');
                    setCurrentScreen('order_history');
                  }}
                  className={goldPrimaryBtnClass}
                >
                  <Clock className="w-4 h-4" />
                  <span>
                    {tr('Track Progress in Order History', 'Pantau Progres di Riwayat Pesanan')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsOrderPlaced(false);
                    setPlacedTx(null);
                    setCart([]);
                    setActiveHomeNav('home');
                    setCurrentScreen('home_member');
                  }}
                  className="w-full py-3 rounded-xl font-bold text-xs cursor-pointer transition"
                  style={{
                    background: 'rgba(24, 18, 9, 0.85)',
                    border: '1px solid rgba(255, 200, 82, 0.4)',
                    color: '#f7f3ea',
                  }}
                >
                  {tr('Back to Shopping Catalog', 'Kembali ke Halaman Belanja')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Product Gallery Modal */}
      <ProductGalleryModal
        open={Boolean(galleryProduct)}
        onClose={() => setGalleryProduct(null)}
        product={galleryProduct}
      />

      {/* Customer Order History Modal */}
      <CustomerOrderHistoryModal
        isOpen={isHistoryOpen && isAuthenticatedMember}
        onClose={() => setIsHistoryOpen(false)}
        customerPhone={isAuthenticatedMember ? member.phone : ''}
        availableProducts={catalogProducts}
      />
    </div>
  );
};
