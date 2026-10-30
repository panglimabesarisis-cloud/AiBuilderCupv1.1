import React from 'react';
import { Link, LinkProps, Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { ProductCartonTabType } from './components/common/Sidebar';
import {
  useAccessControl,
  hasValidAuthSession,
  isWaitersDirectRoute,
  readVerifiedAuthSession,
} from './context/AccessControlContext';

export interface ResolvedAppRoute {
  view?: 'landing' | 'pos' | 'admin' | 'pwa';
  posSubTab?: string;
  activeTab: string;
  activeSubModule: string;
  productSubTab: ProductCartonTabType;
  productViewMode: 'table' | 'add_product';
  productEntityId?: string;
  productAction?: 'view' | 'edit' | 'stok';
  bundleView: 'directory' | 'add_bundle';
  bundleEditId?: string;
  discountView: 'directory' | 'add_form';
  discountEditId?: string;
  orderSubTab: string;
  orderAction: 'list' | 'tambah' | 'detail';
  orderId?: string;
  entityId?: string;
  actionMode: 'list' | 'tambah' | 'edit' | 'detail';
}

export interface PathToViewResult {
  view: 'landing' | 'pos' | 'admin' | 'pwa';
  subModule: string | null;
  posSubTab: string;
}

/**
 * Maps a browser pathname to the high-level view ('landing' | 'pos' | 'admin' | 'pwa'),
 * subModule, and posSubTab without forcing /pos to /dashboard.
 */
export function pathToView(pathname: string): PathToViewResult {
  const cleanPath = (pathname || '/').replace(/\/+$/, '') || '/';

  if (
    cleanPath === '/pos' ||
    cleanPath.startsWith('/pos/') ||
    cleanPath === '/dashboard/pos' ||
    cleanPath.startsWith('/dashboard/pos/') ||
    cleanPath === '/waiters' ||
    cleanPath.startsWith('/waiters/') ||
    cleanPath === '/waiter' ||
    cleanPath.startsWith('/waiter/')
  ) {
    const isWaiterPath = cleanPath.startsWith('/waiter');
    const normalized = cleanPath
      .replace('/dashboard/pos', '/pos')
      .replace(/^\/waiters?(?:\/pos)?/, '/pos');
    const parts = normalized.split('/').filter(Boolean);
    const tab = parts[1] || 'kasir';
    return { view: 'pos', subModule: isWaiterPath ? 'waiter' : null, posSubTab: tab };
  }

  if (
    cleanPath === '/order-pelanggan' ||
    cleanPath.startsWith('/order-pelanggan/') ||
    cleanPath === '/client-pwa' ||
    cleanPath.startsWith('/client-pwa/') ||
    cleanPath === '/pwa' ||
    cleanPath.startsWith('/pwa/') ||
    cleanPath === '/clienthome' ||
    cleanPath.startsWith('/clienthome/')
  ) {
    return { view: 'pwa', subModule: null, posSubTab: 'kasir' };
  }

  if (cleanPath === '/beranda' || cleanPath === '/landing' || cleanPath === '/dashboard/beranda') {
    return { view: 'landing', subModule: null, posSubTab: 'kasir' };
  }

  const resolved = resolveRouteFromLocation(cleanPath, '');
  if (resolved.activeTab === 'pos_machine' || resolved.activeTab === 'pos') {
    return { view: 'pos', subModule: null, posSubTab: resolved.posSubTab || 'kasir' };
  }
  if (resolved.activeTab === 'landing') {
    return { view: 'landing', subModule: null, posSubTab: 'kasir' };
  }

  return {
    view: 'admin',
    subModule: resolved.activeSubModule || null,
    posSubTab: 'kasir',
  };
}

/**
 * Maps view ('landing' | 'pos' | 'admin' | 'pwa'), subModule, and posSubTab back to a clean URL path.
 * Ensures view === 'pos' always returns '/pos' (or '/pos/:posSubTab'), never '/dashboard'.
 */
export function viewToPath(
  view: 'landing' | 'pos' | 'admin' | 'pwa' | string,
  subModule?: string | null,
  posSubTab?: string
): string {
  if (view === 'pos' || view === 'pos_machine') {
    const cleanTab = (posSubTab || 'kasir').trim();
    return cleanTab && cleanTab !== 'kasir' ? `/pos/${cleanTab}` : '/pos';
  }
  if (view === 'pwa' || view === 'order-pelanggan' || view === 'client-pwa') {
    return '/client-pwa';
  }
  if (view === 'landing') {
    return '/dashboard/beranda';
  }
  if (subModule) {
    return getPathForTab(view === 'admin' ? 'admin_dashboard' : view, subModule);
  }
  return '/dashboard';
}

/**
 * Merges target path with existing query parameters (e.g. ?agent=...) so system query params are preserved
 * across route transitions without any /en prefixing.
 */
export function buildUrlWithSearch(
  targetPath: string,
  currentSearch?: string
): string {
  const searchStr =
    currentSearch !== undefined
      ? currentSearch
      : typeof window !== 'undefined'
      ? window.location.search
      : '';

  const [rawPath, targetQuery] = targetPath.split('?');
  const stripped = (rawPath || '/').replace(/^\/en(?=\/|$)/i, '');
  let cleanPathname = stripped.startsWith('/') ? stripped : `/${stripped}`;

  // Auto-prefix '/dashboard' for any admin path that does not already start with /pos, /order-pelanggan, /login, /dashboard, /client-pwa, /pwa, /clienthome, /waiter, /waiters, or /kitchen
  if (
    cleanPathname !== '/' &&
    !cleanPathname.startsWith('/pos') &&
    !cleanPathname.startsWith('/order-pelanggan') &&
    !cleanPathname.startsWith('/login') &&
    !cleanPathname.startsWith('/dashboard') &&
    !cleanPathname.startsWith('/client-pwa') &&
    !cleanPathname.startsWith('/pwa') &&
    !cleanPathname.startsWith('/clienthome') &&
    !cleanPathname.startsWith('/waiter') &&
    !cleanPathname.startsWith('/kitchen')
  ) {
    cleanPathname = `/dashboard${cleanPathname}`;
  }

  const mergedParams = new URLSearchParams(searchStr);
  if (
    !targetQuery &&
    (cleanPathname.startsWith('/dashboard/ai/master') ||
      !cleanPathname.startsWith('/dashboard/ai'))
  ) {
    mergedParams.delete('agent');
  }
  if (!targetQuery && !cleanPathname.startsWith('/waiter')) {
    mergedParams.delete('waiter');
    mergedParams.delete('tableId');
    mergedParams.delete('tableNumber');
  }
  if (targetQuery) {
    const nextParams = new URLSearchParams(targetQuery);
    nextParams.forEach((val, key) => {
      mergedParams.set(key, val);
    });
  }

  const finalQuery = mergedParams.toString();
  return finalQuery ? `${cleanPathname}?${finalQuery}` : cleanPathname;
}

/**
 * Maps internal module/tab IDs and sub-module keys to clean, RESTful kebab-case URL paths.
 */
export function getPathForTab(tabId: string, subModule?: string): string {
  switch (tabId) {
    case 'pos':
    case 'pos_machine':
      if (subModule === 'waiter') return '/waiters/pos';
      if (subModule && subModule !== 'kasir' && subModule !== 'pos_machine') return `/pos/${subModule}`;
      return '/pos';
    case 'waiters':
    case 'waiter':
      return '/waiters';
    case 'kitchen':
    case 'dapur':
      return '/kitchen';
    case 'reservation':
    case 'reservasi':
      if (subModule === 'list' || subModule === 'reservation_list') {
        return '/dashboard/reservation/list';
      }
      return '/dashboard/reservation';
    case 'layout_table':
    case 'table_layout':
    case 'reservation_table': {
      const sub = (subModule || '').toLowerCase();
      if (sub === 'reservation' || sub === 'reservasi' || sub === 'res_reservasi') {
        return '/dashboard/reservation';
      }
      if (sub === 'reservation_list' || sub === 'list' || sub === 'res_list') {
        return '/dashboard/reservation/list';
      }
      if (sub === 'summary' || sub === 'summary_report' || sub === 'res_summary_report') {
        return '/dashboard/layout-table/summary';
      }
      return '/dashboard/layout-table';
    }
    case 'landing':
      return '/dashboard/beranda';
    case 'admin':
    case 'admin_dashboard':
      return '/dashboard';
    case 'categories':
      return '/dashboard/kategori-produk';
    case 'units':
      return '/dashboard/produk';
    case 'stock':
      return '/dashboard/inventory';
    case 'customer_types':
      return '/dashboard/pelanggan/tipe';
    case 'pwa_settings':
      return '/dashboard/pengaturan-pwa';
    case 'orders':
      if (subModule && subModule !== 'all') {
        return `/dashboard/orders/${subModule.toLowerCase().replace(/_/g, '-')}`;
      }
      return '/dashboard/orders';
    case 'transaction_store':
      return '/transaction-store';
    case 'transactions':
      return '/transaksi';
    case 'laporan_cashflow':
    case 'laporancashflow':
      return '/dashboard/laporancashflow';
    case 'laporan_kas':
    case 'laporankas':
      if (
        subModule === 'laporancashflow' ||
        subModule === 'laporan_cashflow' ||
        subModule === 'laporan-cashflow' ||
        subModule === 'cashflow'
      ) {
        return '/dashboard/laporancashflow';
      }
      return '/dashboard/laporankas';
    case 'myasset':
    case 'asset_toko':
      return '/dashboard/myasset';
    case 'assets':
      return '/dashboard/laporan';
    case 'products':
      return '/dashboard/produk';
    case 'produk_log':
    case 'product_log':
      return '/dashboard/produk-log';
    case 'anti_fraud':
      return '/dashboard/anti-fraud';
    case 'restock':
      return '/dashboard/restock-advisor';
    case 'client_pwa':
      if (subModule === 'home_member') {
        return '/client-pwa/clienthome';
      }
      if (subModule) {
        return `/client-pwa/${subModule.toLowerCase().replace(/_/g, '-')}`;
      }
      return '/client-pwa';
    case 'settings':
      return '/dashboard/pengaturan';

    case 'ai_architect':
    case 'ai-architect':
      return '/dashboard/ai-architect';

    // A. Artificial Intelligence
    case 'module_ai': {
      const sub = subModule || 'ai_master';
      if (sub === 'ai_architect' || sub === 'ai-architect') return '/dashboard/ai-architect';
      if (sub === 'ai_asset_stock' || sub === 'ai-asset-stock') return '/ai-asset-stock';
      if (sub === 'ai_page_builder' || sub === 'ai-page-builder' || sub === 'page_builder' || sub === 'ai_chart' || sub === 'ai-chart') {
        return '/dashboard/ai-page-builder';
      }
      if (sub === 'ai_master') return '/dashboard/ai/master';
      if (sub.startsWith('master/')) return `/dashboard/ai/${sub}`;
      if (sub === 'ai_knowledge' || sub === 'ai_agent' || sub === 'ai-agent' || sub === 'knowledge') {
        return '/dashboard/ai-agent';
      }
      if (sub === 'tanya_ai') return '/dashboard/ai/tanya-ai';
      if (sub === 'business-advisor' || sub === 'business_advisor' || sub === 'agent_business_advisor') {
        return '/dashboard/ai/business-advisor';
      }
      return `/dashboard/ai/${sub.replace(/_/g, '-')}?agent=${encodeURIComponent(sub)}`;
    }

    // B. Multi Outlet
    case 'module_multi_outlet': {
      const sub = subModule || 'lihat_outlet';
      if (sub === 'warehose' || sub === 'warehouse' || sub === 'gudang') return '/dashboard/multi-outlet/gudang';
      return '/dashboard/multi-outlet/lihat-outlet';
    }

    // C. Shift
    case 'module_shift': {
      const sub = subModule || 'cashir';
      if (sub === 'divisi_role' || sub === 'divisi-role' || sub === 'divisi') {
        return '/dashboard/shift/divisi-role';
      }
      if (sub === 'kas_masuk') return '/dashboard/shift/kas-masuk';
      if (sub === 'kas_keluar') return '/dashboard/shift/kas-keluar';
      if (sub === 'riwayat_shit' || sub === 'riwayat_shift') return '/dashboard/shift/riwayat';
      if (sub === 'end_shift' || sub === 'end-shift' || sub === 'endshift') return '/dashboard/shift/kasir/endshift';
      return '/dashboard/shift/kasir/endshift';
    }

    // E2. Stok Bahan Baku (/dashboard/bahan-baku)
    case 'bahan_baku':
    case 'module_bahan_baku': {
      const sub = (subModule || 'list').toLowerCase().replace(/-/g, '_');
      if (sub === 'supplier' || sub === 'daftar_supplier' || sub === 'bb_supplier') {
        return '/dashboard/bahan-baku/supplier';
      }
      if (sub === 'pembelian' || sub === 'pembelian_bahan_baku' || sub === 'bb_pembelian') {
        return '/dashboard/bahan-baku/pembelian';
      }
      if (sub === 'po' || sub === 'daftar_pembelian' || sub === 'bb_po') {
        return '/dashboard/bahan-baku/po';
      }
      if (sub === 'request' || sub === 'permintaan_pembelian' || sub === 'bb_request') {
        return '/dashboard/bahan-baku/request';
      }
      if (sub === 'ai' || sub === 'ai_bahan_baku' || sub === 'bb_ai') {
        return '/dashboard/bahan-baku/ai';
      }
      if (sub === 'tambah') return '/dashboard/bahan-baku/tambah';
      if (sub === 'kategori') return '/dashboard/bahan-baku/kategori';
      if (sub === 'stok_masuk') return '/dashboard/bahan-baku/stok-masuk';
      if (sub === 'stok_keluar') return '/dashboard/bahan-baku/stok-keluar';
      if (sub === 'opname') return '/dashboard/bahan-baku/opname';
      if (sub === 'pergerakan') return '/dashboard/bahan-baku/pergerakan';
      if (sub === 'kritis') return '/dashboard/bahan-baku/kritis';
      return '/dashboard/bahan-baku/';
    }

    // F. Procurement / Pembelian
    case 'module_procurement': {
      const sub = subModule || 'daftar_supplier';
      if (sub === 'daftar_pembelian') return '/dashboard/pembelian/daftar-pembelian';
      if (sub === 'request_pembelian') return '/dashboard/pembelian/request-pembelian';
      if (sub === 'pembelian_produk') return '/dashboard/pembelian/pembelian-produk';
      if (sub === 'statistik_pembelian') return '/dashboard/pembelian/statistik';
      return '/dashboard/pembelian/daftar-supplier';
    }

    // G. POS Transactions
    case 'module_pos_transactions': {
      const sub = subModule || 'transaksi_penjualan';
      if (sub === 'pendapatan_masuk') return '/dashboard/transaksi-pos/pendapatan-masuk';
      if (sub === 'pengeluaran_toko') return '/dashboard/transaksi-pos/pengeluaran-toko';
      return '/dashboard/transaksi-pos/penjualan';
    }

    // H. Inventory Tracking
    case 'module_inventory': {
      const sub = subModule || 'inventory';
      if (sub === 'kartu_stok') return '/dashboard/inventory/kartu-stok';
      if (sub === 'stok_minimum') return '/dashboard/inventory/stok-minimum';
      if (sub === 'stok_opname') return '/dashboard/inventory/stok-opname';
      if (sub === 'produk_restock') return '/dashboard/inventory/produk-restock';
      return '/dashboard/inventory';
    }

    // I. Customer
    case 'module_customer': {
      const sub = subModule || 'daftar_pelanggan';
      if (sub === 'tipe_pelanggan') return '/dashboard/pelanggan/tipe';
      if (sub === 'hutang_pelanggan') return '/dashboard/pelanggan/hutang';
      if (sub === 'poin_pelanggan') return '/dashboard/pelanggan/poin';
      if (sub === 'langganan') return '/dashboard/pelanggan/langganan';
      if (sub === 'claim_hadiah') return '/dashboard/pelanggan/claim-hadiah';
      return '/dashboard/pelanggan';
    }

    // J. Marketing
    case 'module_marketing': {
      const sub = subModule || 'hadiah_target';
      if (sub === 'informasi_hadiah') return '/dashboard/marketing/informasi-hadiah';
      if (sub === 'voucher_promo') return '/dashboard/marketing/voucher-promo';
      if (sub === 'setting_poin') return '/dashboard/marketing/setting-poin';
      if (sub === 'setting_poin_pwa') return '/dashboard/marketing/setting-poin-pwa';
      if (sub === 'statistik_marketing') return '/dashboard/marketing/statistik';
      return '/dashboard/marketing/hadiah-target';
    }

    case 'hakdanakses':
    case 'hak_dan_akses':
    case 'rbac':
      return '/dashboard/hakdanakses';

    case 'otoritas_akses':
    case 'otoritas-akses':
      return '/dashboard/staff/otoritas-akses';

    // K. Staff
    case 'module_staff': {
      const sub = subModule || 'daftar_staff';
      if (sub === 'role_jabatan') return '/dashboard/staff/role-jabatan';
      if (sub === 'otoritas_akses' || sub === 'otoritas-akses') return '/dashboard/staff/otoritas-akses';
      if (sub === 'hak_akses' || sub === 'hakdanakses' || sub === 'hak_dan_akses') return '/dashboard/hakdanakses';
      if (sub === 'kpi_staff') return '/dashboard/staff/kpi';
      if (sub === 'ai_setting_job_staff') return '/dashboard/staff/ai-job';
      return '/dashboard/staff';
    }

    // L. Finance
    case 'module_finance': {
      const sub = (subModule || 'brangkas_toko').toLowerCase();
      if (
        sub === 'brangkas_toko' ||
        sub === 'brangkas-toko' ||
        sub === 'bangkas_toko' ||
        sub === 'bangkas-toko'
      ) {
        return '/dashboard/keuangan/brangkas-toko';
      }
      if (sub === 'brangkas_modal' || sub === 'brangkas-modal' || sub.includes('modal')) {
        return '/dashboard/keuangan/brangkas-modal';
      }
      if (sub === 'brangkas_untung' || sub === 'brangkas-untung' || sub.includes('untung')) {
        return '/dashboard/keuangan/brangkas-untung';
      }
      if (sub === 'type_keuangan' || sub === 'jenis_jurnal' || sub === 'tipe-keuangan') {
        return '/dashboard/keuangan/tipe-keuangan';
      }
      if (sub === 'riwayat_keuangan' || sub === 'riwayat') {
        return '/dashboard/keuangan/riwayat';
      }
      return '/dashboard/keuangan/brangkas-toko';
    }

    // M. Online Order
    case 'module_online_order': {
      const sub = subModule || 'website_setting';
      if (sub === 'client_pwa_setting') return '/dashboard/online-order/client-pwa';
      return '/dashboard/online-order/website';
    }

    // N. PWA Settings
    case 'module_pwa_settings': {
      const sub = (subModule || 'umum').toLowerCase().replace(/_/g, '-');
      return `/dashboard/pengaturan-pwa/${sub}`;
    }

    // O. POS Settings
    case 'module_pos_settings': {
      const sub = subModule || 'umum';
      if (sub === 'menu' || sub === 'menu-builder' || sub === 'navigasi') return '/dashboard/pengaturan-pos/menu';
      if (sub === 'toko') return '/dashboard/pengaturan-pos/toko';
      if (sub === 'pembayaran') return '/dashboard/pengaturan-pos/pembayaran';
      if (sub === 'printer_struk') return '/dashboard/pengaturan-pos/printer-struk';
      if (sub === 'global_setup') return '/dashboard/pengaturan-pos/global-setup';
      if (sub === 'hak_akses') return '/dashboard/pengaturan-pos/hak-akses';
      if (sub === 'backup_restore') return '/dashboard/pengaturan-pos/backup-restore';
      if (sub === 'payment_gateway') return '/dashboard/pengaturan-pos/payment-gateway';
      if (sub === 'audit_log') return '/dashboard/pengaturan-pos/audit-log';
      return '/dashboard/pengaturan-pos/umum';
    }

    // P. Payment Integration
    case 'module_payment': {
      const sub = subModule || 'xendit';
      if (sub === 'doku') return '/dashboard/payment/doku';
      if (sub === 'midtrans') return '/dashboard/payment/midtrans';
      return '/dashboard/payment/xendit';
    }

    case 'custom_ai_page': {
      if (subModule) return `/dashboard/custom/${encodeURIComponent(subModule)}`;
      return '/dashboard/pengaturan-pos/menu';
    }

    case 'coming_soon': {
      if (subModule) return `/dashboard/segera-hadir?fitur=${encodeURIComponent(subModule)}`;
      return '/dashboard/segera-hadir';
    }

    default:
      return '/dashboard/pos';
  }
}

/**
 * Maps ProductCartonManager sub-tabs and actions to clean URL paths.
 */
export function getPathForProductSubTab(
  subTab: ProductCartonTabType,
  action?: 'table' | 'add_product' | 'edit' | 'stok',
  entityId?: string
): string {
  if (action === 'add_product') return '/dashboard/produk/tambah';
  if (action === 'edit' && entityId) return `/dashboard/produk/${encodeURIComponent(entityId)}/edit`;
  if (action === 'stok' && entityId) return `/dashboard/produk/${encodeURIComponent(entityId)}/stok`;

  switch (subTab) {
    case 'list':
      return '/dashboard/produk';
    case 'paket':
      return '/dashboard/paket-produk';
    case 'kategori':
      return '/dashboard/kategori-produk';
    case 'harga_diskon':
      return '/dashboard/harga-diskon';
    case 'masuk':
      return '/dashboard/produk/stok-masuk';
    case 'keluar':
      return '/dashboard/produk/stok-keluar';
    case 'opname':
      return '/dashboard/produk/opname';
    case 'pergerakan':
      return '/dashboard/produk/pergerakan';
    case 'kritis':
      return '/dashboard/produk/kritis';
    default:
      return '/dashboard/produk';
  }
}

/**
 * Pure function that derives the entire active view/tab/sub-page state directly from the browser URL.
 */
export function resolveRouteFromLocation(pathname: string, search: string = ''): ResolvedAppRoute {
  const base: ResolvedAppRoute = {
    activeTab: 'pos_machine',
    activeSubModule: 'ai_master',
    productSubTab: 'list',
    productViewMode: 'table',
    bundleView: 'directory',
    discountView: 'directory',
    orderSubTab: 'all',
    orderAction: 'list',
    actionMode: 'list',
  };

  const rawSegments = pathname
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  const segments = rawSegments.map((s) => s.toLowerCase());
  const searchParams = new URLSearchParams(search);
  const agentQuery = searchParams.get('agent');

  let isUnderDashboard = false;
  if (segments[0] === 'dashboard' && segments.length > 1) {
    if (segments[1] === 'tambah' || segments[1] === 'tambah-order') {
      return {
        ...base,
        activeTab: 'admin_dashboard',
        actionMode: 'tambah',
      };
    }
    isUnderDashboard = true;
    rawSegments.shift();
    segments.shift();
  }

  // Root path '/'
  if (segments.length === 0) {
    if (agentQuery) {
      return {
        ...base,
        activeTab: 'module_ai',
        activeSubModule: agentQuery,
      };
    }
    return {
      ...base,
      activeTab: 'admin',
    };
  }

  const first = segments[0];
  const second = segments[1] || '';
  const third = segments[2] || '';

  // 0. Login Page (/login)
  if (first === 'login' || first === 'signin' || first === 'sign-in') {
    return {
      ...base,
      activeTab: 'login',
    };
  }

  // 1. POS Machine (/pos, /pos/*, /dashboard/pos, /dashboard/pos/*, /pos-machine, /kasir, /terminal-kasir)
  if (first === 'pos' || first === 'pos-machine' || first === 'kasir' || first === 'terminal-kasir') {
    const isWaiterPos =
      searchParams.get('waiter') === '1' ||
      second === 'waiter' ||
      second === 'waiters';
    const posSub = second || 'kasir';
    return {
      ...base,
      view: 'pos',
      posSubTab: posSub,
      activeTab: 'pos_machine',
      activeSubModule: isWaiterPos ? 'waiter' : base.activeSubModule,
      entityId: rawSegments[1] ? decodeURIComponent(rawSegments[1]) : undefined,
    };
  }

  // 1b. Dedicated Waiters Route (/waiters & /waiters/pos) -> Directly opens POS Cashier Terminal
  if (first === 'waiters' || first === 'waiter' || first === 'pelayan') {
    if (second === 'meja' || second === 'layout' || second === 'denah') {
      return {
        ...base,
        activeTab: 'waiters',
      };
    }
    return {
      ...base,
      view: 'pos',
      posSubTab: second && second !== 'pos' ? second : 'kasir',
      activeTab: 'pos_machine',
      activeSubModule: 'waiter',
    };
  }

  // 1c. Dedicated Kitchen Display System Route (/kitchen)
  if (first === 'kitchen' || first === 'dapur' || first === 'kds') {
    return {
      ...base,
      activeTab: 'kitchen',
    };
  }

  // 2. Landing / Beranda
  if (first === 'beranda' || first === 'landing') {
    return { ...base, activeTab: 'landing' };
  }

  // 2b. Reservation Table (/dashboard/reservation, /dashboard/reservation/list, /dashboard/layout-table, /dashboard/layout-table/summary)
  if (first === 'reservation' || first === 'reservasi') {
    if (second === 'list' || second === 'daftar') {
      return {
        ...base,
        activeTab: 'layout_table',
        activeSubModule: 'reservation_list',
      };
    }
    return {
      ...base,
      activeTab: 'layout_table',
      activeSubModule: 'reservation',
    };
  }

  if (
    first === 'layout-table' ||
    first === 'layout_table' ||
    first === 'table-layout' ||
    first === 'table_layout' ||
    first === 'denah-meja' ||
    first === 'meja'
  ) {
    if (second === 'summary' || second === 'report' || second === 'summary-report') {
      return {
        ...base,
        activeTab: 'layout_table',
        activeSubModule: 'summary',
      };
    }
    if (second === 'reservation' || second === 'reservasi') {
      return {
        ...base,
        activeTab: 'layout_table',
        activeSubModule: third === 'list' ? 'reservation_list' : 'reservation',
      };
    }
    if (second === 'list') {
      return {
        ...base,
        activeTab: 'layout_table',
        activeSubModule: 'reservation_list',
      };
    }
    return {
      ...base,
      activeTab: 'layout_table',
      activeSubModule: 'layout',
    };
  }

  // 3. Admin Dashboard
  if (first === 'dashboard' || first === 'admin-dashboard' || first === 'dashboard-admin') {
    return {
      ...base,
      activeTab: 'admin',
      actionMode: second === 'tambah' || second === 'tambah-order' ? 'tambah' : 'list',
    };
  }

  // 4. Orders Wharf
  if (first === 'orders' || first === 'pesanan' || first === 'pesanan-pwa') {
    if (second === 'tambah' || second === 'add') {
      return { ...base, activeTab: 'orders', orderAction: 'tambah', actionMode: 'tambah' };
    }
    const statusMap: Record<string, string> = {
      all: 'all',
      semua: 'all',
      new: 'new',
      baru: 'new',
      menunggu: 'new',
      pending: 'new',
      verified: 'verified',
      terverifikasi: 'verified',
      packing: 'packing',
      diproses: 'packing',
      processing: 'packing',
      ready: 'ready',
      siap: 'ready',
      shipped: 'shipped',
      dikirim: 'shipped',
      delivered: 'delivered',
      terkirim: 'delivered',
      completed: 'completed',
      selesai: 'completed',
      returned: 'returned',
      retur: 'returned',
      rejected: 'rejected',
      ditolak: 'rejected',
    };
    if (second && statusMap[second]) {
      return { ...base, activeTab: 'orders', orderSubTab: statusMap[second] };
    }
    if (second) {
      return {
        ...base,
        activeTab: 'orders',
        orderAction: 'detail',
        orderId: decodeURIComponent(rawSegments[1]),
        entityId: decodeURIComponent(rawSegments[1]),
        actionMode: 'detail',
      };
    }
    return { ...base, activeTab: 'orders' };
  }

  // 5. Paket Produk (/paket-produk, /paket-produk/tambah, /paket-produk/:id/edit, /varian-produk)
  if (first === 'paket-produk' || first === 'product-bundles' || first === 'varian-produk') {
    if (second === 'tambah' || second === 'add') {
      return {
        ...base,
        activeTab: 'products',
        productSubTab: 'paket',
        bundleView: 'add_bundle',
        actionMode: 'tambah',
      };
    }
    if (second && (third === 'edit' || third === 'ubah')) {
      return {
        ...base,
        activeTab: 'products',
        productSubTab: 'paket',
        bundleView: 'add_bundle',
        bundleEditId: decodeURIComponent(rawSegments[1]),
        entityId: decodeURIComponent(rawSegments[1]),
        actionMode: 'edit',
      };
    }
    return {
      ...base,
      activeTab: 'products',
      productSubTab: 'paket',
      bundleView: 'directory',
      entityId: rawSegments[1] ? decodeURIComponent(rawSegments[1]) : undefined,
    };
  }

  // 6. Kategori Produk (/kategori-produk, /kategori-produk/tambah)
  if (first === 'kategori-produk' || first === 'kategori-brand') {
    return {
      ...base,
      activeTab: 'products',
      productSubTab: 'kategori',
      actionMode: second === 'tambah' || second === 'add' ? 'tambah' : 'list',
    };
  }

  // 7. Harga Diskon (/harga-diskon, /harga-diskon/tambah, /harga-diskon/:id/edit)
  if (first === 'harga-diskon' || first === 'discount-pricing') {
    if (second === 'tambah' || second === 'add') {
      return {
        ...base,
        activeTab: 'products',
        productSubTab: 'harga_diskon',
        discountView: 'add_form',
        actionMode: 'tambah',
      };
    }
    if (second && (third === 'edit' || third === 'ubah')) {
      return {
        ...base,
        activeTab: 'products',
        productSubTab: 'harga_diskon',
        discountView: 'add_form',
        discountEditId: decodeURIComponent(rawSegments[1]),
        entityId: decodeURIComponent(rawSegments[1]),
        actionMode: 'edit',
      };
    }
    return {
      ...base,
      activeTab: 'products',
      productSubTab: 'harga_diskon',
      discountView: 'directory',
    };
  }

  // 7b. Produk Log (/dashboard/produk-log, /produk-log, /product-log)
  if (
    first === 'produk-log' ||
    first === 'product-log' ||
    first === 'log-produk' ||
    (first === 'produk' && (second === 'log' || second === 'produk-log'))
  ) {
    return {
      ...base,
      activeTab: 'produk_log',
    };
  }

  // 8. Produk (/produk, /produk/tambah, /produk/:id/edit, /produk/paket, etc.)
  if (first === 'produk' || first === 'products' || first === 'halaman-produk') {
    if (!second || second === 'list' || second === 'daftar') {
      return { ...base, activeTab: 'products', productSubTab: 'list', productViewMode: 'table' };
    }
    if (second === 'tambah' || second === 'add') {
      return {
        ...base,
        activeTab: 'products',
        productSubTab: 'list',
        productViewMode: 'add_product',
        actionMode: 'tambah',
      };
    }
    if (second === 'paket' || second === 'paket-produk' || second === 'bundles') {
      if (third === 'tambah' || third === 'add') {
        return {
          ...base,
          activeTab: 'products',
          productSubTab: 'paket',
          bundleView: 'add_bundle',
          actionMode: 'tambah',
        };
      }
      if (third && segments[3] === 'edit') {
        return {
          ...base,
          activeTab: 'products',
          productSubTab: 'paket',
          bundleView: 'add_bundle',
          bundleEditId: decodeURIComponent(rawSegments[2]),
          actionMode: 'edit',
        };
      }
      return { ...base, activeTab: 'products', productSubTab: 'paket', bundleView: 'directory' };
    }
    if (second === 'kategori' || second === 'kategori-brand') {
      return {
        ...base,
        activeTab: 'products',
        productSubTab: 'kategori',
        actionMode: third === 'tambah' ? 'tambah' : 'list',
      };
    }
    if (second === 'harga-diskon' || second === 'diskon') {
      if (third === 'tambah' || third === 'add') {
        return {
          ...base,
          activeTab: 'products',
          productSubTab: 'harga_diskon',
          discountView: 'add_form',
          actionMode: 'tambah',
        };
      }
      if (third && segments[3] === 'edit') {
        return {
          ...base,
          activeTab: 'products',
          productSubTab: 'harga_diskon',
          discountView: 'add_form',
          discountEditId: decodeURIComponent(rawSegments[2]),
          actionMode: 'edit',
        };
      }
      return { ...base, activeTab: 'products', productSubTab: 'harga_diskon', discountView: 'directory' };
    }
    if (second === 'stok-masuk' || second === 'masuk' || second === 'inflow') {
      return {
        ...base,
        activeTab: 'products',
        productSubTab: 'masuk',
        actionMode: third === 'tambah' ? 'tambah' : 'list',
      };
    }
    if (second === 'stok-keluar' || second === 'keluar' || second === 'outflow') {
      return {
        ...base,
        activeTab: 'products',
        productSubTab: 'keluar',
        actionMode: third === 'tambah' ? 'tambah' : 'list',
      };
    }
    if (second === 'opname' || second === 'audit') {
      return { ...base, activeTab: 'products', productSubTab: 'opname' };
    }
    if (second === 'pergerakan' || second === 'movements') {
      return { ...base, activeTab: 'products', productSubTab: 'pergerakan' };
    }
    if (second === 'kritis' || second === 'critical') {
      return { ...base, activeTab: 'products', productSubTab: 'kritis' };
    }

    // Specific product ID action: /produk/:id, /produk/:id/edit, /produk/:id/stok
    const prodId = decodeURIComponent(rawSegments[1]);
    if (third === 'edit' || third === 'ubah') {
      return {
        ...base,
        activeTab: 'products',
        productSubTab: 'list',
        productViewMode: 'table',
        productEntityId: prodId,
        productAction: 'edit',
        entityId: prodId,
        actionMode: 'edit',
      };
    }
    if (third === 'stok' || third === 'stock') {
      return {
        ...base,
        activeTab: 'products',
        productSubTab: 'list',
        productViewMode: 'table',
        productEntityId: prodId,
        productAction: 'stok',
        entityId: prodId,
        actionMode: 'edit',
      };
    }
    return {
      ...base,
      activeTab: 'products',
      productSubTab: 'list',
      productViewMode: 'table',
      productEntityId: prodId,
      productAction: 'view',
      entityId: prodId,
      actionMode: 'detail',
    };
  }

  // 8b. Stok Bahan Baku (/dashboard/bahan-baku, /dashboard/bahan-baku/supplier, /pembelian, /po, /request, /ai, /tambah, /:id/edit)
  if (first === 'bahan-baku' || first === 'bahan_baku' || first === 'stok-bahan-baku') {
    if (!second || second === 'list' || second === 'daftar') {
      return {
        ...base,
        activeTab: 'module_bahan_baku',
        activeSubModule: 'list',
      };
    }
    if (second === 'tambah' || second === 'add') {
      return {
        ...base,
        activeTab: 'module_bahan_baku',
        activeSubModule: 'tambah',
        actionMode: 'tambah',
      };
    }
    if (second === 'supplier' || second === 'daftar-supplier' || second === 'daftar_supplier') {
      return {
        ...base,
        activeTab: 'module_bahan_baku',
        activeSubModule: 'supplier',
      };
    }
    if (second === 'pembelian' || second === 'pembelian-bahan-baku') {
      return {
        ...base,
        activeTab: 'module_bahan_baku',
        activeSubModule: 'pembelian',
      };
    }
    if (second === 'po' || second === 'daftar-pembelian' || second === 'daftar_pembelian') {
      return {
        ...base,
        activeTab: 'module_bahan_baku',
        activeSubModule: 'po',
      };
    }
    if (second === 'request' || second === 'request-pembelian' || second === 'permintaan-pembelian') {
      return {
        ...base,
        activeTab: 'module_bahan_baku',
        activeSubModule: 'request',
      };
    }
    if (second === 'ai' || second === 'ai-bahan-baku') {
      return {
        ...base,
        activeTab: 'module_bahan_baku',
        activeSubModule: 'ai',
      };
    }
    if (second === 'kategori' || second === 'kategori-brand') {
      return {
        ...base,
        activeTab: 'module_bahan_baku',
        activeSubModule: 'kategori',
      };
    }
    if (second === 'stok-masuk' || second === 'masuk') {
      return {
        ...base,
        activeTab: 'module_bahan_baku',
        activeSubModule: 'stok_masuk',
      };
    }
    if (second === 'stok-keluar' || second === 'keluar') {
      return {
        ...base,
        activeTab: 'module_bahan_baku',
        activeSubModule: 'stok_keluar',
      };
    }
    if (second === 'opname' || second === 'stok-opname') {
      return {
        ...base,
        activeTab: 'module_bahan_baku',
        activeSubModule: 'opname',
      };
    }
    if (second === 'pergerakan' || second === 'kartu-stok') {
      return {
        ...base,
        activeTab: 'module_bahan_baku',
        activeSubModule: 'pergerakan',
      };
    }
    if (second === 'kritis' || second === 'stok-minimum') {
      return {
        ...base,
        activeTab: 'module_bahan_baku',
        activeSubModule: 'kritis',
      };
    }
    const rmId = decodeURIComponent(rawSegments[1]);
    if (third === 'edit' || third === 'ubah') {
      return {
        ...base,
        activeTab: 'module_bahan_baku',
        activeSubModule: 'edit',
        entityId: rmId,
        actionMode: 'edit',
      };
    }
    return {
      ...base,
      activeTab: 'module_bahan_baku',
      activeSubModule: 'list',
      entityId: rmId,
    };
  }

  // 9. Transactions Feed (/transaksi)
  if (first === 'transaction-store') {
    return {
      ...base,
      activeTab: 'transaction_store',
    };
  }

  if (first === 'transaksi' || first === 'transactions' || first === 'transaction-feed') {
    return {
      ...base,
      activeTab: 'transactions',
      entityId: rawSegments[1] ? decodeURIComponent(rawSegments[1]) : undefined,
      actionMode: rawSegments[1] ? 'detail' : 'list',
    };
  }

  // 10. Financial Assets & Reports (/laporan, /aset-finansial, /assets, /asset)
  if (
    first === 'laporan' ||
    first === 'aset-finansial' ||
    first === 'financial-assets' ||
    first === 'assets' ||
    first === 'asset'
  ) {
    return {
      ...base,
      activeTab: 'assets',
      entityId: rawSegments[1] ? decodeURIComponent(rawSegments[1]) : undefined,
      actionMode: rawSegments[1] ? 'detail' : 'list',
    };
  }

  // 10a. Asset Toko (/dashboard/myasset, /myasset, /asset-toko)
  if (
    first === 'myasset' ||
    first === 'my-asset' ||
    first === 'asset-toko' ||
    first === 'assettoko'
  ) {
    return {
      ...base,
      activeTab: 'myasset',
    };
  }

  // 10b. Laporan Cashflow & Laba Rugi Detail 1 Halaman (/dashboard/laporancashflow, /laporancashflow)
  if (
    first === 'laporancashflow' ||
    first === 'laporan-cashflow' ||
    first === 'laporan_cashflow' ||
    first === 'cashflow'
  ) {
    return {
      ...base,
      activeTab: 'laporan_kas',
      activeSubModule: 'laporancashflow',
    };
  }

  // 10c. Laporan Penjualan & Kas Lengkap (/dashboard/laporankas, /laporankas)
  if (first === 'laporankas' || first === 'laporan-kas' || first === 'laporankasir') {
    const normalizedSub = (second || 'keseluruhan').replace(/-/g, '_');
    return {
      ...base,
      activeTab: 'laporan_kas',
      activeSubModule: normalizedSub,
    };
  }

  // 11. AI Anti-Fraud (/anti-fraud, /ai-preventif)
  if (first === 'anti-fraud' || first === 'ai-anti-fraud' || first === 'ai-preventif') {
    return { ...base, activeTab: 'anti_fraud' };
  }

  // 11b. AI Chart (Analytics Area Charts Dashboard)
  if (first === 'ai-chart') {
    return { ...base, activeTab: 'admin_dashboard' };
  }

  // 12. Restock Advisor
  if (first === 'restock-advisor' || first === 'restock') {
    return {
      ...base,
      activeTab: 'restock',
      entityId: rawSegments[1] ? decodeURIComponent(rawSegments[1]) : undefined,
    };
  }

  // 13. Client PWA (/client-pwa, /pwa)
  if (first === 'client-pwa' || first === 'pwa') {
    const subPath = second ? (third ? `${second}/${third}` : second) : 'splash';
    return {
      ...base,
      activeTab: 'client_pwa',
      activeSubModule: subPath,
    };
  }

  // 14. Settings
  if (first === 'pengaturan' || first === 'settings') {
    return { ...base, activeTab: 'settings' };
  }

  // 15. A. Artificial Intelligence (/dashboard/ai-architect, /dashboard/ai-agent, /ai, /ai/:sub, /tanya-ai)
  if (
    first === 'ai-asset-stock' ||
    first === 'ai_asset_stock' ||
    (first === 'ai' && (second === 'asset-stock' || second === 'ai-asset-stock' || second === 'ai_asset_stock'))
  ) {
    return { ...base, activeTab: 'ai-asset-stock', activeSubModule: 'ai-asset-stock' };
  }

  if (
    first === 'ai-architect' ||
    first === 'ai_architect' ||
    first === 'system-architect' ||
    (first === 'ai' && (second === 'architect' || second === 'ai-architect' || second === 'ai_architect'))
  ) {
    return { ...base, activeTab: 'ai_architect', activeSubModule: 'ai_architect' };
  }

  if (
    first === 'ai-page-builder' ||
    first === 'ai_page_builder' ||
    first === 'page-builder' ||
    first === 'page_builder' ||
    first === 'ai-chart' ||
    first === 'ai_chart' ||
    first === 'ai-charts' ||
    (first === 'ai' && (second === 'page-builder' || second === 'ai-page-builder' || second === 'chart' || second === 'charts'))
  ) {
    return { ...base, activeTab: 'module_ai', activeSubModule: 'ai_page_builder' };
  }

  if (
    first === 'ai-agent' ||
    first === 'ai_agent' ||
    first === 'ai-knowledge' ||
    first === 'ai_knowledge'
  ) {
    return { ...base, activeTab: 'module_ai', activeSubModule: 'ai_agent' };
  }

  if (first === 'ai' || first === 'artificial-intelligence' || first === 'tanya-ai') {
    if (first === 'tanya-ai' || second === 'tanya-ai' || second === 'tanya_ai') {
      return { ...base, activeTab: 'module_ai', activeSubModule: 'tanya_ai' };
    }
    if (second === 'master' || second === 'ai-master' || second === 'ai_master') {
      if (third) {
        const cleanSlug = decodeURIComponent(rawSegments[2]);
        return {
          ...base,
          activeTab: 'module_ai',
          activeSubModule: `master/${cleanSlug}`,
          entityId: cleanSlug,
          actionMode: 'detail',
        };
      }
      return { ...base, activeTab: 'module_ai', activeSubModule: 'ai_master' };
    }
    if (
      second === 'ai-agent' ||
      second === 'ai_agent' ||
      second === 'knowledge' ||
      second === 'ai-knowledge' ||
      second === 'ai_knowledge'
    ) {
      return { ...base, activeTab: 'module_ai', activeSubModule: 'ai_agent' };
    }
    if (second) {
      return { ...base, activeTab: 'module_ai', activeSubModule: second };
    }
    if (agentQuery) {
      return { ...base, activeTab: 'module_ai', activeSubModule: agentQuery };
    }
    return { ...base, activeTab: 'module_ai', activeSubModule: 'ai_master' };
  }

  // 16. B. Multi Outlet (/multi-outlet, /outlet)
  if (first === 'multi-outlet' || first === 'outlet' || first === 'gudang') {
    const isWarehouse =
      first === 'gudang' ||
      second === 'gudang' ||
      second === 'warehouse' ||
      second === 'warehose';
    return {
      ...base,
      activeTab: 'module_multi_outlet',
      activeSubModule: isWarehouse ? 'warehose' : 'lihat_outlet',
      actionMode: second === 'tambah' || third === 'tambah' ? 'tambah' : 'list',
      entityId: second === 'detail' && rawSegments[2] ? decodeURIComponent(rawSegments[2]) : undefined,
    };
  }

  // 17. C. Shift Management (/shift)
  if (first === 'shift') {
    let sub = 'cashir';
    if (second === 'divisi-role' || second === 'divisi_role' || second === 'divisi') sub = 'divisi_role';
    else if (second === 'kas-masuk' || second === 'kas_masuk') sub = 'kas_masuk';
    else if (second === 'kas-keluar' || second === 'kas_keluar') sub = 'kas_keluar';
    else if (second === 'riwayat' || second === 'riwayat-shift' || second === 'riwayat_shit') sub = 'riwayat_shit';
    else if (
      second === 'end-shift' ||
      second === 'end_shift' ||
      second === 'endshift' ||
      second === 'kasir' ||
      third === 'endshift' ||
      third === 'end-shift' ||
      third === 'end_shift'
    ) {
      sub = 'cashir';
    }
    return {
      ...base,
      activeTab: 'module_shift',
      activeSubModule: sub,
    };
  }

  // 18. F. Procurement / Pembelian (/pembelian, /supplier, /hutang-supplier)
  if (first === 'pembelian' || first === 'procurement' || first === 'supplier' || first === 'hutang-supplier') {
    let sub = first === 'hutang-supplier' ? 'daftar_pembelian' : 'daftar_supplier';
    if (second === 'daftar-pembelian' || second === 'daftar_pembelian') sub = 'daftar_pembelian';
    else if (second === 'request-pembelian' || second === 'request_pembelian') sub = 'request_pembelian';
    else if (second === 'pembelian-produk' || second === 'pembelian_produk' || second === 'tambah')
      sub = 'pembelian_produk';
    else if (second === 'statistik' || second === 'statistik-pembelian' || second === 'statistik_pembelian')
      sub = 'statistik_pembelian';
    return {
      ...base,
      activeTab: 'module_procurement',
      activeSubModule: sub,
    };
  }

  // 19. G. POS Transactions (/transaksi-pos, /pengeluaran)
  if (first === 'transaksi-pos' || first === 'pengeluaran') {
    let sub = first === 'pengeluaran' ? 'pengeluaran_toko' : 'transaksi_penjualan';
    if (second === 'pendapatan-masuk' || second === 'pendapatan_masuk') sub = 'pendapatan_masuk';
    else if (second === 'pengeluaran-toko' || second === 'pengeluaran_toko') sub = 'pengeluaran_toko';
    return {
      ...base,
      activeTab: 'module_pos_transactions',
      activeSubModule: sub,
      entityId: rawSegments[2] ? decodeURIComponent(rawSegments[2]) : undefined,
    };
  }

  // 20. H. Inventory Tracking (/inventory, /lacak-inventory, /log-barang, /stok-opname, /stok-minimum)
  if (
    first === 'inventory' ||
    first === 'lacak-inventory' ||
    first === 'log-barang' ||
    first === 'stok-opname' ||
    first === 'stok-minimum'
  ) {
    let sub = 'inventory';
    if (first === 'log-barang' || second === 'kartu-stok' || second === 'kartu_stok') sub = 'kartu_stok';
    else if (first === 'stok-minimum' || second === 'stok-minimum' || second === 'stok_minimum') sub = 'stok_minimum';
    else if (first === 'stok-opname' || second === 'stok-opname' || second === 'stok_opname') sub = 'stok_opname';
    else if (second === 'produk-restock' || second === 'produk_restock') sub = 'produk_restock';
    return {
      ...base,
      activeTab: 'module_inventory',
      activeSubModule: sub,
    };
  }

  // 21. I. Customers (/pelanggan, /customers, /poin-hadiah, /hutang-pelanggan, /customer-types)
  if (
    first === 'pelanggan' ||
    first === 'customers' ||
    first === 'poin-hadiah' ||
    first === 'hutang-pelanggan' ||
    first === 'customer-types'
  ) {
    let sub = 'daftar_pelanggan';
    if (first === 'customer-types' || second === 'tipe' || second === 'tipe-pelanggan' || second === 'tipe_pelanggan')
      sub = 'tipe_pelanggan';
    else if (first === 'hutang-pelanggan' || second === 'hutang' || second === 'hutang-pelanggan' || second === 'hutang_pelanggan')
      sub = 'hutang_pelanggan';
    else if (first === 'poin-hadiah' || second === 'poin' || second === 'poin-pelanggan' || second === 'poin_pelanggan')
      sub = 'poin_pelanggan';
    else if (second === 'langganan') sub = 'langganan';
    else if (second === 'claim-hadiah' || second === 'claim_hadiah') sub = 'claim_hadiah';
    return {
      ...base,
      activeTab: first === 'customer-types' ? 'customer_types' : 'module_customer',
      activeSubModule: sub,
      actionMode: second === 'tambah' || third === 'tambah' ? 'tambah' : 'list',
    };
  }

  // 22. J. Marketing (/marketing, /teknik-marketing)
  if (first === 'marketing' || first === 'teknik-marketing') {
    let sub = 'hadiah_target';
    if (second === 'informasi-hadiah' || second === 'informasi_hadiah') sub = 'informasi_hadiah';
    else if (second === 'voucher-promo' || second === 'voucher_promo') sub = 'voucher_promo';
    else if (second === 'setting-poin' || second === 'setting_poin') sub = 'setting_poin';
    else if (second === 'setting-poin-pwa' || second === 'setting_poin_pwa') sub = 'setting_poin_pwa';
    else if (second === 'statistik' || second === 'statistik-marketing' || second === 'statistik_marketing')
      sub = 'statistik_marketing';
    return {
      ...base,
      activeTab: 'module_marketing',
      activeSubModule: sub,
      actionMode: second === 'tambah' || third === 'tambah' ? 'tambah' : 'list',
    };
  }

  // 23. K. Staff (/staff)
  if (first === 'staff') {
    let sub = 'daftar_staff';
    if (second === 'role-jabatan' || second === 'role_jabatan') sub = 'role_jabatan';
    else if (second === 'otoritas-akses' || second === 'otoritas_akses') sub = 'otoritas_akses';
    else if (
      second === 'hak-akses' ||
      second === 'hak_akses' ||
      second === 'hakdanakses' ||
      second === 'hak-dan-akses'
    )
      sub = 'hak_akses';
    else if (second === 'kpi' || second === 'kpi-staff' || second === 'kpi_staff') sub = 'kpi_staff';
    else if (second === 'ai-job' || second === 'ai-setting-job-staff' || second === 'ai_setting_job_staff')
      sub = 'ai_setting_job_staff';
    return {
      ...base,
      activeTab: 'module_staff',
      activeSubModule: sub,
    };
  }

  // 23b. Direct RBAC Route (/otoritas-akses, /hakdanakses, /hak-dan-akses, /hak-akses, /rbac)
  if (
    first === 'otoritas-akses' ||
    first === 'otoritas_akses' ||
    first === 'hakdanakses' ||
    first === 'hak-dan-akses' ||
    first === 'hak-akses' ||
    first === 'rbac'
  ) {
    return {
      ...base,
      activeTab: 'module_staff',
      activeSubModule:
        first === 'otoritas-akses' || first === 'otoritas_akses' ? 'otoritas_akses' : 'hak_akses',
    };
  }

  // 24. L. Finance (/keuangan, /finance)
  if (first === 'keuangan' || first === 'finance') {
    let sub = 'brangkas_toko';
    if (
      second === 'brangkas-toko' ||
      second === 'brangkas_toko' ||
      second === 'bangkas-toko' ||
      second === 'bangkas_toko' ||
      second?.includes('toko')
    )
      sub = 'brangkas_toko';
    else if (second === 'brangkas-modal' || second === 'brangkas_modal' || second?.includes('modal'))
      sub = 'brangkas_modal';
    else if (second === 'brangkas-untung' || second === 'brangkas_untung' || second?.includes('untung'))
      sub = 'brangkas_untung';
    else if (
      second === 'tipe-keuangan' ||
      second === 'type_keuangan' ||
      second === 'jenis-jurnal' ||
      second === 'jenis_jurnal'
    )
      sub = 'type_keuangan';
    else if (second === 'riwayat' || second === 'riwayat-keuangan' || second === 'riwayat_keuangan')
      sub = 'riwayat_keuangan';
    return {
      ...base,
      activeTab: 'module_finance',
      activeSubModule: sub,
    };
  }

  // 25. M. Online Order (/online-order)
  if (first === 'online-order' || first === 'setting-online-order') {
    const sub =
      second === 'client-pwa' || second === 'client-pwa-setting' || second === 'client_pwa_setting'
        ? 'client_pwa_setting'
        : 'website_setting';
    return {
      ...base,
      activeTab: 'module_online_order',
      activeSubModule: sub,
    };
  }

  // 26. N. PWA Settings (/pengaturan-pwa/:slug, /pwa-standalone)
  if (first === 'pwa-standalone') {
    return {
      ...base,
      activeTab: 'pwa_settings',
    };
  }
  if (first === 'pengaturan-pwa' || first === 'pwa-settings') {
    if (second === 'standalone') {
      return {
        ...base,
        activeTab: 'pwa_settings',
      };
    }
    const rawSub = (second || 'umum').toLowerCase().replace(/_/g, '-');
    return {
      ...base,
      activeTab: 'module_pwa_settings',
      activeSubModule: rawSub,
    };
  }

  // 27. O. POS Settings (/pengaturan-pos)
  if (first === 'pengaturan-pos' || first === 'pos-settings') {
    let sub = 'umum';
    if (second === 'menu' || second === 'menu-builder' || second === 'navigasi') sub = 'menu';
    else if (second === 'toko') sub = 'toko';
    else if (second === 'pembayaran') sub = 'pembayaran';
    else if (second === 'printer-struk' || second === 'printer_struk') sub = 'printer_struk';
    else if (second === 'global-setup' || second === 'global_setup') sub = 'global_setup';
    else if (second === 'hak-akses' || second === 'hak_akses') sub = 'hak_akses';
    else if (second === 'backup-restore' || second === 'backup_restore') sub = 'backup_restore';
    else if (second === 'payment-gateway' || second === 'payment_gateway') sub = 'payment_gateway';
    else if (second === 'audit-log' || second === 'audit_log') sub = 'audit_log';
    return {
      ...base,
      activeTab: 'module_pos_settings',
      activeSubModule: sub,
    };
  }

  // 28. P. Payment Integration (/payment, /integrasi-payment)
  if (first === 'payment' || first === 'integrasi-payment') {
    let sub = 'xendit';
    if (second === 'doku') sub = 'doku';
    else if (second === 'midtrans') sub = 'midtrans';
    return {
      ...base,
      activeTab: 'module_payment',
      activeSubModule: sub,
    };
  }

  // 29. Custom AI Page (/dashboard/custom/:slug, /custom/:slug)
  if (first === 'custom' || first === 'ai-page' || first === 'halaman-ai') {
    const slug = rawSegments[1] ? decodeURIComponent(rawSegments[1]) : 'custom-ai-page';
    return {
      ...base,
      activeTab: 'custom_ai_page',
      activeSubModule: slug,
      entityId: slug,
    };
  }

  // 30. Placeholder / Segera Hadir (/segera-hadir, /coming-soon)
  if (first === 'segera-hadir' || first === 'coming-soon') {
    return {
      ...base,
      activeTab: 'coming_soon',
      entityId: searchParams.get('fitur') || searchParams.get('item') || second || undefined,
    };
  }

  if (isUnderDashboard) {
    return {
      ...base,
      activeTab: 'admin_dashboard',
    };
  }

  return base;
}

/**
 * Custom hook that provides URL-driven route state and navigation functions that preserve system query params.
 */
export function useAppNavigation() {
  const location = useLocation();
  const navigate = useNavigate();

  const route = React.useMemo(
    () => resolveRouteFromLocation(location.pathname, location.search),
    [location.pathname, location.search]
  );

  const navigateToPath = React.useCallback(
    (targetPath: string, options?: { replace?: boolean }) => {
      const fullUrl = buildUrlWithSearch(targetPath, location.search);
      navigate(fullUrl, options);
    },
    [navigate, location.search]
  );

  const navigateTab = React.useCallback(
    (tabId: string, subModule?: string) => {
      // Allow callers passing a direct URL path starting with '/'
      if (tabId.startsWith('/')) {
        navigateToPath(tabId);
        return;
      }
      const targetPath = getPathForTab(tabId, subModule);
      navigateToPath(targetPath);
    },
    [navigateToPath]
  );

  const navigateProductSubTab = React.useCallback(
    (
      subTab: ProductCartonTabType,
      action?: 'table' | 'add_product' | 'edit' | 'stok',
      entityId?: string
    ) => {
      const targetPath = getPathForProductSubTab(subTab, action, entityId);
      navigateToPath(targetPath);
    },
    [navigateToPath]
  );

  const setActiveTab = React.useCallback(
    (tabId: string) => {
      navigateTab(tabId);
    },
    [navigateTab]
  );

  const setActiveSubModule = React.useCallback(
    (subModule: string) => {
      navigateTab(route.activeTab, subModule);
    },
    [navigateTab, route.activeTab]
  );

  return {
    route,
    activeView: route.view || (route.activeTab === 'pos_machine' ? 'pos' : route.activeTab === 'landing' ? 'landing' : 'admin'),
    posSubTab: route.posSubTab || 'kasir',
    activeTab: route.activeTab,
    activeSubModule: route.activeSubModule,
    setActiveTab,
    setActiveSubModule,
    pathname: location.pathname,
    search: location.search,
    navigate: navigateToPath,
    navigateToPath,
    navigateTab,
    navigateProductSubTab,
  };
}

export interface AppLinkProps extends Omit<LinkProps, 'to'> {
  to: string;
}

/**
 * Drop-in <Link> wrapper that automatically preserves existing query parameters (e.g. ?agent=...).
 */
export const AppLink: React.FC<AppLinkProps> = ({ to, children, ...rest }) => {
  const location = useLocation();
  const fullTo = React.useMemo(
    () => buildUrlWithSearch(to, location.search),
    [to, location.pathname, location.search]
  );
  return (
    <Link to={fullTo} {...rest}>
      {children}
    </Link>
  );
};

export const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated } = useAccessControl();
  const location = useLocation();
  const isWaiterRoute = isWaitersDirectRoute(location.pathname, location.search);
  if (isWaiterRoute) {
    // Ensure auto-session is initialized in storage when visiting /waiters directly
    readVerifiedAuthSession();
    return children;
  }
  const validSession = isAuthenticated && hasValidAuthSession();

  if (!validSession) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
};

export const RequireAuth = ProtectedRoute;

export const PublicOnlyRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, activeRoleId, activeCashier } = useAccessControl();
  const location = useLocation();
  const validSession = isAuthenticated && hasValidAuthSession();

  if (validSession) {
    const fromPath = (location.state as any)?.from?.pathname;
    const roleLower = String(activeRoleId || activeCashier?.role || '').toLowerCase();
    const emailLower = String(activeCashier?.email || '').toLowerCase();
    const isCashier =
      roleLower === 'cashier' ||
      roleLower === 'kasir' ||
      emailLower.includes('kasir');

    if (
      typeof fromPath === 'string' &&
      (fromPath === '/pos' ||
        fromPath.startsWith('/pos/') ||
        fromPath === '/dashboard/pos' ||
        fromPath.startsWith('/dashboard/pos/'))
    ) {
      return <Navigate to="/pos" replace />;
    }
    if (isCashier) {
      return <Navigate to="/pos" replace />;
    }
    if (typeof fromPath === 'string' && fromPath.startsWith('/') && fromPath !== '/login' && fromPath !== '/') {
      return <Navigate to={fromPath} replace />;
    }
    return <Navigate to="/dashboard" replace />;
  }
  return children;
};

export const RootRedirect: React.FC = () => {
  const { isAuthenticated, activeRoleId, activeCashier } = useAccessControl();
  const validSession = isAuthenticated && hasValidAuthSession();
  if (!validSession) {
    return <Navigate to="/login" replace />;
  }
  const roleLower = String(activeRoleId || activeCashier?.role || '').toLowerCase();
  const emailLower = String(activeCashier?.email || '').toLowerCase();
  const isCashier =
    roleLower === 'cashier' ||
    roleLower === 'kasir' ||
    emailLower.includes('kasir');
  return <Navigate to={isCashier ? '/pos' : '/dashboard'} replace />;
};



