/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { Navbar } from './components/common/Navbar';
import { Sidebar } from './components/common/Sidebar';
import { GlobalModals } from './components/common/GlobalModals';
import { OfflineIndicator } from './components/common/OfflineIndicator';
import { ComingSoonPlaceholder } from './components/common/ComingSoonPlaceholder';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useLanguage, LanguageProvider } from './context/LanguageContext';
import { AccessControlProvider, useAccessControl } from './context/AccessControlContext';
import { AppDataProvider } from './context/AppDataContext';
import { ShieldAlert, Lock, ArrowRight } from 'lucide-react';
import { useAppNavigation, ResolvedAppRoute, RequireAuth, RootRedirect } from './router';
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
import { PaymentIntegrationModule } from './components/modules/PaymentIntegrationModule';
import { PaymentGatewaySettings } from './components/settings/PaymentGatewaySettings';
import { ProductLogModule } from './components/modules/ProductLogModule';
import { LaporanKasModule } from './components/modules/LaporanKasModule';
import { MyAssetModule } from './components/modules/MyAssetModule';
import { ClientPwaApp } from './components/pwa/ClientPwaApp';
import { DynamicCustomPage } from './components/custom/DynamicCustomPage';
import { AISystemArchitectModule } from './components/modules/AISystemArchitectModule';
import { AIPageBuilderStudio } from './components/modules/AIPageBuilderStudio';
import { AIAssetAndStockAnalytics } from './components/modules/AIAssetAndStockAnalytics';

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
  currencyMode?: 'IDR' | 'USD';
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
  maxWidth = 'max-w-7xl',
}: {
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const { tr } = useLanguage();
  const isFullWidth = maxWidth.includes('max-w-none');
  return (
    <main className="flex-1 w-full overflow-y-auto px-4 sm:px-6 py-6 bg-[#070604]">
      <div className={isFullWidth ? 'w-full max-w-none px-4' : `${maxWidth} mx-auto`}>{children}</div>
      <footer className="mt-12 pt-6 border-t border-amber-500/25 text-center text-xs text-amber-200/60">
        <div
          className={`${
            isFullWidth ? 'w-full max-w-none px-4' : 'max-w-7xl mx-auto'
          } flex flex-col sm:flex-row items-center justify-between gap-2`}
        >
          <span className="font-semibold text-amber-100/80">
            RiskCart Point Of Sale &copy; 2026 &mdash;{' '}
            {tr('Built for AI Builder Cup 2026', 'Dibuat untuk AI Builder Cup 2026')}
          </span>
          <div className="flex items-center gap-4 text-amber-300/80 font-mono">
            <span>{tr('Cloud Firestore Realtime', 'Cloud Firestore Realtime')}</span>
            <span>{tr('Gemini 3.8 Flash AI', 'Gemini 3.8 Flash AI')}</span>
            <span>{tr('PWA Offline-Ready', 'PWA Siap Offline')}</span>
          </div>
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
  const { currencyMode, setCurrencyMode } = useLanguage();
  const {
    route,
    activeTab,
    activeSubModule,
    setActiveTab,
    setActiveSubModule,
  } = useAppNavigation();

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
    posPinVerified,
    lockPosSession,
  } = useAccessControl();

  // Require PIN verification each time the user enters /dashboard/pos from another module
  useEffect(() => {
    if (activeTab !== 'pos_machine' && posPinVerified) {
      lockPosSession();
    }
  }, [activeTab, posPinVerified, lockPosSession]);

  const renderActiveModule = () => {
    const isRbacAdminRoute =
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
        <PageContainer maxWidth="w-full max-w-2xl">
          <div className="mt-12 bg-gradient-to-br from-[#0c111d] via-[#111624] to-[#1a1308] border border-amber-500/40 rounded-3xl p-8 text-center shadow-2xl space-y-5">
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
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <AdminDashboard
              onNavigateTab={(tab) => setActiveTab(tab)}
              onOpenAddProduct={() => setActiveTab('products')}
            />
          </PageContainer>
        );

      case 'landing':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <LandingPage onNavigate={(tab) => setActiveTab(tab)} />
          </PageContainer>
        );

      case 'pos_machine':
        if (!posPinVerified) {
          return <PosPinGate />;
        }
        return (
          <main className="flex-1 w-full overflow-hidden min-h-0">
            <PosMachine
              currencyMode={currencyMode}
              setCurrencyMode={setCurrencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </main>
        );

      case 'products':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <ProductCartonManager
              initialSubTab={route.productSubTab || 'list'}
              initialViewMode={route.productViewMode || 'table'}
            />
          </PageContainer>
        );

      case 'produk_log':
      case 'product_log':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <ProductLogModule
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'categories':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <CategoryManager />
          </PageContainer>
        );

      case 'units':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <UnitManager />
          </PageContainer>
        );

      case 'stock':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <StockManager
              subModule={activeSubModule}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'customer_types':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <CustomerTypesManager />
          </PageContainer>
        );

      case 'pwa_settings':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <PwaSettings />
          </PageContainer>
        );

      case 'orders':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <OrdersModule
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'transaction_store':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <TransactionStoreDashboard />
          </PageContainer>
        );

      case 'transactions':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <TransactionDashboard />
          </PageContainer>
        );

      case 'assets':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <AssetFinancialDashboard />
          </PageContainer>
        );

      case 'myasset':
      case 'asset_toko':
        return (
          <PageContainer maxWidth="w-full max-w-[1750px]">
            <MyAssetModule
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'laporan_kas':
      case 'laporankas':
        return (
          <PageContainer maxWidth="w-full max-w-[1750px]">
            <LaporanKasModule
              subModule={activeSubModule}
              currencyMode={currencyMode}
              onNavigateTab={(tab, sub) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'anti_fraud':
        return (
          <PageContainer maxWidth="w-full max-w-none px-4">
            <AntiFraudInspector />
          </PageContainer>
        );

      case 'restock':
        return (
          <PageContainer maxWidth="w-full max-w-none px-4">
            <RestockAdvisor />
          </PageContainer>
        );

      case 'ai_asset_stock':
      case 'ai-asset-stock':
        return (
          <PageContainer maxWidth="w-full max-w-none px-4">
            <AIAssetAndStockAnalytics />
          </PageContainer>
        );

      case 'ai_architect':
      case 'ai-architect':
        return (
          <PageContainer maxWidth="w-full max-w-none px-4">
            <AISystemArchitectModule />
          </PageContainer>
        );

      case 'module_ai':
        if (activeSubModule === 'ai_asset_stock' || activeSubModule === 'ai-asset-stock') {
          return (
            <PageContainer maxWidth="w-full max-w-none px-4">
              <AIAssetAndStockAnalytics />
            </PageContainer>
          );
        }
        if (activeSubModule === 'ai_architect' || activeSubModule === 'ai-architect') {
          return (
            <PageContainer maxWidth="w-full max-w-none px-4">
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
            <PageContainer maxWidth="w-full max-w-none px-4">
              <AIPageBuilderStudio />
            </PageContainer>
          );
        }
        return (
          <PageContainer maxWidth="w-full max-w-none px-4">
            <AIHubModule
              subModule={activeSubModule}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_multi_outlet':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <MultiOutletModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_shift':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <ShiftModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_procurement':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <ProcurementModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_pos_transactions':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <POSTransactionsModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_inventory':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <InventoryTrackingModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_customer':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <CustomerModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_marketing':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
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
          <PageContainer maxWidth="w-full max-w-[1600px]">
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
            <PageContainer maxWidth="w-full max-w-[1600px]">
              <HakDanAksesView onNavigateTab={(tab) => setActiveTab(tab)} />
            </PageContainer>
          );
        }
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <StaffModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_finance':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <FinanceModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_online_order':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <OnlineOrderModule
              subModule={activeSubModule as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_pwa_settings':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
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
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <POSSettingsModule
              subModule={(activeSubModule || 'umum') as any}
              currencyMode={currencyMode}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </PageContainer>
        );

      case 'module_payment':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            {/* Satu sumber kebenaran: halaman payment lama diarahkan ke pengaturan gateway nyata */}
            <PaymentGatewaySettings initialProvider={(activeSubModule as any) || 'xendit'} />
          </PageContainer>
        );

      case 'custom_ai_page':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <DynamicCustomPage slug={route.entityId || activeSubModule} />
          </PageContainer>
        );

      case 'coming_soon':
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <ComingSoonPlaceholder featureName={route.entityId || 'Fitur ini'} />
          </PageContainer>
        );

      default:
        return (
          <PageContainer maxWidth="w-full max-w-[1600px]">
            <ComingSoonPlaceholder />
          </PageContainer>
        );
    }
  };

  return (
    <div className="h-dvh flex flex-col bg-[#070604] text-amber-50 font-sans antialiased selection:bg-amber-500 selection:text-zinc-950 overflow-hidden">
      {/* 1. STICKY TOP HEADER */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onToggleSidebar={handleToggleSidebar}
      />

      {/* 2. MAIN WORKSPACE CONTAINER: Header + Persistent Sidebar + Content */}
      <div className="flex-1 flex w-full overflow-hidden min-h-0">
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

        {/* Content Area */}
        <div className="flex-1 w-full overflow-hidden flex flex-col min-w-0">
          <ErrorBoundary key={`${activeTab}-${currencyMode}`}>
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

function AppRoutes() {
  useEffect(() => {
    const stopStockSync = startStockSyncService();
    return () => {
      stopStockSync();
    };
  }, []);

  return (
    <Routes>
      {/* Halaman Wajib Login */}
      <Route path="/login" element={<LoginPage />} />

      {/* Root redirect: / -> /login (jika belum login) atau /dashboard (jika sudah login) */}
      <Route path="/" element={<RootRedirect />} />

      {/* Route Mandiri Khusus PWA */}
      <Route path="/client-pwa" element={<ClientPwaStandalone />} />
      <Route path="/client-pwa/*" element={<ClientPwaStandalone />} />
      <Route path="/pwa" element={<Navigate to="/client-pwa" replace />} />
      <Route path="/pwa/*" element={<Navigate to="/client-pwa" replace />} />
      <Route path="/clienthome" element={<Navigate to="/client-pwa/clienthome" replace />} />
      <Route path="/clienthome/*" element={<Navigate to="/client-pwa/clienthome" replace />} />

      {/* Semua route wajib login melalui RequireAuth */}
      <Route path="/dashboard" element={<RequireAuth><DashboardLayout /></RequireAuth>} />
      <Route path="/dashboard/*" element={<RequireAuth><DashboardLayout /></RequireAuth>} />
      <Route path="/pos" element={<RequireAuth><DashboardLayout /></RequireAuth>} />
      <Route path="*" element={<RequireAuth><DashboardLayout /></RequireAuth>} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary fallbackTitle="Aplikasi Mengalami Kendala Saat Dimuat">
      <BrowserRouter>
        <LanguageProvider>
          <AccessControlProvider>
            <AppDataProvider>
              <AppRoutes />
            </AppDataProvider>
          </AccessControlProvider>
        </LanguageProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
