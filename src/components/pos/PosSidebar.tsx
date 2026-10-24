import React, { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Store,
  ShoppingBag,
  ChevronRight,
  ChevronDown,
  LayoutDashboard,
  Boxes,
  Layers,
  Users,
  CreditCard,
  Brain,
  Sparkles,
  X,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export interface PosSidebarProps {
  isCollapsed: boolean;
  toggleCollapsed: () => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
  currencyMode: 'IDR' | 'USD';
  setCurrencyMode: (mode: 'IDR' | 'USD') => void;
  onOpenModal?: (modal: string) => void;
}

interface MenuGroup {
  id: string;
  nameEn: string;
  nameId: string;
  icon: React.ComponentType<{ className?: string }>;
  items: {
    nameEn: string;
    nameId: string;
    path: string;
  }[];
}

const STORAGE_KEY = 'riskcart_pos_sidebar_groups';

export const PosSidebar: React.FC<PosSidebarProps> = ({
  isCollapsed,
  toggleCollapsed,
  isMobileOpen,
  setIsMobileOpen,
  currencyMode,
  setCurrencyMode,
  onOpenModal,
}) => {
  const { tr } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;

  // Menu groups configuration mapping to requested root-level routes
  const menuGroups: MenuGroup[] = [
    {
      id: 'dashboard',
      nameEn: 'Dashboard',
      nameId: 'Dashboard',
      icon: LayoutDashboard,
      items: [
        { nameEn: 'Asset Toko', nameId: 'Asset Toko', path: '/dashboard/myasset' },
        { nameEn: 'Transaction Store', nameId: 'Transaction Store', path: '/transaction-store' },
        { nameEn: 'Transactions', nameId: 'Transaksi', path: '/transaksi' },
        { nameEn: 'Asset', nameId: 'Asset', path: '/asset' },
      ],
    },
    {
      id: 'produk',
      nameEn: 'Products',
      nameId: 'Produk',
      icon: Boxes,
      items: [
        { nameEn: 'Product List', nameId: 'Daftar Produk', path: '/produk' },
        { nameEn: 'Variants & Cartons', nameId: 'Varian & Konversi Dus', path: '/varian-produk' },
      ],
    },
    {
      id: 'inventori',
      nameEn: 'Inventory',
      nameId: 'Inventori',
      icon: Layers,
      items: [
        { nameEn: 'Stock In/Out Log', nameId: 'Log Barang Masuk/Keluar', path: '/log-barang' },
        { nameEn: 'Stock Opname', nameId: 'Stok Opname', path: '/stok-opname' },
        { nameEn: 'Minimum Stock', nameId: 'Stok Minimum', path: '/stok-minimum' },
      ],
    },
    {
      id: 'pelanggan_pwa',
      nameEn: 'Customers & PWA',
      nameId: 'Pelanggan & PWA',
      icon: Users,
      items: [
        { nameEn: 'PWA Orders', nameId: 'Pesanan PWA', path: '/pesanan-pwa' },
        { nameEn: 'Customers', nameId: 'Pelanggan', path: '/pelanggan' },
        { nameEn: 'Points & Rewards', nameId: 'Poin & Hadiah', path: '/poin-hadiah' },
      ],
    },
    {
      id: 'keuangan',
      nameEn: 'Finance',
      nameId: 'Keuangan',
      icon: CreditCard,
      items: [
        { nameEn: 'Customer Debt', nameId: 'Hutang Pelanggan', path: '/hutang-pelanggan' },
        { nameEn: 'Supplier Payables', nameId: 'Hutang Supplier', path: '/hutang-supplier' },
        { nameEn: 'Store Expenses', nameId: 'Pengeluaran', path: '/pengeluaran' },
      ],
    },
    {
      id: 'ai',
      nameEn: 'AI Intelligence',
      nameId: 'AI',
      icon: Brain,
      items: [
        { nameEn: 'Restock Advisor', nameId: 'Restock Advisor', path: '/restock-advisor' },
        { nameEn: 'AI Chart', nameId: 'AI Chart', path: '/ai-chart' },
        { nameEn: 'Preventive AI', nameId: 'AI Preventif', path: '/ai-preventif' },
      ],
    },
  ];

  // Accordion state initialization from localStorage
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // ignore
    }
    return {
      dashboard: true,
      produk: true,
      inventori: true,
      pelanggan_pwa: true,
      keuangan: true,
      ai: true,
    };
  });

  // Auto-expand group containing the active route on mount and when route changes
  useEffect(() => {
    const activeGroup = menuGroups.find((g) =>
      g.items.some((item) => item.path === currentPath)
    );
    if (activeGroup && !openGroups[activeGroup.id]) {
      setOpenGroups((prev) => {
        const next = { ...prev, [activeGroup.id]: true };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    }
  }, [currentPath]);

  const updateGroups = (next: Record<string, boolean>) => {
    setOpenGroups(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const handleToggleGroup = (groupId: string) => {
    updateGroups({
      ...openGroups,
      [groupId]: !openGroups[groupId],
    });
  };

  const handleExpandAll = () => {
    const allOpen: Record<string, boolean> = {};
    menuGroups.forEach((g) => {
      allOpen[g.id] = true;
    });
    updateGroups(allOpen);
  };

  const handleCollapseAll = () => {
    const allClosed: Record<string, boolean> = {};
    menuGroups.forEach((g) => {
      allClosed[g.id] = false;
    });
    updateGroups(allClosed);
  };

  const closeMobile = () => {
    setIsMobileOpen(false);
  };

  const isPosActive = currentPath === '/dashboard/pos' || currentPath === '/pos';
  const isOrdersActive = currentPath === '/orders' || currentPath.startsWith('/orders/');

  const renderContent = (collapsed: boolean, isMobile: boolean) => {
    return (
      <div className="flex flex-col h-full select-none text-amber-50 bg-[#0d0b07] border-r border-amber-500/40 shadow-[0_0_18px_rgba(245,158,11,0.12)]">
        {/* 1. HEADER: Title + Collapse Button */}
        <div className="h-14 px-3 flex items-center justify-between border-b border-amber-500/35 shrink-0">
          {!collapsed ? (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13px] font-black tracking-wider text-amber-400 font-mono uppercase truncate">
                POINT OF SALE
              </span>
            </div>
          ) : (
            <div className="mx-auto">
              <Store className="w-5 h-5 text-amber-400" />
            </div>
          )}

          {isMobile ? (
            <button
              onClick={closeMobile}
              className="p-1.5 rounded-lg text-amber-300/70 hover:text-amber-100 hover:bg-amber-500/15 transition cursor-pointer"
              title="Tutup Menu"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={toggleCollapsed}
              className="p-1.5 rounded-lg text-amber-300/70 hover:text-amber-100 hover:bg-amber-500/15 transition cursor-pointer"
              title={collapsed ? tr('Expand Sidebar', 'Perluas Sidebar') : tr('Collapse Sidebar', 'Ciutkan Sidebar (mode ikon)')}
              aria-label="Collapse Sidebar"
            >
              {collapsed ? (
                <ChevronRight className="w-4 h-4 text-amber-400" />
              ) : (
                <span className="text-sm font-bold text-amber-300 hover:text-amber-200 px-1">‹</span>
              )}
            </button>
          )}
        </div>

        {/* 2. MAIN PRIMARY ITEMS */}
        <div className="p-2.5 space-y-2 border-b border-amber-500/30 shrink-0">
          {/* BUKA POS MACHINE: Metallic Gold Gradient, badge LIVE */}
          <NavLink
            to="/dashboard/pos"
            onClick={closeMobile}
            title={collapsed ? tr('BUKA POS MACHINE', 'BUKA POS MACHINE') : undefined}
            className={() =>
              `w-full flex items-center ${
                collapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'
              } rounded-xl text-[12px] font-black transition cursor-pointer ${
                isPosActive
                  ? 'bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] text-black border border-amber-300/60 shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                  : 'bg-[#14110b] text-amber-200 hover:bg-amber-500/15 border border-amber-500/40'
              }`
            }
          >
            <div className="flex items-center gap-2 min-w-0">
              <Store className={`w-4 h-4 shrink-0 ${isPosActive ? 'text-black' : 'text-amber-400'}`} />
              {!collapsed && (
                <span className="truncate">{tr('BUKA POS MACHINE', 'BUKA POS MACHINE')}</span>
              )}
            </div>
            {!collapsed && (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase tracking-wider bg-emerald-950/90 border border-emerald-400/50 text-emerald-300">
                LIVE
              </span>
            )}
          </NavLink>

          {/* Orders (Wharf): Non-aktif, kartu gelap berborder tipis, badge WHARF */}
          <NavLink
            to="/orders"
            onClick={closeMobile}
            title={collapsed ? tr('Orders (Wharf)', 'Orders (Wharf)') : undefined}
            className={() =>
              `w-full flex items-center ${
                collapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'
              } rounded-[10px] text-[12px] font-semibold transition border cursor-pointer ${
                isOrdersActive
                  ? 'bg-blue-600/20 text-blue-400 border-blue-500/50 font-bold'
                  : 'bg-zinc-950/70 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-800/50 text-zinc-300 hover:text-white'
              }`
            }
          >
            <div className="flex items-center gap-2 min-w-0">
              <ShoppingBag className="w-4 h-4 text-zinc-400 shrink-0" />
              {!collapsed && (
                <span className="truncate">{tr('Orders (Wharf)', 'Orders (Wharf)')}</span>
              )}
            </div>
            {!collapsed && (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase tracking-wider bg-zinc-800 text-zinc-400 border border-zinc-700/80">
                WHARF
              </span>
            )}
          </NavLink>
        </div>

        {/* 3. GRUP MENU HEADER WITH EXPAND / CIUTKAN CONTROLS */}
        {!collapsed && (
          <div className="px-3 pt-3 pb-1 flex items-center justify-between shrink-0">
            <span className="text-[10px] font-bold text-zinc-500 tracking-wider uppercase">
              {tr('MENU GROUPS', 'GRUP MENU')}
            </span>
            <div className="flex items-center gap-2 text-[10px] font-semibold">
              <button
                onClick={handleExpandAll}
                className="text-blue-400 hover:text-blue-300 transition cursor-pointer"
                title="Buka semua grup"
              >
                + {tr('Expand All', 'Expand Semua')}
              </button>
              <span className="text-zinc-600">&bull;</span>
              <button
                onClick={handleCollapseAll}
                className="text-zinc-500 hover:text-zinc-400 transition cursor-pointer"
                title="Tutup semua grup"
              >
                – {tr('Collapse', 'Ciutkan')}
              </button>
            </div>
          </div>
        )}

        {/* 4. SCROLLABLE ACCORDION GROUPS */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1 custom-scrollbar min-h-0">
          {menuGroups.map((group) => {
            const GroupIcon = group.icon;
            const isOpen = !!openGroups[group.id];
            const groupName = tr(group.nameEn, group.nameId);

            if (collapsed) {
              return (
                <div key={group.id} className="relative group/col py-1">
                  <button
                    onClick={() => handleToggleGroup(group.id)}
                    className="w-full flex items-center justify-center p-2 rounded-[10px] text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition cursor-pointer"
                    title={groupName}
                  >
                    <GroupIcon className="w-4 h-4 text-zinc-300" />
                  </button>
                </div>
              );
            }

            return (
              <div key={group.id} className="rounded-[10px] overflow-hidden">
                {/* Group Accordion Header */}
                <button
                  onClick={() => handleToggleGroup(group.id)}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[10px] text-[12px] font-semibold text-zinc-300 hover:text-white hover:bg-zinc-800/50 transition cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <GroupIcon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <span className="truncate">{groupName}</span>
                  </div>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-zinc-500 transition-transform duration-200 shrink-0 ${
                      isOpen ? 'transform rotate-0' : 'transform -rotate-90'
                    }`}
                  />
                </button>

                {/* Sub-Items */}
                {isOpen && (
                  <div className="mt-0.5 space-y-0.5 pb-1">
                    {group.items.map((item) => {
                      const itemName = tr(item.nameEn, item.nameId);
                      const isItemActive = currentPath === item.path;

                      return (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          onClick={closeMobile}
                          className={() =>
                            `w-full flex items-center justify-between pl-7 pr-2.5 py-1.5 rounded-[8px] text-[12px] transition cursor-pointer ${
                              isItemActive
                                ? 'bg-blue-600/20 text-blue-400 font-bold border-l-2 border-blue-500'
                                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 border-l-2 border-transparent'
                            }`
                          }
                        >
                          <span className="truncate">{itemName}</span>
                          {isItemActive && (
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 5. FOOTER MENEMPEL DI BAWAH */}
        <div className="p-2.5 border-t border-amber-500/35 bg-[#0b0906] space-y-2 shrink-0">
          {/* Tombol Metallic Gold "ASK AI" + Sparkles + Chip COPILOT */}
          <button
            onClick={() => {
              navigate('/dashboard/ai/tanya-ai');
              closeMobile();
            }}
            title={tr('Ask AI Business Copilot', 'Tanya AI Business Copilot')}
            className={`w-full p-2.5 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 text-black font-black transition flex items-center ${
              collapsed ? 'justify-center' : 'justify-between'
            } border border-amber-300/60 shadow-[0_0_15px_rgba(245,158,11,0.35)] cursor-pointer`}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-black shrink-0" />
              {!collapsed && (
                <span className="tracking-wide text-xs font-black">{tr('ASK AI', 'TANYA AI')}</span>
              )}
            </div>
            {!collapsed && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-black/80 font-mono text-amber-300 font-bold uppercase tracking-wider border border-amber-400/40">
                COPILOT
              </span>
            )}
          </button>

          {/* Titik hijau + Admin User dan chip IDR */}
          {!collapsed ? (
            <div className="pt-1 flex items-center justify-between text-[11px] text-zinc-400">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-ping" />
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 -ml-3.5" />
                <span className="font-semibold text-zinc-300 truncate">Admin User</span>
              </div>
              <button
                onClick={() => setCurrencyMode(currencyMode === 'IDR' ? 'USD' : 'IDR')}
                className="font-bold text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-blue-400 hover:bg-zinc-700 transition border border-zinc-700 cursor-pointer shrink-0"
                title="Toggle currency mode (IDR / USD)"
              >
                {currencyMode}
              </button>
            </div>
          ) : (
            <div className="flex justify-center pt-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400" title="Admin User Online" />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop Persistent Sidebar (Lebar ±212px atau 64px saat collapsed) */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 h-full transition-all duration-200 z-30 ${
          isCollapsed ? 'w-16' : 'w-[212px]'
        }`}
      >
        {renderContent(isCollapsed, false)}
      </aside>

      {/* Mobile Drawer (dari tombol hamburger di header) */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-[240px] max-w-[85vw] h-full shadow-2xl flex flex-col justify-between">
            {renderContent(false, true)}
          </div>
          <div className="flex-1" onClick={closeMobile} />
        </div>
      )}
    </>
  );
};
