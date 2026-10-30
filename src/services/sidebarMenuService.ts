import { collection, doc, getDoc, getDocs, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ACTIVE_STORE_ID } from '../config/store';
import { applyPosIndonesianGlossaryFixes } from '../utils/i18nEngine';

export interface MenuItemConfig {
  id: string;
  labelId: string;
  labelEn: string;
  path: string;
  badge?: string;
  visible: boolean;
  customLabel?: string;
  isAiCustomPage?: boolean;
  customPageSlug?: string;
}

export interface MenuGroupConfig {
  id: string; // 'ai', 'multi_outlet', etc.
  letter: string; // 'A', 'B', etc.
  labelId: string;
  labelEn: string;
  iconName: string; // lucide icon identifier
  iconColor: string;
  borderColor: string;
  visible: boolean;
  customLabel?: string;
  children: MenuItemConfig[];
}

export interface AICustomJoinSpec {
  fromCollection: string;
  toCollection: string;
  localKey: string;
  foreignKey: string;
  description: string;
}

export interface AICustomFormulaSpec {
  name: string;
  expression: string;
  explanation: string;
  outputType: 'currency' | 'number' | 'percent' | 'weight_kg';
}

export interface AICustomConditionalRule {
  fieldOrFormula: string;
  operator: string;
  thresholdFieldOrValue: string;
  badgeText: string;
  badgeColor: 'rose' | 'amber' | 'emerald' | 'blue' | 'purple';
  explanation: string;
}

export interface AICustomKpiCard {
  id: string;
  label: string;
  metricKey: string;
  format: 'currency' | 'number' | 'percent' | 'weight_kg';
  color: 'blue' | 'emerald' | 'purple' | 'amber' | 'rose';
  formula: string;
  description: string;
}

export interface AICustomChartConfig {
  id: string;
  title: string;
  chartType: 'area' | 'line' | 'bar' | 'doughnut';
  sourceCollection: string;
  format: 'currency' | 'number';
}

export interface AICustomTableColumn {
  key: string;
  label: string;
  type: 'text' | 'currency' | 'number' | 'percent' | 'weight_kg' | 'date' | 'badge';
  formula?: string;
}

export interface AICustomCrudField {
  key: string;
  label: string;
  inputType:
    | 'text'
    | 'number'
    | 'currency'
    | 'percent'
    | 'date'
    | 'select_product'
    | 'select_staff'
    | 'select_customer'
    | 'select_options';
  options?: string[];
  placeholder?: string;
  required?: boolean;
  defaultValue?: string | number;
  formulaHint?: string;
}

export interface AICustomPageSchema {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  targetGroupId: string;
  path: string;
  modelUsed: string;
  hasVisionInput?: boolean;
  createdAt: string;
  domainPreset?: 'tax' | 'kpi' | 'inventory' | 'shift' | 'finance' | 'custom';
  customCollectionName?: string;
  crudFields?: AICustomCrudField[];
  ecosystemImpactButton?: {
    enabled: boolean;
    label: string;
    category: string;
    actionType: 'add_cash_out' | 'add_cash_in' | 'restock_product';
    description: string;
  };
  connectedCollections: string[];
  joinMappings: AICustomJoinSpec[];
  formulas: AICustomFormulaSpec[];
  conditionalRules: AICustomConditionalRule[];
  twoWaySyncEffects: string[];
  kpiCards: AICustomKpiCard[];
  charts?: AICustomChartConfig[];
  table: {
    title: string;
    primaryCollection: string;
    joinCollections?: string[];
    searchPlaceholder?: string;
    columns: AICustomTableColumn[];
  };
  actionForm?: {
    enabled: boolean;
    title: string;
    description: string;
    defaultActionType:
      | 'restock_product'
      | 'deduct_stock'
      | 'add_cash_in'
      | 'add_cash_out'
      | 'update_product_price'
      | 'update_order_status';
  };
}

export interface SidebarMenuStructure {
  groupsOrder: string[];
  groupVisible: Record<string, boolean>;
  groupCustomLabels: Record<string, string>;
  childrenOrderByGroup: Record<string, string[]>;
  childrenVisible: Record<string, boolean>;
  childrenCustomLabels: Record<string, string>;
  aiAgentsOrder?: string[];
  aiAgentsVisible?: Record<string, boolean>;
  aiAgentsCustomLabels?: Record<string, string>;
  aiAgentsMovedToGroup?: Record<string, string>;
  customMenuItems?: Record<string, MenuItemConfig[]>;
  customPages?: Record<string, AICustomPageSchema>;
  focusRemovedG1C8?: boolean;
  focusRemovedItemId?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const LOCAL_STORAGE_KEY = 'riskcart_wp_sidebar_menu_v1';
export const MENU_UPDATED_EVENT = 'sidebar-menu-updated';

/**
 * 16 Master Menu Groups of RiskCart (A through P) with their canonical child sub-routes.
 */
export const DEFAULT_SIDEBAR_MENU: MenuGroupConfig[] = [
  {
    id: 'ai',
    letter: 'A',
    labelId: 'A. KECERDASAN BUATAN (AI)',
    labelEn: 'A. ARTIFICIAL INTELLIGENCE',
    iconName: 'Brain',
    iconColor: 'text-purple-400',
    borderColor: 'border-purple-500/80',
    visible: true,
    children: [
      { id: 'ai_architect', labelId: 'AI System Architect & Editor', labelEn: 'AI System Architect & Editor', path: '/dashboard/ai-architect', badge: 'ARCHITECT', visible: true },
      { id: 'ai_master', labelId: 'Master AI', labelEn: 'Master AI', path: '/dashboard/ai/master', visible: true },
      { id: 'business_advisor', labelId: 'AI Penasihat Bisnis (Advisor)', labelEn: 'AI Business Advisor', path: '/dashboard/ai/business-advisor', badge: 'ADVISOR', visible: true },
      { id: 'ai_advisor_purchase', labelId: 'AI Advisor Pembelian', labelEn: 'AI Advisor Purchase', path: '/dashboard/ai/ai-advisor-purchase?agent=ai-advisor-purchase', badge: '7-Day Lock', visible: true },
      { id: 'order_intent_parser', labelId: 'Parser Intensi & Typo Pesanan', labelEn: 'Order Intent & Typo Parser', path: '/dashboard/ai/order-intent-parser?agent=order-intent-parser', visible: true },
      { id: 'strategic_restock_advisor', labelId: 'Penasihat Restock Strategis', labelEn: 'Strategic Restock Advisor', path: '/dashboard/ai/strategic-restock-advisor?agent=strategic-restock-advisor', visible: true },
      { id: 'ai_chat_pwa', labelId: 'AI Chat Klien PWA', labelEn: 'AI Chat Client PWA', path: '/dashboard/ai/ai-chat-pwa?agent=ai-chat-pwa', visible: true },
      { id: 'loss_prevention', labelId: 'AI Pencegahan Kerugian', labelEn: 'Loss Prevention AI', path: '/dashboard/ai/loss-prevention?agent=loss-prevention', visible: true },
      { id: 'anti_fraud_sentinel', labelId: 'Anti-Fraud Sentinel AI', labelEn: 'Anti-Fraud Sentinel AI', path: '/dashboard/ai/anti-fraud-sentinel?agent=anti-fraud-sentinel', visible: true },
      { id: 'business_copilot', labelId: 'Tanya AI Business Copilot', labelEn: 'Ask AI Business Copilot', path: '/dashboard/ai/business-copilot?agent=business-copilot', visible: true },
      { id: 'dynamic_pricing', labelId: 'AI Analisa Margin & Harga Jual', labelEn: 'AI Thin Margin & Pricing Optimizer', path: '/dashboard/ai/dynamic-pricing?agent=dynamic-pricing', badge: 'MARGIN', visible: true },
      { id: 'customer_retention', labelId: 'AI Retensi & Churn Pelanggan', labelEn: 'Customer Retention & Churn AI', path: '/dashboard/ai/customer-retention?agent=customer-retention', visible: true },
      { id: 'supplier_anomaly', labelId: 'AI Anomali Harga Supplier', labelEn: 'Supplier Price Anomaly AI', path: '/dashboard/ai/supplier-anomaly?agent=supplier-anomaly', visible: true },
      { id: 'staff_kpi', labelId: 'AI KPI & Performa Staf', labelEn: 'Staff KPI & Performance AI', path: '/dashboard/ai/staff-kpi?agent=staff-kpi', visible: true },
      { id: 'scanner_ai', labelId: 'AI Pemindai Suara & Barcode', labelEn: 'Voice & Barcode Scanner AI', path: '/dashboard/ai/scanner-ai?agent=scanner-ai', visible: true },
      { id: 'ai_knowledge', labelId: 'Ai Agent Assistant', labelEn: 'Ai Agent Assistant', path: '/dashboard/ai-agent', visible: true },
      { id: 'ai_page_builder', labelId: 'AI Page Builder & Visual Chart', labelEn: 'AI Page Builder & Visual Chart', path: '/dashboard/ai-page-builder', badge: '#Tags', visible: true },
      { id: 'ai-asset-stock', labelId: 'AI Asset & Stock Chart', labelEn: 'AI Asset & Stock Chart', path: '/ai-asset-stock', badge: 'NEW', visible: true },
    ],
  },
  {
    id: 'multi_outlet',
    letter: 'B',
    labelId: 'B. MULTI OUTLET',
    labelEn: 'B. MULTI OUTLET',
    iconName: 'Store',
    iconColor: 'text-blue-400',
    borderColor: 'border-blue-500/80',
    visible: true,
    children: [
      { id: 'lihat_outlet', labelId: 'Lihat Outlet', labelEn: 'View Outlets', path: '/dashboard/multi-outlet/lihat-outlet', visible: true },
      { id: 'warehose', labelId: 'Gudang (Warehouse)', labelEn: 'Warehouse', path: '/dashboard/multi-outlet/gudang', visible: true },
    ],
  },
  {
    id: 'shift',
    letter: 'C',
    labelId: 'C. SHIFT KASIR',
    labelEn: 'C. SHIFT MANAGEMENT',
    iconName: 'Clock',
    iconColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/80',
    visible: true,
    children: [
      { id: 'cashir', labelId: 'Tutup Shift (Kasir)', labelEn: 'End Shift (Cashier)', path: '/dashboard/shift/kasir', visible: true },
      { id: 'divisi_role', labelId: 'Divisi & Role Staff', labelEn: 'Staff Divisions & Roles', path: '/dashboard/shift/divisi-role', badge: 'DIVISI', visible: true },
      { id: 'kas_masuk', labelId: 'Kas Masuk (Modal Awal)', labelEn: 'Cash In (Float)', path: '/dashboard/shift/kas-masuk', visible: true },
      { id: 'kas_keluar', labelId: 'Kas Keluar', labelEn: 'Cash Out (Payout)', path: '/dashboard/shift/kas-keluar', visible: true },
      { id: 'riwayat_shit', labelId: 'Riwayat Shift', labelEn: 'Shift History', path: '/dashboard/shift/riwayat', visible: true },
    ],
  },
  {
    id: 'dashboard',
    letter: 'D',
    labelId: 'D. DASHBOARD',
    labelEn: 'D. DASHBOARDS',
    iconName: 'LayoutDashboard',
    iconColor: 'text-cyan-400',
    borderColor: 'border-cyan-500/80',
    visible: true,
    children: [
      { id: 'admin', labelId: 'Ringkasan Dashboard', labelEn: 'Admin Overview', path: '/dashboard', visible: true },
      { id: 'myasset', labelId: 'Asset Toko', labelEn: 'Store Assets', path: '/dashboard/myasset', visible: true },
      { id: 'laporankas', labelId: 'Laporan Penjualan & Kas', labelEn: 'Sales & Cash Reports', path: '/dashboard/laporankas', badge: 'PRO', visible: true },
      { id: 'laporancashflow', labelId: 'Laporan Cashflow (1 Halaman)', labelEn: '1-Page Cashflow & P&L', path: '/dashboard/laporancashflow', badge: 'PRINT', visible: true },
      { id: 'transaction_store', labelId: 'Transactions Store (Brankas)', labelEn: 'Transactions Store (Vault)', path: '/transaction-store', visible: true },
      { id: 'transactions', labelId: 'Dashboard Transaksi', labelEn: 'Transactions Feed', path: '/transaksi', visible: true },
      { id: 'assets', labelId: 'Manajemen Aset Finansial', labelEn: 'Financial Asset Management', path: '/dashboard/laporan', visible: true },
    ],
  },
  {
    id: 'reservation_table',
    letter: 'D2',
    labelId: 'Reservation Table',
    labelEn: 'Reservation Table',
    iconName: 'Boxes',
    iconColor: 'text-amber-400',
    borderColor: 'border-amber-500/80',
    visible: true,
    children: [
      { id: 'res_table_layout', labelId: 'Table Layout', labelEn: 'Table Layout', path: '/dashboard/layout-table', visible: true },
      { id: 'res_reservasi', labelId: 'Reservasi', labelEn: 'Reservasi', path: '/dashboard/reservation', visible: true },
      { id: 'res_list', labelId: 'List Reservasi', labelEn: 'List Reservasi', path: '/dashboard/reservation/list', visible: true },
      { id: 'res_summary_report', labelId: 'Summary Report', labelEn: 'Summary Report', path: '/dashboard/layout-table/summary', visible: true },
    ],
  },
  {
    id: 'produk',
    letter: 'E',
    labelId: 'E. KATALOG PRODUK',
    labelEn: 'E. PRODUCTS & CARTONS',
    iconName: 'Boxes',
    iconColor: 'text-amber-400',
    borderColor: 'border-amber-500/80',
    visible: true,
    children: [
      { id: 'list_produk', labelId: 'Daftar Produk', labelEn: 'Product Catalog', path: '/dashboard/produk', visible: true },
      { id: 'tambah_produk', labelId: '+ Tambah Produk', labelEn: '+ Add Product', path: '/dashboard/produk/tambah', badge: '+ Add', visible: true },
      { id: 'produk_log', labelId: 'Log Produk', labelEn: 'Product Log', path: '/dashboard/produk-log', badge: 'LIVE', visible: true },
      { id: 'paket_produk', labelId: 'Paket / Bundling Produk', labelEn: 'Product Bundles', path: '/dashboard/produk/paket', visible: true },
      { id: 'kategori', labelId: 'Kategori & Brand', labelEn: 'Categories & Brands', path: '/dashboard/kategori-produk', visible: true },
      { id: 'harga_diskon', labelId: 'Harga Diskon & Grosir', labelEn: 'Discounts & Tier Pricing', path: '/dashboard/produk/harga-diskon', visible: true },
    ],
  },
  {
    id: 'bahan_baku',
    letter: 'E2',
    labelId: 'Stok Bahan Baku',
    labelEn: 'Raw Material Stock',
    iconName: 'Boxes',
    iconColor: 'text-amber-400',
    borderColor: 'border-amber-500/80',
    visible: true,
    children: [
      { id: 'bb_list', labelId: 'List Bahan Baku', labelEn: 'Raw Material List', path: '/dashboard/bahan-baku/', visible: true },
      { id: 'bb_supplier', labelId: 'Daftar Supplier', labelEn: 'Supplier Directory', path: '/dashboard/bahan-baku/supplier', visible: true },
      { id: 'bb_pembelian', labelId: 'Pembelian Bahan Baku', labelEn: 'Raw Material Procurement', path: '/dashboard/bahan-baku/pembelian', visible: true },
      { id: 'bb_po', labelId: 'Daftar Pembelian (PO)', labelEn: 'Purchase Orders (PO)', path: '/dashboard/bahan-baku/po', visible: true },
      { id: 'bb_request', labelId: 'Permintaan Pembelian', labelEn: 'Purchase Requests', path: '/dashboard/bahan-baku/request', visible: true },
      { id: 'bb_ai', labelId: 'AI Bahan Baku', labelEn: 'AI Raw Material Control', path: '/dashboard/bahan-baku/ai', badge: 'AI', visible: true },
    ],
  },
  {
    id: 'pembelian',
    letter: 'F',
    labelId: 'F. PEMBELIAN PRODUK',
    labelEn: 'F. PROCUREMENT & PURCHASING',
    iconName: 'Truck',
    iconColor: 'text-orange-400',
    borderColor: 'border-orange-500/80',
    visible: true,
    children: [
      { id: 'daftar_supplier', labelId: 'Daftar Supplier', labelEn: 'Supplier Directory', path: '/dashboard/pembelian/daftar-supplier', visible: true },
      { id: 'daftar_pembelian', labelId: 'Daftar Pembelian (PO)', labelEn: 'Purchase Order List', path: '/dashboard/pembelian/daftar-pembelian', visible: true },
      { id: 'request_pembelian', labelId: 'Permintaan Pembelian', labelEn: 'Purchase Requests', path: '/dashboard/pembelian/request-pembelian', visible: true },
      { id: 'pembelian_produk', labelId: 'Pembelian Produk', labelEn: 'Stock Procurement', path: '/dashboard/pembelian/pembelian-produk', visible: true },
      { id: 'statistik_pembelian', labelId: 'Statistik Pembelian', labelEn: 'Procurement Analytics', path: '/dashboard/pembelian/statistik', visible: true },
    ],
  },
  {
    id: 'transaksi_pos',
    letter: 'G',
    labelId: 'G. TRANSAKSI POS',
    labelEn: 'G. POS TRANSACTIONS',
    iconName: 'ShoppingBag',
    iconColor: 'text-blue-400',
    borderColor: 'border-blue-500/80',
    visible: true,
    children: [
      { id: 'orders_wharf', labelId: 'Antrean Pesanan', labelEn: 'Order Queue', path: '/dashboard/orders', badge: 'ANTREAN', visible: true },
      { id: 'kitchen_display', labelId: 'Dapur (Kitchen Display)', labelEn: 'Kitchen Display (KDS)', path: '/kitchen', badge: 'DAPUR', visible: true },
      { id: 'transaksi_penjualan', labelId: 'Transaksi Penjualan', labelEn: 'Sales Transactions', path: '/dashboard/transaksi-pos/penjualan', visible: true },
      { id: 'pendapatan_masuk', labelId: 'Pendapatan Masuk', labelEn: 'Incoming Revenue', path: '/dashboard/transaksi-pos/pendapatan-masuk', visible: true },
      { id: 'pengeluaran_toko', labelId: 'Pengeluaran Toko', labelEn: 'Store Operational Expenses', path: '/dashboard/transaksi-pos/pengeluaran-toko', visible: true },
    ],
  },
  {
    id: 'inventory',
    letter: 'H',
    labelId: 'H. LACAK INVENTARIS',
    labelEn: 'H. INVENTORY TRACKING',
    iconName: 'Layers',
    iconColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/80',
    visible: true,
    children: [
      { id: 'inventory_overview', labelId: 'Ringkasan Inventaris', labelEn: 'Inventory Overview', path: '/dashboard/inventory', visible: true },
      { id: 'kartu_stok', labelId: 'Kartu Stok', labelEn: 'Stock Card History', path: '/dashboard/inventory/kartu-stok', visible: true },
      { id: 'stok_minimum', labelId: 'Stok Minimum', labelEn: 'Critical Stock Thresholds', path: '/dashboard/inventory/stok-minimum', visible: true },
      { id: 'stok_opname', labelId: 'Stok Opname', labelEn: 'Physical Stock Count (Audit)', path: '/dashboard/inventory/stok-opname', visible: true },
      { id: 'produk_restock', labelId: 'Perencanaan Restock', labelEn: 'Restock Planning', path: '/dashboard/inventory/produk-restock', visible: true },
    ],
  },
  {
    id: 'pelanggan',
    letter: 'I',
    labelId: 'I. PELANGGAN',
    labelEn: 'I. CUSTOMERS',
    iconName: 'Users',
    iconColor: 'text-indigo-400',
    borderColor: 'border-indigo-500/80',
    visible: true,
    children: [
      { id: 'daftar_pelanggan', labelId: 'Daftar Pelanggan', labelEn: 'Customer Directory', path: '/dashboard/pelanggan', visible: true },
      { id: 'tipe_pelanggan', labelId: 'Tipe Pelanggan', labelEn: 'Customer Tiers & Roles', path: '/dashboard/pelanggan/tipe', visible: true },
      { id: 'hutang_pelanggan', labelId: 'Piutang / Kasbon Pelanggan', labelEn: 'Customer Credit / Payables', path: '/dashboard/pelanggan/hutang', visible: true },
      { id: 'poin_pelanggan', labelId: 'Poin Pelanggan', labelEn: 'Loyalty Points', path: '/dashboard/pelanggan/poin', visible: true },
      { id: 'langganan', labelId: 'Langganan', labelEn: 'Subscriptions', path: '/dashboard/pelanggan/langganan', visible: true },
      { id: 'claim_hadiah', labelId: 'Klaim Hadiah', labelEn: 'Rewards Redemption', path: '/dashboard/pelanggan/claim-hadiah', visible: true },
    ],
  },
  {
    id: 'marketing',
    letter: 'J',
    labelId: 'J. MARKETING & PROMOSI',
    labelEn: 'J. MARKETING & PROMOTIONS',
    iconName: 'Target',
    iconColor: 'text-pink-400',
    borderColor: 'border-pink-500/80',
    visible: true,
    children: [
      { id: 'hadiah_target', labelId: 'Hadiah Target', labelEn: 'Target Rewards', path: '/dashboard/marketing/hadiah-target', visible: true },
      { id: 'informasi_hadiah', labelId: 'Informasi & Hadiah', labelEn: 'Gift & Reward Info', path: '/dashboard/marketing/informasi-hadiah', visible: true },
      { id: 'voucher_promo', labelId: 'Voucher dan Promo', labelEn: 'Vouchers & Promo Codes', path: '/dashboard/marketing/voucher-promo', visible: true },
      { id: 'setting_poin', labelId: 'Pengaturan Poin POS', labelEn: 'Loyalty Point Rules', path: '/dashboard/marketing/setting-poin', visible: true },
      { id: 'setting_poin_pwa', labelId: 'Pengaturan Poin PWA', labelEn: 'PWA App Points Rules', path: '/dashboard/marketing/setting-poin-pwa', visible: true },
      { id: 'statistik_marketing', labelId: 'Statistik Marketing', labelEn: 'Campaign Performance', path: '/dashboard/marketing/statistik', visible: true },
    ],
  },
  {
    id: 'staff',
    letter: 'K',
    labelId: 'K. MANAJEMEN STAF',
    labelEn: 'K. STAFF & WORKFORCE',
    iconName: 'UserCheck',
    iconColor: 'text-teal-400',
    borderColor: 'border-teal-500/80',
    visible: true,
    children: [
      { id: 'daftar_staff', labelId: 'Daftar Staf', labelEn: 'Staff Directory', path: '/dashboard/staff', visible: true },
      { id: 'role_jabatan', labelId: 'Jabatan / Role', labelEn: 'Roles & Positions', path: '/dashboard/staff/role-jabatan', visible: true },
      { id: 'otoritas_akses', labelId: 'Otoritas Akses', labelEn: 'Access Authority (RBAC)', path: '/dashboard/staff/otoritas-akses', badge: 'RBAC', visible: true },
      { id: 'hak_akses', labelId: 'Hak & Akses (RBAC)', labelEn: 'Access Permissions (RBAC)', path: '/dashboard/hakdanakses', badge: 'RBAC', visible: true },
      { id: 'kpi_staff', labelId: 'KPI Staf', labelEn: 'Staff KPI Benchmarks', path: '/dashboard/staff/kpi', visible: true },
      { id: 'ai_setting_job_staff', labelId: 'Pengaturan Tugas Staf AI', labelEn: 'AI Job Description Generator', path: '/dashboard/staff/ai-job', visible: true },
    ],
  },
  {
    id: 'keuangan',
    letter: 'L',
    labelId: 'L. KEUANGAN & BRANKAS',
    labelEn: 'L. FINANCE & VAULTS',
    iconName: 'Vault',
    iconColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/80',
    visible: true,
    children: [
      { id: 'brangkas_toko', labelId: 'Brankas Toko', labelEn: 'Store Cash Vault', path: '/dashboard/keuangan/brangkas-toko', visible: true },
      { id: 'brangkas_modal', labelId: 'Brankas Modal', labelEn: 'Capital Reserve Vault', path: '/dashboard/keuangan/brangkas-modal', visible: true },
      { id: 'brangkas_untung', labelId: 'Brankas Untung', labelEn: 'Net Profit Vault', path: '/dashboard/keuangan/brangkas-untung', visible: true },
      { id: 'type_keuangan', labelId: 'Tipe Akun Keuangan', labelEn: 'Ledger Account Types', path: '/dashboard/keuangan/tipe-keuangan', visible: true },
      { id: 'riwayat_keuangan', labelId: 'Riwayat Keuangan', labelEn: 'Financial Audit History', path: '/dashboard/keuangan/riwayat', visible: true },
    ],
  },
  {
    id: 'online_order',
    letter: 'M',
    labelId: 'M. PENGATURAN PESANAN ONLINE',
    labelEn: 'M. ONLINE ORDER SETTINGS',
    iconName: 'Globe',
    iconColor: 'text-blue-400',
    borderColor: 'border-blue-500/80',
    visible: true,
    children: [
      { id: 'website_setting', labelId: 'Pengaturan Website Toko', labelEn: 'Storefront Website Setup', path: '/dashboard/online-order/website', visible: true },
      { id: 'client_pwa_setting', labelId: 'Pengaturan Klien PWA', labelEn: 'Client PWA Channel Setup', path: '/dashboard/online-order/client-pwa', visible: true },
    ],
  },
  {
    id: 'pengaturan_pwa',
    letter: 'N',
    labelId: 'N. PENGATURAN PWA',
    labelEn: 'N. PWA SETTINGS',
    iconName: 'Smartphone',
    iconColor: 'text-amber-400',
    borderColor: 'border-amber-500/80',
    visible: true,
    children: [
      { id: 'umum', labelId: 'Umum & Beranda', labelEn: 'General & Home', path: '/dashboard/pengaturan-pwa/umum', visible: true },
      { id: 'login', labelId: 'Login WA & PIN', labelEn: 'WA & PIN Login', path: '/dashboard/pengaturan-pwa/login', visible: true },
      { id: 'order_pelanggan', labelId: 'Aturan Pesanan Pelanggan', labelEn: 'Customer Order Rules', path: '/dashboard/pengaturan-pwa/order-pelanggan', visible: true },
      { id: 'pembayaran', labelId: 'Pembayaran PWA', labelEn: 'PWA Payment Methods', path: '/dashboard/pengaturan-pwa/pembayaran', visible: true },
      { id: 'notifikasi', labelId: 'Notifikasi & WA', labelEn: 'Instant Notifications', path: '/dashboard/pengaturan-pwa/notifikasi', visible: true },
      { id: 'profile', labelId: 'Menu Profil & Tier', labelEn: 'Profile Menu & Tiers', path: '/dashboard/pengaturan-pwa/profile', visible: true },
      { id: 'target', labelId: 'Hadiah Target', labelEn: 'Target Milestones', path: '/dashboard/pengaturan-pwa/target', badge: 'TARGET', visible: true },
      { id: 'voucher', labelId: 'Katalog Voucher', labelEn: 'Voucher Catalog', path: '/dashboard/pengaturan-pwa/voucher', badge: 'PROMO', visible: true },
      { id: 'reward', labelId: 'Reward & Rumus Poin', labelEn: 'Rewards & Point Formula', path: '/dashboard/pengaturan-pwa/reward', badge: 'POIN', visible: true },
      { id: 'top_buyer', labelId: 'Peringkat Top 10 Pembeli', labelEn: 'Top 10 Buyer Leaderboard', path: '/dashboard/pengaturan-pwa/top-buyer', visible: true },
      { id: 'informasi', labelId: 'Informasi & Kurir', labelEn: 'Announcements & Courier', path: '/dashboard/pengaturan-pwa/informasi', visible: true },
      { id: 'faq', labelId: 'FAQ & Chat Admin', labelEn: 'FAQ & Admin Chat', path: '/dashboard/pengaturan-pwa/faq', visible: true },
      { id: 'hak_akses', labelId: 'Hak dan Akses', labelEn: 'Access Rights & Roles', path: '/dashboard/pengaturan-pwa/hak-akses', visible: true },
    ],
  },
  {
    id: 'pengaturan_pos',
    letter: 'O',
    labelId: 'O. PENGATURAN POS',
    labelEn: 'O. POS SYSTEM SETTINGS',
    iconName: 'Settings',
    iconColor: 'text-zinc-400',
    borderColor: 'border-zinc-500/80',
    visible: true,
    children: [
      { id: 'menu', labelId: 'Pengaturan Menu (Drag & Drop)', labelEn: 'Menu Settings (Drag & Drop)', path: '/dashboard/pengaturan-pos/menu', badge: 'WP', visible: true },
      { id: 'umum', labelId: 'Umum', labelEn: 'General POS', path: '/dashboard/pengaturan-pos/umum', visible: true },
      { id: 'toko', labelId: 'Profil Toko', labelEn: 'Store Profile', path: '/dashboard/pengaturan-pos/toko', visible: true },
      { id: 'pembayaran', labelId: 'Metode Pembayaran', labelEn: 'POS Payment Methods', path: '/dashboard/pengaturan-pos/pembayaran', visible: true },
      { id: 'printer_struk', labelId: 'Printer Struk', labelEn: 'Receipt Printer', path: '/dashboard/pengaturan-pos/printer-struk', visible: true },
      { id: 'global_setup', labelId: 'Pengaturan Sistem Global', labelEn: 'Global System Setup', path: '/dashboard/pengaturan-pos/global-setup', visible: true },
      { id: 'hak_akses', labelId: 'Hak dan Akses', labelEn: 'Access Rights', path: '/dashboard/pengaturan-pos/hak-akses', visible: true },
      { id: 'backup_restore', labelId: 'Backup & Restore Data', labelEn: 'Backup and Restore', path: '/dashboard/pengaturan-pos/backup-restore', visible: true },
      { id: 'payment_gateway', labelId: 'Payment Gateway', labelEn: 'Payment Gateway Setup', path: '/dashboard/pengaturan-pos/payment-gateway', visible: true },
      { id: 'audit_log', labelId: 'Log Audit Keamanan', labelEn: 'Security Audit Log', path: '/dashboard/pengaturan-pos/audit-log', visible: true },
    ],
  },
  {
    id: 'integrasi_payment',
    letter: 'P',
    labelId: 'P. INTEGRASI PAYMENT',
    labelEn: 'P. PAYMENT INTEGRATION',
    iconName: 'CreditCard',
    iconColor: 'text-cyan-400',
    borderColor: 'border-cyan-500/80',
    visible: true,
    children: [
      { id: 'xendit', labelId: 'Xendit', labelEn: 'Xendit Gateway', path: '/dashboard/payment/xendit', visible: true },
      { id: 'doku', labelId: 'Doku', labelEn: 'Doku Gateway', path: '/dashboard/payment/doku', visible: true },
      { id: 'midtrans', labelId: 'Midtrans', labelEn: 'Midtrans Snap', path: '/dashboard/payment/midtrans', visible: true },
    ],
  },
  {
    id: 'semua_halaman',
    letter: 'T',
    labelId: 'T. SEMUA HALAMAN PROYEK',
    labelEn: 'T. ALL PROJECT PAGES',
    iconName: 'Layers',
    iconColor: 'text-amber-400',
    borderColor: 'border-amber-500/80',
    visible: true,
    children: [
      // 1. Halaman Utama, POS & Standalone
      { id: 'all_beranda', labelId: 'Beranda / Landing Page', labelEn: 'Landing Page', path: '/dashboard/beranda', badge: 'MAIN', visible: true },
      { id: 'all_dashboard', labelId: 'Ringkasan Dashboard Utama', labelEn: 'Admin Dashboard Overview', path: '/dashboard', badge: 'MAIN', visible: true },
      { id: 'all_pos_machine', labelId: 'Mesin Kasir POS (Terminal)', labelEn: 'POS Cashier Machine', path: '/dashboard/pos', badge: 'POS', visible: true },
      { id: 'all_myasset', labelId: 'Asset Toko (MyAsset)', labelEn: 'Store Asset (MyAsset)', path: '/dashboard/myasset', visible: true },
      { id: 'all_laporankas', labelId: 'Laporan Penjualan & Kas', labelEn: 'Sales & Cash Reports', path: '/dashboard/laporankas', badge: 'REPORT', visible: true },
      { id: 'all_laporancashflow', labelId: 'Laporan Cashflow & Laba Rugi (1 Halaman)', labelEn: '1-Page Cashflow & P&L Sheet', path: '/dashboard/laporancashflow', badge: 'PRINT', visible: true },
      { id: 'all_transaction_store', labelId: 'Transactions Store (Brangkas)', labelEn: 'Transactions Store (Vault)', path: '/transaction-store', visible: true },
      { id: 'all_transactions', labelId: 'Dashboard Transaksi Feed', labelEn: 'Transactions Feed', path: '/transaksi', visible: true },
      { id: 'all_assets_financial', labelId: 'Asset Management (Laporan)', labelEn: 'Financial Asset Management', path: '/dashboard/laporan', visible: true },
      { id: 'all_anti_fraud', labelId: 'Anti-Fraud Inspector', labelEn: 'Anti-Fraud Inspector', path: '/dashboard/anti-fraud', badge: 'AI', visible: true },
      { id: 'all_restock_advisor', labelId: 'Restock Advisor', labelEn: 'Restock Advisor', path: '/dashboard/restock-advisor', badge: 'AI', visible: true },
      { id: 'all_customer_types', labelId: 'Manajemen Tipe Pelanggan', labelEn: 'Customer Types Manager', path: '/dashboard/customer-types', visible: true },
      { id: 'all_pwa_standalone', labelId: 'Pengaturan PWA (Standalone)', labelEn: 'PWA Settings (Standalone)', path: '/dashboard/pwa-standalone', visible: true },
      { id: 'all_pengaturan', labelId: 'Pengaturan Sistem Umum', labelEn: 'General System Settings', path: '/dashboard/pengaturan', visible: true },
      { id: 'all_hakdanakses', labelId: 'Hak & Akses (RBAC Matrix)', labelEn: 'Access Permissions (RBAC)', path: '/dashboard/hakdanakses', badge: 'RBAC', visible: true },
      { id: 'all_segera_hadir', labelId: 'Halaman Segera Hadir', labelEn: 'Coming Soon Page', path: '/dashboard/segera-hadir', visible: true },

      // 2. Kecerdasan Buatan (AI) & 11 AI Agents
      { id: 'all_ai_asset_stock', labelId: 'AI Asset & Stock Chart (MoM & Rekonsiliasi)', labelEn: 'AI Asset & Stock Chart (MoM & Reconciliation)', path: '/ai-asset-stock', badge: 'NEW', visible: true },
      { id: 'all_ai_architect', labelId: 'AI System Architect & Editor', labelEn: 'AI System Architect & Editor', path: '/dashboard/ai-architect', badge: 'AI', visible: true },
      { id: 'all_ai_master', labelId: 'Master AI Workspace', labelEn: 'Master AI Workspace', path: '/dashboard/ai/master', badge: 'AI', visible: true },
      { id: 'all_ai_agent_knowledge', labelId: 'AI Agent Assistant & Knowledge', labelEn: 'AI Agent Assistant & Knowledge', path: '/dashboard/ai-agent', badge: 'AI', visible: true },
      { id: 'all_ai_tanya_ai', labelId: 'Tanya AI Business Copilot', labelEn: 'Ask AI Business Copilot', path: '/dashboard/ai/tanya-ai', badge: 'COPILOT', visible: true },
      { id: 'all_ai_advisor_purchase', labelId: 'AI Advisor Pembelian (7-Day)', labelEn: 'AI Advisor Purchase (7-Day)', path: '/dashboard/ai/ai-advisor-purchase?agent=ai-advisor-purchase', badge: 'AI', visible: true },
      { id: 'all_ai_order_intent', labelId: 'Parser Intensi & Typo Pesanan', labelEn: 'Order Intent & Typo Parser', path: '/dashboard/ai/order-intent-parser?agent=order-intent-parser', badge: 'AI', visible: true },
      { id: 'all_ai_strategic_restock', labelId: 'Penasihat Restock Strategis', labelEn: 'Strategic Restock Advisor', path: '/dashboard/ai/strategic-restock-advisor?agent=strategic-restock-advisor', badge: 'AI', visible: true },
      { id: 'all_ai_chat_pwa', labelId: 'AI Chat Klien PWA', labelEn: 'AI Chat Client PWA', path: '/dashboard/ai/ai-chat-pwa?agent=ai-chat-pwa', badge: 'AI', visible: true },
      { id: 'all_ai_loss_prevention', labelId: 'AI Pencegahan Kerugian & Kas', labelEn: 'Loss Prevention & Cash Anomaly AI', path: '/dashboard/ai/loss-prevention?agent=loss-prevention', badge: 'AI', visible: true },
      { id: 'all_ai_anti_fraud_sentinel', labelId: 'Anti-Fraud Sentinel AI', labelEn: 'Anti-Fraud Sentinel AI', path: '/dashboard/ai/anti-fraud-sentinel?agent=anti-fraud-sentinel', badge: 'AI', visible: true },
      { id: 'all_ai_business_copilot', labelId: 'Business Copilot Agent', labelEn: 'Business Copilot Agent', path: '/dashboard/ai/business-copilot?agent=business-copilot', badge: 'AI', visible: true },
      { id: 'all_ai_dynamic_pricing', labelId: 'Optimasi Harga Dinamis AI', labelEn: 'Dynamic Pricing Optimizer AI', path: '/dashboard/ai/dynamic-pricing?agent=dynamic-pricing', badge: 'AI', visible: true },
      { id: 'all_ai_customer_retention', labelId: 'AI Retensi & Churn Pelanggan', labelEn: 'Customer Retention & Churn AI', path: '/dashboard/ai/customer-retention?agent=customer-retention', badge: 'AI', visible: true },
      { id: 'all_ai_supplier_anomaly', labelId: 'AI Anomali Harga Supplier', labelEn: 'Supplier Price Anomaly AI', path: '/dashboard/ai/supplier-anomaly?agent=supplier-anomaly', badge: 'AI', visible: true },
      { id: 'all_ai_staff_kpi', labelId: 'AI KPI & Performa Staf', labelEn: 'Staff KPI & Performance AI', path: '/dashboard/ai/staff-kpi?agent=staff-kpi', badge: 'AI', visible: true },
      { id: 'all_ai_scanner', labelId: 'AI Pemindai Suara & Barcode', labelEn: 'Voice & Barcode Scanner AI', path: '/dashboard/ai/scanner-ai?agent=scanner-ai', badge: 'AI', visible: true },

      // 3. Multi Outlet & Shift
      { id: 'all_outlet_lihat', labelId: 'Multi Outlet: Lihat Outlet', labelEn: 'Multi Outlet: View Outlets', path: '/dashboard/multi-outlet/lihat-outlet', visible: true },
      { id: 'all_outlet_tambah', labelId: 'Multi Outlet: + Tambah Outlet', labelEn: 'Multi Outlet: + Add Outlet', path: '/dashboard/multi-outlet/lihat-outlet/tambah', visible: true },
      { id: 'all_outlet_gudang', labelId: 'Multi Outlet: Warehouse / Gudang', labelEn: 'Multi Outlet: Warehouse', path: '/dashboard/multi-outlet/gudang', visible: true },
      { id: 'all_shift_kasir', labelId: 'Shift: End Shift (Kasir)', labelEn: 'Shift: End Shift (Cashier)', path: '/dashboard/shift/kasir', visible: true },
      { id: 'all_shift_kas_masuk', labelId: 'Shift: Kas Masuk', labelEn: 'Shift: Cash In', path: '/dashboard/shift/kas-masuk', visible: true },
      { id: 'all_shift_kas_keluar', labelId: 'Shift: Kas Keluar', labelEn: 'Shift: Cash Out', path: '/dashboard/shift/kas-keluar', visible: true },
      { id: 'all_shift_riwayat', labelId: 'Shift: Riwayat Shift', labelEn: 'Shift: Shift History', path: '/dashboard/shift/riwayat', visible: true },

      // 4. Sub-Laporan Penjualan & Kas (23 Halaman Laporan)
      { id: 'all_lap_produk_all', labelId: 'Laporan: Keseluruhan Produk', labelEn: 'Report: Overall Products', path: '/dashboard/laporankas/produk_keseluruhan', visible: true },
      { id: 'all_lap_produk_masuk', labelId: 'Laporan: Rincian Produk Masuk', labelEn: 'Report: Product Inflow', path: '/dashboard/laporankas/produk_masuk', visible: true },
      { id: 'all_lap_produk_keluar', labelId: 'Laporan: Rincian Produk Keluar', labelEn: 'Report: Product Outflow', path: '/dashboard/laporankas/produk_keluar', visible: true },
      { id: 'all_lap_keseluruhan', labelId: 'Laporan: Keseluruhan Penjualan', labelEn: 'Report: Overall Sales', path: '/dashboard/laporankas/keseluruhan', visible: true },
      { id: 'all_lap_rincian', labelId: 'Laporan: Rincian Penjualan', labelEn: 'Report: Sales Breakdown', path: '/dashboard/laporankas/rincian', visible: true },
      { id: 'all_lap_backdate', labelId: 'Laporan: Penjualan Backdate', labelEn: 'Report: Backdated Sales', path: '/dashboard/laporankas/backdate', visible: true },
      { id: 'all_lap_online_order', labelId: 'Laporan: Penjualan Online Order', labelEn: 'Report: Online Order Sales', path: '/dashboard/laporankas/online_order', visible: true },
      { id: 'all_lap_pending_pos', labelId: 'Laporan: Pending POS', labelEn: 'Report: Pending POS Sales', path: '/dashboard/laporankas/pending_pos', visible: true },
      { id: 'all_lap_hourly', labelId: 'Laporan: Penjualan per Jam', labelEn: 'Report: Hourly Sales', path: '/dashboard/laporankas/hourly', visible: true },
      { id: 'all_lap_item_date', labelId: 'Laporan: Item per Tanggal', labelEn: 'Report: Items by Date', path: '/dashboard/laporankas/item_date', visible: true },
      { id: 'all_lap_item_brand', labelId: 'Laporan: Item per Brand', labelEn: 'Report: Items by Brand', path: '/dashboard/laporankas/item_brand', visible: true },
      { id: 'all_lap_item_kategori', labelId: 'Laporan: Item per Kategori', labelEn: 'Report: Items by Category', path: '/dashboard/laporankas/item_kategori', visible: true },
      { id: 'all_lap_petugas', labelId: 'Laporan: Penjualan per Kasir', labelEn: 'Report: Sales by Cashier', path: '/dashboard/laporankas/petugas', visible: true },
      { id: 'all_lap_pelanggan', labelId: 'Laporan: Penjualan per Pelanggan', labelEn: 'Report: Sales by Customer', path: '/dashboard/laporankas/pelanggan', visible: true },
      { id: 'all_lap_loyalty', labelId: 'Laporan: Loyalty Point', labelEn: 'Report: Loyalty Points', path: '/dashboard/laporankas/loyalty_point', visible: true },
      { id: 'all_lap_diskon', labelId: 'Laporan: Ringkasan Diskon & Promo', labelEn: 'Report: Discounts & Promos', path: '/dashboard/laporankas/diskon', visible: true },
      { id: 'all_lap_pengeluaran', labelId: 'Laporan: Pengeluaran per Tanggal', labelEn: 'Report: Expenses by Date', path: '/dashboard/laporankas/pengeluaran', visible: true },
      { id: 'all_lap_arus_kas', labelId: 'Laporan: Arus Kas & Rekonsiliasi', labelEn: 'Report: Cash Flow & Reconciliation', path: '/dashboard/laporankas/arus_kas', visible: true },
      { id: 'all_lap_laba_rugi', labelId: 'Laporan: Laba / Rugi & Margin', labelEn: 'Report: Profit / Loss & Margin', path: '/dashboard/laporankas/laba_rugi', visible: true },
      { id: 'all_lap_pembatalan', labelId: 'Laporan: Pembatalan / Void & Retur', labelEn: 'Report: Voids & Returns', path: '/dashboard/laporankas/pembatalan', visible: true },
      { id: 'all_lap_kas_selisih', labelId: 'Laporan: Kas Selisih Kasir', labelEn: 'Report: Cashier Discrepancy', path: '/dashboard/laporankas/kas_selisih', visible: true },

      // 5. Produk, Karton, Bundling, Diskon & Sub-Tab Stok Produk
      { id: 'all_produk_list', labelId: 'Produk: List Katalog Produk', labelEn: 'Products: Product Catalog', path: '/dashboard/produk', visible: true },
      { id: 'all_produk_tambah', labelId: 'Produk: + Tambah Produk Baru', labelEn: 'Products: + Add New Product', path: '/dashboard/produk/tambah', visible: true },
      { id: 'all_produk_log', labelId: 'Produk: Produk Log (Audit)', labelEn: 'Products: Product Log', path: '/dashboard/produk-log', visible: true },
      { id: 'all_produk_paket', labelId: 'Produk: Paket Produk (Bundles)', labelEn: 'Products: Product Bundles', path: '/dashboard/paket-produk', visible: true },
      { id: 'all_produk_paket_tambah', labelId: 'Produk: + Tambah Paket Produk', labelEn: 'Products: + Add Bundle', path: '/dashboard/paket-produk/tambah', visible: true },
      { id: 'all_produk_kategori', labelId: 'Produk: Kategori & Brand', labelEn: 'Products: Categories & Brands', path: '/dashboard/kategori-produk', visible: true },
      { id: 'all_produk_kategori_tambah', labelId: 'Produk: + Tambah Kategori', labelEn: 'Products: + Add Category', path: '/dashboard/kategori-produk/tambah', visible: true },
      { id: 'all_produk_diskon', labelId: 'Produk: Harga Diskon & Grosir', labelEn: 'Products: Discounts & Tier Pricing', path: '/dashboard/harga-diskon', visible: true },
      { id: 'all_produk_diskon_tambah', labelId: 'Produk: + Tambah Harga Diskon', labelEn: 'Products: + Add Discount Rule', path: '/dashboard/harga-diskon/tambah', visible: true },
      { id: 'all_produk_stok_masuk', labelId: 'Produk: Tab Stok Masuk', labelEn: 'Products: Stock Inflow Tab', path: '/dashboard/produk/stok-masuk', visible: true },
      { id: 'all_produk_stok_keluar', labelId: 'Produk: Tab Stok Keluar', labelEn: 'Products: Stock Outflow Tab', path: '/dashboard/produk/stok-keluar', visible: true },
      { id: 'all_produk_opname', labelId: 'Produk: Tab Stok Opname', labelEn: 'Products: Stock Opname Tab', path: '/dashboard/produk/opname', visible: true },
      { id: 'all_produk_pergerakan', labelId: 'Produk: Tab Pergerakan Stok', labelEn: 'Products: Stock Movements Tab', path: '/dashboard/produk/pergerakan', visible: true },
      { id: 'all_produk_kritis', labelId: 'Produk: Tab Stok Kritis', labelEn: 'Products: Critical Stock Tab', path: '/dashboard/produk/kritis', visible: true },

      // 6. Pembelian & Pengadaan Produk
      { id: 'all_beli_supplier', labelId: 'Pembelian: Daftar Supplier', labelEn: 'Procurement: Supplier Directory', path: '/dashboard/pembelian/daftar-supplier', visible: true },
      { id: 'all_beli_po', labelId: 'Pembelian: Daftar Pembelian (PO)', labelEn: 'Procurement: Purchase Orders', path: '/dashboard/pembelian/daftar-pembelian', visible: true },
      { id: 'all_beli_request', labelId: 'Pembelian: Request Pembelian', labelEn: 'Procurement: Purchase Requests', path: '/dashboard/pembelian/request-pembelian', visible: true },
      { id: 'all_beli_produk', labelId: 'Pembelian: Pembelian Produk', labelEn: 'Procurement: Stock Procurement', path: '/dashboard/pembelian/pembelian-produk', visible: true },
      { id: 'all_beli_statistik', labelId: 'Pembelian: Statistik Pembelian', labelEn: 'Procurement: Analytics', path: '/dashboard/pembelian/statistik', visible: true },

      // 7. Transaksi POS & Semua Status Orders (Wharf)
      { id: 'all_orders_all', labelId: 'Orders (Wharf): Semua Pesanan', labelEn: 'Orders (Wharf): All Orders', path: '/dashboard/orders', badge: 'WHARF', visible: true },
      { id: 'all_orders_tambah', labelId: 'Orders (Wharf): + Tambah Pesanan', labelEn: 'Orders (Wharf): + Add Order', path: '/dashboard/orders/tambah', visible: true },
      { id: 'all_orders_new', labelId: 'Orders (Wharf): Pesanan Baru', labelEn: 'Orders (Wharf): New / Pending', path: '/dashboard/orders/new', visible: true },
      { id: 'all_orders_verified', labelId: 'Orders (Wharf): Terverifikasi', labelEn: 'Orders (Wharf): Verified', path: '/dashboard/orders/verified', visible: true },
      { id: 'all_orders_packing', labelId: 'Orders (Wharf): Sedang Diproses', labelEn: 'Orders (Wharf): Packing', path: '/dashboard/orders/packing', visible: true },
      { id: 'all_orders_ready', labelId: 'Orders (Wharf): Siap Dikirim', labelEn: 'Orders (Wharf): Ready', path: '/dashboard/orders/ready', visible: true },
      { id: 'all_orders_shipped', labelId: 'Orders (Wharf): Sedang Dikirim', labelEn: 'Orders (Wharf): Shipped', path: '/dashboard/orders/shipped', visible: true },
      { id: 'all_orders_delivered', labelId: 'Orders (Wharf): Terkirim', labelEn: 'Orders (Wharf): Delivered', path: '/dashboard/orders/delivered', visible: true },
      { id: 'all_orders_completed', labelId: 'Orders (Wharf): Selesai', labelEn: 'Orders (Wharf): Completed', path: '/dashboard/orders/completed', visible: true },
      { id: 'all_orders_returned', labelId: 'Orders (Wharf): Retur', labelEn: 'Orders (Wharf): Returned', path: '/dashboard/orders/returned', visible: true },
      { id: 'all_orders_rejected', labelId: 'Orders (Wharf): Ditolak / Batal', labelEn: 'Orders (Wharf): Rejected', path: '/dashboard/orders/rejected', visible: true },
      { id: 'all_pos_penjualan', labelId: 'Transaksi POS: Penjualan', labelEn: 'POS Transactions: Sales', path: '/dashboard/transaksi-pos/penjualan', visible: true },
      { id: 'all_pos_pendapatan', labelId: 'Transaksi POS: Pendapatan Masuk', labelEn: 'POS Transactions: Revenue In', path: '/dashboard/transaksi-pos/pendapatan-masuk', visible: true },
      { id: 'all_pos_pengeluaran', labelId: 'Transaksi POS: Pengeluaran Toko', labelEn: 'POS Transactions: Store Expenses', path: '/dashboard/transaksi-pos/pengeluaran-toko', visible: true },

      // 8. Lacak Inventory
      { id: 'all_inv_overview', labelId: 'Inventory: Ringkasan Inventory', labelEn: 'Inventory: Overview', path: '/dashboard/inventory', visible: true },
      { id: 'all_inv_kartu_stok', labelId: 'Inventory: Kartu Stok', labelEn: 'Inventory: Stock Card', path: '/dashboard/inventory/kartu-stok', visible: true },
      { id: 'all_inv_stok_min', labelId: 'Inventory: Stok Minimum', labelEn: 'Inventory: Minimum Stock', path: '/dashboard/inventory/stok-minimum', visible: true },
      { id: 'all_inv_stok_opname', labelId: 'Inventory: Stok Opname', labelEn: 'Inventory: Stock Opname', path: '/dashboard/inventory/stok-opname', visible: true },
      { id: 'all_inv_restock', labelId: 'Inventory: Produk Restock', labelEn: 'Inventory: Restock Planning', path: '/dashboard/inventory/produk-restock', visible: true },

      // 9. Pelanggan & Marketing
      { id: 'all_pel_daftar', labelId: 'Pelanggan: Daftar Pelanggan', labelEn: 'Customers: Directory', path: '/dashboard/pelanggan', visible: true },
      { id: 'all_pel_tambah', labelId: 'Pelanggan: + Tambah Pelanggan', labelEn: 'Customers: + Add Customer', path: '/dashboard/pelanggan/tambah', visible: true },
      { id: 'all_pel_tipe', labelId: 'Pelanggan: Tipe Pelanggan', labelEn: 'Customers: Tiers & Roles', path: '/dashboard/pelanggan/tipe', visible: true },
      { id: 'all_pel_hutang', labelId: 'Pelanggan: Hutang Pelanggan', labelEn: 'Customers: Credit / Receivables', path: '/dashboard/pelanggan/hutang', visible: true },
      { id: 'all_pel_poin', labelId: 'Pelanggan: Poin Pelanggan', labelEn: 'Customers: Loyalty Points', path: '/dashboard/pelanggan/poin', visible: true },
      { id: 'all_pel_langganan', labelId: 'Pelanggan: Langganan', labelEn: 'Customers: Subscriptions', path: '/dashboard/pelanggan/langganan', visible: true },
      { id: 'all_pel_claim', labelId: 'Pelanggan: Claim Hadiah', labelEn: 'Customers: Rewards Claim', path: '/dashboard/pelanggan/claim-hadiah', visible: true },
      { id: 'all_mkt_target', labelId: 'Marketing: Hadiah Target', labelEn: 'Marketing: Target Rewards', path: '/dashboard/marketing/hadiah-target', visible: true },
      { id: 'all_mkt_info', labelId: 'Marketing: Informasi & Hadiah', labelEn: 'Marketing: Gift & Reward Info', path: '/dashboard/marketing/informasi-hadiah', visible: true },
      { id: 'all_mkt_voucher', labelId: 'Marketing: Voucher dan Promo', labelEn: 'Marketing: Vouchers & Promos', path: '/dashboard/marketing/voucher-promo', visible: true },
      { id: 'all_mkt_poin', labelId: 'Marketing: Setting Poin POS', labelEn: 'Marketing: POS Point Rules', path: '/dashboard/marketing/setting-poin', visible: true },
      { id: 'all_mkt_poin_pwa', labelId: 'Marketing: Setting Poin PWA', labelEn: 'Marketing: PWA Point Rules', path: '/dashboard/marketing/setting-poin-pwa', visible: true },
      { id: 'all_mkt_statistik', labelId: 'Marketing: Statistik Marketing', labelEn: 'Marketing: Campaign Analytics', path: '/dashboard/marketing/statistik', visible: true },

      // 10. Staff, Keuangan & Brangkas
      { id: 'all_staff_daftar', labelId: 'Staff: Daftar Staff', labelEn: 'Staff: Staff Directory', path: '/dashboard/staff', visible: true },
      { id: 'all_staff_role', labelId: 'Staff: Role / Jabatan', labelEn: 'Staff: Roles & Positions', path: '/dashboard/staff/role-jabatan', visible: true },
      { id: 'all_staff_otoritas', labelId: 'Staff: Otoritas Akses (RBAC)', labelEn: 'Staff: Access Authority', path: '/dashboard/staff/otoritas-akses', visible: true },
      { id: 'all_staff_kpi', labelId: 'Staff: KPI Staff', labelEn: 'Staff: Staff KPI', path: '/dashboard/staff/kpi', visible: true },
      { id: 'all_staff_ai_job', labelId: 'Staff: AI Setting Job Staff', labelEn: 'Staff: AI Job Setup', path: '/dashboard/staff/ai-job', visible: true },
      { id: 'all_keu_toko', labelId: 'Keuangan: Brangkas Toko', labelEn: 'Finance: Store Cash Vault', path: '/dashboard/keuangan/brangkas-toko', visible: true },
      { id: 'all_keu_modal', labelId: 'Keuangan: Brangkas Modal', labelEn: 'Finance: Capital Vault', path: '/dashboard/keuangan/brangkas-modal', visible: true },
      { id: 'all_keu_untung', labelId: 'Keuangan: Brangkas Untung', labelEn: 'Finance: Net Profit Vault', path: '/dashboard/keuangan/brangkas-untung', visible: true },
      { id: 'all_keu_tipe', labelId: 'Keuangan: Type Keuangan / Jurnal', labelEn: 'Finance: Journal Types', path: '/dashboard/keuangan/tipe-keuangan', visible: true },
      { id: 'all_keu_riwayat', labelId: 'Keuangan: Riwayat Keuangan', labelEn: 'Finance: Financial History', path: '/dashboard/keuangan/riwayat', visible: true },

      // 11. Online Order, Pengaturan PWA, Pengaturan POS & Payment
      { id: 'all_online_website', labelId: 'Online Order: Website Setting', labelEn: 'Online Order: Website Setup', path: '/dashboard/online-order/website', visible: true },
      { id: 'all_online_pwa', labelId: 'Online Order: Client PWA Setting', labelEn: 'Online Order: Client PWA Setup', path: '/dashboard/online-order/client-pwa', visible: true },
      { id: 'all_pwaset_umum', labelId: 'Pengaturan PWA: Umum & Beranda', labelEn: 'PWA Settings: General & Home', path: '/dashboard/pengaturan-pwa/umum', visible: true },
      { id: 'all_pwaset_login', labelId: 'Pengaturan PWA: Login WA & PIN', labelEn: 'PWA Settings: WA & PIN Login', path: '/dashboard/pengaturan-pwa/login', visible: true },
      { id: 'all_pwaset_order', labelId: 'Pengaturan PWA: Order Pelanggan', labelEn: 'PWA Settings: Customer Order', path: '/dashboard/pengaturan-pwa/order-pelanggan', visible: true },
      { id: 'all_pwaset_bayar', labelId: 'Pengaturan PWA: Pembayaran PWA', labelEn: 'PWA Settings: Payment Methods', path: '/dashboard/pengaturan-pwa/pembayaran', visible: true },
      { id: 'all_pwaset_notif', labelId: 'Pengaturan PWA: Notifikasi & WA', labelEn: 'PWA Settings: Notifications', path: '/dashboard/pengaturan-pwa/notifikasi', visible: true },
      { id: 'all_pwaset_profile', labelId: 'Pengaturan PWA: Menu Profile & Tier', labelEn: 'PWA Settings: Profile & Tiers', path: '/dashboard/pengaturan-pwa/profile', visible: true },
      { id: 'all_pwaset_target', labelId: 'Pengaturan PWA: Hadiah Target', labelEn: 'PWA Settings: Target Milestones', path: '/dashboard/pengaturan-pwa/target', visible: true },
      { id: 'all_pwaset_voucher', labelId: 'Pengaturan PWA: Katalog Voucher', labelEn: 'PWA Settings: Voucher Catalog', path: '/dashboard/pengaturan-pwa/voucher', visible: true },
      { id: 'all_pwaset_reward', labelId: 'Pengaturan PWA: Reward & Poin', labelEn: 'PWA Settings: Rewards & Points', path: '/dashboard/pengaturan-pwa/reward', visible: true },
      { id: 'all_pwaset_topbuyer', labelId: 'Pengaturan PWA: Top 10 Buyer', labelEn: 'PWA Settings: Top 10 Buyer', path: '/dashboard/pengaturan-pwa/top-buyer', visible: true },
      { id: 'all_pwaset_info', labelId: 'Pengaturan PWA: Informasi & Kurir', labelEn: 'PWA Settings: Info & Courier', path: '/dashboard/pengaturan-pwa/informasi', visible: true },
      { id: 'all_pwaset_faq', labelId: 'Pengaturan PWA: FAQ & Chat Admin', labelEn: 'PWA Settings: FAQ & Admin Chat', path: '/dashboard/pengaturan-pwa/faq', visible: true },
      { id: 'all_pwaset_akses', labelId: 'Pengaturan PWA: Hak dan Akses', labelEn: 'PWA Settings: Access Rights', path: '/dashboard/pengaturan-pwa/hak-akses', visible: true },
      { id: 'all_posset_menu', labelId: 'Pengaturan POS: Menu Builder (WP)', labelEn: 'POS Settings: Menu Builder', path: '/dashboard/pengaturan-pos/menu', visible: true },
      { id: 'all_posset_umum', labelId: 'Pengaturan POS: Umum', labelEn: 'POS Settings: General', path: '/dashboard/pengaturan-pos/umum', visible: true },
      { id: 'all_posset_toko', labelId: 'Pengaturan POS: Profil Toko', labelEn: 'POS Settings: Store Profile', path: '/dashboard/pengaturan-pos/toko', visible: true },
      { id: 'all_posset_bayar', labelId: 'Pengaturan POS: Pembayaran', labelEn: 'POS Settings: Payment Methods', path: '/dashboard/pengaturan-pos/pembayaran', visible: true },
      { id: 'all_posset_printer', labelId: 'Pengaturan POS: Printer Struk', labelEn: 'POS Settings: Receipt Printer', path: '/dashboard/pengaturan-pos/printer-struk', visible: true },
      { id: 'all_posset_global', labelId: 'Pengaturan POS: Global Setup', labelEn: 'POS Settings: Global Setup', path: '/dashboard/pengaturan-pos/global-setup', visible: true },
      { id: 'all_posset_akses', labelId: 'Pengaturan POS: Hak dan Akses', labelEn: 'POS Settings: Access Rights', path: '/dashboard/pengaturan-pos/hak-akses', visible: true },
      { id: 'all_posset_backup', labelId: 'Pengaturan POS: Backup & Restore', labelEn: 'POS Settings: Backup & Restore', path: '/dashboard/pengaturan-pos/backup-restore', visible: true },
      { id: 'all_posset_gateway', labelId: 'Pengaturan POS: Payment Gateway', labelEn: 'POS Settings: Payment Gateway', path: '/dashboard/pengaturan-pos/payment-gateway', visible: true },
      { id: 'all_posset_audit', labelId: 'Pengaturan POS: Security Audit Log', labelEn: 'POS Settings: Security Audit Log', path: '/dashboard/pengaturan-pos/audit-log', visible: true },
      { id: 'all_pay_xendit', labelId: 'Payment: Xendit Gateway', labelEn: 'Payment: Xendit Gateway', path: '/dashboard/payment/xendit', visible: true },
      { id: 'all_pay_doku', labelId: 'Payment: Doku Gateway', labelEn: 'Payment: Doku Gateway', path: '/dashboard/payment/doku', visible: true },
      { id: 'all_pay_midtrans', labelId: 'Payment: Midtrans Gateway', labelEn: 'Payment: Midtrans Gateway', path: '/dashboard/payment/midtrans', visible: true },

      // 12. Client PWA (Aplikasi Pelanggan Mandiri — 21 Layar/Halaman)
      { id: 'all_pwa_splash', labelId: 'Client PWA: Splash Screen', labelEn: 'Client PWA: Splash Screen', path: '/client-pwa', badge: 'PWA', visible: true },
      { id: 'all_pwa_guest', labelId: 'Client PWA: Beranda Tamu', labelEn: 'Client PWA: Guest Home', path: '/client-pwa/home-tamu', badge: 'PWA', visible: true },
      { id: 'all_pwa_login', labelId: 'Client PWA: Login Member', labelEn: 'Client PWA: Member Login', path: '/client-pwa/login', badge: 'PWA', visible: true },
      { id: 'all_pwa_register', labelId: 'Client PWA: Daftar Member Baru', labelEn: 'Client PWA: Member Registration', path: '/client-pwa/daftar-member', badge: 'PWA', visible: true },
      { id: 'all_pwa_address', labelId: 'Client PWA: Setting Alamat & GPS', labelEn: 'Client PWA: Address & GPS Setup', path: '/client-pwa/alamat-gps', badge: 'PWA', visible: true },
      { id: 'all_pwa_verify_wa', labelId: 'Client PWA: Verifikasi WA OTP', labelEn: 'Client PWA: WhatsApp OTP Verify', path: '/client-pwa/verifikasi-wa', badge: 'PWA', visible: true },
      { id: 'all_pwa_clienthome', labelId: 'Client PWA: Beranda Member (Katalog)', labelEn: 'Client PWA: Member Home Catalog', path: '/client-pwa/clienthome', badge: 'PWA', visible: true },
      { id: 'all_pwa_cart', labelId: 'Client PWA: Keranjang Belanja', labelEn: 'Client PWA: Shopping Cart', path: '/client-pwa/keranjang', badge: 'PWA', visible: true },
      { id: 'all_pwa_history', labelId: 'Client PWA: Riwayat & Lacak Pesanan', labelEn: 'Client PWA: Order History & Tracker', path: '/client-pwa/riwayat', badge: 'PWA', visible: true },
      { id: 'all_pwa_profile', labelId: 'Client PWA: Menu Profil Utama', labelEn: 'Client PWA: Profile Main Menu', path: '/client-pwa/profile', badge: 'PWA', visible: true },
      { id: 'all_pwa_prof_akun', labelId: 'Client PWA Profil: Akun Saya', labelEn: 'Client PWA Profile: My Account', path: '/client-pwa/profile/akun', badge: 'PWA', visible: true },
      { id: 'all_pwa_prof_stat', labelId: 'Client PWA Profil: Statistik Belanja', labelEn: 'Client PWA Profile: Shopping Stats', path: '/client-pwa/profile/statistik', badge: 'PWA', visible: true },
      { id: 'all_pwa_prof_alamat', labelId: 'Client PWA Profil: Alamat GPS', labelEn: 'Client PWA Profile: GPS Addresses', path: '/client-pwa/profile/alamat', badge: 'PWA', visible: true },
      { id: 'all_pwa_prof_target', labelId: 'Client PWA Profil: Hadiah Target', labelEn: 'Client PWA Profile: Target Rewards', path: '/client-pwa/profile/target', badge: 'PWA', visible: true },
      { id: 'all_pwa_prof_voucher', labelId: 'Client PWA Profil: Katalog Voucher', labelEn: 'Client PWA Profile: Vouchers', path: '/client-pwa/profile/voucher', badge: 'PWA', visible: true },
      { id: 'all_pwa_prof_reward', labelId: 'Client PWA Profil: Tukar Poin & Reward', labelEn: 'Client PWA Profile: Redeem Points', path: '/client-pwa/profile/reward', badge: 'PWA', visible: true },
      { id: 'all_pwa_prof_topbuyer', labelId: 'Client PWA Profil: Top 10 Buyer', labelEn: 'Client PWA Profile: Top 10 Buyers', path: '/client-pwa/profile/top-buyer', badge: 'PWA', visible: true },
      { id: 'all_pwa_prof_info', labelId: 'Client PWA Profil: Informasi & Kurir', labelEn: 'Client PWA Profile: Store & Courier Info', path: '/client-pwa/profile/informasi', badge: 'PWA', visible: true },
      { id: 'all_pwa_prof_chat', labelId: 'Client PWA Profil: Chat Admin Toko', labelEn: 'Client PWA Profile: Chat Store Admin', path: '/client-pwa/profile/chat-admin', badge: 'PWA', visible: true },
      { id: 'all_pwa_prof_faq', labelId: 'Client PWA Profil: Bantuan & FAQ', labelEn: 'Client PWA Profile: Help & FAQ', path: '/client-pwa/profile/faq', badge: 'PWA', visible: true },
      { id: 'all_pwa_prof_setting', labelId: 'Client PWA Profil: Pengaturan', labelEn: 'Client PWA Profile: App Settings', path: '/client-pwa/profile/pengaturan', badge: 'PWA', visible: true },
    ],
  },
];

/**
 * Creates default canonical structure.
 */
export function createDefaultStructure(): SidebarMenuStructure {
  const groupsOrder = DEFAULT_SIDEBAR_MENU.map((g) => g.id);
  const groupVisible: Record<string, boolean> = {};
  const groupCustomLabels: Record<string, string> = {};
  const childrenOrderByGroup: Record<string, string[]> = {};
  const childrenVisible: Record<string, boolean> = {};
  const childrenCustomLabels: Record<string, string> = {};

  for (const group of DEFAULT_SIDEBAR_MENU) {
    groupVisible[group.id] = group.visible;
    childrenOrderByGroup[group.id] = group.children.map((c) => c.id);
    for (const child of group.children) {
      childrenVisible[child.id] = child.visible;
    }
  }

  const base: SidebarMenuStructure = {
    groupsOrder,
    groupVisible,
    groupCustomLabels,
    childrenOrderByGroup,
    childrenVisible,
    childrenCustomLabels,
    updatedAt: new Date().toISOString(),
  };

  return applyFocusMenuRemoval(base).structure;
}

/**
 * Permanently removes the 8th visible submenu item inside the 1st visible menu group
 * targeted via Focus Mode selector.
 */
export function applyFocusMenuRemoval(structure: SidebarMenuStructure): {
  structure: SidebarMenuStructure;
  changed: boolean;
} {
  if (structure.focusRemovedG1C8) {
    return { structure, changed: false };
  }

  const resolved = buildResolvedMenuCore(structure);
  const tableDineInEnabled = (() => {
    try {
      return typeof window !== 'undefined'
        ? localStorage.getItem('riskcart_table_dine_in_enabled') !== 'false'
        : true;
    } catch {
      return true;
    }
  })();
  const kitchenEnabled = (() => {
    try {
      return typeof window !== 'undefined'
        ? localStorage.getItem('riskcart_kitchen_enabled') !== 'false'
        : true;
    } catch {
      return true;
    }
  })();

  const isTableDineInItem = (child: MenuItemConfig): boolean => {
    const cid = String(child.id || '').toLowerCase();
    const cpath = String(child.path || '').toLowerCase();
    return (
      cid === 'layout_table' ||
      cid === 'beranda_layout_table' ||
      cid === 'table_layout' ||
      cid === 'waiters' ||
      cpath.includes('/layout-table') ||
      cpath.includes('/waiters')
    );
  };

  const isKitchenItem = (child: MenuItemConfig): boolean => {
    const cid = String(child.id || '').toLowerCase();
    const cpath = String(child.path || '').toLowerCase();
    return (
      cid === 'kitchen' ||
      cid === 'kitchen_display' ||
      cid === 'dapur' ||
      cpath.includes('/kitchen')
    );
  };

  const visibleGroups = resolved.filter((g) => g.visible !== false);
  const firstGroup = visibleGroups[0];
  if (!firstGroup) {
    return {
      structure: { ...structure, focusRemovedG1C8: true },
      changed: true,
    };
  }

  const visibleChildren = (firstGroup.children || []).filter((child) => {
    if (child.visible === false) return false;
    if (!tableDineInEnabled && isTableDineInItem(child)) return false;
    if (!kitchenEnabled && isKitchenItem(child)) return false;
    return true;
  });

  const targetChild = visibleChildren[7];
  if (!targetChild) {
    return {
      structure: { ...structure, focusRemovedG1C8: true },
      changed: true,
    };
  }

  const targetId = targetChild.id;
  const gid = firstGroup.id;

  const nextChildrenVisible: Record<string, boolean> = {
    ...(structure.childrenVisible || {}),
    [targetId]: false,
  };

  const currentGroupOrder = Array.isArray(structure.childrenOrderByGroup?.[gid])
    ? structure.childrenOrderByGroup[gid]
    : firstGroup.children.map((c) => c.id);

  const nextChildrenOrderByGroup: Record<string, string[]> = {
    ...(structure.childrenOrderByGroup || {}),
    [gid]: currentGroupOrder.filter((id) => id !== targetId),
  };

  const nextCustomMenuItems: Record<string, MenuItemConfig[]> = {
    ...(structure.customMenuItems || {}),
  };
  if (Array.isArray(nextCustomMenuItems[gid])) {
    nextCustomMenuItems[gid] = nextCustomMenuItems[gid].filter((item) => item.id !== targetId);
  }

  const nextStructure: SidebarMenuStructure = {
    ...structure,
    childrenVisible: nextChildrenVisible,
    childrenOrderByGroup: nextChildrenOrderByGroup,
    customMenuItems: nextCustomMenuItems,
    focusRemovedG1C8: true,
    focusRemovedItemId: targetId,
  };

  return { structure: nextStructure, changed: true };
}

/**
 * Reads local cached structure or returns default.
 */
export function getLocalMenuStructure(): SidebarMenuStructure {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.groupsOrder) && parsed.groupsOrder.length > 0) {
        const { structure: migrated, changed } = applyFocusMenuRemoval(parsed);
        if (changed) {
          try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(migrated));
          } catch {}
        }
        return migrated;
      }
    }
  } catch (e) {
    console.warn('Failed to parse local sidebar menu structure:', e);
  }
  return createDefaultStructure();
}

/**
 * Applies a SidebarMenuStructure to the default menu template, returning ordered and filtered MenuGroupConfig[].
 */
export function buildResolvedMenu(structure: SidebarMenuStructure): MenuGroupConfig[] {
  const { structure: effectiveStructure } = applyFocusMenuRemoval(structure);
  return buildResolvedMenuCore(effectiveStructure);
}

function buildResolvedMenuCore(structure: SidebarMenuStructure): MenuGroupConfig[] {
  const defaultMap = new Map<string, MenuGroupConfig>();
  const groupDefaultChildMap = new Map<string, Map<string, MenuItemConfig>>();
  const globalChildMap = new Map<string, MenuItemConfig>();

  for (const g of DEFAULT_SIDEBAR_MENU) {
    defaultMap.set(g.id, g);
    const cMap = new Map<string, MenuItemConfig>();
    for (const c of g.children) {
      cMap.set(c.id, c);
      if (!globalChildMap.has(c.id)) {
        globalChildMap.set(c.id, c);
      }
    }
    groupDefaultChildMap.set(g.id, cMap);
  }

  if (structure.customMenuItems) {
    for (const items of Object.values(structure.customMenuItems)) {
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item && item.id) {
            globalChildMap.set(item.id, item);
          }
        }
      }
    }
  }

  // Track items that have been moved into a group where they are not default children
  const movedToGroupMap = new Map<string, string>();
  if (structure.childrenOrderByGroup) {
    for (const [gid, rawOrder] of Object.entries(structure.childrenOrderByGroup)) {
      if (!Array.isArray(rawOrder)) continue;
      const defaultChildrenOfGid = groupDefaultChildMap.get(gid);
      for (const rawCid of rawOrder) {
        const cid = String(rawCid).replace(/bangkas/gi, 'brangkas');
        if (!defaultChildrenOfGid?.has(cid)) {
          movedToGroupMap.set(cid, gid);
        }
      }
    }
  }

  const result: MenuGroupConfig[] = [];
  const visited = new Set<string>();

  // 1. Process groups in configured order
  const orderList = Array.isArray(structure.groupsOrder) && structure.groupsOrder.length > 0
    ? structure.groupsOrder
    : DEFAULT_SIDEBAR_MENU.map((g) => g.id);

  for (const gid of orderList) {
    const defaultGroup = defaultMap.get(gid);
    if (!defaultGroup) continue;
    visited.add(gid);

    const isGroupVis = structure.groupVisible?.[gid] !== false;
    const rawGroupCustom = structure.groupCustomLabels?.[gid];
    const sanitizedGroupCustom = rawGroupCustom
      ? applyPosIndonesianGlossaryFixes(
          rawGroupCustom
            .replace(/(\bkasir\b)(?:\s+\1)+/gi, '$1')
            .replace(/(\(kasir\))(?:\s+\1)+/gi, '$1')
            .replace(/BANGKAS/g, 'BRANKAS')
            .replace(/Bangkas/g, 'Brankas')
            .replace(/bangkas/g, 'brankas')
        ).trim()
      : undefined;
    const customGroupLabel =
      sanitizedGroupCustom &&
      sanitizedGroupCustom.toUpperCase() !== defaultGroup.labelId.toUpperCase()
        ? sanitizedGroupCustom
        : undefined;

    // Combine default children and any AI-generated custom children for this group
    const groupCustomItems = Array.isArray(structure.customMenuItems?.[gid])
      ? structure.customMenuItems![gid]
      : [];
    const combinedSourceChildren: MenuItemConfig[] = [...defaultGroup.children];
    for (const customChild of groupCustomItems) {
      if (!combinedSourceChildren.some((c) => c.id === customChild.id)) {
        combinedSourceChildren.push(customChild);
      }
    }

    // Order children (normalize any legacy child IDs in keuangan)
    const hasSavedOrderForGroup = Array.isArray(structure.childrenOrderByGroup?.[gid]);
    const rawChildOrder = hasSavedOrderForGroup
      ? structure.childrenOrderByGroup[gid]
      : combinedSourceChildren.map((c) => c.id);
    const childOrder = rawChildOrder.map((cid) =>
      String(cid).replace(/bangkas/gi, 'brangkas')
    );
    const childMap = new Map<string, MenuItemConfig>();
    for (const c of combinedSourceChildren) {
      childMap.set(c.id, c);
    }

    const resolvedChildren: MenuItemConfig[] = [];
    const visitedChildren = new Set<string>();

    for (const cid of childOrder) {
      if (visitedChildren.has(cid)) continue;
      // Look up in current group's map first, then fall back to globalChildMap (for cross-group moved items)
      const defaultChild = childMap.get(cid) || globalChildMap.get(cid);
      if (!defaultChild) continue;
      visitedChildren.add(cid);

      const isChildVis = structure.childrenVisible?.[cid] !== false;
      const rawChildCustom =
        structure.childrenCustomLabels?.[`${gid}:${cid}`] ||
        structure.childrenCustomLabels?.[cid];
      const customChildLabel = rawChildCustom
        ? applyPosIndonesianGlossaryFixes(
            rawChildCustom
              .replace(/(\bkasir\b)(?:\s+\1)+/gi, '$1')
              .replace(/(\(kasir\))(?:\s+\1)+/gi, '$1')
              .replace(/BANGKAS/g, 'BRANKAS')
              .replace(/Bangkas/g, 'Brankas')
              .replace(/bangkas/g, 'brankas')
          )
        : undefined;

      resolvedChildren.push({
        ...defaultChild,
        visible: isChildVis,
        customLabel: customChildLabel,
      });
    }

    // Append any newly added children from default or custom that weren't in saved order
    // (unless they were moved to another group)
    for (const c of combinedSourceChildren) {
      if (!visitedChildren.has(c.id)) {
        // If this item was moved to another group and removed from this group's order, do not re-append it here
        if (
          movedToGroupMap.has(c.id) &&
          movedToGroupMap.get(c.id) !== gid &&
          (!hasSavedOrderForGroup || !childOrder.includes(c.id))
        ) {
          continue;
        }

        const rawChildCustom =
          structure.childrenCustomLabels?.[`${gid}:${c.id}`] ||
          structure.childrenCustomLabels?.[c.id];
        const newItem = {
          ...c,
          visible: structure.childrenVisible?.[c.id] !== false,
          customLabel: rawChildCustom
            ? applyPosIndonesianGlossaryFixes(
                rawChildCustom
                  .replace(/(\bkasir\b)(?:\s+\1)+/gi, '$1')
                  .replace(/(\(kasir\))(?:\s+\1)+/gi, '$1')
                  .replace(/BANGKAS/g, 'BRANKAS')
                  .replace(/Bangkas/g, 'Brankas')
                  .replace(/bangkas/g, 'brankas')
              )
            : undefined,
        };
        if (c.id === 'ai_architect') {
          resolvedChildren.unshift(newItem);
          continue;
        }
        if (c.id === 'myasset') {
          const adminIdx = resolvedChildren.findIndex((rc) => rc.id === 'admin');
          if (adminIdx !== -1) {
            resolvedChildren.splice(adminIdx + 1, 0, newItem);
            continue;
          }
        }
        if (c.id === 'laporancashflow') {
          const lapIdx = resolvedChildren.findIndex((rc) => rc.id === 'laporankas');
          if (lapIdx !== -1) {
            resolvedChildren.splice(lapIdx + 1, 0, newItem);
            continue;
          }
        }
        resolvedChildren.push(newItem);
      }
    }

    result.push({
      ...defaultGroup,
      visible: isGroupVis,
      customLabel: customGroupLabel,
      children: resolvedChildren,
    });
  }

  // 2. Append any missing groups from DEFAULT_SIDEBAR_MENU (inserting reservation_table right after dashboard and bahan_baku right after produk if missing from cached groupsOrder)
  for (const g of DEFAULT_SIDEBAR_MENU) {
    if (!visited.has(g.id)) {
      if (g.id === 'reservation_table') {
        const dashIdx = result.findIndex((rg) => rg.id === 'dashboard');
        if (dashIdx !== -1) {
          result.splice(dashIdx + 1, 0, g);
          continue;
        }
      }
      if (g.id === 'bahan_baku') {
        const prodIdx = result.findIndex((rg) => rg.id === 'produk');
        if (prodIdx !== -1) {
          result.splice(prodIdx + 1, 0, g);
          continue;
        }
      }
      result.push(g);
    }
  }

  // 3. Ensure 'semua_halaman' is always positioned at the very bottom
  const allPagesIdx = result.findIndex((g) => g.id === 'semua_halaman');
  if (allPagesIdx !== -1 && allPagesIdx !== result.length - 1) {
    const [allPagesGroup] = result.splice(allPagesIdx, 1);
    result.push(allPagesGroup);
  }

  return result;
}

/**
 * Persists menu structure to localStorage, dispatches real-time window event, and syncs to Firestore.
 */
export async function saveSidebarMenuStructure(structure: SidebarMenuStructure): Promise<void> {
  const payload: SidebarMenuStructure = {
    ...structure,
    updatedAt: new Date().toISOString(),
  };

  // 1. Instant local persistence
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('Failed to write to localStorage:', e);
  }

  // 2. Dispatch real-time custom event so Sidebar updates immediately without reload
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(MENU_UPDATED_EVENT, {
        detail: payload,
      })
    );
  }

  // 3. Persist to Firestore at global settings, sidebar_menus, and active store settings
  try {
    const cleanPayload = JSON.parse(JSON.stringify(payload));
    const docRefGlobal = doc(db, 'settings', 'sidebar_menu');
    await setDoc(docRefGlobal, cleanPayload, { merge: true });

    const docRefSidebarMenus = doc(db, 'sidebar_menus', 'main');
    await setDoc(docRefSidebarMenus, cleanPayload, { merge: true });

    if (ACTIVE_STORE_ID) {
      const docRefStore = doc(db, `stores/${ACTIVE_STORE_ID}/settings/sidebar_menu`);
      await setDoc(docRefStore, cleanPayload, { merge: true });
    }
  } catch (err) {
    console.warn('Firestore sidebar_menu sync warning:', err);
  }
}

/**
 * Resets menu structure to default in localStorage, fires event, and updates Firestore.
 */
export async function resetSidebarMenuStructure(): Promise<SidebarMenuStructure> {
  const def = createDefaultStructure();
  await saveSidebarMenuStructure(def);
  return def;
}

/**
 * Checks if sidebar_menus in Firestore is empty (e.g. due to a previous wipe)
 * and automatically restores the default or local menu structure to Firestore.
 */
export async function ensureSidebarMenuSeeded(): Promise<boolean> {
  try {
    const mainDoc = await getDoc(doc(db, 'sidebar_menus', 'main'));
    if (mainDoc.exists()) {
      const data = mainDoc.data();
      if (Array.isArray(data?.groupsOrder) && data.groupsOrder.length > 0) {
        return false;
      }
    }
    const snap = await getDocs(collection(db, 'sidebar_menus'));
    if (snap.empty) {
      const fallbackStructure = getLocalMenuStructure();
      await saveSidebarMenuStructure(fallbackStructure);
      return true;
    }
  } catch (err) {
    console.warn('ensureSidebarMenuSeeded warning:', err);
  }
  return false;
}

/**
 * Adds or updates an AI-generated Custom Page in SidebarMenuStructure and Firestore `custom_pages/{slug}`
 */
export async function saveAiCustomPageToMenu(
  currentStructure: SidebarMenuStructure,
  schema: AICustomPageSchema
): Promise<SidebarMenuStructure> {
  const groupId = schema.targetGroupId || 'dashboard';
  const menuItemId = schema.id || `custom_${schema.slug.replace(/-/g, '_')}`;
  const newMenuItem: MenuItemConfig = {
    id: menuItemId,
    labelId: schema.title,
    labelEn: schema.title,
    path: `/dashboard/custom/${schema.slug}`,
    badge: 'AI SYNC',
    visible: true,
    isAiCustomPage: true,
    customPageSlug: schema.slug,
  };

  const existingGroupItems = Array.isArray(currentStructure.customMenuItems?.[groupId])
    ? [...currentStructure.customMenuItems![groupId]]
    : [];
  const filteredGroupItems = existingGroupItems.filter(
    (item) => item.id !== menuItemId && item.customPageSlug !== schema.slug
  );
  filteredGroupItems.push(newMenuItem);

  const existingChildOrder = Array.isArray(currentStructure.childrenOrderByGroup?.[groupId])
    ? [...currentStructure.childrenOrderByGroup[groupId]]
    : DEFAULT_SIDEBAR_MENU.find((g) => g.id === groupId)?.children.map((c) => c.id) || [];
  if (!existingChildOrder.includes(menuItemId)) {
    existingChildOrder.push(menuItemId);
  }

  const nextStructure: SidebarMenuStructure = {
    ...currentStructure,
    customMenuItems: {
      ...(currentStructure.customMenuItems || {}),
      [groupId]: filteredGroupItems,
    },
    customPages: {
      ...(currentStructure.customPages || {}),
      [schema.slug]: schema,
    },
    childrenOrderByGroup: {
      ...(currentStructure.childrenOrderByGroup || {}),
      [groupId]: existingChildOrder,
    },
    childrenVisible: {
      ...(currentStructure.childrenVisible || {}),
      [menuItemId]: true,
    },
    updatedAt: new Date().toISOString(),
  };

  await saveSidebarMenuStructure(nextStructure);

  try {
    await setDoc(doc(db, 'custom_pages', schema.slug), schema, { merge: true });
    if (ACTIVE_STORE_ID) {
      await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'custom_pages', schema.slug), schema, {
        merge: true,
      });
    }
  } catch (e) {
    console.warn('Firestore custom_pages write warning:', e);
  }

  return nextStructure;
}

/**
 * Deletes an AI-generated Custom Page from SidebarMenuStructure and Firestore
 */
export async function deleteAiCustomPageFromMenu(
  currentStructure: SidebarMenuStructure,
  slug: string
): Promise<SidebarMenuStructure> {
  const page = currentStructure.customPages?.[slug];
  const groupId = page?.targetGroupId || 'dashboard';
  const menuItemId = page?.id || `custom_${slug.replace(/-/g, '_')}`;

  const nextCustomPages = { ...(currentStructure.customPages || {}) };
  delete nextCustomPages[slug];

  const nextCustomMenuItems = { ...(currentStructure.customMenuItems || {}) };
  Object.keys(nextCustomMenuItems).forEach((gid) => {
    nextCustomMenuItems[gid] = (nextCustomMenuItems[gid] || []).filter(
      (i) => i.id !== menuItemId && i.customPageSlug !== slug
    );
  });

  const nextChildOrder = { ...(currentStructure.childrenOrderByGroup || {}) };
  if (nextChildOrder[groupId]) {
    nextChildOrder[groupId] = nextChildOrder[groupId].filter((id) => id !== menuItemId);
  }

  const nextStructure: SidebarMenuStructure = {
    ...currentStructure,
    customPages: nextCustomPages,
    customMenuItems: nextCustomMenuItems,
    childrenOrderByGroup: nextChildOrder,
    updatedAt: new Date().toISOString(),
  };

  await saveSidebarMenuStructure(nextStructure);

  try {
    await deleteDoc(doc(db, 'custom_pages', slug)).catch(() => {});
    if (ACTIVE_STORE_ID) {
      await deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'custom_pages', slug)).catch(() => {});
    }
  } catch {}

  return nextStructure;
}

export { useSidebarMenuConfig, useSidebarMenu } from '../hooks/useSidebarMenu';
