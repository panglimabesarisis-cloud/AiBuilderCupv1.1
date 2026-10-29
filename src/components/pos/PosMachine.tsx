import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  setDoc,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { Product, Transaction, PackageType } from '../../types';
import { ACTIVE_STORE_ID } from '../../config/store';
import { useSettingsDoc } from '../../hooks/useFirestoreData';
import { POSSettings, DEFAULT_POS_SETTINGS } from '../../types/settings';
import { INITIAL_PRODUCTS, isLegacyMockOrderOrTx, purgeLegacyMockOrdersFromFirestore } from '../../services/dataSeeder';
import { reconcileCompletedTransaction } from '../../services/stockSyncService';
import { deductProductStockInFirestore, saveProductDocToAllPaths } from '../../services/productService';
import { useAppData } from '../../context/AppDataContext';
import {
  publishRealtimeEvent,
  subscribeRealtimeEvent,
  completeTableAndKitchenOrderOnPayment,
} from '../../utils/realtimeSyncBus';
import confetti from 'canvas-confetti';
import QRCode from 'qrcode';
import { paymentGatewayApi } from '../../services/paymentGatewayClient';
import { GlobalModals } from '../common/GlobalModals';
import { ProductGalleryModal } from '../common/ProductGalleryModal';
import { VariantBreadcrumb } from '../common/VariantBreadcrumb';
import { ThemeToggleButton } from '../common/ThemeToggleButton';
import { useLanguage } from '../../context/LanguageContext';
import { useApprovalPin } from './ApprovalPinModal';
import { logAudit, dayKeyTz } from '../../services/posRuntime';
import { logRealAudit } from '../../utils/auditLogger';
import { printReceipt, kickCashDrawer } from '../../services/receiptPrinter';
import {
  evaluateProductExpiry,
  CATEGORY_EXPIRY_RULES,
  deductFefoBatches,
  getSortedFefoBatches,
} from '../../utils/expiryUtils';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  Bell,
  Moon,
  Sun,
  Calendar,
  Maximize2,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  ArrowLeft,
  User,
  ShoppingBag,
  CreditCard,
  QrCode,
  DollarSign,
  Printer,
  Receipt,
  CheckCircle,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  Clock,
  Sparkles,
  LayoutGrid,
  List,
  Flame,
  Store,
  Layers,
  Phone,
  MapPin,
  ExternalLink,
  Menu,
  X,
  Truck,
  ShoppingCart,
  CheckCircle2,
  MessageSquare,
  Key,
  Lock,
  Mail,
  Hash,
  Eye,
  EyeOff,
  RefreshCw,
  Camera,
  Image as ImageIcon,
  FileText,
} from 'lucide-react';
import { compressImage } from '../../utils/imageCompress';
import { StaffMemberItem, DEFAULT_STAFF_MEMBERS } from '../modules/StaffModule';
import {
  useStaffDivisionsAndRoles,
  formatStaffWithDivisionLabel,
  inferDivisionFromRole,
  getRoleBadgeThemeClasses,
} from '../../services/staffDivisionService';
import { useAccessControl } from '../../context/AccessControlContext';
import { PosPinGate } from './PosPinGate';
import { formatRibuanInput, parseRibuanInput } from '../../utils/money';
import { getDefaultMinStock } from '../../services/posRuntime';

interface CartLine {
  product: Product;
  packageType: PackageType;
  quantity: number;
  notes?: string;
}

const QUICK_REQUEST_CHIPS = [
  'Pedas',
  'Tidak Pedas',
  'Pedas Sedang',
  'Medium Meat',
  'Rare Meat',
  'Medium Well',
  'Well Done',
  'Dingin',
  'Suhu Ruang / Normal',
  'Es Batu Dipisah',
  'Less Ice',
  'Less Sugar',
  'Tanpa Sedotan',
  'Bungkus / Takeaway',
  'Sajikan Duluan',
];

interface PosMachineProps {
  onNavigateTab?: (tab: string) => void;
  currencyMode?: 'IDR' | 'USD';
  setCurrencyMode?: (mode: 'IDR' | 'USD') => void;
  waiterMode?: boolean;
}

const ProductThumb: React.FC<{ src?: string; alt: string }> = ({ src, alt }) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className="w-20 h-20 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.15)]">
        <Store className="w-10 h-10" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="w-full h-full object-cover object-center transition-transform duration-300 group-hover:scale-105"
      loading="lazy"
    />
  );
};

export const PosMachine: React.FC<PosMachineProps> = ({
  onNavigateTab,
  currencyMode: propCurrencyMode,
  setCurrencyMode: propSetCurrencyMode,
  waiterMode: propWaiterMode = false,
}) => {
  const isWaiterMode = useMemo(() => {
    if (propWaiterMode) return true;
    if (typeof window === 'undefined') return false;
    const p = window.location.pathname.toLowerCase();
    const q = new URLSearchParams(window.location.search);
    return p.startsWith('/waiters') || q.get('waiter') === '1';
  }, [propWaiterMode]);

  const [waiterTableInfo, setWaiterTableInfo] = useState<{
    id: string;
    tableNumber: string;
    name: string;
    visitorName: string;
  }>(() => {
    try {
      const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const qTableId = q?.get('tableId') || '';
      const qTableNumber = q?.get('tableNumber') || '';
      const rawActive = localStorage.getItem('riskcart_waiter_active_table');
      if (rawActive) {
        const parsed = JSON.parse(rawActive);
        if (!qTableId || parsed?.id === qTableId) {
          return {
            id: String(parsed?.id || qTableId || 'tbl_01'),
            tableNumber: String(parsed?.tableNumber || qTableNumber || 'M-01'),
            name: String(parsed?.name || 'Meja 01'),
            visitorName: String(parsed?.visitorName || ''),
          };
        }
      }
      const rawTables = localStorage.getItem('riskcart_restaurant_tables_v1');
      if (rawTables) {
        const list = JSON.parse(rawTables);
        if (Array.isArray(list)) {
          const found = list.find(
            (t: any) =>
              (qTableId && t.id === qTableId) ||
              (qTableNumber && t.tableNumber === qTableNumber)
          );
          if (found) {
            return {
              id: String(found.id || 'tbl_01'),
              tableNumber: String(found.tableNumber || 'M-01'),
              name: String(found.name || 'Meja 01'),
              visitorName: String(found.visitorName || ''),
            };
          }
        }
      }
      return {
        id: qTableId || 'tbl_01',
        tableNumber: qTableNumber || 'M-01',
        name: `Meja ${qTableNumber || 'M-01'}`,
        visitorName: '',
      };
    } catch {
      return { id: 'tbl_01', tableNumber: 'M-01', name: 'Meja 01', visitorName: '' };
    }
  });
  const {
    tr,
    formatCurrency,
    language,
    currencyMode: ctxCurrencyMode,
    setCurrencyMode: ctxSetCurrencyMode,
    exchangeRate,
  } = useLanguage();
  const {
    products: ctxProducts,
    addTransactionLocal,
    upsertProductLocal,
    pendingPwaOrders: ctxPendingPwaOrders,
    posSettings: ctxPosSettings,
    globalSettings: ctxGlobalSettings,
    storeSettings: ctxStoreSettings,
    paymentGatewayConfig,
  } = useAppData();
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [activeVariantGroupId, setActiveVariantGroupId] = useState<string | null>(null);
  const [selectedPackageByProduct, setSelectedPackageByProduct] = useState<
    Record<string, PackageType>
  >({});
  const [galleryProduct, setGalleryProduct] = useState<{
    name: string;
    variantLabel?: string;
    imageUrl?: string;
    galleryUrls?: string[];
  } | null>(null);

  const currencyMode = propCurrencyMode || ctxCurrencyMode;
  const setCurrencyMode = propSetCurrencyMode || ctxSetCurrencyMode;
  const activeRate = exchangeRate > 0 ? exchangeRate : 16250;

  // Cashier Cart & Calculation State (Locked in localStorage to prevent F5 refresh bypass)
  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      const saved = localStorage.getItem('riskcart_locked_cart');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });
  const [orderDate, setOrderDate] = useState<string>(() =>
    new Date().toLocaleDateString('en-CA')
  );
  const [selectedCustomer, setSelectedCustomer] = useState<string>('General Walk-in Customer');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Persist active cart to localStorage (`riskcart_locked_cart`) whenever cart changes
  useEffect(() => {
    try {
      if (cart.length > 0) {
        localStorage.setItem('riskcart_locked_cart', JSON.stringify(cart));
      }
    } catch {}
  }, [cart]);

  // Global Order Notes (Catatan Order Umum untuk Meja / Pesanan)
  const [orderNotes, setOrderNotes] = useState<string>(() => {
    try {
      return localStorage.getItem('riskcart_waiter_order_notes') || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    try {
      if (orderNotes.trim()) {
        localStorage.setItem('riskcart_waiter_order_notes', orderNotes);
      } else {
        localStorage.removeItem('riskcart_waiter_order_notes');
      }
    } catch {}
  }, [orderNotes]);

  // Popup Modal State for Item Notes & Global Order Notes
  const [notesModalState, setNotesModalState] = useState<{
    open: boolean;
    mode: 'item' | 'order';
    productId?: string;
    productName?: string;
    draftText: string;
  }>({
    open: false,
    mode: 'item',
    draftText: '',
  });

  const openItemNotesModal = (product: Product) => {
    const existingLine = cart.find((c) => c.product.id === product.id);
    setNotesModalState({
      open: true,
      mode: 'item',
      productId: product.id,
      productName: product.name,
      draftText: existingLine?.notes || '',
    });
  };

  const openOrderNotesModal = () => {
    const targetLabel = isWaiterMode
      ? `Meja ${waiterTableInfo.tableNumber}${
          waiterTableInfo.visitorName ? ` · ${waiterTableInfo.visitorName}` : ''
        }`
      : selectedCustomer || 'Pesanan Kasir POS';
    setNotesModalState({
      open: true,
      mode: 'order',
      productName: targetLabel,
      draftText: orderNotes || '',
    });
  };

  const handleSaveNotesModal = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleaned = notesModalState.draftText.trim();
    if (notesModalState.mode === 'item' && notesModalState.productId) {
      setCart((prev) =>
        prev.map((c) =>
          c.product.id === notesModalState.productId
            ? { ...c, notes: cleaned || undefined }
            : c
        )
      );
    } else if (notesModalState.mode === 'order') {
      setOrderNotes(cleaned);
    }
    setNotesModalState((prev) => ({ ...prev, open: false }));
  };

  const handleClearNotesInModal = () => {
    if (notesModalState.mode === 'item' && notesModalState.productId) {
      setCart((prev) =>
        prev.map((c) =>
          c.product.id === notesModalState.productId ? { ...c, notes: undefined } : c
        )
      );
    } else if (notesModalState.mode === 'order') {
      setOrderNotes('');
    }
    setNotesModalState((prev) => ({ ...prev, open: false, draftText: '' }));
  };

  const handleAppendQuickChip = (chip: string) => {
    setNotesModalState((prev) => {
      const current = prev.draftText.trim();
      if (!current) {
        return { ...prev, draftText: chip };
      }
      const parts = current
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const exists = parts.some((p) => p.toLowerCase() === chip.toLowerCase());
      if (exists) {
        return prev;
      }
      return { ...prev, draftText: `${current}, ${chip}` };
    });
  };

  // Pre-fill customer with waiter table / visitor name when in waiter POS mode
  useEffect(() => {
    if (!isWaiterMode) return;
    const label = waiterTableInfo.visitorName
      ? `${waiterTableInfo.visitorName} (${waiterTableInfo.tableNumber})`
      : `Meja ${waiterTableInfo.tableNumber}`;
    setSelectedCustomer((prev) =>
      !prev || prev === 'General Walk-in Customer' ? label : prev
    );
  }, [isWaiterMode, waiterTableInfo.tableNumber, waiterTableInfo.visitorName]);

  // Anti-Fraud 1: Cash Payment Blocker Modal State
  const [cashBlockModal, setCashBlockModal] = useState<{
    open: boolean;
    title: string;
    message: string;
  } | null>(null);

  // Anti-Fraud 2 & 3: Cart Cancellation Modal (`CartCancelModal`) State (PIN Owner + Reason + Camera/Gallery Photo)
  const [cartCancelRequest, setCartCancelRequest] = useState<{
    mode: 'remove_item' | 'decrease_qty' | 'clear_cart' | 'new_order';
    actionLabel: string;
    targetItem?: CartLine;
    delta?: number;
  } | null>(null);
  const [cancelOwnerPin, setCancelOwnerPin] = useState<string>('');
  const [showCancelOwnerPin, setShowCancelOwnerPin] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [cancelEvidencePhoto, setCancelEvidencePhoto] = useState<string>('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isSubmittingCancel, setIsSubmittingCancel] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const galleryFileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraFallbackInputRef = useRef<HTMLInputElement | null>(null);

  // Consumer: POS Settings merged from Firestore stores/{ACTIVE_STORE_ID}/settings/pos, settings/pos, settings/global, settings/store
  const { value: rawStorePosSettings } = useSettingsDoc<POSSettings>(
    `stores/${ACTIVE_STORE_ID}/settings/pos`,
    DEFAULT_POS_SETTINGS
  );
  const posSettings: POSSettings = useMemo(
    () => ({
      ...DEFAULT_POS_SETTINGS,
      ...rawStorePosSettings,
      ...ctxPosSettings,
      ...ctxStoreSettings,
      ...ctxGlobalSettings,
    }),
    [rawStorePosSettings, ctxPosSettings, ctxStoreSettings, ctxGlobalSettings]
  );

  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'debt' | 'cod' | 'qris' | 'edc'>('cash');
  const [cashReceivedInput, setCashReceivedInput] = useState<string>('0');
  const [calcDisplay, setCalcDisplay] = useState<string>('');
  const [sessionSeconds, setSessionSeconds] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [completedTxReceipt, setCompletedTxReceipt] = useState<any | null>(null);

  // Sender / Delivery Staff & Debt / COD extra fields
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');
  const [customerPhoneInput, setCustomerPhoneInput] = useState<string>('');
  const [customerAddressInput, setCustomerAddressInput] = useState<string>('');
  const [debtDueDate, setDebtDueDate] = useState<string>(
    () => new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  );
  const [storeCustomers, setStoreCustomers] = useState<any[]>([]);

  // Real-time DOKU Payment Gateway status (`dokuEnabled`) from Firestore `settings/payment_gateway` + localStorage cache
  const [dokuEnabled, setDokuEnabled] = useState<boolean>(() => {
    try {
      const cached = localStorage.getItem('riskcart_doku_enabled');
      if (cached !== null) return cached === 'true';
      const rawCfg = localStorage.getItem('riskcart_doku_config');
      if (rawCfg) {
        const parsed = JSON.parse(rawCfg);
        if (typeof parsed.dokuEnabled === 'boolean') return parsed.dokuEnabled;
      }
    } catch {}
    return true;
  });
  const [dokuGatewayCreds, setDokuGatewayCreds] = useState<{
    clientId: string;
    sharedKey: string;
    mode: 'sandbox' | 'production';
  }>({
    clientId: '',
    sharedKey: '',
    mode: 'sandbox',
  });
  const [activeQrisSession, setActiveQrisSession] = useState<{
    transactionId: string;
    invoiceNumber: string;
    paymentId: string;
    customerName: string;
    amount: number;
    mdrFee: number;
    netAmount: number;
    qrString: string;
    qrCodeDataUrl: string;
    mode: string;
    status: 'PENDING' | 'LUNAS';
    receiptPayload: any;
  } | null>(null);
  const [qrisSecondsLeft, setQrisSecondsLeft] = useState<number>(300);
  const [isConfirmingQris, setIsConfirmingQris] = useState<boolean>(false);

  useEffect(() => {
    const syncFromLocal = () => {
      try {
        const cached = localStorage.getItem('riskcart_doku_enabled');
        if (cached !== null) setDokuEnabled(cached === 'true');
      } catch {}
    };
    window.addEventListener('riskcart-doku-config-updated', syncFromLocal);
    const unsub = onSnapshot(doc(db, 'settings', 'payment_gateway'), (snap) => {
      if (snap.exists()) {
        const d = snap.data() as any;
        const enabled =
          typeof d.dokuEnabled === 'boolean'
            ? d.dokuEnabled
            : typeof d.doku?.dokuEnabled === 'boolean'
            ? d.doku.dokuEnabled
            : typeof d.doku?.enabled === 'boolean'
            ? d.doku.enabled
            : true;
        setDokuEnabled(enabled);
        setDokuGatewayCreds({
          clientId: String(d.clientId ?? d.doku?.clientId ?? ''),
          sharedKey: String(
            d.secretKey ?? d.sharedKey ?? d.doku?.sharedKey ?? d.doku?.secretKey ?? ''
          ),
          mode:
            String(d.environment ?? d.doku?.mode ?? 'sandbox').toLowerCase() === 'production'
              ? 'production'
              : 'sandbox',
        });
        try {
          localStorage.setItem('riskcart_doku_enabled', String(enabled));
        } catch {}
      }
    });
    const unsubGatewaysPlural = onSnapshot(doc(db, 'settings', 'payment_gateways'), (snap) => {
      if (snap.exists()) {
        const d = snap.data() as any;
        const activeGw = String(d.activeGateway || 'doku').toLowerCase();
        const activeCfg = d[activeGw] || {};
        const anyEnabled =
          Boolean(activeCfg.enabled) ||
          Boolean(d.midtrans?.enabled) ||
          Boolean(d.xendit?.enabled) ||
          Boolean(d.tripay?.enabled) ||
          Boolean(d.doku?.enabled);
        setDokuEnabled(anyEnabled);
        setDokuGatewayCreds((prev) => ({
          ...prev,
          mode: activeCfg.isSandbox === false ? 'production' : 'sandbox',
        }));
      }
    });
    return () => {
      window.removeEventListener('riskcart-doku-config-updated', syncFromLocal);
      unsub();
      unsubGatewaysPlural();
    };
  }, []);

  // Automatically reset paymentMethod to 'cash' if dokuEnabled is turned OFF while on 'qris'
  useEffect(() => {
    if (!dokuEnabled && paymentMethod === 'qris') {
      setPaymentMethod('cash');
    }
  }, [dokuEnabled, paymentMethod]);

  // EDC dimatikan di Pengaturan > Pembayaran -> kembali ke Tunai
  useEffect(() => {
    if (paymentMethod === 'edc' && posSettings?.acceptEdc === false) setPaymentMethod('cash');
    if (paymentMethod === 'qris' && posSettings?.acceptQris === false) setPaymentMethod('cash');
  }, [paymentMethod, posSettings?.acceptEdc, posSettings?.acceptQris]);

  // Sync payment method when accepted payment methods change in settings
  useEffect(() => {
    if (!posSettings) return;
    const canCash = posSettings.acceptCash !== false;
    const canDebt = posSettings.acceptKasbon !== false;
    const canCod = posSettings.acceptCod !== false;
    const canQris = Boolean(dokuEnabled);

    if (paymentMethod === 'cash' && !canCash) {
      if (canQris) setPaymentMethod('qris');
      else if (canDebt) setPaymentMethod('debt');
      else if (canCod) setPaymentMethod('cod');
    } else if (paymentMethod === 'qris' && !canQris) {
      if (canCash) setPaymentMethod('cash');
      else if (canDebt) setPaymentMethod('debt');
      else if (canCod) setPaymentMethod('cod');
    } else if (paymentMethod === 'debt' && !canDebt) {
      if (canCash) setPaymentMethod('cash');
      else if (canQris) setPaymentMethod('qris');
      else if (canCod) setPaymentMethod('cod');
    } else if (paymentMethod === 'cod' && !canCod) {
      if (canCash) setPaymentMethod('cash');
      else if (canQris) setPaymentMethod('qris');
      else if (canDebt) setPaymentMethod('debt');
    }
  }, [dokuEnabled, posSettings?.acceptCash, posSettings?.acceptKasbon, posSettings?.acceptEdc, posSettings?.acceptCod, paymentMethod]);

  // Incoming PWA Orders Real-Time listener & state (strictly from Firestore `orders` & `transactions` with pending status, zero mock data)
  const [incomingPwaOrder, setIncomingPwaOrder] = useState<Transaction | null>(null);
  const [pwaOrdersQueue, setPwaOrdersQueue] = useState<Transaction[]>([]);
  const [newPwaOrderNotification, setNewPwaOrderNotification] = useState<string | null>(null);
  const [selectedPwaOrderModal, setSelectedPwaOrderModal] = useState<Transaction | null>(null);
  const [showPwaQueueModal, setShowPwaQueueModal] = useState<boolean>(false);
  const [activeFulfillingPwaOrder, setActiveFulfillingPwaOrder] = useState<Transaction | null>(null);
  const lastPwaOrderIdRef = useRef<string | null>(null);


  // Active Interactive Sidebar Modal State
  const [activeModal, setActiveModal] = useState<
    'customers' | 'shift' | 'orders' | 'scanner' | 'chat' | 'help' | 'account' | 'delivery' | null
  >(null);
  const [showExpiryAlertModal, setShowExpiryAlertModal] = useState<boolean>(false);
  const [expiryModalTab, setExpiryModalTab] = useState<'near_expiry' | 'all_products'>('near_expiry');

  // Active Cashier & Staff from Firestore collection ('staff') with 6-Digit PIN Authentication + Division Roster
  const { roster: divisionRoster, serviceStaffOnDuty } = useStaffDivisionsAndRoles();
  const [staffList, setStaffList] = useState<StaffMemberItem[]>(DEFAULT_STAFF_MEMBERS);
  const [activeCashier, setActiveCashier] = useState<StaffMemberItem>(() => {
    try {
      const saved = localStorage.getItem('riskcart_active_cashier');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.name && /muhammad\s+irfan/i.test(String(parsed.name))) {
          parsed.name = String(parsed.name).replace(/muhammad\s+irfan/gi, 'Dede Fajar Kurniawan');
          localStorage.setItem('riskcart_active_cashier', JSON.stringify(parsed));
        }
        return parsed;
      }
    } catch {}
    return (
      DEFAULT_STAFF_MEMBERS[0] || {
        id: 'staff_001',
        name: 'Dede Fajar Kurniawan',
        email: 'dede.kasir@riskcart.com',
        pin: '123456',
        role: 'Head Cashier',
        divisionId: 'div_cashier',
        divisionName: 'Divisi Front Office / Kasir',
        outlet: 'Cabang Utama (Pusat)',
        phone: '+62 812-3456-7890',
        shift: 'Pagi (07:30 - 15:00)',
      }
    );
  });

  // Merge divisionRoster into staffList whenever divisionRoster updates
  useEffect(() => {
    if (!divisionRoster || divisionRoster.length === 0) return;
    setStaffList((prev) => {
      const map = new Map<string, StaffMemberItem>();
      prev.forEach((s) => {
        if (s.id) map.set(s.id, s);
      });
      divisionRoster.forEach((d) => {
        if (d.id && d.status !== 'inactive') {
          const existing = map.get(d.id);
          map.set(d.id, {
            ...(existing || {}),
            id: d.id,
            name: d.name,
            email: d.email || existing?.email || '',
            pin: d.pin || existing?.pin || '123456',
            role: d.role,
            divisionId: d.divisionId,
            divisionName: d.divisionName,
            station: d.station,
            outlet: d.outlet || existing?.outlet || 'Cabang Utama (Pusat)',
            phone: d.phone || existing?.phone || '-',
            shift: d.shiftTime || existing?.shift || 'Shift Pagi (08:00 - 16:00)',
            status: d.status || 'active',
          });
        }
      });
      return Array.from(map.values());
    });
  }, [divisionRoster]);

  // Selected Waiter Staff in Waiter POS mode (`/waiters/pos`)
  const waiterStaffOptions = useMemo(() => {
    if (serviceStaffOnDuty.length > 0) return serviceStaffOnDuty;
    return divisionRoster.filter((s) => s.status !== 'inactive');
  }, [serviceStaffOnDuty, divisionRoster]);

  const [selectedWaiterStaffId, setSelectedWaiterStaffId] = useState<string>(() => {
    try {
      return localStorage.getItem('riskcart_active_waiter_staff_id_v1') || '';
    } catch {
      return '';
    }
  });

  const activeWaiterForOrder = useMemo(() => {
    if (selectedWaiterStaffId) {
      const found =
        waiterStaffOptions.find((w) => w.id === selectedWaiterStaffId) ||
        divisionRoster.find((w) => w.id === selectedWaiterStaffId);
      if (found) return found;
    }
    const defaultWaiter = waiterStaffOptions.find(
      (w) =>
        w.divisionId === 'div_service' ||
        String(w.role || '').toLowerCase().includes('waiter') ||
        String(w.role || '').toLowerCase().includes('captain')
    );
    if (defaultWaiter) return defaultWaiter;
    const inf = inferDivisionFromRole(activeCashier?.role || 'Waiter / Server');
    return {
      id: activeCashier?.id || 'waiter_01',
      name: activeCashier?.name || 'Waiter POS',
      role: activeCashier?.role || 'Waiter / Server',
      divisionId: activeCashier?.divisionId || inf.divisionId,
      divisionName: activeCashier?.divisionName || inf.divisionName,
    };
  }, [selectedWaiterStaffId, waiterStaffOptions, divisionRoster, activeCashier]);

  const {
    activeRoleId: ctxActiveRoleId,
    activeCashier: ctxActiveCashier,
    posPinVerified,
    lockPosSession,
    hasPermission,
    getActiveOperationalLimits,
  } = useAccessControl();
  const activeGatewayLabel = String(paymentGatewayConfig?.activeGateway || 'doku').toUpperCase();

  // ===== Integrasi Pengaturan POS (Umum / Pembayaran / Global / Hak Akses / Printer) =====
  const { requestApproval, approvalModal } = useApprovalPin();
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [discountApprovedBy, setDiscountApprovedBy] = useState<string | null>(null);
  const [edcApprovalCode, setEdcApprovalCode] = useState<string>('');
  const [shiftCashTotal, setShiftCashTotal] = useState<number>(0);
  const [drawerToast, setDrawerToast] = useState<string | null>(null);

  // Semua role (Owner, Admin, Manager, Supervisor, Cashier) melewati alur PIN & Mulai Shift Baru yang sama persis
  const isCashierUser = true;

  const [localPosPinVerified, setLocalPosPinVerified] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('riskcart_pos_pin_verified') === 'true';
    } catch {
      return false;
    }
  });

  const [hasOpenShiftInSession, setHasOpenShiftInSession] = useState<boolean>(() => {
    try {
      const saved =
        localStorage.getItem('riskcart_active_shift') ||
        localStorage.getItem('riskcart_active_open_shift') ||
        localStorage.getItem('activeShift');
      if (saved) {
        const parsed = JSON.parse(saved);
        const st = String(parsed?.status || '').toLowerCase().trim();
        if (st === 'open' || st === 'aktif') return true;
      }
      return sessionStorage.getItem('riskcart_shift_opened_session') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onShiftOpened = (ev: Event) => {
      const custom = ev as CustomEvent<any>;
      if (custom?.detail?.id) {
        setActiveShiftId(custom.detail.id);
        setActiveShift(custom.detail);
      }
      setHasOpenShiftInSession(true);
      setLocalPosPinVerified(true);
    };
    const onShiftClosed = () => {
      setActiveShift(null);
      setHasOpenShiftInSession(false);
      setLocalPosPinVerified(false);
    };
    const onShiftStatusChanged = () => {
      try {
        const saved =
          localStorage.getItem('riskcart_active_shift') ||
          localStorage.getItem('riskcart_active_open_shift') ||
          localStorage.getItem('activeShift');
        if (saved) {
          const parsed = JSON.parse(saved);
          const st = String(parsed?.status || '').toLowerCase().trim();
          if (st === 'open' || st === 'aktif') {
            if (parsed.id) setActiveShiftId(parsed.id);
            setActiveShift(parsed);
            setHasOpenShiftInSession(true);
            return;
          }
        }
        setActiveShift(null);
        setHasOpenShiftInSession(false);
        setLocalPosPinVerified(false);
      } catch {}
    };
    const onPinVerified = () => {
      setLocalPosPinVerified(true);
    };

    window.addEventListener('riskcart:shift-opened', onShiftOpened);
    window.addEventListener('riskcart:shift-closed', onShiftClosed);
    window.addEventListener('shift-status-changed', onShiftStatusChanged);
    window.addEventListener('riskcart:pos-pin-verified', onPinVerified);
    return () => {
      window.removeEventListener('riskcart:shift-opened', onShiftOpened);
      window.removeEventListener('riskcart:shift-closed', onShiftClosed);
      window.removeEventListener('shift-status-changed', onShiftStatusChanged);
      window.removeEventListener('riskcart:pos-pin-verified', onPinVerified);
    };
  }, []);

  const [showCashierPinModal, setShowCashierPinModal] = useState(false);
  const [selectedStaffToLogin, setSelectedStaffToLogin] = useState<StaffMemberItem | null>(null);
  const [inputCashierPin, setInputCashierPin] = useState('');
  const [showInputPin, setShowInputPin] = useState(false);
  const [pinAuthError, setPinAuthError] = useState<string | null>(null);
  const [cashierToast, setCashierToast] = useState<string | null>(null);
  const [activeShiftId, setActiveShiftId] = useState<string>(
    () => `SHF-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-01`
  );
  const [activeShift, setActiveShift] = useState<any | null>(null);

  // Real-time synchronization of staff directory (root `staff` + `stores/store_001/staff`), customers, and active shift
  useEffect(() => {
    let rootStaffDocs: StaffMemberItem[] = [];
    let storeStaffDocs: StaffMemberItem[] = [];

    const mergeAndPublishStaff = () => {
      const map = new Map<string, StaffMemberItem>();
      DEFAULT_STAFF_MEMBERS.forEach((d) => {
        if (d.id) map.set(d.id, d);
      });
      storeStaffDocs.forEach((s) => {
        if (s.id) map.set(s.id, { ...(map.get(s.id) || {}), ...s });
      });
      rootStaffDocs.forEach((s) => {
        if (s.id) map.set(s.id, { ...(map.get(s.id) || {}), ...s });
      });
      const merged = Array.from(map.values()).filter((s) => s.status !== 'inactive');
      if (merged.length > 0) {
        setStaffList(merged);
        setActiveCashier((current) => {
          const matched = merged.find((s) => s.id === current.id || s.email === current.email);
          return matched || current;
        });
      }
    };

    const unsubStaff = onSnapshot(
      collection(db, 'staff'),
      (snap) => {
        rootStaffDocs = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));
        mergeAndPublishStaff();
      },
      (err) => {
        console.warn('Firestore staff onSnapshot warning:', err);
      }
    );

    const unsubStoreStaff = onSnapshot(
      collection(db, 'stores', ACTIVE_STORE_ID, 'staff'),
      (snap) => {
        storeStaffDocs = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));
        mergeAndPublishStaff();
      },
      () => {}
    );

    const unsubCustomers = onSnapshot(
      collection(db, 'stores', ACTIVE_STORE_ID, 'customers'),
      (snap) => {
        setStoreCustomers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      },
      () => {}
    );

    const unsubShifts = onSnapshot(
      collection(db, 'shifts'),
      (snap) => {
        const openShifts = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((s) => {
            const st = String(s.status || '').toLowerCase().trim();
            return st === 'open' || st === 'aktif';
          });
        if (openShifts.length > 0) {
          openShifts.sort((a, b) => {
            const ta = new Date(a.openedAt || a.openTime || a.createdAt || 0).getTime();
            const tb = new Date(b.openedAt || b.openTime || b.createdAt || 0).getTime();
            return tb - ta;
          });
          setActiveShiftId(openShifts[0].id);
          setActiveShift(openShifts[0]);
          setHasOpenShiftInSession(true);
        } else {
          setActiveShift(null);
          setHasOpenShiftInSession(false);
        }
      },
      () => {}
    );

    const handleExternalCashierChange = (ev: Event) => {
      const custom = ev as CustomEvent<any>;
      if (custom?.detail?.name) {
        setActiveCashier((prev) => ({ ...prev, ...custom.detail }));
      }
    };
    window.addEventListener('riskcart:cashier-change', handleExternalCashierChange);

    return () => {
      unsubStaff();
      unsubStoreStaff();
      unsubCustomers();
      unsubShifts();
      window.removeEventListener('riskcart:cashier-change', handleExternalCashierChange);
    };
  }, []);

  // Auto-populate customer phone & address when selectedCustomer matches a registered store customer
  useEffect(() => {
    const matchedCust = storeCustomers.find(
      (c) => (c.name || '').trim().toLowerCase() === (selectedCustomer || '').trim().toLowerCase()
    );
    if (matchedCust) {
      if (matchedCust.phone && matchedCust.phone !== '-') {
        setCustomerPhoneInput(matchedCust.phone);
      }
      if (matchedCust.address && matchedCust.address !== '-') {
        setCustomerAddressInput(matchedCust.address);
      }
    }
  }, [selectedCustomer, storeCustomers]);

  // Sorted sender staff options (Shipper / Kurir prioritized at top, followed by all other active staff)
  const senderStaffOptions = useMemo(() => {
    return [...staffList].sort((a, b) => {
      const aIsShipper =
        (a.role || '').toLowerCase().includes('ship') ||
        (a.role || '').toLowerCase().includes('kurir') ||
        (a.role || '').toLowerCase().includes('antar')
          ? 0
          : 1;
      const bIsShipper =
        (b.role || '').toLowerCase().includes('ship') ||
        (b.role || '').toLowerCase().includes('kurir') ||
        (b.role || '').toLowerCase().includes('antar')
          ? 0
          : 1;
      if (aIsShipper !== bIsShipper) return aIsShipper - bIsShipper;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [staffList]);

  const selectedSenderStaff = useMemo(() => {
    if (!selectedSenderId) return null;
    return staffList.find((s) => s.id === selectedSenderId) || null;
  }, [selectedSenderId, staffList]);

  // Total delivery commission from products in cart when a sender is selected
  const totalDeliveryCommission = useMemo(() => {
    if (!selectedSenderStaff) return 0;
    return cart.reduce((sum, item) => {
      const p = item.product as any;
      const comm = Number(p.deliveryCommission ?? p.komisiPengirim ?? 0);
      return sum + comm * item.quantity;
    }, 0);
  }, [cart, selectedSenderStaff]);

  const handleVerifyCashierPin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setPinAuthError(null);
    if (!selectedStaffToLogin) {
      setPinAuthError('Pilih staf terlebih dahulu.');
      return;
    }
    const enteredPin = inputCashierPin.trim();
    const correctPin = String(selectedStaffToLogin.pin || '').trim();

    if (!enteredPin) {
      setPinAuthError('Masukkan 6 angka PIN keamanan kasir.');
      return;
    }
    if (enteredPin !== correctPin) {
      setPinAuthError('PIN salah! Pastikan memasukkan 6 angka PIN kasir yang benar.');
      return;
    }

    // Success login/switch
    setActiveCashier(selectedStaffToLogin);
    try {
      localStorage.setItem('riskcart_active_cashier', JSON.stringify(selectedStaffToLogin));
      window.dispatchEvent(new CustomEvent('riskcart:cashier-change', { detail: selectedStaffToLogin }));
    } catch {}
    if (activeShiftId) {
      setDoc(
        doc(db, 'shifts', activeShiftId),
        {
          id: activeShiftId,
          cashierId: selectedStaffToLogin.id || 'staff_001',
          cashierName: selectedStaffToLogin.name,
          cashierRole: selectedStaffToLogin.role || 'Cashier',
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ).catch(() => {});
    }
    setShowCashierPinModal(false);
    setInputCashierPin('');
    setSelectedStaffToLogin(null);
    setCashierToast(`Kasir aktif berhasil beralih ke: ${selectedStaffToLogin.name} (${selectedStaffToLogin.role})`);
    setTimeout(() => setCashierToast(null), 4000);
  };
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  // Audio beep generator using Web Audio API
  const playScannerBeep = () => {
    if (posSettings?.soundBeepEnabled === false) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(950, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (e) {}
  };

  // Audio chime for new incoming PWA order
  const playIncomingOrderChime = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'triangle';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc1.frequency.setValueAtTime(880, ctx.currentTime + 0.15); // A5
      osc2.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.3); // D6

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + 0.55);
      osc2.stop(ctx.currentTime + 0.55);
    } catch (e) {}
  };

  const handleScanBarcode = (code: string) => {
    const matched = products.find((p) => p.barcode === code || p.sku.toLowerCase().includes(code.toLowerCase()));
    if (matched) {
      handleUpdateCart(matched, 1);
      setScanFeedback(`Scanned: ${matched.name} (+1 added to cart)`);
      setTimeout(() => setScanFeedback(null), 3000);
    } else {
      setScanFeedback(`Barcode "${code}" not found in catalog.`);
      setTimeout(() => setScanFeedback(null), 3000);
    }
  };

  // Session timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSessionSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (totalSec: number) => {
    const hrs = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const mins = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const secs = String(totalSec % 60).padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  };

  useEffect(() => {
    if (ctxProducts && ctxProducts.length > 0 && products.length === 0) {
      setProducts(ctxProducts);
    }
  }, [ctxProducts, products.length]);

  // Subscribe to Products (root + stores/store_001/products) & Real-time Incoming PWA Orders
  useEffect(() => {
    let rootProdMap = new Map<string, Product>();
    let storeProdMap = new Map<string, Product>();
    let rootLoaded = false;
    let storeLoaded = false;

    const mapSnapDocToPosProduct = (id: string, data: any): Product | null => {
      if (!data || data.isActive === false || data.isPosVisible === false) return null;
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
        data.posPrice ?? data.sellPrice ?? data.pricePerUnit ?? data.price ?? 0
      );
      const pricePerCarton = pricePerUnit;
      return {
        ...data,
        id,
        storeId: data.storeId || ACTIVE_STORE_ID,
        name: data.name || '',
        sku: data.sku || id,
        category: data.category || 'Mineral',
        brand: data.brand || '',
        barcode: data.barcode || '',
        imageUrl: data.imageUrl || '',
        galleryUrls: data.galleryUrls ?? data.galleryImages ?? [],
        variantGroupId: data.variantGroupId,
        groupName: data.groupName,
        variantType: data.variantType,
        variantName: data.variantName,
        piecesPerCarton,
        isiPerDus: piecesPerCarton,
        weightMl,
        beratPerItem: weightMl,
        totalBeratKg,
        pricePerCarton,
        pricePerUnit,
        posPrice: pricePerUnit,
        costPerUnit: Number(data.costPrice ?? data.costPerUnit ?? 0),
        deliveryCommission: Number(data.deliveryCommission ?? data.komisiPengirim ?? 0),
        sellByUnit,
        stockInUnits: Number(data.stock ?? data.stockInUnits ?? 0),
        minStockAlert: Number(data.minStockAlert ?? data.minStock ?? getDefaultMinStock()),
        productionDate: data.productionDate ?? data.tanggalProduksi ?? '',
        tanggalProduksi: data.tanggalProduksi ?? data.productionDate ?? '',
        expiryDate: data.expiryDate ?? data.tanggalKadaluarsa ?? '',
        tanggalKadaluarsa: data.tanggalKadaluarsa ?? data.expiryDate ?? '',
        batches: Array.isArray(data.batches) ? data.batches : undefined,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    };

    const publishPosProducts = () => {
      const merged = new Map<string, Product>();
      storeProdMap.forEach((p, id) => merged.set(id, p));
      rootProdMap.forEach((p, id) => {
        const existing = merged.get(id);
        merged.set(id, existing ? { ...existing, ...p } : p);
      });
      const list = Array.from(merged.values());
      if (list.length > 0) {
        setProducts(list);
        try {
          localStorage.setItem('riskcart_cache_products', JSON.stringify(list));
        } catch (e) {}
      } else if (rootLoaded && storeLoaded) {
        setProducts([]);
        try {
          localStorage.removeItem('riskcart_cache_products');
        } catch (e) {}
      }
    };

    const unsubProducts = onSnapshot(
      collection(db, 'products'),
      (snapshot) => {
        const next = new Map<string, Product>();
        snapshot.forEach((d) => {
          const p = mapSnapDocToPosProduct(d.id, d.data());
          if (p) next.set(d.id, p);
        });
        rootProdMap = next;
        rootLoaded = true;
        publishPosProducts();
      },
      (error) => {
        rootLoaded = true;
        console.warn('products onSnapshot notice:', error);
        setProducts([]);
      }
    );

    const unsubStoreProducts = onSnapshot(
      collection(db, 'stores', ACTIVE_STORE_ID, 'products'),
      (snapshot) => {
        const next = new Map<string, Product>();
        snapshot.forEach((d) => {
          const p = mapSnapDocToPosProduct(d.id, d.data());
          if (p) next.set(d.id, p);
        });
        storeProdMap = next;
        storeLoaded = true;
        publishPosProducts();
      },
      () => {
        storeLoaded = true;
        publishPosProducts();
      }
    );

    // Purge any legacy dummy/mock PWA orders from Firestore on mount
    void purgeLegacyMockOrdersFromFirestore();

    // Helper to normalize any Firestore `orders` or `transactions` document into a consistent pending PWA / Waiter Order
    const isWaiterOrDineInOrder = (raw: any): boolean => {
      if (!raw) return false;
      const idStr = String(raw.id || raw.orderNumber || '').toUpperCase();
      const pmStr = String(raw.paymentMethod || '').toLowerCase();
      return (
        idStr.startsWith('ORD-WTR-') ||
        pmStr.includes('waiter') ||
        pmStr.includes('dine-in') ||
        Boolean(raw.tableId || raw.tableNumber)
      );
    };

    const isPendingStatus = (raw: any): boolean => {
      const st = String(raw?.status || '').toLowerCase();
      const fst = String(raw?.fulfillmentStatus || '').toLowerCase();
      const ps = String(raw?.paymentStatus || '').toLowerCase();
      if (
        st === 'completed' ||
        st === 'delivered' ||
        st === 'terkirim' ||
        st === 'cancelled' ||
        st === 'rejected' ||
        st === 'selesai' ||
        fst === 'completed' ||
        fst === 'delivered' ||
        fst === 'terkirim'
      ) {
        return false;
      }
      if (isWaiterOrDineInOrder(raw)) {
        return ps !== 'paid' && ps !== 'lunas';
      }
      if (st === 'shipped' || st === 'diproses' || fst === 'shipped') {
        return false;
      }
      return (
        st === 'pending' ||
        st === 'pending_approval' ||
        st === 'menunggu' ||
        st === 'antrean' ||
        st === 'new' ||
        st === '1. new' ||
        fst === 'pending' ||
        fst === 'new'
      );
    };

    const isPwaSource = (raw: any, fromOrdersCollection: boolean): boolean => {
      if (!raw) return false;
      if (isWaiterOrDineInOrder(raw)) {
        const ps = String(raw.paymentStatus || '').toLowerCase();
        return ps !== 'paid' && ps !== 'lunas';
      }
      const ch = String(raw.channel || '').toLowerCase();
      const src = String(raw.source || '').toLowerCase();
      if (ch === 'pos' || src === 'pos') return false;
      if (
        ch === 'pwa_client' ||
        ch === 'pwa' ||
        ch === 'whatsapp' ||
        ch === 'online' ||
        src.includes('pwa') ||
        src.includes('whatsapp') ||
        src.includes('online')
      ) {
        return true;
      }
      return fromOrdersCollection;
    };

    const normalizePwaOrderDoc = (id: string, raw: any): Transaction => {
      const rawItems = Array.isArray(raw.items) ? raw.items : [];
      const normalizedItems = rawItems.map((it: any) => {
        const qty = Math.max(1, Number(it.quantityOrdered ?? it.qty ?? it.quantity ?? 1));
        const unitPrice = Number(it.unitPrice ?? it.price ?? it.sellingPrice ?? 0);
        const unitCost = Number(it.unitCost ?? it.costPrice ?? 0);
        const subtotal = Number(it.subtotal ?? unitPrice * qty);
        return {
          ...it,
          productId: it.productId || it.id || '',
          productName: it.productName || it.name || 'Produk',
          name: it.name || it.productName || 'Produk',
          packageType: (it.packageType === 'carton' ? 'carton' : 'unit') as PackageType,
          quantityOrdered: qty,
          qty,
          quantity: qty,
          unitsDeducted: Number(it.unitsDeducted ?? qty),
          unitPrice,
          price: unitPrice,
          unitCost,
          costPrice: unitCost,
          subtotal,
        };
      });

      const computedTotal =
        Number(raw.totalAmount ?? raw.total ?? 0) ||
        normalizedItems.reduce((s: number, i: any) => s + Number(i.subtotal || 0), 0);
      const computedCost =
        Number(raw.totalCost ?? raw.totalModal ?? 0) ||
        normalizedItems.reduce((s: number, i: any) => s + Number(i.unitCost || 0) * Number(i.quantityOrdered || 1), 0);

      let createdIso = new Date().toISOString();
      const rawCreated = raw.createdAt || raw.timestamp || raw.date;
      if (typeof rawCreated === 'string') {
        createdIso = rawCreated;
      } else if (typeof rawCreated?.toDate === 'function') {
        try {
          createdIso = rawCreated.toDate().toISOString();
        } catch {}
      } else if (typeof rawCreated?.seconds === 'number') {
        createdIso = new Date(rawCreated.seconds * 1000).toISOString();
      }

      return {
        ...raw,
        id,
        storeId: raw.storeId || ACTIVE_STORE_ID,
        outletId: raw.outletId || 'OUT-01',
        channel: 'pwa_client',
        customerName: raw.customerName || 'Pelanggan PWA',
        customerPhone: raw.customerPhone || raw.phone || '',
        customerAddress: raw.customerAddress || raw.deliveryAddress || '',
        totalAmount: computedTotal,
        total: computedTotal,
        totalCost: computedCost,
        paymentMethod: raw.paymentMethod || 'cash',
        status: raw.status || 'pending',
        fulfillmentStatus: raw.fulfillmentStatus || 'pending',
        items: normalizedItems,
        createdAt: createdIso,
      } as Transaction;
    };

    let rootOrdersDocs: Transaction[] = [];
    let storeOrdersDocs: Transaction[] = [];
    let txPwaDocs: Transaction[] = [];

    const mergeAndPublishPwaQueue = () => {
      const mergedMap = new Map<string, Transaction>();
      const seenSyncKeys = new Set<string>();

      const addCandidate = (order: Transaction) => {
        const anyOrd = order as any;
        const syncKey = String(anyOrd.canonicalSyncKey || '').trim();
        const linkedOrderId = String(anyOrd.orderId || '').trim();
        const linkedTxId = String(anyOrd.transactionId || '').trim();
        const ordNum = String(anyOrd.orderNumber || '').trim();

        if (syncKey && seenSyncKeys.has(syncKey)) return;
        if (linkedOrderId && mergedMap.has(linkedOrderId)) return;
        if (linkedTxId && mergedMap.has(linkedTxId)) return;
        if (ordNum && seenSyncKeys.has(ordNum)) return;
        if (mergedMap.has(order.id)) return;

        if (syncKey) seenSyncKeys.add(syncKey);
        if (ordNum) seenSyncKeys.add(ordNum);
        mergedMap.set(order.id, order);
      };

      // Prioritize `orders` & `stores/store_001/orders`, then `transactions`
      storeOrdersDocs.forEach(addCandidate);
      rootOrdersDocs.forEach(addCandidate);
      txPwaDocs.forEach(addCandidate);

      const pendingList = Array.from(mergedMap.values()).sort((a, b) => {
        const tA = new Date(a.createdAt || 0).getTime() || 0;
        const tB = new Date(b.createdAt || 0).getTime() || 0;
        return tB - tA;
      });

      setPwaOrdersQueue(pendingList);

      if (pendingList.length > 0) {
        setIncomingPwaOrder((prev) => {
          if (prev) {
            const stillPending = pendingList.find((o) => o.id === prev.id);
            if (stillPending) return stillPending;
          }
          return pendingList[0];
        });

        const newestPwa = pendingList[0];
        if (
          lastPwaOrderIdRef.current !== null &&
          lastPwaOrderIdRef.current !== newestPwa.id
        ) {
          playIncomingOrderChime();
          setNewPwaOrderNotification(
            `🔔 Pesanan PWA Baru Masuk! Pelanggan: ${newestPwa.customerName} (#${newestPwa.id.slice(-6)})`
          );
          setTimeout(() => setNewPwaOrderNotification(null), 8000);
        }
        lastPwaOrderIdRef.current = newestPwa.id;
      } else {
        setIncomingPwaOrder(null);
      }
    };

    const unsubRootOrders = onSnapshot(
      collection(db, 'orders'),
      (snap) => {
        const list: Transaction[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          if (isLegacyMockOrderOrTx(data, docSnap.id)) return;
          if (isPwaSource(data, true) && isPendingStatus(data)) {
            list.push(normalizePwaOrderDoc(docSnap.id, data));
          }
        });
        rootOrdersDocs = list;
        mergeAndPublishPwaQueue();
      },
      () => {}
    );

    const unsubStoreOrders = onSnapshot(
      collection(db, 'stores', ACTIVE_STORE_ID, 'orders'),
      (snap) => {
        const list: Transaction[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          if (isLegacyMockOrderOrTx(data, docSnap.id)) return;
          if (isPwaSource(data, true) && isPendingStatus(data)) {
            list.push(normalizePwaOrderDoc(docSnap.id, data));
          }
        });
        storeOrdersDocs = list;
        mergeAndPublishPwaQueue();
      },
      () => {}
    );

    const unsubPwaTx = onSnapshot(
      collection(db, 'transactions'),
      (snap) => {
        const list: Transaction[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          if (isLegacyMockOrderOrTx(data, docSnap.id)) return;
          if (isPwaSource(data, false) && isPendingStatus(data)) {
            list.push(normalizePwaOrderDoc(docSnap.id, data));
          }
        });
        txPwaDocs = list;
        mergeAndPublishPwaQueue();
      },
      (error) => {
        console.warn('PWA transactions subscription notice:', error);
      }
    );

    return () => {
      unsubProducts();
      unsubStoreProducts();
      unsubRootOrders();
      unsubStoreOrders();
      unsubPwaTx();
    };
  }, []);

  // Format price helper: all internal values in PosMachine are stored in IDR (Rupiah) scale.
  // Uses live exchangeRate from LanguageContext / money.ts.
  const formatMoney = (val: number) => {
    return formatCurrency(val);
  };

  // Real-time Product Expiry Evaluations (Soda, Mineral, Teh, Kopi -> 30 Days Threshold)
  const productExpiryList = useMemo(() => {
    return products
      .map((p) => {
        const evalExp = evaluateProductExpiry(p);
        const sellVal =
          Math.max(0, Number(p.stockInUnits || 0)) *
          Number((p as any).posPrice ?? p.pricePerUnit ?? p.pricePerCarton ?? 0);
        const lossVal =
          Math.max(0, Number(p.stockInUnits || 0)) *
          Number(p.costPerUnit ?? (p as any).costPrice ?? 0);
        return {
          product: p,
          evalExp,
          sellVal,
          lossVal,
        };
      })
      .sort((a, b) => {
        const da = a.evalExp.daysUntilExpiry ?? 999999;
        const db = b.evalExp.daysUntilExpiry ?? 999999;
        return da - db;
      });
  }, [products]);

  // Products with stock > 0 and approaching expiry (<= 30 days, highlighting 14-30 days and <14 days)
  const nearExpiryProducts = useMemo(() => {
    return productExpiryList.filter((item) => item.evalExp.isNearExpiryAlert);
  }, [productExpiryList]);

  const warning14To30Count = useMemo(
    () => nearExpiryProducts.filter((item) => item.evalExp.isIn14To30Window).length,
    [nearExpiryProducts]
  );

  const criticalUnder14Count = useMemo(
    () => nearExpiryProducts.filter((item) => item.evalExp.isCriticalUnder14).length,
    [nearExpiryProducts]
  );

  // Categories list derived dynamically from active products (deduplicated)
  const categoryTabs = useMemo(() => {
    const seen = new Set<string>(['ALL']);
    const list: string[] = ['ALL'];
    products.forEach((p) => {
      const cat = String(p.category || '').trim();
      if (cat && !seen.has(cat)) {
        seen.add(cat);
        list.push(cat);
      }
    });
    return list;
  }, [products]);

  const filteredProducts = products.filter((p) => {
    const matchCat =
      selectedCategory === 'ALL'
        ? true
        : (p.category || '').toLowerCase().includes(selectedCategory.toLowerCase());
    const q = searchTerm.toLowerCase();
    const matchSearch =
      !q ||
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.groupName || '').toLowerCase().includes(q) ||
      (p.variantName || '').toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const getProductPackageMode = (_p: Product): PackageType => {
    return 'unit';
  };

  const setProductPackageMode = (productId: string, mode: PackageType) => {
    setSelectedPackageByProduct((prev) => ({
      ...prev,
      [productId]: mode,
    }));
  };

  // Cart operations (1 click = 1 product / 1 Dus, never multiplied by Isi 1 Dus)
  const getCartQty = (productId: string, _packageType: PackageType = 'unit') => {
    return cart
      .filter((c) => c.product.id === productId)
      .reduce((sum, c) => sum + c.quantity, 0);
  };

  // Helper 5: Synchronize Transaction (Google Sheet Auto-Synced with FileName = Nomor Transaksi) or Cart Void Evidence Photo to Google Drive via Backend Proxy

  const syncTransactionToGoogleDrive = async (
    payload: Record<string, any>
  ): Promise<{ googleDocUrl: string; googleDrivePhotoUrl: string }> => {
    const rawFileName = String(
      payload.fileName || payload.orderNumber || payload.id || `POS-${Date.now()}`
    ).trim();
    const fallbackSyncId = rawFileName.replace(/[^a-zA-Z0-9_-]/g, '_');
    let googleDocUrl = `/api/google-drive/doc/${encodeURIComponent(fallbackSyncId)}`;
    let googleDrivePhotoUrl = payload.evidencePhoto
      ? `/api/google-drive/photo/${encodeURIComponent(fallbackSyncId)}`
      : '';

    const sanitizeCashierStr = (val: any): string => {
      const s = String(val ?? '').trim();
      return s && s !== '-' ? s : '';
    };
    const resolvedCashierName =
      sanitizeCashierStr(payload.cashier) ||
      sanitizeCashierStr(payload.cashierName) ||
      sanitizeCashierStr(payload.staffName) ||
      sanitizeCashierStr(activeShift?.cashierName) ||
      sanitizeCashierStr(activeShift?.staffName) ||
      sanitizeCashierStr((ctxActiveCashier as any)?.name) ||
      sanitizeCashierStr((ctxActiveCashier as any)?.displayName) ||
      sanitizeCashierStr(activeCashier?.name);

    const catalogProducts = [
      ...(Array.isArray(ctxProducts) ? ctxProducts : []),
      ...(Array.isArray(products) ? products : []),
    ];

    const resolveProductMatch = (item: any) => {
      const targetId = String(item?.productId ?? item?.id ?? item?.product?.id ?? '').trim().toLowerCase();
      const targetSku = String(item?.sku ?? item?.product?.sku ?? '').trim().toLowerCase();
      const targetName = String(item?.productName ?? item?.name ?? item?.product?.name ?? '').trim().toLowerCase();
      return catalogProducts.find((p: any) => {
        const pId = String(p?.id ?? '').trim().toLowerCase();
        const pSku = String(p?.sku ?? '').trim().toLowerCase();
        const pName = String(p?.name ?? '').trim().toLowerCase();
        return (
          (targetId && pId === targetId) ||
          (targetSku && pSku === targetSku) ||
          (targetName && pName === targetName)
        );
      });
    };

    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const enrichedItems = rawItems.map((item: any) => {
      const matchedProduct: any = resolveProductMatch(item);
      const name = String(
        item.name ?? item.productName ?? item.product?.name ?? matchedProduct?.name ?? 'Produk'
      );
      const qty = Number(item.qty || item.quantity || item.quantityOrdered || 1) || 1;
      const price = Number(
        item.price ||
          item.unitPrice ||
          item.sellingPrice ||
          matchedProduct?.posPrice ||
          matchedProduct?.pricePerUnit ||
          matchedProduct?.sellPrice ||
          0
      );
      const costPrice = Number(
        matchedProduct?.costPrice ??
          matchedProduct?.buyPrice ??
          matchedProduct?.modal ??
          matchedProduct?.costPerUnit ??
          item.costPrice ??
          item.hargaModal ??
          item.unitCost ??
          0
      );
      const subtotal = qty * price;
      const totalModal = qty * costPrice;
      const totalUntung = subtotal - totalModal;

      return {
        ...item,
        name,
        productName: name,
        qty,
        quantity: qty,
        quantityOrdered: qty,
        price,
        unitPrice: price,
        sellingPrice: price,
        costPrice,
        hargaModal: costPrice,
        unitCost: costPrice,
        subtotal,
        totalModal,
        totalCost: totalModal,
        totalUntung,
        profit: totalUntung,
      };
    });

    const computedTotalModal = enrichedItems.reduce((s, it) => s + Number(it.totalModal || 0), 0);
    const computedSubtotal =
      enrichedItems.length > 0
        ? enrichedItems.reduce((s, it) => s + Number(it.subtotal || 0), 0)
        : Number(payload.subtotal ?? payload.totalAmount ?? payload.total ?? 0);
    const computedTotalUntung = enrichedItems.reduce((s, it) => s + Number(it.totalUntung || 0), 0);

    const enrichedPayload = {
      ...payload,
      fileName: rawFileName,
      title: rawFileName,
      docTitle: rawFileName,
      cashier: resolvedCashierName,
      cashierName: resolvedCashierName,
      staffName: resolvedCashierName,
      ...(enrichedItems.length > 0
        ? {
            items: enrichedItems,
            totalCost: computedTotalModal,
            totalModal: computedTotalModal,
            hargaModal: computedTotalModal,
            totalProfit: computedTotalUntung,
            totalUntung: computedTotalUntung,
            keuntungan: computedTotalUntung,
            subtotal: Number(payload.subtotal ?? computedSubtotal),
          }
        : {}),
      photoBase64: payload.evidencePhoto
        ? String(payload.evidencePhoto).replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
        : '',
      photoMimeType: 'image/jpeg',
      photoFileName: `FOTO_BUKTI_${rawFileName}.jpg`,
    };

    try {
      const res = await fetch('/api/google-drive/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enrichedPayload),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.googleDocUrl) googleDocUrl = String(data.googleDocUrl);
        if (data?.googleDrivePhotoUrl) googleDrivePhotoUrl = String(data.googleDrivePhotoUrl);
        return { googleDocUrl, googleDrivePhotoUrl };
      }
    } catch (err) {
      console.warn('[Google Drive Sync] Backend proxy unreachable:', err);
    }

    return { googleDocUrl, googleDrivePhotoUrl };
  };

  // Stop active camera stream safely
  const stopLiveCamera = () => {
    try {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = null;
      }
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = null;
      }
    } catch {}
    setIsCameraActive(false);
  };

  const openCartCancelModal = (req: {
    mode: 'remove_item' | 'decrease_qty' | 'clear_cart' | 'new_order';
    actionLabel: string;
    targetItem?: CartLine;
    delta?: number;
  }) => {
    stopLiveCamera();
    setCancelOwnerPin('');
    setShowCancelOwnerPin(false);
    setCancelReason('');
    setCancelEvidencePhoto('');
    setCancelError(null);
    setCartCancelRequest(req);
  };

  const closeCartCancelModal = () => {
    stopLiveCamera();
    setCartCancelRequest(null);
    setCancelOwnerPin('');
    setCancelReason('');
    setCancelEvidencePhoto('');
    setCancelError(null);
  };

  const startLiveCamera = async () => {
    setCancelError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraFallbackInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setIsCameraActive(true);
      setTimeout(() => {
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          cameraVideoRef.current.play().catch(() => {});
        }
      }, 80);
    } catch {
      // Fallback to native camera file input if permission denied or no webcam device
      cameraFallbackInputRef.current?.click();
    }
  };

  const captureLiveCameraPhoto = () => {
    const video = cameraVideoRef.current;
    if (!video) return;
    const rawW = video.videoWidth || 640;
    const rawH = video.videoHeight || 480;
    const maxSide = 800;
    let width = rawW;
    let height = rawH;
    if (width > maxSide || height > maxSide) {
      if (width >= height) {
        height = Math.round((height * maxSide) / width);
        width = maxSide;
      } else {
        width = Math.round((width * maxSide) / height);
        height = maxSide;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      setCancelEvidencePhoto(dataUrl);
      setCancelError(null);
    }
    stopLiveCamera();
  };

  const handleEvidenceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file, 800, 0.72);
      setCancelEvidencePhoto(compressed);
      setCancelError(null);
    } catch {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setCancelEvidencePhoto(reader.result);
          setCancelError(null);
        }
      };
      reader.readAsDataURL(file);
    } finally {
      e.target.value = '';
    }
  };

  // Internal helper: ONLY called after successful payment or verified Owner PIN + Reason + Photo cancellation
  const executeAuthorizedCartClear = () => {
    setCart([]);
    try {
      localStorage.removeItem('riskcart_locked_cart');
    } catch {}
    setCashReceivedInput('0');
    setCalcDisplay('');
    setOrderDate(new Date().toLocaleDateString('en-CA'));
  };

  const handleUpdateCart = (
    product: Product,
    delta: number,
    _explicitPackageType?: PackageType
  ) => {
    const pkgType: PackageType = 'unit';
    // In Waiter POS Mode, allow waiters to adjust/remove items freely before pushing the order
    if (isWaiterMode && delta < 0) {
      setCart((prev) => {
        const idx = prev.findIndex((c) => c.product.id === product.id);
        if (idx < 0) return prev;
        const next = [...prev];
        const newQty = next[idx].quantity + delta;
        if (newQty <= 0) {
          const filtered = next.filter((_, i) => i !== idx);
          if (filtered.length === 0) {
            try {
              localStorage.removeItem('riskcart_locked_cart');
            } catch {}
          }
          return filtered;
        }
        next[idx] = { ...next[idx], quantity: newQty };
        return next;
      });
      return;
    }

    // LOCK: Any attempt to decrease or remove an existing item in cart MUST go through CartCancelModal
    if (delta < 0) {
      const existingItem = cart.find((c) => c.product.id === product.id);
      if (existingItem) {
        const isFullRemove = Math.abs(delta) >= existingItem.quantity;
        openCartCancelModal({
          mode: isFullRemove ? 'remove_item' : 'decrease_qty',
          actionLabel: isFullRemove ? 'Hapus Item' : 'Kurangi Qty (-1)',
          targetItem: existingItem,
          delta,
        });
      }
      return;
    }

    if (delta > 0) playScannerBeep();
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.product.id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        const newQty = next[idx].quantity + delta;
        next[idx] = { ...next[idx], product, packageType: pkgType, quantity: newQty };
        return next;
      }
      if (delta > 0) {
        return [...prev, { product, packageType: pkgType, quantity: delta }];
      }
      return prev;
    });
  };

  const handleClearCart = (source: 'clear_cart' | 'new_order' = 'clear_cart') => {
    if (isWaiterMode) {
      executeAuthorizedCartClear();
      return;
    }
    if (cart.length > 0) {
      openCartCancelModal({
        mode: source,
        actionLabel: source === 'new_order' ? 'Order Baru (Reset Keranjang)' : 'Clear Cart',
      });
      return;
    }
    executeAuthorizedCartClear();
  };

  const handleConfirmCartCancel = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!cartCancelRequest || isSubmittingCancel) return;
    setCancelError(null);

    const pinTrimmed = cancelOwnerPin.trim();
    const reasonTrimmed = cancelReason.trim();

    // Calculate affected items & nominal value
    const affectedItems =
      cartCancelRequest.mode === 'clear_cart' || cartCancelRequest.mode === 'new_order'
        ? cart.map((c) => {
            const p = c.product as any;
            const unitPrice = Number(
              p.posPrice ?? p.pricePerUnit ?? p.sellPrice ?? p.pricePerCarton ?? 0
            );
            return {
              productId: c.product.id,
              productName: c.product.name,
              sku: c.product.sku || c.product.id,
              quantity: c.quantity,
              unitPrice,
              subtotal: unitPrice * c.quantity,
            };
          })
        : cartCancelRequest.targetItem
        ? [
            (() => {
              const c = cartCancelRequest.targetItem!;
              const p = c.product as any;
              const unitPrice = Number(
                p.posPrice ?? p.pricePerUnit ?? p.sellPrice ?? p.pricePerCarton ?? 0
              );
              const cancelQty =
                cartCancelRequest.mode === 'remove_item'
                  ? c.quantity
                  : Math.min(c.quantity, Math.abs(cartCancelRequest.delta || 1));
              return {
                productId: c.product.id,
                productName: c.product.name,
                sku: c.product.sku || c.product.id,
                quantity: cancelQty,
                unitPrice,
                subtotal: unitPrice * cancelQty,
              };
            })(),
          ]
        : [];

    const totalCancelledNominal = affectedItems.reduce(
      (sum, it) => sum + Number(it.subtotal || 0),
      0
    );

    const persistVoidLog = async (
      status: 'CONFIRMED_BY_OWNER_PIN' | 'FAILED_PIN_ATTEMPT',
      reasonText: string
    ) => {
      const nowIso = new Date().toISOString();
      const voidId = `VOID-${Date.now()}`;
      const fileName = `VOID-POS-${nowIso.slice(0, 10).replace(/-/g, '')}-${voidId.slice(-6)}`;

      const syncRes = await syncTransactionToGoogleDrive({
        id: voidId,
        type: 'CART_VOID_EVIDENCE',
        fileName,
        status,
        createdAt: nowIso,
        staffName: activeCashier.name,
        staffRole: activeCashier.role,
        shiftId: activeShiftId,
        customerName: selectedCustomer,
        actionLabel: cartCancelRequest.actionLabel,
        cancelledItems: affectedItems,
        totalNominal: totalCancelledNominal,
        reason: reasonText,
        evidencePhoto: cancelEvidencePhoto,
      });

      const logEntry = {
        id: voidId,
        type: 'CART_VOID_EVIDENCE' as const,
        status,
        createdAt: nowIso,
        staffName: activeCashier.name,
        staffRole: activeCashier.role,
        shiftId: activeShiftId,
        customerName: selectedCustomer,
        actionLabel: cartCancelRequest.actionLabel,
        cancelledItems: affectedItems,
        totalNominal: totalCancelledNominal,
        reason: reasonText,
        evidencePhoto: cancelEvidencePhoto,
        googleDocUrl: syncRes.googleDocUrl,
        googleDrivePhotoUrl: syncRes.googleDrivePhotoUrl,
      };

      // Save to localStorage fallback immediately
      try {
        const raw = localStorage.getItem('riskcart_cart_void_logs');
        const prev = raw ? JSON.parse(raw) : [];
        const next = [logEntry, ...(Array.isArray(prev) ? prev : [])].slice(0, 100);
        localStorage.setItem('riskcart_cart_void_logs', JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('riskcart:void-evidence-updated'));
      } catch {}

      // Save to Firestore `audit_logs`, `product_logs`, and `fraud_logs`
      await Promise.all([
        setDoc(doc(db, 'audit_logs', voidId), logEntry, { merge: true }).catch(() => {}),
        setDoc(doc(db, 'product_logs', voidId), logEntry, { merge: true }).catch(() => {}),
        setDoc(
          doc(db, 'fraud_logs', voidId),
          {
            id: voidId,
            transactionId: voidId,
            anomalyType:
              status === 'FAILED_PIN_ATTEMPT'
                ? 'FAILED_CART_VOID_PIN'
                : 'AUTHORIZED_CART_VOID_EVIDENCE',
            riskLevel: status === 'FAILED_PIN_ATTEMPT' ? 'critical' : 'medium',
            summary: `${cartCancelRequest.actionLabel} oleh ${activeCashier.name} (${formatMoney(
              totalCancelledNominal
            )})`,
            aiDetails: `Alasan: ${reasonText} | Item: ${affectedItems
              .map((i) => `${i.quantity}x ${i.productName}`)
              .join(', ')}`,
            timestamp: nowIso,
            resolved: status === 'CONFIRMED_BY_OWNER_PIN',
            googleDocUrl: syncRes.googleDocUrl,
            googleDrivePhotoUrl: syncRes.googleDrivePhotoUrl,
          },
          { merge: true }
        ).catch(() => {}),
      ]);
    };

    // 1. Validate PIN Owner/Supervisor/Manager (Hak Akses: requireSupervisorPinForVoid)
    const voidNeedsPin = posSettings?.requireSupervisorPinForVoid !== false;
    if (voidNeedsPin && !pinTrimmed) {
      setCancelError('Wajib memasukkan PIN Owner / Supervisor terlebih dahulu!');
      return;
    }
    let isOwnerPinValid = !voidNeedsPin;
    if (voidNeedsPin) try {
      const verifyRes = await fetch('/api/settings/pin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'approver', pin: pinTrimmed }),
      });
      if (verifyRes.ok) {
        const verifyData = await verifyRes.json();
        isOwnerPinValid = Boolean(verifyData?.valid);
      }
    } catch {
      isOwnerPinValid = false;
    }

    if (!isOwnerPinValid) {
      setIsSubmittingCancel(true);
      await persistVoidLog(
        'FAILED_PIN_ATTEMPT',
        reasonTrimmed || 'Percobaan pembatalan dengan PIN Owner salah'
      );
      setIsSubmittingCancel(false);
      setCancelError('PIN Owner salah! Percobaan pembatalan telah dicatat ke Anti-Fraud.');
      return;
    }

    // 2. Validate Reason (min 5 chars)
    if (reasonTrimmed.length < 5) {
      setCancelError('Wajib mengisi Keterangan / Alasan Pembatalan (minimal 5 karakter)!');
      return;
    }

    // 3. Validate Evidence Photo
    if (!cancelEvidencePhoto) {
      setCancelError(
        'Wajib melampirkan Foto / Dokumen Bukti (klik Buka Kamera atau Browse Photo Gallery)!'
      );
      return;
    }

    setIsSubmittingCancel(true);
    try {
      await persistVoidLog('CONFIRMED_BY_OWNER_PIN', reasonTrimmed);

      // Execute authorized cart removal/decrement/clear
      if (
        cartCancelRequest.mode === 'clear_cart' ||
        cartCancelRequest.mode === 'new_order'
      ) {
        executeAuthorizedCartClear();
      } else if (
        cartCancelRequest.mode === 'remove_item' &&
        cartCancelRequest.targetItem
      ) {
        const targetId = cartCancelRequest.targetItem.product.id;
        setCart((prev) => {
          const next = prev.filter((c) => c.product.id !== targetId);
          if (next.length === 0) {
            try {
              localStorage.removeItem('riskcart_locked_cart');
            } catch {}
          }
          return next;
        });
      } else if (
        cartCancelRequest.mode === 'decrease_qty' &&
        cartCancelRequest.targetItem
      ) {
        const targetId = cartCancelRequest.targetItem.product.id;
        const delta = cartCancelRequest.delta || -1;
        setCart((prev) => {
          const idx = prev.findIndex((c) => c.product.id === targetId);
          if (idx < 0) return prev;
          const next = [...prev];
          const newQty = next[idx].quantity + delta;
          if (newQty <= 0) {
            const filtered = next.filter((_, i) => i !== idx);
            if (filtered.length === 0) {
              try {
                localStorage.removeItem('riskcart_locked_cart');
              } catch {}
            }
            return filtered;
          }
          next[idx] = { ...next[idx], quantity: newQty };
          return next;
        });
      }

      setCashierToast(
        `✓ ${cartCancelRequest.actionLabel} berhasil dikonfirmasi dengan PIN Owner & Bukti Foto tersimpan ke Anti-Fraud & Google Drive.`
      );
      setTimeout(() => setCashierToast(null), 5000);
      closeCartCancelModal();
    } finally {
      setIsSubmittingCancel(false);
    }
  };

  // Pricing math governed by posSettings (1 product = 1 Dus at pricePerUnit / posPrice)
  const subtotal = cart.reduce((sum, item) => {
    const p = item.product as any;
    const price = Number(p.posPrice ?? p.pricePerUnit ?? p.sellPrice ?? p.pricePerCarton ?? 0);
    return sum + price * item.quantity;
  }, 0);

  // Diskon manual kasir (Umum: allowManualCashierDiscount / maxCashierDiscountPct)
  const discountAmount = Math.max(0, (subtotal * Math.min(100, Math.max(0, discountPct))) / 100);
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  // Service charge (Global Setup)
  const serviceChargeRate = Math.max(0, Number(posSettings?.serviceChargeRate) || 0);
  const serviceChargeAmount = (afterDiscount * serviceChargeRate) / 100;

  const isTaxEnabled = posSettings?.taxEnabled !== false;
  const taxRate = isTaxEnabled
    ? typeof posSettings?.defaultTaxRate === 'number'
      ? posSettings.defaultTaxRate
      : 11
    : 0;
  const taxAmount = isTaxEnabled ? ((afterDiscount + serviceChargeAmount) * taxRate) / 100 : 0;
  const preRoundTotal = afterDiscount + serviceChargeAmount + taxAmount;

  const isRoundingEnabled =
    posSettings?.roundingEnabled !== false &&
    Boolean(posSettings?.cashRoundingMode) &&
    posSettings?.cashRoundingMode !== 'none';

  // Apply cashRoundingMode ('floor_100' | 'ceil_500') in both IDR and USD modes
  let total = preRoundTotal;
  if (isRoundingEnabled && preRoundTotal > 0) {
    if (currencyMode === 'IDR') {
      if (posSettings?.cashRoundingMode === 'floor_100') {
        total = Math.floor(preRoundTotal / 100) * 100;
      } else if (posSettings?.cashRoundingMode === 'ceil_500') {
        total = Math.ceil(preRoundTotal / 500) * 500;
      }
    } else {
      // USD mode: round USD amount to nearest $0.10 (floor_100) or $0.50 (ceil_500), then convert back to internal IDR scale
      const rawUsd = Number((preRoundTotal / activeRate).toFixed(4));
      let roundedUsd = rawUsd;
      if (posSettings?.cashRoundingMode === 'floor_100') {
        roundedUsd = Math.floor(rawUsd * 10) / 10;
      } else if (posSettings?.cashRoundingMode === 'ceil_500') {
        roundedUsd = Math.ceil(rawUsd * 2) / 2;
      }
      total = roundedUsd * activeRate;
    }
  }

  const roundingDifference = total - preRoundTotal;
  const formatRoundingBadge = (diffIdr: number) => {
    if (currencyMode === 'IDR') {
      const roundedDiff = Math.round(diffIdr);
      return roundedDiff > 0
        ? `+${roundedDiff.toLocaleString('id-ID')}`
        : `${roundedDiff.toLocaleString('id-ID')}`;
    }
    const usdDiff = diffIdr / activeRate;
    return usdDiff > 0 ? `+${usdDiff.toFixed(2)}` : `${usdDiff.toFixed(2)}`;
  };

  const displayTotal =
    currencyMode === 'IDR'
      ? Math.round(total)
      : Number((total / activeRate).toFixed(2));

  const prevCurrencyRef = useRef<'IDR' | 'USD'>(currencyMode);
  useEffect(() => {
    if (prevCurrencyRef.current !== currencyMode) {
      const prevMode = prevCurrencyRef.current;
      prevCurrencyRef.current = currencyMode;
      const numericCash = Number(cashReceivedInput);
      if (numericCash > 0) {
        if (prevMode === 'IDR' && currencyMode === 'USD') {
          setCashReceivedInput(String(Number((numericCash / activeRate).toFixed(2))));
        } else if (prevMode === 'USD' && currencyMode === 'IDR') {
          setCashReceivedInput(String(Math.round(numericCash * activeRate)));
        }
      }
    }
  }, [currencyMode, activeRate, cashReceivedInput]);

  const cashGiven = Number(cashReceivedInput) || 0;
  const change = Math.max(0, cashGiven - displayTotal);
  const remaining = Math.max(0, displayTotal - cashGiven);

  // When QRIS is active, automatically lock cashReceivedInput to displayTotal (cartTotal)
  useEffect(() => {
    if (paymentMethod === 'qris') {
      setCashReceivedInput(String(displayTotal));
    }
  }, [paymentMethod, displayTotal]);

  // Countdown timer & real-time Firestore webhook listener for active QRIS modal
  useEffect(() => {
    if (!activeQrisSession) return;
    setQrisSecondsLeft(300);
    const interval = setInterval(() => {
      setQrisSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    const txId = activeQrisSession.transactionId;
    const handleSettledDetected = (paidData?: any) => {
      setActiveQrisSession((prev) => {
        if (!prev || prev.status === 'LUNAS') return prev;
        try {
          confetti({ particleCount: 65, spread: 70, origin: { y: 0.6 } });
        } catch {}
        setCompletedTxReceipt({
          ...prev.receiptPayload,
          paymentMethodLabel: 'QRIS DOKU',
          paymentStatus: 'LUNAS',
          dokuPaymentId: paidData?.dokuPaymentId || paidData?.paymentId || prev.paymentId,
          paidAt: paidData?.paidAt || new Date().toISOString(),
        });
        return null;
      });
    };

    const unsubTx = onSnapshot(doc(db, 'transactions', txId), (snap) => {
      if (snap.exists()) {
        const d = snap.data() as any;
        const st = String(d.paymentStatus || '').toUpperCase();
        if (st === 'LUNAS' || st === 'PAID' || st === 'SETTLED') {
          handleSettledDetected(d);
        }
      }
    });

    const unsubSettlement = onSnapshot(doc(db, 'doku_settlements', txId), (snap) => {
      if (snap.exists()) {
        const d = snap.data() as any;
        const st = String(d.status || d.paymentStatus || '').toUpperCase();
        if (st.includes('LUNAS') || st.includes('SETTLED') || st === 'PAID') {
          handleSettledDetected(d);
        }
      }
    });

    return () => {
      clearInterval(interval);
      unsubTx();
      unsubSettlement();
    };
  }, [activeQrisSession?.transactionId]);

  const handleConfirmQrisPayment = async (useWebhookEndpoint = false) => {
    if (!activeQrisSession || isConfirmingQris) return;
    setIsConfirmingQris(true);
    const sess = activeQrisSession;
    const nowIso = new Date().toISOString();
    const txIso = sess.receiptPayload?.timestamp || sess.receiptPayload?.createdAt || nowIso;
    const txOrderDate =
      sess.receiptPayload?.orderDate || new Date(txIso).toLocaleDateString('en-CA');
    const formattedDateStr = new Date(txIso).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

    try {
      // Anti-fraud: kasir TIDAK bisa menandai lunas. Hanya simulasi resmi di mode SANDBOX;
      // status LUNAS ditulis server setelah webhook gateway terverifikasi, lalu listener onSnapshot menutup modal.
      void useWebhookEndpoint;
      void nowIso;
      void txOrderDate;
      void formattedDateStr;
      const r = await paymentGatewayApi.simulatePaid(sess.transactionId);
      console.info('[QRIS sandbox]', r.message);
    } catch (e: any) {
      alert(`Belum bisa dikonfirmasi: ${e?.message || e}. Tunggu notifikasi pembayaran dari gateway.`);
      console.warn('Error confirming QRIS payment:', e);
    } finally {
      setIsConfirmingQris(false);
    }
  };

  // Numpad handlers
  const handleNumClick = (val: string) => {
    if (cashReceivedInput === '0' && val !== '.') {
      setCashReceivedInput(val);
    } else {
      setCashReceivedInput((prev) => prev + val);
    }
  };

  const handleNumClear = () => {
    setCashReceivedInput('0');
  };

  const handleNumBackspace = () => {
    setCashReceivedInput((prev) => (prev.length > 1 ? prev.slice(0, -1) : '0'));
  };

  const handleQuickCash = (amount: number) => {
    setCashReceivedInput(String(amount));
  };

  const handleExactCash = () => {
    setCashReceivedInput(String(displayTotal));
  };

  // Push Order for Waiter POS Mode -> Saves order as 'New' and redirects to /dashboard/orders/new
  const handlePushWaiterOrder = async () => {
    if (cart.length === 0 || isProcessing) return;
    setIsProcessing(true);

    try {
      const nowIso = new Date().toISOString();
      const orderId = `ORD-WTR-${Date.now()}`;
      const customerLabel =
        selectedCustomer && selectedCustomer.trim()
          ? selectedCustomer.trim()
          : waiterTableInfo.visitorName
          ? `${waiterTableInfo.visitorName} (${waiterTableInfo.tableNumber})`
          : `Meja ${waiterTableInfo.tableNumber}`;

      const orderItems = cart.map((item) => {
        const p = item.product as any;
        const unitPrice = Number(
          p.posPrice ?? p.pricePerUnit ?? p.sellPrice ?? p.pricePerCarton ?? 0
        );
        const unitCost = Number(
          p.costPrice ?? p.buyPrice ?? p.modal ?? p.costPerUnit ?? Math.round(unitPrice * 0.7)
        );
        const cleanItemNote = item.notes ? item.notes.trim() : '';
        return {
          productId: item.product.id,
          sku: item.product.sku || item.product.id,
          name: item.product.name,
          productName: item.product.name,
          packageType: 'unit',
          quantityOrdered: item.quantity,
          qty: item.quantity,
          quantity: item.quantity,
          unitsDeducted: item.quantity,
          unitPrice,
          price: unitPrice,
          costPrice: unitCost,
          subtotal: unitPrice * item.quantity,
          ...(cleanItemNote ? { notes: cleanItemNote, note: cleanItemNote } : {}),
        };
      });

      const itemsCount = orderItems.reduce((sum, it) => sum + it.qty, 0);
      const totalCost = orderItems.reduce((sum, it) => sum + it.costPrice * it.qty, 0);
      const totalAmount = Number(total) || orderItems.reduce((sum, it) => sum + it.subtotal, 0);
      const totalProfit = Math.max(0, totalAmount - totalCost);

      const cleanGlobalOrderNotes = orderNotes.trim();
      const itemNotesSummary = orderItems
        .filter((oi) => oi.notes)
        .map((oi) => `${oi.name}: "${oi.notes}"`)
        .join(' | ');
      const combinedNotesText = [
        `Pesanan Waiter — Meja ${waiterTableInfo.tableNumber}`,
        cleanGlobalOrderNotes ? `Catatan Meja: ${cleanGlobalOrderNotes}` : '',
        itemNotesSummary ? `Request Item: ${itemNotesSummary}` : '',
      ]
        .filter(Boolean)
        .join(' • ');

      const waiterOrderDoc = {
        id: orderId,
        orderNumber: orderId,
        storeId: ACTIVE_STORE_ID,
        tableId: waiterTableInfo.id,
        tableNumber: waiterTableInfo.tableNumber,
        customerName: customerLabel,
        customerPhone: customerPhoneInput || '-',
        customerAddress: `Dine-In Meja ${waiterTableInfo.tableNumber}`,
        channel: 'pos',
        status: 'New',
        fulfillmentStatus: 'New',
        paymentMethod: 'Dine-In (Waiter Order)',
        paymentStatus: 'unpaid',
        items: orderItems,
        itemsCount,
        subtotal: Number(subtotal) || totalAmount,
        taxRate: isTaxEnabled ? taxRate : 0,
        taxAmount: isTaxEnabled ? taxAmount : 0,
        discountPct: Number(discountPct) || 0,
        discountAmount: Number(discountAmount) || 0,
        totalCost,
        totalAmount,
        totalProfit,
        cashierName: isWaiterMode
          ? activeWaiterForOrder?.name || activeCashier?.name || 'Waiter POS'
          : activeCashier?.name || 'Waiter POS',
        waiterName: activeWaiterForOrder?.name || activeCashier?.name || 'Waiter POS',
        waiterRole: activeWaiterForOrder?.role || 'Waiter / Server',
        waiterDivision: activeWaiterForOrder?.divisionName || 'Divisi Service / Floor (Pelayanan Meja)',
        orderNotes: cleanGlobalOrderNotes || undefined,
        notes: combinedNotesText,
        orderDate: orderDate || nowIso.slice(0, 10),
        timestamp: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const cleanOrderDoc = JSON.parse(JSON.stringify(waiterOrderDoc));

      // 1. Update local table state in localStorage ('riskcart_restaurant_tables_v1') & Firestore ('restaurant_tables')
      try {
        const rawTables = localStorage.getItem('riskcart_restaurant_tables_v1');
        if (rawTables) {
          const parsedTables = JSON.parse(rawTables);
          if (Array.isArray(parsedTables)) {
            const nextTables = parsedTables.map((t: any) => {
              if (
                t.id === waiterTableInfo.id ||
                t.tableNumber === waiterTableInfo.tableNumber
              ) {
                const existingOrders = Array.isArray(t.orders) ? t.orders : [];
                const addedTableOrders = orderItems.map((oi, i) => ({
                  id: `ord_${Date.now()}_${i}`,
                  productId: oi.productId,
                  name: oi.name,
                  qty: oi.qty,
                  price: oi.unitPrice,
                  ...(oi.notes ? { note: oi.notes, notes: oi.notes } : {}),
                }));
                const mergedOrders = [...existingOrders, ...addedTableOrders];
                const nextTotalOrder = mergedOrders.reduce(
                  (s: number, o: any) => s + (Number(o.price) || 0) * (Number(o.qty) || 1),
                  0
                );
                const updatedTable = {
                  ...t,
                  status: 'occupied',
                  visitorName: customerLabel.replace(/\s*\(M-\d+\)\s*$/i, '').trim() || t.visitorName,
                  seatedAt: t.seatedAt || nowIso,
                  orders: mergedOrders,
                  totalOrder: nextTotalOrder,
                  ...(cleanGlobalOrderNotes ? { orderNotes: cleanGlobalOrderNotes } : {}),
                  updatedAt: nowIso,
                };
                setDoc(doc(db, 'restaurant_tables', t.id), updatedTable, { merge: true }).catch(() => {});
                if (ACTIVE_STORE_ID) {
                  setDoc(
                    doc(db, 'stores', ACTIVE_STORE_ID, 'restaurant_tables', t.id),
                    updatedTable,
                    { merge: true }
                  ).catch(() => {});
                }
                return updatedTable;
              }
              return t;
            });
            localStorage.setItem('riskcart_restaurant_tables_v1', JSON.stringify(nextTables));
          }
        }
      } catch {}

      // 2. Persist order to Kitchen Pipeline (/kitchen) as 'New Order' + Firestore (`stores/{ACTIVE_STORE_ID}/orders` and `orders`)
      const kitchenCardDoc = {
        id: orderId,
        orderNumber: orderId,
        tableId: waiterTableInfo.id,
        tableNumber: waiterTableInfo.tableNumber,
        customerName: customerLabel.replace(/\s*\(M-\d+\)\s*$/i, '').trim() || customerLabel,
        items: orderItems.map((oi, idx) => ({
          id: `${orderId}_item_${idx}`,
          name: oi.name,
          qty: oi.qty,
          price: oi.unitPrice,
          ...(oi.notes ? { note: oi.notes, notes: oi.notes } : {}),
          checked: false,
        })),
        totalAmount,
        stage: 'New Order',
        kitchenStage: 'New Order',
        createdAt: nowIso,
        updatedAt: nowIso,
        waiterName: activeWaiterForOrder?.name || activeCashier?.name || 'Waiter POS',
        waiterRole: activeWaiterForOrder?.role || 'Waiter / Server',
        waiterDivision: activeWaiterForOrder?.divisionName || 'Divisi Service / Floor (Pelayanan Meja)',
        ...(cleanGlobalOrderNotes ? { orderNotes: cleanGlobalOrderNotes } : {}),
        notes: cleanGlobalOrderNotes
          ? `${cleanGlobalOrderNotes} (Meja ${waiterTableInfo.tableNumber})`
          : `Pesanan Waiter — Meja ${waiterTableInfo.tableNumber}`,
      };

      try {
        const rawKitchen = localStorage.getItem('riskcart_kitchen_orders_v1');
        const prevKitchen = rawKitchen ? JSON.parse(rawKitchen) : [];
        const nextKitchen = [
          kitchenCardDoc,
          ...(Array.isArray(prevKitchen) ? prevKitchen.filter((k: any) => k?.id !== orderId) : []),
        ];
        localStorage.setItem('riskcart_kitchen_orders_v1', JSON.stringify(nextKitchen));
      } catch {}

      if (addTransactionLocal) {
        addTransactionLocal(cleanOrderDoc as any);
      }

      await Promise.all([
        setDoc(doc(db, 'kitchen_orders', orderId), kitchenCardDoc, {
          merge: true,
        }).catch(() => {}),
        setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'kitchen_orders', orderId), kitchenCardDoc, {
          merge: true,
        }).catch(() => {}),
        setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'orders', orderId), cleanOrderDoc, {
          merge: true,
        }).catch(() => {}),
        setDoc(doc(db, 'orders', orderId), cleanOrderDoc, {
          merge: true,
        }).catch(() => {}),
        setDoc(doc(db, 'transactions', orderId), cleanOrderDoc, {
          merge: true,
        }).catch(() => {}),
      ]);

      // Broadcast real-time event across all open tabs (Dapur, Denah Meja, Antrean Pesanan, Kasir POS)
      publishRealtimeEvent('kitchen_updated', { newKitchenOrder: kitchenCardDoc });
      publishRealtimeEvent('orders_updated', { newOrder: cleanOrderDoc });
      publishRealtimeEvent('tables_updated', {
        tableId: waiterTableInfo.id,
        tableNumber: waiterTableInfo.tableNumber,
        status: 'occupied',
        orderId,
      });

      // 3. Clear cart & orderNotes and redirect to /dashboard/orders/new
      setCart([]);
      setOrderNotes('');
      try {
        localStorage.removeItem('riskcart_locked_cart');
        localStorage.removeItem('riskcart_waiter_order_notes');
      } catch {}

      if (onNavigateTab) {
        onNavigateTab('/dashboard/orders/new');
      } else {
        window.location.href = '/dashboard/orders/new';
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Complete Order / Payment
  const handlePayment = async () => {
    if (cart.length === 0) return;

    // EDC: wajib nomor approval/trace dari struk mesin EDC (anti-fraud)
    if (paymentMethod === 'edc' && edcApprovalCode.trim().length < 4) {
      setCashBlockModal({
        open: true,
        title: '⚠️ Kode Approval EDC Belum Diisi',
        message: 'Masukkan nomor Approval / Trace (min. 4 karakter) dari struk mesin EDC sebelum menyelesaikan transaksi kartu.',
      });
      return;
    }

    // 1. BLOKIR TRANSAKSI "TUNAI" JIKA BELUM INPUT PEMBAYARAN ATAU NOMINAL KURANG DARI TOTAL TAGIHAN
    if (paymentMethod === 'cash') {
      const rawCash = String(cashReceivedInput || '').trim();
      const numericCash = Number(rawCash) || 0;
      if (!rawCash || numericCash <= 0) {
        setCashBlockModal({
          open: true,
          title: '⚠️ Belum Memasukkan Pembayaran!',
          message:
            'Transaksi diblokir karena Anda memilih metode Tunai tetapi belum memasukkan nominal Uang Diterima. Silakan masukkan jumlah uang tunai yang diterima terlebih dahulu.',
        });
        return;
      }
      if (numericCash < displayTotal) {
        setCashBlockModal({
          open: true,
          title: '⚠️ Nominal Pembayaran Tunai Kurang!',
          message: `Transaksi diblokir karena nominal Uang Diterima (${
            currencyMode === 'IDR'
              ? `Rp ${numericCash.toLocaleString('id-ID')}`
              : `$${numericCash.toFixed(2)}`
          }) masih kurang dari Total Tagihan (${formatMoney(
            total
          )}). Silakan masukkan jumlah uang tunai minimal sesuai total belanja.`,
        });
        return;
      }
    }

    setIsProcessing(true);

    try {
      const catalogProductsForTx = [
        ...(Array.isArray(ctxProducts) ? ctxProducts : []),
        ...(Array.isArray(products) ? products : []),
      ];

      const findCatalogProduct = (itemProd: any) => {
        const tId = String(itemProd?.id ?? '').trim().toLowerCase();
        const tSku = String(itemProd?.sku ?? '').trim().toLowerCase();
        const tName = String(itemProd?.name ?? '').trim().toLowerCase();
        return catalogProductsForTx.find((cp: any) => {
          const cpId = String(cp?.id ?? '').trim().toLowerCase();
          const cpSku = String(cp?.sku ?? '').trim().toLowerCase();
          const cpName = String(cp?.name ?? '').trim().toLowerCase();
          return (tId && cpId === tId) || (tSku && cpSku === tSku) || (tName && cpName === tName);
        });
      };

      // Calculate real cost based on original product costPrice / buyPrice / modal / costPerUnit from /dashboard/produk (1 product = 1 Dus)
      const calculatedTotalCost = cart.reduce((sum, item) => {
        const p = item.product as any;
        const matchedProduct: any = findCatalogProduct(p);
        const costUnit = Number(
          matchedProduct?.costPrice ??
            matchedProduct?.buyPrice ??
            matchedProduct?.modal ??
            matchedProduct?.costPerUnit ??
            p.costPrice ??
            p.buyPrice ??
            p.modal ??
            p.costPerUnit ??
            0
        );
        return sum + costUnit * item.quantity;
      }, 0);

      const itemsPayload = cart.map((c) => {
        const p = c.product as any;
        const matchedProduct: any = findCatalogProduct(p);
        const qty = Number(c.quantity || 1);
        const unitCost = Number(
          matchedProduct?.costPrice ??
            matchedProduct?.buyPrice ??
            matchedProduct?.modal ??
            matchedProduct?.costPerUnit ??
            p.costPrice ??
            p.buyPrice ??
            p.modal ??
            p.costPerUnit ??
            0
        );
        const unitPrice = Number(
          p.posPrice ??
            p.pricePerUnit ??
            p.sellPrice ??
            p.pricePerCarton ??
            matchedProduct?.posPrice ??
            matchedProduct?.pricePerUnit ??
            matchedProduct?.sellPrice ??
            0
        );
        const lineSubtotal = Number((qty * unitPrice).toFixed(2));
        const lineCost = Number((qty * unitCost).toFixed(2));
        const lineProfit = Number((lineSubtotal - lineCost).toFixed(2));
        const unitsDeducted = qty;
        const fefoPreview = deductFefoBatches(p, unitsDeducted);
        return {
          productId: c.product.id,
          productName: c.product.name,
          name: c.product.name,
          sku: c.product.sku || c.product.id,
          category: c.product.category || 'UMUM',
          brand: c.product.brand || '',
          packageType: 'unit' as PackageType,
          quantityOrdered: qty,
          qty,
          quantity: qty,
          unitsDeducted,
          price: unitPrice,
          unitPrice,
          sellingPrice: unitPrice,
          unitCost: Number(unitCost.toFixed(2)),
          costPrice: Number(unitCost.toFixed(2)),
          hargaModal: Number(unitCost.toFixed(2)),
          subtotal: lineSubtotal,
          totalModal: lineCost,
          totalCost: lineCost,
          totalUntung: lineProfit,
          profit: lineProfit,
          batchCode: fefoPreview.deductedBreakdown[0]?.batchCode || '',
          ...(c.notes ? { notes: c.notes.trim(), note: c.notes.trim() } : {}),
          fefoBatchesUsed: fefoPreview.deductedBreakdown.map((b) => ({
            batchCode: b.batchCode,
            deductedQty: b.deductedQty,
            expiryDate: b.expiryDate,
            productionDate: b.productionDate,
          })),
        };
      });

      // Call server AI anti-fraud
      let aiData: any = {};
      try {
        const aiRes = await fetch('/api/ai/anti-fraud', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'pos',
            totalAmount: total,
            items: itemsPayload,
            customerPhone: 'Walk-in Cashier Counter',
            gpsAccuracy: 5,
            language,
          }),
        });
        aiData = await aiRes.json();
      } catch (e) {
        console.warn('AI anti-fraud check notice:', e);
      }

      // Build transaction timestamp from selected orderDate + current time of day
      const nowObj = new Date();
      const selectedOrderDateStr = orderDate || nowObj.toLocaleDateString('en-CA');
      const [yPart, mPart, dPart] = selectedOrderDateStr.split('-').map(Number);
      const combinedOrderDateObj =
        yPart && mPart && dPart
          ? new Date(
              yPart,
              mPart - 1,
              dPart,
              nowObj.getHours(),
              nowObj.getMinutes(),
              nowObj.getSeconds(),
              nowObj.getMilliseconds()
            )
          : nowObj;
      const txNowIso = isNaN(combinedOrderDateObj.getTime())
        ? nowObj.toISOString()
        : combinedOrderDateObj.toISOString();
      const normalizedCost = Number(calculatedTotalCost.toFixed(2));
      const calculatedTotalProfit = Number((total - normalizedCost).toFixed(2));
      const totalItemsCount = cart.reduce((acc, c) => acc + c.quantity, 0);

      // Determine canonical payment & fulfillment states based on Tunai | Hutang | COD | QRIS + Pengirim
      const isQrisPayment = paymentMethod === 'qris';
      const isPaidNow = paymentMethod === 'cash' || paymentMethod === 'edc';
      const paymentStatus: 'paid' | 'unpaid' | 'PENDING' = isQrisPayment
        ? 'PENDING'
        : isPaidNow
        ? 'paid'
        : 'unpaid';
      const paymentMethodLabel =
        paymentMethod === 'debt'
          ? 'Hutang'
          : paymentMethod === 'cod'
          ? 'COD'
          : paymentMethod === 'qris'
          ? 'QRIS'
          : paymentMethod === 'edc'
          ? 'EDC Debit/Kredit'
          : 'Tunai';

      // If COD is selected and no sender was picked yet, default to first Shipper / staff
      const effectiveSender: StaffMemberItem | null =
        selectedSenderStaff ||
        (paymentMethod === 'cod' ? senderStaffOptions[0] || null : null);

      const effectiveDeliveryCommission = effectiveSender
        ? cart.reduce((sum, item) => {
            const p = item.product as any;
            const comm = Number(p.deliveryCommission ?? p.komisiPengirim ?? 0);
            return sum + comm * item.quantity;
          }, 0)
        : 0;

      const effectiveCustomerName =
        paymentMethod === 'debt' &&
        (!selectedCustomer.trim() || selectedCustomer.trim().toLowerCase() === 'walk-in customer')
          ? 'Pelanggan Kasbon (POS)'
          : selectedCustomer.trim() || 'Walk-in Customer';

      const effectivePhone =
        customerPhoneInput.trim() || 'Walk-in Cashier Counter';
      const effectiveAddress =
        customerAddressInput.trim() || posSettings?.storeName || 'Kasir POS Toko';

      // Convert cashGiven to internal IDR scale to check if partial down-payment was given on Hutang
      const cashPaidIdr =
        currencyMode === 'IDR'
          ? Math.round(cashGiven)
          : Math.round(cashGiven * activeRate);
      const debtPaidAmountIdr =
        paymentMethod === 'debt' ? Math.min(total, Math.max(0, cashPaidIdr)) : isPaidNow ? total : 0;
      const debtRemainingIdr =
        paymentMethod === 'debt'
          ? Math.max(0, total - debtPaidAmountIdr)
          : paymentMethod === 'cod'
          ? total
          : 0;

      const isFulfillingWaiterOrTableOrder = Boolean(
        (activeFulfillingPwaOrder as any)?.tableId ||
          (activeFulfillingPwaOrder as any)?.tableNumber ||
          String(activeFulfillingPwaOrder?.id || '').startsWith('ORD-WTR-')
      );

      const orderStatusForOrdersModule =
        isFulfillingWaiterOrTableOrder && isPaidNow ? 'Terkirim' : 'New';
      const txFulfillmentStatus =
        isFulfillingWaiterOrTableOrder && isPaidNow ? 'Terkirim' : 'New';

      const cleanCashierStr = (val: any): string => {
        const s = String(val ?? '').trim();
        return s && s !== '-' ? s : '';
      };
      const resolvedActiveCashierName =
        cleanCashierStr(activeShift?.cashierName) ||
        cleanCashierStr(activeShift?.staffName) ||
        cleanCashierStr((ctxActiveCashier as any)?.name) ||
        cleanCashierStr((ctxActiveCashier as any)?.displayName) ||
        cleanCashierStr(activeCashier?.name);

      const newTx: Omit<Transaction, 'id'> & Record<string, any> = {
        storeId: ACTIVE_STORE_ID,
        outletId: posSettings?.selectedOutlet || 'OUT-01',
        channel: 'pos',
        source: 'POS',
        ...((activeFulfillingPwaOrder as any)?.tableId
          ? { tableId: (activeFulfillingPwaOrder as any).tableId }
          : {}),
        ...((activeFulfillingPwaOrder as any)?.tableNumber
          ? { tableNumber: (activeFulfillingPwaOrder as any).tableNumber }
          : {}),
        ...(orderNotes.trim() || (activeFulfillingPwaOrder as any)?.orderNotes
          ? { orderNotes: orderNotes.trim() || (activeFulfillingPwaOrder as any)?.orderNotes }
          : {}),
        customerName: effectiveCustomerName,
        customerPhone: effectivePhone,
        customerAddress: effectiveAddress,
        subtotal: Number(subtotal.toFixed(2)),
        discountPct,
        discountAmount: Number(discountAmount.toFixed(2)),
        discountApprovedBy: discountPct > 0 ? discountApprovedBy || 'within_cashier_limit' : null,
        serviceChargeRate,
        serviceChargeAmount: Number(serviceChargeAmount.toFixed(2)),
        edcApprovalCode: paymentMethod === 'edc' ? edcApprovalCode.trim() : null,
        taxRate,
        taxAmount: Number(taxAmount.toFixed(2)),
        roundingDifference: Number(roundingDifference.toFixed(2)),
        cashRoundingMode: posSettings?.cashRoundingMode || 'floor_100',
        total: total,
        totalAmount: total,
        totalCost: normalizedCost,
        totalModal: normalizedCost,
        totalProfit: calculatedTotalProfit,
        keuntungan: calculatedTotalProfit,
        paymentMethod: paymentMethod === 'edc' ? 'card' : paymentMethod,
        paymentMethodLabel,
        paymentStatus,
        paidAmount: debtPaidAmountIdr,
        remainingDebt: debtRemainingIdr,
        dueDate: paymentMethod === 'debt' ? debtDueDate : null,
        status: (isPaidNow ? 'completed' : 'New') as any,
        fulfillmentStatus: txFulfillmentStatus as any,
        fraudScore: aiData?.fraudScore || 5,
        fraudFlags: aiData?.fraudFlags || ['VERIFIED_POS_COUNTER'],
        riskLevel: 'clean',
        distanceToStoreMeters: 2,
        gpsAccuracy: 5,
        aiExplanation: `In-store retail POS register sale (${paymentMethodLabel}) authenticated by cashier: ${resolvedActiveCashierName} (${activeCashier.role}).`,
        cashierId: activeCashier.id || 'staff_001',
        cashier: resolvedActiveCashierName,
        cashierName: resolvedActiveCashierName,
        staffName: resolvedActiveCashierName,
        cashierRole: activeCashier.role,
        cashierEmail: activeCashier.email,
        deliveryStaffId: effectiveSender?.id || null,
        deliveryStaffName: effectiveSender?.name || null,
        deliveryStaffRole: effectiveSender?.role || null,
        deliveryStaffPhone: effectiveSender?.phone || null,
        deliveryCommission: effectiveDeliveryCommission,
        shiftId: activeShiftId,
        items: itemsPayload as any,
        itemsCount: totalItemsCount,
        stockReconciled: true,
        stockReconciledAt: txNowIso,
        orderDate: selectedOrderDateStr,
        timestamp: txNowIso,
        date: txNowIso,
        createdAt: txNowIso,
        updatedAt: txNowIso,
      };

      // 1. If fulfilling an active PWA or Waiter order loaded into cart, reuse its canonical ID so we update the existing order/tx
      const existingPwaId = activeFulfillingPwaOrder?.id || null;
      const existingLinkedOrderId = (activeFulfillingPwaOrder as any)?.orderId || existingPwaId;
      const existingLinkedTxId = (activeFulfillingPwaOrder as any)?.transactionId || existingPwaId;

      let docId = existingPwaId || '';
      if (docId) {
        await setDoc(
          doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', docId),
          {
            ...newTx,
            id: docId,
            channel: isFulfillingWaiterOrTableOrder ? 'pos' : 'pwa_client',
            source: isFulfillingWaiterOrTableOrder
              ? 'Waiter Dine-In (POS Fulfilled)'
              : 'Client PWA (POS Fulfilled)',
            orderDate: selectedOrderDateStr,
            timestamp: txNowIso,
          },
          { merge: true }
        );
      } else {
        const docRef = await addDoc(collection(db, 'stores', ACTIVE_STORE_ID, 'transactions'), {
          ...newTx,
          orderDate: selectedOrderDateStr,
          timestamp: txNowIso,
        });
        docId = docRef.id;
      }

      const docRef = { id: docId };
      const canonicalSyncKey = (activeFulfillingPwaOrder as any)?.canonicalSyncKey || `DOC_${docRef.id}`;
      const orderNumber =
        (activeFulfillingPwaOrder as any)?.orderNumber || `POS-${docRef.id.slice(-6).toUpperCase()}`;

      // Optimistic local state update in AppDataContext (0ms UI reflection across Dashboard & Reports)
      addTransactionLocal({
        id: docRef.id,
        ...newTx,
        orderNumber,
        canonicalSyncKey,
      } as any);

      // 2. Accumulate stock deductions per product
      const deductedByProduct = new Map<string, number>();

      for (const item of cart) {
        const p = item.product as any;
        const unitPrice = Number(
          p.posPrice ?? p.pricePerUnit ?? p.sellPrice ?? p.pricePerCarton ?? 0
        );
        const unitCost = Number(p.costPrice ?? p.costPerUnit ?? 0);
        const itemSubtotal = unitPrice * item.quantity;
        const unitsDeducted = item.quantity;

        deductedByProduct.set(
          item.product.id,
          (deductedByProduct.get(item.product.id) || 0) + unitsDeducted
        );

        const lineItem = {
          storeId: ACTIVE_STORE_ID,
          transactionId: docRef.id,
          productId: item.product.id,
          productName: item.product.name,
          name: item.product.name,
          sku: item.product.sku || item.product.id,
          category: item.product.category || 'UMUM',
          packageType: 'unit' as PackageType,
          quantityOrdered: item.quantity,
          qty: item.quantity,
          quantity: item.quantity,
          unitsDeducted,
          price: unitPrice,
          unitPrice,
          sellingPrice: unitPrice,
          costPrice: unitCost,
          unitCost,
          subtotal: Number(itemSubtotal.toFixed(2)),
        };

        await Promise.all([
          addDoc(collection(db, 'stores', ACTIVE_STORE_ID, 'transactions', docRef.id, 'items'), lineItem),
          addDoc(collection(db, 'transactions', docRef.id, 'items'), lineItem),
        ]);
      }

      // 3. Deduct stock in Firestore via productService.ts (Multi-Batch FEFO) and update local state
      const stockDeductionList: Array<{
        productId: string;
        productName: string;
        currentStock: number;
        unitsDeducted: number;
        product?: any;
        updatedBatches?: any[];
        nearestProductionDate?: string;
        nearestExpiryDate?: string;
        fefoBatchesUsed?: any[];
      }> = [];

      deductedByProduct.forEach((totalUnitsDeducted, productId) => {
        const currentProd = products.find((p) => p.id === productId);
        if (currentProd) {
          const fefoRes = deductFefoBatches(currentProd, totalUnitsDeducted);
          const nextStock = fefoRes.nextStock;
          const nextProdDate =
            fefoRes.nearestBatch?.productionDate || currentProd.productionDate || '';
          const nextExpDate =
            fefoRes.nearestBatch?.expiryDate || currentProd.expiryDate || '';

          stockDeductionList.push({
            productId,
            productName: currentProd.name,
            currentStock: currentProd.stockInUnits,
            unitsDeducted: totalUnitsDeducted,
            product: currentProd,
            updatedBatches: fefoRes.updatedBatches,
            nearestProductionDate: nextProdDate,
            nearestExpiryDate: nextExpDate,
            fefoBatchesUsed: fefoRes.deductedBreakdown,
          });
          upsertProductLocal({
            ...currentProd,
            stockInUnits: nextStock,
            batches: fefoRes.updatedBatches,
            productionDate: nextProdDate,
            tanggalProduksi: nextProdDate,
            expiryDate: nextExpDate,
            tanggalKadaluarsa: nextExpDate,
            updatedAt: txNowIso,
          });
        }
      });

      await deductProductStockInFirestore(stockDeductionList, docRef.id, 'pos');

      // 4. Mirror transaction to root `transactions` collection AND `orders` collections (`stores/store_001/orders` & `orders`)
      const orderPayload = {
        id: docRef.id,
        transactionId: docRef.id,
        orderId: docRef.id,
        canonicalSyncKey,
        storeId: ACTIVE_STORE_ID,
        outletId: posSettings?.selectedOutlet || 'OUT-01',
        orderNumber,
        customerName: effectiveCustomerName,
        customerPhone: effectivePhone,
        customerAddress: effectiveAddress,
        channel: 'pos',
        source: 'POS',
        itemsCount: totalItemsCount,
        items: itemsPayload,
        subtotal: Number(subtotal.toFixed(2)),
        taxRate,
        taxAmount: Number(taxAmount.toFixed(2)),
        roundingDifference: Number(roundingDifference.toFixed(2)),
        totalCost: normalizedCost,
        totalModal: normalizedCost,
        total: total,
        totalAmount: total,
        totalProfit: calculatedTotalProfit,
        keuntungan: calculatedTotalProfit,
        status: orderStatusForOrdersModule,
        fulfillmentStatus: txFulfillmentStatus,
        paymentMethod: paymentMethodLabel,
        paymentStatus,
        paidAmount: debtPaidAmountIdr,
        remainingDebt: debtRemainingIdr,
        dueDate: paymentMethod === 'debt' ? debtDueDate : null,
        deliveryStaffId: effectiveSender?.id || null,
        deliveryStaffName: effectiveSender?.name || null,
        deliveryStaffRole: effectiveSender?.role || null,
        deliveryStaffPhone: effectiveSender?.phone || null,
        deliveryCommission: effectiveDeliveryCommission,
        assignedAt: effectiveSender ? txNowIso : null,
        cashierId: activeCashier.id || 'staff_001',
        cashier: resolvedActiveCashierName,
        cashierName: resolvedActiveCashierName,
        staffName: resolvedActiveCashierName,
        cashierRole: activeCashier.role,
        shiftId: activeShiftId,
        notes: effectiveSender
          ? `Transaksi POS (${paymentMethodLabel}) • Kasir: ${resolvedActiveCashierName} • Pengirim: ${effectiveSender.name}`
          : `Transaksi Kasir POS (${paymentMethodLabel}) oleh ${resolvedActiveCashierName}`,
        stockReconciled: true,
        stockReconciledAt: txNowIso,
        orderDate: selectedOrderDateStr,
        timestamp: txNowIso,
        date: txNowIso,
        createdAt: txNowIso,
        updatedAt: txNowIso,
      };

      const formattedDateStr = new Date(txNowIso).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

      const writes: Promise<any>[] = [
        setDoc(
          doc(db, 'transactions', docRef.id),
          {
            ...newTx,
            id: docRef.id,
            orderNumber,
            canonicalSyncKey,
            orderDate: selectedOrderDateStr,
            timestamp: txNowIso,
          },
          { merge: true }
        ),
        setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'orders', docRef.id), orderPayload, {
          merge: true,
        }),
        setDoc(doc(db, 'orders', docRef.id), orderPayload, { merge: true }),
      ];

      // Also mark any linked PWA order IDs as completed so they immediately leave Antrean PWA
      if (existingLinkedOrderId && existingLinkedOrderId !== docRef.id) {
        writes.push(
          setDoc(doc(db, 'orders', existingLinkedOrderId), { status: 'completed', fulfillmentStatus: 'completed', updatedAt: txNowIso }, { merge: true }),
          setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'orders', existingLinkedOrderId), { status: 'completed', fulfillmentStatus: 'completed', updatedAt: txNowIso }, { merge: true })
        );
      }
      if (existingLinkedTxId && existingLinkedTxId !== docRef.id) {
        writes.push(
          setDoc(doc(db, 'transactions', existingLinkedTxId), { status: 'completed', fulfillmentStatus: 'completed', updatedAt: txNowIso }, { merge: true }),
          setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', existingLinkedTxId), { status: 'completed', fulfillmentStatus: 'completed', updatedAt: txNowIso }, { merge: true })
        );
      }

      // 5. Record realized cash mutation in `cash_flows` and `pos_incomes` ONLY for paid transactions (Tunai / QRIS) or partial DP on Hutang
      const realizedCashAmount = isPaidNow ? total : debtPaidAmountIdr;
      if (realizedCashAmount > 0) {
        const cashFlowPayload = {
          id: `CF-${docRef.id}`,
          transactionId: docRef.id,
          storeId: ACTIVE_STORE_ID,
          outletId: posSettings?.selectedOutlet || 'OUT-01',
          type: 'in',
          category: isPaidNow ? 'Penjualan Kasir POS' : 'DP / Cicilan Awal Hutang POS',
          source: 'POS',
          method: paymentMethodLabel,
          paymentMethod: isPaidNow ? newTx.paymentMethod : 'cash',
          paymentStatus: 'paid',
          amount: realizedCashAmount,
          totalCost: normalizedCost,
          profit: calculatedTotalProfit,
          customerName: effectiveCustomerName,
          cashierName: activeCashier.name,
          deliveryStaffName: effectiveSender?.name || null,
          shiftId: activeShiftId,
          description: `Penjualan POS (${paymentMethodLabel}) #${orderNumber} - ${effectiveCustomerName}`,
          note: `Penjualan POS #${orderNumber} (${totalItemsCount} item • ${paymentMethodLabel})`,
          orderDate: selectedOrderDateStr,
          timestamp: txNowIso,
          date: formattedDateStr,
          createdAt: txNowIso,
          updatedAt: txNowIso,
        };

        writes.push(
          setDoc(doc(db, 'cash_flows', `CF-${docRef.id}`), cashFlowPayload, { merge: true }),
          setDoc(
            doc(db, 'pos_incomes', `INC-${docRef.id}`),
            {
              id: `INC-${docRef.id}`,
              transactionId: docRef.id,
              source: `Penjualan POS #${orderNumber} (${effectiveCustomerName})`,
              category: isPaidNow ? 'Penjualan Kasir POS' : 'DP / Cicilan Awal Hutang POS',
              customer: effectiveCustomerName,
              cashierName: activeCashier.name,
              deliveryStaffName: effectiveSender?.name || null,
              shiftId: activeShiftId,
              method: paymentMethodLabel,
              paymentStatus: 'paid',
              amount: realizedCashAmount,
              note: `Transaksi POS (${paymentMethodLabel}) oleh ${activeCashier.name}`,
              orderDate: selectedOrderDateStr,
              timestamp: txNowIso,
              date: formattedDateStr,
              createdAt: txNowIso,
              updatedAt: txNowIso,
            },
            { merge: true }
          )
        );
      }

      // 6. If paymentMethod === 'debt' (Hutang), record receivable in `hutang_pelanggan` AND sync to `stores/store_001/customers`
      if (paymentMethod === 'debt') {
        writes.push(
          setDoc(
            doc(db, 'hutang_pelanggan', `DEBT-${docRef.id}`),
            {
              id: `DEBT-${docRef.id}`,
              transactionId: docRef.id,
              customerName: effectiveCustomerName,
              phone: effectivePhone,
              address: effectiveAddress,
              invoiceNumber: orderNumber,
              totalDebt: total,
              remainingDebt: debtRemainingIdr,
              paidAmount: debtPaidAmountIdr,
              status: debtRemainingIdr <= 0 ? 'Lunas' : 'Belum Lunas',
              dueDate: debtDueDate,
              cashierName: activeCashier.name,
              deliveryStaffName: effectiveSender?.name || null,
              notes: `Hutang / Kasbon POS #${orderNumber}`,
              createdAt: txNowIso,
              updatedAt: txNowIso,
            },
            { merge: true }
          )
        );

        // Also update or create customer document in `stores/store_001/customers` so CustomerModule (Hutang Pelanggan) reflects it immediately
        const matchedCust = storeCustomers.find(
          (c) => (c.name || '').trim().toLowerCase() === effectiveCustomerName.toLowerCase()
        );
        const custDocId =
          matchedCust?.id ||
          `CUST-${effectiveCustomerName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8) || Date.now().toString().slice(-6)}`;
        const prevDebt = Number(matchedCust?.debtAmount || 0);
        const prevSpent = Number(matchedCust?.totalSpent || 0);
        writes.push(
          setDoc(
            doc(db, 'stores', ACTIVE_STORE_ID, 'customers', custDocId),
            {
              id: custDocId,
              name: effectiveCustomerName,
              phone: matchedCust?.phone && matchedCust.phone !== '-' ? matchedCust.phone : effectivePhone,
              address: matchedCust?.address && matchedCust.address !== '-' ? matchedCust.address : effectiveAddress,
              type: matchedCust?.type || 'Pelanggan Reguler',
              creditLimit: Number(matchedCust?.creditLimit || 5000000),
              points: Number(matchedCust?.points || 0),
              debtAmount: prevDebt + debtRemainingIdr,
              debtAgeDays: matchedCust?.debtAgeDays || 1,
              dueDate: debtDueDate,
              totalSpent: prevSpent + total,
              lastTransactionDate: formattedDateStr,
              status: 'active',
              updatedAt: txNowIso,
            },
            { merge: true }
          )
        );
      }

      // 7. If a Pengirim (Delivery Staff) was assigned, record delivery & commission in `staff_deliveries`
      if (effectiveSender) {
        writes.push(
          setDoc(
            doc(db, 'staff_deliveries', `DELIV-${docRef.id}`),
            {
              id: `DELIV-${docRef.id}`,
              transactionId: docRef.id,
              orderNumber,
              staffId: effectiveSender.id,
              staffName: effectiveSender.name,
              staffRole: effectiveSender.role,
              staffPhone: effectiveSender.phone || '-',
              customerName: effectiveCustomerName,
              customerAddress: effectiveAddress,
              itemsCount: totalItemsCount,
              totalOrderAmount: total,
              commissionAmount: effectiveDeliveryCommission,
              paymentMethod: paymentMethodLabel,
              paymentStatus,
              status: orderStatusForOrdersModule,
              cashierName: activeCashier.name,
              createdAt: txNowIso,
              updatedAt: txNowIso,
            },
            { merge: true }
          )
        );
      }

      await Promise.all(writes);

      // If this checkout fulfilled a Waiter / Dine-In / Table order (or had a table assigned), complete Kitchen Order & reset Table to Available
      if (isFulfillingWaiterOrTableOrder && isPaidNow) {
        void completeTableAndKitchenOrderOnPayment({
          orderId: docRef.id,
          tableId: (activeFulfillingPwaOrder as any)?.tableId,
          tableNumber: (activeFulfillingPwaOrder as any)?.tableNumber,
          customerName: effectiveCustomerName,
          waiterName: (activeFulfillingPwaOrder as any)?.cashierName || resolvedActiveCashierName,
          totalAmount: total,
          paymentMethod: paymentMethodLabel,
          items: itemsPayload.map((it: any) => ({
            name: it.productName || it.name,
            qty: it.quantityOrdered || it.qty || 1,
            price: it.unitPrice || it.price || 0,
            ...(it.notes ? { notes: it.notes } : {}),
          })),
        });
      }

      // Broadcast real-time updates to all open browser tabs
      publishRealtimeEvent('transactions_updated', {
        transaction: { id: docRef.id, ...newTx, orderNumber, canonicalSyncKey },
      });
      publishRealtimeEvent('orders_updated', {
        newOrder: orderPayload,
      });
      publishRealtimeEvent('finance_updated', {
        transactionId: docRef.id,
        amount: realizedCashAmount,
      });

      // 8. Notify centralized background stock sync service (alreadyDeductedInCaller = true prevents double deduction)
      void reconcileCompletedTransaction(
        docRef.id,
        { ...newTx, canonicalSyncKey },
        'transactions',
        { alreadyDeductedInCaller: true }
      );

      const effectiveCashPaid =
        paymentMethod === 'debt' || paymentMethod === 'cod'
          ? cashGiven
          : Math.max(cashGiven, displayTotal);
      const effectiveChange =
        paymentMethod === 'debt' || paymentMethod === 'cod' || paymentMethod === 'edc' || isQrisPayment ? 0 : change;

      // 9. Automatically create Google Sheet for completed transaction (FileName = Nomor Transaksi / orderNumber)
      const driveSyncResult = await syncTransactionToGoogleDrive({
        id: orderNumber,
        transactionId: docRef.id,
        orderNumber,
        fileName: orderNumber,
        type: 'TRANSACTION_DOC',
        createdAt: txNowIso,
        orderDate: selectedOrderDateStr,
        cashier: resolvedActiveCashierName,
        cashierName: resolvedActiveCashierName,
        staffName: resolvedActiveCashierName,
        deliveryStaffName: effectiveSender?.name || '',
        customerName: effectiveCustomerName,
        customerPhone: effectivePhone,
        customerAddress: effectiveAddress,
        paymentMethod: newTx.paymentMethod,
        paymentMethodLabel,
        paymentStatus,
        items: itemsPayload,
        subtotal,
        totalCost: normalizedCost,
        totalModal: normalizedCost,
        hargaModal: normalizedCost,
        totalProfit: calculatedTotalProfit,
        totalUntung: calculatedTotalProfit,
        keuntungan: calculatedTotalProfit,
        taxRate,
        taxAmount,
        roundingDifference,
        totalAmount: total,
        total,
        cashPaid: effectiveCashPaid,
        paidAmount: debtPaidAmountIdr,
        change: effectiveChange,
        remainingDebt: debtRemainingIdr,
      });

      // Persist googleDocUrl to Firestore transaction & order documents
      void Promise.all([
        setDoc(
          doc(db, 'transactions', docRef.id),
          { googleDocUrl: driveSyncResult.googleDocUrl, googleDocFileName: orderNumber },
          { merge: true }
        ).catch(() => {}),
        setDoc(
          doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', docRef.id),
          { googleDocUrl: driveSyncResult.googleDocUrl, googleDocFileName: orderNumber },
          { merge: true }
        ).catch(() => {}),
        setDoc(
          doc(db, 'orders', docRef.id),
          { googleDocUrl: driveSyncResult.googleDocUrl, googleDocFileName: orderNumber },
          { merge: true }
        ).catch(() => {}),
        setDoc(
          doc(db, 'stores', ACTIVE_STORE_ID, 'orders', docRef.id),
          { googleDocUrl: driveSyncResult.googleDocUrl, googleDocFileName: orderNumber },
          { merge: true }
        ).catch(() => {}),
      ]);

      const receiptDataPayload = {
        id: docRef.id,
        orderNumber,
        ...newTx,
        items: cart,
        cashPaid: effectiveCashPaid,
        change: effectiveChange,
        taxRate,
        taxAmount,
        subtotal,
        roundingDifference,
        googleDocUrl: driveSyncResult.googleDocUrl,
        googleDocFileName: orderNumber,
        storeFooterNote: posSettings?.storeFooterNote,
        storeName: posSettings?.storeName,
        storeAddress: posSettings?.storeAddress,
        discountPct,
        discountAmount,
        serviceChargeRate,
        serviceChargeAmount,
      };

      // Reset the cart state & remove fulfilled PWA order from queue if applicable
      if (activeFulfillingPwaOrder) {
        const fulfilledId = activeFulfillingPwaOrder.id;
        setPwaOrdersQueue((prev) => {
          const next = prev.filter((o) => o.id !== fulfilledId);
          setIncomingPwaOrder(next[0] || null);
          return next;
        });
        setActiveFulfillingPwaOrder(null);
      }
      executeAuthorizedCartClear();

      // If QRIS DOKU is selected, generate Dynamic QRIS (< 1s with EMVCo fallback) and open Hybrid QRIS Modal
      if (isQrisPayment) {
        const grossIdr = Math.max(1, Math.round(total));
        const mdrFeeIdr = Math.round(grossIdr * 0.007);
        const netIdr = Math.max(0, grossIdr - mdrFeeIdr);
        let qrisDataUrl = '';
        let qrisString = '';
        let dokuPaymentId = `DOKU-QRIS-${orderNumber.replace(/[^A-Z0-9]/gi, '').slice(-8).toUpperCase()}`;

        let qrisError = '';
        try {
          const qr = await paymentGatewayApi.createQris({
            transactionId: docRef.id,
            invoiceNumber: orderNumber,
            amount: grossIdr,
            customerName: effectiveCustomerName,
          });
          qrisDataUrl = qr.qrCodeDataUrl;
          qrisString = qr.qrString || qr.checkoutUrl || '';
          dokuPaymentId = qr.paymentId || dokuPaymentId;
        } catch (err: any) {
          qrisError = err?.message || 'Gagal membuat QRIS';
        }

        // TIDAK ada QR palsu: jika gateway gagal, transaksi tetap PENDING dan kasir diberi tahu
        if (!qrisDataUrl) {
          await setDoc(
            doc(db, 'transactions', docRef.id),
            { paymentStatus: 'QRIS_FAILED', qrisError, updatedAt: new Date().toISOString() },
            { merge: true }
          ).catch(() => {});
          alert(`QRIS gagal dibuat: ${qrisError}\nPilih metode bayar lain atau cek Pengaturan > Payment Gateway.`);
          return;
        }

        // Ensure PENDING settlement log exists in Firestore `doku_settlements`
        await setDoc(
          doc(db, 'doku_settlements', docRef.id),
          {
            id: docRef.id,
            transactionId: docRef.id,
            paymentId: dokuPaymentId,
            orderId: orderNumber,
            invoiceNumber: orderNumber,
            customerName: effectiveCustomerName,
            cashierName: activeCashier.name,
            gateway: 'DOKU',
            channel: 'QRIS DOKU',
            paymentMethod: 'QRIS DOKU',
            amount: grossIdr,
            fee: mdrFeeIdr,
            mdrFee: mdrFeeIdr,
            netAmount: netIdr,
            qrString: qrisString,
            mode: dokuGatewayCreds.mode,
            status: 'PENDING',
            paymentStatus: 'PENDING',
            createdAt: txNowIso,
            updatedAt: txNowIso,
          },
          { merge: true }
        ).catch(() => {});

        setActiveQrisSession({
          transactionId: docRef.id,
          invoiceNumber: orderNumber,
          paymentId: dokuPaymentId,
          customerName: effectiveCustomerName,
          amount: grossIdr,
          mdrFee: mdrFeeIdr,
          netAmount: netIdr,
          qrString: qrisString,
          qrCodeDataUrl: qrisDataUrl,
          mode: dokuGatewayCreds.mode,
          status: 'PENDING',
          receiptPayload: receiptDataPayload,
        });
        void logRealAudit({
          action: 'POS_CREATE_QRIS_INVOICE',
          module: 'POS Kasir & Payment Gateway',
          details: `Membuat tagihan QRIS (${activeGatewayLabel}) #${orderNumber} sebesar Rp ${grossIdr.toLocaleString('id-ID')} untuk ${effectiveCustomerName}`,
          severity: 'info',
        });
      } else {
        setCompletedTxReceipt(receiptDataPayload);
        // Auto-print struk jika diaktifkan di Pengaturan > Printer & Struk
        if (posSettings?.autoPrintReceipt) {
          void printReceipt(receiptDataPayload, posSettings).catch(() => {});
        }
        // Umum: buka laci otomatis setelah pembayaran tunai
        if (paymentMethod === 'cash' && posSettings?.autoOpenCashDrawerOnCash !== false) {
          void kickCashDrawer(posSettings).then((r) => {
            if (!r.ok && posSettings?.printerInterface === 'network') setDrawerToast(r.message);
          });
        }
        void logRealAudit({
          action: 'POS_TRANSACTION_COMPLETED',
          module: 'POS Kasir',
          details: `Transaksi POS #${orderNumber} (${paymentMethodLabel}) sebesar Rp ${Math.round(total).toLocaleString('id-ID')} oleh ${resolvedActiveCashierName}`,
          severity: 'info',
        });
        try {
          confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
        } catch (e) {}
      }
      setDiscountPct(0);
      setDiscountApprovedBy(null);
      setEdcApprovalCode('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'stores/store_001/transactions');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePayOrder = handlePayment;

  // Action on incoming PWA order (Fulfill or Reject) — synchronizes orders, transactions, products stock, and cash_flows
  const handlePwaAction = async (action: 'approve' | 'reject', targetOrder?: Transaction) => {
    const order = targetOrder || incomingPwaOrder;
    if (!order) return;

    try {
      const nowIso = new Date().toISOString();
      const formattedDateStr = new Date(nowIso).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      const anyOrder = order as any;
      const orderTotal = Number(order.totalAmount ?? anyOrder.total ?? 0);
      const orderCost = Number(order.totalCost ?? anyOrder.totalModal ?? 0);
      const orderProfit = Number(anyOrder.totalProfit ?? orderTotal - orderCost);
      const rawPm = String(order.paymentMethod || 'cash').toLowerCase();
      const isDebt = rawPm === 'debt' || rawPm === 'hutang' || rawPm.includes('kasbon');
      const isCod = rawPm === 'cod';
      const isQris = rawPm === 'qris';
      const paymentStatus = isDebt || isCod ? 'unpaid' : 'paid';
      const paymentMethodLabel = isDebt ? 'Hutang' : isCod ? 'COD' : isQris ? 'QRIS' : 'Tunai';
      const orderNumber = anyOrder.orderNumber || `PWA-${order.id.slice(-6).toUpperCase()}`;

      const updatePayload: Record<string, any> = {
        status: action === 'approve' ? 'completed' : 'rejected',
        fulfillmentStatus: action === 'approve' ? 'completed' : 'rejected',
        paymentStatus: action === 'approve' ? paymentStatus : 'unpaid',
        paymentMethodLabel,
        reviewedBy: activeCashier.name || 'Administrator',
        reviewedAt: nowIso,
        processedBy: activeCashier.name || 'Administrator',
        processedAt: nowIso,
        cashierId: activeCashier.id || 'staff_001',
        cashierName: activeCashier.name,
        cashierRole: activeCashier.role,
        shiftId: activeShiftId,
        updatedAt: nowIso,
      };

      const orderUpdatePayload: Record<string, any> = {
        ...updatePayload,
        status: action === 'approve' ? 'completed' : 'cancelled',
      };

      const targetIds = Array.from(
        new Set([order.id, anyOrder.orderId, anyOrder.transactionId].filter(Boolean))
      );

      const writes: Promise<any>[] = [];
      for (const tid of targetIds) {
        writes.push(
          setDoc(doc(db, 'orders', tid), orderUpdatePayload, { merge: true }).catch(() => {}),
          setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'orders', tid), orderUpdatePayload, { merge: true }).catch(() => {}),
          setDoc(doc(db, 'transactions', tid), { ...order, ...updatePayload, id: tid, orderNumber }, { merge: true }).catch(() => {}),
          setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', tid), { ...order, ...updatePayload, id: tid, orderNumber }, { merge: true }).catch(() => {})
        );
      }

      if (action === 'approve') {
        // Deduct product stock locally and in Firestore `products`
        if (Array.isArray(order.items) && order.items.length > 0) {
          const stockDeductionList: Array<{
            productId: string;
            productName: string;
            currentStock: number;
            unitsDeducted: number;
          }> = [];

          order.items.forEach((it: any) => {
            const qty = Math.max(1, Number(it.quantityOrdered ?? it.qty ?? it.quantity ?? 1));
            const matchedProd = products.find(
              (p) =>
                p.id === it.productId ||
                p.name.trim().toLowerCase() === String(it.productName || it.name || '').trim().toLowerCase()
            );
            if (matchedProd) {
              const nextStock = Math.max(0, matchedProd.stockInUnits - qty);
              stockDeductionList.push({
                productId: matchedProd.id,
                productName: matchedProd.name,
                currentStock: matchedProd.stockInUnits,
                unitsDeducted: qty,
              });
              upsertProductLocal({
                ...matchedProd,
                stockInUnits: nextStock,
                updatedAt: nowIso,
              });
            }
          });

          if (stockDeductionList.length > 0 && !anyOrder.stockReconciled) {
            await deductProductStockInFirestore(stockDeductionList, order.id, 'pwa');
          }
        }

        await reconcileCompletedTransaction(
          order.id,
          {
            ...order,
            ...updatePayload,
          },
          'transactions',
          { alreadyDeductedInCaller: true }
        );

        // Record realized cash in `cash_flows` & `pos_incomes` for paid PWA orders (Tunai / QRIS)
        if (!isDebt && !isCod && orderTotal > 0) {
          writes.push(
            setDoc(
              doc(db, 'cash_flows', `CF-${order.id}`),
              {
                id: `CF-${order.id}`,
                transactionId: order.id,
                storeId: ACTIVE_STORE_ID,
                outletId: posSettings?.selectedOutlet || 'OUT-01',
                type: 'in',
                category: 'Penjualan Online Client PWA',
                source: 'Client PWA',
                method: paymentMethodLabel,
                paymentMethod: isQris ? 'qris' : 'cash',
                paymentStatus: 'paid',
                amount: orderTotal,
                totalCost: orderCost,
                profit: orderProfit,
                customerName: order.customerName || 'Pelanggan PWA',
                cashierName: activeCashier.name,
                shiftId: activeShiftId,
                description: `Pesanan Client PWA (${paymentMethodLabel}) #${orderNumber} - ${order.customerName}`,
                note: `Fulfill Pesanan PWA #${orderNumber} oleh ${activeCashier.name}`,
                date: formattedDateStr,
                createdAt: nowIso,
                updatedAt: nowIso,
              },
              { merge: true }
            ),
            setDoc(
              doc(db, 'pos_incomes', `INC-${order.id}`),
              {
                id: `INC-${order.id}`,
                transactionId: order.id,
                source: `Pesanan Client PWA #${orderNumber} (${order.customerName})`,
                category: 'Penjualan Online Client PWA',
                customer: order.customerName || 'Pelanggan PWA',
                cashierName: activeCashier.name,
                shiftId: activeShiftId,
                method: paymentMethodLabel,
                paymentStatus: 'paid',
                amount: orderTotal,
                note: `Fulfill Pesanan PWA (${paymentMethodLabel}) oleh ${activeCashier.name}`,
                date: formattedDateStr,
                createdAt: nowIso,
                updatedAt: nowIso,
              },
              { merge: true }
            )
          );
        } else if (isDebt && orderTotal > 0) {
          writes.push(
            setDoc(
              doc(db, 'hutang_pelanggan', `DEBT-${order.id}`),
              {
                id: `DEBT-${order.id}`,
                transactionId: order.id,
                customerName: order.customerName || 'Pelanggan PWA',
                phone: order.customerPhone || '-',
                address: anyOrder.customerAddress || anyOrder.deliveryAddress || '-',
                invoiceNumber: orderNumber,
                totalDebt: orderTotal,
                remainingDebt: orderTotal,
                paidAmount: 0,
                status: 'Belum Lunas',
                dueDate: debtDueDate,
                cashierName: activeCashier.name,
                notes: `Hutang Pesanan Client PWA #${orderNumber}`,
                createdAt: nowIso,
                updatedAt: nowIso,
              },
              { merge: true }
            )
          );
        }

        addTransactionLocal({
          ...order,
          ...updatePayload,
          id: order.id,
          orderNumber,
        } as any);

        try {
          confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
        } catch (e) {}
      }

      await Promise.all(writes);

      // Immediately remove from pending queue (`Antrean PWA (N - 1)`)
      setPwaOrdersQueue((prev) => {
        const next = prev.filter((o) => !targetIds.includes(o.id));
        setIncomingPwaOrder(next[0] || null);
        return next;
      });

      if (selectedPwaOrderModal && targetIds.includes(selectedPwaOrderModal.id)) {
        setSelectedPwaOrderModal(null);
      }

      setCashierToast(
        action === 'approve'
          ? `✓ Pesanan PWA #${order.id.slice(-6)} (${order.customerName}) selesai diproses & stok dikurangi!`
          : `Pesanan PWA #${order.id.slice(-6)} telah ditolak.`
      );
      setTimeout(() => setCashierToast(null), 4000);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${order.id}`);
    }
  };

  // Update fulfillment stage from POS terminal
  const handleUpdateFulfillmentStage = async (orderId: string, stage: 'pending' | 'processing' | 'ready' | 'completed') => {
    try {
      const nowIso = new Date().toISOString();
      const stagePayload = {
        fulfillmentStatus: stage,
        status: (stage === 'completed' ? 'completed' : 'pending_approval') as any,
        cashierId: activeCashier.id || 'staff_001',
        cashierName: activeCashier.name,
        cashierRole: activeCashier.role,
        shiftId: activeShiftId,
        updatedAt: nowIso,
      };
      await Promise.all([
        setDoc(doc(db, 'orders', orderId), stagePayload, { merge: true }).catch(() => {}),
        setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'orders', orderId), stagePayload, { merge: true }).catch(() => {}),
        setDoc(doc(db, 'transactions', orderId), stagePayload, { merge: true }).catch(() => {}),
        setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', orderId), stagePayload, { merge: true }).catch(() => {}),
      ]);

      if (stage === 'completed') {
        try {
          confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
        } catch (e) {}
        setPwaOrdersQueue((prev) => {
          const next = prev.filter((o) => o.id !== orderId);
          setIncomingPwaOrder(next[0] || null);
          return next;
        });
      } else {
        setIncomingPwaOrder((prev) =>
          prev && prev.id === orderId
            ? { ...prev, fulfillmentStatus: stage, status: 'pending_approval' }
            : prev
        );
        setPwaOrdersQueue((prev) =>
          prev.map((o) =>
            o.id === orderId
              ? { ...o, fulfillmentStatus: stage, status: 'pending_approval' }
              : o
          )
        );
      }

      if (selectedPwaOrderModal && selectedPwaOrderModal.id === orderId) {
        setSelectedPwaOrderModal({
          ...selectedPwaOrderModal,
          fulfillmentStatus: stage,
          status: stage === 'completed' ? 'completed' : 'pending_approval',
        });
      }
    } catch (err) {
      console.error('Error updating fulfillment stage:', err);
    }
  };

  // Load incoming PWA order into cashier cart (`cart`), select customer & payment method automatically
  const handleLoadPwaOrderToCart = (order: Transaction) => {
    if (!order.items || order.items.length === 0) {
      return;
    }

    const lines: CartLine[] = [];
    order.items.forEach((it: any) => {
      const qty = Math.max(1, Number(it.quantityOrdered ?? it.qty ?? it.quantity ?? 1));
      const unitPrice = Number(it.unitPrice ?? it.price ?? it.sellingPrice ?? 0);
      const unitCost = Number(it.unitCost ?? it.costPrice ?? 0);
      const prodName = String(it.productName || it.name || 'Produk PWA');
      const prod =
        products.find((p) => p.id === it.productId) ||
        products.find((p) => p.name.trim().toLowerCase() === prodName.trim().toLowerCase());

      const itemNote = String(it.notes || it.note || '').trim();
      if (prod) {
        lines.push({
          product: prod,
          packageType: 'unit',
          quantity: qty,
          ...(itemNote ? { notes: itemNote } : {}),
        });
      } else {
        // Fallback product object if product ID changed so cart always receives every item from the PWA/Waiter order
        lines.push({
          product: {
            id: it.productId || `PWA-ITEM-${lines.length + 1}`,
            storeId: ACTIVE_STORE_ID,
            name: prodName,
            sku: it.sku || it.productId || 'PWA-SKU',
            category: it.category || 'MINERAL',
            piecesPerCarton: 1,
            pricePerCarton: unitPrice,
            pricePerUnit: unitPrice,
            costPerUnit: unitCost,
            sellByUnit: true,
            stockInUnits: 100,
            minStockAlert: 5,
          } as Product,
          packageType: 'unit',
          quantity: qty,
          ...(itemNote ? { notes: itemNote } : {}),
        });
      }
    });

    if (lines.length > 0) {
      setCart(lines);
      setActiveFulfillingPwaOrder(order);
      if ((order as any).orderNotes) {
        setOrderNotes(String((order as any).orderNotes));
      }
      setSelectedCustomer(order.customerName || 'Pelanggan PWA');
      if (order.customerPhone) setCustomerPhoneInput(order.customerPhone);
      const addr = (order as any).customerAddress || (order as any).deliveryAddress || '';
      if (addr) setCustomerAddressInput(addr);

      const rawPm = String(order.paymentMethod || 'cash').toLowerCase();
      if (rawPm === 'debt' || rawPm === 'hutang' || rawPm.includes('kasbon')) {
        setPaymentMethod('debt');
      } else if (rawPm === 'cod') {
        setPaymentMethod('cod');
      } else if (rawPm === 'qris') {
        setPaymentMethod('qris');
      } else {
        setPaymentMethod('cash');
      }

      setShowPwaQueueModal(false);
      setSelectedPwaOrderModal(null);
      const isWaiterOrd =
        String(order.id || '').startsWith('ORD-WTR-') ||
        Boolean((order as any).tableNumber || (order as any).tableId);
      setCashierToast(
        isWaiterOrd
          ? `🍽️ Pesanan Meja ${(order as any).tableNumber || ''} #${order.id.slice(-6)} (${order.customerName}) dimuat ke Keranjang Kasir beserta catatan! Klik Pay & Order untuk menyelesaikan pembayaran.`
          : `🛒 Pesanan PWA #${order.id.slice(-6)} (${order.customerName}) dimuat ke Keranjang Kasir POS! Klik Pay & Order untuk menyelesaikan.`
      );
      setTimeout(() => setCashierToast(null), 5000);
    }
  };

  // Build grid entries: group products that have variantGroupId and >= 2 variants into ONE group card
  type GridEntry =
    | {
        type: 'group';
        variantGroupId: string;
        groupName: string;
        category: string;
        variants: Product[];
        firstVariant: Product;
        minPrice: number;
      }
    | {
        type: 'single';
        product: Product;
      };

  const gridEntries: GridEntry[] = (() => {
    const byGroup = new Map<string, Product[]>();
    for (const p of filteredProducts) {
      if (p.variantGroupId) {
        const list = byGroup.get(p.variantGroupId) || [];
        list.push(p);
        byGroup.set(p.variantGroupId, list);
      }
    }

    const seenGroups = new Set<string>();
    const entries: GridEntry[] = [];

    for (const p of filteredProducts) {
      if (p.variantGroupId) {
        const groupList = byGroup.get(p.variantGroupId) || [];
        if (groupList.length >= 2) {
          if (seenGroups.has(p.variantGroupId)) continue;
          seenGroups.add(p.variantGroupId);
          const firstVariant = groupList[0];
          const groupName =
            firstVariant.groupName?.trim() || firstVariant.name || 'Grup Produk';
          const prices = groupList.map((v) =>
            v.sellByUnit === false ? v.pricePerCarton : v.pricePerUnit
          );
          const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
          entries.push({
            type: 'group',
            variantGroupId: p.variantGroupId,
            groupName,
            category: firstVariant.category || 'MINERAL',
            variants: groupList,
            firstVariant,
            minPrice,
          });
          continue;
        }
      }
      entries.push({ type: 'single', product: p });
    }
    return entries;
  })();

  const activeGroupVariants = activeVariantGroupId
    ? products.filter((p) => {
        if (p.variantGroupId !== activeVariantGroupId) return false;
        const q = searchTerm.toLowerCase();
        if (!q) return true;
        return (
          (p.name || '').toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          (p.groupName || '').toLowerCase().includes(q) ||
          (p.variantName || '').toLowerCase().includes(q)
        );
      })
    : [];

  const activeGroupAllVariants = activeVariantGroupId
    ? products.filter((p) => p.variantGroupId === activeVariantGroupId)
    : [];
  const activeGroupFirst = activeGroupAllVariants[0];
  const activeGroupName =
    activeGroupFirst?.groupName?.trim() || activeGroupFirst?.name || 'Varian Produk';
  const activeGroupCategory = activeGroupFirst?.category || 'MINERAL';

  const renderProductCard = (p: Product) => {
    const pkgMode: PackageType = 'unit';
    const currentQty = getCartQty(p.id, pkgMode);
    const price = Number((p as any).posPrice ?? p.pricePerUnit ?? p.pricePerCarton ?? 0);
    const pieces = Number((p as any).isiPerDus ?? p.piecesPerCarton ?? 1);
    const variantLabel = p.variantName
      ? p.variantType
        ? `${p.variantType}: ${p.variantName}`
        : p.variantName
      : undefined;

    const isBomProduct = Boolean(
      (p as any).hasRawMaterials ||
        (Array.isArray((p as any).rawMaterialRecipe) && (p as any).rawMaterialRecipe.length > 0)
    );
    const isStockAvailable = isBomProduct || p.stockInUnits > 0;

    const handleAddThisProduct = () => {
      if (isStockAvailable) {
        handleUpdateCart(p, 1, pkgMode);
        playScannerBeep();
      }
    };

    return (
      <div
        key={p.id}
        className="group w-full bg-[#110f0a]/95 border border-amber-500/40 hover:border-amber-400/75 rounded-2xl overflow-hidden shadow-[0_0_18px_rgba(245,158,11,0.12)] flex flex-col justify-between transition"
      >
        {/* Image Container - Click adds product to cart, Eye button opens gallery */}
        <div
          onClick={handleAddThisProduct}
          className="relative w-full h-56 sm:h-64 bg-[#090805] flex items-center justify-center overflow-hidden cursor-pointer select-none border-b border-amber-500/20"
          title={isStockAvailable ? "Klik untuk tambah ke keranjang" : "Stok habis"}
        >
          <ProductThumb src={p.imageUrl} alt={p.name} />

          {variantLabel && (
            <span className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-[#110f0a]/90 text-amber-300 border border-amber-500/40 shadow-md pointer-events-none">
              {variantLabel}
            </span>
          )}

          {/* Eye Icon Button for Fullscreen Photo Gallery */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setGalleryProduct({
                name: p.name,
                variantLabel,
                imageUrl: p.imageUrl,
                galleryUrls: p.galleryUrls,
              });
            }}
            className="absolute top-2.5 right-2.5 w-8 h-8 rounded-lg bg-[#110f0a]/90 hover:bg-amber-500/20 text-amber-300 hover:text-amber-100 border border-amber-500/40 flex items-center justify-center shadow-lg transition opacity-85 hover:opacity-100 cursor-pointer"
            title="Lihat foto produk / galeri"
          >
            <Eye className="w-4 h-4" />
          </button>
        </div>

        {/* Product Details, Package Toggle Pill & Stepper */}
        <div className="p-3.5 sm:p-4 flex flex-col justify-between flex-1 min-w-0">
          <div>
            <h3
              onClick={handleAddThisProduct}
              className="text-base font-bold text-amber-50 leading-snug line-clamp-2 cursor-pointer hover:text-amber-400 transition"
              title={isStockAvailable ? "Klik untuk tambah ke keranjang" : "Stok habis"}
            >
              {p.name}
            </h3>
            <div className="text-sm font-semibold text-amber-100/90 mt-1.5 font-mono">
              {formatMoney(price)}
            </div>
            <div className="text-[11px] text-amber-200/60 mt-1 flex items-center justify-between gap-1">
              {isBomProduct ? (
                <span className="text-emerald-400 font-semibold">Stok: Selalu Ada (Bahan Baku)</span>
              ) : (
                <span>{p.stockInUnits > 0 ? `Stock: ${p.stockInUnits} Dus` : 'Stock unavailable'}</span>
              )}
              {!isBomProduct && (() => {
                const expInfo = evaluateProductExpiry(p);
                if (expInfo.daysUntilExpiry === null || p.stockInUnits <= 0) return null;
                if (expInfo.daysUntilExpiry <= expInfo.categoryWarningThresholdDays) {
                  return (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono ${
                        expInfo.isCriticalUnder14
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      }`}
                      title={`Exp: ${expInfo.expiryDateFormatted} (${expInfo.countdownLabel})`}
                    >
                      Exp {expInfo.daysUntilExpiry}h
                    </span>
                  );
                }
                return null;
              })()}
            </div>
            {(() => {
              const fefoBatches = getSortedFefoBatches(p);
              if (fefoBatches.length === 0 || p.stockInUnits <= 0) return null;
              const firstBatch = fefoBatches[0];
              return (
                <div className="mt-1 flex items-center justify-between gap-1 text-[9px] font-mono text-amber-300/80 bg-[#0b0906] border border-amber-500/25 rounded px-1.5 py-0.5">
                  <span className="truncate" title={`FEFO Prioritas: ${firstBatch.batchCode}`}>
                    FEFO: {firstBatch.batchCode} ({firstBatch.qty}d)
                  </span>
                  {fefoBatches.length > 1 && (
                    <span className="text-amber-400 font-bold shrink-0">
                      +{fefoBatches.length - 1} batch
                    </span>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="mt-3 pt-2.5 border-t border-amber-500/25 space-y-2">
            {/* Informational Isi 1 Dus badge */}
            <div className="flex items-center justify-between gap-1">
              <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/45 text-amber-300 text-[10px] font-bold">
                {pieces > 1 ? `1 Dus (Isi ${pieces})` : '1 Dus'}
              </span>
              {(p as any).totalBeratKg > 0 && (
                <span className="text-[10px] font-mono text-amber-200/70">
                  {(p as any).totalBeratKg} kg
                </span>
              )}
            </div>

            {/* Stepper directly on card ([-] 0 [+]) + "+ Notes" button when in cart */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                {currentQty > 0 ? (
                  <button
                    type="button"
                    onClick={() => openItemNotesModal(p)}
                    className={`rc-notes-btn px-2.5 py-1.5 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      cart.find((c) => c.product.id === p.id)?.notes
                        ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-400/60'
                        : 'bg-[#090805] hover:bg-amber-500/15 text-amber-200/85 hover:text-amber-300 border-amber-500/35'
                    }`}
                    title="Tambah / Edit Catatan Khusus Item"
                  >
                    <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>
                      {cart.find((c) => c.product.id === p.id)?.notes ? 'Edit Notes' : '+ Notes'}
                    </span>
                  </button>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2 bg-[#090805] border border-amber-500/35 rounded-lg p-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleUpdateCart(p, -1, pkgMode)}
                    disabled={currentQty === 0}
                    className="w-6 h-6 rounded flex items-center justify-center text-amber-300/70 hover:text-amber-100 disabled:opacity-30 transition cursor-pointer"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-6 text-center text-xs font-bold font-mono text-amber-50">
                    {currentQty}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleUpdateCart(p, 1, pkgMode)}
                    className="w-6 h-6 rounded flex items-center justify-center text-amber-400 hover:text-black hover:bg-amber-400 transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {currentQty > 0 && cart.find((c) => c.product.id === p.id)?.notes && (
                <div
                  onClick={() => openItemNotesModal(p)}
                  className="rc-notes-preview px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] font-medium text-amber-200 truncate cursor-pointer hover:border-amber-400 transition"
                  title={cart.find((c) => c.product.id === p.id)?.notes}
                >
                  📝 &ldquo;{cart.find((c) => c.product.id === p.id)?.notes}&rdquo;
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const isShiftCurrentlyOpen = Boolean(
    hasOpenShiftInSession ||
      (activeShift &&
        (String(activeShift.status || '').toLowerCase().trim() === 'open' ||
          String(activeShift.status || '').toLowerCase().trim() === 'aktif'))
  );
  const isPinCurrentlyVerified = Boolean(posPinVerified || localPosPinVerified);

  // ---------- Umum: scanner barcode (keyboard wedge) ----------
  useEffect(() => {
    let buffer = '';
    let lastTs = 0;
    let idleTimer: any = null;
    const flush = () => {
      const code = buffer.trim();
      buffer = '';
      if (code.length >= 4) handleScanBarcode(code);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const now = Date.now();
      if (now - lastTs > 80) buffer = '';
      lastTs = now;
      if (e.key === 'Enter') {
        if (posSettings?.barcodeEnterSubmits !== false && buffer.length >= 4) {
          e.preventDefault();
          flush();
        }
        return;
      }
      if (e.key.length === 1) {
        buffer += e.key;
        if (posSettings?.barcodeEnterSubmits === false) {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(flush, 120);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(idleTimer);
    };
  }, [posSettings?.barcodeEnterSubmits, products, cart]);

  // ---------- Umum: auto-lock terminal saat tidak aktif ----------
  useEffect(() => {
    const minutes = Number(posSettings?.autoLockMinutes ?? 10);
    if (isWaiterMode || !minutes || minutes <= 0) return;
    let timer: any = null;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void logAudit({ action: 'POS_AUTO_LOCK', target: `Terminal terkunci otomatis setelah ${minutes} menit tidak aktif` });
        lockPosSession();
      }, minutes * 60 * 1000);
    };
    const evts = ['mousemove', 'keydown', 'touchstart', 'click'];
    evts.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      evts.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [isWaiterMode, posSettings?.autoLockMinutes, lockPosSession]);

  // ---------- Pembayaran: total uang tunai di laci untuk shift aktif ----------
  useEffect(() => {
    if (!activeShiftId) return;
    const q = query(collection(db, 'transactions'), where('shiftId', '==', activeShiftId));
    return onSnapshot(
      q,
      (snap) => {
        let sum = 0;
        snap.forEach((d) => {
          const t: any = d.data();
          if (t.paymentMethod === 'cash' && t.status !== 'refunded') sum += Number(t.totalAmount ?? t.total ?? 0);
          else if (t.paymentMethod === 'debt') sum += Number(t.paidAmount ?? 0);
        });
        setShiftCashTotal(sum);
      },
      () => {}
    );
  }, [activeShiftId]);
  const maxDrawer = Number(posSettings?.maxCashDrawerAlert) || 0;
  const drawerOverLimit = maxDrawer > 0 && shiftCashTotal > maxDrawer;

  // ---------- Umum: diskon manual dengan batas & otorisasi ----------
  const applyDiscount = async (pct: number) => {
    const clean = Math.min(100, Math.max(0, Number(pct) || 0));
    if (clean === 0) {
      setDiscountPct(0);
      setDiscountApprovedBy(null);
      return;
    }
    const roleLimits = getActiveOperationalLimits();
    const allowed =
      posSettings?.allowManualCashierDiscount === true &&
      roleLimits.allowManualDiscount !== false &&
      hasPermission('mod_pos', 'update');
    const limit = Math.min(
      Number(posSettings?.maxCashierDiscountPct ?? 0),
      Number(roleLimits.maxDiscountPercent ?? 100)
    );
    if (allowed && clean <= limit) {
      setDiscountPct(clean);
      setDiscountApprovedBy(null);
      return;
    }
    const ok = await requestApproval(
      `Diskon ${clean}% ${allowed ? `melebihi batas kasir ${limit}%` : '(diskon manual kasir dinonaktifkan)'}`,
      'DISCOUNT_OVERRIDE'
    );
    if (ok) {
      setDiscountPct(clean);
      setDiscountApprovedBy('supervisor_pin');
      void logRealAudit({
        action: 'POS_DISCOUNT_OVERRIDE',
        module: 'POS Kasir',
        details: `Otorisasi PIN Supervisor untuk diskon manual ${clean}%`,
        severity: 'warning',
      });
    }
  };

  // ---------- Hak Akses: buka laci manual (No-Sale) ----------
  const handleOpenDrawerNoSale = async () => {
    const needPin =
      posSettings?.requirePinForDrawerKick !== false || !hasPermission('mod_pos', 'approve');
    if (needPin) {
      const ok = await requestApproval('Buka laci kasir tanpa transaksi (No-Sale)', 'DRAWER_NO_SALE');
      if (!ok) return;
    }
    const r = await kickCashDrawer(posSettings);
    void logAudit({ action: 'DRAWER_NO_SALE', target: r.ok ? 'Laci kasir dibuka manual (No-Sale)' : `Gagal buka laci: ${r.message}` });
    void logRealAudit({
      action: 'DRAWER_NO_SALE',
      module: 'POS Kasir',
      details: r.ok ? 'Laci kasir dibuka manual (No-Sale)' : `Gagal buka laci: ${r.message}`,
      severity: 'warning',
    });
    setDrawerToast(r.message);
    setTimeout(() => setDrawerToast(null), 5000);
  };

  // ---------- Printer Struk + Hak Akses (cetak ulang struk lama) ----------
  const handlePrintReceipt = async (receipt: any) => {
    const created = receipt?.createdAt || receipt?.timestamp;
    const isOld = created && dayKeyTz(created) !== dayKeyTz(new Date());
    if (isOld && posSettings?.requirePinForReprintOld) {
      const ok = await requestApproval('Cetak ulang struk dari hari sebelumnya', 'REPRINT_OLD_RECEIPT');
      if (!ok) return;
    }
    try {
      await printReceipt({ ...receipt, isReprint: Boolean(receipt?.printedAt) }, posSettings);
      if (receipt?.printedAt) void logAudit({ action: 'RECEIPT_REPRINT', target: `Cetak ulang struk ${receipt.orderNumber || receipt.id}` });
      setCompletedTxReceipt((prev: any) => (prev ? { ...prev, printedAt: new Date().toISOString() } : prev));
    } catch (e: any) {
      setDrawerToast(`Gagal cetak: ${e?.message || e}`);
      setTimeout(() => setDrawerToast(null), 6000);
    }
  };

  // Bypass PIN & Shift Gate when accessed from /waiters (isWaiterMode)
  if (!isWaiterMode && (!isPinCurrentlyVerified || !isShiftCurrentlyOpen)) {
    return (
      <PosPinGate
        onUnlocked={() => {
          setLocalPosPinVerified(true);
          setHasOpenShiftInSession(true);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col lg:flex-row w-full h-full bg-[#070604] text-amber-50 font-sans overflow-y-auto overflow-x-hidden lg:overflow-hidden">
      {approvalModal}
      {drawerToast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded-xl bg-zinc-900 border border-amber-500/50 text-amber-200 text-xs shadow-lg">
          {drawerToast}
        </div>
      )}
      {/* MAIN CENTER CONTENT & PRODUCT GRID */}
      <div className="flex-none lg:flex-1 flex flex-col min-w-0 lg:overflow-y-auto">
        {/* Top Header Bar */}
        <nav className="navbar bg-[#110f0a] border-b border-amber-500/40 px-3 sm:px-6 py-1.5 sm:py-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 shrink-0 shadow-[0_0_18px_rgba(245,158,11,0.1)]">
          <div className="flex items-center gap-3 min-w-0">

            <h1 className="text-sm sm:text-base font-bold text-amber-50 flex items-center gap-2">
              <span>RiskCart POS Terminal</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/45 hidden sm:inline-block">
                LIVE
              </span>
            </h1>

            <div className="hidden md:flex items-center gap-3 text-xs text-amber-200/70 font-mono">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-400/80" />
                Started : 08:00:00
              </span>
              <span className="flex items-center gap-1 text-amber-300 bg-amber-500/15 border border-amber-500/35 px-2.5 py-0.5 rounded-lg">
                Session Timer {formatTimer(sessionSeconds)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Navigasi Kembali ke Dashboard */}
            <button
              onClick={() => (onNavigateTab ? onNavigateTab('admin_dashboard') : null)}
              className="px-2 sm:px-2.5 py-1 sm:py-1.5 text-[11px] font-bold rounded-lg bg-[#16120b] hover:bg-amber-500/20 text-amber-200 border border-amber-500/40 flex items-center gap-1.5 transition cursor-pointer"
              title="Kembali ke Dashboard Utama"
            >
              <LayoutDashboard className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Dashboard</span>
            </button>

            {/* Currency Button */}
            <button
              onClick={() => setCurrencyMode(currencyMode === 'IDR' ? 'USD' : 'IDR')}
              className="px-2 sm:px-2.5 py-1 sm:py-1.5 text-[11px] font-bold rounded-lg bg-[#16120b] border border-amber-500/40 text-amber-200 hover:bg-amber-500/20 cursor-pointer"
              title="Toggle Currency IDR / USD"
            >
              {currencyMode === 'IDR' ? 'Rp IDR' : '$ USD'}
            </button>

            {/* Theme Toggle Button (Dark / Light) */}
            <ThemeToggleButton />

            {/* Active Cashier Profile & PIN Switcher */}
            <button
              onClick={() => {
                setSelectedStaffToLogin(activeCashier);
                setInputCashierPin('');
                setPinAuthError(null);
                setShowCashierPinModal(true);
              }}
              className="flex items-center gap-2 pl-2 border-l border-amber-500/30 text-xs hover:bg-amber-500/10 p-1 sm:p-1.5 rounded-xl transition cursor-pointer text-left"
              title="Klik untuk ganti kasir bertugas dengan verifikasi 6 digit PIN"
            >
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-amber-500/25 border border-amber-400/60 flex items-center justify-center text-amber-300 font-black text-xs uppercase">
                {activeCashier?.name?.charAt(0) || 'K'}
              </div>
              <div className="hidden sm:block">
                <div className="font-bold text-amber-50 text-[11px] leading-tight flex items-center gap-1.5">
                  <span className="truncate max-w-[130px]">{activeCashier?.name || 'Kasir'}</span>
                  <Key className="w-3 h-3 text-amber-400" />
                </div>
                <div className="text-[10px] text-amber-200/75 flex items-center gap-1 truncate max-w-[190px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                  <span className="truncate">
                    [{(activeCashier?.divisionName || inferDivisionFromRole(activeCashier?.role || 'Cashier').divisionName).replace(/^Divisi\s+/i, '')}] {activeCashier?.role || 'Cashier'}
                  </span>
                </div>
              </div>
            </button>

            {/* Create Order Button (Metallic Gold Gradient) */}
            <button
              onClick={() => handleClearCart('new_order')}
              className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 text-black font-black text-xs border border-amber-300/60 shadow-[0_0_15px_rgba(245,158,11,0.35)] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-black" />
              New Order
            </button>
          </div>
        </nav>

        {/* Cashier Modular Action Bar & Quick Actions Strip */}
        <div className="bg-[#0b0906] border-b border-amber-500/30 px-3 sm:px-6 py-1.5 sm:py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleClearCart('new_order')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#16120b] border border-amber-500/50 hover:bg-amber-500/20 text-amber-200 font-bold text-xs transition shadow-[0_0_10px_rgba(245,158,11,0.12)] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-amber-400" />
              <span>Order Baru</span>
            </button>

            <button
              onClick={() => setActiveModal('customers')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#14110b] border border-amber-500/40 hover:bg-amber-500/15 text-amber-100 font-semibold text-xs transition cursor-pointer"
            >
              <User className="w-3.5 h-3.5 text-amber-400" />
              <span>Cari Customer</span>
            </button>

            <button
              onClick={() => setActiveModal('orders')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#14110b] border border-amber-500/40 hover:bg-amber-500/15 text-amber-100 font-semibold text-xs transition cursor-pointer"
            >
              <Receipt className="w-3.5 h-3.5 text-emerald-400" />
              <span>Transaction History</span>
            </button>

            <button
              onClick={() => setShowPwaQueueModal(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer border ${
                pwaOrdersQueue.length > 0
                  ? 'bg-amber-500/20 border-amber-400/70 text-amber-200 hover:bg-amber-500/30 animate-pulse'
                  : 'bg-[#14110b] border-amber-500/40 hover:bg-amber-500/15 text-amber-100'
              }`}
              title="Antrean Pesanan Online Pelanggan (Client PWA)"
            >
              <Phone className="w-3.5 h-3.5 text-amber-400" />
              <span>Antrean PWA ({pwaOrdersQueue.length})</span>
            </button>

            {/* ALERT PRODUK MENDEKATI KADALUARSA — TEPAT DI SEBELAH "ANTREAN PWA" */}
            <button
              type="button"
              onClick={() => {
                setExpiryModalTab(nearExpiryProducts.length > 0 ? 'near_expiry' : 'all_products');
                setShowExpiryAlertModal(true);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer border ${
                criticalUnder14Count > 0
                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-200 hover:bg-rose-500/30 shadow-sm shadow-rose-950/50 animate-pulse'
                  : nearExpiryProducts.length > 0
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-200 hover:bg-amber-500/30 shadow-sm shadow-amber-950/50 animate-pulse'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
              }`}
              title="Klik untuk melihat produk mendekati kadaluarsa (14-30 hari & <14 hari) — Prioritas Penjualan FEFO"
            >
              <AlertTriangle
                className={`w-3.5 h-3.5 ${
                  criticalUnder14Count > 0 ? 'text-rose-400' : 'text-amber-400'
                }`}
              />
              <span>
                Alert Kadaluarsa ({nearExpiryProducts.length})
              </span>
              {warning14To30Count > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500 text-zinc-950 text-[10px] font-black font-mono">
                  {warning14To30Count} Waspada (14-30h)
                </span>
              )}
              {criticalUnder14Count > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black font-mono">
                  {criticalUnder14Count} Kritis (&lt;14h)
                </span>
              )}
            </button>

            {/* Modular Cashier Menu Slot: Placeholder for step-by-step cashier custom actions */}
            <div className="hidden xl:flex items-center gap-1.5 pl-2 border-l border-zinc-800">
              <span className="text-[11px] text-zinc-500 font-medium italic">
                FEFO Monitoring Aktif (Soda • Mineral • Teh • Kopi: H-30)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center p-0.5 bg-zinc-900 border border-zinc-800 rounded-lg">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md text-xs transition cursor-pointer ${
                  viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}
                title="Grid View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md text-xs transition cursor-pointer ${
                  viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}
                title="List View"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Real-time Incoming PWA Order Alert Banner */}
        {incomingPwaOrder && (
          <div className="bg-gradient-to-r from-blue-900/95 via-indigo-950/90 to-blue-900/95 border-b border-blue-500/50 px-4 sm:px-6 py-2.5 flex items-center justify-between text-xs shrink-0 shadow-lg shadow-blue-950/40">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex h-3 w-3 relative shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <span className="font-black text-white flex items-center gap-1.5 shrink-0">
                <Phone className="w-3.5 h-3.5 text-blue-300" />
                Incoming PWA Order!
              </span>
              <span className="text-blue-200 truncate hidden sm:inline">
                Customer: <strong className="text-white">{incomingPwaOrder.customerName}</strong> &bull; Total: <strong className="text-emerald-300">{formatMoney(Number(incomingPwaOrder.totalAmount ?? (incomingPwaOrder as any).total ?? 0))}</strong> ({incomingPwaOrder.items?.length || 1} items)
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setShowPwaQueueModal(true)}
                className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] flex items-center gap-1 shadow-sm transition cursor-pointer"
              >
                Lihat Antrean ({pwaOrdersQueue.length})
              </button>
              <button
                onClick={() => handleLoadPwaOrderToCart(incomingPwaOrder)}
                className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] flex items-center gap-1 shadow-sm transition cursor-pointer"
              >
                <ShoppingCart className="w-3 h-3" />
                Ke Keranjang
              </button>
              <button
                onClick={() => handlePwaAction('approve', incomingPwaOrder)}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center gap-1 shadow-sm transition cursor-pointer"
              >
                <CheckCircle className="w-3 h-3" />
                Process / Fulfill Order
              </button>
            </div>
          </div>
        )}

        {/* Global Toast Alert for freshly arrived PWA Order */}
        {newPwaOrderNotification && (
          <div className="bg-emerald-600 text-white font-bold px-4 py-2 text-xs flex items-center justify-between shrink-0 shadow-md animate-bounce">
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4" />
              <span>{newPwaOrderNotification}</span>
            </div>
            <button
              onClick={() => setNewPwaOrderNotification(null)}
              className="text-white/80 hover:text-white ml-4 text-xs font-mono"
            >
              ✕
            </button>
          </div>
        )}

        {/* Product Search Input directly ABOVE Category Tabs */}
        <div className="px-4 sm:px-6 py-2.5 bg-[#090805] border-b border-amber-500/30 shrink-0">
          <div className="relative w-full">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-amber-400/70 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={tr('Search product name or SKU...', 'Cari nama produk atau SKU...')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#0b0906] border border-amber-500/40 rounded-xl pl-9 pr-9 py-2 text-xs text-amber-50 placeholder-amber-200/35 focus:outline-none focus:border-amber-400 focus:shadow-[0_0_12px_rgba(245,158,11,0.25)] transition"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-amber-300/60 hover:text-amber-100 text-xs p-1 cursor-pointer"
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Category Tabs Strip */}
        <div className="px-4 sm:px-6 py-2.5 bg-[#090805] border-b border-amber-500/30 flex items-center justify-between gap-2 overflow-x-auto shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto">
            {categoryTabs.map((cat, idx) => (
              <button
                key={`pos-cat-${cat}-${idx}`}
                onClick={() => {
                  setSelectedCategory(cat);
                  setActiveVariantGroupId(null);
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] text-black border border-amber-300/60 shadow-[0_0_12px_rgba(245,158,11,0.35)]'
                    : 'bg-[#14110b] hover:bg-amber-500/15 text-amber-100/85 border border-amber-500/35'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 shrink-0 pl-2">
            <button
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              className="p-1.5 rounded-lg bg-[#14110b] border border-amber-500/35 text-amber-300 hover:text-amber-100 cursor-pointer"
              title={viewMode === 'grid' ? 'List View' : 'Grid View'}
            >
              {viewMode === 'grid' ? <LayoutGrid className="w-4 h-4" /> : <List className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Product Cards Grid / Variant Group View */}
        <div className="flex-1 w-full p-4 sm:p-6 lg:overflow-y-auto">
          {activeVariantGroupId ? (
            <div className="w-full">
              <VariantBreadcrumb
                items={[
                  {
                    label: 'Semua Produk',
                    onClick: () => {
                      setActiveVariantGroupId(null);
                      setSelectedCategory('ALL');
                    },
                  },
                  {
                    label: activeGroupCategory,
                    onClick: () => {
                      setActiveVariantGroupId(null);
                      setSelectedCategory(activeGroupCategory);
                    },
                  },
                  {
                    label: activeGroupName,
                  },
                ]}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-5 w-full">
                {activeGroupVariants.map((variantProd) =>
                  renderProductCard(variantProd)
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-5 w-full">
              {gridEntries.map((entry) => {
                if (entry.type === 'group') {
                  const totalGroupStock = entry.variants.reduce(
                    (acc, v) => acc + (v.stockInUnits || 0),
                    0
                  );
                  return (
                    <div
                      key={`group-${entry.variantGroupId}`}
                      onClick={() => setActiveVariantGroupId(entry.variantGroupId)}
                      className="group w-full bg-zinc-900/90 border border-zinc-800 hover:border-blue-500/60 rounded-2xl overflow-hidden shadow-xl flex flex-col justify-between transition cursor-pointer"
                    >
                      <div className="relative w-full h-56 sm:h-64 bg-zinc-950 flex items-center justify-center overflow-hidden">
                        <ProductThumb
                          src={entry.firstVariant.imageUrl}
                          alt={entry.groupName}
                        />
                        <span className="absolute top-2.5 right-2.5 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-blue-600 text-white shadow-md flex items-center gap-1">
                          <Layers className="w-3.5 h-3.5" />
                          {entry.variants.length} varian
                        </span>
                      </div>

                      <div className="p-3.5 sm:p-4 flex flex-col justify-between flex-1 min-w-0">
                        <div>
                          <h3 className="text-base font-bold text-white leading-snug line-clamp-2">
                            {entry.groupName}
                          </h3>
                          <div className="text-sm font-semibold text-blue-400 mt-1.5">
                            Mulai {formatMoney(entry.minPrice)}
                          </div>
                          <div className="text-[11px] text-zinc-500 mt-1">
                            {totalGroupStock > 0
                              ? `Total Stock: ${totalGroupStock} units`
                              : 'Stock unavailable'}
                          </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs font-bold text-blue-400 group-hover:text-blue-300">
                          <span>Pilih Varian</span>
                          <ChevronRight className="w-4 h-4" />
                        </div>
                      </div>
                    </div>
                  );
                }

                return renderProductCard(entry.product);
              })}
            </div>
          )}
        </div>
      </div>

      {/* 3. RIGHT CASHIER REGISTER & NUMPAD (Executive Dark Obsidian & Luxury Gold) */}
      <aside id="pos-cart" className="w-full lg:w-96 shrink-0 bg-[#110f0a] border-t lg:border-t-0 lg:border-l border-amber-500/40 shadow-[0_0_18px_rgba(245,158,11,0.12)] flex flex-col justify-between lg:overflow-y-auto">
        <div className="p-4 space-y-3">
          {/* Waiter Mode Selected Table Banner + Active Waiter Division/Role Selector */}
          {isWaiterMode && (
            <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-400/50 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-amber-300 font-bold">
                    Tampilan Pesanan Waiter
                  </div>
                  <div className="text-sm font-black text-white flex items-center gap-1.5">
                    <span>Meja {waiterTableInfo.tableNumber}</span>
                    {waiterTableInfo.visitorName && (
                      <span className="text-xs font-bold text-amber-200">
                        · {waiterTableInfo.visitorName}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onNavigateTab ? onNavigateTab('/waiters') : (window.location.href = '/waiters')
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-[#090805] hover:bg-amber-500 hover:text-black text-amber-300 border border-amber-500/40 text-[11px] font-bold transition cursor-pointer shrink-0"
                >
                  Ganti Meja
                </button>
              </div>

              {/* Pilih Petugas Waiter / Floor Bertugas (Nama — [Divisi] Role) */}
              <div className="pt-2 border-t border-amber-500/30 space-y-1">
                <label className="text-[10px] font-black uppercase tracking-wider text-amber-200/85 block">
                  Petugas Waiter / Floor Bertugas (Divisi & Role)
                </label>
                <select
                  value={activeWaiterForOrder?.id || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedWaiterStaffId(val);
                    try {
                      localStorage.setItem('riskcart_active_waiter_staff_id_v1', val);
                    } catch {}
                  }}
                  className="w-full rounded-lg bg-[#090805] border border-amber-500/40 px-2.5 py-1.5 text-xs font-bold text-amber-100 focus:outline-none focus:border-amber-400 cursor-pointer"
                >
                  {waiterStaffOptions.map((stf) => (
                    <option key={stf.id} value={stf.id} className="bg-zinc-950 text-white">
                      {formatStaffWithDivisionLabel(stf)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Full-Width Calendar Field (Tanggal Order) Above Customer Section */}
          <div className="space-y-1.5 pb-2.5 border-b border-amber-500/30">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black uppercase tracking-wider text-amber-200/75 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                <span>{language === 'en' ? 'ORDER DATE' : 'TANGGAL ORDER'}</span>
              </label>
              {orderDate !== new Date().toLocaleDateString('en-CA') && (
                <button
                  type="button"
                  onClick={() => setOrderDate(new Date().toLocaleDateString('en-CA'))}
                  className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[10px] font-bold text-amber-300 transition cursor-pointer"
                >
                  {language === 'en' ? 'Today' : 'Hari Ini'}
                </button>
              )}
            </div>
            <input
              type="date"
              value={orderDate}
              onChange={(e) =>
                setOrderDate(e.target.value || new Date().toLocaleDateString('en-CA'))
              }
              className="w-full border border-amber-500/30 bg-black/60 text-amber-100 rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus:border-amber-400 transition [color-scheme:dark]"
            />
          </div>

          {/* Header & Customer Input Field */}
          <div className="space-y-2 pb-2.5 border-b border-amber-500/30">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-200/75">
                {isWaiterMode
                  ? 'NAMA PENGUNJUNG / MEJA'
                  : language === 'en'
                  ? 'CUSTOMER'
                  : 'PELANGGAN'}
              </span>
              <button
                onClick={() => handleClearCart('clear_cart')}
                className="text-[11px] font-bold text-rose-400 hover:text-rose-300 hover:underline cursor-pointer flex items-center gap-1"
                title={isWaiterMode ? 'Kosongkan Pesanan' : 'Wajib PIN Owner + Alasan + Bukti Foto'}
              >
                {!isWaiterMode && <Lock className="w-3 h-3" />}
                <span>Clear Cart</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <User className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-amber-400" />
                <input
                  type="text"
                  value={selectedCustomer}
                  onChange={(e) => setSelectedCustomer(e.target.value)}
                  className="w-full bg-[#0b0906] border border-amber-500/40 focus:border-amber-400 rounded-lg pl-8 pr-2.5 py-1.5 text-xs font-semibold text-amber-50 placeholder-amber-200/35 focus:outline-none transition"
                  placeholder="General Walk-in Customer..."
                />
              </div>
              <button
                type="button"
                onClick={() => setActiveModal('customers')}
                className="p-1.5 rounded-lg bg-gradient-to-r from-[#f59e0b] to-[#d97706] hover:brightness-110 text-black font-bold border border-amber-300/60 transition shadow-[0_0_10px_rgba(245,158,11,0.3)] cursor-pointer shrink-0"
                title="Open Customer Directory"
              >
                <User className="w-4 h-4 text-black" />
              </button>
            </div>
          </div>

          {/* Cart Items List */}
          <div className="min-h-[100px] max-h-[240px] overflow-y-auto pr-1 space-y-2">
            {cart.length === 0 ? (
              <div className="py-8 text-center text-zinc-500 text-xs">
                No items selected yet
              </div>
            ) : (
              cart.map((item) => {
                const p = item.product as any;
                const itemPrice = Number(
                  p.posPrice ?? p.pricePerUnit ?? p.sellPrice ?? p.pricePerCarton ?? 0
                );
                const sub = itemPrice * item.quantity;
                const lineLabel = item.product.name;

                return (
                  <div
                    key={item.product.id}
                    className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-850 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="space-y-0.5 min-w-0 pr-1 flex-1">
                        <div className="font-semibold text-white truncate" title={lineLabel}>
                          {lineLabel}
                        </div>
                        <div className="text-[10px] text-zinc-400 flex items-center gap-1.5 flex-wrap">
                          <span>{item.quantity} x {formatMoney(itemPrice)}</span>
                          {(() => {
                            const fefoPreview = deductFefoBatches(item.product, item.quantity);
                            if (fefoPreview.deductedBreakdown.length === 0) return null;
                            const label = fefoPreview.deductedBreakdown
                              .map((b) => `${b.batchCode}(${b.deductedQty})`)
                              .join(', ');
                            return (
                              <span
                                className="px-1.5 py-0.2 rounded bg-amber-500/15 border border-amber-500/35 text-amber-300 font-mono text-[9px]"
                                title={`FEFO Deduction: ${label}`}
                              >
                                {label}
                              </span>
                            );
                          })()}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleUpdateCart(item.product, -1, item.packageType)}
                          className="w-5 h-5 rounded bg-zinc-900 hover:bg-rose-950 border border-zinc-800 hover:border-rose-500/50 flex items-center justify-center text-zinc-400 hover:text-rose-300 cursor-pointer"
                          title={isWaiterMode ? 'Kurangi Qty' : 'Kurangi Qty (Wajib PIN Owner + Alasan + Foto)'}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-mono font-bold text-amber-300 text-[11px] min-w-[18px] text-center">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateCart(item.product, 1, item.packageType)}
                          className="w-5 h-5 rounded bg-zinc-900 hover:bg-amber-500 hover:text-black border border-zinc-800 hover:border-amber-400 flex items-center justify-center text-amber-300 cursor-pointer"
                          title="Tambah Qty"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <span className="font-mono font-bold text-white text-[11px] min-w-[60px] text-right">
                          {formatMoney(sub)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            isWaiterMode
                              ? handleUpdateCart(item.product, -item.quantity, item.packageType)
                              : openCartCancelModal({
                                  mode: 'remove_item',
                                  actionLabel: 'Hapus Item',
                                  targetItem: item,
                                  delta: -item.quantity,
                                })
                          }
                          className="p-1 rounded hover:bg-rose-500/15 text-zinc-500 hover:text-rose-400 cursor-pointer transition"
                          title={
                            isWaiterMode
                              ? 'Hapus Item dari Pesanan'
                              : 'Hapus Item dari Keranjang (Wajib PIN Owner + Alasan + Foto)'
                          }
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Row Bawah Item Keranjang: Tombol "+ Notes" / "Edit Notes" + Preview Catatan */}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-900">
                      <button
                        type="button"
                        onClick={() => openItemNotesModal(item.product)}
                        className={`rc-notes-btn px-2 py-0.5 rounded-md border text-[10px] font-bold inline-flex items-center gap-1 transition cursor-pointer shrink-0 ${
                          item.notes
                            ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-400/50'
                            : 'bg-zinc-900 hover:bg-amber-500/15 text-amber-200/80 hover:text-amber-300 border-amber-500/30'
                        }`}
                        title="Tambah / Edit Catatan Khusus Pesanan"
                      >
                        <FileText className="w-3 h-3 text-amber-400" />
                        <span>{item.notes ? 'Edit Notes' : '+ Notes'}</span>
                      </button>

                      {item.notes && (
                        <div
                          onClick={() => openItemNotesModal(item.product)}
                          className="rc-notes-preview flex-1 min-w-0 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-[10px] font-semibold text-amber-300 truncate cursor-pointer hover:border-amber-400"
                          title={item.notes}
                        >
                          📝 &ldquo;{item.notes}&rdquo;
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Pricing Totals */}
          <div className="pt-2 border-t border-zinc-800 text-xs space-y-1">
            <div className="flex justify-between text-zinc-400">
              <span>Subtotal</span>
              <span className="font-mono text-white font-semibold">{formatMoney(subtotal)}</span>
            </div>
            {isTaxEnabled && taxRate > 0 && (
              <div className="flex justify-between text-zinc-400">
                <span>PPN ({taxRate}%)</span>
                <span className="font-mono text-zinc-300 font-semibold">{formatMoney(taxAmount)}</span>
              </div>
            )}
            {isRoundingEnabled && Math.abs(roundingDifference) > 0.001 && (
              <div className="flex justify-between text-zinc-400">
                <span>
                  Pembulatan ({formatRoundingBadge(roundingDifference)})
                </span>
                <span className="font-mono text-zinc-300 font-semibold">{formatMoney(roundingDifference)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-zinc-400 gap-2">
              <span>
                Diskon (%)
                {discountApprovedBy && <span className="ml-1 text-[9px] text-amber-400">• disetujui supervisor</span>}
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={discountPct || ''}
                  placeholder="0"
                  onChange={(e) => {
                    const v = Number(e.target.value) || 0;
                    if (v < discountPct || v === 0) {
                      setDiscountPct(v);
                      if (v === 0) setDiscountApprovedBy(null);
                    }
                  }}
                  onBlur={(e) => {
                    const v = Number(e.target.value) || 0;
                    if (v > discountPct) void applyDiscount(v);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  className="w-14 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-right text-white font-mono"
                  title={
                    posSettings?.allowManualCashierDiscount
                      ? `Tanpa PIN s/d ${posSettings?.maxCashierDiscountPct ?? 0}%`
                      : 'Diskon wajib PIN supervisor'
                  }
                />
                <span className="font-mono text-rose-300 font-semibold">-{formatMoney(discountAmount)}</span>
              </div>
            </div>
            {serviceChargeRate > 0 && (
              <div className="flex justify-between text-zinc-400">
                <span>Service Charge ({serviceChargeRate}%)</span>
                <span className="font-mono text-zinc-300 font-semibold">{formatMoney(serviceChargeAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-white pt-1 border-t border-zinc-850">
              <span>Total</span>
              <span className="font-mono text-white text-base">{formatMoney(total)}</span>
            </div>
          </div>

          {isWaiterMode ? (
            <div className="pt-3 space-y-2.5">
              {/* Global Order Notes Button & Preview above Push Order */}
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={openOrderNotesModal}
                  className={`rc-notes-btn w-full py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 transition cursor-pointer ${
                    orderNotes.trim()
                      ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border-amber-400/60'
                      : 'bg-[#090805] hover:bg-[#17130b] text-amber-200/85 hover:text-amber-300 border-amber-500/35'
                  }`}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>
                      {orderNotes.trim()
                        ? 'Edit Catatan Order Umum (Global Notes)'
                        : '+ Catatan Order Umum (Global Notes)'}
                    </span>
                  </span>
                  {orderNotes.trim() && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/25 text-amber-300 text-[10px] font-mono">
                      Aktif
                    </span>
                  )}
                </button>

                {orderNotes.trim() && (
                  <div
                    onClick={openOrderNotesModal}
                    className="rc-notes-preview p-2 rounded-xl bg-amber-500/10 border border-amber-500/35 text-[11px] font-semibold text-amber-200 cursor-pointer hover:border-amber-400 transition"
                  >
                    📝 <span className="font-bold">Catatan Meja:</span> &ldquo;{orderNotes}&rdquo;
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handlePushWaiterOrder}
                disabled={isProcessing || cart.length === 0}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 text-black font-black text-sm border border-amber-300/70 transition disabled:opacity-50 shadow-[0_0_20px_rgba(245,158,11,0.4)] cursor-pointer flex items-center justify-center gap-2"
              >
                <ShoppingCart className="w-4 h-4 text-black" />
                <span>{isProcessing ? 'Mengirim Pesanan...' : 'Push Order'}</span>
              </button>
              <p className="text-[11px] text-center text-amber-200/70">
                Menekan <strong>Push Order</strong> mengirim pesanan meja{' '}
                <strong>{waiterTableInfo.tableNumber}</strong> ke{' '}
                <code className="text-amber-300 font-mono">/dashboard/orders/new</code> &amp;{' '}
                <code className="text-amber-300 font-mono">/kitchen</code>.
              </p>
            </div>
          ) : (
            <>
              {drawerOverLimit && (
                <div className="p-2 rounded-lg bg-rose-950/60 border border-rose-700 text-rose-200 text-[11px]">
                  ⚠️ Kas tunai shift ini {formatMoney(shiftCashTotal)} melebihi batas {formatMoney(maxDrawer)}. Segera setor ke brankas.
                </div>
              )}

              {/* Payment Method Switcher: Tunai | Hutang | COD | QRIS | EDC (sesuai Pengaturan > Pembayaran) */}
              <div className="grid grid-cols-3 gap-1.5 pt-1">
            {posSettings?.acceptQris !== false && dokuEnabled && (
              <button
                type="button"
                onClick={() => setPaymentMethod('qris')}
                className={`py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  paymentMethod === 'qris'
                    ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30'
                    : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                QRIS
              </button>
            )}
            {posSettings?.acceptEdc !== false && (
              <button
                type="button"
                onClick={() => {
                  setPaymentMethod('edc');
                  setCashReceivedInput('0');
                }}
                className={`py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  paymentMethod === 'edc'
                    ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/30'
                    : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                EDC Kartu
              </button>
            )}
            {posSettings?.acceptCash !== false && (
              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                className={`py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  paymentMethod === 'cash'
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                    : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                Tunai
              </button>
            )}
            {posSettings?.acceptKasbon !== false && (
              <button
                type="button"
                onClick={() => {
                  setPaymentMethod('debt');
                  setCashReceivedInput('0');
                }}
                className={`py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  paymentMethod === 'debt'
                    ? 'bg-amber-600 text-white shadow-sm shadow-amber-600/30'
                    : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                Hutang
              </button>
            )}
            {posSettings?.acceptCod !== false && (
              <button
                type="button"
                onClick={() => {
                  setPaymentMethod('cod');
                  setCashReceivedInput('0');
                  if (!selectedSenderId && senderStaffOptions.length > 0) {
                    setSelectedSenderId(senderStaffOptions[0].id || '');
                  }
                }}
                className={`py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  paymentMethod === 'cod'
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                    : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                COD
              </button>
            )}
          </div>

          {paymentMethod === 'edc' && (
            <div className="p-2.5 rounded-xl bg-purple-950/30 border border-purple-500/40 space-y-1.5 text-[11px]">
              <div className="text-purple-300 font-bold">Pembayaran Kartu via Mesin EDC</div>
              <input
                value={edcApprovalCode}
                onChange={(e) => setEdcApprovalCode(e.target.value.toUpperCase())}
                placeholder="No. Approval / Trace dari struk EDC"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-white font-mono"
              />
            </div>
          )}
          <button
            type="button"
            onClick={handleOpenDrawerNoSale}
            className="w-full py-1.5 rounded-lg text-[11px] font-bold bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800"
          >
            Buka Laci (No-Sale){posSettings?.requirePinForDrawerKick !== false ? ' • PIN' : ''}
          </button>

          {/* Dynamic Payment Method Contextual Panel (Hutang / COD) */}
          {paymentMethod === 'debt' && (
            <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/40 space-y-2 text-[11px]">
              <div className="flex items-center justify-between text-amber-300 font-bold">
                <span>Pencatatan Piutang / Hutang Pelanggan</span>
                <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-[9px] uppercase font-mono">
                  BELUM LUNAS
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="text-[10px] text-zinc-400 block mb-0.5">No. WA / Telepon</label>
                  <input
                    type="text"
                    value={customerPhoneInput}
                    onChange={(e) => setCustomerPhoneInput(e.target.value)}
                    placeholder="0812..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-400 block mb-0.5">Jatuh Tempo</label>
                  <input
                    type="date"
                    value={debtDueDate}
                    onChange={(e) => setDebtDueDate(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
              <div className="text-[10px] text-amber-200/80 leading-snug">
                Otomatis tercatat di <strong>Hutang Pelanggan</strong> &amp; tidak menambah uang fisik laci kasir sampai dilunasi.
              </div>
            </div>
          )}

          {paymentMethod === 'cod' && (
            <div className="p-2.5 rounded-xl bg-indigo-950/30 border border-indigo-500/40 space-y-2 text-[11px]">
              <div className="flex items-center justify-between text-indigo-300 font-bold">
                <span>Pengiriman COD (Bayar di Tempat)</span>
                <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-[9px] uppercase font-mono">
                  ANTREAN KURIR
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="text-[10px] text-zinc-400 block mb-0.5">No. WA Penerima</label>
                  <input
                    type="text"
                    value={customerPhoneInput}
                    onChange={(e) => setCustomerPhoneInput(e.target.value)}
                    placeholder="0812..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-400 block mb-0.5">Alamat Kirim COD</label>
                  <input
                    type="text"
                    value={customerAddressInput}
                    onChange={(e) => setCustomerAddressInput(e.target.value)}
                    placeholder="Alamat tujuan..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <div className="text-[10px] text-indigo-200/80 leading-snug">
                Pesanan dikirim oleh <strong>Pengirim</strong> terpilih &amp; masuk ke Kas Masuk setelah status pesanan diterima.
              </div>
            </div>
          )}

          {/* Input Nominal Uang Diterima / DP Otomatis Format Titik Ribuan */}
          <div className="pt-1">
            <label className="block text-[10px] font-black uppercase tracking-wider text-amber-300/90 mb-1">
              {paymentMethod === 'debt' ? 'Input DP / Dibayar Sekarang (Rp)' : 'Input Uang Diterima (Rp)'}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-amber-400 font-mono">
                {currencyMode === 'IDR' ? 'Rp' : '$'}
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={
                  currencyMode === 'IDR'
                    ? cashGiven > 0
                      ? formatRibuanInput(cashGiven)
                      : ''
                    : cashReceivedInput === '0'
                    ? ''
                    : cashReceivedInput
                }
                onChange={(e) => {
                  if (currencyMode === 'IDR') {
                    const num = parseRibuanInput(e.target.value);
                    setCashReceivedInput(String(num));
                  } else {
                    setCashReceivedInput(e.target.value.replace(/[^0-9.]/g, '') || '0');
                  }
                }}
                placeholder="0"
                className="w-full bg-[#0b0906] border border-amber-500/50 focus:border-amber-400 rounded-xl pl-9 pr-3 py-2 text-sm font-mono font-black text-amber-100 placeholder-amber-200/30 focus:outline-none transition"
              />
            </div>
          </div>

          {/* Payment Calculation Breakdown */}
          <div className="text-[11px] space-y-1 text-zinc-400 pt-1">
            <div className="flex justify-between">
              <span>{paymentMethod === 'debt' ? 'DP / Dibayar Sekarang' : 'Uang Diterima'}</span>
              <span className="font-mono text-white">
                {currencyMode === 'IDR'
                  ? `Rp ${cashGiven.toLocaleString('id-ID')}`
                  : `$${cashGiven.toFixed(2)}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span>{paymentMethod === 'debt' ? 'Sisa Hutang (Piutang)' : paymentMethod === 'cod' ? 'Tagihan COD' : 'Kurang Bayar'}</span>
              <span className="font-mono text-amber-400 font-bold">
                {currencyMode === 'IDR'
                  ? `Rp ${remaining.toLocaleString('id-ID')}`
                  : `$${remaining.toFixed(2)}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Kembalian</span>
              <span className="font-mono text-emerald-400 font-bold">
                {currencyMode === 'IDR'
                  ? `Rp ${change.toLocaleString('id-ID')}`
                  : `$${change.toFixed(2)}`}
              </span>
            </div>
          </div>

          {/* Big Gold Display Box (Exact Match to Executive Dark Obsidian & Luxury Gold Reference) */}
          <div className="p-3.5 rounded-xl bg-gradient-to-r from-amber-900/45 via-yellow-900/30 to-amber-950/50 border border-amber-500/45 text-amber-100 flex items-center justify-between shadow-[0_0_18px_rgba(245,158,11,0.15)]">
            <div>
              <div className="text-[10px] uppercase font-bold text-amber-300/90">
                TOTAL ({paymentMethod === 'debt' ? 'DEBT' : paymentMethod === 'cod' ? 'COD' : paymentMethod === 'qris' ? 'QRIS' : paymentMethod === 'edc' ? 'EDC' : 'CASH'}):
              </div>
              <div className="text-xl font-black font-mono text-amber-50 leading-none mt-0.5">
                {formatMoney(total)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black font-mono text-amber-50 leading-none">
                {currencyMode === 'IDR' ? cashGiven.toLocaleString('id-ID') : cashGiven}
              </div>
              <div className="text-[10px] font-bold text-amber-300/90 mt-0.5">
                {paymentMethod === 'debt'
                  ? `Piutang: ${currencyMode === 'IDR' ? `Rp ${remaining.toLocaleString('id-ID')}` : `$${remaining.toFixed(2)}`}`
                  : paymentMethod === 'cod'
                  ? 'Bayar Saat Diterima'
                  : `Kembalian: ${currencyMode === 'IDR' ? `Rp ${change.toLocaleString('id-ID')}` : `$${change.toFixed(2)}`}`}
              </div>
            </div>
          </div>

          {/* Quick Cash Denominations (Gold Bordered Pills) */}
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            <button
              onClick={() => handleQuickCash(currencyMode === 'IDR' ? 10000 : 10)}
              className="py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/45 text-amber-300 text-xs font-bold transition cursor-pointer"
            >
              {currencyMode === 'IDR' ? '10K' : '$10'}
            </button>
            <button
              onClick={() => handleQuickCash(currencyMode === 'IDR' ? 20000 : 20)}
              className="py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/45 text-amber-300 text-xs font-bold transition cursor-pointer"
            >
              {currencyMode === 'IDR' ? '20K' : '$20'}
            </button>
            <button
              onClick={() => handleQuickCash(currencyMode === 'IDR' ? 50000 : 50)}
              className="py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/45 text-amber-300 text-xs font-bold transition cursor-pointer"
            >
              {currencyMode === 'IDR' ? '50K' : '$50'}
            </button>
            <button
              onClick={() => handleQuickCash(currencyMode === 'IDR' ? 100000 : 100)}
              className="py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/45 text-amber-300 text-xs font-bold transition cursor-pointer"
            >
              {currencyMode === 'IDR' ? '100K' : '$100'}
            </button>
          </div>

          {/* 4x4 Calculator Numpad (Obsidian & Gold) */}
          <div className="grid grid-cols-4 gap-1.5 pt-1 text-xs font-bold">
            <button
              onClick={handleNumClear}
              className="py-2.5 rounded-lg bg-[#18140c] hover:bg-amber-500/20 border border-amber-500/30 text-amber-200 cursor-pointer"
            >
              C
            </button>
            <button
              onClick={handleNumBackspace}
              className="py-2.5 rounded-lg bg-[#18140c] hover:bg-amber-500/20 border border-amber-500/30 text-amber-200 cursor-pointer"
            >
              ⌫
            </button>
            <button
              onClick={() => handleNumClick('00')}
              className="py-2.5 rounded-lg bg-[#18140c] hover:bg-amber-500/20 border border-amber-500/30 text-amber-200 cursor-pointer"
            >
              00
            </button>
            <button
              onClick={() => handleNumClick('000')}
              className="py-2.5 rounded-lg bg-[#18140c] hover:bg-amber-500/20 border border-amber-500/30 text-amber-200 cursor-pointer"
            >
              000
            </button>

            <button
              onClick={() => handleNumClick('7')}
              className="py-2.5 rounded-lg bg-[#0b0906] hover:bg-amber-500/15 text-amber-50 border border-amber-500/25 cursor-pointer"
            >
              7
            </button>
            <button
              onClick={() => handleNumClick('8')}
              className="py-2.5 rounded-lg bg-[#0b0906] hover:bg-amber-500/15 text-amber-50 border border-amber-500/25 cursor-pointer"
            >
              8
            </button>
            <button
              onClick={() => handleNumClick('9')}
              className="py-2.5 rounded-lg bg-[#0b0906] hover:bg-amber-500/15 text-amber-50 border border-amber-500/25 cursor-pointer"
            >
              9
            </button>
            <button
              onClick={() => handleNumClick('-')}
              className="py-2.5 rounded-lg bg-[#18140c] hover:bg-amber-500/20 border border-amber-500/30 text-amber-200 cursor-pointer"
            >
              -
            </button>

            <button
              onClick={() => handleNumClick('4')}
              className="py-2.5 rounded-lg bg-[#0b0906] hover:bg-amber-500/15 text-amber-50 border border-amber-500/25 cursor-pointer"
            >
              4
            </button>
            <button
              onClick={() => handleNumClick('5')}
              className="py-2.5 rounded-lg bg-[#0b0906] hover:bg-amber-500/15 text-amber-50 border border-amber-500/25 cursor-pointer"
            >
              5
            </button>
            <button
              onClick={() => handleNumClick('6')}
              className="py-2.5 rounded-lg bg-[#0b0906] hover:bg-amber-500/15 text-amber-50 border border-amber-500/25 cursor-pointer"
            >
              6
            </button>
            <button
              onClick={() => handleNumClick('+')}
              className="py-2.5 rounded-lg bg-[#18140c] hover:bg-amber-500/20 border border-amber-500/30 text-amber-200 cursor-pointer"
            >
              +
            </button>

            <button
              onClick={() => handleNumClick('1')}
              className="py-2.5 rounded-lg bg-[#0b0906] hover:bg-amber-500/15 text-amber-50 border border-amber-500/25 cursor-pointer"
            >
              1
            </button>
            <button
              onClick={() => handleNumClick('2')}
              className="py-2.5 rounded-lg bg-[#0b0906] hover:bg-amber-500/15 text-amber-50 border border-amber-500/25 cursor-pointer"
            >
              2
            </button>
            <button
              onClick={() => handleNumClick('3')}
              className="py-2.5 rounded-lg bg-[#0b0906] hover:bg-amber-500/15 text-amber-50 border border-amber-500/25 cursor-pointer"
            >
              3
            </button>
            <button
              onClick={() => handleNumClick('=')}
              className="py-2.5 rounded-lg bg-[#18140c] hover:bg-amber-500/20 border border-amber-500/35 text-amber-400 cursor-pointer"
            >
              =
            </button>

            <button
              onClick={() => handleNumClick('0')}
              className="col-span-2 py-2.5 rounded-lg bg-[#0b0906] hover:bg-amber-500/15 text-amber-50 border border-amber-500/25 cursor-pointer"
            >
              0
            </button>
            <button
              onClick={() => handleNumClick('.')}
              className="col-span-2 py-2.5 rounded-lg bg-[#0b0906] hover:bg-amber-500/15 text-amber-50 border border-amber-500/25 cursor-pointer"
            >
              .
            </button>
          </div>

          {/* Action Buttons (Exact Cash & Pay & Order / Full-Width Bayar QRIS & Buat Order) */}
          {paymentMethod === 'qris' ? (
            <div className="pt-1">
              <button
                onClick={handlePayment}
                disabled={isProcessing || cart.length === 0}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-500 hover:brightness-110 text-black font-black text-xs border border-emerald-300/70 transition disabled:opacity-50 shadow-[0_0_18px_rgba(16,185,129,0.4)] cursor-pointer flex items-center justify-center gap-2"
              >
                <QrCode className="w-4 h-4 text-black" />
                <span>{isProcessing ? 'Membuat QRIS Dinamis DOKU...' : '📱 Bayar QRIS & Buat Order'}</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={handleExactCash}
                className="py-2.5 rounded-xl bg-[#14110b] hover:bg-amber-500/20 text-amber-300 font-bold text-xs border border-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.12)] transition cursor-pointer"
              >
                Exact Cash
              </button>
              <button
                onClick={handlePayment}
                disabled={isProcessing || cart.length === 0}
                className="py-2.5 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 text-black font-black text-xs border border-amber-300/60 transition disabled:opacity-50 shadow-[0_0_15px_rgba(245,158,11,0.35)] cursor-pointer"
              >
                {isProcessing ? 'Processing...' : 'Place Order'}
              </button>
            </div>
          )}

          {/* 4. BOTTOM FLOATING SECTION: ORDER FROM PWA (Real-time Firestore `orders`, hidden/empty when 0 pending) */}
          {incomingPwaOrder ? (
            <div className="pt-3 border-t border-zinc-800">
              <div className="p-3.5 rounded-xl border text-xs space-y-2 transition-all bg-blue-950/60 border-blue-500/70 shadow-lg shadow-blue-500/10 ring-1 ring-blue-500/40">
                <div className="flex items-center justify-between">
                  <span className="font-black text-blue-400 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" />
                    Incoming PWA Order
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">
                      {pwaOrdersQueue.length} ANTREAN
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowPwaQueueModal(true)}
                    className="font-mono text-[10px] text-blue-300 hover:text-white underline cursor-pointer"
                  >
                    #{incomingPwaOrder.id.slice(-8)} (Lihat Semua)
                  </button>
                </div>

                <div className="text-[11px] space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-white font-bold truncate">
                      Customer:
                      <span className="text-blue-300 ml-1 truncate">
                        {incomingPwaOrder.customerName}
                      </span>
                      <span className="text-[10px] text-amber-400">✦</span>
                    </div>
                    {incomingPwaOrder.customerPhone && (
                      <span className="text-[10px] text-zinc-400 font-mono">
                        {incomingPwaOrder.customerPhone}
                      </span>
                    )}
                  </div>
                  {incomingPwaOrder.distanceToStoreMeters !== undefined && (
                    <div className="text-zinc-400 flex items-center gap-1 text-[10px]">
                      <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span className="truncate">
                        Verified GPS: {incomingPwaOrder.distanceToStoreMeters}m from store
                      </span>
                      {incomingPwaOrder.customerLatitude && (
                        <a
                          href={`https://www.google.com/maps?q=${incomingPwaOrder.customerLatitude},${incomingPwaOrder.customerLongitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:text-blue-300 underline ml-auto text-[9px]"
                        >
                          Maps
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Live Order Items from PWA with dynamic IDR / USD formatMoney() */}
                <div className="p-2 rounded-lg bg-zinc-950/80 border border-zinc-800 text-[10px] space-y-1 max-h-32 overflow-y-auto">
                  {incomingPwaOrder.items && incomingPwaOrder.items.length > 0 ? (
                    incomingPwaOrder.items.map((it: any, idx: number) => {
                      const itemQty = Math.max(1, Number(it.quantityOrdered ?? it.qty ?? it.quantity ?? 1));
                      const itemUnitPrice = Number(it.unitPrice ?? it.price ?? it.sellingPrice ?? 0);
                      const itemSubtotal = Number(it.subtotal ?? itemUnitPrice * itemQty);
                      return (
                        <div key={idx} className="flex justify-between text-zinc-300">
                          <span className="truncate pr-1">
                            {itemQty}x {it.productName || it.name} (Dus • @{formatMoney(itemUnitPrice)})
                          </span>
                          <span className="font-mono shrink-0">{formatMoney(itemSubtotal)}</span>
                        </div>
                      );
                    })
                  ) : null}
                  <div className="flex justify-between font-bold text-white pt-1 border-t border-zinc-800">
                    <span>Total ({String(incomingPwaOrder.paymentMethod || 'Tunai').toUpperCase()})</span>
                    <span className="font-mono text-emerald-400">
                      {formatMoney(Number(incomingPwaOrder.totalAmount ?? (incomingPwaOrder as any).total ?? 0))}
                    </span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handlePwaAction('approve', incomingPwaOrder)}
                    className="flex-1 py-1.5 rounded-lg bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] text-black font-bold text-[11px] text-center flex items-center justify-center gap-1 transition cursor-pointer"
                  >
                    <CheckCircle className="w-3 h-3" />
                    <span>Process / Fulfill Order</span>
                  </button>
                  <button
                    onClick={() => handleLoadPwaOrderToCart(incomingPwaOrder)}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition cursor-pointer flex items-center justify-center gap-1"
                    title="Masukkan ke Keranjang Kasir POS"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    <span>Keranjang</span>
                  </button>
                  <button
                    onClick={() => setSelectedPwaOrderModal(incomingPwaOrder)}
                    className="px-2 py-1.5 rounded-lg bg-[#18140c] hover:bg-amber-500/20 text-amber-200 font-bold text-[11px] border border-amber-500/35 transition cursor-pointer"
                    title="View Order Details"
                  >
                    Detail
                  </button>
                  <button
                    onClick={() => handlePwaAction('reject', incomingPwaOrder)}
                    className="px-2 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 font-bold text-[11px] border border-rose-800/60 transition cursor-pointer"
                    title="Reject Order"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="pt-3 border-t border-amber-500/25">
              <div className="p-3.5 rounded-xl bg-[#0b0906] border border-amber-500/35 text-xs space-y-2 shadow-[0_0_14px_rgba(245,158,11,0.08)]">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-300 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-amber-400" />
                    Incoming PWA Order
                  </span>
                </div>
                  <div className="py-3 text-center text-[11px] text-amber-200/50">
                    Belum ada pesanan PWA masuk
                  </div>
                </div>
              </div>
            )}
            </>
          )}
        </div>
      </aside>

      {/* Sticky Bottom Bar for <lg screens */}
      <div className="lg:hidden sticky bottom-0 z-20 shrink-0 bg-zinc-900/95 backdrop-blur border-t border-zinc-800 px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-zinc-400">
            {cart.reduce((n, i) => n + i.quantity, 0)} item
          </span>
          <span className="font-bold text-white truncate">
            {formatMoney(total)}
          </span>
        </div>
        <button
          onClick={() => {
            document.getElementById('pos-cart')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          className="shrink-0 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs"
        >
          Lihat Keranjang
        </button>
      </div>

      {/* Hybrid Dynamic QRIS DOKU Payment Modal */}
      {activeQrisSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-3xl bg-zinc-900 border border-emerald-500/40 p-6 shadow-[0_0_40px_rgba(16,185,129,0.2)] space-y-4 max-h-[92vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center">
                  <QrCode className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-black text-white uppercase tracking-tight">
                      QRIS DINAMIS — DOKU GATEWAY
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                      MENUNGGU SCAN
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 font-mono">
                    Invoice: #{activeQrisSession.invoiceNumber} • {activeQrisSession.paymentId}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveQrisSession(null)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
                title="Tutup Jendela QRIS"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* White QRIS Card Container */}
            <div className="bg-white rounded-2xl p-4 text-zinc-900 shadow-inner space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-wider text-rose-600">
                    QRIS NASIONAL (GPN) × DOKU
                  </div>
                  <div className="text-xs font-black text-zinc-900 truncate">
                    {posSettings?.storeName || 'RISKCART OFFICIAL STORE'}
                  </div>
                </div>
                <div className="text-right">
                  <span className="px-2 py-0.5 rounded bg-zinc-900 text-white font-mono text-[10px] font-bold">
                    NMID: ID2026089900018
                  </span>
                </div>
              </div>

              <div className="flex justify-center py-1">
                <img
                  src={activeQrisSession.qrCodeDataUrl}
                  alt="QRIS Dinamis DOKU"
                  className="w-60 h-60 object-contain rounded-xl border border-zinc-200 p-1"
                />
              </div>

              <div className="text-center space-y-0.5 pt-1 border-t border-zinc-200">
                <div className="text-[10px] font-bold uppercase text-zinc-500">
                  Nominal Tagihan Terkunci (EMVCo Tag 54)
                </div>
                <div className="text-2xl font-black font-mono text-emerald-700">
                  {formatMoney(activeQrisSession.amount)}
                </div>
                <div className="text-[10px] text-zinc-500">
                  Pelanggan: <strong>{activeQrisSession.customerName}</strong> • Berlaku s/d{' '}
                  <span className="font-mono font-bold text-rose-600">
                    {Math.floor(qrisSecondsLeft / 60)
                      .toString()
                      .padStart(2, '0')}
                    :{(qrisSecondsLeft % 60).toString().padStart(2, '0')}
                  </span>
                </div>
              </div>
            </div>

            {/* Settlement & MDR Breakdown */}
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs space-y-1.5">
              <div className="flex justify-between text-zinc-400">
                <span>Metode Pembayaran:</span>
                <span className="font-bold text-emerald-400">QRIS DOKU ({activeQrisSession.mode.toUpperCase()})</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Potongan Fee MDR QRIS (0.7%):</span>
                <span className="font-mono text-rose-400">
                  -Rp {activeQrisSession.mdrFee.toLocaleString('id-ID')}
                </span>
              </div>
              <div className="flex justify-between text-zinc-200 font-bold pt-1 border-t border-zinc-800">
                <span>Estimasi Settlement Bersih:</span>
                <span className="font-mono text-emerald-400">
                  Rp {activeQrisSession.netAmount.toLocaleString('id-ID')}
                </span>
              </div>
            </div>

            {/* Live Webhook Status Indicator */}
            <div className="p-2.5 rounded-xl bg-blue-950/40 border border-blue-500/30 text-[11px] text-blue-200 flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
              <span>
                Mendengarkan callback <strong>/api/webhooks/doku</strong> secara real-time atau klik tombol konfirmasi di bawah setelah pelanggan membayar.
              </span>
            </div>

            {/* Hybrid Action Buttons */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled={isConfirmingQris}
                onClick={() => handleConfirmQrisPayment(false)}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-500 hover:brightness-110 disabled:opacity-50 text-black font-black text-xs shadow-[0_0_20px_rgba(16,185,129,0.4)] transition cursor-pointer flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-black" />
                <span>
                  {isConfirmingQris
                    ? 'Memverifikasi & Mencatat Pelunasan...'
                    : '✅ Konfirmasi Pembayaran QRIS Lunas (Selesaikan Order)'}
                </span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isConfirmingQris}
                  onClick={() => handleConfirmQrisPayment(true)}
                  className="py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-emerald-300 font-bold text-[11px] border border-emerald-500/30 transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Simulasi Webhook DOKU</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-[11px] border border-zinc-700 transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Cetak QR Tagihan</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cashier Digital Receipt Modal (Dynamic 58mm vs 80mm Paper Width) */}
      {completedTxReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div
            className={`w-full ${
              posSettings?.receiptPaperWidth === '58mm' ? 'max-w-[300px]' : 'max-w-[380px]'
            } rounded-2xl bg-zinc-900 border border-zinc-800 p-5 shadow-2xl space-y-4`}
          >
            <div className="text-center pb-3 border-b border-zinc-800">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center mb-2">
                <CheckCircle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-white">Transaction Completed</h3>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">
                #{completedTxReceipt.id.slice(-8)} • Kertas {posSettings?.receiptPaperWidth || '80mm'}
              </p>
            </div>

            <div className="space-y-1.5 text-xs bg-zinc-950 p-3 rounded-xl border border-zinc-850">
              <div className="text-center pb-1.5 border-b border-zinc-800 space-y-0.5">
                <div className="font-bold text-white text-sm">
                  {completedTxReceipt.storeName || posSettings?.storeName || 'RiskCart Official Store'}
                </div>
                {(completedTxReceipt.storeAddress || posSettings?.storeAddress) && (
                  <div className="text-[10px] text-zinc-400 leading-tight">
                    {completedTxReceipt.storeAddress || posSettings?.storeAddress}
                  </div>
                )}
                {posSettings?.storePhone && (
                  <div className="text-[10px] text-zinc-500 font-mono">
                    Telp/WA: {posSettings.storePhone}
                  </div>
                )}
              </div>
              <div className="flex justify-between text-zinc-400 pt-1">
                <span>Tanggal Order:</span>
                <span className="text-amber-300 font-mono font-semibold">
                  {completedTxReceipt.orderDate ||
                    (completedTxReceipt.createdAt
                      ? new Date(completedTxReceipt.createdAt).toLocaleDateString('id-ID', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })
                      : '-')}
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Pelanggan:</span>
                <span className="text-white font-semibold">{completedTxReceipt.customerName}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Kasir:</span>
                <span className="text-blue-400 font-semibold">{completedTxReceipt.cashierName || activeCashier.name}</span>
              </div>
              {completedTxReceipt.deliveryStaffName && (
                <div className="flex justify-between text-zinc-400">
                  <span>Pengirim:</span>
                  <span className="text-emerald-400 font-semibold">
                    {completedTxReceipt.deliveryStaffName}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-zinc-400">
                <span>Metode Pembayaran:</span>
                <span className="text-amber-300 font-bold uppercase">
                  {completedTxReceipt.paymentMethodLabel || completedTxReceipt.paymentMethod} ({completedTxReceipt.paymentStatus === 'unpaid' ? 'BELUM LUNAS' : 'LUNAS'})
                </span>
              </div>
              {completedTxReceipt.dueDate && (
                <div className="flex justify-between text-zinc-400">
                  <span>Jatuh Tempo Hutang:</span>
                  <span className="text-rose-400 font-mono font-bold">{completedTxReceipt.dueDate}</span>
                </div>
              )}
              {completedTxReceipt.subtotal !== undefined && (
                <div className="flex justify-between text-zinc-400">
                  <span>Subtotal:</span>
                  <span className="text-white font-mono">{formatMoney(completedTxReceipt.subtotal)}</span>
                </div>
              )}
              {Number(completedTxReceipt.discountAmount) > 0 && (
                <div className="flex justify-between text-zinc-400">
                  <span>Diskon ({completedTxReceipt.discountPct}%):</span>
                  <span className="text-rose-300 font-mono">-{formatMoney(completedTxReceipt.discountAmount)}</span>
                </div>
              )}
              {Number(completedTxReceipt.serviceChargeAmount) > 0 && (
                <div className="flex justify-between text-zinc-400">
                  <span>Service Charge ({completedTxReceipt.serviceChargeRate}%):</span>
                  <span className="text-white font-mono">{formatMoney(completedTxReceipt.serviceChargeAmount)}</span>
                </div>
              )}
              {completedTxReceipt.taxRate > 0 && (
                <div className="flex justify-between text-zinc-400">
                  <span>PPN ({completedTxReceipt.taxRate}%):</span>
                  <span className="text-white font-mono">{formatMoney(completedTxReceipt.taxAmount)}</span>
                </div>
              )}
              {Boolean(completedTxReceipt.roundingDifference) &&
                Math.abs(completedTxReceipt.roundingDifference) > 0.001 && (
                  <div className="flex justify-between text-zinc-400">
                    <span>Pembulatan ({formatRoundingBadge(completedTxReceipt.roundingDifference)}):</span>
                    <span className="text-white font-mono">{formatMoney(completedTxReceipt.roundingDifference)}</span>
                  </div>
                )}
              <div className="flex justify-between text-zinc-300 font-bold pt-1 border-t border-zinc-850">
                <span>Total Nilai:</span>
                <span className="text-white font-mono font-bold">
                  {formatMoney(completedTxReceipt.totalAmount)}
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>{completedTxReceipt.paymentMethod === 'debt' ? 'DP Dibayar:' : 'Uang Diterima:'}</span>
                <span className="text-white font-mono">
                  {currencyMode === 'IDR'
                    ? `Rp ${completedTxReceipt.cashPaid.toLocaleString('id-ID')}`
                    : `$${completedTxReceipt.cashPaid.toFixed(2)}`}
                </span>
              </div>
              {completedTxReceipt.remainingDebt > 0 ? (
                <div className="flex justify-between text-amber-400 font-bold pt-1 border-t border-zinc-850">
                  <span>{completedTxReceipt.paymentMethod === 'cod' ? 'Tagihan COD:' : 'Sisa Hutang:'}</span>
                  <span className="font-mono">
                    {formatMoney(completedTxReceipt.remainingDebt)}
                  </span>
                </div>
              ) : (
                <div className="flex justify-between text-emerald-400 font-bold pt-1 border-t border-zinc-850">
                  <span>Kembalian:</span>
                  <span className="font-mono">
                    {currencyMode === 'IDR'
                      ? `Rp ${completedTxReceipt.change.toLocaleString('id-ID')}`
                      : `$${completedTxReceipt.change.toFixed(2)}`}
                  </span>
                </div>
              )}
            </div>

            {/* Receipt Footer Note governed by posSettings */}
            {(completedTxReceipt.storeFooterNote || posSettings?.storeFooterNote) && (
              <div className="text-center p-2 rounded-lg bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-400 italic">
                {completedTxReceipt.storeFooterNote || posSettings?.storeFooterNote}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => handlePrintReceipt(completedTxReceipt)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-xs"
              >
                <Printer className="w-3.5 h-3.5" />
                {completedTxReceipt?.printedAt ? 'Cetak Ulang' : 'Print Receipt'}
              </button>
              <button
                onClick={() => setCompletedTxReceipt(null)}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detailed Incoming PWA Order Modal */}
      {selectedPwaOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center">
                  <Phone className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">Incoming PWA Order</h3>
                    <span className="font-mono text-xs text-zinc-400">#{selectedPwaOrderModal.id.slice(-8)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        selectedPwaOrderModal.status === 'completed'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : selectedPwaOrderModal.status === 'rejected'
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse'
                      }`}
                    >
                      {selectedPwaOrderModal.status === 'completed'
                        ? 'COMPLETED / FULFILLED'
                        : selectedPwaOrderModal.status === 'rejected'
                        ? 'REJECTED'
                        : 'AWAITING CASHIER CONFIRMATION'}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {new Date(selectedPwaOrderModal.createdAt).toLocaleTimeString('en-US')}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedPwaOrderModal(null)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Customer & Location Verified Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5">
                <div className="text-[10px] uppercase font-bold text-zinc-500">Customer Profile</div>
                <div className="font-bold text-white text-sm flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-blue-400" />
                  {selectedPwaOrderModal.customerName}
                </div>
                {selectedPwaOrderModal.customerPhone && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-zinc-400 font-mono text-[11px]">{selectedPwaOrderModal.customerPhone}</span>
                    <a
                      href={`https://wa.me/${selectedPwaOrderModal.customerPhone.replace(/[^0-9]/g, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-400 hover:underline flex items-center gap-1 text-[11px]"
                    >
                      <MessageSquare className="w-3 h-3" />
                      WhatsApp
                    </a>
                  </div>
                )}
              </div>

              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5">
                <div className="text-[10px] uppercase font-bold text-zinc-500">GPS Geofence Verification</div>
                <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  {selectedPwaOrderModal.distanceToStoreMeters !== undefined
                    ? `${selectedPwaOrderModal.distanceToStoreMeters} meters from store`
                    : 'Within Store Boundary'}
                </div>
                {selectedPwaOrderModal.customerLatitude && (
                  <a
                    href={`https://www.google.com/maps?q=${selectedPwaOrderModal.customerLatitude},${selectedPwaOrderModal.customerLongitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:underline text-[11px] flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open Google Maps
                  </a>
                )}
              </div>
            </div>

            {/* Itemized Order List */}
            <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2 text-xs">
              <div className="flex items-center justify-between text-zinc-400 font-bold pb-1.5 border-b border-zinc-850">
                <span>Itemized Ordered Items</span>
                <span>Subtotal</span>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {selectedPwaOrderModal.items && selectedPwaOrderModal.items.length > 0 ? (
                  selectedPwaOrderModal.items.map((it: any, idx: number) => {
                    const itemQty = Math.max(1, Number(it.quantityOrdered ?? it.qty ?? it.quantity ?? 1));
                    const itemUnitPrice = Number(it.unitPrice ?? it.price ?? it.sellingPrice ?? 0);
                    const itemSubtotal = Number(it.subtotal ?? itemUnitPrice * itemQty);
                    return (
                      <div key={idx} className="flex items-center justify-between text-zinc-200">
                        <div>
                          <div className="font-semibold text-white">
                            {itemQty}x {it.productName || it.name}
                          </div>
                          <div className="text-[10px] text-zinc-400">
                            Kemasan: Dus &bull; @{formatMoney(itemUnitPrice)}
                          </div>
                        </div>
                        <span className="font-mono font-semibold">{formatMoney(itemSubtotal)}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-zinc-400 italic text-[11px]">
                    Wholesale order placed directly from Client PWA.
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-zinc-800 flex justify-between text-sm font-bold">
                <span className="text-white">Total Payment:</span>
                <span className="font-mono text-emerald-400">
                  {formatMoney(Number(selectedPwaOrderModal.totalAmount ?? (selectedPwaOrderModal as any).total ?? 0))}
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Payment Method:</span>
                <span className="font-semibold uppercase text-white">{selectedPwaOrderModal.paymentMethod}</span>
              </div>
            </div>

            {/* Fulfillment Progression Controls */}
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5 text-blue-400" />
                  Update Fulfillment Stage:
                </span>
                <span className="font-mono text-[10px] text-zinc-400 uppercase">
                  Active: {selectedPwaOrderModal.fulfillmentStatus || (selectedPwaOrderModal.status === 'completed' ? 'completed' : 'pending')}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <button
                  onClick={() => handleUpdateFulfillmentStage(selectedPwaOrderModal.id, 'pending')}
                  className={`py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    (selectedPwaOrderModal.fulfillmentStatus === 'pending' || (!selectedPwaOrderModal.fulfillmentStatus && selectedPwaOrderModal.status !== 'completed'))
                      ? 'bg-amber-500 text-zinc-950 font-black'
                      : 'bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800'
                  }`}
                >
                  1. Pending
                </button>
                <button
                  onClick={() => handleUpdateFulfillmentStage(selectedPwaOrderModal.id, 'processing')}
                  className={`py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    selectedPwaOrderModal.fulfillmentStatus === 'processing'
                      ? 'bg-blue-600 text-white font-black'
                      : 'bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800'
                  }`}
                >
                  2. Processing
                </button>
                <button
                  onClick={() => handleUpdateFulfillmentStage(selectedPwaOrderModal.id, 'ready')}
                  className={`py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    selectedPwaOrderModal.fulfillmentStatus === 'ready'
                      ? 'bg-indigo-600 text-white font-black'
                      : 'bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800'
                  }`}
                >
                  3. Ready
                </button>
                <button
                  onClick={() => handleUpdateFulfillmentStage(selectedPwaOrderModal.id, 'completed')}
                  className={`py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    (selectedPwaOrderModal.fulfillmentStatus === 'completed' || selectedPwaOrderModal.status === 'completed')
                      ? 'bg-emerald-600 text-white font-black'
                      : 'bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800'
                  }`}
                >
                  4. Completed
                </button>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                onClick={() => {
                  handlePwaAction('approve', selectedPwaOrderModal);
                  setSelectedPwaOrderModal(null);
                }}
                disabled={selectedPwaOrderModal.status === 'completed'}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-blue-600/30 transition cursor-pointer"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Process / Fulfill Order</span>
              </button>
              <button
                onClick={() => {
                  handleLoadPwaOrderToCart(selectedPwaOrderModal);
                  setSelectedPwaOrderModal(null);
                }}
                className="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition cursor-pointer"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Load to Register</span>
              </button>
              {selectedPwaOrderModal.status !== 'completed' && selectedPwaOrderModal.status !== 'rejected' && (
                <button
                  onClick={() => {
                    handlePwaAction('reject', selectedPwaOrderModal);
                    setSelectedPwaOrderModal(null);
                  }}
                  className="px-3.5 py-2.5 rounded-xl bg-rose-950 hover:bg-rose-900 text-rose-300 font-bold text-xs border border-rose-800 transition cursor-pointer"
                >
                  Reject
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Daftar Semua Antrean Pesanan Masuk dari Client PWA (Real-Time Firestore `orders`) */}
      {showPwaQueueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-3xl rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
            <div className="p-4 sm:p-5 bg-gradient-to-r from-blue-950/70 via-zinc-900 to-indigo-950/50 border-b border-zinc-800 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-400 flex items-center justify-center">
                  <Phone className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base sm:text-lg font-black text-white">
                      Antrean Pesanan Masuk — Client PWA ({pwaOrdersQueue.length})
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      LIVE FIRESTORE
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Daftar pesanan pelanggan dari aplikasi Client PWA yang menunggu diproses kasir ({currencyMode})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPwaQueueModal(false)}
                className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-3">
              {pwaOrdersQueue.length === 0 ? (
                <div className="py-14 text-center space-y-2.5 bg-zinc-950/60 rounded-2xl border border-zinc-800/80">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto opacity-80" />
                  <div className="text-sm font-bold text-white">
                    Antrean PWA Kosong (0 Pesanan Menunggu)
                  </div>
                  <p className="text-xs text-zinc-400 max-w-md mx-auto">
                    Tidak ada pesanan baru dari Client PWA yang belum diproses di database Firestore saat ini.
                  </p>
                </div>
              ) : (
                pwaOrdersQueue.map((ord) => {
                  const anyOrd = ord as any;
                  const ordTotal = Number(ord.totalAmount ?? anyOrd.total ?? 0);
                  const rawPm = String(ord.paymentMethod || 'Tunai').toUpperCase();
                  const ordTime = ord.createdAt
                    ? new Date(ord.createdAt).toLocaleString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '-';

                  return (
                    <div
                      key={ord.id}
                      className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 hover:border-blue-500/50 transition space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-black text-blue-400">
                              #{anyOrd.orderNumber || ord.id.slice(-8).toUpperCase()}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              PENDING
                            </span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-zinc-800 text-zinc-200 border border-zinc-700">
                              Metode: {rawPm}
                            </span>
                          </div>
                          <div className="text-sm font-bold text-white mt-1 flex items-center gap-2">
                            <User className="w-3.5 h-3.5 text-blue-400" />
                            <span>{ord.customerName}</span>
                            {ord.customerPhone && (
                              <span className="text-xs font-mono text-zinc-400">
                                • WA: {ord.customerPhone}
                              </span>
                            )}
                          </div>
                          {(anyOrd.customerAddress || anyOrd.deliveryAddress) && (
                            <div className="text-[11px] text-zinc-400 mt-0.5 flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
                              <span>{anyOrd.customerAddress || anyOrd.deliveryAddress}</span>
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] text-zinc-400 font-mono">{ordTime}</div>
                          <div className="text-base font-black font-mono text-emerald-400 mt-0.5">
                            {formatMoney(ordTotal)}
                          </div>
                        </div>
                      </div>

                      {/* Daftar Produk & Qty Dus */}
                      <div className="bg-zinc-900/90 rounded-xl p-3 border border-zinc-800/80 space-y-1.5 text-xs">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex justify-between">
                          <span>Daftar Produk &amp; Qty Dus</span>
                          <span>Subtotal ({currencyMode})</span>
                        </div>
                        {Array.isArray(ord.items) && ord.items.length > 0 ? (
                          ord.items.map((it: any, iIdx: number) => {
                            const q = Math.max(1, Number(it.quantityOrdered ?? it.qty ?? it.quantity ?? 1));
                            const up = Number(it.unitPrice ?? it.price ?? it.sellingPrice ?? 0);
                            const sub = Number(it.subtotal ?? up * q);
                            return (
                              <div key={iIdx} className="flex items-center justify-between text-zinc-200 pt-1 border-t border-zinc-800/50">
                                <div>
                                  <span className="font-bold text-white">{q} Dus</span> &times;{' '}
                                  <span>{it.productName || it.name}</span>{' '}
                                  <span className="text-[11px] text-zinc-400 font-mono">
                                    (@{formatMoney(up)})
                                  </span>
                                </div>
                                <span className="font-mono font-semibold text-white">
                                  {formatMoney(sub)}
                                </span>
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-zinc-500 text-[11px] italic">Detail item pesanan PWA</div>
                        )}
                      </div>

                      {/* Tombol Aksi */}
                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleLoadPwaOrderToCart(ord)}
                          className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                        >
                          <ShoppingCart className="w-3.5 h-3.5" />
                          <span>Masukkan ke Keranjang POS</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePwaAction('approve', ord)}
                          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-blue-600/20"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Process / Fulfill Order</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowPwaQueueModal(false);
                            setSelectedPwaOrderModal(ord);
                          }}
                          className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs transition cursor-pointer"
                        >
                          Detail
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePwaAction('reject', ord)}
                          className="px-3 py-2 rounded-xl bg-rose-950/70 hover:bg-rose-900 text-rose-300 font-bold text-xs border border-rose-800/60 transition cursor-pointer"
                        >
                          Tolak
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

      {/* Toast Notifikasi Ganti Kasir */}
      {cashierToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-950 border border-emerald-700 text-emerald-200 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-bold">{cashierToast}</span>
          <button
            onClick={() => setCashierToast(null)}
            className="text-emerald-400 hover:text-white text-xs font-bold ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Modal: Ganti Kasir / Login PIN 6 Digit (Database Firestore /staff) */}
      {showCashierPinModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white tracking-tight">
                    Otorisasi &amp; Login Kasir POS
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Pilih staf dari database Firestore &amp; verifikasi dengan PIN 6 angka
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowCashierPinModal(false);
                  setPinAuthError(null);
                  setInputCashierPin('');
                }}
                className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error Banner */}
            {pinAuthError && (
              <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center gap-2 animate-in fade-in">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{pinAuthError}</span>
              </div>
            )}

            {/* Pilih Staf dari Database */}
            <div>
              <label className="block text-xs font-bold text-zinc-300 mb-2">
                1. Pilih Karyawan Bertugas:
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                {staffList.map((stf) => {
                  const isSelected = selectedStaffToLogin?.id === stf.id;
                  const isActive = activeCashier?.id === stf.id;
                  return (
                    <button
                      key={stf.id}
                      type="button"
                      onClick={() => {
                        setSelectedStaffToLogin(stf);
                        setPinAuthError(null);
                      }}
                      className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between gap-1 relative ${
                        isSelected
                          ? 'bg-purple-950/60 border-purple-500 ring-2 ring-purple-500/30'
                          : isActive
                          ? 'bg-zinc-950/80 border-blue-500/50 hover:border-blue-400'
                          : 'bg-zinc-950/40 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50'
                      }`}
                    >
                      {isActive && (
                        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Sedang Aktif" />
                      )}
                      <div>
                        <div className="font-bold text-white text-xs truncate">{stf.name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          <span
                            className={`px-1.5 py-0.5 rounded border text-[9px] font-bold truncate ${getRoleBadgeThemeClasses(
                              stf.role || 'Cashier POS',
                              true
                            )}`}
                          >
                            {stf.role}
                          </span>
                        </div>
                      </div>
                      <div className="text-[10px] text-zinc-400 font-mono truncate">
                        {(
                          stf.divisionName ||
                          inferDivisionFromRole(stf.role || 'Cashier').divisionName
                        ).replace(/^Divisi\s+/i, '')}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Input PIN 6 Angka */}
            {selectedStaffToLogin && (
              <form onSubmit={handleVerifyCashierPin} className="space-y-3 pt-2 border-t border-zinc-800">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                    <span>2. Masukkan PIN 6 Angka untuk {selectedStaffToLogin.name}:</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowInputPin(!showInputPin)}
                    className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    {showInputPin ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showInputPin ? 'Sembunyikan' : 'Tampilkan'}</span>
                  </button>
                </div>

                {/* 6 Digit Box Display */}
                <div className="flex items-center justify-center gap-2">
                  {[0, 1, 2, 3, 4, 5].map((idx) => {
                    const digit = inputCashierPin[idx];
                    return (
                      <div
                        key={idx}
                        className={`w-11 h-12 rounded-xl border flex items-center justify-center font-mono font-black text-lg transition-all ${
                          digit
                            ? 'bg-amber-950/60 border-amber-500 text-amber-300 shadow-md shadow-amber-950/40'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-600'
                        }`}
                      >
                        {digit ? (showInputPin ? digit : '•') : '-'}
                      </div>
                    );
                  })}
                </div>

                {/* Numeric Keypad for fast touch screen usage */}
                <div className="grid grid-cols-3 gap-1.5 max-w-xs mx-auto pt-1">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => {
                        if (inputCashierPin.length < 6) {
                          setInputCashierPin((prev) => prev + num);
                          setPinAuthError(null);
                        }
                      }}
                      className="py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white font-black text-sm transition cursor-pointer"
                    >
                      {num}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setInputCashierPin('')}
                    className="py-2.5 rounded-xl bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 font-bold text-xs transition cursor-pointer"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (inputCashierPin.length < 6) {
                        setInputCashierPin((prev) => prev + '0');
                        setPinAuthError(null);
                      }
                    }}
                    className="py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white font-black text-sm transition cursor-pointer"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputCashierPin((prev) => prev.slice(0, -1))}
                    className="py-2.5 rounded-xl bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-amber-400 font-bold text-xs transition cursor-pointer"
                  >
                    ⌫ Hapus
                  </button>
                </div>

                <div className="pt-2 flex items-center justify-between text-[11px] text-zinc-400">
                  <span>Staf: <strong className="text-zinc-200">{selectedStaffToLogin.name}</strong></span>
                  <span>Email: <strong className="text-zinc-200">{selectedStaffToLogin.email || '-'}</strong></span>
                </div>

                <div className="pt-2 flex justify-end gap-2 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCashierPinModal(false);
                      setPinAuthError(null);
                      setInputCashierPin('');
                    }}
                    className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 cursor-pointer text-xs"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={inputCashierPin.length !== 6}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-zinc-950 font-black text-xs shadow-lg transition cursor-pointer disabled:opacity-50"
                  >
                    ✓ Verifikasi &amp; Mulai Shift Kasir
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Product Gallery Fullscreen Modal */}
      <ProductGalleryModal
        open={!!galleryProduct}
        onClose={() => setGalleryProduct(null)}
        product={galleryProduct}
      />

      {/* MODAL ALERT PRODUK MENDEKATI KADALUARSA (FEFO - FIRST EXPIRED FIRST OUT) */}
      {showExpiryAlertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-zinc-900 border border-amber-500/40 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 bg-gradient-to-r from-amber-950/60 via-zinc-900 to-rose-950/40 border-b border-zinc-800 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                    FEFO ALERT • FIRST EXPIRED FIRST OUT
                  </span>
                  <span className="text-[11px] font-mono text-zinc-400">
                    Ambang Peringatan: 30 Hari Sebelum Kadaluarsa (Stok &gt; 0)
                  </span>
                </div>
                <h3 className="text-base sm:text-lg font-black text-white">
                  Daftar Produk Mendekati Kadaluarsa &amp; Jadwal Expired
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setShowExpiryAlertModal(false)}
                className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Category Threshold Rules Banner */}
            <div className="px-4 sm:px-5 py-3 bg-zinc-950/90 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold text-zinc-400">
                  Aturan Kategori Peringatan:
                </span>
                {CATEGORY_EXPIRY_RULES.map((rule, idx) => (
                  <span
                    key={`exp-rule-${rule.category}-${idx}`}
                    className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 text-[11px] font-semibold flex items-center gap-1.5"
                  >
                    <Calendar className="w-3 h-3 text-amber-400" />
                    <span>Kategori: <strong className="text-white">{rule.category}</strong></span>
                    <span className="text-amber-400 font-mono font-bold">({rule.warningDays} Hari)</span>
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setExpiryModalTab('near_expiry')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    expiryModalTab === 'near_expiry'
                      ? 'bg-amber-500 text-zinc-950'
                      : 'bg-zinc-800 text-zinc-300 hover:text-white'
                  }`}
                >
                  Mendekati Expired ({nearExpiryProducts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setExpiryModalTab('all_products')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    expiryModalTab === 'all_products'
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800 text-zinc-300 hover:text-white'
                  }`}
                >
                  Semua Produk ({productExpiryList.length})
                </button>
              </div>
            </div>

            {/* Table Content */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
              {(() => {
                const listToRender =
                  expiryModalTab === 'near_expiry' ? nearExpiryProducts : productExpiryList;

                if (listToRender.length === 0) {
                  return (
                    <div className="py-12 text-center space-y-2">
                      <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                      <div className="text-sm font-bold text-white">
                        Tidak ada produk dengan stok aktif yang mendekati kadaluarsa (14 - 30 hari).
                      </div>
                      <p className="text-xs text-zinc-400 max-w-md mx-auto">
                        Klik tab <strong>Semua Produk</strong> di kanan atas untuk melihat atau mengatur Tanggal Produksi &amp; Tanggal Kadaluarsa produk.
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="overflow-x-auto rounded-xl border border-zinc-800">
                    <table className="w-full text-left text-xs text-zinc-300">
                      <thead className="bg-zinc-950 text-[10px] font-black uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
                        <tr>
                          <th className="py-3 px-3">Nama Produk</th>
                          <th className="py-3 px-3">Kategori</th>
                          <th className="py-3 px-3">Tgl Produksi</th>
                          <th className="py-3 px-3">Tgl Kadaluarsa</th>
                          <th className="py-3 px-3">Sisa Hari (Countdown)</th>
                          <th className="py-3 px-3 text-right">Sisa Stok</th>
                          <th className="py-3 px-3 text-right">Nilai Jual</th>
                          <th className="py-3 px-3 text-right text-rose-300">Potensi Rugi Expired</th>
                          <th className="py-3 px-3 text-center">Prioritas Kasir (FEFO)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/70">
                        {listToRender.map(({ product: p, evalExp, sellVal, lossVal }) => {
                          const badgeClass =
                            evalExp.status === 'expired' || evalExp.status === 'critical'
                              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                              : evalExp.status === 'warning'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : evalExp.status === 'safe'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : 'bg-zinc-800 text-zinc-400 border-zinc-700';

                          return (
                            <tr key={p.id} className="hover:bg-zinc-800/40 transition">
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-white">{p.name}</div>
                                <div className="text-[10px] font-mono text-zinc-500">
                                  SKU: {p.sku || p.id}
                                </div>
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 font-mono text-[10px] font-bold">
                                  {p.category || 'MINERAL'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-mono text-zinc-300">
                                <input
                                  type="date"
                                  value={evalExp.productionDateRaw}
                                  onChange={async (e) => {
                                    const nextProdDate = e.target.value;
                                    upsertProductLocal({
                                      ...p,
                                      productionDate: nextProdDate,
                                      tanggalProduksi: nextProdDate,
                                    });
                                    await saveProductDocToAllPaths(p.id, {
                                      productionDate: nextProdDate,
                                      tanggalProduksi: nextProdDate,
                                    });
                                  }}
                                  className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-blue-500"
                                />
                              </td>
                              <td className="py-2.5 px-3 font-mono text-zinc-300">
                                <input
                                  type="date"
                                  value={evalExp.expiryDateRaw}
                                  onChange={async (e) => {
                                    const nextExpDate = e.target.value;
                                    upsertProductLocal({
                                      ...p,
                                      expiryDate: nextExpDate,
                                      tanggalKadaluarsa: nextExpDate,
                                    });
                                    await saveProductDocToAllPaths(p.id, {
                                      expiryDate: nextExpDate,
                                      tanggalKadaluarsa: nextExpDate,
                                    });
                                  }}
                                  className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-500"
                                />
                              </td>
                              <td className="py-2.5 px-3">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${badgeClass}`}
                                >
                                  {evalExp.countdownLabel}
                                </span>
                                {evalExp.shelfLifeLabel && (
                                  <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                                    {evalExp.shelfLifeLabel}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                                {p.stockInUnits} Dus
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-emerald-300 font-semibold">
                                {formatMoney(sellVal)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-rose-400 font-bold">
                                {formatMoney(lossVal)}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <button
                                  type="button"
                                  disabled={p.stockInUnits <= 0}
                                  onClick={() => {
                                    handleUpdateCart(p, 1, 'unit');
                                    playScannerBeep();
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-black text-[10px] transition cursor-pointer inline-flex items-center gap-1"
                                >
                                  <Plus className="w-3 h-3" />
                                  <span>Jual (FEFO)</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="px-4 sm:px-5 py-3 bg-zinc-950 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-zinc-400">
                  Total Produk Mendekati Kadaluarsa:{' '}
                  <strong className="text-amber-300 font-mono">{nearExpiryProducts.length} SKU</strong>
                </span>
                <span className="text-zinc-400">
                  Total Potensi Kerugian Jika Expired:{' '}
                  <strong className="text-rose-400 font-mono">
                    {formatMoney(nearExpiryProducts.reduce((s, i) => s + i.lossVal, 0))}
                  </strong>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowExpiryAlertModal(false)}
                className="px-4 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: PERINGATAN BLOKIR TRANSAKSI TUNAI BELUM INPUT PEMBAYARAN (DARK OBSIDIAN & GOLD/RED) */}
      {cashBlockModal?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-[#0d0b07] border-2 border-rose-500/70 shadow-[0_0_35px_rgba(244,63,94,0.35)] p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-amber-500/30 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-rose-500/20 border border-rose-500/50 flex items-center justify-center text-rose-400 shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-black text-amber-50">
                    {cashBlockModal.title}
                  </h3>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400">
                    ANTI-FRAUD CASHIER PAYMENT GUARD
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCashBlockModal(null)}
                className="p-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/40 text-xs text-amber-50/95 leading-relaxed">
              {cashBlockModal.message}
            </div>

            <div className="p-3 rounded-xl bg-[#16120b] border border-amber-500/35 flex items-center justify-between text-xs">
              <span className="text-amber-200/80 font-semibold">Total Tagihan Saat Ini:</span>
              <span className="font-mono font-black text-base text-amber-300">
                {formatMoney(total)}
              </span>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  handleExactCash();
                  setCashBlockModal(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#1a150c] hover:bg-amber-500/20 text-amber-300 font-bold text-xs border border-amber-500/50 transition cursor-pointer"
              >
                Isi Uang Pas ({formatMoney(total)})
              </button>
              <button
                type="button"
                onClick={() => setCashBlockModal(null)}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 text-black font-black text-xs border border-amber-300/60 shadow-[0_0_15px_rgba(245,158,11,0.35)] cursor-pointer"
              >
                Mengerti &amp; Input Nominal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: POP-UP PEMBATALAN PESANAN WAJIB PIN OWNER + KETERANGAN + KAMERA / GALERI (`CartCancelModal`) */}
      {cartCancelRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-3xl bg-[#0d0b07] border-2 border-amber-500/60 shadow-[0_0_40px_rgba(245,158,11,0.25)] overflow-hidden flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="p-5 bg-gradient-to-r from-[#1a140a] via-[#120e08] to-rose-950/40 border-b border-amber-500/40 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-400/60 flex items-center justify-center text-amber-300 shrink-0">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black text-amber-50">
                      Otorisasi Pembatalan Keranjang Kasir
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 uppercase">
                      {cartCancelRequest.actionLabel}
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-200/70">
                    Wajib PIN Owner + Keterangan Alasan + Lampiran Bukti Foto Kamera/Galeri
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeCartCancelModal}
                className="p-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleConfirmCartCancel}
              className="p-5 overflow-y-auto space-y-4 text-xs"
            >
              {/* Ringkasan Item yang Akan Dibatalkan */}
              <div className="p-3.5 rounded-2xl bg-[#14110b] border border-amber-500/35 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-amber-300">
                  <span>Ringkasan Item yang Akan Dibatalkan:</span>
                  <span>Kasir: {activeCashier.name}</span>
                </div>
                {cartCancelRequest.targetItem ? (
                  <div className="flex items-center justify-between text-amber-50 font-semibold pt-1 border-t border-amber-500/20">
                    <span>
                      {cartCancelRequest.mode === 'remove_item'
                        ? `${cartCancelRequest.targetItem.quantity} Dus`
                        : '1 Dus'}{' '}
                      &times; {cartCancelRequest.targetItem.product.name}
                    </span>
                    <span className="font-mono font-bold text-rose-400">
                      {formatMoney(
                        Number(
                          (cartCancelRequest.targetItem.product as any).posPrice ??
                            cartCancelRequest.targetItem.product.pricePerUnit ??
                            0
                        ) *
                          (cartCancelRequest.mode === 'remove_item'
                            ? cartCancelRequest.targetItem.quantity
                            : 1)
                      )}
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1 pt-1 border-t border-amber-500/20 max-h-24 overflow-y-auto">
                    {cart.map((c) => {
                      const up = Number(
                        (c.product as any).posPrice ?? c.product.pricePerUnit ?? 0
                      );
                      return (
                        <div key={c.product.id} className="flex justify-between text-amber-100">
                          <span>
                            {c.quantity} Dus &times; {c.product.name}
                          </span>
                          <span className="font-mono text-rose-300">
                            {formatMoney(up * c.quantity)}
                          </span>
                        </div>
                      );
                    })}
                    <div className="flex justify-between font-black text-rose-400 pt-1 border-t border-amber-500/20">
                      <span>Total Nilai Keranjang Dibatalkan:</span>
                      <span className="font-mono">{formatMoney(subtotal)}</span>
                    </div>
                  </div>
                )}
              </div>

              {cancelError && (
                <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-500/60 text-rose-200 font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{cancelError}</span>
                </div>
              )}

              {/* Syarat 1: Wajib Input PIN Owner */}
              <div className="space-y-1.5">
                <label className="block font-bold text-amber-200">
                  1. PIN Otorisasi Owner <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-amber-400" />
                  <input
                    type={showCancelOwnerPin ? 'text' : 'password'}
                    value={cancelOwnerPin}
                    onChange={(e) => {
                      setCancelOwnerPin(e.target.value);
                      setCancelError(null);
                    }}
                    placeholder="Masukkan PIN Owner"
                    className="w-full bg-black/80 border border-amber-500/45 focus:border-amber-400 rounded-xl pl-9 pr-10 py-2.5 text-xs font-mono text-amber-50 placeholder-amber-200/35 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCancelOwnerPin(!showCancelOwnerPin)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-300/70 hover:text-amber-100 cursor-pointer"
                  >
                    {showCancelOwnerPin ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Syarat 2: Wajib Input Keterangan Pembatalan */}
              <div className="space-y-1.5">
                <label className="block font-bold text-amber-200">
                  2. Keterangan / Alasan Pembatalan <span className="text-rose-400">*</span>
                </label>
                <textarea
                  rows={2}
                  value={cancelReason}
                  onChange={(e) => {
                    setCancelReason(e.target.value);
                    setCancelError(null);
                  }}
                  placeholder="Contoh: Pelanggan batal beli / salah pilih ukuran kemasan (minimal 5 karakter)..."
                  className="w-full bg-black/80 border border-amber-500/45 focus:border-amber-400 rounded-xl p-2.5 text-xs text-amber-50 placeholder-amber-200/35 focus:outline-none"
                />
              </div>

              {/* Syarat 3: Wajib Lampiran Foto / Dokumen Bukti (Buka Kamera / Browse Photo Gallery) */}
              <div className="space-y-2">
                <label className="block font-bold text-amber-200">
                  3. Lampiran Foto / Dokumen Bukti Pembatalan <span className="text-rose-400">*</span>
                </label>

                {/* Hidden File Inputs */}
                <input
                  ref={cameraFallbackInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleEvidenceFileChange}
                  className="hidden"
                />
                <input
                  ref={galleryFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleEvidenceFileChange}
                  className="hidden"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={startLiveCamera}
                    className="py-2.5 px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/60 text-amber-200 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
                  >
                    <Camera className="w-4 h-4 text-amber-400" />
                    <span>📷 Buka Kamera</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryFileInputRef.current?.click()}
                    className="py-2.5 px-3 rounded-xl bg-[#18140c] hover:bg-amber-500/20 border border-amber-500/40 text-amber-100 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
                  >
                    <ImageIcon className="w-4 h-4 text-amber-400" />
                    <span>🖼️ Browse Photo Gallery / Dokumen</span>
                  </button>
                </div>

                {/* Live Camera Stream View */}
                {isCameraActive && (
                  <div className="p-3 rounded-2xl bg-black border border-amber-500/50 space-y-2.5">
                    <video
                      ref={cameraVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full max-h-52 object-cover rounded-xl border border-amber-500/30"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={captureLiveCameraPhoto}
                        className="flex-1 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 text-black font-black text-xs cursor-pointer"
                      >
                        📸 Jepret Foto Bukti
                      </button>
                      <button
                        type="button"
                        onClick={stopLiveCamera}
                        className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold text-xs cursor-pointer"
                      >
                        Tutup Kamera
                      </button>
                    </div>
                  </div>
                )}

                {/* Preview Captured / Uploaded Evidence Photo */}
                {cancelEvidencePhoto && (
                  <div className="p-3 rounded-2xl bg-[#14110b] border border-emerald-500/40 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={cancelEvidencePhoto}
                        alt="Preview Bukti Pembatalan"
                        className="w-16 h-16 object-cover rounded-xl border border-amber-400/60"
                      />
                      <div>
                        <div className="text-emerald-400 font-bold text-xs flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Foto Bukti Siap Diunggah</span>
                        </div>
                        <p className="text-[10px] text-zinc-400 mt-0.5">
                          Otomatis tersimpan ke Anti-Fraud &amp; Folder Google Drive bersama.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCancelEvidencePhoto('')}
                      className="px-2.5 py-1 rounded-lg bg-rose-950/70 hover:bg-rose-900 text-rose-300 border border-rose-800 text-[10px] font-bold cursor-pointer"
                    >
                      Ganti Foto
                    </button>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-amber-500/30 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeCartCancelModal}
                  className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 font-bold text-xs cursor-pointer"
                >
                  Kembali
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCancel}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 disabled:opacity-50 text-black font-black text-xs border border-amber-300/60 shadow-[0_0_18px_rgba(245,158,11,0.4)] cursor-pointer"
                >
                  {isSubmittingCancel
                    ? 'Menyimpan Bukti & Sinkronisasi Drive...'
                    : '✓ Konfirmasi Pembatalan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Popup Modal Catatan / Request Khusus Pesanan (+ Notes) */}
      {notesModalState.open && (
        <div
          className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setNotesModalState((prev) => ({ ...prev, open: false }))}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rc-notes-modal w-full max-w-lg rounded-2xl bg-[#110f0a] border-2 border-amber-500/50 shadow-[0_25px_60px_rgba(0,0,0,0.85)] overflow-hidden"
          >
            {/* Header Modal */}
            <div className="p-4 sm:p-5 bg-[#17130b] border-b border-amber-500/30 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-400">
                    <FileText className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm sm:text-base font-black text-white tracking-tight">
                    Catatan / Request Khusus Pesanan
                  </h3>
                </div>
                <p className="text-xs text-amber-200/80 pl-9">
                  {notesModalState.mode === 'item' ? 'Produk: ' : 'Catatan Umum: '}
                  <strong className="text-amber-300 font-bold">
                    {notesModalState.productName}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNotesModalState((prev) => ({ ...prev, open: false }))}
                className="p-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition cursor-pointer"
                title="Tutup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body Modal */}
            <form onSubmit={handleSaveNotesModal} className="p-4 sm:p-5 space-y-4">
              {/* Quick Request Chips */}
              <div className="space-y-2">
                <label className="block text-xs font-extrabold text-amber-300 uppercase tracking-wider">
                  Pilihan Cepat Sekali Klik (Quick Request Chips)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_REQUEST_CHIPS.map((chip) => {
                    const isIncluded = notesModalState.draftText
                      .toLowerCase()
                      .includes(chip.toLowerCase());
                    return (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => handleAppendQuickChip(chip)}
                        className={`rc-notes-chip px-2.5 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer flex items-center gap-1 ${
                          isIncluded
                            ? 'bg-amber-500 text-black border-amber-300 shadow-sm'
                            : 'bg-[#090805] hover:bg-amber-500/20 text-amber-100 border-amber-500/35 hover:border-amber-400'
                        }`}
                      >
                        <span>+ {chip}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Textarea Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-amber-100">
                  Detail Catatan / Request Pelanggan
                </label>
                <textarea
                  rows={3}
                  autoFocus
                  value={notesModalState.draftText}
                  onChange={(e) =>
                    setNotesModalState((prev) => ({ ...prev, draftText: e.target.value }))
                  }
                  placeholder="Tulis request khusus pelanggan di sini..."
                  className="w-full rounded-xl bg-[#090805] border border-amber-500/40 focus:border-amber-400 p-3 text-xs sm:text-sm font-medium text-white placeholder-zinc-500 focus:outline-none transition"
                />
              </div>

              {/* Footer Modal */}
              <div className="pt-3 border-t border-amber-500/25 flex flex-wrap items-center justify-between gap-2">
                <div>
                  {notesModalState.draftText.trim() && (
                    <button
                      type="button"
                      onClick={handleClearNotesInModal}
                      className="px-3 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus Catatan</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setNotesModalState((prev) => ({ ...prev, open: false }))}
                    className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs font-bold transition cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 text-black font-black text-xs sm:text-sm border border-amber-300/70 shadow-[0_0_16px_rgba(245,158,11,0.35)] flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4 text-black" />
                    <span>Simpan Catatan</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global Interactive Modals (Customer Directory, Shift, Scanner, Chat, Orders, Delivery Radar, Account, Help) */}
      <GlobalModals
        activeModal={activeModal}
        onClose={() => setActiveModal(null)}
        currencyMode={currencyMode}
        onNavigateTab={onNavigateTab || (() => {})}
        onSelectCustomer={(name) => setSelectedCustomer(name)}
        sessionSeconds={sessionSeconds}
      />
    </div>
  );
};

