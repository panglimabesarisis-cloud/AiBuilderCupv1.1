import React, { useState, useEffect, useMemo } from 'react';
import {
  Brain,
  Store,
  Clock,
  LayoutDashboard,
  Boxes,
  Truck,
  ShoppingBag,
  Layers,
  Users,
  Target,
  UserCheck,
  Vault,
  Globe,
  Smartphone,
  Settings,
  CreditCard,
  Sparkles,
  ChevronDown,
  ChevronLeft,
  X,
  Cpu,
  Gauge,
  ClipboardList,
  ChefHat,
} from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { RiskCartLogo } from './RiskCartLogo';
import { LanguageDropdown } from './LanguageDropdown';
import { useLanguage, applyGoogleTranslateCookie } from '../../context/LanguageContext';
import { sanitizeGoogleTranslateDOM } from '../../utils/i18nEngine';
import { useAppData } from '../../context/AppDataContext';
import { useAccessControl } from '../../context/AccessControlContext';
import { AppLink, getPathForTab, getPathForProductSubTab, useAppNavigation } from '../../router';
import { useSidebarMenuConfig } from '../../services/sidebarMenuService';
import { SidebarGroupsRenderer } from './SidebarGroupsRenderer';
import { loadAIAgentInstructions } from '../../services/aiInstructionStore';

export type ProductCartonTabType =
  | 'list'
  | 'paket'
  | 'kategori'
  | 'harga_diskon'
  | 'masuk'
  | 'keluar'
  | 'opname'
  | 'pergerakan'
  | 'kritis';

export interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  activeSubModule?: string;
  setActiveSubModule?: (sub: string) => void;
  isCollapsed: boolean;
  toggleCollapsed: () => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
  currencyMode: 'IDR' | 'USD' | 'EUR' | 'SGD';
  setCurrencyMode: (mode: 'IDR' | 'USD' | 'EUR' | 'SGD') => void;
  onOpenModal: (modal: string) => void;
  sessionSeconds?: number;
  onSelectProductSubTab?: (subTab: ProductCartonTabType) => void;
  onOpenAddProduct?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  activeSubModule = '',
  isCollapsed,
  toggleCollapsed,
  isMobileOpen,
  setIsMobileOpen,
  currencyMode,
  setCurrencyMode,
}) => {
  const { language, activeLangCode, setLanguage, tr } = useLanguage();
  const { pendingPwaCount } = useAppData();
  const { route } = useAppNavigation();
  const { groups: dynamicMenuGroups } = useSidebarMenuConfig();

  const [tableDineInEnabled, setTableDineInEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('riskcart_table_dine_in_enabled') !== 'false';
    } catch {
      return true;
    }
  });
  const [kitchenEnabled, setKitchenEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('riskcart_kitchen_enabled') !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const syncFromLocal = () => {
      try {
        setTableDineInEnabled(localStorage.getItem('riskcart_table_dine_in_enabled') !== 'false');
        setKitchenEnabled(localStorage.getItem('riskcart_kitchen_enabled') !== 'false');
      } catch {}
    };

    window.addEventListener('riskcart:pos-feature-toggles-updated', syncFromLocal);
    window.addEventListener('storage', syncFromLocal);

    const applySettingsSnap = (data: any) => {
      if (!data) return;
      if (data.tableDineInEnabled !== undefined) {
        const nextVal = Boolean(data.tableDineInEnabled);
        setTableDineInEnabled(nextVal);
        try {
          localStorage.setItem('riskcart_table_dine_in_enabled', String(nextVal));
        } catch {}
      }
      if (data.kitchenEnabled !== undefined) {
        const nextVal = Boolean(data.kitchenEnabled);
        setKitchenEnabled(nextVal);
        try {
          localStorage.setItem('riskcart_kitchen_enabled', String(nextVal));
        } catch {}
      }
    };

    const unsubStorePos = onSnapshot(
      doc(db, 'stores', 'store_001', 'settings', 'pos'),
      (snap) => {
        if (snap.exists()) applySettingsSnap(snap.data());
      },
      () => {}
    );
    const unsubGlobalPos = onSnapshot(
      doc(db, 'settings', 'pos'),
      (snap) => {
        if (snap.exists()) applySettingsSnap(snap.data());
      },
      () => {}
    );

    return () => {
      window.removeEventListener('riskcart:pos-feature-toggles-updated', syncFromLocal);
      window.removeEventListener('storage', syncFromLocal);
      unsubStorePos();
      unsubGlobalPos();
    };
  }, []);

  const handleSelectLanguage = (langCode: string, closeDrawer = false) => {
    setLanguage(langCode);
    applyGoogleTranslateCookie(langCode);
    sanitizeGoogleTranslateDOM();
    if (closeDrawer && isMobileOpen) {
      setIsMobileOpen(false);
    }
  };

  // Official Google Translate initialization (Default = English 'en')
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const targetLang = activeLangCode || (language === 'id' ? 'id' : 'en');
    applyGoogleTranslateCookie(targetLang);

    (window as any).googleTranslateElementInit = () => {
      try {
        if ((window as any).google?.translate?.TranslateElement) {
          const el =
            document.getElementById('google_translate_element') ||
            document.getElementById('google_translate_fallback');
          if (el && el.childElementCount === 0) {
            new (window as any).google.translate.TranslateElement(
              {
                pageLanguage: 'auto',
                includedLanguages: 'id,en,ms,zh-CN,ja,ko,ar,th,es',
                autoDisplay: false,
              },
              el.id
            );
          }
          setTimeout(() => {
            applyGoogleTranslateCookie(targetLang);
          }, 350);
        }
      } catch {
        // ignore widget init errors
      }
    };

    if (!document.getElementById('google-translate-script')) {
      const existingScript = document.querySelector(
        'script[src*="translate.google.com/translate_a/element.js"]'
      );
      if (!existingScript) {
        const script = document.createElement('script');
        script.id = 'google-translate-script';
        script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
        script.async = true;
        document.body.appendChild(script);
      } else if ((window as any).google?.translate?.TranslateElement) {
        (window as any).googleTranslateElementInit();
      }
    } else if ((window as any).google?.translate?.TranslateElement) {
      (window as any).googleTranslateElementInit();
    }

    const handleComboChange = (e: Event) => {
      const target = e.target as HTMLSelectElement | null;
      if (target && target.classList?.contains('goog-te-combo')) {
        const val = target.value || 'en';
        setLanguage(val);
      }
    };

    const suppressGoogleTranslateBanner = () => {
      try {
        if (document.body) {
          if (document.body.style.top && document.body.style.top !== '0px') {
            document.body.style.setProperty('top', '0px', 'important');
          }
          if (document.body.style.position && document.body.style.position !== 'static') {
            document.body.style.setProperty('position', 'static', 'important');
          }
        }
        if (document.documentElement && document.documentElement.style.top && document.documentElement.style.top !== '0px') {
          document.documentElement.style.setProperty('top', '0px', 'important');
        }
        const banners = document.querySelectorAll(
          'iframe.goog-te-banner-frame, .goog-te-banner-frame, body > .skiptranslate, .VIpgJd-ZVi9od-ORHb-OEVmcd, .VIpgJd-ZVi9od-aZ2wEe-wOHMyf, #goog-gt-tt'
        );
        banners.forEach((node) => {
          const el = node as HTMLElement;
          if (el && el.id !== 'google_translate_element') {
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('visibility', 'hidden', 'important');
            el.style.setProperty('height', '0px', 'important');
            el.style.setProperty('opacity', '0', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
          }
        });
      } catch {
        // ignore DOM errors
      }
    };

    suppressGoogleTranslateBanner();
    const observer = new MutationObserver(() => {
      suppressGoogleTranslateBanner();
    });
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }

    document.addEventListener('change', handleComboChange);
    return () => {
      observer.disconnect();
      document.removeEventListener('change', handleComboChange);
    };
  }, []);

  const getGroupConfig = (id: string) => {
    return dynamicMenuGroups.find(
      (g) => g.id === id || (id === 'payment' && g.id === 'integrasi_payment')
    );
  };

  const getGroupLabel = (id: string, defaultLabel: string) => {
    const cfg = getGroupConfig(id);
    return cfg?.customLabel || defaultLabel;
  };

  const isChildItemVisible = (groupId: string, itemId: string) => {
    const cfg = getGroupConfig(groupId);
    if (!cfg) return true;
    const child = cfg.children?.find((c) => c.id === itemId);
    return child ? child.visible !== false : true;
  };

  const getChildItemLabel = (groupId: string, itemId: string, defaultLabel: string) => {
    const cfg = getGroupConfig(groupId);
    if (!cfg) return defaultLabel;
    const child = cfg.children?.find((c) => c.id === itemId);
    return child?.customLabel || defaultLabel;
  };

  // Accordion open/close states for groups A through Q
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    ai: true,
    multi_outlet: false,
    shift: false,
    dashboard: true,
    reservation_table: true,
    produk: true,
    bahan_baku: true,
    pembelian: false,
    transaksi_pos: false,
    inventory: false,
    pelanggan: false,
    marketing: false,
    staff: false,
    keuangan: false,
    online_order: false,
    pengaturan_pwa: false,
    pengaturan_pos: false,
    payment: false,
    semua_halaman: true,
  });

  const [openAiAgentsList, setOpenAiAgentsList] = useState<boolean>(true);

  // Auto-open the matching sidebar group when deep-linking to a route
  useEffect(() => {
    const tabGroupMap: Record<string, string> = {
      admin: 'dashboard',
      admin_dashboard: 'dashboard',
      myasset: 'dashboard',
      asset_toko: 'dashboard',
      laporan_kas: 'dashboard',
      laporankas: 'dashboard',
      laporancashflow: 'dashboard',
      laporan_cashflow: 'dashboard',
      transaction_store: 'dashboard',
      transactions: 'dashboard',
      assets: 'dashboard',
      module_ai: 'ai',
      'ai-asset-stock': 'ai',
      ai_asset_stock: 'ai',
      module_multi_outlet: 'multi_outlet',
      module_shift: 'shift',
      layout_table: 'reservation_table',
      table_layout: 'reservation_table',
      reservation: 'reservation_table',
      products: 'produk',
      categories: 'produk',
      units: 'produk',
      module_bahan_baku: 'bahan_baku',
      bahan_baku: 'bahan_baku',
      module_procurement: 'pembelian',
      module_pos_transactions: 'transaksi_pos',
      orders: 'transaksi_pos',
      module_inventory: 'inventory',
      stock: 'inventory',
      module_customer: 'pelanggan',
      customer_types: 'pelanggan',
      module_marketing: 'marketing',
      module_staff: 'staff',
      hakdanakses: 'staff',
      hak_dan_akses: 'staff',
      module_finance: 'keuangan',
      module_online_order: 'online_order',
      module_pwa_settings: 'pengaturan_pwa',
      pwa_settings: 'pengaturan_pwa',
      module_pos_settings: 'pengaturan_pos',
      module_payment: 'payment',
    };
    const groupKey = tabGroupMap[activeTab];
    if (groupKey) {
      setOpenGroups((prev) => (prev[groupKey] ? prev : { ...prev, [groupKey]: true }));
    }
  }, [activeTab]);

  const toggleGroup = (key: string) => {
    if (isCollapsed) return;
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const expandAllGroups = () => {
    if (isCollapsed) return;
    const all: Record<string, boolean> = {};
    dynamicMenuGroups.forEach((g) => {
      all[g.id] = true;
    });
    all['payment'] = true;
    all['semua_halaman'] = true;
    setOpenGroups(all);
    setOpenAiAgentsList(true);
  };

  const collapseAllGroups = () => {
    if (isCollapsed) return;
    setOpenGroups({
      ai: false,
      multi_outlet: false,
      shift: false,
      dashboard: false,
      reservation_table: false,
      produk: false,
      bahan_baku: false,
      pembelian: false,
      transaksi_pos: false,
      inventory: false,
      pelanggan: false,
      marketing: false,
      staff: false,
      keuangan: false,
      online_order: false,
      pengaturan_pwa: false,
      pengaturan_pos: false,
      payment: false,
      semua_halaman: false,
    });
    setOpenAiAgentsList(false);
  };

  const [storedAiAgents, setStoredAiAgents] = useState(() => loadAIAgentInstructions());
  useEffect(() => {
    const handleSync = () => setStoredAiAgents(loadAIAgentInstructions());
    window.addEventListener('riskcart_ai_instructions_updated', handleSync);
    return () => window.removeEventListener('riskcart_ai_instructions_updated', handleSync);
  }, []);

  const aiAgentsList = useMemo(() => {
    return storedAiAgents
      .filter((a) => a.isActive !== false)
      .map((agent, idx) => ({
        id: agent.id,
        name: language === 'id' ? agent.nameId : agent.nameEn,
        slug: agent.slug,
        latency: `${130 + ((idx * 17) % 95)}ms`,
        status: 'active',
        legacySubModule: agent.slug,
      }));
  }, [storedAiAgents, language]);

  const closeMobile = () => {
    if (isMobileOpen) setIsMobileOpen(false);
  };

  const isSubActive = (tab: string, sub?: string) => {
    if (activeTab === 'hakdanakses' || activeTab === 'hak_dan_akses') {
      if (tab === 'module_staff' && (sub === 'hak_akses' || sub === 'hakdanakses')) return true;
    }
    if (activeTab !== tab) return false;
    if (!sub) return true;
    return activeSubModule === sub;
  };

  const renderContent = (collapsed: boolean, isMobile: boolean) => {
    return (
      <div className="flex flex-col justify-between h-full select-none text-xs">
        {/* Top Header & Scrollable Nav */}
        <div className="space-y-2 overflow-y-auto overflow-x-hidden flex-1 px-3 py-3 custom-scrollbar">
          {/* Mobile Close Control when mobile drawer is open */}
          {isMobile && (
            <div className="flex justify-end pb-1">
              <button
                onClick={() => setIsMobileOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
                title={tr('Close Menu', 'Tutup Menu')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Quick Cashier Shortcut Button (Metallic Gold Gradient as in Reference) */}
          <AppLink
            to={getPathForTab('pos_machine')}
            onClick={closeMobile}
            translate="no"
            className={`notranslate w-full flex items-center ${
              collapsed ? 'justify-center p-2' : 'justify-between px-3 py-2.5'
            } rounded-xl font-black transition cursor-pointer ${
              activeTab === 'pos_machine'
                ? 'bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] text-black border border-amber-300/60 shadow-[0_0_16px_rgba(245,158,11,0.38)]'
                : 'bg-gradient-to-r from-[#f59e0b]/90 via-[#fbbf24]/90 to-[#d97706]/90 text-black border border-amber-300/50 shadow-[0_0_14px_rgba(245,158,11,0.28)] hover:brightness-110'
            }`}
            title={tr('POS Cashier Terminal', 'Terminal Kasir POS')}
          >
            <div className="flex items-center gap-2">
              <Store className="w-4 h-4 shrink-0 text-black" />
              {!collapsed && <span>{tr('POS Cashier Terminal', 'Terminal Kasir POS')}</span>}
            </div>
            {!collapsed && (
              <span className="notranslate text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-400/50 text-emerald-300 font-mono font-bold">
                {tr('LIVE', 'AKTIF')}
              </span>
            )}
          </AppLink>

          {/* Primary Orders Item */}
          <AppLink
            to={getPathForTab('orders')}
            onClick={closeMobile}
            translate="no"
            className={`rc-sidebar-btn ${
              activeTab === 'orders' ? 'rc-sidebar-btn-active' : ''
            } notranslate w-full flex items-center ${
              collapsed ? 'justify-center p-2' : 'justify-between px-3 py-2'
            } rounded-xl font-bold transition cursor-pointer mt-1.5 ${
              activeTab === 'orders'
                ? 'bg-[#1c160b] border border-amber-400/70 text-amber-200 shadow-[0_0_14px_rgba(245,158,11,0.22)]'
                : 'bg-[#12100a] border border-amber-500/40 text-amber-100 hover:bg-amber-500/15 hover:border-amber-400/60'
            }`}
            title={tr('Orders Management (WhatsApp / Client PWA)', 'Manajemen Antrean Pesanan (WhatsApp / Client PWA)')}
          >
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 shrink-0 text-amber-400" />
              {!collapsed && <span>{tr('Order Queue', 'Antrean Pesanan')}</span>}
            </div>
            {!collapsed && (
              <span
                className={`rc-sidebar-badge notranslate text-[9px] px-1.5 py-0.5 rounded font-bold border tracking-wide ${
                  pendingPwaCount > 0
                    ? 'bg-amber-500/25 text-amber-300 border-amber-400/50 animate-pulse'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                }`}
              >
                {pendingPwaCount > 0
                  ? `${pendingPwaCount} ${tr('PENDING', 'MENUNGGU')}`
                  : tr('Queue', 'Antrean')}
              </span>
            )}
          </AppLink>

          {/* Dedicated Reservation Table Menu — Hidden when Table Dine-In is OFF */}
          {tableDineInEnabled && (
            <div className="mt-1.5 space-y-1">
              <button
                type="button"
                onClick={() => toggleGroup('reservation_table')}
                translate="no"
                className={`rc-sidebar-btn ${
                  activeTab === 'layout_table' || activeTab === 'table_layout' || activeTab === 'reservation'
                    ? 'rc-sidebar-btn-active'
                    : ''
                } notranslate w-full flex items-center ${
                  collapsed ? 'justify-center p-2' : 'justify-between px-3 py-2'
                } rounded-xl font-bold transition cursor-pointer ${
                  activeTab === 'layout_table' || activeTab === 'table_layout' || activeTab === 'reservation'
                    ? 'bg-[#1c160b] border border-amber-400/70 text-amber-200 shadow-[0_0_14px_rgba(245,158,11,0.22)]'
                    : 'bg-[#12100a] border border-amber-500/40 text-amber-100 hover:bg-amber-500/15 hover:border-amber-400/60'
                }`}
                title="Reservation Table"
              >
                <div className="flex items-center gap-2">
                  <Boxes className="w-4 h-4 shrink-0 text-amber-400" />
                  {!collapsed && <span>Reservation Table</span>}
                </div>
                {!collapsed && (
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-amber-300 transition-transform shrink-0 ${
                      openGroups['reservation_table'] !== false ? '' : '-rotate-90'
                    }`}
                  />
                )}
              </button>

              {!collapsed && openGroups['reservation_table'] !== false && (
                <div className="rc-sidebar-submenu-box pl-6 pr-2 py-1.5 space-y-1 bg-zinc-950/50 rounded-xl border-l-2 border-amber-500/80 text-[11px] font-medium text-zinc-300">
                  <AppLink
                    to="/dashboard/reservation"
                    onClick={closeMobile}
                    className={`rc-sidebar-submenu-link ${
                      (activeTab === 'layout_table' || activeTab === 'reservation') &&
                      activeSubModule === 'reservation'
                        ? 'rc-sidebar-submenu-link-active text-amber-400 font-bold'
                        : ''
                    } block py-1 hover:text-amber-400 transition cursor-pointer`}
                  >
                    Reservasi
                  </AppLink>
                  <AppLink
                    to="/dashboard/reservation/list"
                    onClick={closeMobile}
                    className={`rc-sidebar-submenu-link ${
                      (activeTab === 'layout_table' || activeTab === 'reservation') &&
                      activeSubModule === 'reservation_list'
                        ? 'rc-sidebar-submenu-link-active text-amber-400 font-bold'
                        : ''
                    } block py-1 hover:text-amber-400 transition cursor-pointer`}
                  >
                    List Reservasi
                  </AppLink>
                  <AppLink
                    to="/dashboard/layout-table"
                    onClick={closeMobile}
                    className={`rc-sidebar-submenu-link ${
                      (activeTab === 'layout_table' || activeTab === 'table_layout') &&
                      (!activeSubModule || activeSubModule === 'layout' || activeSubModule === 'ai_master')
                        ? 'rc-sidebar-submenu-link-active text-amber-400 font-bold'
                        : ''
                    } block py-1 hover:text-amber-400 transition cursor-pointer`}
                  >
                    Table Layout
                  </AppLink>
                  <AppLink
                    to="/dashboard/layout-table/summary"
                    onClick={closeMobile}
                    className={`rc-sidebar-submenu-link ${
                      (activeTab === 'layout_table' || activeTab === 'table_layout') &&
                      activeSubModule === 'summary'
                        ? 'rc-sidebar-submenu-link-active text-amber-400 font-bold'
                        : ''
                    } block py-1 hover:text-amber-400 transition cursor-pointer`}
                  >
                    Summary Report
                  </AppLink>
                </div>
              )}
            </div>
          )}

          {/* Primary Kitchen / Dapur Item — Hidden when Dapur is OFF */}
          {kitchenEnabled && (
            <AppLink
              to={getPathForTab('kitchen')}
              onClick={closeMobile}
              translate="no"
              className={`rc-sidebar-btn ${
                activeTab === 'kitchen' ? 'rc-sidebar-btn-active' : ''
              } notranslate w-full flex items-center ${
                collapsed ? 'justify-center p-2' : 'justify-between px-3 py-2'
              } rounded-xl font-bold transition cursor-pointer mt-1.5 ${
                activeTab === 'kitchen'
                  ? 'bg-[#1c160b] border border-amber-400/70 text-amber-200 shadow-[0_0_14px_rgba(245,158,11,0.22)]'
                  : 'bg-[#12100a] border border-amber-500/40 text-amber-100 hover:bg-amber-500/15 hover:border-amber-400/60'
              }`}
              title={tr('Kitchen Display (Order Pipeline)', 'Dapur / Kitchen Display')}
            >
              <div className="flex items-center gap-2">
                <ChefHat className="w-4 h-4 shrink-0 text-amber-400" />
                {!collapsed && <span>{tr('Kitchen Display', 'Dapur (Kitchen)')}</span>}
              </div>
              {!collapsed && (
                <span className="rc-sidebar-badge notranslate text-[9px] px-1.5 py-0.5 rounded font-bold border tracking-wide bg-amber-500/15 text-amber-300 border-amber-500/35">
                  {tr('Kitchen', 'Dapur')}
                </span>
              )}
            </AppLink>
          )}

          {/* Expand / Collapse All Quick Controls */}
          {!collapsed && (
            <div translate="no" className="notranslate pt-2 pb-1">
              <div className="flex items-center justify-between px-1 text-[10px] text-amber-200/60">
                <span className="font-bold text-amber-200/50 uppercase tracking-wider text-[9px]">{tr('MENU GROUPS', 'GRUP MENU')}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={expandAllGroups}
                    className="px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/35 hover:bg-amber-500/25 text-amber-300 font-bold transition cursor-pointer"
                    title={tr('Expand all menu groups', 'Buka semua grup menu')}
                  >
                    {tr('+ Expand All', '+ Buka Semua')}
                  </button>
                  <button
                    onClick={collapseAllGroups}
                    className="px-2 py-0.5 rounded-lg bg-[#14110b] border border-amber-500/20 hover:border-amber-500/40 text-amber-200/70 hover:text-amber-200 font-medium transition cursor-pointer"
                    title={tr('Collapse all menus', 'Ciutkan semua menu')}
                  >
                    {tr('− Collapse', '− Ciutkan')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* GROUPS A THROUGH P (Managed by WordPress-Style Menu Builder) */}
          <SidebarGroupsRenderer
            collapsed={collapsed}
            openGroups={openGroups}
            toggleGroup={toggleGroup}
            isSubActive={isSubActive}
            activeTab={activeTab}
            activeSubModule={activeSubModule}
            route={route}
            closeMobile={closeMobile}
            openAiAgentsList={openAiAgentsList}
            setOpenAiAgentsList={setOpenAiAgentsList}
            aiAgentsList={aiAgentsList}
            tableDineInEnabled={tableDineInEnabled}
            kitchenEnabled={kitchenEnabled}
          />
        </div>

        {/* Q. TRANSLATE BUTTON + MODAL POPUP */}
        <div className="rc-sidebar-footer p-3 border-t border-amber-500/35 bg-[#0b0906] space-y-2">
          <LanguageDropdown
            compact={collapsed}
            onSelectComplete={isMobile ? () => setIsMobileOpen(false) : undefined}
          />
          {!isMobile && (
            <div
              id="google_translate_element"
              className="hidden"
              style={{ display: 'none' }}
              aria-hidden="true"
            />
          )}

          {/* User profile & currency footer */}
          {!collapsed && <SidebarUserFooter currencyMode={currencyMode} setCurrencyMode={setCurrencyMode} />}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside
        className={`rc-sidebar-root hidden xl:flex flex-col shrink-0 bg-[#0d0b07] border-r border-amber-500/40 shadow-[0_0_18px_rgba(245,158,11,0.12)] transition-all duration-200 z-30 ${
          isCollapsed ? 'w-16' : 'w-64'
        }`}
      >
        {renderContent(isCollapsed, false)}
      </aside>

      {/* Mobile Drawer */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex xl:hidden bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="rc-sidebar-root w-72 max-w-[85vw] h-full bg-[#0d0b07] border-r border-amber-500/45 shadow-[0_0_24px_rgba(245,158,11,0.2)] flex flex-col justify-between">
            {renderContent(false, true)}
          </div>
          <div className="flex-1" onClick={() => setIsMobileOpen(false)} />
        </div>
      )}
    </>
  );
};

const SidebarUserFooter: React.FC<{
  currencyMode: 'IDR' | 'USD' | 'EUR' | 'SGD';
  setCurrencyMode: (mode: 'IDR' | 'USD' | 'EUR' | 'SGD') => void;
}> = ({ currencyMode, setCurrencyMode }) => {
  const { activeCashier, isAuthenticated } = useAccessControl();
  const displayName =
    isAuthenticated && activeCashier?.name && activeCashier.name !== 'Belum Login'
      ? activeCashier.name
      : 'Belum Login';

  return (
    <div
      translate="no"
      className="notranslate pt-1 flex items-center justify-between text-[11px] text-amber-100/70 gap-2"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            isAuthenticated ? 'bg-emerald-400' : 'bg-zinc-500'
          }`}
        />
        <span className="font-semibold text-amber-100 truncate" title={displayName}>
          {displayName}
        </span>
      </div>
      <button
        onClick={() => setCurrencyMode(currencyMode === 'IDR' ? 'USD' : 'IDR')}
        className="font-bold text-[10px] px-2 py-0.5 rounded bg-[#16120b] text-amber-300 hover:bg-amber-500/20 transition border border-amber-500/40 cursor-pointer shrink-0"
        title="Toggle currency mode (IDR / USD)"
      >
        {currencyMode}
      </button>
    </div>
  );
};
