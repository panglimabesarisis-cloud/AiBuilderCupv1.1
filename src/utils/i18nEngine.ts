import {
  CurrencyMode,
  convertDomCurrencyInText,
  getCurrencyMode,
  getExchangeRate,
} from './money';

export type LangCode = 'en' | 'id';

/**
 * Explicit, reviewed bilingual dictionary for Indonesian (id) and English (en).
 * Supports both structured domain keys (e.g., product.add, product.name, common.save)
 * and legacy flat keys for backward compatibility.
 */
export const TRANSLATION_DICTIONARY: Record<LangCode, Record<string, string>> = {
  id: {
    // Common
    'common.save': 'Simpan',
    'common.saving': 'Menyimpan...',
    'common.cancel': 'Batal',
    'common.loading': 'Memuat...',
    'common.error': 'Terjadi Kesalahan',
    'common.back': 'Kembali',
    'common.close': 'Tutup',
    'common.delete': 'Hapus',
    'common.edit': 'Edit',
    'common.add': 'Tambah',
    'common.search': 'Cari...',
    'common.filter': 'Filter',
    'common.refresh': 'Segarkan',
    'common.status': 'Status',
    'common.actions': 'Aksi',
    'common.active': 'Aktif',
    'common.inactive': 'Nonaktif',
    'common.paused': 'Dijeda',
    'common.all': 'Semua',
    'common.on': 'ON',
    'common.off': 'OFF',
    'common.dark': 'Gelap',
    'common.light': 'Terang',
    'common.upload': 'Unggah',
    'common.change': 'Ganti',
    'common.addNewOption': '+ Tambah baru...',
    'common.file': 'Berkas:',

    // Product & /produk/tambah
    'product.managementTitle': 'Halaman Produk',
    'product.managementSubtitle':
      'Pusat kelola Daftar Produk, Paket Produk (Dus/Karton), Kategori & Brand, serta Pengaturan Harga Diskon.',
    'product.add': 'Tambah Produk',
    'product.addSubtitle':
      'Lengkapi formulir di bawah ini untuk menambahkan produk baru ke katalog Mesin Kasir POS & Aplikasi Online Pelanggan (PWA).',
    'product.edit': 'Edit Produk',
    'product.name': 'Nama Produk',
    'product.groupNamePlaceholder': 'Masukkan nama grup produk',
    'product.namePlaceholder': 'Masukkan nama produk',
    'product.costPrice': 'Harga Modal',
    'product.sellingPrice': 'Harga Jual',
    'product.deliveryCommission': 'Komisi Pengirim',
    'product.category': 'Kategori',
    'product.selectCategory': 'Pilih kategori',
    'product.brand': 'Brand',
    'product.selectBrand': 'Pilih brand',
    'product.stock': 'Stok',
    'product.weightMl': 'Berat/Item (ml)',
    'product.itemsPerCarton': 'Isi 1 Dus',
    'product.totalWeightKg': 'Total Berat ( kg )',
    'product.storageLocation': 'Penyimpanan',
    'product.selectStorage': 'Pilih lokasi penyimpanan',
    'product.activeProduct': 'Produk Aktif',
    'product.sellByUnit': 'Jual Satuan',
    'product.showInPos': 'Tampil di POS',
    'product.showInPwa': 'Tampil di PWA',
    'product.trackStockCard': 'Kartu Stok',
    'product.variants': 'Varian',
    'product.productVariants': 'VARIAN PRODUK',
    'product.variantLabel': 'VARIAN',
    'product.addVariant': 'Tambah Varian',
    'product.deleteVariant': 'Hapus Varian',
    'product.collapseVariant': 'Ciutkan Varian',
    'product.expandVariant': 'Buka Varian',
    'product.submitProduct': 'Simpan Produk',
    'product.mainPhoto': 'Foto Utama',
    'product.uploadMainPhoto': 'Unggah Foto Utama',
    'product.mainPhotoDescription':
      'Digunakan sebagai foto produk utama pada POS & PWA, serta menjadi cadangan otomatis untuk varian yang belum memiliki foto sendiri.',
    'product.photoFormatHint': 'Format: JPG, PNG, WebP (Kompres otomatis 800px)',
    'product.clickToPickPhoto': 'Klik untuk memilih foto',
    'product.uploadedBadge': 'Terunggah',
    'product.variantPhoto': 'Foto Varian',
    'product.fallbackMainPhoto': 'Cadangan: Foto Utama',
    'product.clickToPickShort': 'Klik pilih',
    'product.imageGallery': 'Galeri Foto',
    'product.uploadGallery': 'Unggah Galeri',
    'product.piecesInOneCarton': 'Isi 1 Dus',
    'product.cartonSellingPrice': 'Harga Jual 1 Dus',
    'product.mainUnitCost': 'Modal Unit Utama',
    'product.autoUnitSellingPrice': 'Harga Jual Satuan (Otomatis)',
    'product.autoUnitCostPrice': 'Modal Satuan (Otomatis)',
    'product.mainUnitStock': 'Stok Unit Utama',
    'product.unitStock': 'Stok Satuan',
    'product.mainUnitLabel': 'Produk Unit',
    'product.subUnitLabel': 'Unit Satuan',
    'product.addCategoryTitle': 'Tambah Kategori Baru',
    'product.addBrandTitle': 'Tambah Brand Baru',
    'product.addStorageTitle': 'Tambah Lokasi Penyimpanan',
    'product.enterNamePlaceholder': 'Masukkan nama...',

    // Inventory & Orders
    'inventory.stock': 'Stok Inventaris',
    'inventory.stockIn': 'Stok Masuk',
    'inventory.stockOut': 'Stok Keluar',
    'inventory.stockOpname': 'Stok Opname',
    'inventory.movement': 'Pergerakan Stok',
    'inventory.criticalStock': 'Stok Kritis',
    'orders.title': 'Pesanan Online & Pengiriman',
    'orders.subtitle': 'Kelola antrean pesanan pelanggan PWA, penugasan kurir, dan status pengiriman secara real-time.',

    // Legacy flat keys
    pos_terminal: 'BUKA POS MACHINE',
    dashboard_admin: 'Dashboard Admin',
    transactions: 'Transaksi Penjualan',
    financial_assets: 'Aset Finansial',
    product_carton: 'Halaman Produk',
    ai_anti_fraud: 'AI Anti-Fraud',
    restock_advisor: 'Restock Advisor',
    client_pwa: 'Client PWA',
    settings: 'Pengaturan',
    lang_toggle: 'Ganti Bahasa',
    product_management: 'Halaman Produk',
    add_product: 'Tambah Produk',
    add_product_subtitle:
      'Lengkapi formulir di bawah ini untuk menambahkan produk baru ke katalog Mesin Kasir POS & Aplikasi Online Pelanggan (PWA).',
    back: 'Kembali',
    photo_format_hint: 'Format: JPG, PNG, WebP (Kompres otomatis 800px)',
    change_image: 'Ganti Foto',
    delete_image: 'Hapus',
    click_to_pick: 'Klik untuk memilih foto',
    uploaded_badge: 'Terunggah',
    upload_image_btn: 'Unggah Foto',
    search: 'Cari...',
    filter: 'Filter',
    status: 'Status',
    actions: 'Aksi',
    active: 'Aktif',
    paused: 'Dijeda',
    all: 'Semua',
    cancel: 'Batal',
    save: 'Simpan',
  },
  en: {
    // Common
    'common.save': 'Save',
    'common.saving': 'Saving...',
    'common.cancel': 'Cancel',
    'common.loading': 'Loading...',
    'common.error': 'An Error Occurred',
    'common.back': 'Back',
    'common.close': 'Close',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.add': 'Add',
    'common.search': 'Search...',
    'common.filter': 'Filter',
    'common.refresh': 'Refresh',
    'common.status': 'Status',
    'common.actions': 'Actions',
    'common.active': 'Active',
    'common.inactive': 'Inactive',
    'common.paused': 'Paused',
    'common.all': 'All',
    'common.on': 'ON',
    'common.off': 'OFF',
    'common.dark': 'Dark',
    'common.light': 'Light',
    'common.upload': 'Upload',
    'common.change': 'Change',
    'common.addNewOption': '+ Add new...',
    'common.file': 'File:',

    // Product & /produk/tambah
    'product.managementTitle': 'Product Pages',
    'product.managementSubtitle':
      'Manage Product Catalog, Product Bundles (Cartons/Boxes), Categories & Brands, and Discounts & Tier Pricing in real time.',
    'product.add': 'Add Product',
    'product.addSubtitle':
      'Fill out the form below to add a new item into the POS Machine catalog & Customer Online PWA.',
    'product.edit': 'Edit Product',
    'product.name': 'Product Name',
    'product.groupNamePlaceholder': 'Enter product group name',
    'product.namePlaceholder': 'Enter product name',
    'product.costPrice': 'Cost Price',
    'product.sellingPrice': 'Selling Price',
    'product.deliveryCommission': 'Courier Commission',
    'product.category': 'Category',
    'product.selectCategory': 'Select category',
    'product.brand': 'Brand',
    'product.selectBrand': 'Select brand',
    'product.stock': 'Stock',
    'product.weightMl': 'Weight/Item (ml)',
    'product.itemsPerCarton': 'Items per Carton',
    'product.totalWeightKg': 'Total Weight ( kg )',
    'product.storageLocation': 'Storage',
    'product.selectStorage': 'Select storage location',
    'product.activeProduct': 'Active Product',
    'product.sellByUnit': 'Sell by Unit',
    'product.showInPos': 'Show in POS',
    'product.showInPwa': 'Show in PWA',
    'product.trackStockCard': 'Stock Card',
    'product.variants': 'Variants',
    'product.productVariants': 'PRODUCT VARIANTS',
    'product.variantLabel': 'VARIANT',
    'product.addVariant': 'Add Variant',
    'product.deleteVariant': 'Delete Variant',
    'product.collapseVariant': 'Collapse Variant',
    'product.expandVariant': 'Expand Variant',
    'product.submitProduct': 'Save Product',
    'product.mainPhoto': 'Main Photo',
    'product.uploadMainPhoto': 'Upload Main Photo',
    'product.mainPhotoDescription':
      'Used as the primary product image across POS & PWA, and automatically serves as the fallback image for variants without a dedicated photo.',
    'product.photoFormatHint': 'Formats: JPG, PNG, WebP (Auto-compressed 800px)',
    'product.clickToPickPhoto': 'Click to select photo',
    'product.uploadedBadge': 'Uploaded',
    'product.variantPhoto': 'Variant Photo',
    'product.fallbackMainPhoto': 'Fallback: Main Photo',
    'product.clickToPickShort': 'Click to select',
    'product.imageGallery': 'Image Gallery',
    'product.uploadGallery': 'Upload Gallery',
    'product.piecesInOneCarton': 'Items per Carton',
    'product.cartonSellingPrice': '1 Carton Selling Price',
    'product.mainUnitCost': 'Main Unit Cost Price',
    'product.autoUnitSellingPrice': 'Unit Selling Price (Auto)',
    'product.autoUnitCostPrice': 'Unit Cost Price (Auto)',
    'product.mainUnitStock': 'Main Unit Stock',
    'product.unitStock': 'Loose Unit Stock',
    'product.mainUnitLabel': 'Main Packaging Unit',
    'product.subUnitLabel': 'Sub Packaging Unit',
    'product.addCategoryTitle': 'Add New Category',
    'product.addBrandTitle': 'Add New Brand',
    'product.addStorageTitle': 'Add Storage Location',
    'product.enterNamePlaceholder': 'Enter name...',

    // Inventory & Orders
    'inventory.stock': 'Inventory Stock',
    'inventory.stockIn': 'Stock In',
    'inventory.stockOut': 'Stock Out',
    'inventory.stockOpname': 'Stock Opname',
    'inventory.movement': 'Stock Movement',
    'inventory.criticalStock': 'Critical Stock',
    'orders.title': 'Online Orders & Delivery',
    'orders.subtitle': 'Manage customer PWA order queues, courier dispatch, and live delivery status.',

    // Legacy flat keys
    pos_terminal: 'BUKA POS MACHINE',
    dashboard_admin: 'Admin Dashboard',
    transactions: 'Sales Transactions',
    financial_assets: 'Financial Assets',
    product_carton: 'Product Pages',
    ai_anti_fraud: 'AI Anti-Fraud',
    restock_advisor: 'Restock Advisor',
    client_pwa: 'Client PWA',
    settings: 'Settings',
    lang_toggle: 'Switch Language',
    product_management: 'Product Pages',
    add_product: 'Add Product',
    add_product_subtitle:
      'Fill out the form below to add a new item into the POS Machine catalog & Customer Online PWA.',
    back: 'Back',
    photo_format_hint: 'Formats: JPG, PNG, WebP (Auto-compressed 800px)',
    change_image: 'Change Image',
    delete_image: 'Delete',
    click_to_pick: 'Click to select photo',
    uploaded_badge: 'Uploaded',
    upload_image_btn: 'Upload Image',
    search: 'Search...',
    filter: 'Filter',
    status: 'Status',
    actions: 'Actions',
    active: 'Active',
    paused: 'Paused',
    all: 'All',
    cancel: 'Cancel',
    save: 'Save',
  },
};

/**
 * Comprehensive Indonesian <-> English phrase dictionary
 * Covers Admin Dashboard, 4 Ecosystem Area Line Charts, MyAsset, Product Pages,
 * POS Cashier Terminal, Orders, Cash Reports, Vaults, RBAC, AI Modules, and Client PWA.
 */
export const ID_TO_EN_PHRASES: Array<[string, string]> = [
  // ============================================================================
  // A. SIDEBAR & NAVIGASI UTAMA
  // ============================================================================
  ['A. KECERDASAN BUATAN (AI)', 'A. ARTIFICIAL INTELLIGENCE'],
  ['B. MULTI OUTLET & GUDANG', 'B. MULTI OUTLET & WAREHOUSE'],
  ['C. SHIFT & KASIR', 'C. SHIFT & CASHIER'],
  ['D. DASHBOARD ANALITIK', 'D. ANALYTICS DASHBOARD'],
  ['E. HALAMAN PRODUK', 'E. PRODUCT PAGES'],
  ['F. PEMBELIAN PRODUK', 'F. PRODUCT PROCUREMENT'],
  ['G. TRANSAKSI POS', 'G. POS TRANSACTIONS'],
  ['H. LACAK INVENTORY', 'H. INVENTORY TRACKING'],
  ['I. PELANGGAN & MEMBER', 'I. CUSTOMERS & MEMBERS'],
  ['J. MARKETING & PROMOSI', 'J. MARKETING & PROMOTIONS'],
  ['K. STAFF & WORKFORCE', 'K. STAFF & WORKFORCE'],
  ['L. KEUANGAN & BRANGKAS', 'L. FINANCE & VAULTS'],
  ['M. ONLINE ORDER & WEBSITE', 'M. ONLINE ORDER & WEBSITE'],
  ['N. PENGATURAN PWA', 'N. PWA SETTINGS'],
  ['O. PENGATURAN POS', 'O. POS SETTINGS'],
  ['P. INTEGRASI PAYMENT', 'P. PAYMENT INTEGRATION'],

  ['Halaman Produk', 'Product Pages'],
  ['Katalog Produk', 'Product Catalog'],
  ['Daftar Produk', 'Product List'],
  ['Log Produk', 'Product Logs'],
  ['Paket Bundling', 'Product Bundles'],
  ['Paket Produk', 'Product Bundles'],
  ['Kategori & Brand', 'Categories & Brands'],
  ['Diskon & Harga Grosir', 'Discounts & Tier Pricing'],
  ['Harga Diskon', 'Discount Pricing'],
  ['Transaksi POS', 'POS Transactions'],
  ['Pembelian Produk', 'Product Procurement'],
  ['Lacak Inventory', 'Inventory Tracking'],
  ['Marketing & Promosi', 'Marketing & Promotions'],
  ['Keuangan & Brangkas', 'Finance & Vaults'],
  ['Keuangan & Brankas', 'Finance & Vaults'],
  ['Brangkas Toko', 'Store Vault'],
  ['Brankas Toko', 'Store Vault'],
  ['Brangkas Modal', 'Capital Vault'],
  ['Brankas Modal', 'Capital Vault'],
  ['Brangkas Untung', 'Profit Vault'],
  ['Brankas Untung', 'Profit Vault'],
  ['Jenis Jurnal', 'Journal Types'],
  ['Tipe Keuangan', 'Journal Types'],
  ['Riwayat Keuangan', 'Financial History'],
  ['Otoritas Akses', 'Access Authority (RBAC)'],
  ['Hak & Akses', 'Roles & Permissions'],
  ['Pengaturan PWA', 'PWA Settings'],
  ['Pengaturan POS', 'POS Settings'],
  ['Kosongkan Data (0)', 'Clear All Data (0)'],
  ['Reset Database (0 Data)', 'Reset Database (0 Data)'],
  ['Reset Database', 'Reset Database'],
  ['MENU UTAMA', 'MAIN MENU'],
  ['Menu Utama', 'Main Menu'],
  ['Navigasi Cepat Antar Modul', 'Quick Module Navigation'],
  ['Buka AI Hub', 'Open AI Hub'],
  ['Daftar AI Agent', 'AI Agent List'],
  ['Asisten Pintar Gemini 2.5 Flash', 'Smart Assistant Gemini 2.5 Flash'],
  ['AI AGENT (FITUR CERDAS)', 'AI AGENT (SMART FEATURES)'],
  ['AI Agent (Fitur Cerdas)', 'AI Agent (Smart Features)'],
  ['BUKA POS MACHINE', 'BUKA POS MACHINE'],
  ['Terminal Kasir POS', 'BUKA POS MACHINE'],
  ['Mesin Kasir POS', 'POS Cashier Machine'],
  ['Dashboard Admin', 'Admin Dashboard'],
  ['Dashboard Utama', 'Main Dashboard'],
  ['Transaksi Penjualan', 'Sales Transactions'],
  ['Aset Finansial', 'Financial Assets'],
  ['Asset Toko', 'Store Assets'],
  ['My Asset', 'My Assets'],
  ['Laporan Kas', 'Cash Reports'],
  ['Laporan Penjualan & Kas', 'Sales & Cash Reports'],
  ['Pengaturan Sistem', 'System Settings'],
  ['Ganti Bahasa', 'Switch Language'],
  ['Keluar / Logout', 'Sign Out / Logout'],

  // ============================================================================
  // B. HALAMAN UTAMA `/dashboard` & 4 AREA CHART LINE
  // ============================================================================
  ['Pusat Analitik Bisnis', 'Business Analytics Hub'],
  ['Visualisasi 4 Area Chart Line Ekosistem', '4 Ecosystem Area Line Charts Visualization'],
  [
    'Monitoring real-time Penjualan, Asset Produk, Pembelian, serta Stok vs Stock In vs Penjualan dengan filter per produk.',
    'Real-time monitoring of Sales, Product Assets, Purchases, and Stock vs Stock In vs Sales with per-product filters.',
  ],
  ['Semua Chart (Grid 4)', 'All Charts (Grid 4)'],
  ['1. Area Chart Line Penjualan', '1. Sales Area Line Chart'],
  ['2. Area Chart Line Asset Produk', '2. Product Asset Area Line Chart'],
  ['3. Area Chart Line Pembelian', '3. Purchase Area Line Chart'],
  ['4. Area Chart Line : Stok vs Stock In vs Penjualan', '4. Area Line Chart: Stock vs Stock In vs Sales'],
  ['4. Area Chart Line: Stok vs Stock In vs Penjualan', '4. Area Line Chart: Stock vs Stock In vs Sales'],
  ['Stok vs Barang Masuk vs Penjualan', 'Stock vs Stock In vs Sales'],
  ['Stok vs Stock In vs Penjualan', 'Stock vs Stock In vs Sales'],
  ['Valuasi Aset Produk', 'Product Asset Valuation'],
  ['Total Pembelian', 'Total Purchases'],
  ['Stok vs Masuk vs Jual', 'Stock vs In vs Sold'],
  ['Semua Produk', 'All Products'],
  ['Dus Terjual', 'Cartons Sold'],
  ['Unit Terjual', 'Units Sold'],
  ['Today (Jam)', 'Today (Hourly)'],
  ['Hari Ini (Jam)', 'Today (Hourly)'],
  ['Hari Ini', 'Today'],
  ['7 Hari', '7 Days'],
  ['14 Hari', '14 Days'],
  ['30 Hari', '30 Days'],
  ['Bulan Ini', 'This Month'],
  ['Tahunan', 'Yearly'],
  ['Kurva: Halus', 'Curve: Smooth'],
  ['Kurva: Tajam', 'Curve: Sharp'],
  ['Kurva: Linear', 'Curve: Linear'],
  ['Tampilkan Titik', 'Show Points'],
  ['Sembunyikan Titik', 'Hide Points'],
  ['Ringkasan Eksekutif Real-Time', 'Real-Time Executive Summary'],
  [' Penjualan Bersih', ' Net Sales'],
  ['Total Omzet Penjualan', 'Total Sales Revenue'],
  ['Rata-rata Nilai Transaksi', 'Average Order Value'],
  ['Belum ada transaksi pada periode ini', 'No transactions in this period yet'],

  // ============================================================================
  // C. HALAMAN `/dashboard/myasset` & `/dashboard/produk`
  // ============================================================================
  ['Modal Bersih', 'Net Capital'],
  ['Modal (COGS) Stok (HPP)', 'Stock Capital (COGS)'],
  ['Modal Stok (HPP)', 'Stock Capital (COGS)'],
  ['Nilai Jual Stok', 'Stock Selling Value'],
  ['Kas & Brangkas Aktif', 'Active Cash & Vaults'],
  ['Kas & Brankas Aktif', 'Active Cash & Vaults'],
  ['Piutang Customer', 'Customer Receivables'],
  ['Piutang Pelanggan', 'Customer Receivables'],
  ['Hutang Supplier', 'Supplier Payables'],
  ['Aset Tetap & Alat', 'Fixed Assets & Equipment'],
  ['Aset Tetap Toko', 'Store Fixed Assets'],
  ['Potensi Laba', 'Potential Profit'],
  ['Potensi Laba Kotor', 'Potential Gross Profit'],
  ['Rata-rata Margin', 'Average Margin'],
  ['Laci Tunai', 'Cash Drawer'],
  ['Laci Kasir POS', 'POS Cash Drawer'],
  ['Tagihan Masuk Toko', 'Incoming Store Bills'],
  ['Kewajiban Pembelian', 'Purchase Obligations'],
  ['Expired Date Produk', 'Product Expiry Date'],
  ['Valuasi Aset Stok per Kategori', 'Stock Asset Valuation by Category'],
  ['Kesehatan & Perputaran Modal (COGS) Stok', 'Stock Capital (COGS) Health & Turnover'],
  ['Top 5 Konsentrasi Modal (COGS)', 'Top 5 Capital (COGS) Concentration'],
  ['Total Amount Kerugian Jika Expired', 'Total Loss Value if Expired'],
  ['Nilai Kerugian Jika Expired', 'Total Loss Value if Expired'],
  ['Risiko Mendekati Expired', 'Near-Expiry Risk'],
  ['Aman > 30 Hari', 'Safe > 30 Days'],
  ['Waspada 14 - 30 Hari', 'Warning 14 - 30 Days'],
  ['Kritis < 14 Hari / Expired', 'Critical < 14 Days / Expired'],
  ['Tidak ada produk untuk filter status kadaluarsa ini.', 'No products match this expiry status filter.'],
  ['Belum ada data produk di Cloud Firestore.', 'No product data in Cloud Firestore yet.'],
  ['Belum ada data produk & transaksi untuk dianalisis.', 'No product & transaction data to analyze yet.'],
  ['Tanggal Produksi', 'Production Date'],
  ['Tanggal Kadaluarsa', 'Expiry Date'],
  ['Tanggal Expired', 'Expiry Date'],
  ['Masa Simpan', 'Shelf Life'],
  ['Sisa Umur Simpan', 'Remaining Shelf Life'],
  ['Isi 1 Dus', 'Items per Carton'],
  ['Total Berat ( kg )', 'Total Weight ( kg )'],
  ['Total Berat (kg)', 'Total Weight (kg)'],
  ['Penyimpanan', 'Storage'],
  ['Lokasi Penyimpanan', 'Storage Location'],
  ['Simpan Produk', 'Save Product'],
  ['Stok Produktif', 'Productive Stock'],
  ['Stok Mati (Dead Stock)', 'Dead Stock'],
  ['Stok Menipis (Low Stock)', 'Low Stock'],
  ['Stok Habis (Out of Stock)', 'Out of Stock'],
  ['Tambah Aset Tetap', 'Add Fixed Asset'],
  ['Catat Mutasi Brankas', 'Record Vault Mutation'],
  ['Peralatan Toko', 'Store Equipment'],
  ['Elektronik & Kasir', 'Electronics & POS'],
  ['Pendingin / Chiller', 'Cooler / Chiller'],
  ['Kendaraan', 'Vehicles'],
  ['Properti & Rak', 'Property & Racks'],
  ['Perlu Servis', 'Needs Service'],

  // ============================================================================
  // D. HALAMAN POS, ORDERS, TRANSAKSI, SHIFT, LAPORAN KAS, BRANGKAS & PWA
  // ============================================================================
  ['Order Baru', 'New Order'],
  ['Pesanan Baru', 'New Order'],
  ['Cari Customer', 'Find Customer'],
  ['Cari Pelanggan', 'Find Customer'],
  ['Antrean PWA', 'PWA Queue'],
  ['Alert Kadaluarsa', 'Expiry Alert'],
  ['Belum ada pesanan PWA masuk', 'No incoming PWA orders yet'],
  ['Pilih Pengirim (Kurir / Staff)', 'Select Courier / Shipper'],
  ['Pengirim (Kurir / Staff)', 'Select Courier / Shipper'],
  ['Pilih Pengirim', 'Select Courier / Shipper'],
  ['Tanpa Pengirim (Ambil di Kasir / Walk-in)', 'Self Pickup (Walk-in / No Courier)'],
  ['Ambil Sendiri', 'Self Pickup (Walk-in / No Courier)'],
  ['Uang Diterima', 'Cash Received'],
  ['Kurang Bayar', 'Underpaid / Short'],
  ['Kembalian', 'Change'],
  ['Total Untung', 'Profit'],
  ['Total Nilai', 'Total Value'],
  ['Total Jual', 'Total Sales'],
  ['Belum Lunas', 'Unpaid'],
  ['Sudah Lunas', 'Paid'],
  ['Laporan Produk', 'Product Reports'],
  ['Laporan Keseluruhan Produk', 'Overall Product Report'],
  ['Rincian Produk Masuk', 'Incoming Product Details'],
  ['Rincian Produk Keluar', 'Outgoing Product Details'],
  ['Laporan Pembelian', 'Purchase Report'],
  ['Laporan Penjualan', 'Sales Report'],
  ['Laporan Keseluruhan Penjualan', 'Overall Sales Report'],
  ['Rincian Penjualan', 'Sales Details'],
  ['Rincian Penjualan Backdate', 'Backdated Sales Details'],
  ['Rincian Penjualan - Online Order', 'Online Order Sales Details'],
  ['Rincian Penjualan Food delivery', 'Food Delivery Sales Details'],
  ['Rincian Penjualan Marketplace', 'Marketplace Sales Details'],
  ['Rincian Penjualan Pending POS', 'Pending POS Sales Details'],
  ['Rincian Penjualan berdasarkan Jam', 'Hourly Sales Breakdown'],
  ['Item Penjualan berdasarkan Tanggal', 'Sales Items by Date'],
  ['Item Penjualan berdasarkan Brand', 'Sales Items by Brand'],
  ['Item Penjualan berdasarkan Kategori', 'Sales Items by Category'],
  ['Penjualan berdasarkan Petugas / Kasir', 'Sales by Cashier / Staff'],
  ['Penjualan berdasarkan Pelanggan', 'Sales by Customer'],
  ['Rincian Penggunaan Loyalty Point', 'Loyalty Point Usage Details'],
  ['Ringkasan Diskon & Promo', 'Discount & Promo Summary'],
  ['Pengeluaran berdasarkan Tanggal', 'Expenses by Date'],
  ['Laporan Arus Kas & Rekonsiliasi Laci', 'Cash Flow & Drawer Reconciliation Report'],
  ['Laba / Rugi & Gross Margin', 'Profit / Loss & Gross Margin'],
  ['Rincian Pembatalan / Void & Retur', 'Void / Cancellation & Return Details'],
  ['Kas Selisih & Rekonsiliasi Kasir', 'Cash Discrepancy & Cashier Reconciliation'],
  ['Laporan Penjualan Per Shift', 'Sales Report by Shift'],
  ['Laporan Pembayaran dan Kas', 'Payment & Cash Report'],
  ['Stok Sistem', 'System Stock'],
  ['Sumber Dana', 'Fund Source'],
  ['Tujuan Brangkas', 'Target Vault'],
  ['Tujuan Brankas', 'Target Vault'],
  ['Kas Masuk', 'Cash In'],
  ['Kas Keluar', 'Cash Out'],
  ['Hasil Penjualan POS', 'POS Sales Revenue'],
  ['Hasil Penjualan PWA', 'PWA Sales Revenue'],
  ['Profil Saya', 'My Profile'],
  ['Statistik Pembelian', 'Purchase Statistics'],
  ['Alamat Toko', 'Store Address'],
  ['Hadiah Target', 'Target Rewards'],
  ['Voucher Saya', 'My Vouchers'],
  ['Reward & Poin', 'Rewards & Points'],
  ['Top 10 Buyer', 'Top 10 Buyers'],
  ['Informasi', 'Information'],
  ['Chat Admin', 'Chat Admin'],
  ['Klaim Hadiah', 'Claim Reward'],
  ['Tukar Hadiah', 'Redeem Rewards'],
  ['Menunggu Persetujuan', 'Pending Approval'],
  ['Disetujui', 'Approved'],
  ['Ditolak', 'Rejected'],

  // ============================================================================
  // E. OTORITAS AKSES (RBAC) & STAFF WORKFORCE
  // ============================================================================
  ['Aturan Otoritas Hak Akses Sistem (RBAC)', 'System Role-Based Access Control (RBAC)'],
  ['Manajemen Role / Jabatan', 'Role / Position Management'],
  ['+ Tambah Role / Jabatan Baru', '+ Add New Role / Position'],
  ['+ Tambah Aturan Otoritas Baru', '+ Add New Authority Rule'],
  ['Lihat Halaman (View)', 'View Page (View)'],
  ['Tambah Data (Create)', 'Create Data (Create)'],
  ['Edit Data (Update)', 'Edit Data (Update)'],
  ['Hapus Data (Delete)', 'Delete Data (Delete)'],
  ['Approve / Otorisasi Khusus', 'Special Approval / Authorization'],
  ['Simulasi Role Aktif', 'Active Role Simulation'],
  ['Akses Ditolak — Otoritas Tidak Mencukupi', 'Access Denied — Insufficient Authority'],
  ['Beralih ke Mode Owner (Full Access)', 'Switch to Owner Mode (Full Access)'],
  ['Buka Mesin Kasir POS', 'Open POS Cashier Machine'],
  ['Sembunyikan Harga Modal (HPP) & Margin Laba', 'Hide Cost Price (COGS) & Profit Margin'],
  ['Wajib PIN Supervisor Saat Void / Refund', 'Require Supervisor PIN on Void / Refund'],

  // ============================================================================
  // F. FORM PRODUK, BUNDLING, KATEGORI, DISKON & GUDANG
  // ============================================================================
  [
    'Pusat kelola Daftar Produk, Paket Produk (Dus/Karton), Kategori & Brand, serta Pengaturan Harga Diskon.',
    'Manage Product Catalog, Product Bundles (Carton/Box), Categories & Brands, and Discount Pricing.',
  ],
  [
    'Pusat kelola List Produk, Paket Produk (Dus/Karton), Kategori & Brand, serta Pengaturan Harga Diskon.',
    'Manage Product List, Product Bundles (Carton/Box), Categories & Brands, and Discount Pricing.',
  ],
  [
    'Lengkapi formulir di bawah ini untuk menambahkan produk baru ke katalog Mesin Kasir POS & Aplikasi Online Pelanggan (PWA).',
    'Fill out the form below to add a new product to the POS Cashier catalog & Customer Online PWA.',
  ],
  [
    'Digunakan sebagai foto produk utama pada POS & PWA, serta menjadi cadangan otomatis untuk varian yang belum memiliki foto sendiri.',
    'Used as the primary product photo on POS & PWA, and automatically serves as a fallback for variants without their own photo.',
  ],
  ['Formats: JPG, PNG, WebP (Auto-kompres 800px)', 'Formats: JPG, PNG, WebP (Auto-compressed 800px)'],
  ['Format: JPG, PNG, WebP (Kompres otomatis 800px)', 'Formats: JPG, PNG, WebP (Auto-compressed 800px)'],
  ['Upload Foto Utama', 'Upload Main Photo'],
  ['Unggah Foto Utama', 'Upload Main Photo'],
  ['Foto Utama', 'Main Photo'],
  ['Foto Varian', 'Variant Photo'],
  ['Cadangan: Foto Utama', 'Fallback: Main Photo'],
  ['Upload Galeri', 'Upload Gallery'],
  ['Unggah Galeri', 'Upload Gallery'],
  ['Galeri Foto', 'Image Gallery'],
  ['Klik untuk memilih foto', 'Click to select photo'],
  ['Klik pilih', 'Click to select'],
  ['Masukkan nama grup produk', 'Enter product group name'],
  ['Masukkan nama produk', 'Enter product name'],
  ['Pilih lokasi penyimpanan', 'Select storage location'],
  ['Pilih kategori', 'Select category'],
  ['Pilih brand', 'Select brand'],
  ['+ Tambah baru...', '+ Add new...'],
  ['Tambah Kategori Baru', 'Add New Category'],
  ['Tambah Brand Baru', 'Add New Brand'],
  ['Tambah Lokasi Penyimpanan', 'Add Storage Location'],
  ['Masukkan nama...', 'Enter name...'],
  ['Menyimpan...', 'Saving...'],
  ['Nama Produk', 'Product Name'],
  ['Harga Modal', 'Cost Price'],
  ['Harga Jual Satuan (Otomatis)', 'Unit Selling Price (Auto)'],
  ['Modal Satuan (Otomatis)', 'Unit Cost Price (Auto)'],
  ['Harga Jual 1 Dus', '1 Carton Selling Price'],
  ['Harga Jual', 'Selling Price'],
  ['Komisi Pengirim', 'Courier Commission'],
  ['Berat/Item (ml)', 'Weight/Item (ml)'],
  ['Item Produk', 'Items per Carton'],
  ['Produk Aktif', 'Active Product'],
  ['Jual Satuan', 'Sell by Unit'],
  ['Tampil di POS', 'Show in POS'],
  ['Tampil di PWA', 'Show in PWA'],
  ['Kartu Stok', 'Stock Card'],
  ['Modal Unit Utama', 'Main Unit Cost Price'],
  ['Stok Unit Utama', 'Main Unit Stock'],
  ['Stok Satuan', 'Loose Unit Stock'],
  ['Produk Unit', 'Main Packaging Unit'],
  ['Unit Satuan', 'Sub Packaging Unit'],
  ['VARIAN PRODUK', 'PRODUCT VARIANTS'],
  ['Tambah Varian', 'Add Variant'],
  ['Hapus Varian', 'Delete Variant'],
  ['Ciutkan Varian', 'Collapse Variant'],
  ['Buka Varian', 'Expand Variant'],
  ['Submit Produk', 'Save Product'],
  ['Barang Masuk', 'Stock In'],
  ['Barang Keluar', 'Stock Out'],
  ['Stok Opname', 'Stock Opname'],
  ['Pergerakan Stok', 'Stock Movement'],
  ['Stok Kritis', 'Critical Stock'],

  // ============================================================================
  // G. CLIENT PWA SCREENS
  // ============================================================================
  ['Agen Minuman Terpercaya', 'Trusted Beverage Distributor'],
  ['Terhubung langsung dengan sistem Kasir POS & Gudang Utama', 'Connected directly with the POS Cashier & Main Warehouse'],
  ['Grosir & Eceran Resmi', 'Official Wholesale & Retail'],
  ['Pesan Minuman', 'Order Beverages'],
  ['Lebih Mudah', 'More Easily'],
  ['Grosir minuman untuk toko anda,', 'Wholesale beverages for your store,'],
  ['Gampang pesannya, banyak promonya.', 'Easy ordering, plenty of promos.'],
  ['Ada rewardsnya..', 'Plus member rewards..'],
  ['Daftar Member', 'Register Member'],
  ['Coba Dulu (Demo)', 'Try Demo First'],
  ['Sudah punya akun?', 'Already have an account?'],
  ['Login Member', 'Member Login'],
  ['Masuk dengan Nomor WhatsApp terdaftar Anda', 'Sign in with your registered WhatsApp number'],
  ['Nomor WhatsApp', 'WhatsApp Number'],
  ['Contoh: 081289765432', 'Example: 081289765432'],
  ['Memproses Login...', 'Signing in...'],
  ['Masuk dengan WhatsApp', 'Sign In with WhatsApp'],
  ['Langkah 1 dari 2 • Identitas Toko & Pemilik', 'Step 1 of 2 • Store & Owner Identity'],
  ['Langkah 1 dari 2', 'Step 1 of 2'],
  ['Identitas Toko & Pemilik', 'Store & Owner Identity'],
  ['Data Member', 'Member Information'],
  ['Wajib Diisi', 'Required'],
  ['Nama Toko Anda', 'Your Store Name'],
  ['Nama Toko', 'Store Name'],
  ['Nama Pemilik', 'Owner Name'],
  ['No. WhatsApp Aktif', 'Active WhatsApp Number'],
  ['Buat Password', 'Create Password'],
  ['Minimal 6 karakter', 'Minimum 6 characters'],
  ['Mohon lengkapi semua kolom pendaftaran member.', 'Please complete all member registration fields.'],
  ['Nomor WhatsApp harus terdiri dari 10 hingga 13 digit angka.', 'WhatsApp number must be 10 to 13 digits.'],
  ['Password minimal terdiri dari 6 karakter.', 'Password must be at least 6 characters.'],
  ['Nomor sudah terdaftar, silakan Login', 'Phone number already registered, please Login'],
  ['Alamat & Lokasi Pengiriman', 'Delivery Address & Location'],
  ['Langkah 2 dari 2 • Koordinat GPS Kurir Toko', 'Step 2 of 2 • Store Courier GPS Coordinates'],
  ['Langkah 2 dari 2', 'Step 2 of 2'],
  ['Koordinat GPS Kurir Toko', 'Store Courier GPS Coordinates'],
  ['Alamat Lengkap Toko / Rumah', 'Full Store / Home Address'],
  ['Tulis alamat lengkap toko Anda (jalan, nomor, RT/RW, patokan)...', 'Enter your complete store address (street, number, block, landmark)...'],
  ['Patokan Lokasi / Catatan Kurir', 'Location Landmark / Courier Notes'],
  ['Contoh: Samping Masjid Al-Ikhlas, Pintu Gerbang Biru', 'Example: Next to Central Mosque, Blue Gate'],
  ['Titik Koordinat GPS Handphone', 'Mobile GPS Coordinate Pin'],
  ['Wajib Akses GPS HP', 'Mobile GPS Required'],
  ['Meminta Izin & Mengunci GPS Handphone...', 'Requesting Permission & Locking Mobile GPS...'],
  ['✓ Lokasi HP Akurat Didapatkan (Perbarui Titik GPS)', '✓ Accurate Mobile GPS Locked (Update GPS Pin)'],
  ['MINTA AKSES LOKASI GPS HANDPHONE', 'REQUEST MOBILE GPS LOCATION ACCESS'],
  ['Coba Minta Izin Lokasi Lagi', 'Retry Location Permission Request'],
  ['Alamat Terdeteksi dari GPS HP:', 'Address Detected from Mobile GPS:'],
  ['Gunakan Alamat Ini', 'Use This Address'],
  ['Menunggu GPS...', 'Waiting for GPS...'],
  ['Kalibrasi Ulang GPS HP', 'Recalibrate Mobile GPS'],
  ['Buka Google Maps', 'Open Google Maps'],
  ['Mengirim Kode OTP WhatsApp...', 'Sending WhatsApp OTP Code...'],
  ['Daftar Sekarang', 'Register Now'],
  ['Data alamat & koordinat GPS tersimpan aman untuk pengiriman kurir toko.', 'Address & GPS coordinates are securely saved for store courier delivery.'],
  ['Verifikasi Keamanan', 'Security Verification'],
  ['Kode OTP dikirim via WhatsApp', 'OTP Code sent via WhatsApp'],
  ['Verifikasi WhatsApp', 'WhatsApp Verification'],
  ['Masukkan 4 digit kode OTP yang telah dikirimkan melalui WhatsApp ke nomor:', 'Enter the 4-digit OTP code sent via WhatsApp to:'],
  ['Kode OTP Aktif:', 'Active OTP Code:'],
  ['(Klik Isi)', '(Click to Auto-Fill)'],
  ['Verifikasi & Mulai Belanja', 'Verify & Start Shopping'],
  ['Kirim ulang kode dalam', 'Resend code in'],
  ['Kirim Ulang Kode OTP WhatsApp', 'Resend WhatsApp OTP Code'],
  ['Terhubung dengan Fonnte WhatsApp Gateway & Cloud Firestore', 'Connected to Fonnte WhatsApp Gateway & Cloud Firestore'],
  ['Member VIP Terverifikasi', 'Verified VIP Member'],
  ['Mode Belanja Katalog', 'Catalog Shopping Mode'],
  ['Ubah Profil / Alamat Member', 'Edit Member Profile / Address'],
  ['Keranjang Belanja', 'Shopping Cart'],
  ['Keranjang Pesanan', 'Order Cart'],
  ['GPS Aktif', 'GPS Active'],
  ['Asisten Pemesanan Instan', 'Instant Order Assistant'],
  ['Diskon Member 5%', '5% Member Discount'],
  ['Pesan Cepat Minuman Dus & Satuan via AI', 'Quick Carton & Unit Beverage Ordering via AI'],
  ['Ketik pesanan dalam kalimat biasa, otomatis masuk keranjang dan terhubung ke kasir POS.', 'Type your order in plain language—automatically added to cart and synced to POS.'],
  ['Pesan via AI', 'Order via AI'],
  ['Pesan AI', 'AI Order'],
  ['Cari nama produk, minuman, dus, atau SKU...', 'Search product name, beverage, carton, or SKU...'],
  ['Katalog Grosir & Eceran Resmi', 'Official Wholesale & Retail Catalog'],
  ['Klik untuk memperbesar foto produk', 'Click to enlarge product photo'],
  ['Harga Dus:', 'Carton Price:'],
  ['Asisten AI Pemesanan', 'AI Order Assistant'],
  ['Ketik pesanan grosir/satuan otomatis masuk keranjang', 'Type wholesale/retail orders to auto-fill your cart'],
  ['AI sedang membaca produk & menghitung kuantitas...', 'AI is reading products & calculating quantities...'],
  ['Tulis pesanan Anda (misal: Kopi 2 dus)...', 'Type your order (e.g., 2 cartons Coffee)...'],
  ['Jenis Barang Terpilih', 'Selected Item Lines'],
  ['Keranjang Belanja Kosong', 'Your Shopping Cart is Empty'],
  ['Pilih minuman dari katalog belanja atau gunakan asisten AI.', 'Select beverages from the catalog or use the AI assistant.'],
  ['Kembali ke Katalog Belanja', 'Back to Shopping Catalog'],
  ['Alamat & Kontak Pengiriman', 'Delivery Address & Contact'],
  ['Tervalidasi GPS', 'GPS Validated'],
  ['Nama Pemesan', 'Customer Name'],
  ['No. WhatsApp', 'WhatsApp No.'],
  ['Alamat lengkap tujuan pengiriman...', 'Full delivery destination address...'],
  ['Metode Pembayaran', 'Payment Method'],
  ['QRIS Instan', 'Instant QRIS'],
  ['COD / Tunai', 'COD / Cash'],
  ['Transfer Bank', 'Bank Transfer'],
  ['Subtotal Belanja', 'Order Subtotal'],
  ['Diskon Khusus Member (5%)', 'VIP Member Discount (5%)'],
  ['Ongkos Kirim (Radius Toko)', 'Delivery Fee (Store Radius)'],
  ['Total Pembayaran', 'Total Payment'],
  ['Mengirim Pesanan ke Kasir POS...', 'Sending Order to POS Cashier...'],
  ['Konfirmasi & Kirim Pesanan ke POS', 'Confirm & Send Order to POS'],
  ['Riwayat & Status Pesanan', 'Order History & Status'],
  ['Terhubung Real-Time dengan Kasir POS', 'Real-Time Synced with POS Cashier'],
  ['Filter No. HP Saya', 'Filter My Phone Number'],
  ['Lihat Semua Pesanan Toko', 'Show All Store Orders'],
  ['Tampilkan Semua Pesanan Toko', 'Show All Store Orders'],
  ['Cari ID pesanan atau nama produk...', 'Search order ID or product name...'],
  ['Belum ada riwayat pesanan', 'No order history yet'],
  ['Mulai Belanja Sekarang', 'Start Shopping Now'],
  ['Item Pesanan', 'Order Items'],
  ['Sembunyikan', 'Hide Details'],
  ['Lihat Rincian', 'View Details'],
  ['Pesanan Berhasil Dikirim!', 'Order Successfully Sent!'],
  ['ID Transaksi:', 'Transaction ID:'],
  ['Nama Pemesan:', 'Customer Name:'],
  ['Metode Pembayaran:', 'Payment Method:'],
  ['Status Kasir POS:', 'POS Cashier Status:'],
  ['Terhubung ke Antrean Kasir', 'Connected to Cashier Queue'],
  ['Total Tagihan:', 'Total Billed:'],
  ['Pantau Progres di Riwayat Pesanan', 'Track Progress in Order History'],
  ['Kembali ke Halaman Belanja', 'Back to Shopping Catalog'],

  // ============================================================================
  // H. AI INTELLIGENCE MODULES & ENTERPRISE SHARED PHRASES
  // ============================================================================
  ['Analisis Margin Laba per Kemasan (Dus vs Satuan)', 'Profit Margin Analysis by Packaging (Carton vs Unit)'],
  ['Penasihat Restock Strategis', 'Strategic Restock Advisor'],
  ['AI Advisor Pembelian', 'AI Advisor Purchase'],
  ['Parser Intensi & Typo Pesanan', 'Order Intent & Typo Parser'],
  ['AI Chat Klien PWA', 'AI Chat Client PWA'],
  ['AI Pencegahan Kerugian', 'Loss Prevention AI'],
  ['Deteksi Kecurangan AI & Geofence', 'AI Anti-Fraud & Geofence Shield'],
  [
    'Intersepsi ancaman berlapis yang mengevaluasi telemetri Geofence, tanda tangan GPS palsu, kecepatan stok dus, dan heuristik transaksi berulang.',
    'Multi-layered threat interception evaluating Geofence telemetry, Mock GPS signatures, carton inventory velocity, and repetitive burst heuristics.',
  ],
  ['Perimeter Presisi 500m', '500m Precision Perimeter'],
  [
    'Verifikasi geodesik haversine ketat memblokir pesanan luar wilayah yang menyamar sebagai pelanggan lokal.',
    'Strict geodesic haversine verification blocks remote out-of-region orders masquerading as local customers.',
  ],
  ['Telemetri GPS Palsu', 'Mock GPS Telemetry'],
  ['Audit Sinyal Sensor', 'Sensor Signature Audit'],
  [
    'Menandai laporan akurasi sintetis 0.00m, koordinat emulator tetap, dan lompatan koordinat instan.',
    'Flags synthetic 0.00m accuracy reports, fixed emulator coords, and teleportation coordinate jumps.',
  ],
  ['Filter Pengurasan Dus', 'Carton Drain Filter'],
  ['Perisai Borongan Grosir', 'Bulk Wholesaling Shield'],
  [
    'Mendeteksi pembelian dus borongan mencurigakan yang dirancang menguras stok ritel secara cepat.',
    'Detects suspicious wholesale bulk carton purchases designed to rapidly drain scarce retail inventory.',
  ],
  ['Monitor Lonjakan Kecepatan', 'Velocity Burst Monitor'],
  ['Penangkal Bot Penimbun', 'Scalper Bot Breaker'],
  [
    'Menangkal permintaan pesanan beruntun otomatis dari nomor telepon atau identitas pembayaran yang sama.',
    'Intercepts automated rapid-fire order requests from identical phone tokens or card fingerprints.',
  ],
  ['Simulasi Forensik AI Langsung (Sandbox)', 'Live AI Forensic Simulation Sandbox'],
  [
    'Ubah parameter transaksi dan amati evaluasi ancaman oleh Gemini AI secara real-time.',
    'Tweak checkout parameters and watch Gemini AI evaluate the threat payload in real time.',
  ],
  ['Menganalisis dengan Gemini...', 'Analyzing with Gemini...'],
  ['Jalankan Audit Forensik AI', 'Run AI Forensic Audit'],
  ['Saluran Transaksi', 'Checkout Channel'],
  ['Client PWA (Web Seluler Jarak Jauh)', 'Client PWA (Remote Mobile Web)'],
  ['Terminal Kasir POS Langsung', 'In-Person POS Cashier Terminal'],
  ['Jumlah Dus Dipesan:', 'Bulk Dus / Cartons Ordered:'],
  ['Total Nilai Transaksi:', 'Total Transaction Value:'],
  ['Jarak ke Toko (Geofence: 500m):', 'Distance to Store (Geofence: 500m):'],
  ['Melanggar Batas Geofence 500m!', 'Breaches 500m Geofence Boundary!'],
  ['Di Dalam Radius Geofence Aman', 'Inside Safe Retail Geofence'],
  ['Akurasi GPS Terlapor:', 'Reported GPS Accuracy:'],
  ['Kecepatan Pesanan dalam 10 Menit:', 'Order Velocity within 10 Mins:'],
  ['Memicu peringatan kecepatan bot penimbun', 'Triggers scalper bot velocity warning'],
  ['Kecepatan belanja pelanggan normal', 'Normal human shopping speed'],
  ['Preset Cepat:', 'Quick Presets:'],
  ['Transaksi Normal', 'Clean Walk-in'],
  ['Simulasi Bot Palsu', 'Spoofed Bot'],
  ['Modal Restock Dibutuhkan', 'Restock Capital Required'],
  ['Estimasi nilai PO grosir', 'Projected wholesale PO amount'],
  ['Total Kebutuhan Dus', 'Total Bulk Cartons'],
  ['Dikemas per dus utuh', 'Packaged to avoid broken lots'],
  ['Item Tindakan Kritis', 'Critical Action Items'],
  ['Mendekati habis stok', 'Approaching imminent stockout'],
  ['Ringkasan Eksekutif Gemini:', 'Gemini Executive Forecast:'],
  ['Transaksi Langsung', 'Live Transactions'],
  ['Aliran Real-Time', 'Real-Time Feed'],
  [
    'Pemantauan anti-fraud real-time, pelacakan geofence GPS, dan audit konversi dus otomatis.',
    'Real-time anti-fraud monitoring, GPS geofence tracking, and automated carton conversion audit.',
  ],
  ['Simulasi Transaksi Aman', 'Simulate Clean Sale'],
  ['Simulasi Percobaan Fraud', 'Simulate Fraud Attempt'],
  ['Volume Transaksi Selesai', 'Completed Volume'],
  ['Penjualan terverifikasi di POS & PWA', 'Verified sales across POS & PWA'],
  ['Total Transaksi', 'Total Transactions'],
  ['Data tersinkronisasi real-time', 'Real-time synchronized records'],
  ['Rasio Indikasi Fraud', 'Fraud Flag Rate'],
  ['Menunggu Tinjauan', 'Pending Review'],
  ['Menunggu persetujuan kasir / manajer', 'Awaiting cashier / manager sign-off'],
  ['Terindikasi Fraud', 'Flagged Fraud'],
  ['Cari ID transaksi, pelanggan, telepon...', 'Search by ID, customer, phone...'],
  ['Menghubungkan ke aliran real-time Firestore...', 'Connecting to Firestore real-time stream...'],
  ['Tidak ada transaksi yang cocok dengan filter saat ini.', 'No transactions matched your current filters.'],
  ['Coba ubah filter atau simulasikan transaksi baru.', 'Try switching filters or simulating a new transaction.'],
  ['Transaksi / Saluran', 'Transaction / Channel'],
  ['Total Modal', 'Total Cost (COGS)'],
  ['Skor Risiko Fraud', 'Fraud Risk Score'],
  ['Valuasi Aset & Finansial', 'Financial & Asset Valuation'],
  [
    'Valuasi neraca real-time, alokasi modal inventaris, dan indikator risiko finansial anti-fraud.',
    'Real-time balance sheet valuation, inventory capital allocation, and anti-fraud financial risk gauge meter.',
  ],
  ['Indikator Eksposur Risiko', 'Risk Exposure Gauge'],
  ['Aman / Risiko Minimal', 'Safe / Minimal Risk'],
  ['Eksposur Fraud Tinggi', 'High Fraud Exposure'],
  ['Waspada / Moderat', 'Guarded / Moderate'],
  ['Indeks Risiko', 'Risk Index'],
  ['Nilai Berisiko (VAR)', 'Value At Risk (VAR)'],
  ['Perisai Aktif', 'Active Shield'],
  ['100% Tertangkal', '100% Intercepted'],
  ['Nilai Aset Inventaris', 'Inventory Asset Value'],
  ['Total Nilai Jual Ritel', 'Total Retail Value'],
  ['Modal Grosir (HPP)', 'Wholesale Cost (COGS)'],
  ['Potensi Margin Kotor', 'Gross Margin Potential'],
  ['Total Volume Kemasan:', 'Total Packaging Volume:'],
  ['Arus Kas Terealisasi', 'Realized Cashflow'],
  ['Pendapatan Kotor Terealisasi', 'Gross Realized Revenue'],
  ['Biaya HPP Terealisasi', 'Realized COGS Cost'],
  ['Laba Kotor Bersih', 'Net Gross Profit'],
  ['Rasio Transaksi Terpercaya:', 'High-Trust Transaction Rate:'],
  ['Rincian Aset Produk (Dus vs Satuan Ecer)', 'Product Asset Breakdown (Cartons vs Loose Units)'],
  ['Kemasan Dus', 'Carton Packaging'],
  ['Rincian Stok', 'Stock Breakdown'],
  ['Nilai Aset (Modal)', 'Asset Value (Cost)'],
  ['Nilai Aset (Jual)', 'Asset Value (Retail)'],
  ['Potensi Margin', 'Potential Margin'],
  ['Kalibrasi Toko & Anti-Fraud', 'Store & Anti-Fraud Calibration'],
  [
    'Konfigurasi perimeter Geofence fisik, parameter SaaS Multi-Cabang, dan ambang batas risiko.',
    'Configure physical Geofence perimeter, Multi-Tenant SaaS parameters, and risk thresholds.',
  ],
  ['Metadata Toko SaaS Multi-Cabang', 'Multi-Tenant SaaS Store Metadata'],
  ['ID Toko Cabang (Kunci Utama)', 'Tenant Store ID (Foreign Key)'],
  ['Nama Tampilan Toko', 'Store Display Name'],
  ['Email Administrator Toko', 'Store Administrator Email'],
  ['Mata Uang Operasional', 'Operating Currency'],
  ['Kalibrasi Geofence Fisik', 'Physical Geofence Calibration'],
  ['Gunakan GPS Saya Saat Ini', 'Use My Current GPS'],
  ['Latitude Toko', 'Store Latitude'],
  ['Longitude Toko', 'Store Longitude'],
  ['Radius Geofence Diizinkan (Meter):', 'Allowed Geofence Radius (Meters):'],
  ['Ambang Batas Intersepsi Fraud AI', 'AI Fraud Interception Threshold'],
  ['Ambang Skor Intersepsi (0 - 100):', 'Interception Score Threshold (0 - 100):'],
  ['Muat Ulang Data Demo Awal', 'Re-seed Initial Competition Data'],
  ['Simpan Konfigurasi', 'Save Configuration'],

  // Categories, Packaging Units & Statuses
  ['Mineral Dus', 'Water Cartons'],
  ['Air Mineral', 'Mineral Water'],
  ['Minuman Manis', 'Sweet Beverages'],
  ['Kopi & Teh', 'Coffee & Tea'],
  ['Minuman Energi', 'Energy Drinks'],
  ['Susu & Olahan', 'Dairy & Milk'],
  ['Sirup & Larutan', 'Syrup & Refreshers'],
  ['Makanan Ringan', 'Snacks'],
  ['Sembako', 'Groceries'],
  ['Semua Kategori', 'All Categories'],
  ['Semua Status', 'All Statuses'],
  ['Semua Outlet', 'All Outlets'],
  ['Semua Cabang', 'All Branches'],
  ['Semua Metode', 'All Methods'],
  ['Semua Saluran', 'All Channels'],
  ['Semua Kurir', 'All Couriers'],
  ['Semua Pemasok', 'All Suppliers'],
  ['Semua Gudang', 'All Warehouses'],
  ['Semua Periode', 'All Periods'],
  ['pcs/dus', 'pcs/carton'],
  ['per dus', 'per carton'],
  ['per satuan', 'per unit'],
  ['/dus', '/carton'],
  ['/satuan', '/unit'],
  ['/ minggu', '/ week'],
  ['/ hari', '/ day'],
  ['/ bulan', '/ month'],
  ['Dus / Karton', 'Carton / Box'],
  ['Karton / Dus', 'Carton / Box'],
  ['Renceng / Pack', 'Pack / Sachet'],
  ['Ecer / Pcs', 'Unit / Pcs'],
  ['Eceran / Satuan', 'Retail / Unit'],
  ['Menunggu Konfirmasi', 'Awaiting Confirmation'],
  ['Menunggu Pembayaran', 'Awaiting Payment'],
  ['Sedang Diproses', 'Processing'],
  ['Sedang Dikemas', 'Packing'],
  ['Dalam Pengiriman', 'In Delivery'],
  ['Sedang Dikirim', 'Out for Delivery'],
  ['Pesanan Selesai', 'Order Completed'],
  ['Dibatalkan', 'Cancelled'],
  ['Dikembalikan', 'Refunded'],
  ['Stok Aman', 'Healthy Stock'],
  ['Stok Menipis', 'Low Stock'],
  ['Stok Habis', 'Out of Stock'],

  // Common Buttons & Actions
  ['Tambah Produk Baru', 'Add New Product'],
  ['Tambah Produk', 'Add Product'],
  ['Edit Produk', 'Edit Product'],
  ['Hapus Produk', 'Delete Product'],
  ['Cari produk...', 'Search products...'],
  ['Cari transaksi...', 'Search transactions...'],
  ['Cari pelanggan...', 'Search customers...'],
  ['Cari pesanan...', 'Search orders...'],
  ['Simpan Perubahan', 'Save Changes'],
  ['Simpan Data', 'Save Data'],
  ['Muat Ulang', 'Reload'],
  ['Ekspor CSV', 'Export CSV'],
  ['Ekspor PDF', 'Export PDF'],
  ['Cetak Struk', 'Print Receipt'],
  ['Cetak Faktur', 'Print Invoice'],
  ['Cetak Laporan', 'Print Report'],
  ['Unduh Laporan', 'Download Report'],
  ['Tambah Pesanan Pembelian', 'Create Purchase Order'],
  ['Buat PO Baru', 'Create New PO'],
  ['Tambah Pemasok', 'Add Supplier'],
  ['Tambah Pelanggan', 'Add Customer'],
  ['Tambah Kurir', 'Add Courier'],
  ['Tambah Karyawan', 'Add Employee'],
  ['Tambah Kasir', 'Add Cashier'],
  ['Tambah Cabang', 'Add Branch'],
  ['Tambah Promo', 'Add Promotion'],
  ['Tambah Pengeluaran', 'Add Expense'],
  ['Total Pendapatan', 'Total Revenue'],
  ['Total Penjualan', 'Total Sales'],
  ['Total Keuntungan', 'Total Profit'],
  ['Laba Bersih', 'Net Profit'],
  ['Laba Kotor', 'Gross Profit'],
  ['Harga Pokok Penjualan', 'Cost of Goods Sold'],
  ['Harga Grosir', 'Wholesale Price'],
  ['Harga Eceran', 'Retail Price'],
  ['Margin Keuntungan', 'Profit Margin'],
  ['Jumlah Stok', 'Stock Quantity'],
  ['Stok Saat Ini', 'Current Stock'],
  ['Batas Minimum', 'Minimum Threshold'],
  ['Riwayat Transaksi', 'Transaction History'],
  ['Daftar Transaksi', 'Transaction List'],
  ['Daftar Pesanan', 'Order List'],
  ['Daftar Pelanggan', 'Customer Directory'],
  ['Daftar Pemasok', 'Supplier Directory'],
  ['Antrean Pesanan', 'Order Queue'],
  ['Antrean Pengiriman', 'Delivery Queue'],
  ['Penugasan Kurir', 'Courier Assignment'],
  ['Pilih Kurir', 'Select Courier'],
  ['Tugaskan Kurir', 'Assign Courier'],
  ['Lacak Pengiriman', 'Track Delivery'],
  ['Bukti Pengiriman', 'Proof of Delivery'],
  ['Konfirmasi Pengiriman', 'Confirm Delivery'],
  ['Terima Pesanan', 'Accept Order'],
  ['Tolak Pesanan', 'Reject Order'],
  ['Proses Pesanan', 'Process Order'],
  ['Kirim Pesanan', 'Dispatch Order'],
  ['Selesaikan Pesanan', 'Complete Order'],
  ['Kemarin', 'Yesterday'],
  ['Minggu Ini', 'This Week'],
  ['Tahun Ini', 'This Year'],
  ['7 Hari Terakhir', 'Last 7 Days'],
  ['30 Hari Terakhir', 'Last 30 Days'],
  ['Total Stok Masuk', 'Total Stock In'],
  ['Dibuat untuk AI Builder Cup 2026', 'Built for AI Builder Cup 2026'],
  ['PWA Siap Offline', 'PWA Offline-Ready'],
];

/**
 * Exact token map for short standalone UI words (buttons, table headers, badges, units)
 */
export const ID_TO_EN_EXACT_TOKENS: Record<string, string> = {
  'Semua': 'All',
  'Aktif': 'Active',
  'Nonaktif': 'Inactive',
  'Dijeda': 'Paused',
  'Selesai': 'Completed',
  'Menunggu': 'Pending',
  'Diproses': 'Processing',
  'Dikemas': 'Packed',
  'Dikirim': 'In Delivery',
  'Diterima': 'Delivered',
  'Disetujui': 'Approved',
  'Batal': 'Cancel',
  'Dibatalkan': 'Cancelled',
  'Ditolak': 'Rejected',
  'Lunas': 'Paid',
  'Belum Lunas': 'Unpaid',
  'Piutang': 'Receivable',
  'Hutang': 'Credit / Debt',
  'Tunai': 'Cash',
  'Pengirim': 'Shipper',
  'Transfer': 'Bank Transfer',
  'Pemasukan': 'Income',
  'Pengeluaran': 'Expense',
  'Saldo': 'Balance',
  'Modal': 'Capital / Cost',
  'Keuntungan': 'Profit',
  'Lihat': 'View',
  'Edit': 'Edit',
  'Simpan': 'Save',
  'Tambah': 'Add',
  'Ubah': 'Edit',
  'Ganti': 'Change',
  'Hapus': 'Delete',
  'Tutup': 'Close',
  'Cetak': 'Print',
  'Unduh': 'Download',
  'Ekspor': 'Export',
  'Impor': 'Import',
  'Cari': 'Search',
  'Filter': 'Filter',
  'Urutkan': 'Sort',
  'Segarkan': 'Refresh',
  'Detail': 'Details',
  'Rincian': 'Details',
  'Aksi': 'Actions',
  'Tindakan': 'Actions',
  'Status': 'Status',
  'Kategori': 'Category',
  'Produk': 'Products',
  'Barang': 'Items',
  'Harga': 'Price',
  'Jumlah': 'Quantity',
  'Kuantitas': 'Quantity',
  'Stok': 'Stock',
  'Satuan': 'Unit',
  'Dus': 'Carton',
  'Karton': 'Carton',
  'Renceng': 'Pack',
  'Galon': 'Gallon',
  'Botol': 'Bottle',
  'Kaleng': 'Can',
  'Eceran': 'Retail',
  'Grosir': 'Wholesale',
  'Pelanggan': 'Customers',
  'Pemasok': 'Supplier',
  'Kurir': 'Courier',
  'Kasir': 'Cashier',
  'Cabang': 'Branch',
  'Gudang': 'Warehouse',
  'Penyimpanan': 'Storage',
  'Varian': 'Variants',
  'Rasa': 'Flavor',
  'Ukuran': 'Size',
  'Kemasan': 'Packaging',
  'Warna': 'Color',
  'Tanggal': 'Date',
  'Waktu': 'Time',
  'Catatan': 'Notes',
  'Alamat': 'Address',
  'Telepon': 'Phone',
  'Total': 'Total',
  'Subtotal': 'Subtotal',
  'Diskon': 'Discount',
  'Pajak': 'Tax',
  'Kembalian': 'Change',
  'Bayar': 'Pay',
  'Checkout': 'Checkout',
  'Belanja': 'Shop',
  'Keranjang': 'Cart',
  'Riwayat': 'History',
  'Profil': 'Profile',
  'Informasi': 'Information',
  'Pengaturan': 'Settings',
  'Keluar': 'Logout',
  'Masuk': 'Login',
  'Daftar': 'Register',
  'Lanjut': 'Continue',
  'Kembali': 'Back',
  'Ya': 'Yes',
  'Tidak': 'No',
  'Tersedia': 'Available',
  'Habis': 'Out of Stock',
  'Baru': 'New',
  'Penting': 'Important',
  'Normal': 'Normal',
  'Tinggi': 'High',
  'Sedang': 'Medium',
  'Rendah': 'Low',
  'Bersih': 'Clean',
  'Aman': 'Safe',
  'Waspada': 'Warning',
  'Bahaya': 'High Risk',
  'Kritis': 'Critical',
  'Lacak': 'Track',
  'Kosongkan': 'Clear',
  'DUS': 'CARTON',
  'SATUAN': 'UNIT',
  'GRATIS': 'FREE',
};

export const EN_TO_ID_EXACT_TOKENS: Record<string, string> = {
  'All': 'Semua',
  'Active': 'Aktif',
  'Inactive': 'Nonaktif',
  'Paused': 'Dijeda',
  'Completed': 'Selesai',
  'Pending': 'Menunggu',
  'Processing': 'Diproses',
  'Packed': 'Dikemas',
  'In Delivery': 'Dikirim',
  'Delivered': 'Diterima',
  'Approved': 'Disetujui',
  'Cancel': 'Batal',
  'Cancelled': 'Dibatalkan',
  'Rejected': 'Ditolak',
  'Paid': 'Lunas',
  'Unpaid': 'Belum Lunas',
  'Cash': 'Tunai',
  'Credit / Debt': 'Hutang',
  'Debt': 'Hutang',
  'Shipper': 'Pengirim',
  'Sender': 'Pengirim',
  'Income': 'Pemasukan',
  'Expense': 'Pengeluaran',
  'Balance': 'Saldo',
  'Capital / Cost': 'Modal',
  'Profit': 'Keuntungan',
  'View': 'Lihat',
  'Save': 'Simpan',
  'Add': 'Tambah',
  'Edit': 'Edit',
  'Change': 'Ganti',
  'Delete': 'Hapus',
  'Close': 'Tutup',
  'Print': 'Cetak',
  'Download': 'Unduh',
  'Export': 'Ekspor',
  'Import': 'Impor',
  'Search': 'Cari',
  'Filter': 'Filter',
  'Sort': 'Urutkan',
  'Refresh': 'Segarkan',
  'Details': 'Rincian',
  'Actions': 'Aksi',
  'Category': 'Kategori',
  'Products': 'Produk',
  'Product Pages': 'Halaman Produk',
  'Product Catalog': 'Katalog Produk',
  'Product List': 'Daftar Produk',
  'Product Logs': 'Log Produk',
  'Product Bundles': 'Paket Bundling',
  'Categories & Brands': 'Kategori & Brand',
  'Discounts & Tier Pricing': 'Diskon & Harga Grosir',
  'Discount Pricing': 'Harga Diskon',
  'Price': 'Harga',
  'Quantity': 'Jumlah',
  'Stock': 'Stok',
  'Storage': 'Penyimpanan',
  'Storage Location': 'Penyimpanan',
  'Variants': 'Varian',
  'Flavor': 'Rasa',
  'Size': 'Ukuran',
  'Packaging': 'Kemasan',
  'Color': 'Warna',
  'Back': 'Kembali',
  'Continue': 'Lanjut',
  'Settings': 'Pengaturan',
  'Information': 'Informasi',
  'Financial Assets': 'Aset Finansial',
  'Transaction Feed': 'Riwayat Transaksi',
  'Customers': 'Pelanggan',
  'Customer': 'Pelanggan',
  'Cashier': 'Kasir',
  'Time': 'Waktu',
  'Pay': 'Bayar',
  'Total Value': 'Total Nilai',
  'Total Sales': 'Total Jual',
  'Total Amount': 'Total Nilai',
  'Product Reports': 'Laporan Produk',
};

// Case-insensitive exact maps for fast and 100% accurate token/phrase matching
export const EXACT_ID_TO_EN_MAP = new Map<string, string>();
export const EXACT_EN_TO_ID_MAP = new Map<string, string>();

const ALL_BUTTON_AND_UI_PAIRS: [string, string][] = [
  ['+ Tambah Produk Baru', '+ Add New Product'],
  ['+ Tambah Produk', '+ Add Product'],
  ['+ Tambah Role / Jabatan Baru', '+ Add New Role / Position'],
  ['+ Tambah Role / Jabatan', '+ Add Role / Position'],
  ['+ Tambah Aturan Otoritas Baru', '+ Add New Authority Rule'],
  ['+ Tambah Role', '+ Add Role'],
  ['+ Tambah Jabatan', '+ Add Position'],
  ['+ Tambah Staff', '+ Add Staff'],
  ['+ Tambah Karyawan', '+ Add Employee'],
  ['+ Tambah Kategori', '+ Add Category'],
  ['+ Tambah Brand', '+ Add Brand'],
  ['+ Tambah Satuan', '+ Add Unit'],
  ['+ Tambah Pelanggan', '+ Add Customer'],
  ['+ Tambah Pemasok', '+ Add Supplier'],
  ['+ Tambah Supplier', '+ Add Supplier'],
  ['+ Tambah Order', '+ Add Order'],
  ['+ Tambah Pesanan', '+ Add Order'],
  ['+ Tambah Pengeluaran', '+ Add Expense'],
  ['+ Tambah Shift', '+ Add Shift'],
  ['+ Tambah Outlet', '+ Add Outlet'],
  ['+ Tambah Toko', '+ Add Store'],
  ['+ Tambah Cabang', '+ Add Branch'],
  ['+ Tambah Promo', '+ Add Promo'],
  ['+ Tambah Voucher', '+ Add Voucher'],
  ['+ Tambah Data', '+ Add Data'],
  ['+ Pemasukan', '+ Income'],
  ['- Pengeluaran', '- Expense'],
  ['- Catat Pengeluaran', '- Record Expense'],
  ['+ Catat Pemasukan', '+ Record Income'],
  ['+ Catat Kas Masuk', '+ Record Cash In'],
  ['- Catat Kas Keluar', '- Record Cash Out'],
  ['Simpan', 'Save'],
  ['Simpan Data', 'Save Data'],
  ['Simpan Perubahan', 'Save Changes'],
  ['Simpan Konfigurasi', 'Save Configuration'],
  ['Simpan Pengaturan', 'Save Settings'],
  ['Simpan Role', 'Save Role'],
  ['Simpan Staff', 'Save Staff'],
  ['Simpan Karyawan', 'Save Employee'],
  ['Simpan Produk', 'Save Product'],
  ['Batal', 'Cancel'],
  ['Batalkan', 'Cancel'],
  ['Hapus', 'Delete'],
  ['Hapus Data', 'Delete Data'],
  ['Edit', 'Edit'],
  ['Edit Data', 'Edit Data'],
  ['Ubah', 'Edit'],
  ['Lihat', 'View'],
  ['Tutup', 'Close'],
  ['Cari', 'Search'],
  ['Cari data...', 'Search data...'],
  ['Cari produk...', 'Search products...'],
  ['Cari Produk...', 'Search products...'],
  ['Cari transaksi...', 'Search transactions...'],
  ['Cari pelanggan...', 'Search customers...'],
  ['Cari pesanan...', 'Search orders...'],
  ['Filter', 'Filter'],
  ['Urutkan', 'Sort'],
  ['Reset', 'Reset'],
  ['Cetak', 'Print'],
  ['Cetak Struk', 'Print Receipt'],
  ['Cetak Nota', 'Print Receipt'],
  ['Cetak Faktur', 'Print Invoice'],
  ['Unduh', 'Download'],
  ['Unduh CSV', 'Download CSV'],
  ['Ekspor CSV', 'Export CSV'],
  ['Ekspor PDF', 'Export PDF'],
  ['Ekspor Excel', 'Export Excel'],
  ['Impor CSV', 'Import CSV'],
  ['Bayar', 'Pay'],
  ['Bayar Sekarang', 'Pay Now'],
  ['Bayar Lunas', 'Pay in Full'],
  ['Proses', 'Process'],
  ['Proses Pesanan', 'Process Order'],
  ['Selesai', 'Complete'],
  ['Selesaikan', 'Complete'],
  ['Kembali', 'Back'],
  ['Lanjut', 'Continue'],
  ['Konfirmasi', 'Confirm'],
  ['Setuju', 'Approve'],
  ['Tolak', 'Reject'],
  ['Buka Shift', 'Open Shift'],
  ['Tutup Shift', 'Close Shift'],
  ['Muat Ulang', 'Reload'],
  ['Segarkan', 'Refresh'],
  ['Semua Status', 'All Statuses'],
  ['Semua Kategori', 'All Categories'],
  ['Semua Cabang', 'All Branches'],
  ['Semua Pelanggan', 'All Customers'],
  ['Semua Supplier', 'All Suppliers'],
];

(() => {
  for (const [id, en] of Object.entries(ID_TO_EN_EXACT_TOKENS)) {
    EXACT_ID_TO_EN_MAP.set(id.toLowerCase(), en);
    EXACT_EN_TO_ID_MAP.set(en.toLowerCase(), id);
  }
  for (const [en, id] of Object.entries(EN_TO_ID_EXACT_TOKENS)) {
    EXACT_EN_TO_ID_MAP.set(en.toLowerCase(), id);
    EXACT_ID_TO_EN_MAP.set(id.toLowerCase(), en);
  }
  for (const [id, en] of ALL_BUTTON_AND_UI_PAIRS) {
    EXACT_ID_TO_EN_MAP.set(id.toLowerCase(), en);
    EXACT_EN_TO_ID_MAP.set(en.toLowerCase(), id);
  }
  for (const [id, en] of ID_TO_EN_PHRASES) {
    EXACT_ID_TO_EN_MAP.set(id.toLowerCase(), en);
    EXACT_EN_TO_ID_MAP.set(en.toLowerCase(), id);
  }
})();

// Sort phrases longest-first so longer multi-word sentences match before substrings
const SORTED_ID_TO_EN = [...ID_TO_EN_PHRASES].sort((a, b) => b[0].length - a[0].length);
const SORTED_EN_TO_ID = [...ID_TO_EN_PHRASES].sort((a, b) => b[1].length - a[1].length);

// Word-boundary dictionary for compound UI labels (ID -> EN)
const WORD_BOUNDARY_ID_TO_EN: Array<[RegExp, string]> = [
  [/\bPenjualan\b/g, 'Sales'],
  [/\bPembelian\b/g, 'Purchases'],
  [/\bTransaksi\b/g, 'Transactions'],
  [/\bPelanggan\b/g, 'Customers'],
  [/\bProduk\b/g, 'Products'],
  [/\bKategori\b/g, 'Category'],
  [/\bGudang\b/g, 'Warehouse'],
  [/\bCabang\b/g, 'Branch'],
  [/\bKasir\b/g, 'Cashier'],
  [/\bPengirim\b/g, 'Shipper'],
  [/\bPemasok\b/g, 'Supplier'],
  [/\bKeuangan\b/g, 'Finance'],
  [/\bBrangkas\b/g, 'Vault'],
  [/\bBrankas\b/g, 'Vault'],
  [/\bPemasukan\b/g, 'Income'],
  [/\bPengeluaran\b/g, 'Expense'],
  [/\bKeuntungan\b/g, 'Profit'],
  [/\bPiutang\b/g, 'Receivables'],
  [/\bHutang\b/g, 'Payables / Debt'],
  [/\bTunai\b/g, 'Cash'],
  [/\bKembalian\b/g, 'Change'],
  [/\bLaporan\b/g, 'Report'],
  [/\bRiwayat\b/g, 'History'],
  [/\bPengaturan\b/g, 'Settings'],
  [/\bPesanan\b/g, 'Orders'],
  [/\bAntrean\b/g, 'Queue'],
  [/\bTersedia\b/g, 'Available'],
  [/\bTerjual\b/g, 'Sold'],
  [/\bKadaluarsa\b/g, 'Expiry'],
  [/\bPenyimpanan\b/g, 'Storage'],
];

export interface UITextOverrideRule {
  id: string;
  targetRoute: string; // 'ALL' or specific path like '/dashboard/orders'
  sourceText: string;
  replacementId: string;
  replacementEn?: string;
  enabled: boolean;
  description?: string;
  createdAt?: string;
}

let LIVE_TEXT_OVERRIDES: UITextOverrideRule[] = [];
const OVERRIDE_LISTENERS = new Set<(overrides: UITextOverrideRule[]) => void>();

export function setLiveTextOverrides(overrides: UITextOverrideRule[]) {
  LIVE_TEXT_OVERRIDES = Array.isArray(overrides)
    ? overrides.filter((o) => o && o.enabled !== false && o.sourceText)
    : [];
  OVERRIDE_LISTENERS.forEach((fn) => {
    try {
      fn(LIVE_TEXT_OVERRIDES);
    } catch {}
  });
}

export function getLiveTextOverrides(): UITextOverrideRule[] {
  return LIVE_TEXT_OVERRIDES;
}

export function subscribeLiveTextOverrides(
  listener: (overrides: UITextOverrideRule[]) => void
): () => void {
  OVERRIDE_LISTENERS.add(listener);
  return () => {
    OVERRIDE_LISTENERS.delete(listener);
  };
}

export function applyLiveTextOverride(raw: string, lang: LangCode, pathname?: string): string {
  if (!raw || typeof raw !== 'string' || LIVE_TEXT_OVERRIDES.length === 0) return raw;
  const currentPath =
    pathname || (typeof window !== 'undefined' ? window.location.pathname : '/dashboard');
  let output = raw;
  for (const rule of LIVE_TEXT_OVERRIDES) {
    if (!rule.sourceText) continue;
    const routeMatch =
      !rule.targetRoute ||
      rule.targetRoute === 'ALL' ||
      rule.targetRoute === '*' ||
      currentPath.toLowerCase().includes(rule.targetRoute.toLowerCase());
    if (!routeMatch) continue;

    const targetReplacement =
      lang === 'en'
        ? rule.replacementEn || rule.replacementId
        : rule.replacementId || rule.replacementEn || '';
    if (!targetReplacement) continue;

    if (output.trim().toLowerCase() === rule.sourceText.trim().toLowerCase()) {
      output = output.replace(output.trim(), targetReplacement);
    } else if (output.includes(rule.sourceText)) {
      output = output.split(rule.sourceText).join(targetReplacement);
    }
  }
  return output;
}

const BRAND_RISK_PLACEHOLDER = '__RC_BRAND_RISKCART__';
const BRAND_RISK_SPACE_PLACEHOLDER = '__RC_BRAND_RISK_CART__';
const BRAND_POS_AI_PLACEHOLDER = '__RC_BRAND_POS_AI__';
const BRAND_AI_PLACEHOLDER = '__RC_BRAND_AI_SUB__';

/**
 * Protects "RiskCart", "Risk Cart", and "POS Artificial Intelligence" before translation.
 * Never allows "RiskCart" to become "RiskKeranjang".
 */
export function protectBrandTerms(str: string): string {
  return str
    .replace(/Risk\s*Keranjang/gi, 'RiskCart')
    .replace(/Kecerdasan Buatan/gi, 'Artificial Intelligence')
    .replace(/POS\s+Artificial\s+Intelligence/gi, BRAND_POS_AI_PLACEHOLDER)
    .replace(/RiskCart/gi, BRAND_RISK_PLACEHOLDER)
    .replace(/Risk\s+Cart/gi, BRAND_RISK_SPACE_PLACEHOLDER)
    .replace(/Artificial\s+Intelligence/gi, BRAND_AI_PLACEHOLDER);
}

export function restoreBrandTerms(str: string): string {
  return str
    .split(BRAND_POS_AI_PLACEHOLDER)
    .join('POS Artificial Intelligence')
    .split(BRAND_RISK_PLACEHOLDER)
    .join('RiskCart')
    .split(BRAND_RISK_SPACE_PLACEHOLDER)
    .join('RiskCart')
    .split(BRAND_AI_PLACEHOLDER)
    .join('Artificial Intelligence')
    .replace(/Risk\s*Keranjang/gi, 'RiskCart')
    .replace(/Kecerdasan Buatan/gi, 'Artificial Intelligence');
}

/**
 * Translates any Indonesian UI string, button label, dropdown option, or status into English
 * when `lang === 'en'`, while keeping product brand names intact.
 */
export function translateTextToEnglish(raw: string): string {
  if (!raw || typeof raw !== 'string') return raw;
  const normalizedRaw = raw
    .replace(/Risk\s*Keranjang/gi, 'RiskCart')
    .replace(/Kecerdasan Buatan/gi, 'Artificial Intelligence');
  const trimmed = normalizedRaw.trim();
  if (!trimmed) return normalizedRaw;

  const lower = trimmed.toLowerCase();
  if (lower === 'riskcart' || lower === 'risk cart') {
    return normalizedRaw.replace(trimmed, 'RiskCart');
  }
  if (lower === 'artificial intelligence') {
    return normalizedRaw.replace(trimmed, 'Artificial Intelligence');
  }
  if (lower === 'pos artificial intelligence') {
    return normalizedRaw.replace(trimmed, 'POS Artificial Intelligence');
  }
  if (lower === 'pos riskcart artificial intelligence') {
    return normalizedRaw.replace(trimmed, 'POS RiskCart Artificial Intelligence');
  }

  // Apply Live AI System Architect UI Text Overrides first
  const overridden = applyLiveTextOverride(normalizedRaw, 'en');
  if (overridden !== normalizedRaw) return restoreBrandTerms(overridden);

  // Skip pure numbers, phone numbers, or short symbols (note: strings with Rp are handled by currency scanner)
  if (/^[0-9.,+\-$%\s/#•:()]+$/.test(trimmed)) return normalizedRaw;

  // 1. Exact case-insensitive match
  if (EXACT_ID_TO_EN_MAP.has(lower)) {
    const baseEn = normalizedRaw.replace(trimmed, EXACT_ID_TO_EN_MAP.get(lower)!);
    return restoreBrandTerms(applyLiveTextOverride(baseEn, 'en'));
  }

  // 2. Exact token match
  if (ID_TO_EN_EXACT_TOKENS[trimmed]) {
    const baseEn = normalizedRaw.replace(trimmed, ID_TO_EN_EXACT_TOKENS[trimmed]);
    return restoreBrandTerms(applyLiveTextOverride(baseEn, 'en'));
  }

  let result = protectBrandTerms(normalizedRaw);

  // 3. Longest-Phrase-First replacements
  for (const [idPhrase, enPhrase] of SORTED_ID_TO_EN) {
    if (result.includes(idPhrase)) {
      result = result.split(idPhrase).join(enPhrase);
    }
  }

  // 4. Word-boundary dictionary replacements for remaining Indonesian tokens
  for (const [regex, enWord] of WORD_BOUNDARY_ID_TO_EN) {
    result = result.replace(regex, enWord);
  }

  // 5. Common dynamic patterns
  result = result
    .replace(/\bVARIAN\s+(\d+)/g, 'VARIANT $1')
    .replace(/\bStok:\s*/g, 'Stock: ')
    .replace(/\bSatuan:\s*/g, 'Unit Price: ')
    .replace(/\bHarga Dus:\s*/g, 'Carton Price: ')
    .replace(/(\d+)\s+Produk\b/gi, '$1 Products')
    .replace(/(\d+)\s+Pesanan\b/gi, '$1 Orders')
    .replace(/(\d+)\s+Pelanggan\b/gi, '$1 Customers')
    .replace(/(\d+)\s+Transaksi\b/gi, '$1 Transactions')
    .replace(/(\d+)\s+Kategori\b/gi, '$1 Categories')
    .replace(/(\d+)\s+detik\b/gi, '$1 seconds')
    .replace(/(\d+)\s+menit\b/gi, '$1 minutes')
    .replace(/(\d+)\s+jam\b/gi, '$1 hours')
    .replace(/(\d+)\s+hari\b/gi, '$1 days')
    .replace(/(\d+)\s+minggu\b/gi, '$1 weeks')
    .replace(/(\d+)\s+bulan\b/gi, '$1 months')
    .replace(/\bPesanan\s+#/g, 'Order #')
    .replace(/\bSemua\s+\((\d+)\)/g, 'All ($1)')
    .replace(/\bAktif\s+\((\d+)\)/g, 'Active ($1)')
    .replace(/\bSelesai\s+\((\d+)\)/g, 'Completed ($1)');

  return restoreBrandTerms(applyLiveTextOverride(restoreBrandTerms(result), 'en'));
}

/**
 * Translates English UI labels into Indonesian when `lang === 'id'`,
 * while keeping product brand names and customer records intact.
 */
export function translateTextToIndonesian(raw: string): string {
  if (!raw || typeof raw !== 'string') return raw;
  const normalizedRaw = raw
    .replace(/Risk\s*Keranjang/gi, 'RiskCart')
    .replace(/Kecerdasan Buatan/gi, 'Artificial Intelligence')
    .replace(/\bBANGKAS\b/g, 'BRANGKAS')
    .replace(/\bBangkas\b/g, 'Brangkas')
    .replace(/\bbangkas\b/g, 'brangkas');
  const trimmed = normalizedRaw.trim();
  if (!trimmed) return normalizedRaw;

  const lower = trimmed.toLowerCase();
  if (lower === 'riskcart' || lower === 'risk cart') {
    return normalizedRaw.replace(trimmed, 'RiskCart');
  }
  if (lower === 'artificial intelligence') {
    return normalizedRaw.replace(trimmed, 'Artificial Intelligence');
  }
  if (lower === 'pos artificial intelligence') {
    return normalizedRaw.replace(trimmed, 'POS Artificial Intelligence');
  }
  if (lower === 'pos riskcart artificial intelligence') {
    return normalizedRaw.replace(trimmed, 'POS RiskCart Artificial Intelligence');
  }

  // Apply Live AI System Architect UI Text Overrides first
  const overridden = applyLiveTextOverride(normalizedRaw, 'id');
  if (overridden !== normalizedRaw) return restoreBrandTerms(overridden);

  if (/^[0-9.,+\-$Rp%\s/#•:()]+$/.test(trimmed)) return normalizedRaw;

  // 1. Exact case-insensitive match
  if (EXACT_EN_TO_ID_MAP.has(lower)) {
    const baseId = normalizedRaw.replace(trimmed, EXACT_EN_TO_ID_MAP.get(lower)!);
    return restoreBrandTerms(applyLiveTextOverride(baseId, 'id'));
  }

  if (EN_TO_ID_EXACT_TOKENS[trimmed]) {
    const baseId = normalizedRaw.replace(trimmed, EN_TO_ID_EXACT_TOKENS[trimmed]);
    return restoreBrandTerms(applyLiveTextOverride(baseId, 'id'));
  }

  let result = protectBrandTerms(normalizedRaw);

  for (const [idPhrase, enPhrase] of SORTED_EN_TO_ID) {
    if (enPhrase.toLowerCase() === 'artificial intelligence') continue;
    if (enPhrase === idPhrase) continue;
    // Only replace multi-word English phrases so single English tokens never collide inside Indonesian words
    if (enPhrase.includes(' ') && enPhrase.length >= 8 && result.includes(enPhrase)) {
      result = result.split(enPhrase).join(idPhrase);
    }
  }

  result = result
    .replace(/\bVARIANT\s+(\d+)/g, 'VARIAN $1')
    .replace(/\bAll\s+\((\d+)\)/g, 'Semua ($1)')
    .replace(/\bFlagged Fraud\s+\((\d+)\)/g, 'Terindikasi Fraud ($1)')
    .replace(/\bPending Approval\s+\((\d+)\)/g, 'Menunggu Persetujuan ($1)');

  return restoreBrandTerms(applyLiveTextOverride(restoreBrandTerms(result), 'id'));
}

export function translateCategoryName(category: string, lang: LangCode): string {
  if (!category) return category;
  const upper = category.trim().toUpperCase();

  if (lang === 'en') {
    const enMap: Record<string, string> = {
      ALL: 'All Categories',
      SEMUA: 'All Categories',
      MINERAL: 'Mineral Water (MINERAL)',
      FLAVORED: 'Flavored Drinks (FLAVORED)',
      COLA: 'Cola & Soda (COLA)',
      GAS: 'Sparkling / Carbonated (GAS)',
      COFFEE: 'Coffee & Tea (COFFEE)',
      SNACK: 'Snacks (SNACK)',
      DAIRY: 'Dairy & Milk (DAIRY)',
      INSTANT_FOOD: 'Instant Food (INSTANT_FOOD)',
      OTHER: 'Other (OTHER)',
      'MINERAL DUS': 'Water Cartons',
      'AIR MINERAL': 'Mineral Water',
      'MINUMAN MANIS': 'Sweet Beverages',
      'KOPI & TEH': 'Coffee & Tea',
      'MINUMAN ENERGI': 'Energy Drinks',
      'SUSU & OLAHAN': 'Dairy & Milk',
      'MAKANAN RINGAN': 'Snacks',
    };
    return enMap[upper] || translateTextToEnglish(category);
  } else {
    const idMap: Record<string, string> = {
      ALL: 'Semua Kategori',
      SEMUA: 'Semua Kategori',
      MINERAL: 'Air Mineral (MINERAL)',
      FLAVORED: 'Minuman Berperisa (FLAVORED)',
      COLA: 'Minuman Cola / Soda (COLA)',
      GAS: 'Minuman Berkarbonasi (GAS)',
      COFFEE: 'Kopi & Teh (COFFEE)',
      SNACK: 'Makanan Ringan (SNACK)',
      DAIRY: 'Susu & Olahan (DAIRY)',
      INSTANT_FOOD: 'Makanan Instan (INSTANT_FOOD)',
      OTHER: 'Lainnya (OTHER)',
    };
    return idMap[upper] || category;
  }
}

export function translateVariantType(variantType: string, lang: LangCode): string {
  if (!variantType) return variantType;
  const mapEn: Record<string, string> = {
    Rasa: 'Flavor (Rasa)',
    Ukuran: 'Size (Ukuran)',
    Kemasan: 'Packaging (Kemasan)',
    Warna: 'Color (Warna)',
  };
  const mapId: Record<string, string> = {
    Rasa: 'Rasa',
    Ukuran: 'Ukuran',
    Kemasan: 'Kemasan',
    Warna: 'Warna',
    Flavor: 'Rasa',
    Size: 'Ukuran',
    Packaging: 'Kemasan',
    Color: 'Warna',
  };
  return lang === 'en' ? mapEn[variantType] || variantType : mapId[variantType] || variantType;
}

export function translatePackageUnit(unit: string, lang: LangCode): string {
  if (!unit) return unit;
  const lower = unit.toLowerCase();
  if (lang === 'en') {
    if (lower === 'dus') return 'Carton (Dus)';
    if (lower === 'karton') return 'Box / Carton';
    if (lower === 'carton') return 'Carton';
    if (lower === 'box') return 'Box';
    if (lower === 'pack' || lower === 'renceng') return 'Pack';
    if (lower === 'unit' || lower === 'satuan' || lower === 'ecer') return 'Unit';
    if (lower === 'pcs') return 'Pcs';
    if (lower === 'botol' || lower === 'bottle') return 'Bottle';
    if (lower === 'cup') return 'Cup';
    if (lower === 'sachet') return 'Sachet';
    if (lower === 'kg') return 'Kg';
    if (lower === 'galon' || lower === 'gallon') return 'Gallon';
    return translateTextToEnglish(unit);
  } else {
    if (lower === 'carton' || lower === 'dus') return 'Dus';
    if (lower === 'karton') return 'Karton';
    if (lower === 'box') return 'Box';
    if (lower === 'pack' || lower === 'renceng') return 'Pack / Renceng';
    if (lower === 'unit' || lower === 'satuan' || lower === 'ecer') return 'Unit / Satuan';
    if (lower === 'pcs') return 'Pcs';
    if (lower === 'botol' || lower === 'bottle') return 'Botol';
    if (lower === 'cup') return 'Cup';
    if (lower === 'sachet') return 'Sachet';
    if (lower === 'kg') return 'Kg';
    if (lower === 'galon' || lower === 'gallon') return 'Galon';
    return unit;
  }
}

export function translateOrderStatus(status: string, lang: LangCode): string {
  if (!status) return status;
  const lower = status.toLowerCase();
  if (lang === 'en') {
    const enMap: Record<string, string> = {
      new: 'New Order',
      pending: 'Pending',
      pending_approval: 'Pending Approval',
      approved: 'Approved',
      processing: 'Processing',
      packing: 'Packing',
      packed: 'Packed',
      shipped: 'In Delivery',
      in_delivery: 'In Delivery',
      out_for_delivery: 'Out for Delivery',
      delivered: 'Delivered',
      completed: 'Completed',
      cancelled: 'Cancelled',
      rejected: 'Rejected',
      refunded: 'Refunded',
      paid: 'Paid',
      unpaid: 'Unpaid',
      lunas: 'Paid',
      menunggu: 'Pending',
      diproses: 'Processing',
      dikirim: 'In Delivery',
      selesai: 'Completed',
    };
    return enMap[lower] || translateTextToEnglish(status);
  } else {
    const idMap: Record<string, string> = {
      new: 'Pesanan Baru',
      pending: 'Menunggu',
      pending_approval: 'Menunggu Konfirmasi',
      approved: 'Disetujui',
      processing: 'Diproses',
      packing: 'Dikemas',
      packed: 'Siap Kirim',
      shipped: 'Dikirim',
      in_delivery: 'Dalam Pengiriman',
      out_for_delivery: 'Sedang Dikirim',
      delivered: 'Terkirim',
      completed: 'Selesai',
      cancelled: 'Dibatalkan',
      rejected: 'Ditolak',
      refunded: 'Dikembalikan',
      paid: 'Lunas',
      unpaid: 'Belum Lunas',
    };
    return idMap[lower] || status;
  }
}

/**
 * Translates a single string for display (both language ID<->EN and currency Rp->$ when USD is active).
 */
export function translateAndFormatDomString(
  rawStr: string,
  lang: LangCode,
  currencyMode?: CurrencyMode,
  exchangeRate?: number
): string {
  if (!rawStr) return rawStr;
  const activeCurr = currencyMode || getCurrencyMode();
  const activeRate = exchangeRate || getExchangeRate();

  const langTranslated =
    lang === 'en' ? translateTextToEnglish(rawStr) : translateTextToIndonesian(rawStr);

  if (activeCurr === 'USD') {
    return restoreBrandTerms(convertDomCurrencyInText(langTranslated, 'USD', activeRate));
  }
  return restoreBrandTerms(langTranslated);
}

/**
 * Custom MutationObserver / TreeWalker disabled:
 * Translation is handled natively via Google Translate widget and React tr()/t() hooks.
 */
export function scanAndTranslateDomTree(
  _root?: Node,
  _lang?: LangCode,
  _currencyMode?: CurrencyMode,
  _exchangeRate?: number
): void {
  // Intentionally disabled to avoid DOM conflicts with Google Translate and currency rendering
}

