export interface POSSettings {
  // 1. UMUM
  autoLockMinutes: number;
  barcodeEnterSubmits: boolean;
  soundBeepEnabled: boolean;
  allowManualCashierDiscount: boolean;
  maxCashierDiscountPct: number;
  autoOpenCashDrawerOnCash: boolean;

  // 2. TOKO
  selectedOutlet: string;
  storeName: string;
  storeAddress: string;
  storePhone: string;
  storeTaxNumber: string;
  storeFooterNote: string;

  // 3. PEMBAYARAN
  acceptCash: boolean;
  acceptQris: boolean;
  enableQRIS?: boolean;
  payment?: {
    enableQRIS?: boolean;
    acceptQris?: boolean;
  };
  acceptEdc: boolean;
  acceptKasbon: boolean;
  acceptCod: boolean;
  roundingEnabled: boolean;
  cashRoundingMode: 'none' | 'floor_100' | 'ceil_500';
  maxCashDrawerAlert: number;
  requireCashCountOnShiftClose: boolean;

  // 4. PRINTER STRUK
  printerInterface: 'bluetooth' | 'usb' | 'network';
  printerPaperSize: '58mm' | '80mm';
  networkPrinterIp: string;
  networkPrinterPort: string;
  autoCutPaper: boolean;
  printCopies: 1 | 2;
  printStoreLogo: boolean;
  printTaxDetail: boolean;
  printCustomerPoints: boolean;
  printReceiptBarcode: boolean;

  // 5. GLOBAL SETUP
  defaultCurrency: 'IDR' | 'USD';
  systemTimezone: string;
  taxEnabled: boolean;
  defaultTaxRate: number; // e.g. 11 for 11% PPN
  serviceChargeRate: number;
  skuPrefixFormat: string;
  lowStockDefaultAlert: number;

  // 6. HAK DAN AKSES (Stored as hashes on server side)
  requireSupervisorPinForVoid: boolean;
  requirePinForDrawerKick: boolean;
  requirePinForReprintOld: boolean;
  supervisorPinHash?: string;
  managerPinHash?: string;
}

export const DEFAULT_POS_SETTINGS: POSSettings = {
  autoLockMinutes: 10,
  barcodeEnterSubmits: true,
  soundBeepEnabled: true,
  allowManualCashierDiscount: false,
  maxCashierDiscountPct: 10,
  autoOpenCashDrawerOnCash: true,

  selectedOutlet: 'OUT-01',
  storeName: 'RiskCart Official Store',
  storeAddress: 'Jl. Boulevard Raya Blok QF1 No. 12, Kelapa Gading',
  storePhone: '(021) 4587-9922',
  storeTaxNumber: '01.234.567.8-012.000',
  storeFooterNote: 'Terima kasih telah berbelanja di RiskCart! Barang yang sudah dibeli tidak dapat ditukar tanpa bukti struk resmi.',

  acceptCash: true,
  acceptQris: true,
  enableQRIS: true,
  payment: {
    enableQRIS: true,
    acceptQris: true,
  },
  acceptEdc: true,
  acceptKasbon: true,
  acceptCod: true,
  roundingEnabled: true,
  cashRoundingMode: 'floor_100',
  maxCashDrawerAlert: 3000000,
  requireCashCountOnShiftClose: true,

  printerInterface: 'usb',
  printerPaperSize: '80mm',
  networkPrinterIp: '192.168.1.200',
  networkPrinterPort: '9100',
  autoCutPaper: true,
  printCopies: 1,
  printStoreLogo: true,
  printTaxDetail: true,
  printCustomerPoints: true,
  printReceiptBarcode: true,

  defaultCurrency: 'IDR',
  systemTimezone: 'Asia/Jakarta (WIB)',
  taxEnabled: true,
  defaultTaxRate: 11,
  serviceChargeRate: 0,
  skuPrefixFormat: 'RC-SEM-{RAND4}',
  lowStockDefaultAlert: 10,

  requireSupervisorPinForVoid: true,
  requirePinForDrawerKick: true,
  requirePinForReprintOld: false,
};

export interface PWASettings {
  // 1. UMUM
  appName: string;
  shortName: string;
  pwaThemeColor: string;
  pwaBgColor: string;
  displayMode: 'standalone' | 'fullscreen' | 'minimal-ui';
  offlineCacheEnabled: boolean;
  autoUpdateEnabled: boolean;
  enableA2hsBanner: boolean;
  cacheVersion: string;

  // 2. ORDER PELANGGAN & OPERASIONAL
  acceptingOrders: boolean;
  allowDineInTableQr: boolean;
  allowTakeaway: boolean;
  allowStoreDelivery: boolean;
  allowInstantCourier: boolean;
  minOrderPickup: number;
  minOrderDelivery: number;
  maxItemPerOrder: number;
  cartReservationTimeoutMinutes: number;

  // Jangkauan & Tarif Pengiriman
  enableTimeSlotDelivery: boolean;
  allowMultiSavedAddresses: boolean;
  serviceRadiusKm: number;
  deliveryBaseFee: number;
  deliveryFeePerKm: number;
  freeDeliveryThreshold: number;

  // 3. NOTIFIKASI
  waGatewayActive: boolean;
  waGatewayProvider: 'wablas' | 'fonnte' | 'twilio';
  webPushActive: boolean;
  emailTxActive: boolean;
  waTemplateOrderPlaced: string;
  waTemplateOrderDispatched: string;
  waTemplateAbandonedCart: string;
  enableAbandonedCartReminder: boolean;

  // 4. PEMBAYARAN
  enableQrisPwa: boolean;
  enableVaBca: boolean;
  enableVaMandiri: boolean;
  enableVaBri: boolean;
  enableEwalletGopay: boolean;
  enableEwalletShopeepay: boolean;
  enableCodPwa: boolean;
  maxCodLimit: number;
  enableMemberKasbon: boolean;
  paymentExpiryMinutes: number;
  autoCancelUnpaid: boolean;

  // 5. KEAMANAN & AKSES
  authMethod: 'whatsapp_otp' | 'google_sso' | 'both';
  allowGuestWithoutLogin: boolean;
  requireGpsValidation: boolean;
  blockMockGps: boolean;
  enableTurnstileAntiBot: boolean;
  autoHoldFraudRiskOrders: boolean;
  fraudScoreThreshold: number;
  allowCustomerDownloadInvoicePdf: boolean;
  enforceUuPdpPrivacyConsent: boolean;
}

export const DEFAULT_PWA_SETTINGS: PWASettings = {
  appName: 'RiskCart Member PWA',
  shortName: 'RiskCart App',
  pwaThemeColor: '#2563eb',
  pwaBgColor: '#09090b',
  displayMode: 'standalone',
  offlineCacheEnabled: true,
  autoUpdateEnabled: true,
  enableA2hsBanner: true,
  cacheVersion: 'v2.4.10-rev3',

  acceptingOrders: true,
  allowDineInTableQr: true,
  allowTakeaway: true,
  allowStoreDelivery: true,
  allowInstantCourier: true,
  minOrderPickup: 15000,
  minOrderDelivery: 50000,
  maxItemPerOrder: 60,
  cartReservationTimeoutMinutes: 20,

  enableTimeSlotDelivery: true,
  allowMultiSavedAddresses: true,
  serviceRadiusKm: 7,
  deliveryBaseFee: 8000,
  deliveryFeePerKm: 2500,
  freeDeliveryThreshold: 150000,

  waGatewayActive: true,
  waGatewayProvider: 'fonnte',
  webPushActive: true,
  emailTxActive: true,
  waTemplateOrderPlaced: 'Halo {{customer_name}}, pesanan {{order_id}} sebesar Rp {{total}} telah kami terima di RiskCart! Kami sedang menyiapkannya.',
  waTemplateOrderDispatched: 'Pesanan {{order_id}} sudah dalam perjalanan diantar oleh kurir {{courier_name}} (HP: {{courier_phone}}). Estimasi tiba 20 menit.',
  waTemplateAbandonedCart: 'Halo {{customer_name}}, produk favorit Anda di keranjang RiskCart masih menunggu! Selesaikan pesanan sekarang: {{cart_link}}',
  enableAbandonedCartReminder: true,

  enableQrisPwa: true,
  enableVaBca: true,
  enableVaMandiri: true,
  enableVaBri: true,
  enableEwalletGopay: true,
  enableEwalletShopeepay: true,
  enableCodPwa: true,
  maxCodLimit: 300000,
  enableMemberKasbon: true,
  paymentExpiryMinutes: 15,
  autoCancelUnpaid: true,

  authMethod: 'both',
  allowGuestWithoutLogin: false,
  requireGpsValidation: true,
  blockMockGps: true,
  enableTurnstileAntiBot: true,
  autoHoldFraudRiskOrders: true,
  fraudScoreThreshold: 70,
  allowCustomerDownloadInvoicePdf: true,
  enforceUuPdpPrivacyConsent: true,
};

export interface WebsiteSettings {
  storeOnlineStatus: boolean;
  storeName: string;
  storeTagline: string;
  storePhone: string;
  storeEmail: string;
  customDomain: string;
  metaTitle: string;
  metaDescription: string;
  heroHeadline: string;
  heroSubheadline: string;
  themeColor: string;
  showBestSellers: boolean;
  showPromotions: boolean;
  enableLiveChatWidget: boolean;
}

export const DEFAULT_WEBSITE_SETTINGS: WebsiteSettings = {
  storeOnlineStatus: true,
  storeName: 'RiskCart Online Catalog',
  storeTagline: 'Pusat Belanja Grosir & Eceran Terpercaya',
  storePhone: '0812-3456-7890',
  storeEmail: 'cs@riskcart.com',
  customDomain: 'toko.riskcart.com',
  metaTitle: 'RiskCart - Toko Online Resmi',
  metaDescription: 'Katalog belanja kebutuhan pokok grosir dan eceran dengan harga terbaik.',
  heroHeadline: 'Belanja Grosir & Eceran Lebih Mudah & Hemat',
  heroSubheadline: 'Pesan online langsung dikirim ke lokasi Anda atau ambil di toko.',
  themeColor: '#2563eb',
  showBestSellers: true,
  showPromotions: true,
  enableLiveChatWidget: true,
};

export type GatewayProviderId = 'xendit' | 'midtrans' | 'doku' | 'tripay';

export interface SingleGatewayConfig {
  enabled: boolean;
  isSandbox: boolean;
  mode?: 'sandbox' | 'production';
  merchantCode?: string;
  clientId?: string;
  clientKey?: string;
  serverKey?: string;
  secretKey?: string;
  sharedKey?: string;
  apiKey?: string;
  privateKey?: string;
  callbackUrl?: string;
  webhookUrl?: string;
  verified?: boolean;
  lastTestAt?: string;
  lastTestMessage?: string;
  updatedAt?: string;
}

export interface PaymentGatewayConfig {
  activeGateway: GatewayProviderId;
  xendit: SingleGatewayConfig;
  midtrans: SingleGatewayConfig;
  doku: SingleGatewayConfig;
  tripay: SingleGatewayConfig;
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_PAYMENT_GATEWAY_CONFIG: PaymentGatewayConfig = {
  activeGateway: 'midtrans',
  xendit: {
    enabled: false,
    isSandbox: true,
    mode: 'sandbox',
    secretKey: '',
    apiKey: '',
  },
  midtrans: {
    enabled: true,
    isSandbox: true,
    mode: 'sandbox',
    serverKey: '',
    clientKey: '',
    merchantCode: '',
  },
  doku: {
    enabled: true,
    isSandbox: true,
    mode: 'sandbox',
    clientId: '',
    secretKey: '',
    sharedKey: '',
  },
  tripay: {
    enabled: false,
    isSandbox: true,
    mode: 'sandbox',
    merchantCode: '',
    apiKey: '',
    privateKey: '',
  },
};

export interface GlobalSettings {
  taxEnabled: boolean;
  defaultTaxRate: number;
  taxPercentage: number;
  serviceChargeRate: number;
  serviceChargePercentage: number;
  enableRounding: boolean;
  roundingEnabled: boolean;
  roundingMultiple: number;
  cashRoundingMode: 'none' | 'floor_100' | 'ceil_500';
  defaultCurrency: 'IDR' | 'USD';
  systemTimezone: string;
  skuPrefixFormat: string;
  lowStockDefaultAlert: number;
  lowStockThreshold: number;
  updatedAt?: string;
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  taxEnabled: true,
  defaultTaxRate: 11,
  taxPercentage: 11,
  serviceChargeRate: 0,
  serviceChargePercentage: 0,
  enableRounding: true,
  roundingEnabled: true,
  roundingMultiple: 100,
  cashRoundingMode: 'floor_100',
  defaultCurrency: 'IDR',
  systemTimezone: 'Asia/Jakarta (WIB)',
  skuPrefixFormat: 'RC-SEM-{RAND4}',
  lowStockDefaultAlert: 10,
  lowStockThreshold: 10,
};

export interface StoreSettings {
  selectedOutlet: string;
  storeName: string;
  storeAddress: string;
  storePhone: string;
  storeTaxNumber: string;
  storeFooterNote: string;
  taxEnabled: boolean;
  defaultTaxRate: number;
  roundingEnabled: boolean;
  cashRoundingMode: 'none' | 'floor_100' | 'ceil_500';
  updatedAt?: string;
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  selectedOutlet: 'OUT-01',
  storeName: 'RiskCart Official Store',
  storeAddress: 'Jl. Boulevard Raya Blok QF1 No. 12, Kelapa Gading',
  storePhone: '(021) 4587-9922',
  storeTaxNumber: '01.234.567.8-012.000',
  storeFooterNote:
    'Terima kasih telah berbelanja di RiskCart! Barang yang sudah dibeli tidak dapat ditukar tanpa bukti struk resmi.',
  taxEnabled: true,
  defaultTaxRate: 11,
  roundingEnabled: true,
  cashRoundingMode: 'floor_100',
};

export interface AuditLogEntry {
  id?: string;
  action: string;
  module: string;
  details: string;
  target?: string;
  userName: string;
  user?: string;
  userEmail: string;
  userRole: string;
  ip: string;
  userAgent: string;
  timestamp: any;
  createdAt?: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
}

export interface AccessControlMatrix {
  roles: Record<string, string[]>;
  updatedAt?: any;
}

