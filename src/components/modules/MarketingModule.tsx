import React, { useState, useMemo, useEffect } from 'react';
import {
  Target,
  Megaphone,
  Ticket,
  Sparkles,
  Smartphone,
  BarChart2,
  Plus,
  CheckCircle,
  TrendingUp,
  X,
  Save,
  Eye,
  Edit2,
  Trash2,
  ArrowLeft,
  Search,
  Gift,
  Package,
} from 'lucide-react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { ACTIVE_STORE_ID } from '../../config/store';
import { useFirestoreList } from '../../hooks/useFirestoreList';
import { useAppData } from '../../context/AppDataContext';
import { useAppNavigation } from '../../router';

interface MarketingModuleProps {
  subModule:
    | 'hadiah_target'
    | 'informasi_hadiah'
    | 'voucher_promo'
    | 'setting_poin'
    | 'setting_poin_pwa'
    | 'statistik_marketing';
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

export interface TargetPromoProductRow {
  productId: string;
  productSku: string;
  productName: string;
  costPrice: number; // Harga Modal per Carton
  sellingPrice: number; // Harga Jual Normal per Carton
  promoPrice: number; // Harga Promo (Input Field)
  targetQty: number; // Target(Qty)
}

const INITIAL_VOUCHERS: any[] = [];
const INITIAL_POINT_RULES: any[] = [];

export const REWARD_TARGETS_COLLECTION = 'reward_targets';
export const REWARD_TARGETS_LOCAL_KEY = 'riskcart_reward_targets';

export function readLocalRewardTargets(): any[] {
  const keys = [
    REWARD_TARGETS_LOCAL_KEY,
    'riskcart_marketing_targets',
    'riskcart_fs_marketing_targets',
    'riskcart_fs_reward_targets',
    'reward_targets',
  ];
  const map = new Map<string, any>();
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((item: any) => {
          if (item && item.id && !item.isDeleted) {
            map.set(String(item.id), item);
          }
        });
      }
    } catch {
      // ignore parse errors
    }
  }
  return Array.from(map.values());
}

export async function saveRewardTarget(rawTarget: any) {
  const nowIso = new Date().toISOString();
  const id =
    rawTarget.id || `tgt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const targetAmt =
    Number(
      rawTarget.targetAmount ??
        rawTarget.targetValue ??
        rawTarget.grandTotalBelanja ??
        rawTarget.minPurchaseAmount ??
        0
    ) || 0;

  const targetQty =
    Number(rawTarget.totalTargetQty ?? rawTarget.minCartonQty ?? rawTarget.targetQty ?? 0) || 0;

  const isPub =
    rawTarget.published !== false &&
    rawTarget.status !== 'draft' &&
    rawTarget.status !== 'inactive' &&
    rawTarget.isActive !== false;

  const rewardLabel =
    rawTarget.rewardName ||
    rawTarget.prize ||
    rawTarget.reward ||
    (rawTarget.bonusProductName
      ? `${rawTarget.bonusQty || 1} Karton ${rawTarget.bonusProductName}`
      : 'Hadiah Target');

  const normalizedTarget = {
    ...rawTarget,
    id,
    title:
      rawTarget.title ||
      rawTarget.name ||
      rawTarget.targetName ||
      'Target Belanja Pelanggan',
    name:
      rawTarget.name ||
      rawTarget.title ||
      rawTarget.targetName ||
      'Target Belanja Pelanggan',
    rewardName: rewardLabel,
    prize: rewardLabel,
    reward: rewardLabel,
    targetAmount: targetAmt,
    targetValue: targetAmt,
    grandTotalBelanja: targetAmt,
    minPurchaseAmount: targetAmt,
    totalTargetQty: targetQty,
    minCartonQty: targetQty,
    targetType: rawTarget.targetType || 'nominal_belanja',
    customerType: rawTarget.customerType || 'all',
    isActive: isPub,
    active: isPub,
    published: isPub,
    status: isPub ? 'active' : 'draft',
    showInPwa: isPub,
    description: rawTarget.description || rawTarget.promoInfo || '',
    promoInfo: rawTarget.promoInfo || rawTarget.description || '',
    createdAt: rawTarget.createdAt || nowIso,
    updatedAt: nowIso,
  };

  let updatedList: any[] = [normalizedTarget];
  try {
    const existing = readLocalRewardTargets();
    const filtered = existing.filter((t: any) => t.id !== id);
    updatedList = [normalizedTarget, ...filtered];
    const serialized = JSON.stringify(updatedList);
    localStorage.setItem(REWARD_TARGETS_LOCAL_KEY, serialized);
    localStorage.setItem('riskcart_marketing_targets', serialized);
    localStorage.setItem('riskcart_fs_marketing_targets', serialized);
    localStorage.setItem('riskcart_fs_reward_targets', serialized);
    window.dispatchEvent(
      new CustomEvent('riskcart:reward-targets-updated', { detail: updatedList })
    );
  } catch (e) {
    console.warn('LocalStorage sync warning:', e);
  }

  try {
    await setDoc(doc(db, REWARD_TARGETS_COLLECTION, id), normalizedTarget, {
      merge: true,
    }).catch(() => {});
    await setDoc(doc(db, 'marketing_targets', id), normalizedTarget, {
      merge: true,
    }).catch(() => {});
    await setDoc(
      doc(db, 'stores', ACTIVE_STORE_ID, 'marketing_targets', id),
      normalizedTarget,
      { merge: true }
    ).catch(() => {});
    await setDoc(
      doc(db, 'stores', ACTIVE_STORE_ID, REWARD_TARGETS_COLLECTION, id),
      normalizedTarget,
      { merge: true }
    ).catch(() => {});
    await setDoc(
      doc(db, 'settings', 'reward_targets'),
      {
        items: updatedList,
        updatedAt: nowIso,
      },
      { merge: true }
    ).catch(() => {});
  } catch (err) {
    console.warn('Firestore saveRewardTarget warning (fallback active):', err);
  }

  return normalizedTarget;
}

export async function deleteRewardTargetUnified(targetId: string) {
  if (!targetId) return;
  try {
    const existing = readLocalRewardTargets().filter((t: any) => t.id !== targetId);
    const serialized = JSON.stringify(existing);
    localStorage.setItem(REWARD_TARGETS_LOCAL_KEY, serialized);
    localStorage.setItem('riskcart_marketing_targets', serialized);
    localStorage.setItem('riskcart_fs_marketing_targets', serialized);
    localStorage.setItem('riskcart_fs_reward_targets', serialized);
    window.dispatchEvent(
      new CustomEvent('riskcart:reward-targets-updated', { detail: existing })
    );
    await deleteDoc(doc(db, REWARD_TARGETS_COLLECTION, targetId)).catch(() => {});
    await deleteDoc(doc(db, 'marketing_targets', targetId)).catch(() => {});
    await deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'marketing_targets', targetId)).catch(() => {});
    await deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, REWARD_TARGETS_COLLECTION, targetId)).catch(() => {});
    await setDoc(
      doc(db, 'settings', 'reward_targets'),
      {
        items: existing,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    ).catch(() => {});
  } catch (err) {
    console.warn('Failed to delete target from all stores:', err);
  }
}

export const MarketingModule: React.FC<MarketingModuleProps> = ({
  subModule,
}) => {
  const { route, navigateTab, navigatePath } = useAppNavigation();
  const activeSub = (
    route.activeTab === 'module_marketing' ? route.activeSubModule : subModule
  ) as
    | 'hadiah_target'
    | 'informasi_hadiah'
    | 'voucher_promo'
    | 'setting_poin'
    | 'setting_poin_pwa'
    | 'statistik_marketing';

  const setActiveSub = (
    next:
      | 'hadiah_target'
      | 'informasi_hadiah'
      | 'voucher_promo'
      | 'setting_poin'
      | 'setting_poin_pwa'
      | 'statistik_marketing'
  ) => {
    setIsTargetFormPage(false);
    navigateTab('module_marketing', next);
  };

  // Firestore collections via useFirestoreList
  const {
    data: vouchers,
    addItem: addVoucher,
    updateItem: updateVoucher,
    deleteItem: deleteVoucher,
  } = useFirestoreList('vouchers', INITIAL_VOUCHERS);
  const {
    data: pointRules,
    addItem: addPointRule,
    deleteItem: deletePointRule,
  } = useFirestoreList('point_rules', INITIAL_POINT_RULES);
  const {
    data: marketingTargetsData,
    updateItem: updateTarget,
    deleteItem: deleteTarget,
  } = useFirestoreList<any>('marketing_targets', []);
  const {
    data: rewardTargetsData,
    deleteItem: deleteRewardTargetHook,
  } = useFirestoreList<any>(REWARD_TARGETS_COLLECTION, []);

  const [localTargetTick, setLocalTargetTick] = useState(0);
  useEffect(() => {
    const onUpdated = () => setLocalTargetTick((n) => n + 1);
    window.addEventListener('riskcart:reward-targets-updated', onUpdated);
    return () => window.removeEventListener('riskcart:reward-targets-updated', onUpdated);
  }, []);

  const targets = useMemo(() => {
    const map = new Map<string, any>();
    const localItems = readLocalRewardTargets();
    [...rewardTargetsData, ...marketingTargetsData, ...localItems].forEach((item: any) => {
      if (item && item.id && !item.isDeleted) {
        const prev = map.get(String(item.id)) || {};
        map.set(String(item.id), { ...prev, ...item });
      }
    });
    return Array.from(map.values());
  }, [rewardTargetsData, marketingTargetsData, localTargetTick]);

  // Auto-mirror existing targets to reward_targets & pwa_page_configs/target so PWA always receives them
  useEffect(() => {
    if (targets.length === 0) return;
    try {
      const serialized = JSON.stringify(targets);
      localStorage.setItem(REWARD_TARGETS_LOCAL_KEY, serialized);
      localStorage.setItem('riskcart_marketing_targets', serialized);
    } catch {}
    targets.forEach((t) => {
      if (t && t.id) {
        setDoc(
          doc(db, REWARD_TARGETS_COLLECTION, String(t.id)),
          {
            ...t,
            id: String(t.id),
            title: t.title || t.name || 'Promo Kejar Target',
            name: t.name || t.title || 'Promo Kejar Target',
            rewardName:
              t.rewardName ||
              t.prize ||
              t.reward ||
              (t.bonusProductName ? `${t.bonusQty || 1} Karton ${t.bonusProductName}` : 'Hadiah Target'),
            targetAmount: Number(t.targetAmount ?? t.grandTotalBelanja ?? t.minPurchaseAmount ?? 0),
            targetValue: Number(t.targetValue ?? t.grandTotalBelanja ?? t.minPurchaseAmount ?? 0),
            customerType: t.customerType || 'all',
            isActive: t.published !== false && t.status !== 'draft',
            showInPwa: t.published !== false && t.status !== 'draft',
            status: t.published === false || t.status === 'draft' ? 'draft' : 'active',
          },
          { merge: true }
        ).catch(() => {});
      }
    });
  }, [targets.length]);

  const {
    data: promoBanners,
    addItem: addPromoBanner,
    updateItem: updatePromoBanner,
    deleteItem: deletePromoBanner,
  } = useFirestoreList<any>('promo_banners', []);
  const { data: customersList } = useFirestoreList<any>('stores/store_001/customers', []);
  const { products: appProducts } = useAppData();
  const { data: catalogProducts } = useFirestoreList<any>('products', []);
  const { data: storeCatalogProducts } = useFirestoreList<any>(
    `stores/${ACTIVE_STORE_ID}/products`,
    []
  );

  // Normalize active products from AppDataContext + Firestore `products` collections
  const normalizedProducts = useMemo(() => {
    const productMap = new Map<string, any>();
    const combinedRaw = [
      ...(Array.isArray(appProducts) ? appProducts : []),
      ...(Array.isArray(storeCatalogProducts) ? storeCatalogProducts : []),
      ...(Array.isArray(catalogProducts) ? catalogProducts : []),
    ];

    combinedRaw.forEach((p: any) => {
      if (!p || p.isActive === false || p.isDeleted === true) return;
      const name = String(p.name || p.groupName || '').trim();
      if (!name) return;
      const id = String(p.id || p.docId || p.sku || name).trim();
      const firstVar = Array.isArray(p.variants) && p.variants.length > 0 ? p.variants[0] : null;

      const rawCost = Number(
        p.costPrice ??
          p.costPerCarton ??
          p.costPerUnit ??
          p.buyPrice ??
          p.modalPrice ??
          p.hargaModal ??
          firstVar?.costPrice ??
          firstVar?.costPerCarton ??
          firstVar?.costPerUnit ??
          0
      );
      const rawSell = Number(
        p.sellingPrice ??
          p.sellPrice ??
          p.posPrice ??
          p.pricePerCarton ??
          p.pricePerUnit ??
          p.price ??
          p.pwaPrice ??
          p.cartonWholesalePrice ??
          firstVar?.sellPrice ??
          firstVar?.posPrice ??
          firstVar?.pricePerCarton ??
          firstVar?.pricePerUnit ??
          0
      );
      const rawStock = Number(
        p.stock ?? p.stockInUnits ?? p.totalStock ?? firstVar?.stock ?? firstVar?.stockInUnits ?? 0
      );
      const rawItemsPerCarton = Math.max(
        1,
        Number(
          p.itemsPerCarton ??
            p.isiPerDus ??
            p.piecesPerCarton ??
            p.pcsPerCarton ??
            firstVar?.itemsPerCarton ??
            1
        )
      );

      const existing = productMap.get(id);
      productMap.set(id, {
        id,
        sku: String(p.sku || p.code || existing?.sku || id).trim(),
        name,
        costPrice: rawCost > 0 ? rawCost : Number(existing?.costPrice || 0),
        sellingPrice: rawSell > 0 ? rawSell : Number(existing?.sellingPrice || 0),
        stock: rawStock > 0 ? rawStock : Number(existing?.stock || 0),
        itemsPerCarton: rawItemsPerCarton,
      });
    });

    return Array.from(productMap.values());
  }, [appProducts, catalogProducts, storeCatalogProducts]);

  // Detail modal generic state
  const [detailItem, setDetailItem] = useState<{ title: string; data: Record<string, any> } | null>(null);

  // ============================================================================
  // NEW PAGE STATE: ADD / EDIT TARGET PROMO (Matches targetPromo.jpg layout)
  // ============================================================================
  const [isTargetFormPage, setIsTargetFormPage] = useState<boolean>(
    () => route.activeTab === 'module_marketing' && route.activeSubModule === 'hadiah_target' && route.actionMode === 'tambah'
  );

  useEffect(() => {
    if (route.activeTab === 'module_marketing' && route.activeSubModule === 'hadiah_target') {
      if (route.actionMode === 'tambah') {
        setIsTargetFormPage(true);
      }
    }
  }, [route.activeTab, route.activeSubModule, route.actionMode]);

  const [editingTarget, setEditingTarget] = useState<any | null>(null);
  const [promoName, setPromoName] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [promoItems, setPromoItems] = useState<TargetPromoProductRow[]>([]);
  const [bonusProductId, setBonusProductId] = useState('');
  const [bonusQty, setBonusQty] = useState<number>(1);
  const [promoInfo, setPromoInfo] = useState('');
  const [isPublished, setIsPublished] = useState<boolean>(true);
  const [isSubmittingPromo, setIsSubmittingPromo] = useState<boolean>(false);
  const [promoFeedbackMsg, setPromoFeedbackMsg] = useState<string | null>(null);
  const [userClearedPromoItems, setUserClearedPromoItems] = useState<boolean>(false);

  // Auto-seed initial product & bonus target when opening "Buat Promo Hadiah Target Baru"
  // so that Kalkulasi (Grand Total Belanja, Total Harga Modal Bonus, Grand Total Untung) calculates immediately
  useEffect(() => {
    if (!isTargetFormPage || editingTarget || userClearedPromoItems) return;
    if (normalizedProducts.length === 0) return;

    if (promoItems.length === 0) {
      const firstProd = normalizedProducts[0];
      setPromoItems([
        {
          productId: firstProd.id,
          productSku: firstProd.sku,
          productName: firstProd.name,
          costPrice: Number(firstProd.costPrice || 0),
          sellingPrice: Number(firstProd.sellingPrice || 0),
          promoPrice: Number(firstProd.sellingPrice || firstProd.costPrice || 0),
          targetQty: 10,
        },
      ]);
    }
    if (!bonusProductId) {
      setBonusProductId(normalizedProducts[0].id);
    }
  }, [isTargetFormPage, editingTarget, userClearedPromoItems, normalizedProducts, promoItems.length, bonusProductId]);

  // Filtered products for Cari Produk live search
  const filteredSearchProducts = useMemo(() => {
    const q = productSearchQuery.trim().toLowerCase();
    if (!q) return normalizedProducts.slice(0, 12);
    return normalizedProducts
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [normalizedProducts, productSearchQuery]);

  // Selected Bonus Target Product object (auto-falls back to first promo item's product if not explicitly picked)
  const selectedBonusProduct = useMemo(() => {
    const targetId = bonusProductId || promoItems[0]?.productId || '';
    if (!targetId) return null;
    const fromCatalog = normalizedProducts.find(
      (p) =>
        p.id === targetId ||
        p.sku === targetId ||
        p.name.toLowerCase() === String(targetId).toLowerCase()
    );
    if (fromCatalog) return fromCatalog;
    const fromRows = promoItems.find(
      (r) => r.productId === targetId || r.productSku === targetId || r.productName === targetId
    );
    if (fromRows) {
      return {
        id: fromRows.productId,
        sku: fromRows.productSku,
        name: fromRows.productName,
        costPrice: Number(fromRows.costPrice || 0),
        sellingPrice: Number(fromRows.sellingPrice || 0),
        stock: 0,
        itemsPerCarton: 1,
      };
    }
    return null;
  }, [normalizedProducts, bonusProductId, promoItems]);

  // Deterministic Live Calculations:
  // Total Pembelian (per row) = Harga Promo * Target(Qty)
  // Total Untung (per row) = (Harga Promo - Harga Modal) * Target(Qty)
  // Grand Total Belanja = Sum(Harga Promo * Target(Qty))
  // Total Harga Modal Bonus = Harga Modal Produk Bonus * Jumlah Bonus
  // Grand Total Untung = Sum(Total Untung) - Total Harga Modal Bonus
  const promoCalculation = useMemo(() => {
    const rows = promoItems.map((item) => {
      const liveProd = normalizedProducts.find(
        (p) =>
          p.id === item.productId ||
          (item.productSku && p.sku === item.productSku) ||
          p.name.toLowerCase() === String(item.productName || '').toLowerCase()
      );
      const qty = Math.max(1, Number(item.targetQty || 1));
      const rawItemCost = Number(item.costPrice || 0);
      const cost = Math.max(0, rawItemCost > 0 ? rawItemCost : Number(liveProd?.costPrice || 0));
      const rawItemSell = Number(item.sellingPrice || 0);
      const sell = Math.max(0, rawItemSell > 0 ? rawItemSell : Number(liveProd?.sellingPrice || 0));
      const rawItemPromo = Number(item.promoPrice ?? 0);
      const promo = Math.max(0, rawItemPromo > 0 ? rawItemPromo : sell);

      const totalPembelian = promo * qty;
      const totalModal = cost * qty;
      const totalUntung = totalPembelian - totalModal;
      return {
        ...item,
        targetQty: qty,
        costPrice: cost,
        sellingPrice: sell,
        promoPrice: promo,
        totalPembelian,
        totalModal,
        totalUntung,
      };
    });

    const grandTotalBelanja = rows.reduce((sum, r) => sum + r.totalPembelian, 0);
    const totalModalTarget = rows.reduce((sum, r) => sum + r.totalModal, 0);
    const totalGrossProfitRows = rows.reduce((sum, r) => sum + r.totalUntung, 0);
    const totalTargetQty = rows.reduce((sum, r) => sum + r.targetQty, 0);

    // Resolve bonus product cost price from selectedBonusProduct, or matching row, or editingTarget
    const matchingRowForBonus = rows.find(
      (r) =>
        r.productId === (bonusProductId || selectedBonusProduct?.id) ||
        r.productName === selectedBonusProduct?.name
    );
    const bonusUnitCost = Math.max(
      0,
      Number(
        selectedBonusProduct?.costPrice ||
          matchingRowForBonus?.costPrice ||
          rows[0]?.costPrice ||
          editingTarget?.bonusCostPrice ||
          0
      )
    );
    const effectiveBonusQty = Math.max(1, Number(bonusQty || 1));
    const totalHargaModalBonus =
      rows.length > 0 || Boolean(bonusProductId) || Boolean(selectedBonusProduct)
        ? bonusUnitCost * effectiveBonusQty
        : 0;
    const grandTotalUntung = totalGrossProfitRows - totalHargaModalBonus;

    return {
      rows,
      grandTotalBelanja,
      totalModalTarget,
      totalGrossProfitRows,
      totalTargetQty,
      bonusUnitCost,
      effectiveBonusQty,
      totalHargaModalBonus,
      grandTotalUntung,
    };
  }, [promoItems, normalizedProducts, selectedBonusProduct, bonusProductId, bonusQty, editingTarget]);

  const handleAddProductToPromo = (prod: {
    id: string;
    sku: string;
    name: string;
    costPrice: number;
    sellingPrice: number;
  }) => {
    setUserClearedPromoItems(false);
    setPromoItems((prev) => {
      const existingIdx = prev.findIndex((p) => p.productId === prod.id);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          costPrice: Number(prod.costPrice || updated[existingIdx].costPrice || 0),
          sellingPrice: Number(prod.sellingPrice || updated[existingIdx].sellingPrice || 0),
          targetQty: Number(updated[existingIdx].targetQty || 1) + 1,
        };
        return updated;
      }
      return [
        ...prev,
        {
          productId: prod.id,
          productSku: prod.sku,
          productName: prod.name,
          costPrice: Number(prod.costPrice || 0),
          sellingPrice: Number(prod.sellingPrice || 0),
          promoPrice: Number(prod.sellingPrice || prod.costPrice || 0),
          targetQty: 10,
        },
      ];
    });
    if (!bonusProductId) {
      setBonusProductId(prod.id);
    }
    setProductSearchQuery('');
    setShowProductDropdown(false);
  };

  const handleRemovePromoProduct = (productId: string) => {
    setPromoItems((prev) => {
      const next = prev.filter((item) => item.productId !== productId);
      if (next.length === 0) {
        setUserClearedPromoItems(true);
      }
      return next;
    });
  };

  const handleChangeCostPrice = (productId: string, newCostPrice: number) => {
    setPromoItems((prev) =>
      prev.map((item) =>
        item.productId === productId
          ? { ...item, costPrice: Math.max(0, Number(newCostPrice || 0)) }
          : item
      )
    );
  };

  const handleChangePromoPrice = (productId: string, newPromoPrice: number) => {
    setPromoItems((prev) =>
      prev.map((item) =>
        item.productId === productId
          ? { ...item, promoPrice: Math.max(0, Number(newPromoPrice || 0)) }
          : item
      )
    );
  };

  const handleChangeTargetQty = (productId: string, newTargetQty: number) => {
    setPromoItems((prev) =>
      prev.map((item) =>
        item.productId === productId
          ? { ...item, targetQty: Math.max(1, Number(newTargetQty || 1)) }
          : item
      )
    );
  };

  const openAddTarget = () => {
    setEditingTarget(null);
    setPromoName('');
    const today = new Date().toISOString().slice(0, 10);
    const nextMonth = new Date();
    nextMonth.setDate(nextMonth.getDate() + 30);
    setStartDate(today);
    setEndDate(nextMonth.toISOString().slice(0, 10));
    setUserClearedPromoItems(false);
    if (normalizedProducts.length > 0) {
      const firstProd = normalizedProducts[0];
      setPromoItems([
        {
          productId: firstProd.id,
          productSku: firstProd.sku,
          productName: firstProd.name,
          costPrice: Number(firstProd.costPrice || 0),
          sellingPrice: Number(firstProd.sellingPrice || 0),
          promoPrice: Number(firstProd.sellingPrice || firstProd.costPrice || 0),
          targetQty: 10,
        },
      ]);
      setBonusProductId(firstProd.id);
    } else {
      setPromoItems([]);
      setBonusProductId('');
    }
    setBonusQty(1);
    setPromoInfo('');
    setIsPublished(true);
    setIsTargetFormPage(true);
    navigatePath('/dashboard/marketing/hadiah-target/tambah');
  };

  const openEditTarget = (tgt: any) => {
    setEditingTarget(tgt);
    setUserClearedPromoItems(false);
    setPromoName(tgt.name || tgt.title || '');
    setStartDate(tgt.startDate || new Date().toISOString().slice(0, 10));
    setEndDate(tgt.endDate || new Date().toISOString().slice(0, 10));
    if (Array.isArray(tgt.items) && tgt.items.length > 0) {
      setPromoItems(
        tgt.items.map((it: any) => ({
          productId: String(it.productId || it.id || ''),
          productSku: String(it.productSku || it.sku || ''),
          productName: String(it.productName || it.name || ''),
          costPrice: Number(it.costPrice || 0),
          sellingPrice: Number(it.sellingPrice || 0),
          promoPrice: Number(it.promoPrice ?? it.sellingPrice ?? 0),
          targetQty: Math.max(1, Number(it.targetQty || 1)),
        }))
      );
    } else {
      setPromoItems([]);
    }
    setBonusProductId(tgt.bonusProductId || '');
    setBonusQty(Math.max(1, Number(tgt.bonusQty || 1)));
    setPromoInfo(tgt.promoInfo || tgt.notes || '');
    setIsPublished(tgt.published !== false && tgt.status !== 'draft');
    setIsTargetFormPage(true);
    navigatePath('/dashboard/marketing/hadiah-target/tambah');
  };

  const closeTargetFormPage = () => {
    setIsTargetFormPage(false);
    setEditingTarget(null);
    navigatePath('/dashboard/marketing/hadiah-target');
  };

  // Sync published targets to pwa_page_configs/target so Client PWA is always in sync
  const syncTargetsToPwaConfig = async (allTargetsList: any[]) => {
    try {
      const activeMilestones = allTargetsList
        .filter((t) => t.published !== false && t.status !== 'draft')
        .map((t) => ({
          id: t.id,
          title: t.name || t.title || 'Promo Kejar Target',
          titleId: t.name || t.title || 'Promo Kejar Target',
          titleEn: t.name || t.title || 'Target Promo',
          targetAmountIdr: Number(t.grandTotalBelanja ?? t.minPurchaseAmount ?? 0),
          targetQtyCarton: Number(t.totalTargetQty ?? t.minCartonQty ?? 0),
          rewardName: t.rewardName || t.reward || `${t.bonusQty || 1}x ${t.bonusProductName || 'Produk Bonus'}`,
          rewardTitleId: t.rewardName || t.reward || `${t.bonusQty || 1}x ${t.bonusProductName || 'Produk Bonus'}`,
          rewardTitleEn: t.rewardName || t.reward || `${t.bonusQty || 1}x ${t.bonusProductName || 'Bonus Product'}`,
          rewardValueIdr: Number(t.totalHargaModalBonus ?? t.rewardValue ?? 0),
          rewardType: 'physical',
          bonusProductId: t.bonusProductId || '',
          bonusProductSku: t.bonusProductSku || '',
          bonusProductName: t.bonusProductName || '',
          bonusQty: Number(t.bonusQty || 1),
          bonusCostPrice: Number(t.bonusCostPrice || 0),
          items: Array.isArray(t.items) ? t.items : [],
          startDate: t.startDate || '',
          endDate: t.endDate || '',
          promoInfo: t.promoInfo || '',
          active: true,
        }));

      const configPayload = {
        milestones: activeMilestones,
        updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'pwa_page_configs', 'target'), configPayload, { merge: true }).catch(() => {});
      await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'pwa_page_configs', 'target'), configPayload, {
        merge: true,
      }).catch(() => {});
    } catch (err) {
      console.warn('Failed to sync targets to pwa_page_configs/target:', err);
    }
  };

  const handleSubmitTargetPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoName.trim()) {
      setPromoFeedbackMsg('Nama Promo wajib diisi.');
      return;
    }

    setIsSubmittingPromo(true);
    setPromoFeedbackMsg(null);

    try {
      const nowIso = new Date().toISOString();
      const bonusProdName =
        selectedBonusProduct?.name ||
        editingTarget?.bonusProductName ||
        bonusProductId ||
        'Produk Bonus Target';
      const bonusProdSku =
        selectedBonusProduct?.sku || editingTarget?.bonusProductSku || '';
      const bonusProdCost = Number(
        selectedBonusProduct?.costPrice ?? editingTarget?.bonusCostPrice ?? 0
      );
      const bonusProdSell = Number(
        selectedBonusProduct?.sellingPrice ?? editingTarget?.bonusSellingPrice ?? 0
      );
      const cleanBonusQty = Math.max(1, Number(bonusQty || 1));
      const periodText = `${startDate} s/d ${endDate}`;
      const rewardDisplay = `${cleanBonusQty} Karton ${bonusProdName}`;
      const targetNominal = Number(
        promoCalculation.grandTotalBelanja ||
          editingTarget?.targetAmount ||
          editingTarget?.grandTotalBelanja ||
          0
      );
      const targetQtyTotal = Number(
        promoCalculation.totalTargetQty ||
          editingTarget?.totalTargetQty ||
          editingTarget?.minCartonQty ||
          0
      );

      let savedId = editingTarget?.id || `TGT-${Date.now().toString().slice(-6)}`;

      const payload = {
        id: savedId,
        name: promoName.trim(),
        title: promoName.trim(),
        startDate,
        endDate,
        period: periodText,
        items: promoCalculation.rows.map((r) => ({
          productId: r.productId,
          productSku: r.productSku,
          productName: r.productName,
          costPrice: r.costPrice,
          sellingPrice: r.sellingPrice,
          promoPrice: r.promoPrice,
          targetQty: r.targetQty,
          totalPurchase: r.totalPembelian,
          totalProfit: r.totalUntung,
        })),
        bonusProductId: selectedBonusProduct?.id || bonusProductId,
        bonusProductSku: bonusProdSku,
        bonusProductName: bonusProdName,
        bonusCostPrice: bonusProdCost,
        bonusSellingPrice: bonusProdSell,
        bonusQty: cleanBonusQty,
        promoInfo: promoInfo.trim(),
        description: promoInfo.trim(),
        published: isPublished,
        isActive: isPublished,
        active: isPublished,
        showInPwa: isPublished,
        customerType: 'all',
        targetType: 'nominal_belanja',
        status: isPublished ? 'active' : 'draft',
        // Kalkulasi fields
        grandTotalBelanja: targetNominal,
        targetAmount: targetNominal,
        targetValue: targetNominal,
        totalHargaModalBonus: promoCalculation.totalHargaModalBonus,
        grandTotalUntung: promoCalculation.grandTotalUntung,
        totalTargetQty: targetQtyTotal,
        // Compatibility fields for PWA & Dashboard cards
        minPurchaseAmount: targetNominal,
        minCartonQty: targetQtyTotal,
        rewardType: 'Bonus Produk Target',
        rewardName: rewardDisplay,
        prize: rewardDisplay,
        reward: rewardDisplay,
        rewardValue: promoCalculation.totalHargaModalBonus,
        currentAchievers: Number(editingTarget?.currentAchievers || 0),
        createdAt: editingTarget?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      if (editingTarget?.id) {
        await updateTarget(savedId, payload).catch(() => {});
      }
      await saveRewardTarget(payload);

      // Sync to pwa_page_configs/target
      const nextTargetsList = editingTarget?.id
        ? targets.map((t) => (t.id === savedId ? { ...t, ...payload, id: savedId } : t))
        : [payload, ...targets.filter((t) => t.id !== savedId)];
      await syncTargetsToPwaConfig(nextTargetsList);

      setLocalTargetTick((n) => n + 1);
      setIsTargetFormPage(false);
      setEditingTarget(null);
      navigatePath('/dashboard/marketing/hadiah-target');
    } catch (err) {
      console.error('Failed saving target promo:', err);
      setPromoFeedbackMsg('Gagal menyimpan Promo Target ke Firestore. Coba lagi.');
    } finally {
      setIsSubmittingPromo(false);
    }
  };

  // Banner Promo Modal States
  const [showBannerModal, setShowBannerModal] = useState(false);
  const [editingBanner, setEditingBanner] = useState<any | null>(null);
  const [bannerTitle, setBannerTitle] = useState('');
  const [bannerMessage, setBannerMessage] = useState('');
  const [bannerPeriod, setBannerPeriod] = useState('Berlaku s/d Akhir Bulan');

  // Voucher Modal States
  const [showAddVoucherModal, setShowAddVoucherModal] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<any | null>(null);
  const [newVouchCode, setNewVouchCode] = useState('');
  const [newVouchType, setNewVouchType] = useState('Nominal Potongan');
  const [newVouchVal, setNewVouchVal] = useState(10000);
  const [newVouchMinSpend, setNewVouchMinSpend] = useState(50000);
  const [newVouchMaxUsage, setNewVouchMaxUsage] = useState(100);
  const [newVouchValidUntil, setNewVouchValidUntil] = useState('31 Des 2026');

  // Point Rules States
  const [showSavePointRuleModal, setShowSavePointRuleModal] = useState(false);
  const [pointRuleNotes, setPointRuleNotes] = useState('Pembaruan aturan poin loyalty kasir');
  const [pointRuleSuccess, setPointRuleSuccess] = useState(false);
  const [pointRatio, setPointRatio] = useState(10000);
  const [pointValueRupiah, setPointValueRupiah] = useState(50);

  // PWA Point Rules States
  const [pwaWelcomePoints, setPwaWelcomePoints] = useState(100);
  const [pwaMultiplier, setPwaMultiplier] = useState(2);
  const [pwaRuleSavedMsg, setPwaRuleSavedMsg] = useState(false);

  // Banner Handlers
  const openAddBanner = () => {
    setEditingBanner(null);
    setBannerTitle('');
    setBannerMessage('');
    setBannerPeriod('Berlaku s/d Akhir Bulan');
    setShowBannerModal(true);
  };

  const openEditBanner = (b: any) => {
    setEditingBanner(b);
    setBannerTitle(b.title || '');
    setBannerMessage(b.message || '');
    setBannerPeriod(b.period || '');
    setShowBannerModal(true);
  };

  const handleSaveBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bannerTitle.trim() || !bannerMessage.trim()) return;
    if (editingBanner?.id) {
      await updatePromoBanner(editingBanner.id, {
        title: bannerTitle.trim(),
        message: bannerMessage.trim(),
        period: bannerPeriod.trim(),
        status: 'Aktif',
      });
    } else {
      await addPromoBanner({
        title: bannerTitle.trim(),
        message: bannerMessage.trim(),
        period: bannerPeriod.trim(),
        status: 'Aktif',
      });
    }
    setShowBannerModal(false);
    setEditingBanner(null);
  };

  // Voucher Handlers
  const openCreateVoucher = () => {
    setEditingVoucher(null);
    setNewVouchCode('');
    setNewVouchType('Nominal Potongan');
    setNewVouchVal(10000);
    setNewVouchMinSpend(50000);
    setNewVouchMaxUsage(100);
    setNewVouchValidUntil('31 Des 2026');
    setShowAddVoucherModal(true);
  };

  const openEditVoucher = (v: any) => {
    setEditingVoucher(v);
    setNewVouchCode(v.code || '');
    setNewVouchType(v.discountType || 'Nominal Potongan');
    setNewVouchVal(Number(v.discountValue || 0));
    setNewVouchMinSpend(Number(v.minSpend || 0));
    setNewVouchMaxUsage(Number(v.maxUsage || 100));
    setNewVouchValidUntil(v.validUntil || '');
    setShowAddVoucherModal(true);
  };

  const handleSaveVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVouchCode.trim()) return;
    if (editingVoucher?.id) {
      await updateVoucher(editingVoucher.id, {
        code: newVouchCode.trim().toUpperCase(),
        discountType: newVouchType,
        discountValue: Number(newVouchVal),
        minSpend: Number(newVouchMinSpend),
        maxUsage: Number(newVouchMaxUsage),
        validUntil: newVouchValidUntil,
      });
    } else {
      await addVoucher({
        code: newVouchCode.trim().toUpperCase(),
        discountType: newVouchType,
        discountValue: Number(newVouchVal),
        minSpend: Number(newVouchMinSpend),
        usageCount: 0,
        maxUsage: Number(newVouchMaxUsage),
        validUntil: newVouchValidUntil,
        status: 'active',
      });
    }
    setNewVouchCode('');
    setEditingVoucher(null);
    setShowAddVoucherModal(false);
  };

  const handleConfirmSavePointRule = async (e: React.FormEvent) => {
    e.preventDefault();
    await addPointRule({
      name: 'Aturan Poin POS Kasir',
      type: 'POS',
      pointRatio: Number(pointRatio),
      pointValueRupiah: Number(pointValueRupiah),
      notes: pointRuleNotes,
      updatedAtText: new Date().toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
    });
    setPointRuleSuccess(true);
    setTimeout(() => {
      setShowSavePointRuleModal(false);
      setPointRuleSuccess(false);
    }, 1500);
  };

  const handleSavePwaPointRule = async (e: React.FormEvent) => {
    e.preventDefault();
    await addPointRule({
      name: 'Bonus Poin Client PWA',
      type: 'PWA',
      pwaWelcomePoints: Number(pwaWelcomePoints),
      pwaMultiplier: Number(pwaMultiplier),
      notes: `Welcome +${pwaWelcomePoints} Poin, Multiplier ${pwaMultiplier}x`,
      updatedAtText: new Date().toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
    });
    setPwaRuleSavedMsg(true);
    setTimeout(() => setPwaRuleSavedMsg(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Target className="w-6 h-6 text-amber-400" />
          <h1 className="text-2xl font-black text-white tracking-tight">
            TEKNIK MARKETING &amp; PROMOSI
          </h1>
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          Program retensi pelanggan, hadiah target penjualan (Kejar Target PWA), kupon voucher promo, pengaturan loyalty poin POS &amp; PWA.
        </p>
      </div>

      {/* Sub-Tabs */}
      <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto w-full max-w-none mb-4">
        <button
          onClick={() => setActiveSub('hadiah_target')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'hadiah_target' ? 'bg-amber-600 text-zinc-950 shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Target className="w-3.5 h-3.5" />
          <span>Hadiah Target</span>
        </button>
        <button
          onClick={() => setActiveSub('informasi_hadiah')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'informasi_hadiah' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Megaphone className="w-3.5 h-3.5" />
          <span>Informasi &amp; Hadiah</span>
        </button>
        <button
          onClick={() => setActiveSub('voucher_promo')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'voucher_promo' ? 'bg-purple-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Ticket className="w-3.5 h-3.5" />
          <span>Voucher dan Promo</span>
        </button>
        <button
          onClick={() => setActiveSub('setting_poin')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'setting_poin' ? 'bg-amber-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Setting Poin</span>
        </button>
        <button
          onClick={() => setActiveSub('setting_poin_pwa')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'setting_poin_pwa' ? 'bg-emerald-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>Setting Poin PWA</span>
        </button>
        <button
          onClick={() => setActiveSub('statistik_marketing')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'statistik_marketing' ? 'bg-rose-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <BarChart2 className="w-3.5 h-3.5" />
          <span>Statistik Marketing</span>
        </button>
      </div>

      {/* ==================================================================== */}
      {/* VIEW: HADIAH TARGET (LIST OR FULL-PAGE ADD/EDIT PROMO TARGET)        */}
      {/* ==================================================================== */}
      {activeSub === 'hadiah_target' && (
        <>
          {isTargetFormPage ? (
            /* DEDICATED PAGE: ADD NEW TARGET PROMO (Layout matching targetPromo.jpg) */
            <form onSubmit={handleSubmitTargetPromo} className="space-y-4">
              {/* Top Bar Back & Page Title */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={closeTargetFormPage}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-amber-600/40 text-amber-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Kembali ke Daftar Target</span>
                  </button>
                  <h2 className="text-sm font-black text-white uppercase tracking-wider">
                    {editingTarget ? `Edit Promo Target: ${editingTarget.name || editingTarget.title}` : 'Buat Promo Hadiah Target Baru (Kejar Target PWA)'}
                  </h2>
                </div>
                <span className="text-[11px] text-amber-400/90 font-mono">
                  Sinkron Otomatis: PWA Kejar Target &rarr; Klaim Hadiah &rarr; Potong Stok Bonus
                </span>
              </div>

              {promoFeedbackMsg && (
                <div className="p-3 rounded-xl bg-rose-950/90 border border-rose-700 text-rose-200 text-xs font-bold flex items-center justify-between">
                  <span>{promoFeedbackMsg}</span>
                  <button
                    type="button"
                    onClick={() => setPromoFeedbackMsg(null)}
                    className="text-rose-300 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* 2-COLUMN LAYOUT MATCHING targetPromo.jpg */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
                {/* LEFT COLUMN (8 Cols): Form Input, Cari Produk, Tabel Produk, Bonus Target, Informasi Promo, Terbitkan */}
                <div className="xl:col-span-8 bg-[#12110f] border border-[#a36a2b]/80 rounded-xl p-6 space-y-5 shadow-2xl">
                  {/* Row 1: Nama Promo | Tanggal Mulai Promo | Tanggal Berakhir */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-200 mb-2">
                        Nama Promo
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Masukkan nama promo target..."
                        value={promoName}
                        onChange={(e) => setPromoName(e.target.value)}
                        className="w-full h-10 bg-[#1a1917] border border-zinc-700/80 focus:border-amber-500 rounded-lg px-3.5 py-2 text-xs leading-normal text-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-200 mb-2">
                        Tanggal Mulai Promo
                      </label>
                      <input
                        type="date"
                        required
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full h-10 bg-[#1a1917] border border-zinc-700/80 focus:border-amber-500 rounded-lg px-3.5 py-2 text-xs leading-normal text-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-200 mb-2">
                        Tanggal Berakhir
                      </label>
                      <input
                        type="date"
                        required
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full h-10 bg-[#1a1917] border border-zinc-700/80 focus:border-amber-500 rounded-lg px-3.5 py-2 text-xs leading-normal text-white focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Row 2: Cari Produk */}
                  <div className="relative">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-semibold text-zinc-200">
                        Cari Produk
                      </label>
                      {normalizedProducts.length > 0 && (
                        <span className="text-[10px] text-amber-400/90 font-mono">
                          Harga Modal &amp; Harga Jual otomatis terhubung ke /dashboard/produk
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Ketik nama produk atau klik untuk memilih dari katalog..."
                        value={productSearchQuery}
                        onFocus={() => setShowProductDropdown(true)}
                        onChange={(e) => {
                          setProductSearchQuery(e.target.value);
                          setShowProductDropdown(true);
                        }}
                        className="w-full h-10 bg-[#1a1917] border border-zinc-700/80 focus:border-amber-500 rounded-lg pl-3.5 pr-9 py-2 text-xs leading-normal text-white focus:outline-none"
                      />
                      <Search className="w-4 h-4 text-zinc-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>

                    {/* Quick-Select Product Chips from /dashboard/produk */}
                    {normalizedProducts.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-2">
                        <span className="text-[10px] text-zinc-400 mr-1">Tambah Cepat:</span>
                        {normalizedProducts.slice(0, 6).map((prod) => (
                          <button
                            key={prod.id}
                            type="button"
                            onClick={() => handleAddProductToPromo(prod)}
                            className="px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-amber-500/20 border border-amber-500/30 text-[11px] text-amber-200 font-semibold transition cursor-pointer flex items-center gap-1"
                          >
                            <Plus className="w-3 h-3 text-amber-400" />
                            <span>{prod.name}</span>
                            <span className="text-[10px] font-mono text-zinc-400">
                              (Rp. {prod.sellingPrice.toLocaleString('id-ID')})
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Live Dropdown List from Firestore `products` */}
                    {showProductDropdown && (
                      <div className="absolute z-30 left-0 right-0 mt-1 bg-[#181715] border border-amber-500/50 rounded-xl shadow-2xl max-h-60 overflow-y-auto divide-y divide-zinc-800">
                        <div className="px-3 py-1.5 bg-zinc-950 flex items-center justify-between text-[10px] text-zinc-400">
                          <span>Klik produk dari database untuk dimasukkan ke tabel promo:</span>
                          <button
                            type="button"
                            onClick={() => setShowProductDropdown(false)}
                            className="text-amber-400 hover:underline font-bold cursor-pointer"
                          >
                            Tutup
                          </button>
                        </div>
                        {filteredSearchProducts.length === 0 ? (
                          <div className="p-3 text-xs text-zinc-500 text-center">
                            Produk tidak ditemukan di database.
                          </div>
                        ) : (
                          filteredSearchProducts.map((prod) => (
                            <button
                              key={prod.id}
                              type="button"
                              onClick={() => handleAddProductToPromo(prod)}
                              className="w-full px-3.5 py-2.5 text-left hover:bg-amber-500/15 transition flex items-center justify-between gap-3 text-xs cursor-pointer"
                            >
                              <div>
                                <span className="font-bold text-white block">{prod.name}</span>
                                <span className="text-[10px] font-mono text-zinc-400">
                                  SKU: {prod.sku} &bull; Stok: {prod.stock} Karton
                                </span>
                              </div>
                              <div className="text-right font-mono">
                                <span className="text-[11px] text-zinc-400 block">
                                  Modal: Rp. {prod.costPrice.toLocaleString('id-ID')}
                                </span>
                                <span className="text-xs font-bold text-amber-400">
                                  Jual: Rp. {prod.sellingPrice.toLocaleString('id-ID')}
                                </span>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Row 3: Main Product Table */}
                  <div className="bg-[#181715] border border-zinc-700/70 rounded-lg overflow-hidden min-h-[230px] flex flex-col justify-between">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#22201d] border-b border-zinc-700/80 text-zinc-200 font-bold">
                          <tr>
                            <th className="py-3 px-4">PRODUK</th>
                            <th className="py-3 px-3">Harga Modal</th>
                            <th className="py-3 px-3">Harga Jual</th>
                            <th className="py-3 px-3">Harga Promo</th>
                            <th className="py-3 px-3">Total Pembelian</th>
                            <th className="py-3 px-4 text-right">Total Untung</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/70">
                          {promoCalculation.rows.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="py-16 text-center text-zinc-500 text-xs">
                                Cari atau klik tombol Tambah Cepat produk di atas untuk mulai menghitung otomatis.
                              </td>
                            </tr>
                          ) : (
                            promoCalculation.rows.map((row) => (
                              <tr key={row.productId} className="hover:bg-zinc-900/50 transition">
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleRemovePromoProduct(row.productId)}
                                      title="Hapus produk dari promo"
                                      className="p-1 rounded bg-rose-950/60 hover:bg-rose-900 text-rose-300 cursor-pointer shrink-0"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                    <div>
                                      <span className="font-bold text-white block">{row.productName}</span>
                                      <span className="text-[10px] font-mono text-zinc-400">
                                        {row.productSku} &bull; Target: {row.targetQty} Karton
                                      </span>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3 px-3 font-mono text-zinc-300">
                                  <div className="flex items-center bg-[#12110f] border border-zinc-700/80 rounded-lg px-2 py-1.5 max-w-[135px]">
                                    <span className="text-[11px] font-mono text-zinc-400 mr-1">Rp.</span>
                                    <input
                                      type="number"
                                      min={0}
                                      value={row.costPrice}
                                      onChange={(e) =>
                                        handleChangeCostPrice(row.productId, Number(e.target.value))
                                      }
                                      className="w-full bg-transparent text-zinc-200 font-mono text-xs focus:outline-none"
                                    />
                                  </div>
                                </td>
                                <td className="py-3 px-3 font-mono text-zinc-300">
                                  Rp. {row.sellingPrice.toLocaleString('id-ID')}
                                </td>
                                <td className="py-3 px-3">
                                  <div className="flex items-center bg-[#12110f] border border-amber-500/50 rounded-lg px-2 py-1.5 max-w-[140px]">
                                    <span className="text-[11px] font-mono text-zinc-400 mr-1">Rp.</span>
                                    <input
                                      type="number"
                                      min={0}
                                      value={row.promoPrice}
                                      onChange={(e) =>
                                        handleChangePromoPrice(row.productId, Number(e.target.value))
                                      }
                                      className="w-full bg-transparent text-amber-300 font-mono font-bold text-xs focus:outline-none"
                                    />
                                  </div>
                                </td>
                                <td className="py-3 px-3 font-mono font-bold text-white">
                                  Rp. {row.totalPembelian.toLocaleString('id-ID')}
                                </td>
                                <td
                                  className={`py-3 px-4 font-mono font-bold text-right ${
                                    row.totalUntung >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                  }`}
                                >
                                  Rp. {row.totalUntung.toLocaleString('id-ID')}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Row 4: Bonus Target | Jumlah Bonus */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-200 mb-2">
                        Target Bonus
                      </label>
                      <select
                        value={bonusProductId || selectedBonusProduct?.id || ''}
                        onChange={(e) => {
                          const nextId = e.target.value;
                          setBonusProductId(nextId);
                          if (nextId && promoItems.length === 0) {
                            const found = normalizedProducts.find((p) => p.id === nextId);
                            if (found) {
                              handleAddProductToPromo(found);
                            }
                          }
                        }}
                        className="w-full h-10 bg-[#1a1917] border border-zinc-700/80 focus:border-amber-500 rounded-lg px-3.5 py-2 text-xs leading-normal text-white focus:outline-none"
                      >
                        <option value="">Pilih produk bonus</option>
                        {normalizedProducts.map((prod) => (
                          <option key={prod.id} value={prod.id}>
                            {prod.name} (Modal: Rp. {prod.costPrice.toLocaleString('id-ID')} | Stok: {prod.stock} Karton)
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-200 mb-2">
                        Jumlah Bonus
                      </label>
                      <input
                        type="number"
                        min={1}
                        required
                        value={bonusQty}
                        onChange={(e) => setBonusQty(Math.max(1, Number(e.target.value || 1)))}
                        className="w-full h-10 bg-[#1a1917] border border-zinc-700/80 focus:border-amber-500 rounded-lg px-3.5 py-2 text-xs leading-normal text-white font-mono font-bold focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Row 5: Informasi Promo */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-200 mb-2">
                      Informasi Promo
                    </label>
                    <input
                      type="text"
                      placeholder="Contoh: Kejar target pembelian karton selama periode promo dan klaim bonus produk gratis!"
                      value={promoInfo}
                      onChange={(e) => setPromoInfo(e.target.value)}
                      className="w-full h-10 bg-[#1a1917] border border-zinc-700/80 focus:border-amber-500 rounded-lg px-3.5 py-2 text-xs leading-normal text-white focus:outline-none"
                    />
                  </div>

                  {/* Row 6: Terbitkan Toggle Bar (Ya | Draf Saja) */}
                  <div className="bg-[#1a1917] border border-zinc-700/80 rounded-lg px-4 py-2.5 flex items-center justify-between">
                    <span className="text-xs font-bold text-white">Terbitkan</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsPublished(true)}
                        className={`px-5 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
                          isPublished
                            ? 'bg-[#f59e0b] text-zinc-950 shadow-sm'
                            : 'bg-[#262522] text-zinc-400 hover:text-white'
                        }`}
                      >
                        Ya
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsPublished(false)}
                        className={`px-4 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
                          !isPublished
                            ? 'bg-[#f59e0b] text-zinc-950 shadow-sm'
                            : 'bg-[#262522] text-zinc-300 hover:text-white'
                        }`}
                      >
                        Draf Saja
                      </button>
                    </div>
                  </div>
                </div>

                {/* RIGHT COLUMN (4 Cols): Kalkulasi Panel & Submit Promo Button */}
                <div className="xl:col-span-4 bg-[#12110f] border border-[#a36a2b]/80 rounded-xl p-6 flex flex-col justify-between shadow-2xl">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-white">Kalkulasi</h3>
                      <span className="text-[10px] font-mono text-amber-400 bg-amber-950/40 border border-amber-500/30 px-2 py-0.5 rounded">
                        Otomatis Real-Time
                      </span>
                    </div>

                    <div className="bg-[#181715] border border-zinc-700/70 rounded-lg overflow-hidden flex flex-col justify-between min-h-[380px]">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-[#22201d] border-b border-zinc-700/80 text-zinc-200 font-bold">
                            <tr>
                              <th className="py-3 px-3.5">Produk</th>
                              <th className="py-3 px-2.5 text-center">Target (Jumlah)</th>
                              <th className="py-3 px-3.5 text-right">Total Belanja</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-800/70">
                            {promoCalculation.rows.length === 0 ? (
                              <tr>
                                <td colSpan={3} className="py-16 text-center text-zinc-500 text-xs">
                                  Belum ada produk dipilih
                                </td>
                              </tr>
                            ) : (
                              promoCalculation.rows.map((row) => (
                                <tr key={row.productId}>
                                  <td className="py-2.5 px-3.5 font-semibold text-white">
                                    <span className="block">{row.productName}</span>
                                    <span className="text-[10px] font-mono text-zinc-400">
                                      @ Rp. {row.promoPrice.toLocaleString('id-ID')}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-2.5 text-center">
                                    <input
                                      type="number"
                                      min={1}
                                      value={row.targetQty}
                                      onChange={(e) =>
                                        handleChangeTargetQty(row.productId, Number(e.target.value))
                                      }
                                      className="w-16 h-8 bg-[#12110f] border border-amber-500/50 rounded-md px-2 py-1 text-center font-mono font-bold text-amber-300 text-xs leading-normal focus:outline-none"
                                    />
                                  </td>
                                  <td className="py-2.5 px-3.5 text-right font-mono font-bold text-white">
                                    Rp. {row.totalPembelian.toLocaleString('id-ID')}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Bottom Summary Lines inside Kalkulasi Box */}
                      <div className="p-4 border-t border-zinc-800 bg-[#151412] space-y-2.5 text-xs">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-bold text-zinc-200 block">Grand Total Belanja</span>
                            <span className="text-[10px] font-mono text-zinc-400">
                              Total Target: {promoCalculation.totalTargetQty} Karton
                            </span>
                          </div>
                          <span className="font-mono font-bold text-white text-sm">
                            Rp. {promoCalculation.grandTotalBelanja.toLocaleString('id-ID')}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-bold text-zinc-200 block">Total Harga Modal Bonus</span>
                            <span className="text-[10px] font-mono text-zinc-400">
                              {selectedBonusProduct
                                ? `${promoCalculation.effectiveBonusQty}x ${selectedBonusProduct.name} (@ Rp. ${promoCalculation.bonusUnitCost.toLocaleString('id-ID')})`
                                : `Modal Bonus × ${promoCalculation.effectiveBonusQty}`}
                            </span>
                          </div>
                          <span className="font-mono font-bold text-amber-300 text-sm">
                            Rp. {promoCalculation.totalHargaModalBonus.toLocaleString('id-ID')}
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80">
                          <div>
                            <span className="font-bold text-zinc-100 block">Grand Total Untung</span>
                            <span className="text-[10px] font-mono text-zinc-400">
                              Untung Produk (Rp. {promoCalculation.totalGrossProfitRows.toLocaleString('id-ID')}) - Modal Bonus
                            </span>
                          </div>
                          <span
                            className={`font-mono font-black text-sm ${
                              promoCalculation.grandTotalUntung >= 0
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          >
                            Rp. {promoCalculation.grandTotalUntung.toLocaleString('id-ID')}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Submit Promo Button */}
                  <div className="pt-5">
                    <button
                      type="submit"
                      disabled={isSubmittingPromo}
                      className="w-full py-3 rounded-lg font-bold text-xs text-white transition cursor-pointer disabled:opacity-50 shadow-lg"
                      style={{
                        background: 'linear-gradient(90deg, #7c4d22 0%, #a36a2b 50%, #7c4d22 100%)',
                        border: '1px solid rgba(245, 158, 11, 0.45)',
                      }}
                    >
                      {isSubmittingPromo ? 'Menyimpan Promo Target...' : 'Submit Promo'}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          ) : (
            /* LIST VIEW: DAFTAR PROGRAM HADIAH TARGET */
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Program Target Belanja &amp; Kejar Target Client PWA
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Promo yang diterbitkan otomatis muncul di halaman <code className="text-amber-300">/client-pwa/profile/target</code> (Kejar Target) berbentuk Card &amp; Progress Bar.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openAddTarget}
                  className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-black transition flex items-center gap-1.5 cursor-pointer shadow-md shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add New Target</span>
                </button>
              </div>

              {targets.length === 0 ? (
                <div className="p-10 bg-zinc-900 border border-dashed border-zinc-800 rounded-2xl text-center space-y-3">
                  <Target className="w-8 h-8 text-amber-400 mx-auto opacity-80" />
                  <p className="text-xs text-zinc-400">
                    Belum ada program hadiah target. Klik tombol <strong>&quot;Add New Target&quot;</strong> untuk membuat promo target produk beserta kalkulasi untung &amp; produk bonus.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {targets.map((tgt) => {
                    const promoTitle = tgt.name || tgt.title || 'Promo Target';
                    const promoPeriod =
                      tgt.startDate && tgt.endDate
                        ? `${tgt.startDate} s/d ${tgt.endDate}`
                        : tgt.period || 'Periode Aktif';
                    const isPub = tgt.published !== false && tgt.status !== 'draft';
                    const itemsList = Array.isArray(tgt.items) ? tgt.items : [];
                    const grandBelanja = Number(
                      tgt.grandTotalBelanja ?? tgt.minPurchaseAmount ?? 0
                    );
                    const modalBonus = Number(tgt.totalHargaModalBonus ?? tgt.rewardValue ?? 0);
                    const grandUntung = Number(tgt.grandTotalUntung ?? 0);
                    const bonusLabel =
                      tgt.bonusProductName
                        ? `${tgt.bonusQty || 1} Karton ${tgt.bonusProductName}`
                        : tgt.rewardName || tgt.reward || '-';

                    return (
                      <div
                        key={tgt.id}
                        className="bg-[#12110f] border border-[#a36a2b]/60 rounded-2xl p-5 space-y-4 shadow-lg"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                                  isPub
                                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700'
                                    : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                                }`}
                              >
                                {isPub ? 'Diterbitkan di PWA' : 'Draf Saja'}
                              </span>
                              <span className="text-[10px] font-mono text-amber-300 bg-amber-950/60 border border-amber-700/50 px-2 py-0.5 rounded">
                                {promoPeriod}
                              </span>
                            </div>
                            <h3 className="font-black text-white text-base pt-1">{promoTitle}</h3>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-xs font-mono font-bold text-emerald-400 mr-1">
                              {tgt.currentAchievers || 0} Klaim
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setDetailItem({
                                  title: `Detail Promo: ${promoTitle}`,
                                  data: {
                                    'Nama Promo': promoTitle,
                                    Periode: promoPeriod,
                                    Status: isPub ? 'Diterbitkan (Aktif di PWA)' : 'Draf Saja',
                                    'Target Produk':
                                      itemsList.length > 0
                                        ? itemsList
                                            .map(
                                              (i: any) =>
                                                `${i.productName} (${i.targetQty} Karton @ Rp ${Number(
                                                  i.promoPrice || 0
                                                ).toLocaleString('id-ID')})`
                                            )
                                            .join(', ')
                                        : '-',
                                    'Bonus Target': bonusLabel,
                                    'Grand Total Belanja': `Rp ${grandBelanja.toLocaleString('id-ID')}`,
                                    'Total Harga Modal Bonus': `Rp ${modalBonus.toLocaleString('id-ID')}`,
                                    'Grand Total Untung': `Rp ${grandUntung.toLocaleString('id-ID')}`,
                                    'Informasi Promo': tgt.promoInfo || '-',
                                  },
                                })
                              }
                              title="Lihat Detail"
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditTarget(tgt)}
                              title="Edit Promo Target"
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (tgt.id) {
                                  await deleteTarget(tgt.id).catch(() => {});
                                  await deleteRewardTargetHook(tgt.id).catch(() => {});
                                  await deleteRewardTargetUnified(tgt.id);
                                  const remaining = targets.filter((t) => t.id !== tgt.id);
                                  await syncTargetsToPwaConfig(remaining);
                                  setLocalTargetTick((n) => n + 1);
                                }
                              }}
                              title="Hapus Promo Target"
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Product Target Rows Preview */}
                        {itemsList.length > 0 && (
                          <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl overflow-hidden">
                            <table className="w-full text-left text-[11px]">
                              <thead className="bg-zinc-900 text-zinc-400 border-b border-zinc-800">
                                <tr>
                                  <th className="py-2 px-3">Produk Target</th>
                                  <th className="py-2 px-2 text-center">Target(Qty)</th>
                                  <th className="py-2 px-2 text-right">Harga Promo</th>
                                  <th className="py-2 px-3 text-right">Total Belanja</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                                {itemsList.map((it: any, idx: number) => (
                                  <tr key={it.productId || idx}>
                                    <td className="py-2 px-3 font-bold text-white">{it.productName}</td>
                                    <td className="py-2 px-2 text-center font-mono text-amber-300 font-bold">
                                      {it.targetQty} Karton
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono">
                                      Rp. {Number(it.promoPrice || 0).toLocaleString('id-ID')}
                                    </td>
                                    <td className="py-2 px-3 text-right font-mono font-bold text-white">
                                      Rp. {Number(it.totalPurchase ?? Number(it.promoPrice || 0) * Number(it.targetQty || 0)).toLocaleString('id-ID')}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Bonus & Financial Summary */}
                        <div className="p-3 bg-amber-950/20 rounded-xl border border-amber-500/30 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-amber-300 font-bold">
                            <Gift className="w-4 h-4 shrink-0 text-amber-400" />
                            <span>Bonus Target: {bonusLabel}</span>
                          </div>
                          <span className="font-mono text-[11px] text-zinc-400">
                            Modal Bonus: <strong className="text-amber-300">Rp. {modalBonus.toLocaleString('id-ID')}</strong>
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 pt-1 text-[11px]">
                          <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                            <span className="text-zinc-400 block">Grand Total Belanja</span>
                            <span className="font-mono font-bold text-white">
                              Rp. {grandBelanja.toLocaleString('id-ID')}
                            </span>
                          </div>
                          <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                            <span className="text-zinc-400 block">Total Modal Bonus</span>
                            <span className="font-mono font-bold text-amber-300">
                              Rp. {modalBonus.toLocaleString('id-ID')}
                            </span>
                          </div>
                          <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                            <span className="text-zinc-400 block">Grand Total Untung</span>
                            <span
                              className={`font-mono font-bold ${
                                grandUntung >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              Rp. {grandUntung.toLocaleString('id-ID')}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* VIEW: INFORMASI & HADIAH */}
      {activeSub === 'informasi_hadiah' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
            <div>
              <h3 className="font-bold text-white text-base">Banner Informasi Promo di Client PWA</h3>
              <p className="text-xs text-zinc-400">Pemberitahuan pop-up &amp; pengumuman hadiah yang tampil di aplikasi pelanggan Client PWA.</p>
            </div>
            <button
              onClick={openAddBanner}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>+ Buat Banner Informasi</span>
            </button>
          </div>

          {promoBanners.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-zinc-800 rounded-xl text-xs text-zinc-500">
              Belum ada banner promosi aktif. Klik &quot;+ Buat Banner Informasi&quot; untuk menampilkan pengumuman di Client PWA.
            </div>
          ) : (
            <div className="space-y-3">
              {promoBanners.map((b) => (
                <div
                  key={b.id}
                  className="p-4 bg-blue-950/20 border border-blue-900/40 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-blue-300 text-sm">{b.title}</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-bold">
                        {b.period || 'Aktif'}
                      </span>
                    </div>
                    <p className="text-white font-medium">&quot;{b.message}&quot;</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setDetailItem({
                          title: 'Detail Banner Promo PWA',
                          data: {
                            Judul: b.title,
                            Pesan: b.message,
                            Periode: b.period || 'Aktif',
                            Status: b.status || 'Aktif',
                          },
                        })
                      }
                      title="Lihat Detail"
                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditBanner(b)}
                      title="Edit Banner"
                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (b.id) await deletePromoBanner(b.id);
                      }}
                      title="Hapus Banner"
                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW: VOUCHER DAN PROMO */}
      {activeSub === 'voucher_promo' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Kupon Kode Promo Aktif
            </h3>
            <button
              onClick={openCreateVoucher}
              className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Buat Kupon Baru</span>
            </button>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Kode Kupon</th>
                  <th className="py-3 px-4">Tipe Potongan</th>
                  <th className="py-3 px-4">Nilai Diskon</th>
                  <th className="py-3 px-4">Min. Belanja</th>
                  <th className="py-3 px-4 text-center">Penggunaan</th>
                  <th className="py-3 px-4">Berlaku Sampai</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {vouchers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-zinc-500">
                      Belum ada kupon promo terdaftar. Klik &quot;Buat Kupon Baru&quot; untuk menambahkan voucher.
                    </td>
                  </tr>
                ) : (
                  vouchers.map((v) => (
                    <tr key={v.id} className="hover:bg-zinc-800/40">
                      <td className="py-3 px-4 font-mono font-black text-purple-400 text-sm">{v.code}</td>
                      <td className="py-3 px-4 font-medium text-white">{v.discountType}</td>
                      <td className="py-3 px-4 font-mono font-bold text-emerald-400">
                        {(v.discountType || '').includes('Persen')
                          ? `${v.discountValue}%`
                          : `Rp ${Number(v.discountValue || 0).toLocaleString('id-ID')}`}
                      </td>
                      <td className="py-3 px-4 font-mono text-zinc-300">
                        Rp {Number(v.minSpend || 0).toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-4 text-center font-mono">
                        {v.usageCount || 0} / {v.maxUsage || 100}
                      </td>
                      <td className="py-3 px-4 text-zinc-400">{v.validUntil}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setDetailItem({
                                title: `Detail Voucher ${v.code}`,
                                data: {
                                  'Kode Voucher': v.code,
                                  'Tipe Potongan': v.discountType,
                                  'Nilai Diskon': (v.discountType || '').includes('Persen')
                                    ? `${v.discountValue}%`
                                    : `Rp ${Number(v.discountValue || 0).toLocaleString('id-ID')}`,
                                  'Minimum Belanja': `Rp ${Number(v.minSpend || 0).toLocaleString('id-ID')}`,
                                  'Kuota Pemakaian': `${v.usageCount || 0} dari ${v.maxUsage || 100}`,
                                  'Berlaku Sampai': v.validUntil,
                                },
                              })
                            }
                            title="Lihat Detail"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditVoucher(v)}
                            title="Edit Kupon"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (v.id) await deleteVoucher(v.id);
                            }}
                            title="Hapus Kupon"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW: SETTING POIN */}
      {activeSub === 'setting_poin' && (
        <div className="space-y-6">
          <div className="w-full max-w-none bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
            <h3 className="font-bold text-white text-base">Aturan Perhitungan Poin Kasir POS</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Setiap Belanja Kelipatan (Rp):</label>
                <input
                  type="number"
                  value={pointRatio}
                  onChange={(e) => setPointRatio(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold"
                />
                <span className="text-[10px] text-zinc-500">Mendapatkan 1 Poin loyalitas di struk POS.</span>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Nilai Tukar 1 Poin (Rp Rupiah):</label>
                <input
                  type="number"
                  value={pointValueRupiah}
                  onChange={(e) => setPointValueRupiah(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold"
                />
              </div>
              <button
                onClick={() => setShowSavePointRuleModal(true)}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold transition cursor-pointer"
              >
                Simpan Konfigurasi Poin
              </button>
            </div>
          </div>

          {pointRules.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="p-4 border-b border-zinc-800">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Riwayat Kebijakan Poin Tersimpan</h4>
              </div>
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4">Nama Kebijakan</th>
                    <th className="py-3 px-4">Detail Aturan</th>
                    <th className="py-3 px-4">Tanggal Update</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {pointRules.map((pr: any) => (
                    <tr key={pr.id} className="hover:bg-zinc-800/40">
                      <td className="py-3 px-4 font-bold text-white">{pr.name || 'Aturan Poin'}</td>
                      <td className="py-3 px-4 text-zinc-300">{pr.notes || `Rp ${pr.pointRatio} = 1 Poin`}</td>
                      <td className="py-3 px-4 text-zinc-400">{pr.updatedAtText || '-'}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setDetailItem({
                                title: pr.name || 'Detail Aturan Poin',
                                data: {
                                  Nama: pr.name,
                                  Catatan: pr.notes,
                                  'Tanggal Update': pr.updatedAtText || '-',
                                },
                              })
                            }
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (pr.id) await deletePointRule(pr.id);
                            }}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VIEW: SETTING POIN PWA */}
      {activeSub === 'setting_poin_pwa' && (
        <div className="w-full max-w-none bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
          <h3 className="font-bold text-white text-base">Bonus Poin Khusus Client PWA</h3>
          <p className="text-xs text-zinc-400">Tingkatkan adopsi aplikasi web PWA dengan reward berlipat bagi pelanggan mandiri.</p>
          <form onSubmit={handleSavePwaPointRule} className="space-y-4 text-xs">
            <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 space-y-2">
              <label className="font-bold text-white block">
                Poin Sambutan (Install &amp; Login PWA Pertama Kali)
              </label>
              <input
                type="number"
                min={0}
                value={pwaWelcomePoints}
                onChange={(e) => setPwaWelcomePoints(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-emerald-400 font-mono font-bold"
              />
              <span className="text-[11px] text-zinc-500 block">
                Bonus poin otomatis saat pelanggan verifikasi nomor handphone di PWA.
              </span>
            </div>

            <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 space-y-2">
              <label className="font-bold text-white block">
                Pengganda Poin PWA (Multiplier Order Mandiri)
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={pwaMultiplier}
                onChange={(e) => setPwaMultiplier(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-purple-400 font-mono font-bold"
              />
              <span className="text-[11px] text-zinc-500 block">
                Kelipatan poin bagi pelanggan yang memesan mandiri lewat Client PWA.
              </span>
            </div>

            {pwaRuleSavedMsg && (
              <div className="p-3 bg-emerald-950 border border-emerald-800 text-emerald-300 rounded-xl font-bold flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span>Pengaturan Bonus Poin PWA berhasil disimpan ke Firestore!</span>
              </div>
            )}

            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition cursor-pointer"
            >
              Simpan Bonus Poin PWA
            </button>
          </form>
        </div>
      )}

      {/* VIEW: STATISTIK MARKETING */}
      {activeSub === 'statistik_marketing' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl">
            <span className="text-zinc-500 block text-[10px] font-bold uppercase">Total Penggunaan Kupon Promo</span>
            <span className="text-2xl font-mono font-black text-purple-400 mt-1 block">
              {vouchers.reduce((acc, v) => acc + Number(v.usageCount || 0), 0)} Klaim
            </span>
            <span className="text-emerald-400 text-[11px] font-bold flex items-center gap-1 mt-1">
              <TrendingUp className="w-3 h-3" />
              {vouchers.length} Kupon Aktif Terdaftar
            </span>
          </div>

          <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl">
            <span className="text-zinc-500 block text-[10px] font-bold uppercase">Total Poin Pelanggan Aktif</span>
            <span className="text-2xl font-mono font-black text-amber-400 mt-1 block">
              {customersList.reduce((acc, c) => acc + Number(c.points || 0), 0).toLocaleString('id-ID')} Poin
            </span>
            <span className="text-zinc-400 text-[11px] mt-1 block">Akumulasi poin seluruh member</span>
          </div>

          <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl">
            <span className="text-zinc-500 block text-[10px] font-bold uppercase">Total Pelanggan Terdaftar</span>
            <span className="text-2xl font-mono font-black text-white mt-1 block">
              {customersList.length} Member
            </span>
            <span className="text-zinc-400 text-[11px] mt-1 block">Data real-time dari direktori pelanggan</span>
          </div>
        </div>
      )}

      {/* Modal: Detail Item */}
      {detailItem && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-white">{detailItem.title}</h3>
              <button
                onClick={() => setDetailItem(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2.5 text-xs">
              {Object.entries(detailItem.data).map(([k, val]) => (
                <div key={k} className="flex justify-between py-1.5 border-b border-zinc-800/60 gap-4">
                  <span className="text-zinc-400">{k}:</span>
                  <span className="font-bold text-white text-right">{String(val ?? '-')}</span>
                </div>
              ))}
            </div>
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setDetailItem(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Tambah / Edit Banner Informasi */}
      {showBannerModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-white">
                {editingBanner ? 'Edit Banner Informasi PWA' : 'Buat Banner Informasi PWA'}
              </h3>
              <button
                onClick={() => setShowBannerModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveBanner} className="space-y-4 pt-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Judul Kampanye / Promo *</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Gebyar Grosir Akhir Pekan"
                  value={bannerTitle}
                  onChange={(e) => setBannerTitle(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Isi Pesan Banner di Client PWA *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Diskon Grosir Dus Indomie & Le Minerale! Belanja minimal 3 karton gratis ongkir."
                  value={bannerMessage}
                  onChange={(e) => setBannerMessage(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Keterangan Periode</label>
                <input
                  type="text"
                  value={bannerPeriod}
                  onChange={(e) => setBannerPeriod(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowBannerModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold cursor-pointer"
                >
                  Simpan Banner
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Buat / Edit Kupon Baru */}
      {showAddVoucherModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Ticket className="w-5 h-5 text-purple-400" />
                <h3 className="text-base font-bold text-white">
                  {editingVoucher ? 'Edit Kupon Promo' : 'Buat Kupon Promo Baru'}
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowAddVoucherModal(false);
                  setEditingVoucher(null);
                }}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveVoucher} className="space-y-4 pt-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Kode Kupon / Promo *</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: BERKAH10 / JUMATHEMAT"
                  value={newVouchCode}
                  onChange={(e) => setNewVouchCode(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono uppercase tracking-wider font-bold focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Tipe Potongan</label>
                  <select
                    value={newVouchType}
                    onChange={(e) => setNewVouchType(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="Nominal Potongan">Nominal Potongan (Rp)</option>
                    <option value="Persentase Diskon">Persentase Diskon (%)</option>
                    <option value="Gratis Ongkir Dus">Gratis Ongkir Dus</option>
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Nilai Potongan</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={newVouchVal}
                    onChange={(e) => setNewVouchVal(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Min. Belanja (Rp)</label>
                  <input
                    type="number"
                    required
                    min={0}
                    step={5000}
                    value={newVouchMinSpend}
                    onChange={(e) => setNewVouchMinSpend(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Batas Kuota Pemakaian</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={newVouchMaxUsage}
                    onChange={(e) => setNewVouchMaxUsage(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Berlaku Sampai Tanggal</label>
                <input
                  type="text"
                  placeholder="31 Des 2026"
                  value={newVouchValidUntil}
                  onChange={(e) => setNewVouchValidUntil(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddVoucherModal(false);
                    setEditingVoucher(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold transition shadow-lg cursor-pointer"
                >
                  {editingVoucher ? 'Simpan Perubahan' : 'Terbitkan Kupon'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Simpan Aturan Poin */}
      {showSavePointRuleModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Save className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Simpan Aturan Poin Loyalitas</h3>
              </div>
              <button
                onClick={() => setShowSavePointRuleModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleConfirmSavePointRule} className="space-y-4 pt-4 text-xs">
              <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400">Rasio Belanja per Poin:</span>
                  <span className="font-mono font-bold text-white">Rp {pointRatio.toLocaleString('id-ID')} = 1 Poin</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400">Nilai Tukar 1 Poin:</span>
                  <span className="font-mono font-bold text-emerald-400">Rp {pointValueRupiah.toLocaleString('id-ID')}</span>
                </div>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Catatan Pembaruan Kebijakan Toko</label>
                <input
                  type="text"
                  required
                  value={pointRuleNotes}
                  onChange={(e) => setPointRuleNotes(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              {pointRuleSuccess && (
                <div className="p-3 bg-emerald-950 border border-emerald-800 text-emerald-300 rounded-xl text-xs font-bold flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span>Aturan poin loyalitas berhasil disimpan dan disinkronkan ke Cloud Firestore!</span>
                </div>
              )}

              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowSavePointRuleModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold transition shadow-lg cursor-pointer"
                >
                  Simpan ke Firestore
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
