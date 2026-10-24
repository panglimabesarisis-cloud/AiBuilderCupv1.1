import { useState, useEffect } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ACTIVE_STORE_ID } from '../config/store';

export type PwaConfigSlug =
  | 'umum'
  | 'login'
  | 'order-pelanggan'
  | 'pembayaran'
  | 'notifikasi'
  | 'profile'
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
  | 'pengaturan'
  | 'hak-akses';

export interface TargetMilestoneItem {
  id: string;
  titleId: string;
  titleEn: string;
  targetAmountIdr: number;
  rewardTitleId: string;
  rewardTitleEn: string;
  rewardValueIdr: number;
  rewardType: 'voucher' | 'physical' | 'bundle';
  voucherCode?: string;
  physicalProductName?: string;
  physicalQtyCarton?: number;
  badgeText?: string;
  active: boolean;
}

export interface PwaVoucherItem {
  id: string;
  code: string;
  titleId: string;
  titleEn: string;
  descriptionId: string;
  descriptionEn: string;
  discountType: 'fixed' | 'percent';
  discountValueIdr: number; // if percent, 10 means 10%; if fixed, amount in IDR
  maxDiscountIdr?: number;
  minOrderIdr: number;
  quota: number;
  usedCount: number;
  expiryDate: string;
  active: boolean;
  source?: 'promo' | 'reward' | 'target';
  customerPhone?: string; // if exclusive to a customer from approved claim
}

export interface PwaRewardCatalogItem {
  id: string;
  titleId: string;
  titleEn: string;
  descriptionId: string;
  descriptionEn: string;
  pointsCost: number;
  rewardValueIdr: number;
  rewardType: 'voucher' | 'physical' | 'free_shipping';
  voucherCode?: string;
  physicalProductName?: string;
  stock: number;
  category: string;
  active: boolean;
}

export interface PwaAnnouncementItem {
  id: string;
  titleId: string;
  titleEn: string;
  contentId: string;
  contentEn: string;
  date: string;
  category: 'pengumuman' | 'jadwal_kurir' | 'panduan_grosir';
  pinned?: boolean;
}

export interface PwaFaqItem {
  id: string;
  questionId: string;
  questionEn: string;
  answerId: string;
  answerEn: string;
  category: string;
}

export interface RewardClaimRecord {
  id: string;
  claimId: string;
  createdAt: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  normalizedPhone?: string;
  customerTier: string;
  claimType: 'Reward Poin' | 'Hadiah Target' | 'Voucher Promo' | 'voucher' | 'reward_poin' | 'target_milestone';
  claimTypeSlug?: 'voucher' | 'reward_poin' | 'target_milestone';
  rewardId?: string;
  itemId?: string;
  rewardTitle: string;
  itemTitle?: string;
  rewardCategory?: 'voucher' | 'physical' | 'free_shipping' | 'bundle';
  voucherCode?: string;
  pointsUsed: number;
  pointsCost?: number;
  remainingPoints: number;
  targetAchievedAmount?: number;
  targetRequiredIdr?: number;
  currentSpentIdr?: number;
  rewardValue: number; // Stored in canonical IDR
  discountValueIdr?: number;
  minOrderIdr?: number;
  status: 'pending' | 'approved' | 'rejected' | 'redeemed' | 'used_or_delivered';
  approvedBy?: string;
  approvedAt?: string;
  notes?: string;
  fulfillmentAction?: 'none' | 'voucher_activated' | 'stock_deducted' | 'bonus_order_added';
  physicalProductId?: string;
  physicalProductName?: string;
  rewardProductName?: string;
  physicalQty?: number;
}

export interface AllPwaPageConfigs {
  umum: {
    storeTitle: string;
    storeSubtitleId: string;
    storeSubtitleEn: string;
    bannerHeadlineId: string;
    bannerHeadlineEn: string;
    openHour: string;
    closeHour: string;
    isStoreClosedMode: boolean;
    closedAnnouncementId: string;
    closedAnnouncementEn: string;
  };
  login: {
    requireWaPin: boolean;
    allowSelfRegistration: boolean;
    defaultMemberTier: string;
    loginSubtitleId: string;
    loginSubtitleEn: string;
    adminSupportWa: string;
  };
  'order-pelanggan': {
    minOrderCartons: number;
    minOrderAmountIdr: number;
    baseDeliveryFeeIdr: number;
    freeDeliveryMinIdr: number;
    orderStartHour: string;
    orderEndHour: string;
    allowAiNaturalOrder: boolean;
  };
  pembayaran: {
    enableTunai: boolean;
    enableHutang: boolean;
    enableCod: boolean;
    enableQris: boolean;
    enableTransfer: boolean;
    bankName: string;
    bankAccountNumber: string;
    bankAccountHolder: string;
    maxCodAmountIdr: number;
  };
  notifikasi: {
    adminWhatsappNumber: string;
    enablePosSoundAlert: boolean;
    orderPlacedTemplateId: string;
    orderApprovedTemplateId: string;
  };
  profile: {
    showMenuAkun: boolean;
    showMenuStatistik: boolean;
    showMenuAlamat: boolean;
    showMenuTarget: boolean;
    showMenuVoucher: boolean;
    showMenuReward: boolean;
    showMenuTopBuyer: boolean;
    showMenuInformasi: boolean;
    showMenuChatAdmin: boolean;
    showMenuFaq: boolean;
    showMenuPengaturan: boolean;
    tierSilverMinIdr: number;
    tierGoldMinIdr: number;
    tierPlatinumMinIdr: number;
  };
  akun: {
    showFavoriteProducts: boolean;
    showMiniPurchaseChart: boolean;
    showRecentTransactionsTable: boolean;
  };
  statistik: {
    showAreaChart: boolean;
    showCategoryDoughnut: boolean;
    showActiveDebtCard: boolean;
    showDetailedHistory: boolean;
  };
  alamat: {
    requireGpsCoordinate: boolean;
    maxDeliveryRadiusKm: number;
    syncToPosShipper: boolean;
  };
  target: {
    programTitleId: string;
    programTitleEn: string;
    milestones: TargetMilestoneItem[];
  };
  voucher: {
    allowCombineWithPoints: boolean;
    items: PwaVoucherItem[];
  };
  reward: {
    profitSharePercent: number; // default 5%
    rupiahToPointConversion: number; // default Rp 1 = 15 poin (or scaled per Rp 1000 profit)
    pointValueIdr: number; // 1 poin = Rp 100 valuation when redeemed
    formulaExplanationId: string;
    formulaExplanationEn: string;
    catalog: PwaRewardCatalogItem[];
  };
  'top-buyer': {
    rankingBasis: 'profit' | 'omzet';
    maskCustomerPhoneOnPwa: boolean;
    hideStoreProfitOnPwa: boolean;
    topCount: number;
    periodLabelId: string;
    periodLabelEn: string;
  };
  informasi: {
    courierScheduleTextId: string;
    courierScheduleTextEn: string;
    wholesaleGuideTextId: string;
    wholesaleGuideTextEn: string;
    announcements: PwaAnnouncementItem[];
  };
  'chat-admin': {
    whatsappCsNumber: string;
    csOperatingHours: string;
    autoGreetingTemplateId: string;
    autoGreetingTemplateEn: string;
  };
  faq: {
    items: PwaFaqItem[];
  };
  pengaturan: {
    allowChangePin: boolean;
    allowLanguageSwitch: boolean;
    allowCurrencySwitch: boolean;
  };
  'hak-akses': {
    allowGuestCatalogView: boolean;
    hideWholesalePriceForGuest: boolean;
    requireVerifiedMemberForDebt: boolean;
  };
}

export const DEFAULT_PWA_PAGE_CONFIGS: AllPwaPageConfigs = {
  umum: {
    storeTitle: 'RiskCart Wholesale & Retail',
    storeSubtitleId: 'Pusat Distribusi Minuman, Galon & Gas Terpercaya',
    storeSubtitleEn: 'Trusted Beverage, Gallon & LPG Wholesale Distributor',
    bannerHeadlineId: 'Promo Grosir Minggu Ini: Gratis Ongkir & Bonus Poin Emas!',
    bannerHeadlineEn: 'Weekly Wholesale Promo: Free Delivery & Gold Bonus Points!',
    openHour: '07:00',
    closeHour: '21:00',
    isStoreClosedMode: false,
    closedAnnouncementId: 'Toko sedang tutup sementara, pesanan akan diproses esok pagi.',
    closedAnnouncementEn: 'Store is temporarily closed, orders will be processed tomorrow morning.',
  },
  login: {
    requireWaPin: true,
    allowSelfRegistration: true,
    defaultMemberTier: 'Member Gold Grosir',
    loginSubtitleId: 'Masuk dengan Nomor WhatsApp & PIN Keamanan Anda',
    loginSubtitleEn: 'Sign in with your WhatsApp Number & Security PIN',
    adminSupportWa: '6281288889999',
  },
  'order-pelanggan': {
    minOrderCartons: 1,
    minOrderAmountIdr: 25000,
    baseDeliveryFeeIdr: 8000,
    freeDeliveryMinIdr: 150000,
    orderStartHour: '06:00',
    orderEndHour: '22:00',
    allowAiNaturalOrder: true,
  },
  pembayaran: {
    enableTunai: true,
    enableHutang: true,
    enableCod: true,
    enableQris: true,
    enableTransfer: true,
    bankName: 'BCA / Mandiri RiskCart Official',
    bankAccountNumber: '8820-9912-7788',
    bankAccountHolder: 'PT RiskCart Niaga Nusantara',
    maxCodAmountIdr: 5000000,
  },
  notifikasi: {
    adminWhatsappNumber: '6281288889999',
    enablePosSoundAlert: true,
    orderPlacedTemplateId:
      'Halo {{customer}}, pesanan #{{orderId}} senilai {{total}} telah masuk ke antrean Kasir POS RiskCart.',
    orderApprovedTemplateId:
      'Klaim hadiah/voucher {{reward}} Anda telah DISETUJUI oleh Admin RiskCart dan siap digunakan!',
  },
  profile: {
    showMenuAkun: true,
    showMenuStatistik: true,
    showMenuAlamat: true,
    showMenuTarget: true,
    showMenuVoucher: true,
    showMenuReward: true,
    showMenuTopBuyer: true,
    showMenuInformasi: true,
    showMenuChatAdmin: true,
    showMenuFaq: true,
    showMenuPengaturan: true,
    tierSilverMinIdr: 1000000,
    tierGoldMinIdr: 5000000,
    tierPlatinumMinIdr: 15000000,
  },
  akun: {
    showFavoriteProducts: true,
    showMiniPurchaseChart: true,
    showRecentTransactionsTable: true,
  },
  statistik: {
    showAreaChart: true,
    showCategoryDoughnut: true,
    showActiveDebtCard: true,
    showDetailedHistory: true,
  },
  alamat: {
    requireGpsCoordinate: true,
    maxDeliveryRadiusKm: 15,
    syncToPosShipper: true,
  },
  target: {
    programTitleId: 'Milestone Hadiah Target Belanja Member',
    programTitleEn: 'Member Purchase Target Milestone Rewards',
    milestones: [],
  },
  voucher: {
    allowCombineWithPoints: true,
    items: [],
  },
  reward: {
    profitSharePercent: 5,
    rupiahToPointConversion: 15,
    pointValueIdr: 100,
    formulaExplanationId:
      'Poin dihitung 5% dari keuntungan setiap produk, dengan konversi Rp 1 = 15 poin. Poin masuk otomatis saat pesanan dibuat dan bisa diverifikasi kasir di POS.',
    formulaExplanationEn:
      'Points are calculated as 5% of each product profit, converted at Rp 1 = 15 points. Points are credited automatically when an order is created and verified by the POS cashier.',
    catalog: [],
  },
  'top-buyer': {
    rankingBasis: 'profit',
    maskCustomerPhoneOnPwa: true,
    hideStoreProfitOnPwa: true,
    topCount: 10,
    periodLabelId: 'Peringkat Real-Time Pelanggan Paling Aktif & Loyal',
    periodLabelEn: 'Real-Time Most Active & Loyal Member Leaderboard',
  },
  informasi: {
    courierScheduleTextId:
      'Kloter 1: 08:00 - 11:00 WIB | Kloter 2: 13:00 - 16:00 WIB | Kloter Ekspres Sore: 16:30 - 19:30 WIB.',
    courierScheduleTextEn:
      'Batch 1: 08:00 - 11:00 | Batch 2: 13:00 - 16:00 | Evening Express: 16:30 - 19:30.',
    wholesaleGuideTextId:
      'Pembelian grosir minimal 5 dus otomatis mendapat harga agen dan prioritas pengiriman armada toko.',
    wholesaleGuideTextEn:
      'Wholesale purchases of 5+ cartons automatically receive agent tier pricing and priority fleet delivery.',
    announcements: [],
  },
  'chat-admin': {
    whatsappCsNumber: '6287785604021',
    csOperatingHours: 'Senin - Minggu (07:00 - 21:00 WIB)',
    autoGreetingTemplateId:
      'Halo Admin RiskCart, saya butuh bantuan terkait pesanan saya.',
    autoGreetingTemplateEn:
      'Hello RiskCart Admin, I need assistance with my order.',
  },
  faq: {
    items: [],
  },
  pengaturan: {
    allowChangePin: true,
    allowLanguageSwitch: true,
    allowCurrencySwitch: true,
  },
  'hak-akses': {
    allowGuestCatalogView: true,
    hideWholesalePriceForGuest: false,
    requireVerifiedMemberForDebt: true,
  },
};

export const PWA_SLUG_METADATA: Array<{
  slug: PwaConfigSlug;
  labelId: string;
  labelEn: string;
  clientRoute: string;
  descriptionId: string;
  descriptionEn: string;
}> = [
  {
    slug: 'umum',
    labelId: 'Umum & Beranda',
    labelEn: 'General & Home',
    clientRoute: '/client-pwa/clienthome',
    descriptionId: 'Mengontrol Nama Toko, Banner Promo, Jam Operasional & Mode Tutup Toko di /client-pwa/home',
    descriptionEn: 'Controls Store Name, Promo Banner, Operating Hours & Closed Mode on /client-pwa/home',
  },
  {
    slug: 'login',
    labelId: 'Login WA & PIN',
    labelEn: 'WA & PIN Login',
    clientRoute: '/client-pwa/login',
    descriptionId: 'Mengontrol autentikasi Nomor WhatsApp + PIN/Password di /client-pwa/login',
    descriptionEn: 'Controls WhatsApp Number + PIN/Password authentication on /client-pwa/login',
  },
  {
    slug: 'order-pelanggan',
    labelId: 'Order Pelanggan',
    labelEn: 'Customer Order Rules',
    clientRoute: '/client-pwa/keranjang',
    descriptionId: 'Mengontrol minimal order dus/nominal, ongkir, & jam order di checkout PWA',
    descriptionEn: 'Controls minimum carton/amount rules, delivery fee, & ordering hours at checkout',
  },
  {
    slug: 'pembayaran',
    labelId: 'Metode Pembayaran',
    labelEn: 'Payment Methods',
    clientRoute: '/client-pwa/keranjang',
    descriptionId: 'Mengontrol aktif/tidaknya Tunai, Hutang, COD, QRIS, Transfer & rekening bank di PWA',
    descriptionEn: 'Controls Cash, Credit/Debt, COD, QRIS, Bank Transfer & account info on PWA',
  },
  {
    slug: 'notifikasi',
    labelId: 'Notifikasi & Alert',
    labelEn: 'Notifications & Alerts',
    clientRoute: '/client-pwa/riwayat',
    descriptionId: 'Mengontrol nomor WA Admin, template pesan order, & suara notifikasi POS',
    descriptionEn: 'Controls Admin WA number, order message templates, & POS sound alerts',
  },
  {
    slug: 'profile',
    labelId: 'Menu Profile & Tier',
    labelEn: 'Profile Menu & Tiers',
    clientRoute: '/client-pwa/profile',
    descriptionId: 'Mengontrol visibilitas 11 sub-menu profil & syarat level bintang member',
    descriptionEn: 'Controls visibility of the 11 profile sub-menus & member star tier thresholds',
  },
  {
    slug: 'akun',
    labelId: 'Profil Saya (Akun)',
    labelEn: 'My Account Profile',
    clientRoute: '/client-pwa/profile/akun',
    descriptionId: 'Mengontrol tampilan produk favorit, ringkasan grafik & tabel transaksi di halaman Akun',
    descriptionEn: 'Controls favorite products, mini chart & recent transactions on Account page',
  },
  {
    slug: 'statistik',
    labelId: 'Statistik Pembelian',
    labelEn: 'Purchase Analytics',
    clientRoute: '/client-pwa/profile/statistik',
    descriptionId: 'Mengontrol visibilitas Area Chart tren belanja, Doughnut kategori & info piutang pelanggan',
    descriptionEn: 'Controls spending trend Area Chart, category Doughnut & active debt card',
  },
  {
    slug: 'alamat',
    labelId: 'Alamat & Radius GPS',
    labelEn: 'Address & GPS Radius',
    clientRoute: '/client-pwa/profile/alamat',
    descriptionId: 'Mengontrol validasi koordinat GPS toko pelanggan & sinkronisasi ke kurir Shipper POS',
    descriptionEn: 'Controls store GPS coordinate validation & sync to POS Shipper couriers',
  },
  {
    slug: 'target',
    labelId: 'Hadiah Target Belanja',
    labelEn: 'Spend Target Milestones',
    clientRoute: '/client-pwa/profile/target',
    descriptionId: 'CRUD Milestone Hadiah Target Belanja (Rp 2 Juta, Rp 5 Juta, Rp 10 Juta, dll.)',
    descriptionEn: 'CRUD Spend Target Milestones (Rp 2M, Rp 5M, Rp 10M, etc.)',
  },
  {
    slug: 'voucher',
    labelId: 'Katalog Kode Voucher',
    labelEn: 'Voucher Code Catalog',
    clientRoute: '/client-pwa/profile/voucher',
    descriptionId: 'CRUD kode Voucher pelanggan (MAYA10, POTONG25, GROSIR50, diskon %, kuota & masa berlaku)',
    descriptionEn: 'CRUD customer Voucher codes (MAYA10, POTONG25, GROSIR50, %/fixed discount, quota & expiry)',
  },
  {
    slug: 'reward',
    labelId: 'Reward & Rumus Poin',
    labelEn: 'Rewards & Point Formula',
    clientRoute: '/client-pwa/profile/reward',
    descriptionId: 'Pengaturan rumus poin (5% profit, Rp 1 = 15 poin) + CRUD katalog hadiah tukar poin',
    descriptionEn: 'Point formula settings (5% profit, Rp 1 = 15 pts) + CRUD point redemption catalog',
  },
  {
    slug: 'top-buyer',
    labelId: 'Top 10 Buyer Ranking',
    labelEn: 'Top 10 Buyer Leaderboard',
    clientRoute: '/client-pwa/profile/top-buyer',
    descriptionId: 'Pengaturan kriteria Top 10 Buyer berdasarkan Profit Toko tertinggi & proteksi privasi modal',
    descriptionEn: 'Top 10 Buyer ranking criteria by Store Profit contribution & privacy masking',
  },
  {
    slug: 'informasi',
    labelId: 'Papan Informasi',
    labelEn: 'Store Information Board',
    clientRoute: '/client-pwa/profile/informasi',
    descriptionId: 'CRUD pengumuman toko, jadwal kloter pengiriman kurir, & panduan grosir',
    descriptionEn: 'CRUD store announcements, courier delivery batches, & wholesale guide',
  },
  {
    slug: 'chat-admin',
    labelId: 'Chat WhatsApp Admin',
    labelEn: 'Admin WhatsApp Chat',
    clientRoute: '/client-pwa/profile/chat-admin',
    descriptionId: 'Mengontrol nomor WA CS Toko, jam layanan, & template pesan otomatis pelanggan',
    descriptionEn: 'Controls Store CS WhatsApp number, service hours, & automated message template',
  },
  {
    slug: 'faq',
    labelId: 'Tanya Jawab (FAQ)',
    labelEn: 'FAQ Accordion',
    clientRoute: '/client-pwa/profile/faq',
    descriptionId: 'CRUD daftar pertanyaan & jawaban bantuan pelanggan di halaman FAQ PWA',
    descriptionEn: 'CRUD frequently asked questions & answers on the PWA FAQ page',
  },
  {
    slug: 'pengaturan',
    labelId: 'Pengaturan Akun Member',
    labelEn: 'Member Account Settings',
    clientRoute: '/client-pwa/profile/pengaturan',
    descriptionId: 'Mengontrol izin ubah PIN/Password WA, bahasa (ID/EN), & mata uang (IDR/USD)',
    descriptionEn: 'Controls permissions for changing WA PIN, language (ID/EN), & currency (IDR/USD)',
  },
  {
    slug: 'hak-akses',
    labelId: 'Hak Akses & Keamanan',
    labelEn: 'Access Rights & Security',
    clientRoute: '/client-pwa/login',
    descriptionId: 'Mengontrol hak akses katalog tamu, visibilitas harga grosir, & syarat kasbon member',
    descriptionEn: 'Controls guest catalog access, wholesale price visibility, & credit eligibility',
  },
];

/**
 * Calculates points earned from a list of order/transaction items and products catalog.
 * Rule: 5% of gross profit per product, converted with ratio (default 15 pts per Rp 1,000 profit share so numbers are realistic & match 100-500 pt rewards, or exact formula).
 */
export function calculateOrderEarnedPoints(
  items: any[],
  productsCatalog: any[],
  rewardConfig: AllPwaPageConfigs['reward'] = DEFAULT_PWA_PAGE_CONFIGS.reward
): { totalProfitIdr: number; profitShareIdr: number; pointsEarned: number } {
  const profitPercent = Number(rewardConfig?.profitSharePercent || 5);
  const convRatio = Number(rewardConfig?.rupiahToPointConversion || 15);

  let totalProfitIdr = 0;

  (items || []).forEach((it) => {
    const qty = Math.max(1, Number(it.quantityOrdered ?? it.qty ?? it.quantity ?? 1));
    const prodId = it.productId || it.product?.id || it.id;
    const matchedProd = productsCatalog.find(
      (p) => p.id === prodId || (p.name && it.productName && p.name.toLowerCase() === String(it.productName).toLowerCase())
    );

    const rawSell = Number(
      it.unitPrice ??
        it.sellingPrice ??
        it.price ??
        (it.packageType === 'carton'
          ? matchedProd?.pricePerCarton
          : matchedProd?.pricePerUnit) ??
        0
    );
    const sellIdr = rawSell > 0 && rawSell < 500 ? Math.round(rawSell * 15500) : rawSell;

    const rawCost = Number(
      it.costPrice ??
        it.modalPrice ??
        (it.packageType === 'carton'
          ? (matchedProd as any)?.costPerCarton || (matchedProd as any)?.modalPrice || (matchedProd as any)?.costPrice
          : (matchedProd as any)?.costPrice || (matchedProd as any)?.modalPrice) ??
        sellIdr * 0.82
    );
    const costIdr =
      rawCost > 0 && rawCost < 500
        ? Math.round(rawCost * 15500)
        : rawCost > 0 && rawCost < sellIdr
        ? rawCost
        : Math.round(sellIdr * 0.82);

    const unitProfit = Math.max(500, sellIdr - costIdr);
    totalProfitIdr += unitProfit * qty;
  });

  // 5% of total product profit
  const profitShareIdr = (totalProfitIdr * profitPercent) / 100;
  // Convert profitShareIdr into points (scaled per Rp 1,000 so Rp 2,000 profit share * 15 = 30 points)
  const pointsEarned = Math.max(1, Math.round((profitShareIdr / 1000) * convRatio));

  return {
    totalProfitIdr: Math.round(totalProfitIdr),
    profitShareIdr: Math.round(profitShareIdr),
    pointsEarned,
  };
}

/**
 * Hook that subscribes in real-time (`onSnapshot`) to `pwa_page_configs` collection in Firestore.
 * Every change saved in `/dashboard/pengaturan-pwa/:slug` immediately updates `/client-pwa/*` without reload.
 */
export function usePwaPageConfigs() {
  const [configs, setConfigs] = useState<AllPwaPageConfigs>(DEFAULT_PWA_PAGE_CONFIGS);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'pwa_page_configs'),
      (snap) => {
        const next: AllPwaPageConfigs = { ...DEFAULT_PWA_PAGE_CONFIGS };
        snap.docs.forEach((d) => {
          const slug = d.id as PwaConfigSlug;
          const data = d.data() as any;
          if (slug in next && data) {
            (next as any)[slug] = {
              ...(DEFAULT_PWA_PAGE_CONFIGS as any)[slug],
              ...data,
            };
          }
        });
        setConfigs(next);
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const sanitizeConfigValue = (val: any): any => {
    if (typeof val === 'string') {
      return val
        .slice(0, 4000)
        .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
        .replace(/<\s*iframe[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, '')
        .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
        .replace(/\bon\w+\s*=\s*[^\s>]+/gi, '')
        .replace(/javascript\s*:/gi, 'blocked:')
        .replace(/vbscript\s*:/gi, 'blocked:')
        .replace(/data\s*:\s*text\/html/gi, 'blocked:');
    }
    if (Array.isArray(val)) {
      return val.map(sanitizeConfigValue);
    }
    if (val && typeof val === 'object') {
      const cleaned: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        cleaned[k] = sanitizeConfigValue(v);
      }
      return cleaned;
    }
    return val;
  };

  const saveSlugConfig = async <K extends PwaConfigSlug>(
    slug: K,
    data: Partial<AllPwaPageConfigs[K]>
  ) => {
    const sanitizedData = sanitizeConfigValue(data);
    const merged = {
      ...(configs[slug] as any),
      ...sanitizedData,
      updatedAt: new Date().toISOString(),
    };
    setConfigs((prev) => ({
      ...prev,
      [slug]: merged,
    }));
    await setDoc(doc(db, 'pwa_page_configs', slug), merged, { merge: true });
    await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'pwa_page_configs', slug), merged, {
      merge: true,
    }).catch(() => {});
  };

  return { configs, loading, saveSlugConfig };
}

/**
 * Hook that subscribes in real-time (`onSnapshot`) to `reward_claims` collection in Firestore.
 */
export function useRewardClaims() {
  const [claims, setClaims] = useState<RewardClaimRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'reward_claims'),
      (snap) => {
        const list: RewardClaimRecord[] = snap.docs.map((d) => {
          const raw = d.data() as any;
          return {
            ...raw,
            id: d.id,
            claimId: raw.claimId || d.id,
          } as RewardClaimRecord;
        });
        list.sort((a, b) => {
          const ta = new Date(a.createdAt || 0).getTime();
          const tb = new Date(b.createdAt || 0).getTime();
          return tb - ta;
        });
        setClaims(list);
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  return { claims, loading };
}

/**
 * Submits a new customer claim from Client PWA (`/client-pwa/profile/reward`, `/target`, or `/voucher`)
 * to Firestore `reward_claims` with initial status `'pending'`.
 */
export async function submitPwaRewardClaim(params: {
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerTier: string;
  currentPoints: number;
  claimType: 'Reward Poin' | 'Hadiah Target' | 'Voucher Promo';
  rewardId?: string;
  rewardTitle: string;
  rewardCategory?: 'voucher' | 'physical' | 'free_shipping' | 'bundle';
  voucherCode?: string;
  pointsUsed: number;
  targetAchievedAmount?: number;
  rewardValue: number;
  physicalProductName?: string;
  physicalQty?: number;
  notes?: string;
}): Promise<{ ok: boolean; claimId: string; message: string }> {
  const nowIso = new Date().toISOString();
  const claimId = `CLM-${Date.now().toString().slice(-6)}`;
  const remainingPoints = Math.max(0, Number(params.currentPoints || 0) - Number(params.pointsUsed || 0));

  const payload: RewardClaimRecord = {
    id: claimId,
    claimId,
    createdAt: nowIso,
    customerId: params.customerId || params.customerPhone || 'CUST-PWA',
    customerName: params.customerName || 'Pelanggan Member',
    customerPhone: params.customerPhone || '-',
    customerTier: params.customerTier || 'Member Gold',
    claimType: params.claimType,
    rewardId: params.rewardId || '',
    rewardTitle: params.rewardTitle,
    rewardCategory: params.rewardCategory || (params.voucherCode ? 'voucher' : 'physical'),
    voucherCode: params.voucherCode || '',
    pointsUsed: Number(params.pointsUsed || 0),
    remainingPoints,
    targetAchievedAmount: Number(params.targetAchievedAmount || 0),
    rewardValue: Number(params.rewardValue || 0),
    status: 'pending',
    approvedBy: '-',
    notes: params.notes || `Pengajuan klaim ${params.claimType} dari Client PWA`,
    physicalProductName: params.physicalProductName || '',
    physicalQty: Number(params.physicalQty || 1),
  };

  await setDoc(doc(db, 'reward_claims', claimId), payload, { merge: true });
  await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'reward_claims', claimId), payload, {
    merge: true,
  }).catch(() => {});

  // If points were used, reserve/deduct them in `customers` & `stores/store_001/customers` and log to `point_ledger`
  if (params.pointsUsed > 0 && params.customerId) {
    const custUpdate = {
      points: remainingPoints,
      updatedAt: nowIso,
    };
    await setDoc(doc(db, 'customers', params.customerId), custUpdate, { merge: true }).catch(() => {});
    await setDoc(
      doc(db, 'stores', ACTIVE_STORE_ID, 'customers', params.customerId),
      custUpdate,
      { merge: true }
    ).catch(() => {});

    const ledgerId = `PTS-CLM-${Date.now().toString().slice(-5)}`;
    const ledgerEntry = {
      id: ledgerId,
      date:
        new Date().toLocaleDateString('id-ID') +
        ', ' +
        new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) +
        ' WIB',
      createdAt: nowIso,
      customerId: params.customerId,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      type: 'REDEEMED',
      amount: -Math.abs(params.pointsUsed),
      refDoc: claimId,
      notes: `Klaim ${params.claimType}: ${params.rewardTitle} (Menunggu Approval)`,
      runningBalance: remainingPoints,
    };
    await setDoc(doc(db, 'point_ledger', ledgerId), ledgerEntry, { merge: true }).catch(() => {});
  }

  return {
    ok: true,
    claimId,
    message: `Klaim "${params.rewardTitle}" (#${claimId}) berhasil dikirim! Status: Menunggu Verifikasi Admin.`,
  };
}

export type RewardClaimDoc = RewardClaimRecord & {
  normalizedPhone?: string;
  itemId?: string;
  itemTitle?: string;
  pointsCost?: number;
  discountValueIdr?: number;
  minOrderIdr?: number;
  targetRequiredIdr?: number;
  currentSpentIdr?: number;
  rewardProductName?: string;
};

export function useAllPwaPageConfigs() {
  return usePwaPageConfigs();
}

export function usePwaPageConfig(slug: PwaConfigSlug) {
  const { configs, loading, saveSlugConfig } = usePwaPageConfigs();
  const config: any = (configs as any)[slug] || (DEFAULT_PWA_PAGE_CONFIGS as any)[slug] || {};
  const saveConfig = async (data: any) => {
    await saveSlugConfig(slug, data);
  };
  return { config, loading, saveConfig };
}

export async function submitCustomerClaim(params: {
  customerId: string;
  customerName: string;
  customerPhone: string;
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
  currentCustomerPoints?: number;
}): Promise<{ ok: boolean; claimId: string; message: string }> {
  const mappedType =
    params.claimType === 'voucher'
      ? 'Voucher Promo'
      : params.claimType === 'target_milestone'
      ? 'Hadiah Target'
      : 'Reward Poin';

  const res = await submitPwaRewardClaim({
    customerId: params.customerId,
    customerName: params.customerName,
    customerPhone: params.customerPhone,
    customerTier: 'Member VIP PWA',
    currentPoints: Number(params.currentCustomerPoints || 0),
    claimType: mappedType,
    rewardId: params.itemId,
    rewardTitle: params.itemTitle,
    rewardCategory: params.claimType === 'voucher' ? 'voucher' : 'physical',
    voucherCode: params.voucherCode,
    pointsUsed: Number(params.pointsCost || 0),
    targetAchievedAmount: Number(params.currentSpentIdr || params.targetRequiredIdr || 0),
    rewardValue: Number(params.discountValueIdr || 0),
    physicalProductName: params.rewardProductName,
    physicalQty: 1,
  });

  // Store normalized fields too so both CustomerModule and ClientPwaProfilePages read them seamlessly
  const cleanDigits = String(params.customerPhone || '').replace(/\D/g, '');
  const normPhone = cleanDigits.startsWith('0')
    ? '62' + cleanDigits.slice(1)
    : cleanDigits.startsWith('62')
    ? cleanDigits
    : cleanDigits;

  const extraFields = {
    normalizedPhone: normPhone,
    claimTypeSlug: params.claimType,
    itemId: params.itemId,
    itemTitle: params.itemTitle,
    pointsCost: Number(params.pointsCost || 0),
    discountValueIdr: Number(params.discountValueIdr || 0),
    minOrderIdr: Number(params.minOrderIdr || 0),
    targetRequiredIdr: Number(params.targetRequiredIdr || 0),
    currentSpentIdr: Number(params.currentSpentIdr || 0),
    rewardProductName: params.rewardProductName || '',
  };

  await setDoc(doc(db, 'reward_claims', res.claimId), extraFields, { merge: true }).catch(() => {});
  await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'reward_claims', res.claimId), extraFields, {
    merge: true,
  }).catch(() => {});

  return res;
}

export async function approveRewardClaim(claim: any, actorName = 'Admin Dashboard'): Promise<void> {
  const id = claim?.id || claim?.claimId;
  if (!id) return;
  const nowIso = new Date().toISOString();
  const payload = {
    status: 'approved',
    approvedBy: actorName,
    approvedAt: nowIso,
    updatedAt: nowIso,
    fulfillmentAction: claim.voucherCode ? 'voucher_activated' : 'stock_deducted',
  };
  await setDoc(doc(db, 'reward_claims', id), payload, { merge: true });
  await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'reward_claims', id), payload, {
    merge: true,
  }).catch(() => {});
}

export async function deliverRewardClaim(claim: any, actorName = 'Admin Dashboard'): Promise<void> {
  const id = claim?.id || claim?.claimId;
  if (!id) return;
  const nowIso = new Date().toISOString();
  const payload = {
    status: 'used_or_delivered',
    approvedBy: actorName,
    deliveredAt: nowIso,
    updatedAt: nowIso,
  };
  await setDoc(doc(db, 'reward_claims', id), payload, { merge: true });
  await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'reward_claims', id), payload, {
    merge: true,
  }).catch(() => {});
}

export async function rejectRewardClaim(
  claim: any,
  actorName = 'Admin Dashboard',
  reason = 'Ditolak oleh Admin'
): Promise<void> {
  const id = claim?.id || claim?.claimId;
  if (!id) return;
  const nowIso = new Date().toISOString();
  const ptsToRefund = Number(claim.pointsCost ?? claim.pointsUsed ?? 0);

  const payload = {
    status: 'rejected',
    approvedBy: actorName,
    rejectedAt: nowIso,
    updatedAt: nowIso,
    notes: reason,
  };
  await setDoc(doc(db, 'reward_claims', id), payload, { merge: true });
  await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'reward_claims', id), payload, {
    merge: true,
  }).catch(() => {});

  // Refund reserved points back to customer if points were deducted
  if (ptsToRefund > 0 && claim.customerId) {
    const newPts = Number(claim.remainingPoints || 0) + ptsToRefund;
    await setDoc(
      doc(db, 'customers', claim.customerId),
      { points: newPts, updatedAt: nowIso },
      { merge: true }
    ).catch(() => {});
    await setDoc(
      doc(db, 'stores', ACTIVE_STORE_ID, 'customers', claim.customerId),
      { points: newPts, updatedAt: nowIso },
      { merge: true }
    ).catch(() => {});
  }
}

