import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth, isDemoModeActive, setDemoModeActive, resetDemoSandbox } from '../firebase';
import { ensureFirebaseSession } from '../services/firebaseSession';
import { Lock, ShieldAlert, KeyRound, CheckCircle2, X } from 'lucide-react';

export interface PermissionItem {
  id: string; // e.g. 'main.1', 'a.8'
  title: string;
  description: string;
  tab: string; // corresponding tab in RiskCart
  subModule?: string; // corresponding subModule in RiskCart
}

export interface PermissionGroup {
  key: string; // 'main', 'a', 'b', ..., 'p'
  letter: string; // 'MAIN', 'A', 'B', etc.
  title: string;
  tabId: string;
  description: string;
  items: PermissionItem[];
}

export interface RoleDefinition {
  id: string;
  code?: string;
  name: string;
  description: string;
  level?: number;
  color: string;
  terkunci?: boolean; // if true, cannot be edited or deleted (e.g. owner)
  isDefault?: boolean;
}

export type GranularActionType = 'view' | 'create' | 'update' | 'delete' | 'approve';

export interface GranularModulePermission {
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  approve: boolean;
}

export interface EcosystemModuleSpec {
  id: string;
  code: string;
  title: string;
  routesLabel: string;
  description: string;
  matchedTabs: string[];
  matchedPathPrefixes: string[];
}

export type VoidRefundPolicy = 'allowed' | 'require_pin' | 'denied';

export interface RoleOperationalLimits {
  hideHppAndMargin: boolean;
  allowManualDiscount: boolean;
  maxDiscountPercent: number;
  voidRefundPolicy: VoidRefundPolicy;
  allowDirectPriceEdit: boolean;
  allowStockOpnameAdjustment: boolean;
  allowCashOutAndVaultTransfer: boolean;
  allowExportAndWipeData: boolean;
}

export interface CustomAuthorityRule {
  id: string;
  code: string;
  title: string;
  description: string;
  moduleId: string;
  roleIds: string[];
  actionType: GranularActionType | 'pin_override' | 'limit_threshold';
  maxThresholdValue?: number;
  requireSupervisorPin: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt?: string;
}

export const ECOSYSTEM_MODULES: EcosystemModuleSpec[] = [
  {
    id: 'mod_dashboard',
    code: 'DASHBOARD_MAIN',
    title: 'Dashboard Utama & Grafik Analitik',
    routesLabel: '/dashboard',
    description: 'Ringkasan eksekutif penjualan harian, grafik omzet real-time, KPI performa outlet, dan statistik utama.',
    matchedTabs: ['admin_dashboard', 'admin', 'landing'],
    matchedPathPrefixes: ['/dashboard/beranda'],
  },
  {
    id: 'mod_pos',
    code: 'POS_TERMINAL',
    title: 'Mesin Kasir POS',
    routesLabel: '/dashboard/pos',
    description: 'Operasional mesin kasir Point of Sale, scan barcode, keranjang belanja, pembayaran, dan cetak struk.',
    matchedTabs: ['pos_machine'],
    matchedPathPrefixes: ['/dashboard/pos'],
  },
  {
    id: 'mod_produk',
    code: 'PRODUCT_CATALOG',
    title: 'Katalog & Tambah Produk',
    routesLabel: '/dashboard/produk, /kategori-produk',
    description: 'Manajemen data produk eceran & dus, tambah produk baru, paket bundling, harga diskon, kategori & brand.',
    matchedTabs: ['products', 'categories', 'units', 'produk_log', 'product_log'],
    matchedPathPrefixes: ['/dashboard/produk', '/dashboard/kategori-produk', '/dashboard/paket-produk', '/dashboard/harga-diskon', '/dashboard/produk-log'],
  },
  {
    id: 'mod_shift',
    code: 'SHIFT_CASHIER',
    title: 'Manajemen Shift Kasir',
    routesLabel: '/dashboard/shift/kasir, /kas-masuk, /kas-keluar',
    description: 'Buka/tutup shift kasir, pencatatan uang modal laci (float), kas masuk, kas keluar operasional, dan riwayat shift.',
    matchedTabs: ['module_shift'],
    matchedPathPrefixes: ['/dashboard/shift'],
  },
  {
    id: 'mod_orders',
    code: 'ORDERS_WHARF',
    title: 'Orders & Pengiriman',
    routesLabel: '/dashboard/orders',
    description: 'Antrian pesanan masuk (Wharf), verifikasi pesanan PWA, penugasan kurir internal (shipper), dan bukti serah terima.',
    matchedTabs: ['orders', 'module_pos_transactions', 'transactions', 'transaction_store'],
    matchedPathPrefixes: ['/dashboard/orders', '/dashboard/transaksi-pos', '/transaksi', '/transaction-store'],
  },
  {
    id: 'mod_inventory',
    code: 'INVENTORY_AUDIT',
    title: 'Lacak Inventory & Stok Opname',
    routesLabel: '/dashboard/inventory, /kartu-stok, /stok-opname',
    description: 'Monitoring stok fisik gudang & etalase, histori kartu stok, batas stok minimum, dan rekonsiliasi stok opname.',
    matchedTabs: ['module_inventory', 'stock', 'module_multi_outlet'],
    matchedPathPrefixes: ['/dashboard/inventory', '/dashboard/multi-outlet'],
  },
  {
    id: 'mod_pembelian',
    code: 'PROCUREMENT_PO',
    title: 'Pembelian & Supplier',
    routesLabel: '/dashboard/pembelian/*',
    description: 'Direktori pemasok (supplier), pembuatan Purchase Order (PO), penerimaan barang masuk, dan analitik pengadaan.',
    matchedTabs: ['module_procurement'],
    matchedPathPrefixes: ['/dashboard/pembelian'],
  },
  {
    id: 'mod_keuangan',
    code: 'FINANCE_VAULTS',
    title: 'Keuangan & Brangkas Toko',
    routesLabel: '/dashboard/keuangan/brangkas-toko, /brangkas-modal, /brangkas-untung',
    description: 'Pengelolaan Brangkas Toko, Brangkas Modal, Brangkas Untung, tipe akun keuangan, dan mutasi saldo kas.',
    matchedTabs: ['module_finance'],
    matchedPathPrefixes: ['/dashboard/keuangan'],
  },
  {
    id: 'mod_laporan',
    code: 'ASSET_REPORTS',
    title: 'Asset Toko & Laporan Kas',
    routesLabel: '/dashboard/myasset, /dashboard/laporankas',
    description: 'Valuasi aset inventori & aset tetap toko, laporan arus kas, neraca keuangan, dan perhitungan laba bersih.',
    matchedTabs: ['myasset', 'asset_toko', 'laporan_kas', 'laporankas', 'assets'],
    matchedPathPrefixes: ['/dashboard/myasset', '/dashboard/laporankas', '/dashboard/laporan'],
  },
  {
    id: 'mod_pelanggan',
    code: 'CRM_MARKETING',
    title: 'Pelanggan & Marketing',
    routesLabel: '/dashboard/pelanggan/*, /dashboard/marketing/*',
    description: 'Database member pelanggan, tipe grosir/VIP, piutang pelanggan, poin loyalitas, voucher promo, dan hadiah target.',
    matchedTabs: ['module_customer', 'customer_types', 'module_marketing'],
    matchedPathPrefixes: ['/dashboard/pelanggan', '/dashboard/marketing'],
  },
  {
    id: 'mod_ai',
    code: 'AI_INTELLIGENCE',
    title: 'Modul AI Intelligence',
    routesLabel: '/dashboard/ai/*',
    description: 'Akses ke 8 modul kecerdasan buatan: Purchase Advisor, Strategic Restock, Loss Prevention, Anti-Fraud Sentinel, dan Copilot.',
    matchedTabs: ['module_ai', 'ai_architect', 'ai-architect', 'restock', 'anti_fraud'],
    matchedPathPrefixes: ['/dashboard/ai', '/dashboard/ai-architect', '/dashboard/ai-agent', '/dashboard/restock-advisor', '/dashboard/anti-fraud'],
  },
  {
    id: 'mod_staff',
    code: 'STAFF_WORKFORCE',
    title: 'Manajemen Staff & KPI',
    routesLabel: '/dashboard/staff/*',
    description: 'Direktori karyawan, kredensial PIN kasir, manajemen jabatan, matriks Otoritas Akses (RBAC), dan evaluasi KPI.',
    matchedTabs: ['module_staff', 'hakdanakses', 'hak_dan_akses', 'rbac'],
    matchedPathPrefixes: ['/dashboard/staff', '/dashboard/hakdanakses', '/dashboard/otoritas-akses'],
  },
  {
    id: 'mod_settings',
    code: 'SYSTEM_SETTINGS',
    title: 'Pengaturan PWA & Pengaturan POS',
    routesLabel: '/dashboard/pengaturan-pwa/*, /dashboard/pengaturan-pos/*',
    description: 'Konfigurasi toko online Client PWA, profil bisnis, printer struk thermal, payment gateway, backup data, dan audit log.',
    matchedTabs: ['module_pwa_settings', 'pwa_settings', 'module_pos_settings', 'settings', 'module_online_order', 'module_payment'],
    matchedPathPrefixes: ['/dashboard/pengaturan-pwa', '/dashboard/pengaturan-pos', '/dashboard/online-order', '/dashboard/payment', '/dashboard/pengaturan'],
  },
];

export const RBAC_GROUPS: PermissionGroup[] = [
  {
    key: 'main',
    letter: 'MAIN',
    title: 'MODUL UTAMA',
    tabId: 'pos_machine',
    description: 'Akses inti transaksi kasir langsung dan sistem pemrosesan pesanan masuk (Wharf).',
    items: [
      {
        id: 'main.1',
        title: 'Terminal Kasir POS (Point of Sale)',
        description: 'Membuka antarmuka kasir, scan barcode, kalkulasi diskon, dan cetak struk pembayaran langsung.',
        tab: 'pos_machine',
        subModule: 'pos_machine',
      },
      {
        id: 'main.2',
        title: 'Antrian Pesanan Masuk (Wharf Orders)',
        description: 'Menerima, memverifikasi, mengubah status pesanan dari Client PWA, dan penyerahan ke kurir.',
        tab: 'orders',
        subModule: 'orders',
      },
    ],
  },
  {
    key: 'a',
    letter: 'A',
    title: 'MODUL AI (ARTIFICIAL INTELLIGENCE - 21 AGENTS)',
    tabId: 'module_ai',
    description: 'Rangkaian 21 agen AI cerdas otonom untuk peramalan, rekomendasi, forensik, dan optimasi bisnis.',
    items: [
      { id: 'a.1', title: 'Master Orchestrator AI', description: 'Kendali orkestrasi sentral AI untuk koordinasi seluruh modul bisnis.', tab: 'module_ai', subModule: 'master_ai' },
      { id: 'a.2', title: 'Ringkasan Eksekutif AI', description: 'Laporan ringkasan performa penjualan dan operasional harian otomatis.', tab: 'module_ai', subModule: 'ringkasan_ai' },
      { id: 'a.3', title: 'Rekomendasi Bisnis Otomatis', description: 'Saran tindakan strategis berbasis machine learning untuk ekspansi omset.', tab: 'module_ai', subModule: 'rekomendasi_ai' },
      { id: 'a.4', title: 'Prediksi Penjualan & Tren', description: 'Estimasi kurva permintaan produk di masa depan berdasarkan histori.', tab: 'module_ai', subModule: 'prediksi_penjualan' },
      { id: 'a.5', title: 'AI Dynamic Pricing & Margin', description: 'Optimasi harga jual produk dan rekomendasi perlindungan margin laba.', tab: 'module_ai', subModule: 'ai_pricing' },
      { id: 'a.6', title: 'AI Generator Promo & Voucher', description: 'Pembuatan diskon pintar dan promosi otomatis berdasarkan pola churn pelanggan.', tab: 'module_ai', subModule: 'ai_promo' },
      { id: 'a.7', title: 'AI Restock & Dead Stock Advisor', description: 'Deteksi dini barang macet dan perhitungan saran kuantitas reorder (PO).', tab: 'module_ai', subModule: 'ai_inventory' },
      { id: 'a.8', title: 'AI Anti-Fraud Forensic Inspector', description: 'Forensik transaksi kasir mencurigakan, pembatalan sepihak, dan anomali kas.', tab: 'module_ai', subModule: 'ai_fraud' },
      { id: 'a.9', title: 'AI Segmentasi & Churn Pelanggan', description: 'Pengelompokan otomatis pelanggan VIP, reguler, dan berisiko berhenti belanja.', tab: 'module_ai', subModule: 'ai_crm' },
      { id: 'a.10', title: 'AI Analisis Perilaku Konsumen', description: 'Analisis jam sibuk belanja, keranjang favorit, dan pola belanja gabungan.', tab: 'module_ai', subModule: 'ai_behavior' },
      { id: 'a.11', title: 'AI Purchase Order Suggester', description: 'Penyusunan draf PO supplier otomatis berbasis batas stok minimum dan SLA.', tab: 'module_ai', subModule: 'ai_auto_order' },
      { id: 'a.12', title: 'AI Analitik Finansial', description: 'Evaluasi kesehatan arus kas dan proyeksi kebutuhan modal kerja toko.', tab: 'module_ai', subModule: 'ai_finance' },
      { id: 'a.13', title: 'AI Pelatih & Evaluator Staff', description: 'Evaluasi akurasi pencatatan kasir dan saran peningkatan produktivitas.', tab: 'module_ai', subModule: 'ai_staff_coaching' },
      { id: 'a.14', title: 'AI Pemantau Kompetitor & Tren', description: 'Analisis positioning pasar dan benchmark harga komparatif.', tab: 'module_ai', subModule: 'ai_competitor' },
      { id: 'a.15', title: 'AI Visual Merchandising', description: 'Rekomendasi tata letak produk rak fisik dan showcase katalog digital.', tab: 'module_ai', subModule: 'ai_Visual_merch' },
      { id: 'a.16', title: 'AI Voice Command POS', description: 'Input cepat pesanan kasir menggunakan instruksi suara terenkripsi.', tab: 'module_ai', subModule: 'ai_voice_pos' },
      { id: 'a.17', title: 'AI Rekayasa Margin Produk', description: 'Analisis matriks BCG (Stars, Plowhorses, Puzzles, Dogs) untuk katalog barang.', tab: 'module_ai', subModule: 'ai_Menu_eng' },
      { id: 'a.18', title: 'AI Analitik Cuaca & Musiman', description: 'Korelasi fluktuasi cuaca sekitar outlet dengan tren permintaan produk.', tab: 'module_ai', subModule: 'ai_Weather' },
      { id: 'a.19', title: 'AI Deteksi Retur & Barang Rusak', description: 'Identifikasi pola barang rusak, masa kadaluarsa batch, dan klaim retur ganjil.', tab: 'module_ai', subModule: 'ai_Return' },
      { id: 'a.20', title: 'AI Optimasi Jadwal Kerja Shift', description: 'Prediksi kebutuhan headcount staf kasir per shift agar efisien.', tab: 'module_ai', subModule: 'ai_Shift' },
      { id: 'a.21', title: 'AI Guardian Integritas Sistem', description: 'Pengecekan konsistensi data transaksi versus stok dan buku besar secara realtime.', tab: 'module_ai', subModule: 'ai_System_guardian' },
    ],
  },
  {
    key: 'b',
    letter: 'B',
    title: 'MODUL ANALITIK & LAPORAN',
    tabId: 'admin_dashboard',
    description: 'Dashboard performa penjualan, grafik omset realtime, dan rekap transaksi periodik.',
    items: [
      { id: 'b.1', title: 'Ringkasan Analitik Dashboard', description: 'Grafik penjualan, top produk, omset kotor, dan laba kotor toko.', tab: 'admin_dashboard', subModule: 'ringkasan_analitik' },
      { id: 'b.2', title: 'Laporan Penjualan Lengkap', description: 'Download dan cetak rekapitulasi penjualan per kasir, per shift, dan per periode.', tab: 'assets', subModule: 'laporan_penjualan' },
    ],
  },
  {
    key: 'c',
    letter: 'C',
    title: 'KATALOG & MANAJEMEN PRODUK',
    tabId: 'products',
    description: 'Pengaturan data induk produk, varian dus/karton, kategori, HPP modal, dan barcode.',
    items: [
      { id: 'c.1', title: 'Daftar Produk & Stok Eceran', description: 'Melihat dan mengelola inventori master, barcode, dan nama produk.', tab: 'products', subModule: 'daftar_produk' },
      { id: 'c.2', title: 'Kategori & Brand Produk', description: 'Pengelompokan barang berdasarkan klasifikasi kategori dan brand pabrikan.', tab: 'categories', subModule: 'kategori_produk' },
      { id: 'c.3', title: 'Resep HPP & Konversi Dus', description: 'Konfigurasi rumus biaya pokok penjualan (HPP) dan rasio konversi dus ke ecer.', tab: 'products', subModule: 'resep_hpp' },
      { id: 'c.4', title: 'Varian, Modifier & Paket Bundling', description: 'Pembuatan produk kombo, bundling hemat, dan opsi tambahan pesanan.', tab: 'products', subModule: 'addon_modifier' },
      { id: 'c.5', title: 'Cetak Label Barcode & Rak', description: 'Generasi dan cetak label barcode scanner untuk ditempel di display etalase.', tab: 'products', subModule: 'label_barcode' },
      { id: 'c.6', title: 'Produk Log (Mutasi Keluar & Masuk)', description: 'Catatan audit real-time barang keluar (terjual POS) dan barang masuk (pembelian & pengadaan supplier) tersinkronisasi database.', tab: 'produk_log', subModule: 'produk_log' },
    ],
  },
  {
    key: 'd',
    letter: 'D',
    title: 'FULFILLMENT & PENGIRIMAN',
    tabId: 'orders',
    description: 'Manajemen alur pengiriman kurir toko, tracking armada, dan SLA pengantaran.',
    items: [
      { id: 'd.1', title: 'Antrian Pesanan Siap Kirim', description: 'Memilih pesanan yang siap dipacking dan dialokasikan ke kurir.', tab: 'orders', subModule: 'antrian_pesanan' },
      { id: 'd.2', title: 'Manajemen Pengiriman Kurir', description: 'Penugasan kurir toko atau integrasi logistik pihak ketiga.', tab: 'orders', subModule: 'pengiriman_kurir' },
      { id: 'd.3', title: 'Bukti Serah Terima & TTD Digital', description: 'Verifikasi foto bukti pengantaran dan tanda tangan digital penerima barang.', tab: 'orders', subModule: 'bukti_serah_terima' },
      { id: 'd.4', title: 'Pengaturan Tarif & Radius Kirim', description: 'Konfigurasi batasan jarak gratis ongkir dan tarif per kilometer.', tab: 'module_online_order', subModule: 'pengaturan_pengiriman' },
      { id: 'd.5', title: 'Analitik SLA Ketepatan Kirim', description: 'Monitoring waktu respon fulfillment dari pesanan diterima hingga terkirim.', tab: 'orders', subModule: 'analitik_sla' },
      { id: 'd.6', title: 'Peta Lokasi Kurir Realtime', description: 'Pelacakan armada kurir saat bertugas mengantar pesanan ke rumah pelanggan.', tab: 'orders', subModule: 'peta_kurir' },
      { id: 'd.7', title: 'Manajemen Armada & Kendaraan', description: 'Pencatatan kendaraan operasional toko dan jadwal perawatan berkala.', tab: 'orders', subModule: 'manajemen_armada' },
    ],
  },
  {
    key: 'e',
    letter: 'E',
    title: 'INVENTORI & GUDANG',
    tabId: 'module_inventory',
    description: 'Pergerakan stok, kartu mutasi fisik, penyesuaian opname, dan PO penerimaan supplier.',
    items: [
      { id: 'e.1', title: 'Monitoring Stok Barang Fisik', description: 'Melihat ketersediaan barang real, stok cadangan, dan stok dialokasikan.', tab: 'module_inventory', subModule: 'stok_barang' },
      { id: 'e.2', title: 'Kartu Mutasi & Arus Barang', description: 'Lacak histori setiap unit masuk, keluar kasir, retur, atau rusak.', tab: 'module_inventory', subModule: 'mutasi_stok' },
      { id: 'e.3', title: 'Audit Fisik / Stok Opname', description: 'Pencatatan selisih hitung fisik berkala untuk rekonsiliasi data inventori.', tab: 'module_inventory', subModule: 'stok_opname' },
      { id: 'e.4', title: 'Purchase Order & Terima Barang', description: 'Membuat pesanan pembelian ke pemasok dan memvalidasi faktur saat barang datang.', tab: 'module_procurement', subModule: 'supplier_po' },
      { id: 'e.5', title: 'Manajemen Gudang & Rak Multi-Outlet', description: 'Pemisahan alokasi stok per gudang sentral dan etalase cabang.', tab: 'module_multi_outlet', subModule: 'manajemen_gudang' },
    ],
  },
  {
    key: 'f',
    letter: 'F',
    title: 'KASIR & OPERASIONAL SHIFT',
    tabId: 'module_shift',
    description: 'Pencatatan modal kas awal, pergantian shift kasir, riwayat struk, dan meja dine-in.',
    items: [
      { id: 'f.1', title: 'Buka / Tutup Kasir & Shift', description: 'Pencatatan kas modal awal laci, rekonsiliasi uang fisik saat tutup kasir.', tab: 'module_shift', subModule: 'kasir_shift' },
      { id: 'f.2', title: 'Riwayat Transaksi & Cetak Ulang', description: 'Mencari struk penjualan lampau dan melakukan cetak ulang invoice.', tab: 'module_pos_transactions', subModule: 'riwayat_transaksi' },
      { id: 'f.3', title: 'Pengaturan Format Struk Kasir', description: 'Kustomisasi header toko, ucapan terima kasih, dan QRIS cetak di struk.', tab: 'module_pos_settings', subModule: 'pengaturan_struk' },
      { id: 'f.4', title: 'Manajemen Meja / Antrian Pesanan', description: 'Pengaturan nomor meja untuk restoran, kafe, atau nomor antrian kasir cepat.', tab: 'pos_machine', subModule: 'manajemen_meja' },
    ],
  },
  {
    key: 'g',
    letter: 'G',
    title: 'AKUNTANSI & PEMBUKUAN',
    tabId: 'assets',
    description: 'Pencatatan jurnal umum, arus kas operasional, beban toko, neraca, dan pajak.',
    items: [
      { id: 'g.1', title: 'Buku Besar & Jurnal Otomatis', description: 'Pencatatan debit dan kredit otomatis yang timbul dari setiap mutasi penjualan.', tab: 'assets', subModule: 'buku_besar' },
      { id: 'g.2', title: 'Laporan Arus Kas (Cash Flow)', description: 'Arus dana masuk dari penjualan tunai/QRIS dan dana keluar operasional.', tab: 'assets', subModule: 'arus_kas' },
      { id: 'g.3', title: 'Biaya Pengeluaran Operasional', description: 'Pencatatan beban listrik, sewa, gaji tambahan, dan perlengkapan toko.', tab: 'module_pos_transactions', subModule: 'biaya_pengeluaran' },
      { id: 'g.4', title: 'Laporan Laba Rugi Periodik', description: 'Perhitungan omset bersih, HPP barang terjual, beban usaha, dan laba bersih.', tab: 'assets', subModule: 'laba_rugi' },
      { id: 'g.5', title: 'Neraca Keuangan & Nilai Aset', description: 'Keseimbangan aset lancar kas, valuasi inventori, kewajiban, dan ekuitas.', tab: 'assets', subModule: 'neraca' },
      { id: 'g.6', title: 'Rekapitulasi Pajak PPN / PB1', description: 'Kalkulasi pungutan pajak penjualan untuk pelaporan fiskal resmi.', tab: 'assets', subModule: 'pajak' },
      { id: 'g.7', title: 'Manajemen Aset Tetap Toko', description: 'Penyusutan nilai mesin kasir, chiller pendingin, kendaraan, dan renovasi.', tab: 'assets', subModule: 'aset_tetap' },
    ],
  },
  {
    key: 'h',
    letter: 'H',
    title: 'PROMOSI & TEKNIK MARKETING',
    tabId: 'module_marketing',
    description: 'Pemberian kupon belanja, diskon bertingkat, target reward hadiah, dan promosi blast.',
    items: [
      { id: 'h.1', title: 'Program Promo & Diskon Bertingkat', description: 'Pengaturan potongan harga nominal, persentase, atau beli 2 gratis 1.', tab: 'module_marketing', subModule: 'promo_diskon' },
      { id: 'h.2', title: 'Voucher & Kupon Belanja', description: 'Penerbitan kode kupon belanja unik dengan batas kuota dan kadaluarsa.', tab: 'module_marketing', subModule: 'voucher_kupon' },
      { id: 'h.3', title: 'Program Loyalitas & Hadiah Target', description: 'Pencapaian target akumulasi belanja berhadiah merchandise toko.', tab: 'module_marketing', subModule: 'program_loyalitas' },
      { id: 'h.4', title: 'Kampanye Pesan Siaran (Broadcast)', description: 'Pengiriman pesan pengingat promo ke basis data kontak pelanggan aktif.', tab: 'module_marketing', subModule: 'kampanye_pesan' },
      { id: 'h.5', title: 'Analitik Hasil Promosi', description: 'Pengukuran konversi penjualan yang dihasilkan dari setiap program diskon.', tab: 'module_marketing', subModule: 'analitik_marketing' },
      { id: 'h.6', title: 'Landing Page & Spanduk Promosi', description: 'Kustomisasi banner display promo pada layar utama aplikasi PWA pelanggan.', tab: 'module_marketing', subModule: 'landing_page_builder' },
      { id: 'h.7', title: 'Manajemen Afiliasi & Referral', description: 'Pemberian komisi bagi pelanggan yang mengajak kerabat berbelanja.', tab: 'module_marketing', subModule: 'manajemen_afiliasi' },
    ],
  },
  {
    key: 'i',
    letter: 'I',
    title: 'KEUANGAN & BRANGKAS TOKO',
    tabId: 'module_finance',
    description: 'Brangkas modal fisik, brangkas laba, rekening bank, rekonsiliasi, dan hutang/piutang.',
    items: [
      { id: 'i.1', title: 'Rekening Bank & Brankas Kas', description: 'Pengaturan saldo rekening bank penampung EDC dan brankas fisik toko.', tab: 'module_finance', subModule: 'rekening_bank' },
      { id: 'i.2', title: 'Rekonsiliasi Mutasi Bank', description: 'Pencocokan mutasi transfer bank dengan transaksi yang tercatat di sistem.', tab: 'module_finance', subModule: 'rekonsiliasi_mutasi' },
      { id: 'i.3', title: 'Manajemen Hutang & Piutang Dagang', description: 'Pencatatan jatuh tempo hutang ke supplier dan piutang bon belanja pelanggan.', tab: 'module_customer', subModule: 'hutang_piutang' },
      { id: 'i.4', title: 'Manajemen Anggaran Toko', description: 'Perencanaan plafon belanja modal dan pengendalian over-budget toko.', tab: 'module_finance', subModule: 'manajemen_anggaran' },
    ],
  },
  {
    key: 'j',
    letter: 'J',
    title: 'PELANGGAN & SISTEM CRM',
    tabId: 'module_customer',
    description: 'Database pelanggan, tier keanggotaan (VIP/Grosir), saldo poin, ulasan, dan tiket CS.',
    items: [
      { id: 'j.1', title: 'Wawasan & Analitik Pelanggan', description: 'Statistik nilai seumur hidup (LTV) dan frekuensi belanja rata-rata konsumen.', tab: 'module_customer', subModule: 'Analytics_pelanggan' },
      { id: 'j.2', title: 'Database Anggota & Riwayat', description: 'Daftar nama pelanggan, nomor WhatsApp, riwayat order, dan total pembelanjaan.', tab: 'module_customer', subModule: 'database_pelanggan' },
      { id: 'j.3', title: 'Segmentasi & Tipe Pelanggan', description: 'Pengaturan level member seperti Retail, Grosir, VIP, dan Diskon Spesial.', tab: 'customer_types', subModule: 'segmentasi_pelanggan' },
      { id: 'j.4', title: 'Ulasan & Feedback Kasir', description: 'Pencatatan kritik dan saran konsumen terhadap pelayanan kasir atau toko.', tab: 'module_customer', subModule: 'feedback_ulasan' },
      { id: 'j.5', title: 'Saldo Poin & Klaim Hadiah', description: 'Penukaran poin belanja dengan produk gratis atau potongan transaksi.', tab: 'module_customer', subModule: 'poin_reward' },
      { id: 'j.6', title: 'Tiket Pengaduan Konsumen', description: 'Pencatatan keluhan belanja dan pemantauan status penyelesaian oleh tim toko.', tab: 'module_customer', subModule: 'komplain_tiket' },
    ],
  },
  {
    key: 'k',
    letter: 'K',
    title: 'KARYAWAN & HAK AKSES SISTEM',
    tabId: 'module_staff',
    description: 'Daftar pegawai, struktur jabatan, matriks izin RBAC, KPI karyawan, dan evaluasi.',
    items: [
      { id: 'k.1', title: 'Daftar Staff & Karyawan Toko', description: 'Data biodata kasir, supervisor, kurir, kontak darurat, dan penempatan outlet.', tab: 'module_staff', subModule: 'daftar_staff' },
      { id: 'k.2', title: 'Role & Jabatan Karyawan', description: 'Pengelompokan jabatan seperti Kasir, Gudang, Akuntan, dan Manajer.', tab: 'module_staff', subModule: 'role_jabatan' },
      { id: 'k.3', title: 'Otoritas Akses & Matriks RBAC', description: 'Pengaturan detail izin akses menu, tombol otorisasi, dan visibilitas data rahasia.', tab: 'module_staff', subModule: 'otoritas_akses' },
      { id: 'k.4', title: 'Monitoring Kinerja & Skor KPI', description: 'Pengukuran jumlah transaksi per kasir, jam kerja, dan minimnya retur.', tab: 'module_staff', subModule: 'kpi_staff' },
      { id: 'k.5', title: 'AI Penugasan & Job Desk Karyawan', description: 'Rekomendasi pembagian beban kerja optimal menggunakan kecerdasan buatan.', tab: 'module_staff', subModule: 'ai_setting_job_staff' },
    ],
  },
  {
    key: 'l',
    letter: 'L',
    title: 'TATA KELOLA & KEAMANAN SISTEM',
    tabId: 'module_pos_settings',
    description: 'Audit log rekaman jejak aktivitas, otorisasi void transaksi, dan kepatuhan SOP.',
    items: [
      { id: 'l.1', title: 'Audit Log & Rekam Jejak Sistem', description: 'Log histori setiap aktivitas penghapusan, edit data, dan percobaan login ilegal.', tab: 'module_pos_settings', subModule: 'log_audit' },
      { id: 'l.2', title: 'Otorisasi Khusus & Approval Void', description: 'Kewenangan pin supervisor untuk menyetujui void struk atau diskon manual kasir.', tab: 'anti_fraud', subModule: 'persetujuan_otorisasi' },
      { id: 'l.3', title: 'Kebijakan Keamanan & Password', description: 'Ketentuan batas salah PIN kasir, durasi sesi kerja, dan pergantian password.', tab: 'module_pos_settings', subModule: 'kebijakan_keamanan' },
      { id: 'l.4', title: 'Kepatuhan SOP & Checklist Shift', description: 'Daftar periksa kebersihan kasir, pengecekan EDC, dan kerapian stok barang.', tab: 'module_shift', subModule: 'kepatuhan_sop' },
      { id: 'l.5', title: 'Manajemen Risiko Kehilangan', description: 'Pencatatan laporan barang hilang atau rusak akibat kelalaian operasional.', tab: 'anti_fraud', subModule: 'manajemen_risiko' },
      { id: 'l.6', title: 'Arsip Dokumen & Berkas Faktur', description: 'Penyimpanan bukti fisik faktur pajak dan surat jalan pemasok secara digital.', tab: 'module_pos_settings', subModule: 'arsip_dokumen' },
      { id: 'l.7', title: 'Perlindungan Privasi Data Pelanggan', description: 'Penyembunyian nomor telepon lengkap pelanggan untuk mencegah kebocoran data.', tab: 'module_pos_settings', subModule: 'pengaturan_privasi' },
    ],
  },
  {
    key: 'm',
    letter: 'M',
    title: 'PWA APLIKASI PELANGGAN (CLIENT APP)',
    tabId: 'module_pwa_settings',
    description: 'Pengaturan aplikasi mobile web pelanggan, tema luxury, radius pemesanan, dan FAQ.',
    items: [
      { id: 'm.1', title: 'Konfigurasi Umum & Nama Aplikasi PWA', description: 'Pengaturan nama toko online, favicon, dan deskripsi aplikasi di layar HP pembeli.', tab: 'module_pwa_settings', subModule: 'konfigurasi_pwa' },
      { id: 'm.2', title: 'Tampilan & Tema Visual Gold Luxury', description: 'Kustomisasi warna emas, tipografi, dan spanduk selamat datang di PWA.', tab: 'module_pwa_settings', subModule: 'tampilan_tema_pwa' },
      { id: 'm.3', title: 'Visibilitas Katalog Produk PWA', description: 'Pemilihan produk yang tampil di toko online versus barang eksklusif toko fisik.', tab: 'module_pwa_settings', subModule: 'katalog_pwa' },
      { id: 'm.4', title: 'Kirim Web Push Notification Promo', description: 'Kirim notifikasi pop-up langsung ke layar ponsel pelanggan yang menginstall PWA.', tab: 'module_pwa_settings', subModule: 'notifikasi_push' },
      { id: 'm.5', title: 'Statistik Kunjungan & Order PWA', description: 'Data jumlah pengunjung online, tingkat konversi keranjang, dan order selesai.', tab: 'module_pwa_settings', subModule: 'analitik_pwa' },
      { id: 'm.6', title: 'QR Code Meja & Self-Ordering', description: 'Cetak barcode meja agar pelanggan bisa pesan dan bayar sendiri dari smartphone.', tab: 'module_pwa_settings', subModule: 'qr_meja_order' },
      { id: 'm.7', title: 'Integrasi Domain & Web App Manifest', description: 'Setup custom domain URL dan manifest instalasi offline Progressive Web App.', tab: 'module_pwa_settings', subModule: 'integrasi_domain' },
      { id: 'm.8', title: 'Status Jam Buka / Tutup Toko PWA', description: 'Jadwal operasional penerimaan pesanan online pelanggan secara terjadwal.', tab: 'module_pwa_settings', subModule: 'status_layanan_pwa' },
      { id: 'm.9', title: 'Pengaturan Checkout & Radius GPS', description: 'Penentuan metode pickup di toko atau delivery dengan batasan radius alamat.', tab: 'module_pwa_settings', subModule: 'pengaturan_checkout_pwa' },
      { id: 'm.10', title: 'Moderasi Ulasan Produk PWA', description: 'Persetujuan ulasan dan testimoni pembeli sebelum dipublikasikan.', tab: 'module_pwa_settings', subModule: 'ulasan_pwa' },
      { id: 'm.11', title: 'Pusat Bantuan & FAQ Pelanggan', description: 'Daftar pertanyaan umum tentang cara berbelanja, ongkos kirim, dan kebijakan retur.', tab: 'module_pwa_settings', subModule: 'bantuan_faq_pwa' },
    ],
  },
  {
    key: 'n',
    letter: 'N',
    title: 'CUSTOMER SERVICE & CHAT INBOX',
    tabId: 'module_customer',
    description: 'Kotak masuk pesan pelanggan, tiket bantuan, template respon cepat, dan analitik CSAT.',
    items: [
      { id: 'n.1', title: 'Kotak Masuk Chat Pelanggan Terpusat', description: 'Menjawab pertanyaan dan konsultasi barang dari pembeli toko online.', tab: 'module_customer', subModule: 'inbox_chat' },
      { id: 'n.2', title: 'Tiket Bantuan & Kendala Pesanan', description: 'Penanganan komplain salah kirim atau barang cacat dengan nomor tiket resmi.', tab: 'module_customer', subModule: 'tiket_bantuan' },
      { id: 'n.3', title: 'Bot Balasan Otomatis (Auto Reply)', description: 'Pesan salam selamat datang dan pemberitahuan di luar jam operasional kerja.', tab: 'module_customer', subModule: 'bot_auto_reply' },
      { id: 'n.4', title: 'Template Balasan Cepat (Quick Reply)', description: 'Simpan kalimat siap pakai untuk membalas pertanyaan yang sering ditanyakan.', tab: 'module_customer', subModule: 'template_balasan' },
      { id: 'n.5', title: 'Analitik Respon CS & Skor Kepuasan', description: 'Kecepatan respon staf dalam membalas chat dan rating bintang dari pembeli.', tab: 'module_customer', subModule: 'analitik_cs' },
      { id: 'n.6', title: 'Integrasi WhatsApp Toko & Media Sosial', description: 'Penghubung nomor WhatsApp resmi bisnis untuk konfirmasi otomatis.', tab: 'module_customer', subModule: 'integrasi_wa_ig' },
    ],
  },
  {
    key: 'o',
    letter: 'O',
    title: 'PENGATURAN TOKO & MULTI-OUTLET',
    tabId: 'module_pos_settings',
    description: 'Profil legalitas toko, manajemen cabang outlet, printer thermal, dan cadangan data.',
    items: [
      { id: 'o.1', title: 'Profil Bisnis, Logo & NPWP Toko', description: 'Nama resmi usaha, logo merek dagang, alamat kantor, dan identitas wajib pajak.', tab: 'module_pos_settings', subModule: 'profil_toko' },
      { id: 'o.2', title: 'Manajemen Cabang & Outlet Baru', description: 'Pendaftaran lokasi outlet cabang baru dan pembagian wewenang masing-masing toko.', tab: 'module_multi_outlet', subModule: 'cabang_outlet' },
      { id: 'o.3', title: 'Pengaturan Printer Bluetooth & Thermal', description: 'Konfigurasi koneksi printer struk kasir 58mm/80mm via USB atau Bluetooth.', tab: 'module_pos_settings', subModule: 'perangkat_printer' },
      { id: 'o.4', title: 'Notifikasi Alarm Stok & Sistem', description: 'Pengaturan bunyi alarm kasir ketika stok barang tersisa kurang dari batas aman.', tab: 'module_pos_settings', subModule: 'notifikasi_sistem' },
      { id: 'o.5', title: 'Pencadangan & Pemulihan Data', description: 'Fitur ekspor cadangan data JSON/CSV dan pemulihan darurat jika perangkat rusak.', tab: 'module_pos_settings', subModule: 'backup_restore' },
      { id: 'o.6', title: 'Integrasi Webhook & API Key Toko', description: 'Pengelolaan kunci rahasia untuk integrasi ke ERP atau software akuntansi luar.', tab: 'module_pos_settings', subModule: 'integrasi_api' },
      { id: 'o.7', title: 'Format Mata Uang, PPN & Lokalisasi', description: 'Pilihan mata uang Rupiah/USD, pemisah ribuan, dan tarif persentase PPN default.', tab: 'module_pos_settings', subModule: 'bahasa_mata_uang' },
      { id: 'o.8', title: 'Lisensi Langganan & Masa Aktif Cloud', description: 'Status paket aktif RiskCart Cloud POS dan kuota penyimpanan database.', tab: 'module_pos_settings', subModule: 'lisensi_langganan' },
    ],
  },
  {
    key: 'p',
    letter: 'P',
    title: 'METODE PEMBAYARAN & PAYMENT GATEWAY',
    tabId: 'module_payment',
    description: 'Konfigurasi mesin EDC, QRIS dinamis, payment gateway, settlement, dan refund.',
    items: [
      { id: 'p.1', title: 'Metode Pembayaran Kasir (Cash/Transfer)', description: 'Aktifkan atau nonaktifkan pembayaran tunai, transfer BCA/Mandiri, atau e-Wallet.', tab: 'module_payment', subModule: 'metode_pembayaran' },
      { id: 'p.2', title: 'Gateway QRIS Dinamis & EDC', description: 'Koneksi ke Midtrans, Xendit, atau DOKU untuk QRIS real-time otomatis verifikasi.', tab: 'module_payment', subModule: 'qris_edc_gateway' },
      { id: 'p.3', title: 'Biaya Layanan & Merchant Discount (MDR)', description: 'Pengaturan beban persentase biaya transaksi QRIS atau kartu kredit.', tab: 'module_payment', subModule: 'biaya_transaksi_mdr' },
      { id: 'p.4', title: 'Histori Settlement & Pencairan Dana', description: 'Catatan penarikan saldo dana dari payment gateway masuk ke rekening toko.', tab: 'module_payment', subModule: 'riwayat_settlement' },
      { id: 'p.5', title: 'Pengembalian Dana (Refund Transaksi)', description: 'Otorisasi pengembalian saldo pembayaran jika pesanan pelanggan dibatalkan.', tab: 'module_payment', subModule: 'pengembalian_dana' },
    ],
  },
];

export const ALL_PERMISSION_KEYS: string[] = RBAC_GROUPS.flatMap((g) => g.items.map((i) => i.id));

// Default role definitions with Owner lock and standard RiskCart hierarchy
export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    id: 'owner',
    code: 'OWNER_SUPER',
    name: 'Owner / Super Admin',
    description: 'Pemilik usaha dengan otoritas absolut 100% Full Access ke seluruh sistem, brankas keuangan, HPP margin, dan konfigurasi master.',
    level: 100,
    color: '#f59e0b', // Amber Gold
    terkunci: true,
    isDefault: true,
  },
  {
    id: 'admin_toko',
    code: 'STORE_MANAGER',
    name: 'Admin Toko / Manajer',
    description: 'Manajer operasional toko yang mengawasi transaksi harian, approval void/diskon kasir, pengadaan barang, dan kinerja staf.',
    level: 85,
    color: '#3b82f6', // Royal Blue
    terkunci: false,
    isDefault: true,
  },
  {
    id: 'cashier',
    code: 'POS_CASHIER',
    name: 'Kasir POS',
    description: 'Staf kasir depan yang mengoperasikan mesin kasir POS, mencetak struk, menerima pembayaran, dan rekonsiliasi shift kasir.',
    level: 50,
    color: '#14b8a6', // Teal
    terkunci: false,
    isDefault: true,
  },
  {
    id: 'inventory_keeper',
    code: 'INVENTORY_STAFF',
    name: 'Staff Gudang / Inventory',
    description: 'Petugas inventori gudang yang memantau stok fisik, audit stok opname, mutasi barang, dan penerimaan barang masuk.',
    level: 60,
    color: '#f97316', // Orange
    terkunci: false,
    isDefault: true,
  },
  {
    id: 'shipper',
    code: 'INTERNAL_SHIPPER',
    name: 'Staff Shipper / Pengirim Internal',
    description: 'Personel gudang dan armada pengiriman internal untuk penyiapan pesanan Wharf, pengantaran kurir, dan bukti serah terima.',
    level: 45,
    color: '#22c55e', // Emerald
    terkunci: false,
    isDefault: true,
  },
  {
    id: 'finance',
    code: 'FINANCE_AUDITOR',
    name: 'Finance',
    description: 'Divisi keuangan yang mengelola kas toko, pembukuan jurnal, rekonsiliasi bank, hutang piutang, dan laporan laba rugi.',
    level: 75,
    color: '#a855f7', // Purple
    terkunci: false,
    isDefault: true,
  },
  {
    id: 'purchase',
    code: 'PROCUREMENT_STAFF',
    name: 'Purchase',
    description: 'Divisi pengadaan barang ke supplier, pembuatan Purchase Order (PO), verifikasi faktur, dan manajemen lead-time stok.',
    level: 65,
    color: '#06b6d4', // Cyan
    terkunci: false,
    isDefault: true,
  },
  {
    id: 'enginer',
    code: 'IT_ENGINEER',
    name: 'Enginer',
    description: 'Teknisi IT dan pemeliharaan sistem, integrasi printer Bluetooth, API webhook, pemantau integritas data dan backup.',
    level: 70,
    color: '#ec4899', // Pink
    terkunci: false,
    isDefault: true,
  },
];

const getGroupKeys = (groupKeys: string[]): string[] => {
  return RBAC_GROUPS.filter((g) => groupKeys.includes(g.key)).flatMap((g) => g.items.map((i) => i.id));
};

export const DEFAULT_GRANTS: Record<string, string[]> = {
  owner: [...ALL_PERMISSION_KEYS],
  admin_toko: [
    ...getGroupKeys(['main', 'b', 'c', 'd', 'e', 'f', 'h', 'j', 'k']),
    'a.1', 'a.2', 'a.3', 'a.7', 'a.8', 'g.1', 'g.2', 'g.3', 'l.1', 'l.2', 'l.4',
  ],
  cashier: ['main.1', 'main.2', 'b.1', 'c.1', 'c.4', 'c.5', 'c.6', 'd.1', 'f.1', 'f.2', 'i.3', 'j.1', 'j.2', 'j.3', 'j.4', 'j.5', 'j.6'],
  kasir: ['main.1', 'main.2', 'b.1', 'c.1', 'c.4', 'c.5', 'c.6', 'd.1', 'f.1', 'f.2', 'i.3', 'j.1', 'j.2', 'j.3', 'j.4', 'j.5', 'j.6'],
  inventory_keeper: [
    'c.1', 'c.2', 'c.3', 'c.5', 'c.6',
    ...getGroupKeys(['e']),
    'a.7', 'a.19',
  ],
  shipper: [
    'main.2',
    'c.1',
    'c.2',
    'c.5',
    ...getGroupKeys(['d', 'e']),
  ],
  finance: [
    'main.2',
    ...getGroupKeys(['f', 'g', 'i', 'p']),
    'b.1',
    'b.2',
    'a.12',
  ],
  purchase: [
    'c.1', 'c.2', 'c.3', 'c.6', 'e.1', 'e.2', 'e.4', 'i.3', 'a.7', 'a.11',
  ],
  enginer: [
    'a.1', 'a.8', 'a.21',
    ...getGroupKeys(['l']),
    'm.1', 'm.7', 'o.1', 'o.3', 'o.4', 'o.5', 'o.6',
  ],
};

const createFullModuleMatrix = (): Record<string, GranularModulePermission> => {
  const res: Record<string, GranularModulePermission> = {};
  ECOSYSTEM_MODULES.forEach((m) => {
    res[m.id] = { view: true, create: true, update: true, delete: true, approve: true };
  });
  return res;
};

const createCustomModuleMatrix = (
  allowedViews: string[],
  allowedCreates: string[],
  allowedUpdates: string[],
  allowedDeletes: string[],
  allowedApproves: string[]
): Record<string, GranularModulePermission> => {
  const res: Record<string, GranularModulePermission> = {};
  ECOSYSTEM_MODULES.forEach((m) => {
    res[m.id] = {
      view: allowedViews.includes(m.id),
      create: allowedCreates.includes(m.id),
      update: allowedUpdates.includes(m.id),
      delete: allowedDeletes.includes(m.id),
      approve: allowedApproves.includes(m.id),
    };
  });
  return res;
};

export const DEFAULT_MODULE_MATRIX: Record<string, Record<string, GranularModulePermission>> = {
  owner: createFullModuleMatrix(),
  admin_toko: createCustomModuleMatrix(
    ['mod_dashboard', 'mod_pos', 'mod_produk', 'mod_shift', 'mod_orders', 'mod_inventory', 'mod_pembelian', 'mod_pelanggan', 'mod_ai', 'mod_staff', 'mod_settings'],
    ['mod_pos', 'mod_produk', 'mod_shift', 'mod_orders', 'mod_inventory', 'mod_pembelian', 'mod_pelanggan', 'mod_staff'],
    ['mod_pos', 'mod_produk', 'mod_shift', 'mod_orders', 'mod_inventory', 'mod_pembelian', 'mod_pelanggan', 'mod_staff', 'mod_settings'],
    ['mod_produk', 'mod_orders', 'mod_pelanggan'],
    ['mod_pos', 'mod_shift', 'mod_orders', 'mod_inventory', 'mod_pembelian']
  ),
  cashier: createCustomModuleMatrix(
    ['mod_pos', 'mod_shift', 'mod_orders', 'mod_produk', 'mod_pelanggan'],
    ['mod_pos', 'mod_shift', 'mod_orders', 'mod_pelanggan'],
    ['mod_pos', 'mod_shift', 'mod_orders'],
    [],
    []
  ),
  inventory_keeper: createCustomModuleMatrix(
    ['mod_produk', 'mod_inventory', 'mod_pembelian'],
    ['mod_produk', 'mod_inventory', 'mod_pembelian'],
    ['mod_produk', 'mod_inventory', 'mod_pembelian'],
    [],
    ['mod_inventory']
  ),
  shipper: createCustomModuleMatrix(
    ['mod_orders', 'mod_inventory', 'mod_produk'],
    ['mod_orders'],
    ['mod_orders'],
    [],
    []
  ),
  finance: createCustomModuleMatrix(
    ['mod_dashboard', 'mod_shift', 'mod_orders', 'mod_keuangan', 'mod_laporan', 'mod_pembelian'],
    ['mod_keuangan', 'mod_laporan'],
    ['mod_keuangan', 'mod_laporan', 'mod_shift'],
    [],
    ['mod_keuangan', 'mod_laporan', 'mod_shift']
  ),
  purchase: createCustomModuleMatrix(
    ['mod_produk', 'mod_inventory', 'mod_pembelian', 'mod_ai'],
    ['mod_pembelian', 'mod_produk'],
    ['mod_pembelian', 'mod_produk', 'mod_inventory'],
    [],
    ['mod_pembelian']
  ),
  enginer: createCustomModuleMatrix(
    ['mod_dashboard', 'mod_pos', 'mod_ai', 'mod_settings'],
    ['mod_settings'],
    ['mod_settings', 'mod_ai'],
    [],
    ['mod_settings']
  ),
};

export const DEFAULT_OPERATIONAL_LIMITS: Record<string, RoleOperationalLimits> = {
  owner: {
    hideHppAndMargin: false,
    allowManualDiscount: true,
    maxDiscountPercent: 100,
    voidRefundPolicy: 'allowed',
    allowDirectPriceEdit: true,
    allowStockOpnameAdjustment: true,
    allowCashOutAndVaultTransfer: true,
    allowExportAndWipeData: true,
  },
  admin_toko: {
    hideHppAndMargin: false,
    allowManualDiscount: true,
    maxDiscountPercent: 25,
    voidRefundPolicy: 'allowed',
    allowDirectPriceEdit: true,
    allowStockOpnameAdjustment: true,
    allowCashOutAndVaultTransfer: false,
    allowExportAndWipeData: false,
  },
  cashier: {
    hideHppAndMargin: true,
    allowManualDiscount: true,
    maxDiscountPercent: 5,
    voidRefundPolicy: 'require_pin',
    allowDirectPriceEdit: false,
    allowStockOpnameAdjustment: false,
    allowCashOutAndVaultTransfer: false,
    allowExportAndWipeData: false,
  },
  inventory_keeper: {
    hideHppAndMargin: true,
    allowManualDiscount: false,
    maxDiscountPercent: 0,
    voidRefundPolicy: 'denied',
    allowDirectPriceEdit: false,
    allowStockOpnameAdjustment: true,
    allowCashOutAndVaultTransfer: false,
    allowExportAndWipeData: false,
  },
  shipper: {
    hideHppAndMargin: true,
    allowManualDiscount: false,
    maxDiscountPercent: 0,
    voidRefundPolicy: 'denied',
    allowDirectPriceEdit: false,
    allowStockOpnameAdjustment: false,
    allowCashOutAndVaultTransfer: false,
    allowExportAndWipeData: false,
  },
  finance: {
    hideHppAndMargin: false,
    allowManualDiscount: false,
    maxDiscountPercent: 0,
    voidRefundPolicy: 'allowed',
    allowDirectPriceEdit: false,
    allowStockOpnameAdjustment: false,
    allowCashOutAndVaultTransfer: true,
    allowExportAndWipeData: true,
  },
  purchase: {
    hideHppAndMargin: false,
    allowManualDiscount: false,
    maxDiscountPercent: 0,
    voidRefundPolicy: 'denied',
    allowDirectPriceEdit: true,
    allowStockOpnameAdjustment: false,
    allowCashOutAndVaultTransfer: false,
    allowExportAndWipeData: false,
  },
  enginer: {
    hideHppAndMargin: true,
    allowManualDiscount: false,
    maxDiscountPercent: 0,
    voidRefundPolicy: 'denied',
    allowDirectPriceEdit: false,
    allowStockOpnameAdjustment: false,
    allowCashOutAndVaultTransfer: false,
    allowExportAndWipeData: true,
  },
};

export const DEFAULT_CUSTOM_RULES: CustomAuthorityRule[] = [
  {
    id: 'rule_pos_void_pin',
    code: 'POS_VOID_SUPERVISOR_PIN',
    title: 'Wajib Otorisasi PIN Supervisor untuk Void & Refund Struk POS',
    description: 'Setiap pembatalan struk atau refund oleh Kasir POS wajib diverifikasi dengan PIN 6 digit Owner atau Admin Toko.',
    moduleId: 'mod_pos',
    roleIds: ['cashier'],
    actionType: 'pin_override',
    requireSupervisorPin: true,
    enabled: true,
    createdAt: '2026-01-15T08:00:00.000Z',
  },
  {
    id: 'rule_hide_hpp_non_owner',
    code: 'PROTECT_HPP_MARGIN',
    title: 'Proteksi Kerahasiaan HPP Modal & Laba Bersih dari Staf Operasional',
    description: 'Menyembunyikan kolom Harga Modal (HPP) dan Margin Keuntungan pada halaman Katalog Produk & Orders bagi Kasir, Gudang, dan Shipper.',
    moduleId: 'mod_produk',
    roleIds: ['cashier', 'inventory_keeper', 'shipper'],
    actionType: 'view',
    requireSupervisorPin: false,
    enabled: true,
    createdAt: '2026-01-15T08:00:00.000Z',
  },
];

const STORAGE_KEY = 'riskcart_rbac_v2';
const FIRESTORE_PATH = 'stores/store_001/settings/hak_dan_akses';
const RBAC_MASTER_DOC_PATH = 'rbac_rules/master_matrix';

export interface ActiveCashierProfile {
  id: string;
  name: string;
  email?: string;
  role: string;
  outlet?: string;
  phone?: string;
  shift?: string;
}

const DEFAULT_ACTIVE_CASHIER: ActiveCashierProfile = {
  id: 'staff_001',
  name: 'Owner RiskCart',
  email: 'owner@riskcart.ai',
  role: 'Owner / Super Admin',
  outlet: 'Cabang Utama (Pusat)',
  phone: '-',
  shift: 'Full-Time / All Shift',
};

interface AccessControlContextValue {
  roles: RoleDefinition[];
  grants: Record<string, string[]>;
  moduleMatrix: Record<string, Record<string, GranularModulePermission>>;
  operationalLimits: Record<string, RoleOperationalLimits>;
  customRules: CustomAuthorityRule[];
  ecosystemModules: EcosystemModuleSpec[];
  activeRoleId: string;
  setActiveRoleId: (id: string) => void;
  activeCashier: ActiveCashierProfile;
  setActiveCashier: (cashier: ActiveCashierProfile) => void;
  canAccess: (tab: string, subModule?: string) => boolean;
  canAccessPermission: (permKey: string) => boolean;
  canPerformModuleAction: (moduleIdOrTab: string, action: GranularActionType) => boolean;
  getActiveOperationalLimits: () => RoleOperationalLimits;
  shouldHideHppAndMargin: () => boolean;
  toggleGrant: (roleId: string, permissionKey: string) => void;
  setGroupGrants: (roleId: string, groupKey: string, enabled: boolean) => void;
  setRoleGrants: (roleId: string, keys: string[]) => void;
  toggleModuleAction: (roleId: string, moduleId: string, action: GranularActionType) => void;
  setAllModuleActionsForRole: (roleId: string, moduleId: string, enabled: boolean) => void;
  updateOperationalLimit: <K extends keyof RoleOperationalLimits>(
    roleId: string,
    key: K,
    value: RoleOperationalLimits[K]
  ) => void;
  addCustomRole: (role: {
    name: string;
    code?: string;
    level?: number;
    description: string;
    color: string;
    copyFromId?: string;
  }) => void;
  updateRole: (roleId: string, updates: Partial<RoleDefinition>) => void;
  duplicateRole: (roleId: string, newName?: string) => void;
  deleteCustomRole: (roleId: string) => void;
  addCustomRule: (rule: Omit<CustomAuthorityRule, 'id' | 'createdAt'>) => Promise<void>;
  updateCustomRule: (ruleId: string, updates: Partial<CustomAuthorityRule>) => Promise<void>;
  deleteCustomRule: (ruleId: string) => Promise<void>;
  requestSupervisorPin: (actionLabel: string, onSuccess: () => void) => void;
  resetToDefault: () => Promise<void>;
  saveToCloud: () => Promise<void>;
  isLoading: boolean;
  isSaving: boolean;
  lastSaved: Date | null;
  groups: PermissionGroup[];
  allPermissionKeys: string[];
  isAuthenticated: boolean;
  isDemoMode: boolean;
  isDemoUser: boolean;
  resetDemoData: () => void;
  posPinVerified: boolean;
  staffDirectory: any[];
  loginWithCredentials: (
    email: string,
    password: string
  ) => Promise<{ ok: boolean; message: string; isDemo?: boolean; roleId?: string }>;
  logout: () => Promise<void>;
  verifyPosPin: (
    pin: string
  ) => Promise<{ ok: boolean; staff?: ActiveCashierProfile; message: string }>;
  lockPosSession: () => void;
}

const AccessControlContext = createContext<AccessControlContextValue | null>(null);

export function resolveRoleIdFromRoleName(roleNameOrId: string, roles: RoleDefinition[]): string {
  const clean = (roleNameOrId || '').trim().toLowerCase();
  if (!clean) return 'owner';
  if (clean === 'owner' || clean.includes('super admin') || clean.includes('owner')) return 'owner';
  const direct = roles.find(
    (r) =>
      r.id.toLowerCase() === clean ||
      r.name.toLowerCase() === clean ||
      (r.code && r.code.toLowerCase() === clean)
  );
  if (direct) return direct.id;
  if (clean.includes('admin') || clean.includes('manajer') || clean.includes('manager') || clean.includes('supervisor')) {
    return 'admin_toko';
  }
  if (clean.includes('kasir') || clean.includes('cashier')) return 'cashier';
  if (clean.includes('gudang') || clean.includes('inventory')) return 'inventory_keeper';
  if (clean.includes('shipper') || clean.includes('kurir') || clean.includes('pengirim')) return 'shipper';
  if (clean.includes('finance') || clean.includes('keuangan')) return 'finance';
  if (clean.includes('purchase') || clean.includes('pembelian')) return 'purchase';
  if (clean.includes('enginer') || clean.includes('engineer') || clean.includes('teknisi')) return 'enginer';
  return clean;
}

export const AccessControlProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [roles, setRoles] = useState<RoleDefinition[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.roles) && parsed.roles.length > 0) {
          const existingIds = new Set(parsed.roles.map((r: any) => r.id));
          const merged = [...parsed.roles];
          DEFAULT_ROLES.forEach((def) => {
            if (!existingIds.has(def.id)) {
              merged.push(def);
            }
          });
          return merged.map((r) => (r.id === 'owner' ? { ...defOwner(), ...r, id: 'owner', terkunci: true, level: 100 } : r));
        }
      }
    } catch {}
    return DEFAULT_ROLES;
  });

  function defOwner(): RoleDefinition {
    return DEFAULT_ROLES[0];
  }

  const [grants, setGrants] = useState<Record<string, string[]>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.grants && typeof parsed.grants === 'object') {
          return {
            ...DEFAULT_GRANTS,
            ...parsed.grants,
            owner: [...ALL_PERMISSION_KEYS],
          };
        }
      }
    } catch {}
    return DEFAULT_GRANTS;
  });

  const [moduleMatrix, setModuleMatrix] = useState<Record<string, Record<string, GranularModulePermission>>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.moduleMatrix && typeof parsed.moduleMatrix === 'object') {
          return {
            ...DEFAULT_MODULE_MATRIX,
            ...parsed.moduleMatrix,
            owner: createFullModuleMatrix(),
          };
        }
      }
    } catch {}
    return DEFAULT_MODULE_MATRIX;
  });

  const [operationalLimits, setOperationalLimits] = useState<Record<string, RoleOperationalLimits>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.operationalLimits && typeof parsed.operationalLimits === 'object') {
          return {
            ...DEFAULT_OPERATIONAL_LIMITS,
            ...parsed.operationalLimits,
            owner: DEFAULT_OPERATIONAL_LIMITS.owner,
          };
        }
      }
    } catch {}
    return DEFAULT_OPERATIONAL_LIMITS;
  });

  const [customRules, setCustomRules] = useState<CustomAuthorityRule[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.customRules)) {
          return parsed.customRules;
        }
      }
    } catch {}
    return DEFAULT_CUSTOM_RULES;
  });

  const [activeRoleId, setActiveRoleIdState] = useState<string>(() => {
    try {
      const savedCashier = localStorage.getItem('riskcart_active_cashier');
      if (savedCashier) {
        const parsedCashier = JSON.parse(savedCashier);
        const cEmail = String(parsedCashier?.email || '').toLowerCase();
        const cRole = String(parsedCashier?.role || '').toLowerCase();
        if (
          cEmail === 'kasir@mayamandiri.com' ||
          cEmail === 'demo_kasir' ||
          cRole.includes('cashier') ||
          cRole.includes('kasir')
        ) {
          return 'cashier';
        }
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.activeRoleId) return parsed.activeRoleId;
      }
    } catch {}
    return 'owner';
  });

  const [activeCashier, setActiveCashierState] = useState<ActiveCashierProfile>(() => {
    try {
      const saved = localStorage.getItem('riskcart_active_cashier');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.name) {
          return {
            ...DEFAULT_ACTIVE_CASHIER,
            ...parsed,
          };
        }
      }
    } catch {}
    return DEFAULT_ACTIVE_CASHIER;
  });

  // Pulihkan sesi Firebase Auth saat reload (token server masih ada di sessionStorage)
  useEffect(() => {
    ensureFirebaseSession();
  }, []);

  // Helper: Verify Owner password/PIN via server-side endpoint (/api/settings/pin/verify) with rate limit & SHA-256 salt
  const verifyOwnerSecretOnServer = useCallback(async (rawInput: string, role: string = 'owner'): Promise<boolean> => {
    const clean = String(rawInput || '').trim();
    if (!clean) return false;
    try {
      const res = await fetch('/api/settings/pin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, pin: clean }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data?.valid && data?.token) {
        try {
          sessionStorage.setItem('riskcart_server_token', String(data.token));
        } catch {}
        // Login Firebase Auth (custom token) agar rules Firestore mengizinkan akses
        await ensureFirebaseSession();
      }
      return Boolean(data?.valid);
    } catch {
      return false;
    }
  }, []);

  // Authentication & Demo Mode & POS PIN Gate state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      const flag = localStorage.getItem('riskcart_auth_logged_in');
      if (flag === 'false') return false;
      if (flag === 'true') return true;
      return typeof window !== 'undefined' && !window.location.pathname.startsWith('/login');
    } catch {
      return false;
    }
  });

  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
    const active = isDemoModeActive();
    if (active && typeof window !== 'undefined') {
      (window as any).__RISKCART_DEMO_MODE__ = true;
    }
    return active;
  });

  const [posPinVerified, setPosPinVerified] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('riskcart_pos_pin_verified') === 'true';
    } catch {
      return false;
    }
  });

  const [staffDirectory, setStaffDirectory] = useState<any[]>([]);

  useEffect(() => {
    let rootList: any[] = [];
    let storeList: any[] = [];
    const mergeStaff = () => {
      const map = new Map<string, any>();
      storeList.forEach((s) => map.set(String(s.id), s));
      rootList.forEach((s) => map.set(String(s.id), { ...(map.get(String(s.id)) || {}), ...s }));
      setStaffDirectory(Array.from(map.values()));
    };

    let unsubRoot = () => {};
    let unsubStore = () => {};
    try {
      unsubRoot = onSnapshot(
        collection(db, 'staff'),
        (snap) => {
          rootList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          mergeStaff();
        },
        () => {}
      );
    } catch {}
    try {
      unsubStore = onSnapshot(
        collection(db, 'stores', 'store_001', 'staff'),
        (snap) => {
          storeList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          mergeStaff();
        },
        () => {}
      );
    } catch {}

    const handleDemoChange = (e: Event) => {
      const custom = e as CustomEvent<{ isDemoMode: boolean }>;
      if (typeof custom?.detail?.isDemoMode === 'boolean') {
        setIsDemoMode(custom.detail.isDemoMode);
      } else {
        setIsDemoMode(isDemoModeActive());
      }
    };
    window.addEventListener('riskcart_demo_mode_changed', handleDemoChange);

    return () => {
      unsubRoot();
      unsubStore();
      window.removeEventListener('riskcart_demo_mode_changed', handleDemoChange);
    };
  }, []);

  // Supervisor PIN Modal State
  const [pinRequestModal, setPinRequestModal] = useState<{
    actionLabel: string;
    onSuccess: () => void;
  } | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  const requestSupervisorPin = useCallback((actionLabel: string, onSuccess: () => void) => {
    setPinInput('');
    setPinError(null);
    setPinRequestModal({ actionLabel, onSuccess });
  }, []);

  const handleVerifySupervisorPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    const cleanPin = pinInput.trim();
    if (!cleanPin) {
      setPinError('Masukkan PIN atau Password Otorisasi Owner / Supervisor.');
      return;
    }

    const isOwnerOrSupervisorValid =
      (await verifyOwnerSecretOnServer(cleanPin, 'owner')) ||
      (await verifyOwnerSecretOnServer(cleanPin, 'supervisor'));

    if (isOwnerOrSupervisorValid) {
      const callback = pinRequestModal?.onSuccess;
      setPinRequestModal(null);
      setPinInput('');
      if (callback) callback();
      return;
    }

    try {
      const snap = await getDocs(collection(db, 'staff'));
      let matchedSupervisor = false;
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const rId = resolveRoleIdFromRoleName(d.role || '', roles);
        if (
          (String(d.pin || '').trim() === cleanPin || String(d.password || '').trim() === cleanPin) &&
          (rId === 'owner' || rId === 'admin_toko')
        ) {
          matchedSupervisor = true;
        }
      });

      if (matchedSupervisor) {
        const callback = pinRequestModal?.onSuccess;
        setPinRequestModal(null);
        setPinInput('');
        if (callback) callback();
      } else {
        setPinError('PIN atau Password tidak valid atau bukan milik Owner / Admin Toko.');
      }
    } catch {
      setPinError('PIN Otorisasi tidak dikenali.');
    }
  };

  useEffect(() => {
    const handleCashierEvent = (e: Event) => {
      const custom = e as CustomEvent<ActiveCashierProfile>;
      if (custom?.detail?.name) {
        setActiveCashierState((prev) => ({ ...prev, ...custom.detail }));
        if (custom.detail.role) {
          const mappedRole = resolveRoleIdFromRoleName(custom.detail.role, roles);
          setActiveRoleIdState(mappedRole);
        }
      }
    };
    window.addEventListener('riskcart:cashier-change', handleCashierEvent);
    return () => window.removeEventListener('riskcart:cashier-change', handleCashierEvent);
  }, [roles]);

  const setActiveCashier = useCallback(
    (cashier: ActiveCashierProfile) => {
      const clean: ActiveCashierProfile = {
        id: cashier.id || 'staff_001',
        name: cashier.name || 'Owner RiskCart',
        email: cashier.email || 'owner@riskcart.ai',
        role: cashier.role || 'Owner / Super Admin',
        outlet: cashier.outlet || 'Cabang Utama (Pusat)',
        phone: cashier.phone || '-',
        shift: cashier.shift || 'Full-Time / All Shift',
      };
      setActiveCashierState(clean);
      const cleanEmailLower = String(clean.email || '').toLowerCase();
      const isDemoAdminUser =
        cleanEmailLower === 'demo@mayamandiri.com' ||
        cleanEmailLower === 'demo@riskcart.ai';
      const isDemoKasirUser =
        cleanEmailLower === 'kasir@mayamandiri.com' ||
        cleanEmailLower === 'demo_kasir';
      const mappedRoleId = isDemoKasirUser
        ? 'cashier'
        : isDemoAdminUser
        ? 'owner'
        : resolveRoleIdFromRoleName(clean.role, roles);
      setActiveRoleIdState(mappedRoleId);
      try {
        localStorage.setItem('riskcart_active_cashier', JSON.stringify(clean));
        window.dispatchEvent(new CustomEvent('riskcart:cashier-change', { detail: clean }));
        window.dispatchEvent(new CustomEvent('riskcart_cashier_changed', { detail: clean }));
      } catch {}
    },
    [roles]
  );

  const resetDemoData = useCallback(() => {
    resetDemoSandbox();
    try {
      sessionStorage.removeItem('riskcart_shift_opened_session');
      localStorage.removeItem('riskcart_active_open_shift');
    } catch {}
  }, []);

  const loginWithCredentials = useCallback(
    async (
      email: string,
      password: string
    ): Promise<{ ok: boolean; message: string; isDemo?: boolean; roleId?: string }> => {
      const cleanEmail = String(email || '').trim().toLowerCase();
      const cleanPass = String(password || '').trim();

      if (!cleanEmail || !cleanPass) {
        return { ok: false, message: 'Harap masukkan Email dan Password.' };
      }

      // 1A. Official Demo Admin / Owner Account (`demo@mayamandiri.com` or `demo` or `demo@riskcart.ai` | `Demo123`)
      if (
        (cleanEmail === 'demo@mayamandiri.com' ||
          cleanEmail === 'demo' ||
          cleanEmail === 'demo@riskcart.ai') &&
        (cleanPass === 'Demo123' || cleanPass === 'demo123' || cleanPass === '123456')
      ) {
        const demoAdminProfile: ActiveCashierProfile = {
          id: 'demo_admin_001',
          name: 'Demo Admin / Owner',
          email: 'demo@mayamandiri.com',
          role: 'Owner / Super Admin',
          outlet: 'Cabang Utama (Sandbox Demo)',
          phone: '0812-0000-0001',
          shift: 'Full-Time / All Shift',
        };
        resetDemoSandbox();
        setDemoModeActive(true);
        setIsDemoMode(true);
        setIsAuthenticated(true);
        setPosPinVerified(false);
        setActiveCashierState(demoAdminProfile);
        setActiveRoleIdState('owner');
        try {
          localStorage.setItem('riskcart_auth_logged_in', 'true');
          localStorage.setItem('riskcart_active_cashier', JSON.stringify(demoAdminProfile));
          localStorage.removeItem('riskcart_active_open_shift');
          sessionStorage.setItem('riskcart_pos_pin_verified', 'false');
          sessionStorage.removeItem('riskcart_shift_opened_session');
          window.dispatchEvent(new CustomEvent('riskcart:cashier-change', { detail: demoAdminProfile }));
          window.dispatchEvent(new CustomEvent('riskcart_cashier_changed', { detail: demoAdminProfile }));
        } catch {}
        return {
          ok: true,
          message: 'Login Demo Admin / Owner berhasil! Mode Isolasi Sandbox aktif.',
          isDemo: true,
          roleId: 'owner',
        };
      }

      // 1B. Official Demo Kasir Account (`kasir@mayamandiri.com` or `demo_kasir` | `Demo123`)
      if (
        (cleanEmail === 'kasir@mayamandiri.com' || cleanEmail === 'demo_kasir') &&
        (cleanPass === 'Demo123' || cleanPass === 'demo123' || cleanPass === '123456')
      ) {
        const demoKasirProfile: ActiveCashierProfile = {
          id: 'demo_kasir_001',
          name: 'Demo Kasir POS',
          email: 'kasir@mayamandiri.com',
          role: 'Cashier',
          outlet: 'Cabang Utama (Sandbox Demo)',
          phone: '0812-0000-0002',
          shift: 'Pagi (07:30 - 15:00)',
        };
        resetDemoSandbox();
        setDemoModeActive(true);
        setIsDemoMode(true);
        setIsAuthenticated(true);
        setPosPinVerified(false);
        setActiveCashierState(demoKasirProfile);
        setActiveRoleIdState('cashier');
        try {
          localStorage.setItem('riskcart_auth_logged_in', 'true');
          localStorage.setItem('riskcart_active_cashier', JSON.stringify(demoKasirProfile));
          localStorage.removeItem('riskcart_active_open_shift');
          sessionStorage.setItem('riskcart_pos_pin_verified', 'false');
          sessionStorage.removeItem('riskcart_shift_opened_session');
          window.dispatchEvent(new CustomEvent('riskcart:cashier-change', { detail: demoKasirProfile }));
          window.dispatchEvent(new CustomEvent('riskcart_cashier_changed', { detail: demoKasirProfile }));
        } catch {}
        return {
          ok: true,
          message: 'Login Demo Kasir berhasil! Silakan masukkan PIN Kasir & Buka Shift untuk masuk ke POS.',
          isDemo: true,
          roleId: 'cashier',
        };
      }

      // 2. Check Master Owner secret via server-side verification
      const isMasterOwnerEmail =
        cleanEmail === 'owner@riskcart.ai' ||
        cleanEmail === 'owner@riskcart.com' ||
        cleanEmail === 'admin@riskcart.ai' ||
        cleanEmail === 'owner';

      if (isMasterOwnerEmail && (await verifyOwnerSecretOnServer(cleanPass, 'owner'))) {
        const ownerProfile: ActiveCashierProfile = {
          ...DEFAULT_ACTIVE_CASHIER,
          email: cleanEmail.includes('@') ? cleanEmail : DEFAULT_ACTIVE_CASHIER.email,
        };
        setDemoModeActive(false);
        setIsDemoMode(false);
        setIsAuthenticated(true);
        setPosPinVerified(false);
        setActiveCashierState(ownerProfile);
        setActiveRoleIdState('owner');
        try {
          localStorage.setItem('riskcart_auth_logged_in', 'true');
          localStorage.setItem('riskcart_active_cashier', JSON.stringify(ownerProfile));
          localStorage.removeItem('riskcart_active_open_shift');
          sessionStorage.setItem('riskcart_pos_pin_verified', 'false');
          sessionStorage.removeItem('riskcart_shift_opened_session');
          window.dispatchEvent(new CustomEvent('riskcart:cashier-change', { detail: ownerProfile }));
          window.dispatchEvent(new CustomEvent('riskcart_cashier_changed', { detail: ownerProfile }));
        } catch {}
        return {
          ok: true,
          message: 'Login Master Owner berhasil!',
          isDemo: false,
          roleId: 'owner',
        };
      }

      // 3. Gather staff/users from real-time state + Firestore fallback if empty
      let candidates: any[] = [...staffDirectory];
      if (candidates.length === 0) {
        try {
          const [staffSnap, usersSnap] = await Promise.all([
            getDocs(collection(db, 'staff')).catch(() => null),
            getDocs(collection(db, 'users')).catch(() => null),
          ]);
          if (staffSnap) {
            staffSnap.forEach((d) => candidates.push({ id: d.id, ...d.data() }));
          }
          if (usersSnap) {
            usersSnap.forEach((d) => candidates.push({ id: d.id, ...d.data() }));
          }
        } catch {}
      }

      const matchedStaff = candidates.find((s) => {
        const sEmail = String(s.email || '').trim().toLowerCase();
        const sName = String(s.name || '').trim().toLowerCase();
        const sUser = String(s.username || '').trim().toLowerCase();
        return sEmail === cleanEmail || sName === cleanEmail || (sUser && sUser === cleanEmail);
      });

      if (matchedStaff) {
        const staffPass = String(matchedStaff.password || '').trim();
        const staffPin = String(matchedStaff.pin || '').trim();
        const isStaffOwner = String(matchedStaff.role || '').toLowerCase().includes('owner');
        const isStaffDemo =
          String(matchedStaff.name || '').toLowerCase().includes('demo user') ||
          String(matchedStaff.role || '').toLowerCase().includes('demo') ||
          String(matchedStaff.email || '').toLowerCase() === 'demo@riskcart.ai';

        const serverVerifiedOwner = isStaffOwner
          ? await verifyOwnerSecretOnServer(cleanPass, 'owner')
          : false;

        const passwordMatches =
          (staffPass && cleanPass === staffPass) ||
          (staffPin && cleanPass === staffPin) ||
          serverVerifiedOwner ||
          (isStaffDemo && (cleanPass === 'Demo123' || cleanPass === 'demo123'));

        if (!passwordMatches) {
          return { ok: false, message: 'Password atau PIN yang dimasukkan tidak sesuai.' };
        }

        const profile: ActiveCashierProfile = {
          id: String(matchedStaff.id || 'staff_001'),
          name: String(matchedStaff.name || 'Staff RiskCart'),
          email: String(matchedStaff.email || cleanEmail),
          role: isStaffDemo ? 'Owner / Super Admin' : String(matchedStaff.role || 'Cashier'),
          outlet: String(matchedStaff.outlet || 'Cabang Utama (Pusat)'),
          phone: String(matchedStaff.phone || '-'),
          shift: String(matchedStaff.shift || 'Pagi (07:30 - 15:00)'),
        };

        setDemoModeActive(false);
        setIsDemoMode(false);
        setIsAuthenticated(true);
        setPosPinVerified(false);
        setActiveCashierState(profile);
        const targetRoleId = isStaffDemo || isStaffOwner
          ? 'owner'
          : resolveRoleIdFromRoleName(profile.role, roles);
        setActiveRoleIdState(targetRoleId);
        try {
          localStorage.setItem('riskcart_auth_logged_in', 'true');
          localStorage.setItem('riskcart_active_cashier', JSON.stringify(profile));
          localStorage.removeItem('riskcart_active_open_shift');
          sessionStorage.setItem('riskcart_pos_pin_verified', 'false');
          sessionStorage.removeItem('riskcart_shift_opened_session');
          window.dispatchEvent(new CustomEvent('riskcart:cashier-change', { detail: profile }));
          window.dispatchEvent(new CustomEvent('riskcart_cashier_changed', { detail: profile }));
        } catch {}
        return {
          ok: true,
          message: `Selamat datang kembali, ${profile.name}!`,
          isDemo: false,
          roleId: targetRoleId,
        };
      }

      return {
        ok: false,
        message: 'Email atau Password tidak ditemukan di database karyawan.',
      };
    },
    [staffDirectory, roles, verifyOwnerSecretOnServer]
  );

  const logout = useCallback(async () => {
    // 1. Reset seluruh state user/staff/pin/demo di AccessControlContext menjadi null / false
    setDemoModeActive(false);
    resetDemoSandbox();
    if (typeof window !== 'undefined') {
      (window as any).__RISKCART_DEMO_MODE__ = false;
    }
    setIsDemoMode(false);
    setIsAuthenticated(false);
    setPosPinVerified(false);
    setActiveCashierState(null as any);
    setActiveRoleIdState(null as any);
    setPinRequestModal(null);
    setPinInput('');
    setPinError(null);

    // 2. Panggil signOut(auth) dari Firebase Auth (dibungkus try / catch)
    try {
      await signOut(auth);
    } catch (err) {
      console.warn('Firebase signOut error:', err);
    }

    // 3. Bersihkan seluruh penyimpanan sesi & cache login di browser (localStorage, sessionStorage, cookies)
    try {
      localStorage.clear();
    } catch {}
    try {
      sessionStorage.clear();
    } catch {}
    try {
      if (typeof document !== 'undefined' && document.cookie) {
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
          const eqPos = cookie.indexOf('=');
          const name = (eqPos > -1 ? cookie.slice(0, eqPos) : cookie).trim();
          if (name) {
            document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
            document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
          }
        }
      }
    } catch {}

    // 4. Hard-redirect agar memori RAM React ikut ter-reset 100% bersih
    if (typeof window !== 'undefined') {
      window.location.replace('/login');
    }
  }, []);

  const verifyPosPin = useCallback(
    async (
      pin: string
    ): Promise<{ ok: boolean; staff?: ActiveCashierProfile; message: string }> => {
      const rawPin = String(pin || '').trim();
      const cleanPin = rawPin.replace(/\D/g, '');

      const currentEmail = String(activeCashier?.email || '').toLowerCase();

      if (cleanPin.length !== 6) {
        return { ok: false, message: 'Masukkan 6 digit angka PIN.' };
      }

      // Demo Cashier PIN check (123456)
      if (
        (isDemoModeActive() ||
          currentEmail === 'kasir@mayamandiri.com' ||
          currentEmail === 'demo_kasir') &&
        cleanPin === '123456'
      ) {
        const demoKasirStaff: ActiveCashierProfile = {
          id: activeCashier?.id || 'demo_kasir_001',
          name: activeCashier?.name || 'Demo Kasir POS',
          email: activeCashier?.email || 'kasir@mayamandiri.com',
          role: activeCashier?.role || 'Cashier',
          outlet: activeCashier?.outlet || 'Cabang Utama (Sandbox Demo)',
          phone: activeCashier?.phone || '0812-0000-0002',
          shift: activeCashier?.shift || 'Pagi (07:30 - 15:00)',
        };
        setPosPinVerified(true);
        setActiveCashierState(demoKasirStaff);
        try {
          sessionStorage.setItem('riskcart_pos_pin_verified', 'true');
          localStorage.setItem('riskcart_active_cashier', JSON.stringify(demoKasirStaff));
          window.dispatchEvent(new CustomEvent('riskcart:cashier-change', { detail: demoKasirStaff }));
          window.dispatchEvent(new CustomEvent('riskcart_cashier_changed', { detail: demoKasirStaff }));
        } catch {}
        return { ok: true, staff: demoKasirStaff, message: `Akses POS dibuka: ${demoKasirStaff.name}` };
      }

      // Gather staff list from real-time subscription or Firestore
      let candidates: any[] = [...staffDirectory];
      if (candidates.length === 0) {
        try {
          const snap = await getDocs(collection(db, 'staff'));
          snap.forEach((d) => candidates.push({ id: d.id, ...d.data() }));
        } catch {}
      }

      const matched = candidates.find(
        (s) => String(s.pin || '').trim() === cleanPin && s.status !== 'Nonaktif'
      );

      const serverPinOk = !matched
        ? await verifyOwnerSecretOnServer(cleanPin, 'cashier')
        : false;

      if (matched || serverPinOk) {
        const staffProfile: ActiveCashierProfile = matched
          ? {
              id: String(matched.id || activeCashier?.id || 'staff_001'),
              name: String(matched.name || activeCashier?.name || 'Kasir POS'),
              email: String(matched.email || activeCashier?.email || 'kasir@riskcart.ai'),
              role: String(matched.role || activeCashier?.role || 'Cashier'),
              outlet: String(matched.outlet || activeCashier?.outlet || 'Cabang Utama (Pusat)'),
              phone: String(matched.phone || activeCashier?.phone || '-'),
              shift: String(matched.shift || activeCashier?.shift || 'Pagi (07:30 - 15:00)'),
            }
          : {
              id: activeCashier?.id || 'staff_001',
              name: activeCashier?.name || 'Kasir POS',
              email: activeCashier?.email || 'kasir@riskcart.ai',
              role: activeCashier?.role || 'Cashier',
              outlet: activeCashier?.outlet || 'Cabang Utama (Pusat)',
              phone: activeCashier?.phone || '-',
              shift: activeCashier?.shift || 'Pagi (07:30 - 15:00)',
            };
        setPosPinVerified(true);
        setActiveCashierState(staffProfile);
        try {
          sessionStorage.setItem('riskcart_pos_pin_verified', 'true');
          localStorage.setItem('riskcart_active_cashier', JSON.stringify(staffProfile));
          window.dispatchEvent(new CustomEvent('riskcart:cashier-change', { detail: staffProfile }));
          window.dispatchEvent(new CustomEvent('riskcart_cashier_changed', { detail: staffProfile }));
        } catch {}
        return { ok: true, staff: staffProfile, message: `Akses POS dibuka: ${staffProfile.name}` };
      }

      return { ok: false, message: 'PIN Kasir salah atau tidak terdaftar.' };
    },
    [staffDirectory, activeCashier, activeRoleId, verifyOwnerSecretOnServer]
  );

  const lockPosSession = useCallback(() => {
    setPosPinVerified(false);
    try {
      sessionStorage.setItem('riskcart_pos_pin_verified', 'false');
    } catch {}
  }, []);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const saveToLocalStorage = useCallback(
    (
      nextRoles: RoleDefinition[],
      nextGrants: Record<string, string[]>,
      nextMatrix: Record<string, Record<string, GranularModulePermission>>,
      nextLimits: Record<string, RoleOperationalLimits>,
      nextRules: CustomAuthorityRule[],
      nextActiveRoleId: string
    ) => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            roles: nextRoles,
            grants: nextGrants,
            moduleMatrix: nextMatrix,
            operationalLimits: nextLimits,
            customRules: nextRules,
            activeRoleId: nextActiveRoleId,
            savedAt: new Date().toISOString(),
          })
        );
      } catch (e) {
        console.warn('Failed saving RBAC to localStorage', e);
      }
    },
    []
  );

  // Sync roles & rules to `rbac_roles`, `rbac_rules`, and `stores/store_001/settings/hak_dan_akses`
  const persistAllToFirestore = useCallback(
    async (
      nextRoles: RoleDefinition[],
      nextGrants: Record<string, string[]>,
      nextMatrix: Record<string, Record<string, GranularModulePermission>>,
      nextLimits: Record<string, RoleOperationalLimits>,
      nextRules: CustomAuthorityRule[],
      nextActiveRoleId: string
    ) => {
      const nowIso = new Date().toISOString();
      const safeGrants: Record<string, string[]> = {
        ...nextGrants,
        owner: [...ALL_PERMISSION_KEYS],
      };
      const safeMatrix: Record<string, Record<string, GranularModulePermission>> = {
        ...nextMatrix,
        owner: createFullModuleMatrix(),
      };
      const safeLimits: Record<string, RoleOperationalLimits> = {
        ...nextLimits,
        owner: DEFAULT_OPERATIONAL_LIMITS.owner,
      };

      const masterPayload = {
        roles: nextRoles,
        grants: safeGrants,
        moduleMatrix: safeMatrix,
        operationalLimits: safeLimits,
        customRules: nextRules,
        activeRoleId: nextActiveRoleId,
        updatedAt: nowIso,
      };

      await Promise.all([
        setDoc(doc(db, FIRESTORE_PATH), masterPayload, { merge: true }),
        setDoc(doc(db, RBAC_MASTER_DOC_PATH), masterPayload, { merge: true }),
        ...nextRoles.map((role) =>
          setDoc(
            doc(db, 'rbac_roles', role.id),
            {
              ...role,
              grants: safeGrants[role.id] || [],
              modulePermissions: safeMatrix[role.id] || {},
              operationalLimits: safeLimits[role.id] || DEFAULT_OPERATIONAL_LIMITS.cashier,
              updatedAt: nowIso,
            },
            { merge: true }
          )
        ),
      ]);
    },
    []
  );

  // Real-time listener on `rbac_rules/master_matrix` and fallback `stores/store_001/settings/hak_dan_akses`
  useEffect(() => {
    let unsubMaster = () => {};
    try {
      const masterRef = doc(db, RBAC_MASTER_DOC_PATH);
      unsubMaster = onSnapshot(
        masterRef,
        (snap) => {
          setIsLoading(false);
          if (snap.exists()) {
            const data = snap.data();
            const loadedRoles: RoleDefinition[] =
              Array.isArray(data.roles) && data.roles.length > 0 ? data.roles : DEFAULT_ROLES;

            const existingIds = new Set(loadedRoles.map((r) => r.id));
            const mergedRoles = [...loadedRoles];
            DEFAULT_ROLES.forEach((defRole) => {
              if (!existingIds.has(defRole.id)) {
                mergedRoles.push(defRole);
              }
            });

            const mergedGrants: Record<string, string[]> = {
              ...DEFAULT_GRANTS,
              ...(data.grants || {}),
              owner: [...ALL_PERMISSION_KEYS],
            };

            const mergedMatrix: Record<string, Record<string, GranularModulePermission>> = {
              ...DEFAULT_MODULE_MATRIX,
              ...(data.moduleMatrix || {}),
              owner: createFullModuleMatrix(),
            };

            const mergedLimits: Record<string, RoleOperationalLimits> = {
              ...DEFAULT_OPERATIONAL_LIMITS,
              ...(data.operationalLimits || {}),
              owner: DEFAULT_OPERATIONAL_LIMITS.owner,
            };

            const mergedRules: CustomAuthorityRule[] = Array.isArray(data.customRules)
              ? data.customRules
              : DEFAULT_CUSTOM_RULES;

            setRoles(mergedRoles);
            setGrants(mergedGrants);
            setModuleMatrix(mergedMatrix);
            setOperationalLimits(mergedLimits);
            setCustomRules(mergedRules);

            if (data.updatedAt) {
              setLastSaved(new Date(data.updatedAt));
            }
            saveToLocalStorage(
              mergedRoles,
              mergedGrants,
              mergedMatrix,
              mergedLimits,
              mergedRules,
              activeRoleId || data.activeRoleId || 'owner'
            );
          } else {
            // Seed initial RBAC to `rbac_roles` & `rbac_rules`
            persistAllToFirestore(
              DEFAULT_ROLES,
              DEFAULT_GRANTS,
              DEFAULT_MODULE_MATRIX,
              DEFAULT_OPERATIONAL_LIMITS,
              DEFAULT_CUSTOM_RULES,
              'owner'
            ).catch((err) => console.warn('Initial RBAC seed warning:', err));
          }
        },
        (err) => {
          console.warn('RBAC Firestore snapshot warning:', err);
          setIsLoading(false);
        }
      );
    } catch (err) {
      console.warn('Firestore initialization failed for RBAC:', err);
      setIsLoading(false);
    }

    return () => {
      unsubMaster();
    };
  }, [persistAllToFirestore, saveToLocalStorage]);

  const saveToCloud = useCallback(async () => {
    setIsSaving(true);
    try {
      await persistAllToFirestore(
        roles,
        grants,
        moduleMatrix,
        operationalLimits,
        customRules,
        activeRoleId
      );
      saveToLocalStorage(
        roles,
        grants,
        moduleMatrix,
        operationalLimits,
        customRules,
        activeRoleId
      );
      setLastSaved(new Date());
    } catch (err) {
      console.warn('Failed to save RBAC to Firestore:', err);
      saveToLocalStorage(
        roles,
        grants,
        moduleMatrix,
        operationalLimits,
        customRules,
        activeRoleId
      );
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [
    roles,
    grants,
    moduleMatrix,
    operationalLimits,
    customRules,
    activeRoleId,
    persistAllToFirestore,
    saveToLocalStorage,
  ]);

  const toggleGrant = useCallback(
    (roleId: string, permissionKey: string) => {
      if (roleId === 'owner') return;
      setGrants((prev) => {
        const currentList = prev[roleId] || [];
        const exists = currentList.includes(permissionKey);
        const nextList = exists
          ? currentList.filter((k) => k !== permissionKey)
          : [...currentList, permissionKey];

        const updated = {
          ...prev,
          [roleId]: nextList,
          owner: [...ALL_PERMISSION_KEYS],
        };
        saveToLocalStorage(roles, updated, moduleMatrix, operationalLimits, customRules, activeRoleId);
        void persistAllToFirestore(roles, updated, moduleMatrix, operationalLimits, customRules, activeRoleId).catch(() => {});
        return updated;
      });
    },
    [roles, moduleMatrix, operationalLimits, customRules, activeRoleId, saveToLocalStorage, persistAllToFirestore]
  );

  const setGroupGrants = useCallback(
    (roleId: string, groupKey: string, enabled: boolean) => {
      if (roleId === 'owner') return;
      const group = RBAC_GROUPS.find((g) => g.key === groupKey);
      if (!group) return;
      const groupItemIds = group.items.map((i) => i.id);

      setGrants((prev) => {
        const currentList = prev[roleId] || [];
        const nextList = enabled
          ? Array.from(new Set([...currentList, ...groupItemIds]))
          : currentList.filter((k) => !groupItemIds.includes(k));

        const updated = {
          ...prev,
          [roleId]: nextList,
          owner: [...ALL_PERMISSION_KEYS],
        };
        saveToLocalStorage(roles, updated, moduleMatrix, operationalLimits, customRules, activeRoleId);
        void persistAllToFirestore(roles, updated, moduleMatrix, operationalLimits, customRules, activeRoleId).catch(() => {});
        return updated;
      });
    },
    [roles, moduleMatrix, operationalLimits, customRules, activeRoleId, saveToLocalStorage, persistAllToFirestore]
  );

  const setRoleGrants = useCallback(
    (roleId: string, keys: string[]) => {
      if (roleId === 'owner') return;
      setGrants((prev) => {
        const updated = {
          ...prev,
          [roleId]: keys,
          owner: [...ALL_PERMISSION_KEYS],
        };
        saveToLocalStorage(roles, updated, moduleMatrix, operationalLimits, customRules, activeRoleId);
        void persistAllToFirestore(roles, updated, moduleMatrix, operationalLimits, customRules, activeRoleId).catch(() => {});
        return updated;
      });
    },
    [roles, moduleMatrix, operationalLimits, customRules, activeRoleId, saveToLocalStorage, persistAllToFirestore]
  );

  const toggleModuleAction = useCallback(
    (roleId: string, moduleId: string, action: GranularActionType) => {
      if (roleId === 'owner') return;
      setModuleMatrix((prev) => {
        const roleMods = prev[roleId] || {};
        const currentMod = roleMods[moduleId] || {
          view: false,
          create: false,
          update: false,
          delete: false,
          approve: false,
        };
        const nextVal = !currentMod[action];
        const updatedMod: GranularModulePermission = {
          ...currentMod,
          [action]: nextVal,
          // If enabling create/update/delete/approve, ensure view is true
          ...(nextVal && action !== 'view' ? { view: true } : {}),
        };
        const updated = {
          ...prev,
          [roleId]: {
            ...roleMods,
            [moduleId]: updatedMod,
          },
          owner: createFullModuleMatrix(),
        };
        saveToLocalStorage(roles, grants, updated, operationalLimits, customRules, activeRoleId);
        void persistAllToFirestore(roles, grants, updated, operationalLimits, customRules, activeRoleId).catch(() => {});
        return updated;
      });
    },
    [roles, grants, operationalLimits, customRules, activeRoleId, saveToLocalStorage, persistAllToFirestore]
  );

  const setAllModuleActionsForRole = useCallback(
    (roleId: string, moduleId: string, enabled: boolean) => {
      if (roleId === 'owner') return;
      setModuleMatrix((prev) => {
        const roleMods = prev[roleId] || {};
        const updated = {
          ...prev,
          [roleId]: {
            ...roleMods,
            [moduleId]: {
              view: enabled,
              create: enabled,
              update: enabled,
              delete: enabled,
              approve: enabled,
            },
          },
          owner: createFullModuleMatrix(),
        };
        saveToLocalStorage(roles, grants, updated, operationalLimits, customRules, activeRoleId);
        void persistAllToFirestore(roles, grants, updated, operationalLimits, customRules, activeRoleId).catch(() => {});
        return updated;
      });
    },
    [roles, grants, operationalLimits, customRules, activeRoleId, saveToLocalStorage, persistAllToFirestore]
  );

  const updateOperationalLimit = useCallback(
    <K extends keyof RoleOperationalLimits>(
      roleId: string,
      key: K,
      value: RoleOperationalLimits[K]
    ) => {
      if (roleId === 'owner') return;
      setOperationalLimits((prev) => {
        const current = prev[roleId] || DEFAULT_OPERATIONAL_LIMITS.cashier;
        const updated = {
          ...prev,
          [roleId]: {
            ...current,
            [key]: value,
          },
          owner: DEFAULT_OPERATIONAL_LIMITS.owner,
        };
        saveToLocalStorage(roles, grants, moduleMatrix, updated, customRules, activeRoleId);
        void persistAllToFirestore(roles, grants, moduleMatrix, updated, customRules, activeRoleId).catch(() => {});
        return updated;
      });
    },
    [roles, grants, moduleMatrix, customRules, activeRoleId, saveToLocalStorage, persistAllToFirestore]
  );

  const addCustomRole = useCallback(
    (newRole: {
      name: string;
      code?: string;
      level?: number;
      description: string;
      color: string;
      copyFromId?: string;
    }) => {
      const slug = newRole.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      const generatedId = slug && !roles.some((r) => r.id === slug) ? slug : `custom_${Date.now()}`;
      const roleDef: RoleDefinition = {
        id: generatedId,
        code: (newRole.code || slug).toUpperCase(),
        name: newRole.name.trim(),
        description: newRole.description.trim() || 'Role kustom operasional toko.',
        level: Number(newRole.level ?? 50),
        color: newRole.color || '#f59e0b',
        terkunci: false,
        isDefault: false,
      };

      const sourceId = newRole.copyFromId || 'cashier';
      const baseGrants = grants[sourceId] ? [...grants[sourceId]] : ['main.1', 'main.2'];
      const baseMatrix = moduleMatrix[sourceId]
        ? JSON.parse(JSON.stringify(moduleMatrix[sourceId]))
        : DEFAULT_MODULE_MATRIX.cashier;
      const baseLimits = operationalLimits[sourceId]
        ? { ...operationalLimits[sourceId] }
        : { ...DEFAULT_OPERATIONAL_LIMITS.cashier };

      const updatedRoles = [...roles, roleDef];
      const updatedGrants = { ...grants, [generatedId]: baseGrants };
      const updatedMatrix = { ...moduleMatrix, [generatedId]: baseMatrix };
      const updatedLimits = { ...operationalLimits, [generatedId]: baseLimits };

      setRoles(updatedRoles);
      setGrants(updatedGrants);
      setModuleMatrix(updatedMatrix);
      setOperationalLimits(updatedLimits);
      saveToLocalStorage(
        updatedRoles,
        updatedGrants,
        updatedMatrix,
        updatedLimits,
        customRules,
        activeRoleId
      );
      void persistAllToFirestore(
        updatedRoles,
        updatedGrants,
        updatedMatrix,
        updatedLimits,
        customRules,
        activeRoleId
      ).catch(() => {});
    },
    [roles, grants, moduleMatrix, operationalLimits, customRules, activeRoleId, saveToLocalStorage, persistAllToFirestore]
  );

  const updateRole = useCallback(
    (roleId: string, updates: Partial<RoleDefinition>) => {
      setRoles((prev) => {
        const next = prev.map((r) => {
          if (r.id !== roleId) return r;
          if (r.id === 'owner') {
            return { ...r, ...updates, id: 'owner', terkunci: true, level: 100 };
          }
          return { ...r, ...updates };
        });
        saveToLocalStorage(next, grants, moduleMatrix, operationalLimits, customRules, activeRoleId);
        void persistAllToFirestore(next, grants, moduleMatrix, operationalLimits, customRules, activeRoleId).catch(() => {});
        return next;
      });
    },
    [grants, moduleMatrix, operationalLimits, customRules, activeRoleId, saveToLocalStorage, persistAllToFirestore]
  );

  const duplicateRole = useCallback(
    (sourceRoleId: string, newName?: string) => {
      const src = roles.find((r) => r.id === sourceRoleId);
      if (!src) return;
      const genId = `custom_${Date.now()}`;
      const cloneName = newName?.trim() || `${src.name} (Salinan)`;
      const newDef: RoleDefinition = {
        id: genId,
        code: `${(src.code || src.id).toUpperCase()}_COPY`,
        name: cloneName,
        description: `Salinan hak akses dari ${src.name}. ${src.description || ''}`,
        level: src.id === 'owner' ? 90 : (src.level ?? 50),
        color: src.color || '#3b82f6',
        terkunci: false,
        isDefault: false,
      };
      const srcGrants = src.id === 'owner' ? [...ALL_PERMISSION_KEYS] : [...(grants[src.id] || [])];
      const srcMatrix =
        src.id === 'owner'
          ? createFullModuleMatrix()
          : JSON.parse(JSON.stringify(moduleMatrix[src.id] || DEFAULT_MODULE_MATRIX.cashier));
      const srcLimits =
        src.id === 'owner'
          ? { ...DEFAULT_OPERATIONAL_LIMITS.admin_toko }
          : { ...(operationalLimits[src.id] || DEFAULT_OPERATIONAL_LIMITS.cashier) };

      const updatedRoles = [...roles, newDef];
      const updatedGrants = { ...grants, [genId]: srcGrants };
      const updatedMatrix = { ...moduleMatrix, [genId]: srcMatrix };
      const updatedLimits = { ...operationalLimits, [genId]: srcLimits };

      setRoles(updatedRoles);
      setGrants(updatedGrants);
      setModuleMatrix(updatedMatrix);
      setOperationalLimits(updatedLimits);
      saveToLocalStorage(
        updatedRoles,
        updatedGrants,
        updatedMatrix,
        updatedLimits,
        customRules,
        activeRoleId
      );
      void persistAllToFirestore(
        updatedRoles,
        updatedGrants,
        updatedMatrix,
        updatedLimits,
        customRules,
        activeRoleId
      ).catch(() => {});
    },
    [roles, grants, moduleMatrix, operationalLimits, customRules, activeRoleId, saveToLocalStorage, persistAllToFirestore]
  );

  const deleteCustomRole = useCallback(
    (roleId: string) => {
      const target = roles.find((r) => r.id === roleId);
      if (!target || target.terkunci || roleId === 'owner') {
        return;
      }

      const updatedRoles = roles.filter((r) => r.id !== roleId);
      const updatedGrants = { ...grants };
      delete updatedGrants[roleId];
      const updatedMatrix = { ...moduleMatrix };
      delete updatedMatrix[roleId];
      const updatedLimits = { ...operationalLimits };
      delete updatedLimits[roleId];

      const nextActive = activeRoleId === roleId ? 'owner' : activeRoleId;

      setRoles(updatedRoles);
      setGrants(updatedGrants);
      setModuleMatrix(updatedMatrix);
      setOperationalLimits(updatedLimits);
      setActiveRoleIdState(nextActive);
      saveToLocalStorage(
        updatedRoles,
        updatedGrants,
        updatedMatrix,
        updatedLimits,
        customRules,
        nextActive
      );
      void deleteDoc(doc(db, 'rbac_roles', roleId)).catch(() => {});
      void persistAllToFirestore(
        updatedRoles,
        updatedGrants,
        updatedMatrix,
        updatedLimits,
        customRules,
        nextActive
      ).catch(() => {});
    },
    [roles, grants, moduleMatrix, operationalLimits, customRules, activeRoleId, saveToLocalStorage, persistAllToFirestore]
  );

  const addCustomRule = useCallback(
    async (ruleInput: Omit<CustomAuthorityRule, 'id' | 'createdAt'>) => {
      const newRule: CustomAuthorityRule = {
        ...ruleInput,
        id: `rule_${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
      const nextRules = [newRule, ...customRules];
      setCustomRules(nextRules);
      saveToLocalStorage(roles, grants, moduleMatrix, operationalLimits, nextRules, activeRoleId);
      await setDoc(doc(db, 'rbac_rules', newRule.id), newRule, { merge: true });
      await persistAllToFirestore(roles, grants, moduleMatrix, operationalLimits, nextRules, activeRoleId);
    },
    [customRules, roles, grants, moduleMatrix, operationalLimits, activeRoleId, saveToLocalStorage, persistAllToFirestore]
  );

  const updateCustomRule = useCallback(
    async (ruleId: string, updates: Partial<CustomAuthorityRule>) => {
      const nextRules = customRules.map((r) =>
        r.id === ruleId ? { ...r, ...updates, updatedAt: new Date().toISOString() } : r
      );
      setCustomRules(nextRules);
      saveToLocalStorage(roles, grants, moduleMatrix, operationalLimits, nextRules, activeRoleId);
      const updatedRule = nextRules.find((r) => r.id === ruleId);
      if (updatedRule) {
        await setDoc(doc(db, 'rbac_rules', ruleId), updatedRule, { merge: true });
      }
      await persistAllToFirestore(roles, grants, moduleMatrix, operationalLimits, nextRules, activeRoleId);
    },
    [customRules, roles, grants, moduleMatrix, operationalLimits, activeRoleId, saveToLocalStorage, persistAllToFirestore]
  );

  const deleteCustomRule = useCallback(
    async (ruleId: string) => {
      const nextRules = customRules.filter((r) => r.id !== ruleId);
      setCustomRules(nextRules);
      saveToLocalStorage(roles, grants, moduleMatrix, operationalLimits, nextRules, activeRoleId);
      await deleteDoc(doc(db, 'rbac_rules', ruleId)).catch(() => {});
      await persistAllToFirestore(roles, grants, moduleMatrix, operationalLimits, nextRules, activeRoleId);
    },
    [customRules, roles, grants, moduleMatrix, operationalLimits, activeRoleId, saveToLocalStorage, persistAllToFirestore]
  );

  const resetToDefault = useCallback(async () => {
    setRoles(DEFAULT_ROLES);
    setGrants(DEFAULT_GRANTS);
    setModuleMatrix(DEFAULT_MODULE_MATRIX);
    setOperationalLimits(DEFAULT_OPERATIONAL_LIMITS);
    setCustomRules(DEFAULT_CUSTOM_RULES);
    setActiveRoleIdState('owner');
    saveToLocalStorage(
      DEFAULT_ROLES,
      DEFAULT_GRANTS,
      DEFAULT_MODULE_MATRIX,
      DEFAULT_OPERATIONAL_LIMITS,
      DEFAULT_CUSTOM_RULES,
      'owner'
    );
    try {
      await persistAllToFirestore(
        DEFAULT_ROLES,
        DEFAULT_GRANTS,
        DEFAULT_MODULE_MATRIX,
        DEFAULT_OPERATIONAL_LIMITS,
        DEFAULT_CUSTOM_RULES,
        'owner'
      );
      setLastSaved(new Date());
    } catch (e) {
      console.warn('Reset Firestore failed:', e);
    }
  }, [persistAllToFirestore, saveToLocalStorage]);

  const canAccessPermission = useCallback(
    (permKey: string): boolean => {
      if (activeRoleId === 'owner') return true;
      const roleGrants = grants[activeRoleId] || [];
      return roleGrants.includes(permKey);
    },
    [activeRoleId, grants]
  );

  const canPerformModuleAction = useCallback(
    (moduleIdOrTab: string, action: GranularActionType): boolean => {
      if (activeRoleId === 'owner') return true;
      const roleMods = moduleMatrix[activeRoleId] || DEFAULT_MODULE_MATRIX[activeRoleId] || {};

      // Check direct moduleId match first
      if (roleMods[moduleIdOrTab]) {
        return Boolean(roleMods[moduleIdOrTab][action]);
      }

      // Find module by matchedTabs or matchedPathPrefixes
      const matchedSpec = ECOSYSTEM_MODULES.find(
        (m) =>
          m.id === moduleIdOrTab ||
          m.matchedTabs.includes(moduleIdOrTab) ||
          m.matchedPathPrefixes.some((p) => moduleIdOrTab.startsWith(p))
      );
      if (matchedSpec && roleMods[matchedSpec.id]) {
        return Boolean(roleMods[matchedSpec.id][action]);
      }

      return true;
    },
    [activeRoleId, moduleMatrix]
  );

  const canAccess = useCallback(
    (tab: string, subModule?: string): boolean => {
      if (activeRoleId === 'owner') return true;

      // 1. Check granular module matrix 'view' permission first
      const matchedModule = ECOSYSTEM_MODULES.find((m) => m.matchedTabs.includes(tab));
      if (matchedModule) {
        const roleMods = moduleMatrix[activeRoleId];
        if (roleMods && roleMods[matchedModule.id] && roleMods[matchedModule.id].view === false) {
          return false;
        }
      }

      // 2. Also check fine-grained sub-feature grants if mapped
      const roleGrants = grants[activeRoleId] || [];
      const matchingItems = RBAC_GROUPS.flatMap((g) => g.items).filter((item) => {
        if (subModule) {
          return item.tab === tab && item.subModule === subModule;
        }
        return item.tab === tab;
      });

      if (matchingItems.length === 0) {
        return matchedModule ? canPerformModuleAction(matchedModule.id, 'view') : true;
      }

      return matchingItems.some((item) => roleGrants.includes(item.id));
    },
    [activeRoleId, grants, moduleMatrix, canPerformModuleAction]
  );

  const getActiveOperationalLimits = useCallback((): RoleOperationalLimits => {
    if (activeRoleId === 'owner') return DEFAULT_OPERATIONAL_LIMITS.owner;
    return operationalLimits[activeRoleId] || DEFAULT_OPERATIONAL_LIMITS.cashier;
  }, [activeRoleId, operationalLimits]);

  const shouldHideHppAndMargin = useCallback((): boolean => {
    if (activeRoleId === 'owner') return false;
    const limits = getActiveOperationalLimits();
    return Boolean(limits.hideHppAndMargin);
  }, [activeRoleId, getActiveOperationalLimits]);

  const value = useMemo(
    () => ({
      roles,
      grants,
      moduleMatrix,
      operationalLimits,
      customRules,
      ecosystemModules: ECOSYSTEM_MODULES,
      activeRoleId,
      setActiveRoleId: (id: string) => {
        setActiveRoleIdState(id);
        saveToLocalStorage(roles, grants, moduleMatrix, operationalLimits, customRules, id);
      },
      activeCashier,
      setActiveCashier,
      canAccess,
      canAccessPermission,
      canPerformModuleAction,
      getActiveOperationalLimits,
      shouldHideHppAndMargin,
      toggleGrant,
      setGroupGrants,
      setRoleGrants,
      toggleModuleAction,
      setAllModuleActionsForRole,
      updateOperationalLimit,
      addCustomRole,
      updateRole,
      duplicateRole,
      deleteCustomRole,
      addCustomRule,
      updateCustomRule,
      deleteCustomRule,
      requestSupervisorPin,
      resetToDefault,
      saveToCloud,
      isLoading,
      isSaving,
      lastSaved,
      groups: RBAC_GROUPS,
      allPermissionKeys: ALL_PERMISSION_KEYS,
      isAuthenticated,
      isDemoMode,
      isDemoUser: isDemoMode,
      resetDemoData,
      posPinVerified,
      staffDirectory,
      loginWithCredentials,
      logout,
      verifyPosPin,
      lockPosSession,
    }),
    [
      roles,
      grants,
      moduleMatrix,
      operationalLimits,
      customRules,
      activeRoleId,
      activeCashier,
      setActiveCashier,
      canAccess,
      canAccessPermission,
      canPerformModuleAction,
      getActiveOperationalLimits,
      shouldHideHppAndMargin,
      toggleGrant,
      setGroupGrants,
      setRoleGrants,
      toggleModuleAction,
      setAllModuleActionsForRole,
      updateOperationalLimit,
      addCustomRole,
      updateRole,
      duplicateRole,
      deleteCustomRole,
      addCustomRule,
      updateCustomRule,
      deleteCustomRule,
      requestSupervisorPin,
      resetToDefault,
      saveToCloud,
      isLoading,
      isSaving,
      lastSaved,
      saveToLocalStorage,
      isAuthenticated,
      isDemoMode,
      resetDemoData,
      posPinVerified,
      staffDirectory,
      loginWithCredentials,
      logout,
      verifyPosPin,
      lockPosSession,
    ]
  );

  return (
    <AccessControlContext.Provider value={value}>
      {children}

      {/* Global Supervisor PIN Override Modal */}
      {pinRequestModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-[#0c111d] border border-amber-500/40 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-400">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wide">
                    Otorisasi PIN Supervisor / Owner
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Tindakan dibatasi oleh aturan Otoritas Akses (RBAC)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPinRequestModal(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleVerifySupervisorPin} className="space-y-4 pt-4">
              <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block text-amber-300">Tindakan Memerlukan Persetujuan:</span>
                  <span>{pinRequestModal.actionLabel}</span>
                </div>
              </div>

              {pinError && (
                <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-700 text-rose-300 text-xs font-bold">
                  {pinError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                  Masukkan PIN atau Password Owner / Admin Toko
                </label>
                <input
                  type="password"
                  autoFocus
                  required
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="••••••"
                  className="w-full bg-zinc-950 border border-amber-500/40 rounded-xl px-4 py-3 text-center text-lg font-mono font-black tracking-[0.25em] text-amber-400 focus:outline-none focus:border-amber-400"
                />
                <p className="text-[10px] text-zinc-500 mt-1.5 text-center">
                  Masukkan PIN 6 angka atau Password Otorisasi Owner / Admin Toko.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setPinRequestModal(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 text-xs font-black shadow-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Verifikasi & Setujui</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AccessControlContext.Provider>
  );
};

export const useAccessControl = () => {
  const context = useContext(AccessControlContext);
  if (!context) {
    throw new Error('useAccessControl must be used within an AccessControlProvider');
  }
  return context;
};
