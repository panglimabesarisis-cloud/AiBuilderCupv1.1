import React, { useState } from 'react';
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
  ClipboardList,
} from 'lucide-react';
import { AppLink, getPathForTab, getPathForProductSubTab } from '../../router';
import { useLanguage } from '../../context/LanguageContext';
import { useAppData } from '../../context/AppDataContext';
import {
  useSidebarMenuConfig,
  MenuGroupConfig,
  MenuItemConfig,
} from '../../services/sidebarMenuService';
import { useAccessControl } from '../../context/AccessControlContext';

export interface SidebarGroupsRendererProps {
  collapsed: boolean;
  openGroups: Record<string, boolean>;
  toggleGroup: (key: string) => void;
  isSubActive: (tab: string, sub?: string) => boolean;
  activeTab: string;
  activeSubModule?: string;
  route: any;
  closeMobile: () => void;
  openAiAgentsList: boolean;
  setOpenAiAgentsList: React.Dispatch<React.SetStateAction<boolean>>;
  aiAgentsList: Array<{
    id: string;
    name: string;
    slug: string;
    latency: string;
    status: string;
    legacySubModule?: string;
  }>;
  tableDineInEnabled?: boolean;
  kitchenEnabled?: boolean;
}

export const SidebarGroupsRenderer: React.FC<SidebarGroupsRendererProps> = ({
  collapsed,
  openGroups,
  toggleGroup,
  isSubActive,
  activeTab,
  activeSubModule = '',
  route,
  closeMobile,
  openAiAgentsList,
  setOpenAiAgentsList,
  aiAgentsList,
  tableDineInEnabled = true,
  kitchenEnabled = true,
}) => {
  const { tr } = useLanguage();
  const { pendingPwaCount } = useAppData();
  const {
    groups: dynamicMenuGroups,
    structure,
    aiAgents: syncedAiAgents,
    isAiAgentsSectionVisible,
    aiAgentsSectionCustomLabel,
    moveItemAcrossGroups,
    reorderAiAgents,
    moveAiAgentToGroup,
  } = useSidebarMenuConfig();
  const { canPerformModuleAction } = useAccessControl();

  const [draggedSubmenu, setDraggedSubmenu] = useState<{
    groupId: string;
    itemIndex: number;
    itemId: string;
    isAiAgent?: boolean;
  } | null>(null);
  const [dragOverGroupKey, setDragOverGroupKey] = useState<string | null>(null);

  const GROUP_TO_MODULE_MAP: Record<string, string> = {
    ai: 'mod_ai',
    multi_outlet: 'mod_inventory',
    shift: 'mod_shift',
    dashboard: 'mod_dashboard',
    produk: 'mod_produk',
    bahan_baku: 'mod_produk',
    pembelian: 'mod_pembelian',
    transaksi_pos: 'mod_orders',
    inventory: 'mod_inventory',
    pelanggan: 'mod_pelanggan',
    marketing: 'mod_pelanggan',
    staff: 'mod_staff',
    keuangan: 'mod_keuangan',
    online_order: 'mod_settings',
    pengaturan_pwa: 'mod_settings',
    pengaturan_pos: 'mod_settings',
    integrasi_payment: 'mod_settings',
    payment: 'mod_settings',
  };

  const GROUP_ICON_MAP: Record<string, React.ReactNode> = {
    ai: <Brain className="w-4 h-4 text-purple-400 shrink-0" />,
    multi_outlet: <Store className="w-4 h-4 text-blue-400 shrink-0" />,
    shift: <Clock className="w-4 h-4 text-emerald-400 shrink-0" />,
    dashboard: <LayoutDashboard className="w-4 h-4 text-cyan-400 shrink-0" />,
    reservation_table: <Boxes className="w-4 h-4 text-amber-400 shrink-0" />,
    produk: <Boxes className="w-4 h-4 text-amber-400 shrink-0" />,
    bahan_baku: <Boxes className="w-4 h-4 text-amber-400 shrink-0" />,
    pembelian: <Truck className="w-4 h-4 text-orange-400 shrink-0" />,
    transaksi_pos: <ShoppingBag className="w-4 h-4 text-blue-400 shrink-0" />,
    inventory: <Layers className="w-4 h-4 text-emerald-400 shrink-0" />,
    pelanggan: <Users className="w-4 h-4 text-indigo-400 shrink-0" />,
    marketing: <Target className="w-4 h-4 text-pink-400 shrink-0" />,
    staff: <UserCheck className="w-4 h-4 text-teal-400 shrink-0" />,
    keuangan: <Vault className="w-4 h-4 text-emerald-400 shrink-0" />,
    online_order: <Globe className="w-4 h-4 text-blue-400 shrink-0" />,
    pengaturan_pwa: <Smartphone className="w-4 h-4 text-purple-400 shrink-0" />,
    pengaturan_pos: <Settings className="w-4 h-4 text-zinc-400 shrink-0" />,
    integrasi_payment: <CreditCard className="w-4 h-4 text-cyan-400 shrink-0" />,
    payment: <CreditCard className="w-4 h-4 text-cyan-400 shrink-0" />,
    semua_halaman: <Layers className="w-4 h-4 text-amber-400 shrink-0" />,
  };

  const GROUP_THEME_MAP: Record<
    string,
    { border: string; hoverText: string; activeText: string }
  > = {
    ai: {
      border: 'border-purple-500/80',
      hoverText: 'hover:text-purple-400',
      activeText: 'text-purple-300 font-bold',
    },
    multi_outlet: {
      border: 'border-blue-500/80',
      hoverText: 'hover:text-blue-400',
      activeText: 'text-blue-400 font-bold',
    },
    shift: {
      border: 'border-emerald-500/80',
      hoverText: 'hover:text-emerald-400',
      activeText: 'text-emerald-400 font-bold',
    },
    dashboard: {
      border: 'border-cyan-500/80',
      hoverText: 'hover:text-cyan-400',
      activeText: 'text-cyan-400 font-bold',
    },
    reservation_table: {
      border: 'border-amber-500/80',
      hoverText: 'hover:text-amber-400',
      activeText: 'text-amber-400 font-bold',
    },
    produk: {
      border: 'border-amber-500/80',
      hoverText: 'hover:text-amber-400',
      activeText: 'text-amber-400 font-bold',
    },
    bahan_baku: {
      border: 'border-amber-500/80',
      hoverText: 'hover:text-amber-400',
      activeText: 'text-amber-400 font-bold',
    },
    pembelian: {
      border: 'border-orange-500/80',
      hoverText: 'hover:text-orange-400',
      activeText: 'text-orange-400 font-bold',
    },
    transaksi_pos: {
      border: 'border-blue-500/80',
      hoverText: 'hover:text-blue-400',
      activeText: 'text-blue-400 font-bold',
    },
    inventory: {
      border: 'border-emerald-500/80',
      hoverText: 'hover:text-emerald-400',
      activeText: 'text-emerald-400 font-bold',
    },
    pelanggan: {
      border: 'border-indigo-500/80',
      hoverText: 'hover:text-indigo-400',
      activeText: 'text-indigo-400 font-bold',
    },
    marketing: {
      border: 'border-pink-500/80',
      hoverText: 'hover:text-pink-400',
      activeText: 'text-pink-400 font-bold',
    },
    staff: {
      border: 'border-teal-500/80',
      hoverText: 'hover:text-teal-400',
      activeText: 'text-teal-400 font-bold',
    },
    keuangan: {
      border: 'border-emerald-500/80',
      hoverText: 'hover:text-emerald-400',
      activeText: 'text-emerald-400 font-bold',
    },
    online_order: {
      border: 'border-blue-500/80',
      hoverText: 'hover:text-blue-400',
      activeText: 'text-blue-400 font-bold',
    },
    pengaturan_pwa: {
      border: 'border-purple-500/80',
      hoverText: 'hover:text-purple-400',
      activeText: 'text-purple-400 font-bold',
    },
    pengaturan_pos: {
      border: 'border-zinc-500/80',
      hoverText: 'hover:text-white',
      activeText: 'text-white font-bold',
    },
    integrasi_payment: {
      border: 'border-cyan-500/80',
      hoverText: 'hover:text-cyan-400',
      activeText: 'text-cyan-400 font-bold',
    },
    semua_halaman: {
      border: 'border-amber-500/80',
      hoverText: 'hover:text-amber-300',
      activeText: 'text-amber-300 font-bold',
    },
  };

  const resolveChildDisplayLabel = (groupId: string, child: MenuItemConfig): string => {
    const customScoped = structure?.childrenCustomLabels?.[`${groupId}:${child.id}`];
    const customGlobal = structure?.childrenCustomLabels?.[child.id];
    if (child.customLabel) return child.customLabel;
    if (customScoped) return customScoped;
    if (customGlobal) return customGlobal;
    return tr(child.labelEn || child.labelId, child.labelId);
  };

  const resolveAiAgentDisplayName = (agent: {
    id: string;
    name: string;
    slug: string;
    legacySubModule?: string;
  }): string => {
    const underscoreId = agent.slug.replace(/-/g, '_');
    const customLabel =
      structure?.childrenCustomLabels?.[`ai:${underscoreId}`] ||
      structure?.childrenCustomLabels?.[underscoreId] ||
      structure?.childrenCustomLabels?.[agent.slug] ||
      (agent.legacySubModule ? structure?.childrenCustomLabels?.[agent.legacySubModule] : undefined);
    if (customLabel) return customLabel;

    // Also check resolved children across all groups
    for (const g of dynamicMenuGroups) {
      const found = g.children?.find(
        (c) =>
          c.id === underscoreId ||
          c.id === agent.slug ||
          c.id === agent.legacySubModule ||
          c.path?.includes(`agent=${agent.slug}`)
      );
      if (found?.customLabel) return found.customLabel;
    }
    return agent.name;
  };

  const isChildActive = (groupId: string, child: MenuItemConfig): boolean => {
    const cid = child.id;
    if (child.isAiCustomPage) {
      return (
        activeTab === 'custom_ai_page' &&
        (activeSubModule === child.customPageSlug || route?.entityId === child.customPageSlug)
      );
    }
    if (cid === 'ai-asset-stock') {
      return (
        activeTab === 'ai-asset-stock' ||
        activeTab === 'ai_asset_stock' ||
        isSubActive('module_ai', 'ai-asset-stock') ||
        isSubActive('module_ai', 'ai_asset_stock')
      );
    }
    if (cid === 'ai_knowledge') {
      return (
        isSubActive('module_ai', 'ai_knowledge') ||
        isSubActive('module_ai', 'ai_agent') ||
        isSubActive('module_ai', 'ai-agent')
      );
    }
    if (cid === 'admin') {
      return activeTab === 'admin' || activeTab === 'admin_dashboard';
    }
    if (cid === 'myasset') {
      return activeTab === 'myasset' || activeTab === 'asset_toko';
    }
    if (cid === 'laporankas') {
      return activeTab === 'laporan_kas' || activeTab === 'laporankas';
    }
    if (cid === 'laporancashflow') {
      return activeTab === 'laporancashflow' || activeTab === 'laporan_cashflow';
    }
    if (cid === 'transaction_store') {
      return activeTab === 'transaction_store';
    }
    if (cid === 'transactions') {
      return activeTab === 'transactions';
    }
    if (cid === 'assets') {
      return activeTab === 'assets';
    }
    if (cid === 'list_produk') {
      return (
        activeTab === 'products' &&
        route?.productSubTab === 'list' &&
        route?.productViewMode === 'table'
      );
    }
    if (cid === 'tambah_produk') {
      return activeTab === 'products' && route?.productViewMode === 'add_product';
    }
    if (cid === 'produk_log') {
      return activeTab === 'produk_log' || activeTab === 'product_log';
    }
    if (cid === 'paket_produk') {
      return activeTab === 'products' && route?.productSubTab === 'paket';
    }
    if (cid === 'kategori') {
      return activeTab === 'products' && route?.productSubTab === 'kategori';
    }
    if (cid === 'harga_diskon') {
      return activeTab === 'products' && route?.productSubTab === 'harga_diskon';
    }
    if (cid === 'orders_wharf') {
      return activeTab === 'orders';
    }
    if (cid === 'inventory_overview') {
      return isSubActive('module_inventory', 'inventory');
    }
    if (groupId === 'reservation_table' || cid.startsWith('res_')) {
      if (activeTab !== 'layout_table' && activeTab !== 'table_layout' && activeTab !== 'reservation') return false;
      if (cid === 'res_reservasi') return activeSubModule === 'reservation';
      if (cid === 'res_list') return activeSubModule === 'reservation_list';
      if (cid === 'res_table_layout') return !activeSubModule || activeSubModule === 'layout' || activeSubModule === 'ai_master';
      if (cid === 'res_summary_report') return activeSubModule === 'summary';
    }
    if (groupId === 'bahan_baku' || cid.startsWith('bb_')) {
      if (activeTab !== 'module_bahan_baku' && activeTab !== 'bahan_baku') return false;
      if (cid === 'bb_list') {
        return !activeSubModule || activeSubModule === 'list' || activeSubModule === 'tambah' || activeSubModule === 'edit';
      }
      if (cid === 'bb_supplier') return activeSubModule === 'supplier';
      if (cid === 'bb_pembelian') return activeSubModule === 'pembelian';
      if (cid === 'bb_po') return activeSubModule === 'po';
      if (cid === 'bb_request') return activeSubModule === 'request';
      if (cid === 'bb_ai') return activeSubModule === 'ai';
    }

    const slugForm = cid.replace(/_/g, '-');
    if (
      isSubActive('module_ai', cid) ||
      isSubActive('module_ai', slugForm) ||
      isSubActive('module_multi_outlet', cid) ||
      isSubActive('module_shift', cid) ||
      isSubActive('module_procurement', cid) ||
      isSubActive('module_pos_transactions', cid) ||
      isSubActive('module_inventory', cid) ||
      isSubActive('module_customer', cid) ||
      isSubActive('module_marketing', cid) ||
      isSubActive('module_staff', cid) ||
      isSubActive('module_finance', cid) ||
      isSubActive('module_online_order', cid) ||
      isSubActive('module_pwa_settings', cid) ||
      isSubActive('module_pos_settings', cid) ||
      isSubActive('module_payment', cid)
    ) {
      return true;
    }

    if (typeof window !== 'undefined' && child.path) {
      const cleanTarget = child.path.split('?')[0];
      if (window.location.pathname === cleanTarget) return true;
    }
    return false;
  };

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

  const renderChildItem = (
    groupConfig: MenuGroupConfig,
    child: MenuItemConfig,
    childIdx: number,
    visibleGroupIdx: number,
    visibleChildIdx: number
  ) => {
    if (child.visible === false) return null;
    if (!tableDineInEnabled && isTableDineInItem(child)) return null;
    if (!kitchenEnabled && isKitchenItem(child)) return null;
    const groupId = groupConfig.id;
    const theme = GROUP_THEME_MAP[groupId] || GROUP_THEME_MAP.pengaturan_pos;
    const rawLabel = resolveChildDisplayLabel(groupId, child);

    // Focus Mode target: 4th visible group (index 3) -> 9th visible child (index 8)
    // as well as canonical dynamic_pricing / thin-margin item
    const isFocusTargetThinMargin =
      (visibleGroupIdx === 3 && visibleChildIdx === 8) ||
      child.id === 'dynamic_pricing' ||
      child.id === 'ai_agent_agent_5';

    const DEFAULT_GENERIC_AI_LABELS = new Set([
      'Anti-Fraud Sentinel AI',
      'AI Fraud Detection',
      'Optimasi Harga Dinamis AI',
      'Dynamic Pricing Optimizer AI',
      'AI Financial Intelligence & Pricing Optimizer',
      'AI Customer Retention',
      'AI Retensi & Churn Pelanggan',
      'AI GUARD',
      'AI VOID REPORT',
      'AI Transaction Intelligence & Loss Prevention',
      'AI Pencegahan Kerugian',
      'AI Supplier Intelligence & Price Anomaly AI',
    ]);

    const label =
      isFocusTargetThinMargin && DEFAULT_GENERIC_AI_LABELS.has(rawLabel.trim())
        ? tr('AI Thin Margin Price Analyzer', 'AI Analisa Margin Harga Jual')
        : rawLabel;

    if (isFocusTargetThinMargin && visibleGroupIdx === 3 && visibleChildIdx === 8 && typeof window !== 'undefined') {
      try {
        localStorage.setItem(
          'riskcart_thin_margin_target_item',
          JSON.stringify({ id: child.id, path: child.path, label })
        );
      } catch {}
    }

    const active =
      isChildActive(groupId, child) ||
      (isFocusTargetThinMargin &&
        activeTab === 'module_ai' &&
        (activeSubModule === 'dynamic-pricing' ||
          activeSubModule === 'dynamic_pricing' ||
          activeSubModule === 'thin-margin' ||
          (typeof window !== 'undefined' && window.location.search.includes('analyzer=thin-margin'))));

    const dragProps = {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.stopPropagation();
        setDraggedSubmenu({ groupId, itemIndex: childIdx, itemId: child.id });
      },
      onDragOver: (e: React.DragEvent) => {
        if (draggedSubmenu) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      onDrop: (e: React.DragEvent) => {
        if (draggedSubmenu) {
          e.preventDefault();
          e.stopPropagation();
          if (draggedSubmenu.isAiAgent) {
            moveAiAgentToGroup(draggedSubmenu.itemId, groupId, childIdx);
          } else {
            moveItemAcrossGroups(
              draggedSubmenu.groupId,
              draggedSubmenu.itemIndex,
              groupId,
              childIdx
            );
          }
          setDraggedSubmenu(null);
          setDragOverGroupKey(null);
        }
      },
      onDragEnd: () => {
        setDraggedSubmenu(null);
        setDragOverGroupKey(null);
      },
    };

    // Special case: list_produk with + Tambah button
    if (child.id === 'list_produk') {
      return (
        <div
          key={`${groupId}-${child.id}`}
          {...dragProps}
          className="flex items-center justify-between py-0.5"
        >
          <AppLink
            to={getPathForProductSubTab('list')}
            onClick={closeMobile}
            className={`text-left font-bold hover:text-blue-400 cursor-pointer ${
              active ? 'text-blue-400' : 'text-white'
            }`}
          >
            {label}
          </AppLink>
          <AppLink
            to="/produk/tambah"
            onClick={closeMobile}
            className={`text-[9px] px-1 py-0.5 rounded transition cursor-pointer ${
              activeTab === 'products' && route?.productViewMode === 'add_product'
                ? 'bg-blue-600 text-white font-bold'
                : 'bg-blue-600/30 text-blue-300 hover:bg-blue-600 hover:text-white'
            }`}
          >
            {tr('+ Add', '+ Tambah')}
          </AppLink>
        </div>
      );
    }

    // Special case: paket_produk with + Tambah button
    if (child.id === 'paket_produk') {
      return (
        <div
          key={`${groupId}-${child.id}`}
          {...dragProps}
          className="flex items-center justify-between py-0.5"
        >
          <AppLink
            to={getPathForProductSubTab('paket')}
            onClick={closeMobile}
            className={`text-left py-0.5 hover:text-amber-400 block cursor-pointer ${
              active ? 'text-amber-400 font-bold' : ''
            }`}
          >
            {label}
          </AppLink>
          <AppLink
            to="/paket-produk/tambah"
            onClick={closeMobile}
            className="text-[9px] px-1 py-0.5 rounded bg-amber-600/25 text-amber-300 hover:bg-amber-600 hover:text-white cursor-pointer"
          >
            {tr('+ Add', '+ Tambah')}
          </AppLink>
        </div>
      );
    }

    // Special case: produk_log with icon & LIVE badge
    if (child.id === 'produk_log') {
      return (
        <div
          key={`${groupId}-${child.id}`}
          {...dragProps}
          className="flex items-center justify-between py-0.5"
        >
          <AppLink
            to={child.path || '/dashboard/produk-log'}
            onClick={closeMobile}
            className={`text-left font-bold hover:text-emerald-400 cursor-pointer flex items-center gap-1.5 ${
              active ? 'text-emerald-400 font-bold' : 'text-zinc-300'
            }`}
          >
            <ClipboardList className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{label}</span>
          </AppLink>
          <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-600/20 text-emerald-300 font-mono font-bold border border-emerald-500/30">
            {child.badge || 'LIVE'}
          </span>
        </div>
      );
    }

    const isOrdersBadge =
      child.id === 'orders' ||
      child.id === 'orders_wharf' ||
      String(child.badge || '').toUpperCase().includes('PENDING');
    const resolvedBadge = isOrdersBadge
      ? pendingPwaCount > 0
        ? `${pendingPwaCount} PENDING`
        : child.badge || 'NEW'
      : isFocusTargetThinMargin
      ? child.badge || 'MARGIN'
      : child.badge;

    const targetLinkPath = isFocusTargetThinMargin
      ? '/dashboard/ai/dynamic-pricing?agent=dynamic-pricing&analyzer=thin-margin'
      : child.path;

    return (
      <div key={`${groupId}-${child.id}`} {...dragProps}>
        <AppLink
          to={targetLinkPath}
          onClick={closeMobile}
          title={
            isFocusTargetThinMargin
              ? tr(
                  'AI that analyzes when selling price has a thin margin',
                  'AI yang menganalisa apabila harga jual memiliki margin yang tipis'
                )
              : label
          }
          className={`rc-sidebar-submenu-link ${
            active ? `rc-sidebar-submenu-link-active ${theme.activeText}` : ''
          } w-full text-left py-1 ${theme.hoverText} cursor-pointer flex items-center justify-between gap-1.5`}
        >
          <span className="truncate">{label}</span>
          {resolvedBadge && (
            <span className="rc-sidebar-badge text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30 shrink-0">
              {resolvedBadge}
            </span>
          )}
        </AppLink>
      </div>
    );
  };

  const visibleAiAgentsInSection =
    syncedAiAgents && syncedAiAgents.length > 0
      ? syncedAiAgents
          .filter((a) => a.visible !== false && !a.movedToGroupId)
          .map((a) => ({
            id: a.id,
            name: a.displayName,
            slug: a.slug,
            latency: a.latency,
            status: 'active',
            legacySubModule: a.slug,
          }))
      : aiAgentsList;

  const visibleDynamicGroups = dynamicMenuGroups.filter((g) => {
    if (g.visible === false) return false;
    const groupId = g.id === 'integrasi_payment' ? 'payment' : g.id;
    const mappedModuleId = GROUP_TO_MODULE_MAP[groupId] || GROUP_TO_MODULE_MAP[g.id];
    if (mappedModuleId && !canPerformModuleAction(mappedModuleId, 'view')) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-1 pt-1">
      {visibleDynamicGroups.map((g, visibleGroupIdx) => {
        const groupId = g.id === 'integrasi_payment' ? 'payment' : g.id;
        const isGroupOpen = Boolean(openGroups[groupId] ?? openGroups[g.id]);
        const groupTitle = g.customLabel || tr(g.labelEn || g.labelId, g.labelId);
        const iconNode = GROUP_ICON_MAP[groupId] || GROUP_ICON_MAP[g.id] || (
          <Layers className="w-4 h-4 text-zinc-400 shrink-0" />
        );
        const theme = GROUP_THEME_MAP[g.id] || GROUP_THEME_MAP[groupId] || GROUP_THEME_MAP.pengaturan_pos;
        const isDragOverThisGroup = dragOverGroupKey === g.id && draggedSubmenu !== null;
        let visibleChildCounter = -1;

        return (
          <div
            key={g.id}
            onDragOver={(e) => {
              if (draggedSubmenu) {
                e.preventDefault();
                if (dragOverGroupKey !== g.id) {
                  setDragOverGroupKey(g.id);
                }
              }
            }}
            onDragLeave={() => {
              if (dragOverGroupKey === g.id) {
                setDragOverGroupKey(null);
              }
            }}
            onDrop={(e) => {
              if (draggedSubmenu) {
                e.preventDefault();
                if (draggedSubmenu.isAiAgent) {
                  moveAiAgentToGroup(draggedSubmenu.itemId, g.id);
                } else {
                  moveItemAcrossGroups(
                    draggedSubmenu.groupId,
                    draggedSubmenu.itemIndex,
                    g.id
                  );
                }
                if (!isGroupOpen) {
                  toggleGroup(groupId);
                }
                setDraggedSubmenu(null);
                setDragOverGroupKey(null);
              }
            }}
            className={
              isDragOverThisGroup
                ? 'rounded-xl ring-2 ring-emerald-500/70 bg-emerald-950/20 transition'
                : ''
            }
          >
            <button
              onClick={() => toggleGroup(groupId)}
              className={`rc-sidebar-group-btn w-full flex items-center ${
                collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'
              } rounded-xl text-zinc-300 hover:text-white hover:bg-zinc-800/60 font-semibold cursor-pointer`}
              title={groupTitle}
            >
              <div className="flex items-center gap-2 min-w-0">
                {iconNode}
                {!collapsed && (
                  <span className="rc-sidebar-group-title uppercase text-[11px] tracking-wider text-zinc-200 truncate">
                    {groupTitle}
                  </span>
                )}
              </div>
              {!collapsed && (
                <ChevronDown
                  className={`w-3.5 h-3.5 text-zinc-400 transition-transform shrink-0 ${
                    isGroupOpen ? '' : '-rotate-90'
                  }`}
                />
              )}
            </button>

            {!collapsed && isGroupOpen && (
              <div
                className={`rc-sidebar-submenu-box pl-6 pr-1 py-1 space-y-1 bg-zinc-950/40 rounded-xl border-l-2 ${theme.border} my-1 text-[11px] font-medium text-zinc-400`}
              >
                {(g.children || []).map((child, idx) => {
                  if (child.visible === false) return null;
                  if (!tableDineInEnabled && isTableDineInItem(child)) return null;
                  if (!kitchenEnabled && isKitchenItem(child)) return null;
                  visibleChildCounter += 1;
                  return renderChildItem(g, child, idx, visibleGroupIdx, visibleChildCounter);
                })}

                {/* Expandable Nested List of 12 AI Agents inside Group A (ai) */}
                {g.id === 'ai' && isAiAgentsSectionVisible && (
                  <div
                    className="pt-2 mt-1 border-t border-zinc-800/80"
                    onDragOver={(e) => {
                      if (draggedSubmenu) {
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    }}
                    onDrop={(e) => {
                      if (draggedSubmenu && draggedSubmenu.itemId.startsWith('ai_agent_')) {
                        e.preventDefault();
                        e.stopPropagation();
                        const rawId = draggedSubmenu.itemId.replace(/^ai_agent_/, '');
                        moveAiAgentToGroup(rawId, 'ai_agents');
                        setDraggedSubmenu(null);
                        setDragOverGroupKey(null);
                      }
                    }}
                  >
                    <button
                      onClick={() => setOpenAiAgentsList((prev) => !prev)}
                      className="w-full flex items-center justify-between py-1 text-purple-300 hover:text-purple-200 font-semibold cursor-pointer text-[10px]"
                      title={tr(
                        'Click to toggle AI agents list',
                        'Klik untuk buka/tutup daftar agen AI'
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3 text-purple-400 shrink-0" />
                        <span>
                          {aiAgentsSectionCustomLabel
                            ? `${aiAgentsSectionCustomLabel} (${visibleAiAgentsInSection.length})`
                            : tr(
                                `AI Agents (${visibleAiAgentsInSection.length})`,
                                `Agen AI (${visibleAiAgentsInSection.length})`
                              )}
                        </span>
                      </div>
                      <ChevronDown
                        className={`w-3 h-3 text-purple-400 transition-transform ${
                          openAiAgentsList ? '' : '-rotate-90'
                        }`}
                      />
                    </button>

                    {openAiAgentsList && (
                      <div className="space-y-1 pt-1.5 text-[10px]">
                        {visibleAiAgentsInSection.map((agent, agentIdx) => {
                          const isAgentActive =
                            activeTab === 'module_ai' &&
                            (activeSubModule === agent.slug ||
                              (agent.legacySubModule &&
                                activeSubModule === agent.legacySubModule));
                          const agentDisplayName = resolveAiAgentDisplayName(agent);

                          return (
                            <div
                              key={agent.id}
                              draggable
                              onDragStart={(e) => {
                                e.stopPropagation();
                                setDraggedSubmenu({
                                  groupId: 'ai_agents',
                                  itemIndex: agentIdx,
                                  itemId: agent.id,
                                  isAiAgent: true,
                                });
                              }}
                              onDragOver={(e) => {
                                if (draggedSubmenu) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }
                              }}
                              onDrop={(e) => {
                                if (draggedSubmenu) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (draggedSubmenu.isAiAgent) {
                                    const currentIds = syncedAiAgents.map((a) => a.id);
                                    const fromPos = currentIds.indexOf(draggedSubmenu.itemId);
                                    const toPos = currentIds.indexOf(agent.id);
                                    if (fromPos !== -1 && toPos !== -1 && fromPos !== toPos) {
                                      const nextOrder = [...currentIds];
                                      const [removed] = nextOrder.splice(fromPos, 1);
                                      nextOrder.splice(toPos, 0, removed);
                                      reorderAiAgents(nextOrder);
                                    }
                                  } else if (draggedSubmenu.itemId.startsWith('ai_agent_')) {
                                    const rawId = draggedSubmenu.itemId.replace(/^ai_agent_/, '');
                                    moveAiAgentToGroup(rawId, 'ai_agents');
                                  }
                                  setDraggedSubmenu(null);
                                  setDragOverGroupKey(null);
                                }
                              }}
                              onDragEnd={() => {
                                setDraggedSubmenu(null);
                                setDragOverGroupKey(null);
                              }}
                            >
                              <AppLink
                                to={getPathForTab('module_ai', agent.slug)}
                                onClick={closeMobile}
                                title={`${agentDisplayName} (/ai/${agent.slug})`}
                                className={`rc-sidebar-submenu-link ${
                                  isAgentActive ? 'rc-sidebar-submenu-link-active' : ''
                                } w-full text-left py-1.5 px-2 rounded-r-lg flex items-center justify-between group transition cursor-pointer ${
                                  isAgentActive
                                    ? 'bg-emerald-500/20 border-l-2 border-emerald-400 ring-1 ring-emerald-500/30 text-white font-medium shadow-sm'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border-l-2 border-transparent font-normal'
                                }`}
                              >
                                <div className="flex items-center gap-2 truncate">
                                  {isAgentActive ? (
                                    <span className="relative flex h-2 w-2 shrink-0">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </span>
                                  ) : (
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0 group-hover:bg-slate-400 transition-colors" />
                                  )}
                                  <span
                                    className={`truncate text-[11px] ${
                                      isAgentActive
                                        ? 'text-white font-semibold'
                                        : 'text-slate-300 group-hover:text-white'
                                    }`}
                                  >
                                    {agentDisplayName}
                                  </span>
                                </div>
                                <span
                                  className={`text-[9px] font-mono shrink-0 ml-1.5 ${
                                    isAgentActive
                                      ? 'text-emerald-400 font-bold'
                                      : 'text-slate-500 group-hover:text-slate-400'
                                  }`}
                                >
                                  {agent.latency}
                                </span>
                              </AppLink>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
