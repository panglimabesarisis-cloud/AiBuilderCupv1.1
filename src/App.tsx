/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { Navbar } from './components/common/Navbar';
import { Sidebar } from './components/common/Sidebar';
import { DemoJuriRibbon } from './components/common/DemoJuriRibbon';
import { GlobalModals } from './components/common/GlobalModals';
import { OfflineIndicator } from './components/common/OfflineIndicator';
import { ComingSoonPlaceholder } from './components/common/ComingSoonPlaceholder';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useLanguage, LanguageProvider } from './context/LanguageContext';
import { ThemeProvider } from './context/ThemeContext';
import { AccessControlProvider, useAccessControl } from './context/AccessControlContext';
import { AppDataProvider } from './context/AppDataContext';
import { ShieldAlert, Lock, ArrowRight } from 'lucide-react';
import {
  useAppNavigation,
  ResolvedAppRoute,
  ProtectedRoute,
  PublicOnlyRoute,
  RequireAuth,
  RootRedirect,
  pathToView,
  viewToPath,
} from './router';
import { startStockSyncService } from './services/stockSyncService';
import { LoginPage } from './components/common/LoginPage';
import { PosPinGate } from './components/pos/PosPinGate';

// Module and page components
import { HakDanAksesView } from './components/modules/HakDanAksesView';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { LandingPage } from './components/landing/LandingPage';
import { PosMachine } from './components/pos/PosMachine';
import { ProductCartonManager } from './components/pos/ProductCartonManager';
import { OrdersModule } from './components/modules/OrdersModule';
import { TransactionStoreDashboard } from './components/pos/TransactionStoreDashboard';
import { TransactionDashboard } from './components/pos/TransactionDashboard';
import { AssetFinancialDashboard } from './components/pos/AssetFinancialDashboard';
import { AntiFraudInspector } from './components/pos/AntiFraudInspector';
import { RestockAdvisor } from './components/pos/RestockAdvisor';
import { CustomerTypesManager } from './components/modules/CustomerTypesManager';
import { PwaSettings } from './components/admin/PwaSettings';

import { AIHubModule } from './components/modules/AIHubModule';
import { MultiOutletModule } from './components/modules/MultiOutletModule';
import { ShiftModule } from './components/modules/ShiftModule';
import { ProcurementModule } from './components/modules/ProcurementModule';
import { POSTransactionsModule } from './components/modules/POSTransactionsModule';
import { InventoryTrackingModule } from './components/modules/InventoryTrackingModule';
import { CustomerModule } from './components/modules/CustomerModule';
import { MarketingModule } from './components/modules/MarketingModule';
import { StaffModule } from './components/modules/StaffModule';
import { FinanceModule } from './components/modules/FinanceModule';
import { OnlineOrderModule } from './components/modules/OnlineOrderModule';
import { PWASettingsModule } from './components/modules/PWASettingsModule';
import { POSSettingsModule } from './components/modules/POSSettingsModule';
import { PaymentGatewaySettings } from './components/settings/PaymentGatewaySettings';
import { ProductLogModule } from './components/modules/ProductLogModule';
import { LaporanKasModule } from './components/modules/LaporanKasModule';
import { MyAssetModule } from './components/modules/MyAssetModule';
import { ClientPwaApp } from './components/pwa/ClientPwaApp';
import { DynamicCustomPage } from './components/custom/DynamicCustomPage';
import { AISystemArchitectModule } from './components/modules/AISystemArchitectModule';
import { AIPageBuilderStudio } from './components/modules/AIPageBuilderStudio';
import { AIAssetAndStockAnalytics } from './components/modules/AIAssetAndStockAnalytics';
import { RawMaterialModule } from './components/modules/RawMaterialModule';
import { TableLayoutModule } from './components/modules/TableLayoutModule';
import { KitchenModule } from './components/modules/KitchenModule';

// Aliases matching specific domain queries
const ProductGrid: React.FC<{ onNavigateTab?: (tab: string) => void }> = () => (
  <ProductCartonManager initialSubTab="list" initialViewMode="table" />
);

const CategoryManager: React.FC = () => (
  <ProductCartonManager initialSubTab="kategori" initialViewMode="table" />
);

const UnitManager: React.FC = () => (
  <ProductCartonManager initialSubTab="list" initialViewMode="table" />
);

const StockManager: React.FC<{
  subModule?: string;
  currencyMode?: any;
  onNavigateTab?: (tab: string) => void;
}> = ({ subModule, currencyMode, onNavigateTab }) => (
  <InventoryTrackingModule
    subModule={(subModule || 'inventory') as any}
    currencyMode={currencyMode}
    onNavigateTab={onNavigateTab}
  />
);

/**
 * Standalone Layout exclusively for /client-pwa (and /client-pwa/*)
 * Renders full-bleed mobile/responsive PWA experience without Admin Sidebar or Navbar.
 */
function ClientPwaStandalone() {
  return (
    <div className="min-h-dvh w-full max-w-full bg-[#070604] text-amber-50 font-sans antialiased selection:bg-amber-500 selection:text-zinc-950 flex flex-col">
      <ClientPwaApp />
      <OfflineIndicator />
    </div>
  );
}

/**
 * Page container with scrollable content and unified footer
 */
function PageContainer({
  children,
  maxWidth = 'w-full max-w-none',
}: {
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <main className="flex-1 w-full max-w-none overflow-y-auto px-4 sm:px-6 py-6 bg-[#070604]">
      <div className={`w-full max-w-none ${maxWidth.includes('max-w-none') ? '' : maxWidth}`}>{children}</div>
      <footer className="mt-12 pt-6 border-t border-amber-500/25 text-center text-xs text-amber-200/60">
        <div className="w-full max-w-none flex flex-col sm:flex-row items-center justify-between gap-2">
          <span className="font-semibold text-amber-100/80">
            RiskCart Point Of Sale &copy; 2026
          </span>
        </div>
      </footer>
    </main>
  );
}

/**
 * Unified Shared Layout: Navbar + Persistent Sidebar + Active Module Container
 * Keeps the master Sidebar visible across all application routes (including POS terminal).
 */
function DashboardLayout() {
  const { currencyMode: rawCurrencyMode, setCurrencyMode: rawSetCurrencyMode } = useLanguage();
  const currencyMode = rawCurrencyMode as any;
  const setCurrencyMode = rawSetCurrencyMode as any;
  const {
    route,
    pathname,
    activeTab: navActiveTab,
    activeSubModule: navActiveSubModule,
    setActiveTab: navSetActiveTab,
    setActiveSubModule: navSetActiveSubModule,
    navigateToPath,
  } = useAppNavigation();

  // Lazy Initializer dari URL aktual agar tidak memakai default 'admin' secara buta saat membuka /pos
  const initialRoute = useMemo(
    () => pathToView(typeof window !== 'undefined' ? window.location.pathname : pathname),
    []
  );
  const [activeView, setActiveView] = useState<'landing' | 'pos' | 'admin' | 'pwa'>(
    () => pathToView(typeof window !== 'undefined' ? window.location.pathname : pathname).view || initialRoute.view
  );
  const [activeSubModuleState, setActiveSubModuleState] = useState<string | null>(
    () => pathToView(typeof window !== 'undefined' ? window.location.pathname : pathname).subModule || initialRoute.subModule || null
  );
  const [posSubTab, setPosSubTab] = useState<string>(
    () => pathToView(typeof window !== 'undefined' ? window.location.pathname : pathname).posSubTab || initialRoute.posSubTab || 'kasir'
  );

  // Sinkronkan activeView, activeSubModuleState, dan posSubTab saat URL berubah tanpa me-redirect /pos ke /dashboard
  useEffect(() => {
    const mapped = pathToView(pathname);
    setActiveView(mapped.view);
    setActiveSubModuleState(mapped.subModule || navActiveSubModule || null);
    if (mapped.view === 'pos') {
      setPosSubTab(mapped.posSubTab || 'kasir');
    }
  }, [pathname, navActiveSubModule]);

  const activeTab = activeView === 'pos' ? 'pos_machine' : navActiveTab;
  const activeSubModule = navActiveSubModule || activeSubModuleState || '';

  const setActiveTab = React.useCallback(
    (nextTab: string) => {
      if (nextTab === 'pos' || nextTab === 'pos_machine') {
        setActiveView('pos');
        navigateToPath(viewToPath('pos', null, posSubTab));
        return;
      }
      if (nextTab === 'pwa' || nextTab === 'order-pelanggan' || nextTab === 'client-pwa') {
        setActiveView('pwa');
        navigateToPath('/client-pwa');
        return;
      }
      if (nextTab === 'landing') {
        setActiveView('landing');
      } else {
        setActiveView('admin');
      }
      navSetActiveTab(nextTab);
    },
    [navSetActiveTab, navigateToPath, posSubTab]
  );

  const setActiveSubModule = React.useCallback(
    (nextSub: string) => {
      setActiveSubModuleState(nextSub);
      navSetActiveSubModule(nextSub);
    },
    [navSetActiveSubModule]
  );

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [sessionSeconds, setSessionSeconds] = useState<number>(0);

  // Live session timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSessionSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleToggleSidebar = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setIsMobileSidebarOpen((prev) => !prev);
    } else {
      setIsSidebarCollapsed((prev) => !prev);
    }
  };

  const {
    activeRoleId,
    setActiveRoleId,
    roles,
    canPerformModuleAction,
    isDemoMode,
    activeCashier,
  } = useAccessControl();

  const showDemoBadge =
    isDemoMode ||
    activeRoleId === 'demo_owner' ||
    activeRoleId === 'demo_cashier' ||
    activeCashier?.role === 'demo_owner' ||
    activeCashier?.role === 'demo_cashier';

  const isWaiterFlow =
    activeTab === 'waiters' ||
    activeTab === 'waiter' ||
    activeTab === 'kitchen' ||
    activeSubModule === 'waiter' ||
    (typeof window !== 'undefined' &&
      (window.location.pathname.toLowerCase().startsWith('/waiter') ||
        window.location.pathname.toLowerCase().startsWith('/kitchen') ||
        new URLSearchParams(window.location.search).get('waiter') === '1'));

  const isPosRoute =
    activeView === 'pos' ||
    activeTab === 'pos_machine' ||
    activeTab === 'pos' ||
    pathname === '/pos' ||
    pathname.startsWith('/pos/') ||
    pathname === '/dashboard/pos' ||
    pathname.startsWith('/dashboard/pos/');

  const renderActiveModule = () => {
    const isRbacAdminRoute =
      isPosRoute ||
      isWaiterFlow ||
      activeTab === 'hakdanakses' ||
      activeTab === 'hak_dan_akses' ||
      (activeTab === 'module_staff' &&
        (activeSubModule === 'otoritas_akses' ||
          activeSubModule === 'otoritas-akses' ||
          activeSubModule === 'hak_akses' ||
          activeSubModule === 'hakdanakses' ||
          activeSubModule === 'hak_dan_akses'));

    if (!isRbacAdminRoute && activeRoleId !== 'owner' && !canPerformModuleAction(activeTab, 'view')) {
      const currentRoleObj = roles.find((r) => r.id === activeRoleId);
      return (
        <PageContainer maxWidth="w-full max-w-none">
          <div className="mt-6 w-full max-w-none bg-gradient-to-br from-[#0c111d] via-[#111624] to-[#1a1308] border border-amber-500/40 rounded-3xl p-8 text-center shadow-2xl space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-400 flex items-center justify-center mx-auto shadow-lg">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-bold bg-rose-500/15 border border-rose-500/30 text-rose-300">
                <Lock className="w-3 h-3" />
                <span>PROTEKSI RBAC RISKCART AKTIF</span>
              </span>
              <h2 className="text-xl font-black text-white tracking-tight">
                Akses Ditolak — Otoritas Tidak Mencukupi
              </h2>
              <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
                Akun staf Anda saat ini beroperasi sebagai jabatan{' '}
                <strong className="text-amber-300">{currentRoleObj?.name || activeRoleId}</strong> dan tidak memiliki izin{' '}
                <code className="text-amber-400 font-mono">Lihat Halaman (View)</code> untuk membuka modul ini.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                onClick={() => setActiveTab('pos_machine')}
                className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold transition cursor-pointer"
              >
                Buka Mesin Kasir POS
              </button>
              <button
                onClick={() => setActiveRoleId('owner')}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 text-xs font-black shadow-lg flex items-center gap-1.5 transition cursor-pointer"
              >
                <span>Beralih ke Mode Owner (Full Access)</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </PageContainer>
      );
    }

    switch (activeTab) {
      case 'admin':
      case 'admin_dashboard':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <AdminDashboard
              onNavigateTab={(tab) => setActiveTab(tab)}
              onOpenAddProduct={() => setActiveTab('products')}
            />
          </PageContainer>
        );

      case 'landing':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <LandingPage onNavigate={(tab) => setActiveTab(tab)} />
          </PageContainer>
        );

      case 'waiters':
      case 'waiter':
        if (activeSubModule === 'layout' || activeSubModule === 'meja') {
          return (
            <PageContainer maxWidth="w-full max-w-none">
              <TableLayoutModule waiterMode />
            </PageContainer>
          );
        }
        return (
          <main className="flex-1 w-full overflow-hidden min-h-0">
            <PosMachine
              currencyMode={currencyMode}
              setCurrencyMode={setCurrencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
              waiterMode={true}
            />
          </main>
        );

      case 'kitchen':
      case 'dapur':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <KitchenModule />
          </PageContainer>
        );

      case 'layout_table':
      case 'table_layout':
      case 'reservation':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <TableLayoutModule subModule={activeSubModule} />
          </PageContainer>
        );

      case 'pos':
      case 'pos_machine':
        return (
          <main className="flex-1 w-full overflow-hidden min-h-0">
            <PosMachine
              currencyMode={currencyMode}
              setCurrencyMode={setCurrencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
              waiterMode={isWaiterFlow}
            />
          </main>
        );

      case 'products':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <ProductCartonManager
              initialSubTab={route.productSubTab || 'list'}
              initialViewMode={route.productViewMode || 'table'}
            />
          </PageContainer>
        );

      case 'produk_log':
      case 'product_log':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <ProductLogModule
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'categories':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <CategoryManager />
          </PageContainer>
        );

      case 'units':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <UnitManager />
          </PageContainer>
        );

      case 'stock':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <StockManager
              subModule={activeSubModule}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'customer_types':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <CustomerTypesManager />
          </PageContainer>
        );

      case 'pwa_settings':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <PwaSettings />
          </PageContainer>
        );

      case 'orders':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <OrdersModule
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'transaction_store':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <TransactionStoreDashboard />
          </PageContainer>
        );

      case 'transactions':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <TransactionDashboard />
          </PageContainer>
        );

      case 'assets':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <AssetFinancialDashboard />
          </PageContainer>
        );

      case 'myasset':
      case 'asset_toko':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <MyAssetModule
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'laporan_kas':
      case 'laporankas':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <LaporanKasModule
              subModule={activeSubModule}
              currencyMode={currencyMode}
              onNavigateTab={(tab, sub) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'anti_fraud':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <AntiFraudInspector />
          </PageContainer>
        );

      case 'restock':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <RestockAdvisor />
          </PageContainer>
        );

      case 'ai_asset_stock':
      case 'ai-asset-stock':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <AIAssetAndStockAnalytics />
          </PageContainer>
        );

      case 'ai_architect':
      case 'ai-architect':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <AISystemArchitectModule />
          </PageContainer>
        );

      case 'module_ai':
        if (activeSubModule === 'ai_asset_stock' || activeSubModule === 'ai-asset-stock') {
          return (
            <PageContainer maxWidth="w-full max-w-none">
              <AIAssetAndStockAnalytics />
            </PageContainer>
          );
        }
        if (activeSubModule === 'ai_architect' || activeSubModule === 'ai-architect') {
          return (
            <PageContainer maxWidth="w-full max-w-none">
              <AISystemArchitectModule />
            </PageContainer>
          );
        }
        if (
          activeSubModule === 'ai_page_builder' ||
          activeSubModule === 'ai-page-builder' ||
          activeSubModule === 'page_builder' ||
          activeSubModule === 'chart_library'
        ) {
          return (
            <PageContainer maxWidth="w-full max-w-none">
              <AIPageBuilderStudio />
            </PageContainer>
          );
        }
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <AIHubModule
              subModule={activeSubModule}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_multi_outlet':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <MultiOutletModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_shift':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <ShiftModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'bahan_baku':
      case 'module_bahan_baku':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <RawMaterialModule
              subModule={activeSubModule}
              entityId={route.entityId}
              actionMode={route.actionMode}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_procurement':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <ProcurementModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_pos_transactions':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <POSTransactionsModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_inventory':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <InventoryTrackingModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_customer':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <CustomerModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_marketing':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <MarketingModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'hakdanakses':
      case 'hak_dan_akses':
      case 'otoritas_akses':
      case 'otoritas-akses':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <HakDanAksesView onNavigateTab={(tab) => setActiveTab(tab)} />
          </PageContainer>
        );

      case 'module_staff':
        if (
          activeSubModule === 'otoritas_akses' ||
          activeSubModule === 'otoritas-akses' ||
          activeSubModule === 'hak_akses' ||
          activeSubModule === 'hakdanakses' ||
          activeSubModule === 'hak_dan_akses'
        ) {
          return (
            <PageContainer maxWidth="w-full max-w-none">
              <HakDanAksesView onNavigateTab={(tab) => setActiveTab(tab)} />
            </PageContainer>
          );
        }
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <StaffModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_finance':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <FinanceModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_online_order':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <OnlineOrderModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_pwa_settings':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <PWASettingsModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_pos_settings':
      case 'settings':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <POSSettingsModule
              subModule={(activeSubModule || 'umum') as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_payment':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            {/* Satu sumber kebenaran: halaman payment lama diarahkan ke pengaturan gateway nyata */}
            <PaymentGatewaySettings initialProvider={(activeSubModule as any) || 'xendit'} />
          </PageContainer>
        );

      case 'custom_ai_page':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <DynamicCustomPage slug={route.entityId || activeSubModule} />
          </PageContainer>
        );

      case 'coming_soon':
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <ComingSoonPlaceholder featureName={route.entityId || 'Fitur ini'} />
          </PageContainer>
        );

      default:
        return (
          <PageContainer maxWidth="w-full max-w-none">
            <ComingSoonPlaceholder />
          </PageContainer>
        );
    }
  };

  return (
    <div className="h-dvh flex flex-col bg-[#070604] text-amber-50 font-sans antialiased selection:bg-amber-500 selection:text-zinc-950 overflow-hidden">
      {showDemoBadge && <DemoJuriRibbon />}

      {/* 1. STICKY TOP HEADER (Hidden on /waiters so no sidebar menu toggle is shown) */}
      {!isWaiterFlow && (
        <Navbar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onToggleSidebar={handleToggleSidebar}
        />
      )}

      {/* 2. MAIN WORKSPACE CONTAINER: Header + Persistent Sidebar + Content */}
      <div className="flex-1 flex w-full overflow-hidden min-h-0">
        {!isWaiterFlow && (
          <Sidebar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            activeSubModule={activeSubModule}
            setActiveSubModule={setActiveSubModule}
            isCollapsed={isSidebarCollapsed}
            toggleCollapsed={() => setIsSidebarCollapsed((prev) => !prev)}
            isMobileOpen={isMobileSidebarOpen}
            setIsMobileOpen={setIsMobileSidebarOpen}
            currencyMode={currencyMode}
            setCurrencyMode={setCurrencyMode}
            onOpenModal={(modal) => setActiveModal(modal)}
            sessionSeconds={sessionSeconds}
          />
        )}

        {/* Content Area */}
        <div className="flex-1 w-full overflow-hidden flex flex-col min-w-0">
          <ErrorBoundary key={`${activeTab}-${currencyMode}-${isWaiterFlow ? 'waiter' : 'std'}`}>
            {renderActiveModule()}
          </ErrorBoundary>
        </div>
      </div>

      {/* Global Modals triggered from Persistent Sidebar across all pages */}
      <GlobalModals
        activeModal={activeModal}
        onClose={() => setActiveModal(null)}
        currencyMode={currencyMode}
        onNavigateTab={setActiveTab}
        sessionSeconds={sessionSeconds}
      />

      {/* Offline Status Badge */}
      <OfflineIndicator />
    </div>
  );
}

function StaffWorkspace() {
  useEffect(() => {
    const stopStockSync = startStockSyncService();
    return () => {
      stopStockSync();
    };
  }, []);

  return <DashboardLayout />;
}

function StaffProtectedRoute() {
  return (
    <ProtectedRoute>
      <AppDataProvider>
        <StaffWorkspace />
      </AppDataProvider>
    </ProtectedRoute>
  );
}

function WaiterRoute() {
  return (
    <AppDataProvider>
      <StaffWorkspace />
    </AppDataProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      {/* Route Mandiri Khusus PWA Pelanggan (cukup LanguageProvider, tanpa AccessControlProvider & AppDataProvider) */}
      <Route path="/client-pwa" element={<ClientPwaStandalone />} />
      <Route path="/client-pwa/*" element={<ClientPwaStandalone />} />
      <Route path="/order-pelanggan" element={<ClientPwaStandalone />} />
      <Route path="/order-pelanggan/*" element={<ClientPwaStandalone />} />
      <Route path="/pwa" element={<Navigate to="/client-pwa" replace />} />
      <Route path="/pwa/*" element={<Navigate to="/client-pwa" replace />} />
      <Route path="/clienthome" element={<Navigate to="/client-pwa/clienthome" replace />} />
      <Route path="/clienthome/*" element={<Navigate to="/client-pwa/clienthome" replace />} />

      {/* Route Login & Staf dibungkus AccessControlProvider */}
      <Route
        path="/*"
        element={
          <AccessControlProvider>
            <Routes>
              {/* Halaman Login: cukup LanguageProvider + AccessControlProvider */}
              <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />

              {/* Root redirect: / -> /login (jika belum login) atau /dashboard (jika sudah login) */}
              <Route path="/" element={<RootRedirect />} />

              {/* Route /waiters & /waiter dibungkus AppDataProvider */}
              <Route path="/waiters" element={<WaiterRoute />} />
              <Route path="/waiters/*" element={<WaiterRoute />} />
              <Route path="/waiter" element={<WaiterRoute />} />
              <Route path="/waiter/*" element={<WaiterRoute />} />

              {/* Semua route Staf (/dashboard, /pos, /kitchen) dibungkus ProtectedRoute + AppDataProvider */}
              <Route path="/kitchen" element={<StaffProtectedRoute />} />
              <Route path="/kitchen/*" element={<StaffProtectedRoute />} />
              <Route path="/pos" element={<StaffProtectedRoute />} />
              <Route path="/pos/*" element={<StaffProtectedRoute />} />
              <Route path="/dashboard/pos" element={<StaffProtectedRoute />} />
              <Route path="/dashboard/pos/*" element={<StaffProtectedRoute />} />
              <Route path="/dashboard" element={<StaffProtectedRoute />} />
              <Route path="/dashboard/*" element={<StaffProtectedRoute />} />
              <Route path="*" element={<StaffProtectedRoute />} />
            </Routes>
          </AccessControlProvider>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary fallbackTitle="Aplikasi Mengalami Kendala Saat Dimuat">
      <ThemeProvider>
        <BrowserRouter>
          <LanguageProvider>
            <AppRoutes />
          </LanguageProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
