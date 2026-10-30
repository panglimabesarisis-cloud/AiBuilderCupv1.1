import React, { useState, useMemo, useEffect } from 'react';
import {
  ArrowLeft,
  User,
  BarChart3,
  MapPin,
  Target,
  Ticket,
  Gift,
  Trophy,
  Info,
  MessageSquare,
  HelpCircle,
  Settings,
  Star,
  CheckCircle2,
  Clock,
  Sparkles,
  ShoppingBag,
  Copy,
  Check,
  Send,
  Lock,
  LogOut,
  Plus,
  Phone,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  Award,
  AlertCircle,
  Bot,
  RefreshCw,
} from 'lucide-react';
import { doc, updateDoc, setDoc, collection, query, where, limit, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import { ACTIVE_STORE_ID } from '../../config/store';
import {
  useAllPwaPageConfigs,
  useRewardClaims,
} from '../../services/pwaPageConfigService';

export const WA_ADMIN_CS_URL =
  'https://wa.me/6287785604021?text=Halo%20Admin%20RiskCart%2C%20saya%20butuh%20bantuan%20terkait%20pesanan%20saya.';

export type ProfileSubRoute =
  | 'index'
  | 'pwa-ai'
  | 'akun'
  | 'statistik'
  | 'alamat'
  | 'target'
  | 'voucher'
  | 'reward'
  | 'top-buyer'
  | 'informasi'
  | 'chat-admin'
  | 'faq'
  | 'pengaturan';

interface ClientPwaProfilePagesProps {
  subRoute: ProfileSubRoute;
  onNavigateSubRoute: (sub: ProfileSubRoute) => void;
  onBackToHome: () => void;
  member: {
    storeName?: string;
    ownerName?: string;
    name: string;
    phone: string;
    address: string;
    addressNotes?: string;
    latitude?: number | null;
    longitude?: number | null;
  };
  onUpdateMember: (updated: any) => void;
  customerDoc: any | null;
  allCustomers: any[];
  userOrders: any[];
  catalogProducts?: any[];
  formatCurrency: (val: number) => string;
  language: 'id' | 'en';
  onChangeLanguage: (lang: 'id' | 'en') => void;
  onLogout: () => void;
  showToast: (msg: string) => void;
  aiChatMessages?: Array<{ sender: 'ai' | 'user'; text: string; time: string; structuredItems?: any[] }>;
  aiInputText?: string;
  onChangeAiInput?: (val: string) => void;
  isAiProcessing?: boolean;
  onSendAiOrder?: (promptText?: string) => void;
  onOpenCart?: () => void;
  cartItemsCount?: number;
  rewardTargets?: any[];
}

export const ClientPwaProfilePages: React.FC<ClientPwaProfilePagesProps> = ({
  subRoute,
  onNavigateSubRoute,
  onBackToHome,
  member,
  onUpdateMember,
  customerDoc,
  allCustomers,
  userOrders,
  catalogProducts = [],
  formatCurrency,
  language,
  onChangeLanguage,
  onLogout,
  showToast,
  aiChatMessages = [],
  aiInputText = '',
  onChangeAiInput,
  isAiProcessing = false,
  onSendAiOrder,
  onOpenCart,
  cartItemsCount = 0,
  rewardTargets = [],
}) => {
  const tr = (en: string, id: string) => (language === 'id' ? id : en);

  // Automatic redirect if /client-pwa/profile/chat-admin is accessed directly
  useEffect(() => {
    if (subRoute === 'chat-admin') {
      window.location.href = WA_ADMIN_CS_URL;
    }
  }, [subRoute]);
  const { configs } = useAllPwaPageConfigs();
  const normPhone = String(member.phone || '').replace(/\D/g, '');
  const normalizedPhoneKey = normPhone.startsWith('0')
    ? '62' + normPhone.slice(1)
    : normPhone.startsWith('62')
    ? normPhone
    : normPhone
    ? '62' + normPhone
    : '';

  const customerId = customerDoc?.id || normalizedPhoneKey || 'guest';
  const { claims: customerClaims } = useRewardClaims();

  const myClaims = useMemo(() => {
    return customerClaims.filter(
      (c) =>
        c.customerId === customerId ||
        (normalizedPhoneKey && c.normalizedPhone === normalizedPhoneKey) ||
        (member.name && c.customerName?.toLowerCase() === member.name.toLowerCase())
    );
  }, [customerClaims, customerId, normalizedPhoneKey, member.name]);

  // Real-time customer metrics
  const activePoints = Number(customerDoc?.points ?? 0);
  const totalOrdersCount = Math.max(Number(customerDoc?.totalOrders ?? 0), userOrders.length);
  const computedTotalSpent = useMemo(() => {
    const sumOrders = userOrders.reduce((acc, o) => acc + Number(o.totalAmount || 0), 0);
    return Math.max(Number(customerDoc?.totalSpent ?? 0), sumOrders);
  }, [customerDoc, userOrders]);

  const activeDebt = Number(customerDoc?.debtAmount ?? 0);

  // Determine member tier & stars from config
  const profileCfg = (configs.profile || {}) as any;
  const akunCfg = (configs.akun || {}) as any;
  const statistikCfg = (configs.statistik || {}) as any;
  const alamatCfg = (configs.alamat || {}) as any;
  const targetCfg = (configs.target || {}) as any;
  const voucherCfg = (configs.voucher || {}) as any;
  const rewardCfg = (configs.reward || {}) as any;
  const topBuyerCfg = (configs['top-buyer'] || {}) as any;
  const infoCfg = (configs.informasi || {}) as any;
  const chatCfg = (configs['chat-admin'] || {}) as any;
  const faqCfg = (configs.faq || {}) as any;
  const pengaturanCfg = (configs.pengaturan || {}) as any;

  const memberTierInfo = useMemo(() => {
    const tiers = Array.isArray(akunCfg.tiers) ? akunCfg.tiers : [];
    let matched = { name: 'Silver Member', minSpentIdr: 0, stars: 3, benefit: 'Akses Katalog & Poin Reguler' };
    for (const t of tiers) {
      if (computedTotalSpent >= Number(t.minSpentIdr || 0)) {
        matched = t;
      }
    }
    return matched;
  }, [akunCfg.tiers, computedTotalSpent]);

  // Top Buyer Leaderboard Calculation
  const leaderboard = useMemo(() => {
    const list = (allCustomers || []).map((c: any) => {
      const cPhone = String(c.normalizedPhone || c.phone || '').replace(/\D/g, '');
      const isMe = cPhone && normalizedPhoneKey && cPhone === normalizedPhoneKey;
      const spent = isMe ? Math.max(Number(c.totalSpent || 0), computedTotalSpent) : Number(c.totalSpent || 0);
      const cartons = Math.max(1, Math.round(spent / 48000));
      return {
        id: c.id,
        name: c.storeName || c.name || 'Member RiskCart',
        ownerName: c.ownerName || c.name || 'Member',
        phone: c.phone || '',
        totalSpent: spent,
        totalCartons: cartons,
        points: Number(c.points || 0),
        isMe,
      };
    });
    return list.sort((a, b) => b.totalSpent - a.totalSpent);
  }, [allCustomers, normalizedPhoneKey, computedTotalSpent]);

  const myRank = useMemo(() => {
    const idx = leaderboard.findIndex((item) => item.isMe);
    return idx >= 0 ? idx + 1 : leaderboard.length + 1;
  }, [leaderboard]);

  // Fallback direct Firestore products subscription if catalogProducts prop is empty
  const [fallbackDbProducts, setFallbackDbProducts] = useState<any[]>([]);
  useEffect(() => {
    if (catalogProducts && catalogProducts.length > 0) return;
    const unsub = onSnapshot(
      query(collection(db, 'products'), where('storeId', '==', ACTIVE_STORE_ID), limit(250)),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          if (data.isActive === false || data.isPwaVisible === false) return;
          list.push({
            id: d.id,
            ...data,
            name: String(data.name || data.groupName || '').trim(),
            stockInUnits: Number(data.stock ?? data.stockInUnits ?? 0),
          });
        });
        setFallbackDbProducts(list);
      },
      () => {}
    );
    return () => unsub();
  }, [catalogProducts]);

  // Real-time subscription to `reward_targets`, `marketing_targets`, `settings/reward_targets`, and `localStorage`
  const [rewardTargetsSnap, setRewardTargetsSnap] = useState<any[]>([]);
  const [marketingTargets, setMarketingTargets] = useState<any[]>([]);
  const [settingsRewardTargets, setSettingsRewardTargets] = useState<any[]>([]);
  const [localStorageTargets, setLocalStorageTargets] = useState<any[]>(() => {
    const keys = [
      'riskcart_reward_targets',
      'riskcart_marketing_targets',
      'riskcart_fs_marketing_targets',
      'riskcart_fs_reward_targets',
      'reward_targets',
    ];
    const list: any[] = [];
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          list.push(...parsed);
        }
      } catch {}
    }
    return list;
  });

  useEffect(() => {
    const refreshLocalTargets = (e?: any) => {
      if (e?.detail && Array.isArray(e.detail)) {
        setLocalStorageTargets(e.detail);
        return;
      }
      const keys = [
        'riskcart_reward_targets',
        'riskcart_marketing_targets',
        'riskcart_fs_marketing_targets',
        'riskcart_fs_reward_targets',
        'reward_targets',
      ];
      const list: any[] = [];
      for (const k of keys) {
        try {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            list.push(...parsed);
          }
        } catch {}
      }
      setLocalStorageTargets(list);
    };

    window.addEventListener('riskcart:reward-targets-updated', refreshLocalTargets);
    window.addEventListener('storage', refreshLocalTargets);

    const unsubReward = onSnapshot(
      query(collection(db, 'reward_targets'), limit(20)),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...(d.data() as any) });
        });
        setRewardTargetsSnap(list);
      },
      () => {}
    );

    const unsubMarketing = onSnapshot(
      query(collection(db, 'marketing_targets'), limit(20)),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...(d.data() as any) });
        });
        setMarketingTargets(list);
      },
      () => {}
    );

    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'reward_targets'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as any;
          if (Array.isArray(data?.items)) {
            setSettingsRewardTargets(data.items);
          }
        }
      },
      () => {}
    );

    return () => {
      window.removeEventListener('riskcart:reward-targets-updated', refreshLocalTargets);
      window.removeEventListener('storage', refreshLocalTargets);
      unsubReward();
      unsubMarketing();
      unsubSettings();
    };
  }, []);

  // Combined Kejar Target promos from all sources: reward_targets, marketing_targets, settings/reward_targets, pwa_page_configs/target, prop, and localStorage
  const activeTargetPromos = useMemo(() => {
    const map = new Map<string, any>();

    const normalizeTargetItem = (t: any) => {
      if (!t || typeof t !== 'object') return null;
      const isExplicitlyHidden =
        t.isDeleted === true ||
        t.isActive === false ||
        t.active === false ||
        t.published === false ||
        t.showInPwa === false ||
        t.status === 'inactive' ||
        t.status === 'draft';
      if (isExplicitlyHidden) return null;

      const id = String(t.id || t.targetId || '').trim();
      if (!id) return null;

      const targetAmountIdr = Number(
        t.targetAmountIdr ??
          t.grandTotalBelanja ??
          t.minPurchaseAmount ??
          t.targetAmount ??
          t.targetValue ??
          0
      );
      const targetQtyCarton = Number(
        t.targetQtyCarton ?? t.totalTargetQty ?? t.minCartonQty ?? t.targetQty ?? 0
      );
      const bonusQty = Math.max(1, Number(t.bonusQty ?? t.physicalQtyCarton ?? 1));
      const bonusProductName =
        t.bonusProductName ||
        t.physicalProductName ||
        t.rewardName ||
        t.prize ||
        t.reward ||
        t.rewardTitleId ||
        'Hadiah Target';
      const rewardName = t.bonusProductName
        ? `${bonusQty} Karton ${t.bonusProductName}`
        : t.rewardName || t.prize || t.reward || t.rewardTitleId || 'Hadiah Target';

      return {
        id,
        title: t.title || t.name || t.targetName || t.titleId || 'Promo Kejar Target',
        startDate: t.startDate || '',
        endDate: t.endDate || '',
        period:
          t.startDate && t.endDate
            ? `${t.startDate} s/d ${t.endDate}`
            : t.period || targetCfg.periodLabel || 'Periode Aktif',
        promoInfo: t.promoInfo || t.description || '',
        items: Array.isArray(t.items) ? t.items : [],
        targetAmountIdr,
        targetQtyCarton,
        bonusProductId: t.bonusProductId || '',
        bonusProductSku: t.bonusProductSku || '',
        bonusProductName,
        bonusQty,
        bonusCostPrice: Number(t.bonusCostPrice || 0),
        rewardName,
        customerType: t.customerType || 'all',
      };
    };

    const allRawCandidates = [
      ...(Array.isArray(rewardTargets) ? rewardTargets : []),
      ...rewardTargetsSnap,
      ...marketingTargets,
      ...settingsRewardTargets,
      ...localStorageTargets,
      ...(Array.isArray(targetCfg.milestones) ? targetCfg.milestones : []),
    ];

    allRawCandidates.forEach((raw) => {
      const normalized = normalizeTargetItem(raw);
      if (normalized && !map.has(normalized.id)) {
        map.set(normalized.id, normalized);
      }
    });

    return Array.from(map.values());
  }, [
    rewardTargets,
    rewardTargetsSnap,
    marketingTargets,
    settingsRewardTargets,
    localStorageTargets,
    targetCfg.milestones,
    targetCfg.periodLabel,
  ]);

  const activeDbProducts = useMemo(() => {
    const source = catalogProducts && catalogProducts.length > 0 ? catalogProducts : fallbackDbProducts;
    return source.filter(
      (p) =>
        p &&
        String(p.name || '').trim().length > 0 &&
        Number(p.stockInUnits ?? p.stock ?? 0) > 0
    );
  }, [catalogProducts, fallbackDbProducts]);

  // Favorite products from userOrders (same source as /client-pwa/profile/statistik)
  const favoriteProducts = useMemo(() => {
    const map = new Map<
      string,
      { name: string; qty: number; orderCount: number; avgQty: number; totalIdr: number; category: string }
    >();
    userOrders.forEach((ord) => {
      (ord.items || []).forEach((it: any) => {
        const key = String(it.productName || it.name || '').trim();
        if (!key) return;
        const prev = map.get(key) || {
          name: key,
          qty: 0,
          orderCount: 0,
          avgQty: 1,
          totalIdr: 0,
          category: it.category || 'Umum',
        };
        const q = Math.max(1, Number(it.quantityOrdered || it.qty || it.quantity || 1));
        const sub = Number(it.subtotal || (it.unitPrice || it.sellingPrice || it.price || 0) * q);
        const nextQty = prev.qty + q;
        const nextCount = prev.orderCount + 1;
        map.set(key, {
          name: key,
          qty: nextQty,
          orderCount: nextCount,
          avgQty: Math.max(1, Math.round(nextQty / nextCount)),
          totalIdr: prev.totalIdr + sub,
          category: prev.category,
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
  }, [userOrders]);

  // Dynamic AI Order Chips, Welcome Text & Input Placeholder (Kondisi A: Customer Statistik, Kondisi B: DB Products stock > 0)
  const aiOrderRecommendations = useMemo(() => {
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
        const altDbProd = activeDbProducts.find(
          (p) => String(p.name || '').toLowerCase() !== fp0.name.toLowerCase()
        );
        if (altDbProd) {
          chips.push({
            prompt: tr(`Order 2 cartons ${altDbProd.name}`, `Pesan ${altDbProd.name} 2 dus`),
            label: tr(`Order 2 cartons ${altDbProd.name}`, `Pesan ${altDbProd.name} 2 dus`),
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

      return { chips, welcomeText, placeholderText };
    }

    // Kondisi B: Belum ada data transaksi pelanggan -> Ambil langsung dari koleksi products Firestore (stock > 0)
    if (activeDbProducts.length > 0) {
      const p0 = activeDbProducts[0];
      chips.push({
        prompt: tr(`Order 2 cartons ${p0.name}`, `Pesan ${p0.name} 2 dus`),
        label: tr(`Order 2 cartons ${p0.name}`, `Pesan ${p0.name} 2 dus`),
      });

      if (activeDbProducts.length >= 2) {
        const p1 = activeDbProducts[1];
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
        activeDbProducts.length >= 2 ? ` or "Order 1 carton ${activeDbProducts[1].name}"` : '';
      const secondExampleId =
        activeDbProducts.length >= 2 ? ` atau "Pesan ${activeDbProducts[1].name} 1 dus"` : '';

      const welcomeText = tr(
        `Hello! What would you like to order today?\n\nType the product name and quantity from our store catalog (e.g., "Order 2 cartons ${p0.name}"${secondExampleEn}), and I will automatically add them to your shopping cart!`,
        `Halo kak! Apa ada yang ingin dipesan hari ini?\n\nKetik nama produk dan jumlahnya dari katalog toko kami (misal: "Pesan ${p0.name} 2 dus"${secondExampleId}), saya akan langsung membaca pesanan dan memasukkannya ke keranjang belanja Anda!`
      );

      const placeholderText = tr(
        `Type your order (e.g. Order 2 cartons ${p0.name})...`,
        `Tulis pesanan Anda (misal: Pesan ${p0.name} 2 dus)...`
      );

      return { chips, welcomeText, placeholderText };
    }

    // Fallback when Firestore products collection has no in-stock items yet (never use dummy product names)
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
    };
  }, [favoriteProducts, activeDbProducts, language]);

  // Local interactive states for sub-pages
  const [voucherTab, setVoucherTab] = useState<'available' | 'claimed' | 'history'>('available');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [submittingClaimId, setSubmittingClaimId] = useState<string | null>(null);

  // Address states
  const [savedAddresses, setSavedAddresses] = useState<Array<{ id: string; label: string; address: string; notes: string; isPrimary: boolean }>>(() => {
    const customList = customerDoc?.savedAddresses;
    if (Array.isArray(customList) && customList.length > 0) return customList;
    return [
      {
        id: 'addr-1',
        label: 'Utama / Toko',
        address: member.address || customerDoc?.address || 'Alamat Pengiriman Utama',
        notes: member.addressNotes || 'Patokan depan jalan utama',
        isPrimary: true,
      },
    ];
  });
  const [newAddrLabel, setNewAddrLabel] = useState('Toko Cabang / Gudang');
  const [newAddrText, setNewAddrText] = useState('');
  const [newAddrNotes, setNewAddrNotes] = useState('');
  const [showAddAddrForm, setShowAddAddrForm] = useState(false);

  // Chat states
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<Array<{ sender: 'admin' | 'user'; text: string; time: string }>>([
    {
      sender: 'admin',
      text: chatCfg.welcomeGreeting || 'Halo Mitra RiskCart! Ada yang bisa kami bantu terkait pesanan grosir, stok, atau klaim hadiah?',
      time: 'Baru saja',
    },
  ]);

  // FAQ states
  const [faqQuery, setFaqQuery] = useState('');
  const [faqCat, setFaqCat] = useState('Semua');
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);

  // Account Settings states
  const [notifWaOrder, setNotifWaOrder] = useState(true);
  const [notifPromo, setNotifPromo] = useState(true);
  const [newPinInput, setNewPinInput] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  const handleSaveNewAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAddrText.trim()) return;
    const nextList = [
      ...savedAddresses,
      {
        id: `addr-${Date.now()}`,
        label: newAddrLabel,
        address: newAddrText.trim(),
        notes: newAddrNotes.trim(),
        isPrimary: savedAddresses.length === 0,
      },
    ];
    setSavedAddresses(nextList);
    onUpdateMember({ ...member, address: newAddrText.trim(), addressNotes: newAddrNotes.trim() });
    if (customerId && customerId !== 'guest' && auth.currentUser) {
      try {
        await setDoc(
          doc(db, 'customers', customerId),
          {
            customerUid: auth.currentUser.uid,
            address: newAddrText.trim(),
            addressNotes: newAddrNotes.trim(),
            savedAddresses: nextList,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (err) {
        console.warn('Update customer address error:', err);
      }
    }
    setNewAddrText('');
    setNewAddrNotes('');
    setShowAddAddrForm(false);
    showToast(tr('Delivery address saved to Firestore!', 'Alamat pengiriman berhasil disimpan ke database!'));
  };

  const handleClaimItem = async (params: {
    claimType: 'voucher' | 'reward_poin' | 'target_milestone';
    itemId: string;
    itemTitle: string;
    pointsCost: number;
    voucherCode?: string;
    discountValueIdr?: number;
    minOrderIdr?: number;
    targetRequiredIdr?: number;
    currentSpentIdr?: number;
    rewardProductName?: string;
    targetPromoId?: string;
    targetPromoName?: string;
    bonusProductId?: string;
    bonusProductSku?: string;
    bonusProductName?: string;
    bonusQty?: number;
    bonusCostPrice?: number;
    achievedQty?: number;
    targetQty?: number;
  }) => {
    if (!auth.currentUser) {
      showToast(tr('Please verify OTP first!', 'Silakan verifikasi OTP terlebih dahulu!'));
      return;
    }
    if (params.pointsCost > activePoints) {
      showToast(tr('Insufficient points balance!', 'Saldo poin Anda belum mencukupi!'));
      return;
    }
    setSubmittingClaimId(params.itemId);
    try {
      const now = new Date().toISOString();
      const claimId = `CLM-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const isVoucher = params.claimType === 'voucher';
      const generatedCode =
        params.voucherCode ||
        (isVoucher ? `VCH-${Math.random().toString(36).substring(2, 7).toUpperCase()}` : undefined);
      const customerNameVal = member.storeName
        ? `${member.ownerName || member.name} (${member.storeName})`
        : member.name || 'Member PWA';

      const record = {
        id: claimId,
        storeId: ACTIVE_STORE_ID,
        customerUid: auth.currentUser.uid,
        customerId,
        customerName: customerNameVal,
        customerPhone: member.phone,
        normalizedPhone: normalizedPhoneKey,
        claimType: params.claimType,
        itemId: params.itemId,
        itemTitle: params.itemTitle,
        pointsCost: Number(params.pointsCost || 0),
        voucherCode: generatedCode || '',
        discountValueIdr: Number(params.discountValueIdr || 0),
        minOrderIdr: Number(params.minOrderIdr || 0),
        targetRequiredIdr: Number(params.targetRequiredIdr || 0),
        currentSpentIdr: Number(params.currentSpentIdr ?? computedTotalSpent),
        rewardProductName: params.rewardProductName || params.itemTitle,
        status: isVoucher ? 'approved' : 'pending_pos',
        createdAt: now,
        updatedAt: now,
        targetPromoId: params.targetPromoId || params.itemId,
        targetPromoName: params.targetPromoName || params.itemTitle,
        bonusProductId: params.bonusProductId || '',
        bonusProductSku: params.bonusProductSku || '',
        bonusProductName: params.bonusProductName || params.rewardProductName || params.itemTitle,
        bonusQty: Number(params.bonusQty || 1),
        bonusCostPrice: Number(params.bonusCostPrice || 0),
        achievedQty: Number(params.achievedQty || 0),
        targetQty: Number(params.targetQty || 0),
      };

      await setDoc(doc(db, 'reward_claims', claimId), record, { merge: true });
      await setDoc(doc(db, `stores/${ACTIVE_STORE_ID}/reward_claims`, claimId), record, { merge: true });

      if (params.pointsCost > 0 && customerId && customerId !== 'guest') {
        const ledgerId = `PTL-${Date.now()}`;
        await setDoc(
          doc(db, 'point_ledger', ledgerId),
          {
            id: ledgerId,
            storeId: ACTIVE_STORE_ID,
            customerUid: auth.currentUser.uid,
            customerId,
            customerName: customerNameVal,
            customerPhone: member.phone,
            type: 'redeem',
            pointsDelta: -Math.abs(params.pointsCost),
            reason: `Klaim ${params.itemTitle} (${claimId})`,
            claimId,
            createdAt: now,
          },
          { merge: true }
        );
      }

      showToast(
        isVoucher
          ? `Voucher ${generatedCode} berhasil diklaim!`
          : 'Klaim hadiah berhasil dikirim ke Kasir POS!'
      );
    } catch (err) {
      console.warn('Submit claim error:', err);
      showToast(tr('Failed to submit claim.', 'Gagal mengirim klaim.'));
    } finally {
      setSubmittingClaimId(null);
    }
  };

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPinInput.trim() || newPinInput.trim().length < 4) {
      showToast(tr('PIN/Password min 4 characters', 'PIN/Password minimal 4 karakter'));
      return;
    }
    setSavingPin(true);
    try {
      if (customerId && customerId !== 'guest' && auth.currentUser) {
        await setDoc(
          doc(db, 'customers', customerId),
          {
            customerUid: auth.currentUser.uid,
            pin: newPinInput.trim(),
            password: newPinInput.trim(),
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }
      setNewPinInput('');
      showToast(tr('Security PIN/Password updated!', 'PIN/Password keamanan berhasil diperbarui!'));
    } finally {
      setSavingPin(false);
    }
  };

  const MENU_ITEMS: Array<{
    sub: ProfileSubRoute;
    titleId: string;
    titleEn: string;
    descId: string;
    descEn: string;
    icon: React.FC<{ className?: string }>;
    badge?: string;
  }> = [
    {
      sub: 'pwa-ai',
      titleId: 'Order Cepat Pakai AI (Asisten Belanja)',
      titleEn: 'AI Quick Order Assistant',
      descId: 'Ketik nama produk & jumlah dus/unit, otomatis masuk keranjang belanja',
      descEn: 'Type product name & carton/unit quantity to add to cart automatically',
      icon: Bot,
      badge: 'Gemini AI',
    },
    {
      sub: 'akun',
      titleId: '1. Profil Saya',
      titleEn: '1. My Profile',
      descId: 'Identitas member, bintang level, produk favorit & transaksi',
      descEn: 'Member identity, star level, favorite products & transactions',
      icon: User,
      badge: `${memberTierInfo.stars || 5}★`,
    },
    {
      sub: 'statistik',
      titleId: '2. Statistik Pembelian',
      titleEn: '2. Purchase Statistics',
      descId: 'KPI belanja, tren grafik bulanan, kategori & sisa kasbon',
      descEn: 'Shopping KPIs, monthly trend chart, categories & active credit',
      icon: BarChart3,
    },
    {
      sub: 'alamat',
      titleId: '3. Alamat Pengiriman',
      titleEn: '3. Delivery Addresses',
      descId: 'Daftar alamat toko/gudang, titik GPS & estimasi ongkir',
      descEn: 'Store/warehouse addresses, GPS coordinates & delivery fee',
      icon: MapPin,
      badge: `${savedAddresses.length} Lokasi`,
    },
    {
      sub: 'target',
      titleId: '4. Target Belanja & Hadiah',
      titleEn: '4. Shopping Targets & Gifts',
      descId: 'Progress bar target bulanan & klaim hadiah milestone',
      descEn: 'Monthly target progress bar & milestone gift claims',
      icon: Target,
    },
    {
      sub: 'voucher',
      titleId: '5. Voucher & Promo',
      titleEn: '5. Vouchers & Promos',
      descId: 'Klaim kode voucher diskon grosir & gratis ongkir',
      descEn: 'Claim wholesale discount vouchers & free delivery codes',
      icon: Ticket,
      badge: `${(voucherCfg.vouchers || []).length} Promo`,
    },
    {
      sub: 'reward',
      titleId: '6. Tukar Poin & Reward',
      titleEn: '6. Redeem Points & Rewards',
      descId: 'Katalog penukaran poin ke produk gratis & voucher',
      descEn: 'Redeem loyalty points for free products & vouchers',
      icon: Gift,
      badge: `${activePoints.toLocaleString('id-ID')} Pts`,
    },
    {
      sub: 'top-buyer',
      titleId: '7. Peringkat Pembeli (Top Buyer)',
      titleEn: '7. Top Buyer Leaderboard',
      descId: 'Podium Juara 1-3, Top 10 pembeli & hadiah bulanan',
      descEn: 'Top 1-3 Podium, Top 10 buyers & monthly rewards',
      icon: Trophy,
      badge: `#${myRank}`,
    },
    {
      sub: 'informasi',
      titleId: '8. Informasi Toko',
      titleEn: '8. Store Information',
      descId: 'Profil resmi distributor, jam operasional & pengumuman',
      descEn: 'Official distributor profile, hours & announcements',
      icon: Info,
    },
    {
      sub: 'chat-admin',
      titleId: '9. Chat Admin & CS',
      titleEn: '9. Chat Admin & Support',
      descId: 'Hubungi langsung Admin & CS via WhatsApp (+6287785604021)',
      descEn: 'Direct WhatsApp chat with Admin & Support (+6287785604021)',
      icon: MessageSquare,
      badge: 'WA Live',
    },
    {
      sub: 'faq',
      titleId: '10. Pusat Bantuan (FAQ)',
      titleEn: '10. Help Center (FAQ)',
      descId: 'Cari jawaban seputar pesanan, pembayaran, pengiriman & poin',
      descEn: 'Find answers about orders, payment, delivery & points',
      icon: HelpCircle,
    },
    {
      sub: 'pengaturan',
      titleId: '11. Pengaturan Akun',
      titleEn: '11. Account Settings',
      descId: 'Notifikasi WhatsApp, ubah PIN keamanan, bahasa & Logout',
      descEn: 'WhatsApp notifications, change security PIN, language & Logout',
      icon: Settings,
    },
  ];

  const goldCardStyle: React.CSSProperties = {
    background: 'linear-gradient(180deg, rgba(24, 18, 9, 0.94) 0%, rgba(12, 9, 4, 0.96) 100%)',
    border: '1.5px solid rgba(245, 158, 11, 0.36)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
  };

  const initials = (member.storeName || member.name || 'RC')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  // ============================================================================
  // MAIN PROFILE HUB (/client-pwa/profile)
  // ============================================================================
  if (subRoute === 'index') {
    return (
      <div className="space-y-4 pb-8">
        {/* Top Header Bar with ← Kembali */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={onBackToHome}
            className="px-3.5 py-2 rounded-xl flex items-center gap-2 text-xs font-extrabold cursor-pointer transition"
            style={{
              background: 'rgba(245, 158, 11, 0.14)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              color: '#fde68a',
            }}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{tr('← Back to Home', '← Kembali')}</span>
          </button>
          <span className="text-xs font-black uppercase tracking-wider text-amber-400">
            {profileCfg.headerTitle || tr('Member Profile Center', 'Pusat Akun & Loyalti Member')}
          </span>
        </div>

        {/* Kartu Identitas Member Dark Obsidian & Gold */}
        <div
          className="p-5 rounded-3xl space-y-4 relative overflow-hidden"
          style={{
            background:
              'radial-gradient(280px 160px at 90% 0%, rgba(245, 158, 11, 0.22), transparent 70%), linear-gradient(145deg, #1b1307 0%, #0d0904 100%)',
            border: '1.5px solid rgba(245, 158, 11, 0.5)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.6), 0 0 24px rgba(245, 158, 11, 0.15)',
          }}
        >
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-black shrink-0"
              style={{
                background: 'linear-gradient(135deg, #ffd86b 0%, #d49b27 55%, #9c6b12 100%)',
                color: '#1b1204',
                boxShadow: '0 0 20px rgba(245, 158, 11, 0.4)',
              }}
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/20 border border-amber-400/50 text-amber-300">
                  {memberTierInfo.name}
                </span>
                <span className="text-xs text-amber-400 font-bold flex items-center gap-0.5">
                  {Array.from({ length: Number(memberTierInfo.stars || 5) }).map((_, i) => (
                    <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  ))}
                </span>
              </div>
              <h2 className="text-lg font-black text-white truncate mt-1">
                {member.storeName || member.name || 'Mitra Toko RiskCart'}
              </h2>
              <p className="text-xs text-amber-200/80 font-mono truncate">
                {member.ownerName || member.name} &bull; WA: {member.phone}
              </p>
              <p className="text-[11px] text-amber-400/90 mt-0.5 font-semibold">
                {tr('Current Buyer Rank:', 'Peringkat Pembeli Saat Ini:')} <strong>#{myRank}</strong>
              </p>
            </div>
          </div>

          {/* 3 Kotak Metrik Real-time (Poin, Pesanan, Belanja dalam IDR/USD) */}
          <div className="grid grid-cols-3 gap-2.5 pt-2">
            <div
              onClick={() => onNavigateSubRoute('reward')}
              className="p-3 rounded-2xl text-center cursor-pointer transition hover:scale-[1.02]"
              style={{
                background: 'rgba(10, 8, 4, 0.88)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
              }}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80 block">
                {tr('Points', 'Poin Aktif')}
              </span>
              <span className="text-base sm:text-lg font-black font-mono text-amber-400 mt-0.5 block">
                {activePoints.toLocaleString('id-ID')}
              </span>
              <span className="text-[9px] text-zinc-400 block">Pts Loyalti</span>
            </div>

            <div
              onClick={() => onNavigateSubRoute('statistik')}
              className="p-3 rounded-2xl text-center cursor-pointer transition hover:scale-[1.02]"
              style={{
                background: 'rgba(10, 8, 4, 0.88)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
              }}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80 block">
                {tr('Orders', 'Pesanan')}
              </span>
              <span className="text-base sm:text-lg font-black font-mono text-white mt-0.5 block">
                {totalOrdersCount}
              </span>
              <span className="text-[9px] text-zinc-400 block">{tr('Transactions', 'Transaksi')}</span>
            </div>

            <div
              onClick={() => onNavigateSubRoute('statistik')}
              className="p-3 rounded-2xl text-center cursor-pointer transition hover:scale-[1.02]"
              style={{
                background: 'rgba(10, 8, 4, 0.88)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
              }}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80 block">
                {tr('Total Spent', 'Belanja')}
              </span>
              <span className="text-xs sm:text-sm font-black font-mono text-emerald-400 mt-1 block truncate">
                {formatCurrency(computedTotalSpent)}
              </span>
              <span className="text-[9px] text-zinc-400 block">Real-Time</span>
            </div>
          </div>
        </div>

        {/* Daftar 11 Menu Navigasi Halaman Mandiri */}
        <div className="space-y-2.5">
          <div className="px-1 flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-amber-400/90">
              {tr('Dedicated Member Pages (11 Modules)', 'Menu Halaman Mandiri Member (11 Modul)')}
            </span>
          </div>

          {MENU_ITEMS.map((item) => {
            const IconComp = item.icon;
            const isChatAdmin = item.sub === 'chat-admin';
            return (
              <button
                key={item.sub}
                type="button"
                onClick={() => {
                  if (isChatAdmin) {
                    const win = window.open(WA_ADMIN_CS_URL, '_blank', 'noopener,noreferrer');
                    if (!win) {
                      window.location.href = WA_ADMIN_CS_URL;
                    }
                    return;
                  }
                  onNavigateSubRoute(item.sub);
                }}
                className="w-full p-3.5 rounded-2xl flex items-center justify-between gap-3 text-left cursor-pointer transition hover:scale-[1.01]"
                style={goldCardStyle}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background: 'rgba(245, 158, 11, 0.15)',
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                      color: '#fbbf24',
                    }}
                  >
                    <IconComp className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-extrabold text-white truncate">
                      {tr(item.titleEn, item.titleId)}
                    </div>
                    <div className="text-[11px] text-zinc-400 truncate mt-0.5">
                      {tr(item.descEn, item.descId)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {item.badge && (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 border border-amber-400/40 text-amber-300">
                      {item.badge}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-amber-400" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Common Header for all Sub-Pages with ← Kembali button
  const currentMenuMeta =
    subRoute === 'pwa-ai'
      ? {
          sub: 'pwa-ai' as ProfileSubRoute,
          titleId: 'Order Via AI',
          titleEn: 'Order Via AI',
        }
      : MENU_ITEMS.find((m) => m.sub === subRoute);

  return (
    <div className="space-y-4 pb-10">
      {/* Sub-Page Header */}
      <div
        className="p-3.5 rounded-2xl flex items-center justify-between gap-3"
        style={goldCardStyle}
      >
        <button
          type="button"
          onClick={() => onNavigateSubRoute('index')}
          className="px-3 py-1.5 rounded-xl flex items-center gap-1.5 text-xs font-extrabold cursor-pointer transition"
          style={{
            background: 'rgba(245, 158, 11, 0.16)',
            border: '1px solid rgba(245, 158, 11, 0.45)',
            color: '#fde68a',
          }}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{tr('← Back', '← Kembali')}</span>
        </button>
        <div className="text-right min-w-0">
          <div className="text-xs sm:text-sm font-black text-amber-300 truncate">
            {currentMenuMeta ? tr(currentMenuMeta.titleEn, currentMenuMeta.titleId) : subRoute.toUpperCase()}
          </div>
          <div className="text-[10px] font-mono text-zinc-400">
            /client-pwa/profile/{subRoute}
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 1. PROFIL SAYA (/client-pwa/profile/akun)                            */}
      {/* ==================================================================== */}
      {subRoute === 'akun' && (
        <div className="space-y-4">
          <div className="p-5 rounded-2xl space-y-3" style={goldCardStyle}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-amber-400">
                {akunCfg.headerTitle || tr('Member Identity & Star Tier', 'Identitas Member & Bintang Level')}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300">
                {tr('Verified Member', 'Member Aktif Terverifikasi')}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
              <div className="p-3 rounded-xl bg-black/50 border border-amber-500/20">
                <span className="text-zinc-400 block">{tr('Store / Business Name', 'Nama Toko / Usaha')}</span>
                <strong className="text-white text-sm">{member.storeName || member.name}</strong>
              </div>
              <div className="p-3 rounded-xl bg-black/50 border border-amber-500/20">
                <span className="text-zinc-400 block">{tr('Owner Name & WhatsApp', 'Nama Pemilik & No. WA')}</span>
                <strong className="text-amber-300 font-mono text-sm">
                  {member.ownerName || member.name} &bull; {member.phone}
                </strong>
              </div>
              <div className="p-3 rounded-xl bg-black/50 border border-amber-500/20">
                <span className="text-zinc-400 block">{tr('Current Star Level', 'Level Bintang Saat Ini')}</span>
                <strong className="text-amber-400 text-sm flex items-center gap-1 mt-0.5">
                  {memberTierInfo.name} ({memberTierInfo.stars} Bintang)
                </strong>
              </div>
              <div className="p-3 rounded-xl bg-black/50 border border-amber-500/20">
                <span className="text-zinc-400 block">{tr('Member Privilege', 'Keuntungan Level Member')}</span>
                <strong className="text-emerald-300 text-xs">{memberTierInfo.benefit}</strong>
              </div>
            </div>
          </div>

          {/* Produk Favorit Otomatis */}
          <div className="p-4 rounded-2xl space-y-3" style={goldCardStyle}>
            <h3 className="text-xs font-black uppercase tracking-wider text-amber-400">
              {tr('Your Automatic Favorite Products', 'Produk Favorit Otomatis Anda')}
            </h3>
            {favoriteProducts.length === 0 ? (
              <p className="text-xs text-zinc-400 py-3">
                {tr('Place orders to see your most frequently purchased items.', 'Belum ada riwayat produk favorit. Pesan produk untuk melihat analitik otomatis.')}
              </p>
            ) : (
              <div className="space-y-2">
                {favoriteProducts.slice(0, 5).map((fp, i) => (
                  <div
                    key={fp.name}
                    className="p-3 rounded-xl bg-black/50 border border-amber-500/20 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-white block">
                        #{i + 1} {fp.name}
                      </span>
                      <span className="text-[10px] text-zinc-400">
                        {tr('Total Purchased:', 'Total Dibeli:')} {fp.qty} Dus/Unit
                      </span>
                    </div>
                    <span className="font-mono font-bold text-amber-400">
                      {formatCurrency(fp.totalIdr)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tabel Transaksi Terakhir */}
          <div className="p-4 rounded-2xl space-y-3" style={goldCardStyle}>
            <h3 className="text-xs font-black uppercase tracking-wider text-amber-400">
              {tr('Recent Transactions Table', 'Tabel Riwayat Transaksi Member')}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-amber-300/80 border-b border-amber-500/20 text-[10px] uppercase">
                  <tr>
                    <th className="py-2 px-2">ID</th>
                    <th className="py-2 px-2">{tr('Date', 'Tanggal')}</th>
                    <th className="py-2 px-2 text-right">Total</th>
                    <th className="py-2 px-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-500/10">
                  {userOrders.slice(0, 10).map((ord) => (
                    <tr key={ord.id}>
                      <td className="py-2.5 px-2 font-mono font-bold text-amber-300">#{ord.id.slice(-6)}</td>
                      <td className="py-2.5 px-2 text-zinc-300">
                        {new Date(ord.createdAt).toLocaleDateString('id-ID')}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono font-bold text-white">
                        {formatCurrency(ord.totalAmount)}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300">
                          {ord.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {userOrders.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-zinc-500">
                        {tr('No transactions recorded yet.', 'Belum ada transaksi tercatat.')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 2. STATISTIK PEMBELIAN (/client-pwa/profile/statistik)               */}
      {/* ==================================================================== */}
      {subRoute === 'statistik' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl" style={goldCardStyle}>
              <span className="text-[10px] font-bold uppercase text-amber-300/80 block">
                {tr('Cumulative Spending', 'Total Nilai Belanja')}
              </span>
              <span className="text-base sm:text-lg font-black font-mono text-amber-400 mt-1 block">
                {formatCurrency(computedTotalSpent)}
              </span>
            </div>
            <div className="p-4 rounded-2xl" style={goldCardStyle}>
              <span className="text-[10px] font-bold uppercase text-rose-300/80 block">
                {tr('Active Credit / Tempo', 'Sisa Hutang / Kasbon Aktif')}
              </span>
              <span className="text-base sm:text-lg font-black font-mono text-rose-400 mt-1 block">
                {formatCurrency(activeDebt)}
              </span>
            </div>
          </div>

          {/* Area / Bar Trend Chart */}
          <div className="p-4 rounded-2xl space-y-3" style={goldCardStyle}>
            <h3 className="text-xs font-black uppercase tracking-wider text-amber-400">
              {statistikCfg.headerTitle || tr('Shopping Trend & Category Distribution', 'Tren Belanja & Distribusi Kategori Minuman')}
            </h3>
            <div className="space-y-2">
              {(favoriteProducts.length > 0
                ? favoriteProducts.slice(0, 6)
                : [
                    { name: 'Minuman Kemasan Dus', qty: 12, totalIdr: computedTotalSpent * 0.6 || 450000 },
                    { name: 'Air Mineral & Galon', qty: 8, totalIdr: computedTotalSpent * 0.4 || 280000 },
                  ]
              ).map((item) => {
                const maxVal = Math.max(1, computedTotalSpent || 1000000);
                const pct = Math.min(100, Math.max(12, Math.round((item.totalIdr / maxVal) * 100)));
                return (
                  <div key={item.name} className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-white font-bold">{item.name} ({item.qty} Dus/Unit)</span>
                      <span className="font-mono text-amber-300">{formatCurrency(item.totalIdr)}</span>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-black/60 overflow-hidden border border-amber-500/20">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: 'linear-gradient(90deg, #f59e0b 0%, #fde68a 100%)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 3. ALAMAT PENGIRIMAN (/client-pwa/profile/alamat)                    */}
      {/* ==================================================================== */}
      {subRoute === 'alamat' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl space-y-3" style={goldCardStyle}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-amber-400">
                  {alamatCfg.headerTitle || tr('Saved Delivery Addresses', 'Daftar Alamat Pengiriman Tersimpan')}
                </h3>
                <p className="text-[11px] text-zinc-400">
                  {tr('Store Center:', 'Gudang Pusat:')} {alamatCfg.storeOriginAddress || 'Pusat Grosir RiskCart'} &bull;{' '}
                  {tr('Free Delivery Min:', 'Gratis Ongkir Min:')} {formatCurrency(Number(alamatCfg.freeDeliveryMinOrderIdr || 500000))}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddAddrForm((p) => !p)}
                className="px-3 py-1.5 rounded-xl bg-amber-500 text-zinc-950 font-black text-xs cursor-pointer"
              >
                + {tr('Add Address', 'Tambah Alamat')}
              </button>
            </div>

            {showAddAddrForm && (
              <form onSubmit={handleSaveNewAddress} className="p-3.5 rounded-xl bg-black/60 border border-amber-500/30 space-y-2.5 text-xs">
                <div>
                  <label className="block text-amber-300 font-bold mb-1">Label Lokasi (Utama / Toko / Gudang)</label>
                  <input
                    type="text"
                    value={newAddrLabel}
                    onChange={(e) => setNewAddrLabel(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-amber-500/30 text-white"
                  />
                </div>
                <div>
                  <label className="block text-amber-300 font-bold mb-1">Alamat Lengkap Pengiriman *</label>
                  <textarea
                    rows={2}
                    required
                    value={newAddrText}
                    onChange={(e) => setNewAddrText(e.target.value)}
                    placeholder="Jl. Raya Grosir No. 12, RT/RW..."
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-amber-500/30 text-white"
                  />
                </div>
                <div>
                  <label className="block text-amber-300 font-bold mb-1">Catatan Patokan Kurir</label>
                  <input
                    type="text"
                    value={newAddrNotes}
                    onChange={(e) => setNewAddrNotes(e.target.value)}
                    placeholder="Sebelah agen gas / pagar warna emas"
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-amber-500/30 text-white"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-amber-500 text-zinc-950 font-black text-xs uppercase cursor-pointer"
                >
                  {tr('Save to Firestore', 'Simpan Alamat ke Database')}
                </button>
              </form>
            )}

            <div className="space-y-2.5">
              {savedAddresses.map((addr) => (
                <div
                  key={addr.id}
                  className="p-3.5 rounded-xl bg-black/50 border border-amber-500/30 flex items-start justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px]">
                        {addr.label}
                      </span>
                      {addr.isPrimary && (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[10px]">
                          Utama
                        </span>
                      )}
                    </div>
                    <p className="font-bold text-white">{addr.address}</p>
                    {addr.notes && <p className="text-[11px] text-zinc-400">Patokan: {addr.notes}</p>}
                    {member.latitude && member.longitude && (
                      <p className="text-[10px] font-mono text-emerald-400">
                        GPS: {member.latitude}, {member.longitude}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateMember({ ...member, address: addr.address, addressNotes: addr.notes });
                      showToast(tr('Selected as active delivery address', 'Dipilih sebagai alamat kirim utama'));
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold text-[11px] shrink-0 cursor-pointer"
                  >
                    {tr('Use Address', 'Gunakan')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 4. TARGET BELANJA & KEJAR TARGET (/client-pwa/profile/target)        */}
      {/* ==================================================================== */}
      {subRoute === 'target' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl space-y-2" style={goldCardStyle}>
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">
              {targetCfg.periodLabel || 'Program Kejar Target & Hadiah Bonus Produk'}
            </span>
            <h3 className="text-base font-black text-white">
              {tr('Your Current Total Purchase:', 'Total Akumulasi Pembelian Anda:')} {formatCurrency(computedTotalSpent)}
            </h3>
            <p className="text-xs text-zinc-400">
              {targetCfg.headerSubtitle ||
                'Penuhi target pembelian produk promo di bawah ini. Jika bar sudah mencapai 100%, tombol Claim Hadiah akan otomatis aktif!'}
            </p>
          </div>

          <div className="space-y-3.5">
            {activeTargetPromos.length === 0 ? (
              <div className="p-8 rounded-2xl text-center text-xs text-zinc-400" style={goldCardStyle}>
                Belum ada program Kejar Target yang aktif saat ini.
              </div>
            ) : (
              activeTargetPromos.map((ms: any) => {
                const targetItems: any[] = Array.isArray(ms.items) ? ms.items : [];
                const reqIdr = Number(ms.targetAmountIdr || 0);
                const reqTotalQty =
                  targetItems.length > 0
                    ? targetItems.reduce((s, it) => s + Math.max(1, Number(it.targetQty || 1)), 0)
                    : Number(ms.targetQtyCarton || 0);

                // Calculate per-product purchase progress from userOrders
                const validOrders = (userOrders || []).filter(
                  (ord: any) =>
                    String(ord.status || '').toLowerCase() !== 'cancelled' &&
                    String(ord.status || '').toLowerCase() !== 'rejected' &&
                    String(ord.status || '').toLowerCase() !== 'dibatalkan'
                );

                let matchedQtySum = 0;
                let matchedSpendSum = 0;

                const itemProgressList = targetItems.map((tItem: any) => {
                  const tProdId = String(tItem.productId || '').trim().toLowerCase();
                  const tSku = String(tItem.productSku || '').trim().toLowerCase();
                  const tName = String(tItem.productName || '').trim().toLowerCase();
                  const tReqQty = Math.max(1, Number(tItem.targetQty || 1));
                  const tPromoPrice = Number(tItem.promoPrice || tItem.sellingPrice || 0);

                  let boughtQty = 0;
                  let boughtSpend = 0;

                  validOrders.forEach((ord: any) => {
                    (ord.items || []).forEach((line: any) => {
                      const lId = String(line.productId || line.id || '').trim().toLowerCase();
                      const lSku = String(line.sku || line.productSku || '').trim().toLowerCase();
                      const lName = String(line.productName || line.name || '').trim().toLowerCase();

                      const isMatch =
                        (tProdId && lId === tProdId) ||
                        (tSku && lSku && lSku === tSku) ||
                        (tName && lName && (lName === tName || lName.includes(tName) || tName.includes(lName)));

                      if (isMatch) {
                        const q = Math.max(
                          1,
                          Number(line.quantityOrdered ?? line.qty ?? line.quantity ?? 1)
                        );
                        const sub = Number(
                          line.subtotal ??
                            Number(line.unitPrice ?? line.sellingPrice ?? line.price ?? tPromoPrice) * q
                        );
                        boughtQty += q;
                        boughtSpend += sub;
                      }
                    });
                  });

                  matchedQtySum += Math.min(boughtQty, tReqQty);
                  matchedSpendSum += boughtSpend;

                  return {
                    ...tItem,
                    boughtQty,
                    boughtSpend,
                    tReqQty,
                    tPromoPrice,
                    rowPct: Math.min(100, Math.round((boughtQty / Math.max(1, tReqQty)) * 100)),
                  };
                });

                // Overall progress bar calculation:
                // If target items exist, use max of (matched product qty %, overall spend vs grandTotalBelanja %)
                // so customer purchases always reflect accurately on the progress bar.
                const qtyPct =
                  reqTotalQty > 0
                    ? Math.min(100, Math.round((matchedQtySum / Math.max(1, reqTotalQty)) * 100))
                    : 0;
                const spendSource = matchedSpendSum > 0 ? matchedSpendSum : computedTotalSpent;
                const spendPct =
                  reqIdr > 0
                    ? Math.min(100, Math.round((spendSource / Math.max(1, reqIdr)) * 100))
                    : 0;

                const pct =
                  targetItems.length > 0 && matchedQtySum > 0
                    ? Math.max(qtyPct, spendPct)
                    : spendPct || qtyPct;

                const isReached = pct >= 100 || (reqIdr > 0 && spendSource >= reqIdr) || (reqTotalQty > 0 && matchedQtySum >= reqTotalQty);

                const existingClaim = myClaims.find(
                  (c) =>
                    (c.claimType === 'target_milestone' ||
                      c.claimTypeSlug === 'target_milestone' ||
                      c.claimType === 'Hadiah Target') &&
                    (c.itemId === ms.id || c.rewardId === ms.id || c.targetPromoId === ms.id) &&
                    c.status !== 'rejected'
                );

                return (
                  <div key={ms.id} className="p-4 rounded-2xl space-y-3.5" style={goldCardStyle}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-500/20 border border-amber-400/40 text-amber-300">
                            {ms.period || 'Kejar Target'}
                          </span>
                          {isReached && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-500/20 border border-emerald-400/50 text-emerald-300">
                              Target Terpenuhi ✓
                            </span>
                          )}
                        </div>
                        <h4 className="text-sm font-black text-white pt-0.5">{ms.title}</h4>
                        {ms.promoInfo && (
                          <p className="text-[11px] text-zinc-300">{ms.promoInfo}</p>
                        )}
                      </div>
                      <span
                        className={`font-mono font-black text-base ${
                          isReached ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        {pct}%
                      </span>
                    </div>

                    {/* Per-Product Target Breakdown */}
                    {itemProgressList.length > 0 && (
                      <div className="p-3 rounded-xl bg-black/50 border border-amber-500/25 space-y-2 text-xs">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase text-amber-300/80">
                          <span>Produk Target Promo</span>
                          <span>Pencapaian Qty</span>
                        </div>
                        {itemProgressList.map((itProg, idx) => (
                          <div key={itProg.productId || idx} className="space-y-1 pt-1 border-t border-zinc-800/80 first:border-0 first:pt-0">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <span className="font-bold text-white block">{itProg.productName}</span>
                                <span className="text-[10px] font-mono text-amber-300">
                                  Harga Promo: {formatCurrency(itProg.tPromoPrice)} / Karton
                                </span>
                              </div>
                              <span className="font-mono font-bold text-xs text-emerald-300">
                                {itProg.boughtQty} / {itProg.tReqQty} Karton
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Bonus Hadiah Highlight */}
                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-400/30 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <Gift className="w-4 h-4 text-amber-400 shrink-0" />
                        <div>
                          <span className="text-[10px] text-amber-200/80 block">Hadiah Bonus Target:</span>
                          <strong className="text-amber-300 font-black">
                            {ms.bonusQty || 1} Karton {ms.bonusProductName || ms.rewardName}
                          </strong>
                        </div>
                      </div>
                      {reqIdr > 0 && (
                        <div className="text-right">
                          <span className="text-[10px] text-zinc-400 block">Target Belanja:</span>
                          <span className="font-mono font-bold text-white">{formatCurrency(reqIdr)}</span>
                        </div>
                      )}
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="w-full h-3.5 rounded-full bg-black/80 border border-amber-500/35 overflow-hidden p-0.5">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            background: isReached
                              ? 'linear-gradient(90deg, #10b981 0%, #34d399 100%)'
                              : 'linear-gradient(90deg, #f59e0b 0%, #fde68a 100%)',
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-zinc-400">
                        <span>
                          {reqTotalQty > 0
                            ? `Progress Qty: ${matchedQtySum} / ${reqTotalQty} Karton`
                            : `Tercapai: ${formatCurrency(spendSource)}`}
                        </span>
                        <span>
                          {existingClaim
                            ? `Status Klaim: ${existingClaim.status.toUpperCase()}`
                            : isReached
                            ? tr('Target Reached! Click Claim below', 'Target Terpenuhi! Silakan Klaim Hadiah')
                            : `${tr('Remaining:', 'Kurang:')} ${formatCurrency(Math.max(0, reqIdr - spendSource))}`}
                        </span>
                      </div>
                    </div>

                    {/* Action / Claim Button (Appears prominently when Target is met or already claimed) */}
                    <div className="pt-1 flex items-center justify-end gap-2">
                      {isReached || existingClaim ? (
                        <button
                          type="button"
                          disabled={Boolean(existingClaim) || submittingClaimId === ms.id}
                          onClick={() =>
                            handleClaimItem({
                              claimType: 'target_milestone',
                              itemId: ms.id,
                              itemTitle: `${ms.title} — Bonus: ${ms.bonusQty || 1} Karton ${ms.bonusProductName || ms.rewardName}`,
                              pointsCost: 0,
                              targetRequiredIdr: reqIdr,
                              currentSpentIdr: spendSource,
                              rewardProductName: ms.bonusProductName || ms.rewardName,
                              targetPromoId: ms.id,
                              targetPromoName: ms.title,
                              bonusProductId: ms.bonusProductId || '',
                              bonusProductSku: ms.bonusProductSku || '',
                              bonusProductName: ms.bonusProductName || ms.rewardName,
                              bonusQty: Math.max(1, Number(ms.bonusQty || 1)),
                              bonusCostPrice: Number(ms.bonusCostPrice || 0),
                              achievedQty: matchedQtySum || reqTotalQty,
                              targetQty: reqTotalQty,
                            })
                          }
                          className="w-full py-2.5 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer disabled:opacity-60 shadow-lg"
                          style={{
                            background: existingClaim
                              ? 'rgba(16, 185, 129, 0.22)'
                              : 'linear-gradient(100deg, #10b981 0%, #34d399 100%)',
                            color: existingClaim ? '#6ee7b7' : '#052e16',
                            border: existingClaim
                              ? '1px solid rgba(16, 185, 129, 0.45)'
                              : '1px solid rgba(52, 211, 153, 0.8)',
                          }}
                        >
                          {submittingClaimId === ms.id
                            ? 'Mengirim Klaim ke Admin...'
                            : existingClaim
                            ? existingClaim.status === 'pending'
                              ? 'Menunggu Persetujuan Admin (/claim-hadiah)'
                              : existingClaim.status === 'approved'
                              ? 'Klaim Disetujui Admin ✓ (Stok Bonus Diproses)'
                              : 'Hadiah Sudah Diklaim ✓'
                            : '🎁 Claim Hadiah Target Sekarang'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={onBackToHome}
                          className="w-full py-2 px-3.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold transition cursor-pointer"
                        >
                          Belanja Produk Target Sekarang &rarr;
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 5. VOUCHER & PROMO (/client-pwa/profile/voucher)                     */}
      {/* ==================================================================== */}
      {subRoute === 'voucher' && (
        <div className="space-y-4">
          {/* Sub-Tab Selector */}
          <div className="grid grid-cols-3 gap-2 p-1.5 rounded-2xl bg-black/60 border border-amber-500/30 text-xs">
            {[
              { id: 'available' as const, label: tr('Available Vouchers', 'Voucher Tersedia') },
              { id: 'claimed' as const, label: tr('Claimed', 'Sudah Diklaim') },
              { id: 'history' as const, label: tr('History', 'Riwayat') },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setVoucherTab(t.id)}
                className="py-2 px-2 rounded-xl font-black transition cursor-pointer"
                style={
                  voucherTab === t.id
                    ? {
                        background: 'linear-gradient(100deg, #f59e0b 0%, #fbbf24 100%)',
                        color: '#1b1204',
                      }
                    : { color: '#fde68a' }
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          {voucherTab === 'available' && (
            <div className="space-y-3">
              {(Array.isArray(voucherCfg.vouchers) ? voucherCfg.vouchers : [])
                .filter((v: any) => v.active !== false)
                .map((v: any) => {
                  const alreadyClaimed = myClaims.find(
                    (c) => c.claimType === 'voucher' && (c.itemId === v.id || c.voucherCode === v.code) && c.status !== 'rejected'
                  );
                  return (
                    <div key={v.id} className="p-4 rounded-2xl space-y-3" style={goldCardStyle}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="px-2.5 py-0.5 rounded font-mono text-xs font-black bg-amber-500/20 border border-amber-400/50 text-amber-300">
                            {v.code}
                          </span>
                          <h4 className="text-sm font-black text-white mt-1.5">{v.title}</h4>
                          <p className="text-xs text-zinc-400">
                            {tr('Discount Value:', 'Potongan Harga:')} <strong className="text-emerald-400 font-mono">{formatCurrency(Number(v.discountValueIdr || 0))}</strong> &bull;{' '}
                            {tr('Min Order:', 'Min. Belanja:')} <strong className="text-amber-300 font-mono">{formatCurrency(Number(v.minOrderIdr || 0))}</strong>
                          </p>
                          <p className="text-[10px] text-zinc-500 mt-0.5">
                            Berlaku s/d: {v.validUntil || '31 Des 2026'} &bull; Kuota: {v.quota || 100}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(v.code);
                            setCopiedCode(v.code);
                            setTimeout(() => setCopiedCode(null), 2000);
                          }}
                          className="p-2 rounded-xl bg-black/50 border border-amber-500/30 text-amber-300 text-xs cursor-pointer"
                          title="Salin Kode"
                        >
                          {copiedCode === v.code ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-amber-500/20">
                        <span className="text-xs font-mono font-bold text-amber-400">
                          {Number(v.pointsCost || 0) > 0 ? `${v.pointsCost} Poin` : 'Gratis Klaim Member'}
                        </span>
                        <button
                          type="button"
                          disabled={Boolean(alreadyClaimed) || submittingClaimId === v.id}
                          onClick={() =>
                            handleClaimItem({
                              claimType: 'voucher',
                              itemId: v.id,
                              itemTitle: v.title,
                              pointsCost: Number(v.pointsCost || 0),
                              voucherCode: v.code,
                              discountValueIdr: Number(v.discountValueIdr || 0),
                              minOrderIdr: Number(v.minOrderIdr || 0),
                            })
                          }
                          className="px-4 py-2 rounded-xl text-xs font-black uppercase cursor-pointer disabled:opacity-50"
                          style={{
                            background: alreadyClaimed
                              ? 'rgba(16, 185, 129, 0.2)'
                              : 'linear-gradient(100deg, #f59e0b 0%, #fbbf24 100%)',
                            color: alreadyClaimed ? '#6ee7b7' : '#1b1204',
                          }}
                        >
                          {alreadyClaimed
                            ? alreadyClaimed.status === 'pending'
                              ? 'Menunggu Approval'
                              : alreadyClaimed.status === 'approved'
                              ? 'Aktif Siap Pakai ✓'
                              : 'Sudah Digunakan'
                            : 'Klaim Voucher'}
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {voucherTab !== 'available' && (
            <div className="space-y-2.5">
              {myClaims
                .filter((c) => c.claimType === 'voucher')
                .filter((c) => (voucherTab === 'claimed' ? c.status === 'pending' || c.status === 'approved' : true))
                .map((c) => (
                  <div key={c.id} className="p-4 rounded-2xl flex items-center justify-between gap-3 text-xs" style={goldCardStyle}>
                    <div>
                      <span className="font-mono font-black text-amber-300">{c.voucherCode || c.id}</span>
                      <h4 className="font-bold text-white text-sm">{c.itemTitle}</h4>
                      <span className="text-[11px] text-zinc-400">
                        Potongan: {formatCurrency(Number(c.discountValueIdr || 0))}
                      </span>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-400/40 text-amber-300 font-bold text-[10px] uppercase">
                      {c.status === 'pending'
                        ? 'Menunggu Persetujuan'
                        : c.status === 'approved'
                        ? 'Disetujui (Siap Pakai)'
                        : c.status === 'used_or_delivered'
                        ? 'Sudah Digunakan'
                        : 'Ditolak'}
                    </span>
                  </div>
                ))}
              {myClaims.filter((c) => c.claimType === 'voucher').length === 0 && (
                <div className="p-8 rounded-2xl text-center text-xs text-zinc-400" style={goldCardStyle}>
                  Belum ada klaim voucher. Silakan klaim pada tab Voucher Tersedia.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* 6. TUKAR POIN & REWARD (/client-pwa/profile/reward)                  */}
      {/* ==================================================================== */}
      {subRoute === 'reward' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl flex items-center justify-between" style={goldCardStyle}>
            <div>
              <span className="text-[10px] font-bold uppercase text-amber-300/80 block">
                {tr('Your Active Loyalty Points', 'Saldo Poin Loyalti Aktif Anda')}
              </span>
              <span className="text-2xl font-black font-mono text-amber-400">
                {activePoints.toLocaleString('id-ID')} Pts
              </span>
              <span className="text-[11px] text-zinc-400 block mt-0.5">
                Rasio perolehan: Belanja {formatCurrency(Number(rewardCfg.spendPerPointIdr || 10000))} = +1 Poin (+{rewardCfg.bonusPointsPerCarton || 5} Pts/Dus)
              </span>
            </div>
            <Gift className="w-10 h-10 text-amber-400 shrink-0" />
          </div>

          {/* Katalog Hadiah Penukaran Poin */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-black uppercase tracking-wider text-amber-400 px-1">
              {tr('Points Redemption Catalog', 'Katalog Hadiah Penukaran Poin')}
            </h3>
            {(Array.isArray(rewardCfg.rewardCatalog) ? rewardCfg.rewardCatalog : []).map((rw: any) => {
              const ptsReq = Number(rw.pointsCost || 100);
              const canRedeem = activePoints >= ptsReq && Number(rw.stock || 0) > 0;
              return (
                <div key={rw.id} className="p-4 rounded-2xl flex items-center justify-between gap-3" style={goldCardStyle}>
                  <div className="space-y-1">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300">
                      {rw.category}
                    </span>
                    <h4 className="text-sm font-black text-white">{rw.name}</h4>
                    <p className="text-xs text-amber-400 font-mono font-bold">
                      {ptsReq.toLocaleString('id-ID')} Poin &bull; <span className="text-zinc-400">Stok: {rw.stock} Unit</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!canRedeem || submittingClaimId === rw.id}
                    onClick={() =>
                      handleClaimItem({
                        claimType: 'reward_poin',
                        itemId: rw.id,
                        itemTitle: rw.name,
                        pointsCost: ptsReq,
                        rewardProductName: rw.name,
                      })
                    }
                    className="px-4 py-2 rounded-xl text-xs font-black uppercase cursor-pointer disabled:opacity-40 shrink-0"
                    style={{
                      background: 'linear-gradient(100deg, #f59e0b 0%, #fbbf24 100%)',
                      color: '#1b1204',
                    }}
                  >
                    {submittingClaimId === rw.id ? 'Memproses...' : 'Tukar Poin'}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Tabel Riwayat Penukaran Poin & Klaim Pelanggan */}
          <div className="p-4 rounded-2xl space-y-3" style={goldCardStyle}>
            <h3 className="text-xs font-black uppercase tracking-wider text-amber-400">
              {tr('Your Reward & Voucher Claims History', 'Riwayat Klaim Hadiah & Status Persetujuan Admin')}
            </h3>
            <div className="space-y-2">
              {myClaims.map((cl) => (
                <div
                  key={cl.id}
                  className="p-3 rounded-xl bg-black/50 border border-amber-500/25 flex items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <span className="font-bold text-white block">{cl.itemTitle}</span>
                    <span className="text-[10px] font-mono text-zinc-400">
                      {cl.id} &bull; {(cl.pointsCost || 0) > 0 ? `-${cl.pointsCost} Pts` : 'Target/Promo'}
                    </span>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase ${
                      cl.status === 'approved'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : cl.status === 'used_or_delivered'
                        ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                        : cl.status === 'rejected'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {cl.status === 'pending'
                      ? 'Menunggu Approval'
                      : cl.status === 'approved'
                      ? 'Disetujui Admin ✓'
                      : cl.status === 'used_or_delivered'
                      ? 'Selesai / Dikirim'
                      : 'Ditolak (Poin Kembali)'}
                  </span>
                </div>
              ))}
              {myClaims.length === 0 && (
                <p className="text-xs text-zinc-500 text-center py-3">
                  Belum ada riwayat penukaran poin atau klaim hadiah.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 7. PERINGKAT PEMBELI / TOP BUYER (/client-pwa/profile/top-buyer)     */}
      {/* ==================================================================== */}
      {subRoute === 'top-buyer' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl text-center space-y-2" style={goldCardStyle}>
            <Trophy className="w-9 h-9 text-amber-400 mx-auto" />
            <h3 className="text-base font-black text-white">
              {topBuyerCfg.headerTitle || 'Peringkat Pembeli Tertinggi (Top Buyer)'}
            </h3>
            <p className="text-xs text-amber-300">
              {topBuyerCfg.periodLabel || 'Periode berjalan'} &bull; Posisi Anda Saat Ini: <strong>Peringkat #{myRank}</strong>
            </p>
          </div>

          {/* Podium Juara 1, 2, 3 */}
          <div className="grid grid-cols-3 gap-2.5">
            {leaderboard.slice(0, 3).map((buyer, idx) => {
              const rank = idx + 1;
              const prizeObj = (Array.isArray(topBuyerCfg.monthlyPrizes) ? topBuyerCfg.monthlyPrizes : []).find(
                (p: any) => Number(p.rank) === rank
              );
              return (
                <div
                  key={buyer.id || idx}
                  className="p-3 rounded-2xl text-center space-y-1.5 relative"
                  style={{
                    ...goldCardStyle,
                    borderColor: rank === 1 ? '#fbbf24' : 'rgba(245, 158, 11, 0.35)',
                  }}
                >
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-zinc-950 inline-block">
                    JUARA #{rank}
                  </span>
                  <h4 className="text-xs font-extrabold text-white truncate">{buyer.name}</h4>
                  <p className="text-[11px] font-mono font-bold text-amber-400 truncate">
                    {formatCurrency(buyer.totalSpent)}
                  </p>
                  <p className="text-[10px] text-zinc-400">{buyer.totalCartons} Dus</p>
                  {prizeObj && (
                    <p className="text-[9px] text-emerald-300 font-semibold pt-1 border-t border-amber-500/20">
                      🎁 {prizeObj.prize}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Tabel Top 10 Pembeli */}
          <div className="p-4 rounded-2xl space-y-3" style={goldCardStyle}>
            <h4 className="text-xs font-black uppercase tracking-wider text-amber-400">
              Top 10 Mitra Pembeli Teraktif
            </h4>
            <div className="space-y-2">
              {leaderboard.slice(0, 10).map((b, i) => (
                <div
                  key={b.id || i}
                  className="p-3 rounded-xl flex items-center justify-between text-xs"
                  style={{
                    background: b.isMe ? 'rgba(245, 158, 11, 0.18)' : 'rgba(0,0,0,0.45)',
                    border: b.isMe ? '1px solid #fbbf24' : '1px solid rgba(245, 158, 11, 0.2)',
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-300 font-mono font-black flex items-center justify-center text-[11px]">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <span className="font-bold text-white block truncate">
                        {b.name} {b.isMe ? '(Anda)' : ''}
                      </span>
                      <span className="text-[10px] text-zinc-400">{b.totalCartons} Dus Terbeli</span>
                    </div>
                  </div>
                  <span className="font-mono font-black text-amber-400 shrink-0">
                    {formatCurrency(b.totalSpent)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 8. INFORMASI TOKO (/client-pwa/profile/informasi)                    */}
      {/* ==================================================================== */}
      {subRoute === 'informasi' && (
        <div className="space-y-4">
          <div className="p-5 rounded-2xl space-y-3 text-xs" style={goldCardStyle}>
            <h3 className="text-base font-black text-amber-400">
              {infoCfg.distributorName || 'RiskCart Official Store & Wholesale Distributor'}
            </h3>
            <p className="text-zinc-300 leading-relaxed">{infoCfg.tagline}</p>
            <div className="space-y-2 pt-2 border-t border-amber-500/20">
              <div>
                <span className="text-zinc-400 block">Jam Operasional:</span>
                <strong className="text-white">{infoCfg.operatingHours || 'Senin - Sabtu: 07:30 - 20:00 WIB'}</strong>
              </div>
              <div>
                <span className="text-zinc-400 block">Alamat Gudang Utama:</span>
                <strong className="text-white">{infoCfg.warehouseAddress || 'Jl. Raya Logistik Utama No. 88'}</strong>
              </div>
              <div>
                <span className="text-zinc-400 block">WhatsApp CS Resmi:</span>
                <strong className="text-amber-300 font-mono">{infoCfg.officialWhatsapp || '6281234567890'}</strong>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-2xl space-y-2" style={goldCardStyle}>
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">
              Pengumuman Resmi Toko
            </span>
            <p className="text-xs text-white leading-relaxed">
              {infoCfg.announcementBanner || 'Pengiriman grosir berjalan normal setiap hari sesuai rute kurir toko.'}
            </p>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* ORDER VIA AI (/client-pwa/profile/pwa-ai) - FULL HEIGHT AI ORDER     */}
      {/* ==================================================================== */}
      {subRoute === 'pwa-ai' && (
        <div
          className="rounded-3xl flex flex-col min-h-[calc(100vh-210px)] overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, #161006 0%, #090603 100%)',
            border: '1.5px solid rgba(255, 200, 82, 0.5)',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.8), 0 0 24px rgba(255, 185, 45, 0.15)',
          }}
        >
          {/* Header AI Order */}
          <div
            className="p-4 flex items-center justify-between gap-3"
            style={{
              background: 'rgba(28, 20, 9, 0.94)',
              borderBottom: '1px solid rgba(255, 200, 82, 0.25)',
            }}
          >
            <div className="flex items-center gap-2.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center font-bold shrink-0"
                style={{
                  background: 'linear-gradient(135deg, #ffd86b 0%, #d49b27 100%)',
                  color: '#1b1204',
                }}
              >
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-white">
                  {tr('Order Via AI Assistant', 'Asisten Order Via AI')}
                </h3>
                <p className="text-[11px] text-amber-200/80">
                  {tr(
                    'Type wholesale/retail order to add to cart automatically',
                    'Ketik pesanan grosir/satuan otomatis masuk keranjang'
                  )}
                </p>
              </div>
            </div>

            {onOpenCart && (
              <button
                type="button"
                onClick={onOpenCart}
                className="px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer shrink-0"
                style={{
                  background: 'rgba(245, 158, 11, 0.18)',
                  border: '1px solid rgba(245, 158, 11, 0.5)',
                  color: '#fde68a',
                }}
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>{tr('Cart', 'Keranjang')} ({cartItemsCount})</span>
              </button>
            )}
          </div>

          {/* Chat Messages Area */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 min-h-[320px]">
            {(aiChatMessages.length === 0
              ? [
                  {
                    sender: 'ai' as const,
                    text: aiOrderRecommendations.welcomeText,
                    time: new Date().toLocaleTimeString(language === 'id' ? 'id-ID' : 'en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  },
                ]
              : aiChatMessages.map((m, idx) =>
                  idx === 0 && m.sender === 'ai' && aiChatMessages.length === 1
                    ? { ...m, text: aiOrderRecommendations.welcomeText }
                    : m
                )
            ).map((msg, i) => (
              <div
                key={i}
                className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className="max-w-[85%] rounded-2xl p-3.5 text-xs leading-relaxed whitespace-pre-line shadow-sm"
                  style={
                    msg.sender === 'user'
                      ? {
                          background: 'linear-gradient(100deg, #e5b13a 0%, #fbdc7a 50%, #e8b440 100%)',
                          color: '#1b1204',
                          fontWeight: 700,
                        }
                      : {
                          background: 'rgba(24, 18, 9, 0.94)',
                          color: '#f7f3ea',
                          border: '1px solid rgba(255, 200, 82, 0.35)',
                        }
                  }
                >
                  {msg.text}
                </div>
                <span className="text-[9px] mt-1 px-1 text-zinc-500">{msg.time}</span>
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

          {/* Quick Order Suggestions (Kondisi A: Statistik Pelanggan, Kondisi B: Produk Asli Database stock > 0) */}
          {aiOrderRecommendations.chips.length > 0 && (
            <div
              className="px-4 py-2.5 overflow-x-auto"
              style={{
                background: 'rgba(20, 15, 8, 0.92)',
                borderTop: '1px solid rgba(255, 200, 82, 0.2)',
              }}
            >
              <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                <span className="text-[10px] font-extrabold flex items-center gap-1 text-amber-300">
                  <Sparkles className="w-3 h-3" /> {tr('Example:', 'Contoh:')}
                </span>
                {aiOrderRecommendations.chips.map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onSendAiOrder?.(chip.prompt)}
                    className="px-2.5 py-1 rounded-lg text-[11px] bg-black/80 border border-amber-500/35 text-amber-100 cursor-pointer hover:border-amber-400 transition"
                  >
                    &quot;{chip.label}&quot;
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!isAiProcessing && aiInputText.trim()) {
                onSendAiOrder?.();
              }
            }}
            className="p-3 flex items-center gap-2"
            style={{
              background: 'rgba(14, 10, 5, 0.98)',
              borderTop: '1px solid rgba(255, 200, 82, 0.25)',
            }}
          >
            <input
              type="text"
              value={aiInputText}
              onChange={(e) => onChangeAiInput?.(e.target.value)}
              placeholder={aiOrderRecommendations.placeholderText}
              className="flex-1 px-3.5 py-3 rounded-xl bg-black/80 border border-amber-500/40 text-white text-xs outline-none focus:border-amber-400"
            />
            <button
              type="submit"
              disabled={isAiProcessing || !aiInputText.trim()}
              className="p-3 rounded-xl disabled:opacity-40 font-extrabold transition cursor-pointer shrink-0"
              style={{
                background: 'linear-gradient(100deg, #e5b13a 0%, #fbdc7a 50%, #e8b440 100%)',
                color: '#1b1204',
              }}
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 9. CHAT ADMIN (/client-pwa/profile/chat-admin) -> REDIRECT KE WA     */}
      {/* ==================================================================== */}
      {subRoute === 'chat-admin' && (
        <div className="p-6 rounded-2xl text-center space-y-4" style={goldCardStyle}>
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
            <MessageSquare className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-black text-white">
              {tr('Redirecting to RiskCart Admin WhatsApp...', 'Mengarahkan ke WhatsApp Admin & CS RiskCart...')}
            </h3>
            <p className="text-xs text-zinc-400">
              WhatsApp: <span className="font-mono text-amber-300">+62 877-8560-4021</span>
            </p>
          </div>
          <a
            href={WA_ADMIN_CS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition"
          >
            <Phone className="w-4 h-4" />
            <span>{tr('Open WhatsApp (+6287785604021)', 'Buka Chat WhatsApp (+6287785604021)')}</span>
          </a>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 10. PUSAT BANTUAN / FAQ (/client-pwa/profile/faq)                    */}
      {/* ==================================================================== */}
      {subRoute === 'faq' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl space-y-3" style={goldCardStyle}>
            <input
              type="search"
              value={faqQuery}
              onChange={(e) => setFaqQuery(e.target.value)}
              placeholder={tr('Search help topics...', 'Cari pertanyaan bantuan (pesanan, poin, voucher)...')}
              className="w-full px-3.5 py-2.5 rounded-xl bg-black/70 border border-amber-500/35 text-white text-xs"
            />
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {['Semua', 'Pemesanan', 'Pembayaran', 'Pengiriman', 'Poin & Hadiah'].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setFaqCat(cat)}
                  className="px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap cursor-pointer"
                  style={
                    faqCat === cat
                      ? { background: '#f59e0b', color: '#1b1204' }
                      : { background: 'rgba(245, 158, 11, 0.14)', color: '#fde68a' }
                  }
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            {(Array.isArray(faqCfg.faqItems) ? faqCfg.faqItems : [])
              .filter((f: any) => (faqCat === 'Semua' ? true : f.category === faqCat))
              .filter((f: any) =>
                !faqQuery.trim()
                  ? true
                  : `${f.question} ${f.answer}`.toLowerCase().includes(faqQuery.toLowerCase())
              )
              .map((f: any, idx: number) => {
                const isOpen = openFaqIdx === idx;
                return (
                  <div key={f.id || idx} className="rounded-2xl overflow-hidden" style={goldCardStyle}>
                    <button
                      type="button"
                      onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                      className="w-full p-4 flex items-center justify-between gap-3 text-left text-xs font-extrabold text-white cursor-pointer"
                    >
                      <span>{f.question}</span>
                      <ChevronDown className={`w-4 h-4 text-amber-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 text-xs text-zinc-300 leading-relaxed border-t border-amber-500/20 pt-3">
                        {f.answer}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 11. PENGATURAN AKUN (/client-pwa/profile/pengaturan)                 */}
      {/* ==================================================================== */}
      {subRoute === 'pengaturan' && (
        <div className="space-y-4">
          {/* Preferensi Bahasa & Notifikasi */}
          <div className="p-4 rounded-2xl space-y-3 text-xs" style={goldCardStyle}>
            <h3 className="text-xs font-black uppercase tracking-wider text-amber-400">
              {tr('Notifications & Language Preferences', 'Preferensi Notifikasi & Bahasa')}
            </h3>

            <div className="flex items-center justify-between py-2 border-b border-amber-500/15">
              <div>
                <span className="font-bold text-white block">Notifikasi Status Pesanan via WhatsApp</span>
                <span className="text-[11px] text-zinc-400">Kirim update otomatis saat pesanan diproses kasir</span>
              </div>
              <input
                type="checkbox"
                checked={notifWaOrder}
                onChange={(e) => setNotifWaOrder(e.target.checked)}
                className="w-4 h-4 accent-amber-500"
              />
            </div>

            <div className="flex items-center justify-between py-2 border-b border-amber-500/15">
              <div>
                <span className="font-bold text-white block">Info Promo &amp; Voucher Baru</span>
                <span className="text-[11px] text-zinc-400">Terima info diskon dus &amp; program poin bulanan</span>
              </div>
              <input
                type="checkbox"
                checked={notifPromo}
                onChange={(e) => setNotifPromo(e.target.checked)}
                className="w-4 h-4 accent-amber-500"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="font-bold text-white">Bahasa Aplikasi (ID / EN)</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => onChangeLanguage('id')}
                  className={`px-3 py-1 rounded-lg font-black cursor-pointer ${
                    language === 'id' ? 'bg-amber-500 text-zinc-950' : 'bg-black/50 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  ID
                </button>
                <button
                  type="button"
                  onClick={() => onChangeLanguage('en')}
                  className={`px-3 py-1 rounded-lg font-black cursor-pointer ${
                    language === 'en' ? 'bg-amber-500 text-zinc-950' : 'bg-black/50 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  EN
                </button>
              </div>
            </div>
          </div>

          {/* Ubah PIN / Password */}
          {pengaturanCfg.allowCustomerChangePin !== false && (
            <form onSubmit={handleUpdatePin} className="p-4 rounded-2xl space-y-3 text-xs" style={goldCardStyle}>
              <h3 className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <Lock className="w-4 h-4" />
                <span>{tr('Change Security PIN / Password', 'Ubah PIN / Password Login Member')}</span>
              </h3>
              <input
                type="password"
                value={newPinInput}
                onChange={(e) => setNewPinInput(e.target.value)}
                placeholder="Masukkan PIN / Password Baru (min. 4 digit)"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/70 border border-amber-500/35 text-white font-mono"
              />
              <button
                type="submit"
                disabled={savingPin}
                className="w-full py-2.5 rounded-xl bg-amber-500 text-zinc-950 font-black uppercase cursor-pointer"
              >
                {savingPin ? 'Menyimpan...' : tr('Save New PIN / Password', 'Simpan PIN / Password Baru')}
              </button>
            </form>
          )}

          {/* Tombol Logout */}
          <button
            type="button"
            onClick={onLogout}
            className="w-full p-4 rounded-2xl flex items-center justify-center gap-2 text-xs font-black uppercase cursor-pointer"
            style={{
              background: 'rgba(127, 29, 29, 0.45)',
              border: '1.5px solid rgba(248, 113, 113, 0.5)',
              color: '#fecaca',
            }}
          >
            <LogOut className="w-4 h-4" />
            <span>{tr('Log Out Member Account', 'Keluar dari Akun Member (Logout)')}</span>
          </button>
        </div>
      )}
    </div>
  );
};
