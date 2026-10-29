import React, { useState, useEffect, useMemo } from 'react';
import {
  doc,
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import {
  Sparkles,
  Database,
  Cpu,
  RefreshCw,
  Search,
  CheckCircle,
  AlertTriangle,
  Plus,
  Send,
  Layers,
  GitMerge,
  Code2,
  SlidersHorizontal,
  ArrowRight,
  Trash2,
  Edit2,
  X,
  Receipt,
  Award,
  Calculator,
  Wallet,
} from 'lucide-react';
import { db } from '../../firebase';
import { ACTIVE_STORE_ID } from '../../config/store';
import { useAppData } from '../../context/AppDataContext';
import { useLanguage } from '../../context/LanguageContext';
import { formatMoney } from '../../utils/money';
import {
  AICustomPageSchema,
  AICustomCrudField,
  getLocalMenuStructure,
} from '../../services/sidebarMenuService';

export function toSafeHref(url?: string): string {
  if (!url) return '#';
  const trimmed = url.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return '#';
  }
  return '#';
}

interface DynamicCustomPageProps {
  slug?: string;
  previewSchema?: AICustomPageSchema | null;
}

export const DynamicCustomPage: React.FC<DynamicCustomPageProps> = ({
  slug,
  previewSchema,
}) => {
  const {
    products,
    transactions,
    orders,
    customers,
    staff,
    shifts,
    cashLogs,
    executeEcosystemWriteAction,
  } = useAppData();
  const { currencyMode } = useLanguage();

  const [schema, setSchema] = useState<AICustomPageSchema | null>(previewSchema || null);
  const [loadingSchema, setLoadingSchema] = useState<boolean>(!previewSchema);
  const [searchQuery, setSearchQuery] = useState('');
  const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showLogicBlueprint, setShowLogicBlueprint] = useState(false);

  // Auto-Provisioned Custom Firestore Collection (`ext_{slug}`) real-time records
  const [customRecords, setCustomRecords] = useState<any[]>([]);
  const [loadingCustomCollection, setLoadingCustomCollection] = useState(false);

  // Auto-Generated CRUD Modal State ("+ Tambah Data" / Edit)
  const [isCrudModalOpen, setIsCrudModalOpen] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [crudFormValues, setCrudFormValues] = useState<Record<string, any>>({});
  const [syncToCashReport, setSyncToCashReport] = useState<boolean>(true);
  const [isSubmittingCrud, setIsSubmittingCrud] = useState(false);

  // Quick Ecosystem Two-Way Action Form state
  const [actionType, setActionType] = useState<
    | 'restock_product'
    | 'deduct_stock'
    | 'add_cash_in'
    | 'add_cash_out'
    | 'update_product_price'
    | 'update_order_status'
  >('restock_product');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [actionQty, setActionQty] = useState<number>(5);
  const [actionAmount, setActionAmount] = useState<number>(250000);
  const [actionDescription, setActionDescription] = useState('');
  const [actionCategory, setActionCategory] = useState('Operasional Halaman AI');
  const [actionOrderStatus, setActionOrderStatus] = useState('completed');
  const [submittingAction, setSubmittingAction] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // 1. Load Page Schema from previewSchema, localStorage, or Firestore `custom_pages/{slug}`
  useEffect(() => {
    if (previewSchema) {
      setSchema(previewSchema);
      setLoadingSchema(false);
      if (previewSchema.actionForm?.defaultActionType) {
        setActionType(previewSchema.actionForm.defaultActionType);
      }
      return;
    }

    if (!slug) {
      setLoadingSchema(false);
      return;
    }

    const localStruct = getLocalMenuStructure();
    if (localStruct.customPages && localStruct.customPages[slug]) {
      const found = localStruct.customPages[slug];
      setSchema(found);
      if (found.actionForm?.defaultActionType) {
        setActionType(found.actionForm.defaultActionType);
      }
      setLoadingSchema(false);
    }

    const unsub = onSnapshot(
      doc(db, 'custom_pages', slug),
      (snap) => {
        if (snap.exists()) {
          const remoteSchema = snap.data() as AICustomPageSchema;
          setSchema(remoteSchema);
          if (remoteSchema.actionForm?.defaultActionType) {
            setActionType(remoteSchema.actionForm.defaultActionType);
          }
        }
        setLoadingSchema(false);
      },
      () => {
        setLoadingSchema(false);
      }
    );

    return () => unsub();
  }, [slug, previewSchema]);

  // Determine the auto-provisioned collection name (`ext_{slug}`)
  const customCollectionName = useMemo(() => {
    if (schema?.customCollectionName) return schema.customCollectionName;
    const cleanSlug = (schema?.slug || slug || 'custom_data').replace(/[^a-z0-9_]/gi, '_');
    return cleanSlug.startsWith('ext_') ? cleanSlug : `ext_${cleanSlug}`;
  }, [schema?.customCollectionName, schema?.slug, slug]);

  // 2. Subscribe in real-time to the Auto-Provisioned Firestore Collection (`ext_{slug}`)
  useEffect(() => {
    if (!customCollectionName) return;
    setLoadingCustomCollection(true);

    const colRef = collection(db, customCollectionName);
    const unsub = onSnapshot(
      colRef,
      (snap) => {
        const rows: any[] = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        rows.sort((a, b) => {
          const ta = new Date(a.createdAt || a.tanggal || a.periodePajak || a.periodeKpi || 0).getTime();
          const tb = new Date(b.createdAt || b.tanggal || b.periodePajak || b.periodeKpi || 0).getTime();
          return tb - ta;
        });
        setCustomRecords(rows);
        setLoadingCustomCollection(false);
      },
      (err) => {
        console.warn(`Warning listening to ${customCollectionName}:`, err);
        setLoadingCustomCollection(false);
      }
    );

    return () => unsub();
  }, [customCollectionName]);

  useEffect(() => {
    if (!selectedProductId && products.length > 0) {
      setSelectedProductId(products[0].id);
    }
  }, [products, selectedProductId]);

  useEffect(() => {
    if (!selectedOrderId && orders.length > 0) {
      setSelectedOrderId(orders[0].id);
    }
  }, [orders, selectedOrderId]);

  // Resolved CRUD fields for "+ Tambah Data" modal
  const resolvedCrudFields: AICustomCrudField[] = useMemo(() => {
    if (schema?.crudFields && schema.crudFields.length > 0) {
      return schema.crudFields;
    }
    if (schema?.domainPreset === 'tax') {
      return [
        { key: 'periodePajak', label: 'Periode / Tanggal Pajak', inputType: 'date', required: true },
        {
          key: 'jenisPajak',
          label: 'Jenis Pajak',
          inputType: 'select_options',
          options: [
            'PPN 11% (Pertambahan Nilai)',
            'PPh Final UMKM 0.5%',
            'Pajak Daerah / Resto 10%',
            'PPh Pasal 21 Karyawan',
          ],
          required: true,
        },
        { key: 'nomorFaktur', label: 'No. Faktur / NTPN', inputType: 'text' },
        { key: 'dppAmount', label: 'Dasar Pengenaan Pajak / Omzet (DPP)', inputType: 'currency', required: true },
        { key: 'tarifPersen', label: 'Tarif Pajak (%)', inputType: 'percent', defaultValue: 11, required: true },
        { key: 'keterangan', label: 'Catatan SPT / Keterangan', inputType: 'text' },
      ];
    }
    if (schema?.domainPreset === 'kpi') {
      return [
        { key: 'staffName', label: 'Pilih Kasir / Staf', inputType: 'select_staff', required: true },
        { key: 'periodeKpi', label: 'Periode Evaluasi KPI', inputType: 'date', required: true },
        { key: 'targetAmount', label: 'Target Penjualan', inputType: 'currency', defaultValue: 10000000, required: true },
        { key: 'realisasiManual', label: 'Realisasi Tambahan (Di Luar POS)', inputType: 'currency', defaultValue: 0 },
        { key: 'bonusAmount', label: 'Bonus / Komisi KPI', inputType: 'currency', defaultValue: 500000, required: true },
        { key: 'keterangan', label: 'Catatan Evaluasi', inputType: 'text' },
      ];
    }
    return [
      { key: 'tanggal', label: 'Tanggal', inputType: 'date', required: true },
      { key: 'judulItem', label: 'Nama Item / Deskripsi', inputType: 'text', required: true },
      { key: 'relatedProduct', label: 'Produk Terkait (Database Produk)', inputType: 'select_product' },
      { key: 'relatedStaff', label: 'Staf Terkait (Database Staf)', inputType: 'select_staff' },
      { key: 'qty', label: 'Kuantitas / Kolom A', inputType: 'number', defaultValue: 1, required: true },
      { key: 'nominalSatuan', label: 'Nilai Satuan / Kolom B (Mata Uang)', inputType: 'currency', defaultValue: 100000, required: true },
      { key: 'targetNilai', label: 'Target Acuan (Opsional)', inputType: 'currency', defaultValue: 1000000 },
      { key: 'keterangan', label: 'Catatan', inputType: 'text' },
    ];
  }, [schema]);

  // Initialize default values when opening "+ Tambah Data" Modal
  const openAddDataModal = (prefill?: Record<string, any>) => {
    setEditingRecordId(null);
    const todayIso = new Date().toISOString().slice(0, 10);
    const defaults: Record<string, any> = {};
    resolvedCrudFields.forEach((f) => {
      if (f.inputType === 'date') {
        defaults[f.key] = todayIso;
      } else if (f.inputType === 'select_options' && f.options?.length) {
        defaults[f.key] = f.options[0];
      } else if (f.inputType === 'select_staff' && staff.length > 0) {
        defaults[f.key] = staff[0]?.name || staff[0]?.email || 'Kasir Utama';
      } else if (f.inputType === 'select_product' && products.length > 0) {
        defaults[f.key] = products[0]?.name || '';
      } else if (f.inputType === 'select_customer' && customers.length > 0) {
        defaults[f.key] = customers[0]?.name || '';
      } else if (f.defaultValue !== undefined) {
        defaults[f.key] = f.defaultValue;
      } else {
        defaults[f.key] = f.inputType === 'number' || f.inputType === 'currency' || f.inputType === 'percent' ? 0 : '';
      }
    });
    if (schema?.domainPreset === 'tax' && !prefill?.dppAmount) {
      defaults.dppAmount = ecosystemMetrics.taxDppOmzet || 0;
    }
    setCrudFormValues({ ...defaults, ...(prefill || {}) });
    setIsCrudModalOpen(true);
  };

  const openEditDataModal = (row: any) => {
    setEditingRecordId(row.id);
    setCrudFormValues({ ...row });
    setIsCrudModalOpen(true);
  };

  // ============================================================================
  // AI BUSINESS LOGIC & HYBRID DATA BRIDGING ENGINE
  // ============================================================================
  const ecosystemMetrics = useMemo(() => {
    const productMap = new Map<string, any>();
    products.forEach((p) => productMap.set(p.id, p));

    // Filter transactions by periodFilter if set
    const now = Date.now();
    const filteredTransactions = transactions.filter((t: any) => {
      if (periodFilter === 'all') return true;
      const ts = new Date(t.createdAt || t.date || now).getTime();
      const diffDays = (now - ts) / (1000 * 60 * 60 * 24);
      if (periodFilter === 'today') return diffDays <= 1;
      if (periodFilter === '7d') return diffDays <= 7;
      if (periodFilter === '30d') return diffDays <= 30;
      return true;
    });

    let totalSalesRevenue = 0;
    let totalCostOfGoods = 0;
    let totalSoldUnits = 0;

    // Cashier sales map for KPI Hybrid Bridging
    const cashierSalesMap = new Map<string, { revenue: number; count: number }>();

    const enrichedTransactions = filteredTransactions.map((t: any) => {
      const amount = Number(t.totalAmount || t.total || 0);
      totalSalesRevenue += amount;

      const cName = String(t.cashierName || t.cashier || 'Kasir POS').trim();
      const prevCashier = cashierSalesMap.get(cName.toLowerCase()) || { revenue: 0, count: 0 };
      cashierSalesMap.set(cName.toLowerCase(), {
        revenue: prevCashier.revenue + amount,
        count: prevCashier.count + 1,
      });

      const items = Array.isArray(t.items) ? t.items : [];
      let trxCost = 0;
      let trxWeightKg = 0;

      items.forEach((item: any) => {
        const qty = Number(item.quantity || item.qty || 1);
        totalSoldUnits += qty;
        const prod = productMap.get(item.productId || item.id);
        const unitCost = Number(
          item.costPerUnit ||
            prod?.costPerUnit ||
            prod?.hargaModal ||
            Number(item.pricePerUnit || item.price || 0) * 0.72
        );
        trxCost += unitCost * qty;

        const beratMl = Number(prod?.beratPerItem || prod?.weightPerPieceGrams || 250);
        const isiDus = Number(prod?.isiPerDus || prod?.piecesPerCarton || 24);
        const itemTotalKg = Number(prod?.totalBeratKg || (beratMl * isiDus) / 1000);
        trxWeightKg += itemTotalKg * qty;
      });

      if (items.length === 0) {
        trxCost = amount * 0.75;
      }

      totalCostOfGoods += trxCost;
      const keuntungan = amount - trxCost;
      const marginPct = amount > 0 ? (keuntungan / amount) * 100 : 0;

      return {
        ...t,
        id: t.id || '-',
        createdAt: t.createdAt || t.date || new Date().toISOString(),
        customerName: t.customerName || t.customer || 'Pelanggan Umum',
        cashierName: cName,
        totalBeratKg: Number(trxWeightKg.toFixed(2)),
        modal: Math.round(trxCost),
        keuntungan: Math.round(keuntungan),
        marginPct: Number(marginPct.toFixed(1)),
        totalAmount: amount,
        statusBadge:
          keuntungan < 0
            ? { text: 'Margin Negatif', color: 'rose' }
            : String(t.paymentMethod || '').toLowerCase().includes('hutang')
            ? { text: 'Overdue / Piutang', color: 'amber' }
            : { text: 'Terverifikasi AI', color: 'emerald' },
      };
    });

    const totalNetProfit = totalSalesRevenue - totalCostOfGoods;
    const averageDailySales = Math.round(totalSalesRevenue / 7);

    // Tax calculations (DPP, PPN 11%, PPh UMKM 0.5%)
    const pwaOrdersRevenue = orders
      .filter((o: any) => String(o.status || '').toLowerCase() !== 'cancelled')
      .reduce((acc: number, o: any) => acc + Number(o.totalAmount || o.total || 0), 0);
    const taxDppOmzet = totalSalesRevenue > 0 ? totalSalesRevenue : pwaOrdersRevenue;
    const taxPpn11 = Math.round(taxDppOmzet * 0.11);
    const taxPph05 = Math.round(taxDppOmzet * 0.005);

    // Product metrics
    let totalCatalogWeightKg = 0;
    let criticalStockCount = 0;

    const enrichedProducts = products.map((p: any) => {
      const isiPerDus = Number(p.isiPerDus || p.piecesPerCarton || 24);
      const beratPerItem = Number(p.beratPerItem || p.weightPerPieceGrams || 250);
      const totalBeratKg = Number(
        p.totalBeratKg !== undefined
          ? p.totalBeratKg
          : ((beratPerItem * isiPerDus) / 1000).toFixed(2)
      );
      const stockInUnits = Number(p.stockInUnits ?? p.stock ?? 0);
      const minStockAlert = Number(p.minStockAlert ?? p.minStockCartons ?? 5);
      const costPerUnit = Number(p.costPerUnit || p.hargaModal || 0);
      const pricePerUnit = Number(p.pricePerUnit || p.price || 0);
      const profitPerUnit = pricePerUnit - costPerUnit;
      const marginPct = pricePerUnit > 0 ? (profitPerUnit / pricePerUnit) * 100 : 0;

      totalCatalogWeightKg += totalBeratKg * Math.max(stockInUnits, 1);
      if (stockInUnits <= minStockAlert) {
        criticalStockCount += 1;
      }

      const avgDailyProductSales = Math.max(1, Math.round(totalSoldUnits / Math.max(products.length * 7, 1)));
      const daysRemainingNum = Math.round(stockInUnits / avgDailyProductSales);

      return {
        ...p,
        name: p.name || p.namaProduk || 'Produk',
        isiPerDus,
        beratPerItem,
        totalBeratKg,
        stockInUnits,
        costPerUnit,
        pricePerUnit,
        profitPerUnit,
        marginPct: Number(marginPct.toFixed(1)),
        daysRemaining: `${daysRemainingNum} Hari`,
        statusBadge:
          stockInUnits <= 0
            ? { text: 'Stok Habis', color: 'rose' }
            : stockInUnits <= minStockAlert
            ? { text: 'Stok Kritis', color: 'rose' }
            : { text: 'Stok Aman', color: 'emerald' },
      };
    });

    // Cash logs & Shifts
    const totalCashIn = cashLogs
      .filter((c: any) => c.type === 'in')
      .reduce((acc: number, c: any) => acc + Number(c.amount || 0), 0);
    const totalCashOut = cashLogs
      .filter((c: any) => c.type === 'out')
      .reduce((acc: number, c: any) => acc + Number(c.amount || 0), 0);

    const enrichedShifts = shifts.map((s: any) => {
      const initialFloat = Number(s.initialFloat || s.openingBalance || 0);
      const cashSales = Number(s.cashSales || s.totalSales || 0);
      const expectedCash = Number(
        s.expectedCash || initialFloat + cashSales + totalCashIn - totalCashOut
      );
      const actualCash = Number(s.actualCash ?? expectedCash);
      const difference = actualCash - expectedCash;

      return {
        ...s,
        cashierName: s.cashierName || 'Kasir POS',
        openedAt: s.openedAt || s.createdAt || new Date().toISOString(),
        initialFloat,
        cashSales,
        expectedCash,
        actualCash,
        difference,
        statusBadge:
          difference < 0
            ? { text: 'Kurang / Short', color: 'rose' }
            : difference > 0
            ? { text: 'Lebih / Over', color: 'amber' }
            : { text: 'Seimbang (Klop)', color: 'emerald' },
      };
    });

    // Enrich Custom Collection (`ext_{slug}`) records with Hybrid Data Bridging & Dynamic Formulas
    let customCollectionTotalCurrency = 0;
    let kpiTotalTargetCurrency = 0;
    let kpiSumPct = 0;

    const enrichedCustomRecords = customRecords.map((rec: any) => {
      // Tax Calculation per Row
      const dppAmount = Number(rec.dppAmount ?? taxDppOmzet ?? 0);
      const tarifPersen = Number(
        rec.tarifPersen ??
          (String(rec.jenisPajak || '').includes('0.5')
            ? 0.5
            : String(rec.jenisPajak || '').includes('10')
            ? 10
            : 11)
      );
      const calculatedTax = Number(
        rec.calculatedTax ?? rec.nominalPajak ?? Math.round(dppAmount * (tarifPersen / 100))
      );
      const ppn11 = Math.round(dppAmount * 0.11);
      const pph05 = Math.round(dppAmount * 0.005);

      // KPI Calculation per Row (Hybrid Join with Cashier POS Transactions)
      const staffKey = String(rec.staffName || rec.relatedStaff || '').toLowerCase();
      const posCashierStats = cashierSalesMap.get(staffKey) || {
        revenue: totalSalesRevenue > 0 && customRecords.length <= 1 ? totalSalesRevenue : 0,
        count: filteredTransactions.length,
      };
      const targetAmount = Number(rec.targetAmount ?? rec.targetNilai ?? 10000000);
      const realisasiManual = Number(rec.realisasiManual ?? 0);
      const realisasiAmount = Number(
        rec.realisasiAmount ?? posCashierStats.revenue + realisasiManual
      );
      const bonusAmount = Number(rec.bonusAmount ?? 500000);

      // Generic Column A * Column B Formula
      const qty = Number(rec.qty ?? 1);
      const nominalSatuan = Number(rec.nominalSatuan ?? 0);
      const calculatedTotal = Number(
        rec.calculatedTotal ??
          (schema?.domainPreset === 'tax'
            ? calculatedTax
            : schema?.domainPreset === 'kpi'
            ? bonusAmount
            : qty * nominalSatuan)
      );

      const effectiveRealisasi =
        schema?.domainPreset === 'kpi' ? realisasiAmount : calculatedTotal;
      const pencapaianPct =
        targetAmount > 0 ? Number(((effectiveRealisasi / targetAmount) * 100).toFixed(1)) : 100;

      customCollectionTotalCurrency += calculatedTotal;
      kpiTotalTargetCurrency += targetAmount;
      kpiSumPct += pencapaianPct;

      let statusBadge = { text: 'Tersimpan Live', color: 'emerald' };
      if (schema?.domainPreset === 'tax') {
        statusBadge =
          rec.statusPajak === 'Lunas' || rec.syncedToCashReport
            ? { text: 'Lunas / Disetor', color: 'emerald' }
            : { text: 'Belum Disetor', color: 'amber' };
      } else if (schema?.domainPreset === 'kpi') {
        statusBadge =
          pencapaianPct >= 100
            ? { text: 'Tercapai', color: 'emerald' }
            : { text: 'Belum Tercapai', color: 'amber' };
      } else if (targetAmount > 0) {
        statusBadge =
          pencapaianPct >= 100
            ? { text: 'Target Tercapai', color: 'emerald' }
            : { text: `${pencapaianPct}% dari Target`, color: 'blue' };
      }

      return {
        ...rec,
        periodePajak: rec.periodePajak || rec.tanggal || rec.createdAt,
        periodeKpi: rec.periodeKpi || rec.tanggal || rec.createdAt,
        tanggal: rec.tanggal || rec.periodePajak || rec.periodeKpi || rec.createdAt,
        dppAmount,
        tarifPersen,
        calculatedTax,
        ppn11,
        pph05,
        trxCount: posCashierStats.count,
        targetAmount,
        realisasiAmount,
        pencapaianPct,
        bonusAmount,
        qty,
        nominalSatuan,
        calculatedTotal,
        relatedEntity:
          rec.relatedProduct || rec.relatedStaff || rec.staffName || rec.jenisPajak || '-',
        statusBadge,
      };
    });

    // If customRecords is empty, provide live virtual rows bridged from ecosystem so table is never dead!
    let hybridCustomRows = enrichedCustomRecords;
    if (hybridCustomRows.length === 0) {
      if (schema?.domainPreset === 'tax') {
        hybridCustomRows = [
          {
            id: 'virtual_tax_ppn',
            isVirtualBridge: true,
            periodePajak: new Date().toISOString().slice(0, 10),
            jenisPajak: 'PPN 11% (Otomatis dari Omzet POS & PWA)',
            nomorFaktur: 'AUTO-DPP-POS',
            dppAmount: taxDppOmzet,
            tarifPersen: 11,
            calculatedTax: taxPpn11,
            ppn11: taxPpn11,
            pph05: taxPph05,
            statusBadge: { text: 'Estimasi Live POS', color: 'amber' },
          },
          {
            id: 'virtual_tax_pph',
            isVirtualBridge: true,
            periodePajak: new Date().toISOString().slice(0, 10),
            jenisPajak: 'PPh Final UMKM 0.5% (Otomatis dari Omzet)',
            nomorFaktur: 'AUTO-UMKM-05',
            dppAmount: taxDppOmzet,
            tarifPersen: 0.5,
            calculatedTax: taxPph05,
            ppn11: taxPpn11,
            pph05: taxPph05,
            statusBadge: { text: 'Estimasi Live POS', color: 'blue' },
          },
        ];
      } else if (schema?.domainPreset === 'kpi') {
        const staffList =
          staff.length > 0
            ? staff
            : [{ id: 'st_1', name: 'Kasir Utama POS', role: 'Cashier' }];
        hybridCustomRows = staffList.map((st: any, idx: number) => {
          const stName = st.name || st.email || `Staf #${idx + 1}`;
          const stats = cashierSalesMap.get(String(stName).toLowerCase()) || {
            revenue: idx === 0 ? totalSalesRevenue : Math.round(totalSalesRevenue * 0.4),
            count: idx === 0 ? filteredTransactions.length : Math.max(1, Math.floor(filteredTransactions.length / 2)),
          };
          const targetAmt = 10000000;
          const pct = Number(((stats.revenue / targetAmt) * 100).toFixed(1));
          return {
            id: `virtual_kpi_${st.id || idx}`,
            isVirtualBridge: true,
            staffName: stName,
            periodeKpi: new Date().toISOString().slice(0, 10),
            trxCount: stats.count,
            targetAmount: targetAmt,
            realisasiAmount: stats.revenue,
            pencapaianPct: pct,
            bonusAmount: pct >= 100 ? 750000 : 250000,
            statusBadge:
              pct >= 100
                ? { text: 'Tercapai', color: 'emerald' }
                : { text: 'Belum Tercapai', color: 'amber' },
          };
        });
      }
    }

    const kpiAverageAchievementPct =
      enrichedCustomRecords.length > 0
        ? Number((kpiSumPct / enrichedCustomRecords.length).toFixed(1))
        : hybridCustomRows.length > 0 && schema?.domainPreset === 'kpi'
        ? Number(
            (
              hybridCustomRows.reduce((a: number, r: any) => a + Number(r.pencapaianPct || 0), 0) /
              hybridCustomRows.length
            ).toFixed(1)
          )
        : 100;

    const activeShift = enrichedShifts.find((s: any) => s.status === 'open') || enrichedShifts[0];
    const activeShiftExpectedCash = activeShift ? activeShift.expectedCash : totalSalesRevenue;

    return {
      totalSalesRevenue,
      totalNetProfit,
      averageDailySales,
      totalCatalogWeightKg: Number(totalCatalogWeightKg.toFixed(2)),
      criticalStockCount,
      activeShiftExpectedCash,
      totalCashIn,
      totalCashOut,
      taxDppOmzet,
      taxPpn11,
      taxPph05,
      customCollectionTotalCurrency:
        customCollectionTotalCurrency > 0
          ? customCollectionTotalCurrency
          : schema?.domainPreset === 'tax'
          ? taxPpn11 + taxPph05
          : totalNetProfit,
      customCollectionRecordCount: customRecords.length,
      kpiAverageAchievementPct,
      kpiTotalTargetCurrency: kpiTotalTargetCurrency > 0 ? kpiTotalTargetCurrency : 10000000,
      enrichedTransactions,
      enrichedProducts,
      enrichedShifts,
      hybridCustomRows,
    };
  }, [products, transactions, orders, shifts, cashLogs, staff, customRecords, periodFilter, schema?.domainPreset]);

  // Live preview of calculated values inside the "+ Tambah Data" Modal
  const liveModalPreview = useMemo(() => {
    const dpp = Number(crudFormValues.dppAmount || ecosystemMetrics.taxDppOmzet || 0);
    const tarif = Number(crudFormValues.tarifPersen || 11);
    const pajakNominal = Math.round(dpp * (tarif / 100));
    const ppn11 = Math.round(dpp * 0.11);
    const pph05 = Math.round(dpp * 0.005);

    const targetKpi = Number(crudFormValues.targetAmount || 10000000);
    const manualRealisasi = Number(crudFormValues.realisasiManual || 0);
    const posRealisasi = ecosystemMetrics.totalSalesRevenue;
    const totalRealisasiKpi = posRealisasi + manualRealisasi;
    const kpiPct = targetKpi > 0 ? Number(((totalRealisasiKpi / targetKpi) * 100).toFixed(1)) : 0;

    const qty = Number(crudFormValues.qty || 1);
    const satuan = Number(crudFormValues.nominalSatuan || 0);
    const customTotal = qty * satuan;

    return {
      dpp,
      tarif,
      pajakNominal,
      ppn11,
      pph05,
      targetKpi,
      totalRealisasiKpi,
      kpiPct,
      customTotal,
    };
  }, [crudFormValues, ecosystemMetrics]);

  // Save new or edited record to Auto-Provisioned Firestore Collection (`ext_{slug}`) + optional Cash Report Sync
  const handleSaveCrudRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customCollectionName) return;
    setIsSubmittingCrud(true);
    setFeedbackBanner(null);

    try {
      const payload: Record<string, any> = {
        ...crudFormValues,
        updatedAt: new Date().toISOString(),
      };

      if (schema?.domainPreset === 'tax') {
        payload.dppAmount = Number(crudFormValues.dppAmount || liveModalPreview.dpp);
        payload.tarifPersen = Number(crudFormValues.tarifPersen || 11);
        payload.calculatedTax = liveModalPreview.pajakNominal;
        payload.ppn11 = liveModalPreview.ppn11;
        payload.pph05 = liveModalPreview.pph05;
        payload.statusPajak = syncToCashReport ? 'Lunas' : 'Terutang';
        payload.syncedToCashReport = syncToCashReport;
      } else if (schema?.domainPreset === 'kpi') {
        payload.targetAmount = Number(crudFormValues.targetAmount || 10000000);
        payload.realisasiManual = Number(crudFormValues.realisasiManual || 0);
        payload.bonusAmount = Number(crudFormValues.bonusAmount || 0);
        payload.syncedToCashReport = syncToCashReport;
      } else {
        payload.qty = Number(crudFormValues.qty ?? 1);
        payload.nominalSatuan = Number(crudFormValues.nominalSatuan ?? 0);
        payload.calculatedTotal = payload.qty * payload.nominalSatuan;
        payload.targetNilai = Number(crudFormValues.targetNilai ?? 0);
        payload.syncedToCashReport = syncToCashReport;
      }

      if (editingRecordId && !String(editingRecordId).startsWith('virtual_')) {
        await updateDoc(doc(db, customCollectionName, editingRecordId), payload);
        if (ACTIVE_STORE_ID) {
          await updateDoc(
            doc(db, 'stores', ACTIVE_STORE_ID, customCollectionName, editingRecordId),
            payload
          ).catch(() => {});
        }
      } else {
        payload.createdAt = new Date().toISOString();
        const createdRef = await addDoc(collection(db, customCollectionName), payload);
        if (ACTIVE_STORE_ID) {
          await addDoc(
            collection(db, 'stores', ACTIVE_STORE_ID, customCollectionName),
            { ...payload, rootId: createdRef.id }
          ).catch(() => {});
        }
      }

      // If user enabled automatic financial ecosystem sync (e.g., Pay Tax or Disburse KPI Bonus)
      let cashSyncMsg = '';
      if (syncToCashReport) {
        const amountToSync =
          schema?.domainPreset === 'tax'
            ? Number(payload.calculatedTax || 0)
            : schema?.domainPreset === 'kpi'
            ? Number(payload.bonusAmount || 0)
            : Number(payload.calculatedTotal || 0);

        if (amountToSync > 0) {
          const desc =
            schema?.domainPreset === 'tax'
              ? `Pembayaran ${payload.jenisPajak || 'Pajak'} (${payload.nomorFaktur || payload.periodePajak || 'SPT'})`
              : schema?.domainPreset === 'kpi'
              ? `Pencairan Bonus KPI Staf: ${payload.staffName || 'Kasir'}`
              : `${ schema?.title || 'Data Baru'}: ${payload.judulItem || payload.keterangan || customCollectionName}`;

          await executeEcosystemWriteAction(
            schema?.ecosystemImpactButton?.actionType === 'add_cash_in' ? 'add_cash_in' : 'add_cash_out',
            {
              amount: amountToSync,
              description: desc,
              category: schema?.ecosystemImpactButton?.category || schema?.title || 'Operasional AI Page',
            }
          );
          cashSyncMsg = ' & tercatat otomatis ke Laporan Kas (/dashboard/laporankas) + Keuangan!';
        }
      }

      setFeedbackBanner({
        ok: true,
        message: `Data berhasil disimpan ke collection Firestore "${customCollectionName}"${cashSyncMsg}`,
      });
      setIsCrudModalOpen(false);
      setEditingRecordId(null);
    } catch (err: any) {
      setFeedbackBanner({
        ok: false,
        message: err?.message || 'Gagal menyimpan data ke Firestore.',
      });
    } finally {
      setIsSubmittingCrud(false);
    }
  };

  const handleDeleteCrudRecord = async (recordId: string) => {
    if (!recordId || String(recordId).startsWith('virtual_')) return;
    try {
      await deleteDoc(doc(db, customCollectionName, recordId));
      setFeedbackBanner({
        ok: true,
        message: `Data berhasil dihapus dari collection "${customCollectionName}".`,
      });
    } catch (err: any) {
      setFeedbackBanner({
        ok: false,
        message: err?.message || 'Gagal menghapus data.',
      });
    }
  };

  // One-click Ecosystem Financial Sync from table row (e.g., "Bayar Pajak" or "Cairkan Bonus KPI")
  const handleRowEcosystemImpact = async (row: any) => {
    const amount = Number(
      row.calculatedTax || row.bonusAmount || row.calculatedTotal || row.totalAmount || 0
    );
    if (amount <= 0) return;

    const label =
      schema?.domainPreset === 'tax'
        ? `Setor Pajak ${row.jenisPajak || ''} (${row.periodePajak || ''})`
        : schema?.domainPreset === 'kpi'
        ? `Cairkan Bonus KPI: ${row.staffName || 'Staf'}`
        : `Sinkronisasi Kas: ${row.judulItem || row.name || schema?.title}`;

    const res = await executeEcosystemWriteAction('add_cash_out', {
      amount,
      description: label,
      category: schema?.ecosystemImpactButton?.category || 'Operasional AI Page',
    });

    if (!String(row.id).startsWith('virtual_')) {
      await updateDoc(doc(db, customCollectionName, row.id), {
        statusPajak: 'Lunas',
        syncedToCashReport: true,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    } else {
      // Materialize virtual row into Firestore collection
      const { id: _ignore, isVirtualBridge: _v, statusBadge: _sb, ...cleanRow } = row;
      await addDoc(collection(db, customCollectionName), {
        ...cleanRow,
        statusPajak: 'Lunas',
        syncedToCashReport: true,
        createdAt: new Date().toISOString(),
      }).catch(() => {});
    }

    setFeedbackBanner(res);
  };

  // Table rows resolver based on primaryCollection + filters
  const tableRows = useMemo(() => {
    if (!schema) return [];
    const primary = schema.table.primaryCollection;
    let source: any[] = [];

    if (
      primary === customCollectionName ||
      primary?.startsWith('ext_') ||
      schema.domainPreset === 'tax' ||
      schema.domainPreset === 'kpi' ||
      schema.domainPreset === 'custom'
    ) {
      source = ecosystemMetrics.hybridCustomRows;
    } else if (primary === 'products') {
      source = ecosystemMetrics.enrichedProducts;
    } else if (primary === 'shifts') {
      source = ecosystemMetrics.enrichedShifts;
    } else if (primary === 'customers') {
      source = customers.map((c: any) => ({
        ...c,
        statusBadge:
          Number(c.debt || c.piutang || 0) > 0
            ? { text: 'Overdue / Piutang', color: 'amber' }
            : { text: 'Lunas / Aktif', color: 'emerald' },
      }));
    } else {
      source = ecosystemMetrics.enrichedTransactions;
    }

    return source.filter((row) => {
      if (categoryFilter !== 'all') {
        const rowCat = String(row.category || row.jenisPajak || row.statusBadge?.text || '').toLowerCase();
        if (!rowCat.includes(categoryFilter.toLowerCase())) return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return JSON.stringify(row).toLowerCase().includes(q);
    });
  }, [schema, customCollectionName, ecosystemMetrics, customers, searchQuery, categoryFilter]);

  // Chart data
  const chartData = useMemo(() => {
    if (schema?.domainPreset === 'kpi' && ecosystemMetrics.hybridCustomRows.length > 0) {
      return ecosystemMetrics.hybridCustomRows.slice(0, 8).map((r: any) => ({
        name: String(r.staffName || 'Staf').slice(0, 14),
        penjualan: Number(r.realisasiAmount || 0),
        keuntungan: Number(r.targetAmount || 0),
        modal: Number(r.bonusAmount || 0),
      }));
    }
    const recent = ecosystemMetrics.enrichedTransactions.slice(0, 10).reverse();
    if (recent.length > 0) {
      return recent.map((t: any, idx: number) => ({
        name: t.cashierName ? `${t.cashierName.split(' ')[0]} #${idx + 1}` : `TRX-${idx + 1}`,
        penjualan: Number(t.totalAmount || 0),
        keuntungan: Number(t.keuntungan || 0),
        modal: Number(t.modal || 0),
      }));
    }
    return ecosystemMetrics.enrichedProducts.slice(0, 8).map((p: any) => ({
      name: String(p.name || 'Produk').slice(0, 12),
      penjualan: Number(p.pricePerUnit || 0) * Math.max(Number(p.stockInUnits || 1), 1),
      keuntungan: Number(p.profitPerUnit || 0) * Math.max(Number(p.stockInUnits || 1), 1),
      modal: Number(p.costPerUnit || 0) * Math.max(Number(p.stockInUnits || 1), 1),
    }));
  }, [schema?.domainPreset, ecosystemMetrics]);

  const formatCellValue = (val: any, type: string) => {
    if (val === undefined || val === null) return '-';
    if (type === 'currency') {
      return formatMoney(Number(val) || 0, currencyMode);
    }
    if (type === 'percent') {
      return `${Number(val || 0).toFixed(1)}%`;
    }
    if (type === 'weight_kg') {
      return `${Number(val || 0).toFixed(2)} kg`;
    }
    if (type === 'date') {
      const d = new Date(val);
      return Number.isNaN(d.getTime())
        ? String(val)
        : d.toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          });
    }
    if (type === 'badge' && typeof val === 'object') {
      const colorMap: Record<string, string> = {
        rose: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
        amber: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        emerald: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        blue: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
        purple: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
      };
      return (
        <span
          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
            colorMap[val.color] || colorMap.blue
          }`}
        >
          {val.text}
        </span>
      );
    }
    return String(val);
  };

  const resolveKpiValue = (metricKey: string, format: string) => {
    const raw = (ecosystemMetrics as any)[metricKey] ?? 0;
    return formatCellValue(raw, format);
  };

  const handleExecuteTwoWayAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingAction(true);
    setFeedbackBanner(null);

    try {
      const result = await executeEcosystemWriteAction(actionType, {
        productId: selectedProductId,
        orderId: selectedOrderId,
        quantity: Number(actionQty),
        amount: Number(actionAmount),
        newPrice: Number(actionAmount),
        orderStatus: actionOrderStatus,
        description:
          actionDescription.trim() ||
          `Sinkronisasi dari halaman AI: ${schema?.title || 'Custom Page'}`,
        category: actionCategory,
      });
      setFeedbackBanner(result);
      if (result.ok) {
        setActionDescription('');
      }
    } finally {
      setSubmittingAction(false);
    }
  };

  if (loadingSchema) {
    return (
      <div className="p-8 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center gap-3 text-zinc-400">
        <RefreshCw className="w-5 h-5 animate-spin text-blue-400" />
        <span className="text-sm font-semibold">
          Memuat AI Business Logic Engine &amp; Koleksi Firestore...
        </span>
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="p-8 rounded-2xl bg-zinc-900 border border-zinc-800 text-center space-y-2">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
        <h3 className="text-base font-bold text-white">Halaman Kustom AI Tidak Ditemukan</h3>
        <p className="text-xs text-zinc-400">
          Silakan buat atau terbitkan halaman baru melalui Universal AI Page &amp; Database Builder di{' '}
          <code>/dashboard/pengaturan-pos/menu</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-zinc-900 via-indigo-950/40 to-zinc-900 border border-indigo-500/30 shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              <span>Universal AI Page &amp; Database</span>
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
              <Database className="w-3 h-3" />
              <span>Collection: {customCollectionName}</span>
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
              Model: {schema.modelUsed || 'gemini-2.5-pro'}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Currency: {currencyMode}
            </span>
          </div>
          <h1 className="text-lg sm:text-xl font-black text-white">{schema.title}</h1>
          <p className="text-xs text-zinc-400 max-w-3xl">{schema.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => openAddDataModal()}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black flex items-center gap-1.5 shadow-lg shadow-emerald-600/30 cursor-pointer transition"
          >
            <Plus className="w-4 h-4" />
            <span>+ Tambah Data ({customCollectionName})</span>
          </button>

          <button
            type="button"
            onClick={() => setShowLogicBlueprint(!showLogicBlueprint)}
            className={`px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition cursor-pointer ${
              showLogicBlueprint
                ? 'bg-indigo-600 text-white border-indigo-500'
                : 'bg-zinc-900 hover:bg-zinc-800 text-indigo-300 border-indigo-500/40'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>{showLogicBlueprint ? 'Tutup Blueprint' : 'Lihat Rumus & Koleksi AI'}</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackBanner && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-bold flex items-center justify-between ${
            feedbackBanner.ok
              ? 'bg-emerald-950/90 border-emerald-600 text-emerald-200'
              : 'bg-rose-950/90 border-rose-600 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{feedbackBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="px-2 py-0.5 text-xs hover:text-white cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* 3-Layer AI Business Logic Blueprint Inspector */}
      {showLogicBlueprint && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 rounded-2xl bg-zinc-900/95 border border-indigo-500/30 shadow-2xl">
          {/* Layer 1: Auto-Provisioned Database & Hybrid Join */}
          <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-black text-blue-400 uppercase">
              <GitMerge className="w-4 h-4" />
              <span>1. Auto-Collection &amp; Hybrid Bridging</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {schema.connectedCollections.map((col) => (
                <span
                  key={col}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border ${
                    col.startsWith('ext_')
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                  }`}
                >
                  firestore/{col}
                </span>
              ))}
            </div>
            <div className="space-y-1.5 pt-1">
              {schema.joinMappings?.map((jm, i) => (
                <div
                  key={i}
                  className="p-2 rounded-lg bg-zinc-900 border border-zinc-800/80 text-[11px] space-y-0.5"
                >
                  <div className="font-mono font-bold text-zinc-200 flex items-center gap-1">
                    <span>{jm.fromCollection}</span>
                    <ArrowRight className="w-3 h-3 text-blue-400" />
                    <span>{jm.toCollection}</span>
                  </div>
                  <p className="text-[10px] text-zinc-400">{jm.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Layer 2: Dynamic Formula Engine */}
          <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-black text-emerald-400 uppercase">
              <Code2 className="w-4 h-4" />
              <span>2. Rumus &amp; Kalkulasi Otomatis AI</span>
            </div>
            <div className="space-y-1.5">
              {schema.formulas?.map((f, i) => (
                <div
                  key={i}
                  className="p-2 rounded-lg bg-zinc-900 border border-zinc-800/80 text-[11px] space-y-0.5"
                >
                  <div className="font-bold text-white">{f.name}</div>
                  <code className="block text-[10px] text-emerald-300 font-mono bg-emerald-950/40 px-1.5 py-0.5 rounded">
                    {f.expression}
                  </code>
                  <p className="text-[10px] text-zinc-400">{f.explanation}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Layer 3: Conditional Rules & Two-Way Sync */}
          <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-black text-purple-400 uppercase">
              <SlidersHorizontal className="w-4 h-4" />
              <span>3. Aturan Kondisional &amp; Two-Way Sync</span>
            </div>
            <div className="space-y-1.5">
              {schema.conditionalRules?.map((cr, i) => (
                <div
                  key={i}
                  className="p-2 rounded-lg bg-zinc-900 border border-zinc-800/80 text-[11px] flex items-center justify-between gap-2"
                >
                  <div>
                    <code className="text-[10px] text-purple-300 font-mono">
                      JIKA {cr.fieldOrFormula}
                    </code>
                    <p className="text-[10px] text-zinc-400">{cr.explanation}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 shrink-0">
                    {cr.badgeText}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {schema.kpiCards.map((card) => {
          const borderColors: Record<string, string> = {
            blue: 'border-blue-500/30 bg-blue-950/15',
            emerald: 'border-emerald-500/30 bg-emerald-950/15',
            purple: 'border-purple-500/30 bg-purple-950/15',
            amber: 'border-amber-500/30 bg-amber-950/15',
            rose: 'border-rose-500/30 bg-rose-950/15',
          };
          return (
            <div
              key={card.id}
              className={`p-4 rounded-2xl border shadow-lg space-y-1.5 ${
                borderColors[card.color] || 'border-zinc-800 bg-zinc-900'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-400">{card.label}</span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-900/90 text-zinc-400 border border-zinc-800">
                  {card.formula}
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {resolveKpiValue(card.metricKey, card.format)}
              </div>
              <p className="text-[11px] text-zinc-400">{card.description}</p>
            </div>
          );
        })}
      </div>

      {/* Charts Section */}
      {schema.charts && schema.charts.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Interactive Area / Trend Chart */}
          <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-zinc-200">
                {schema.charts[0]?.title || 'Tren Penjualan, Modal & Keuntungan'}
              </h3>
              <span className="text-[10px] font-mono text-emerald-400">LIVE FIRESTORE</span>
            </div>
            {(() => {
              const maxVal = Math.max(
                1,
                ...chartData.map((d) => Math.max(Number(d.penjualan) || 0, Number(d.keuntungan) || 0))
              );
              const ptsPrimary = chartData
                .map((d, i) => {
                  const x = (i / Math.max(1, chartData.length - 1)) * 560 + 20;
                  const y = 165 - ((Number(d.penjualan) || 0) / maxVal) * 135;
                  return `${x},${y}`;
                })
                .join(' ');
              const ptsSecondary = chartData
                .map((d, i) => {
                  const x = (i / Math.max(1, chartData.length - 1)) * 560 + 20;
                  const y = 165 - ((Number(d.keuntungan) || 0) / maxVal) * 135;
                  return `${x},${y}`;
                })
                .join(' ');

              return (
                <div className="space-y-2">
                  <div className="h-48 w-full bg-zinc-950/60 rounded-xl border border-zinc-800/80 p-2 relative overflow-hidden">
                    <svg viewBox="0 0 600 185" className="w-full h-full overflow-visible">
                      <defs>
                        <linearGradient id="aiAreaBlue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.38" />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                        </linearGradient>
                        <linearGradient id="aiAreaEmerald" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.38" />
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>
                      {[35, 80, 125, 165].map((yLine) => (
                        <line
                          key={yLine}
                          x1="20"
                          y1={yLine}
                          x2="580"
                          y2={yLine}
                          stroke="#27272a"
                          strokeDasharray="3 3"
                          strokeWidth="1"
                        />
                      ))}
                      {chartData.length > 1 && (
                        <>
                          <polygon
                            points={`20,165 ${ptsPrimary} 580,165`}
                            fill="url(#aiAreaBlue)"
                          />
                          <polyline
                            fill="none"
                            stroke="#3b82f6"
                            strokeWidth="2.5"
                            points={ptsPrimary}
                          />
                          <polygon
                            points={`20,165 ${ptsSecondary} 580,165`}
                            fill="url(#aiAreaEmerald)"
                          />
                          <polyline
                            fill="none"
                            stroke="#10b981"
                            strokeWidth="2.5"
                            points={ptsSecondary}
                          />
                        </>
                      )}
                      {chartData.map((d, i) => {
                        const x = (i / Math.max(1, chartData.length - 1)) * 560 + 20;
                        const y1 = 165 - ((Number(d.penjualan) || 0) / maxVal) * 135;
                        const y2 = 165 - ((Number(d.keuntungan) || 0) / maxVal) * 135;
                        return (
                          <g key={i}>
                            <circle cx={x} cy={y1} r="3.5" fill="#60a5fa">
                              <title>
                                {d.name}: {formatMoney(Number(d.penjualan) || 0, currencyMode)}
                              </title>
                            </circle>
                            <circle cx={x} cy={y2} r="3.5" fill="#34d399">
                              <title>
                                {d.name}: {formatMoney(Number(d.keuntungan) || 0, currencyMode)}
                              </title>
                            </circle>
                            <text
                              x={x}
                              y={180}
                              textAnchor="middle"
                              fill="#71717a"
                              fontSize="9"
                            >
                              {String(d.name || '').slice(0, 10)}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 px-1">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                      {schema.domainPreset === 'kpi' ? 'Realisasi Kasir' : 'Omzet / DPP'}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                      {schema.domainPreset === 'kpi' ? 'Target KPI' : 'Keuntungan / Pajak'}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Interactive Bar Comparison Chart */}
          <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-zinc-200">
                {schema.charts[1]?.title || 'Distribusi Nilai & Performa'}
              </h3>
              <span className="text-[10px] font-mono text-blue-400">AUTO-JOIN</span>
            </div>
            {(() => {
              const maxVal = Math.max(
                1,
                ...chartData.map((d) => Math.max(Number(d.penjualan) || 0, Number(d.keuntungan) || 0))
              );
              return (
                <div className="space-y-2">
                  <div className="h-48 w-full bg-zinc-950/60 rounded-xl border border-zinc-800/80 p-3 flex items-end justify-between gap-2">
                    {chartData.map((d, i) => {
                      const hPrimary = Math.max(
                        6,
                        Math.round(((Number(d.penjualan) || 0) / maxVal) * 135)
                      );
                      const hSecondary = Math.max(
                        6,
                        Math.round(((Number(d.keuntungan) || 0) / maxVal) * 135)
                      );
                      return (
                        <div
                          key={i}
                          className="flex-1 flex flex-col items-center justify-end gap-1.5 group"
                        >
                          <div className="flex items-end gap-1 w-full justify-center h-36">
                            <div
                              style={{ height: `${hPrimary}px` }}
                              className="w-3 sm:w-4 rounded-t-md bg-indigo-500 group-hover:bg-indigo-400 transition-all"
                              title={`${d.name} (Utama): ${formatMoney(
                                Number(d.penjualan) || 0,
                                currencyMode
                              )}`}
                            />
                            <div
                              style={{ height: `${hSecondary}px` }}
                              className="w-3 sm:w-4 rounded-t-md bg-emerald-500 group-hover:bg-emerald-400 transition-all"
                              title={`${d.name} (Kalkulasi): ${formatMoney(
                                Number(d.keuntungan) || 0,
                                currencyMode
                              )}`}
                            />
                          </div>
                          <span className="text-[9px] text-zinc-400 truncate max-w-[60px]">
                            {String(d.name || '').slice(0, 9)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 px-1">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block" />
                      Nilai Utama ({currencyMode})
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
                      Hasil Kalkulasi ({currencyMode})
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Main Grid: Hybrid Data Table + Quick Ecosystem Action Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Table (8 cols) */}
        <div className="lg:col-span-8 p-4 sm:p-5 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-400" />
                <span>{schema.table.title}</span>
              </h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Collection:{' '}
                <code className="text-emerald-400 font-bold">{customCollectionName}</code> &bull;{' '}
                Menampilkan {tableRows.length} baris data (Hybrid Join Real-Time)
              </p>
            </div>

            {/* Period, Category & Search Filters + "+ Tambah Data" */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={periodFilter}
                onChange={(e) => setPeriodFilter(e.target.value as any)}
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
              >
                <option value="all">Semua Periode</option>
                <option value="today">Hari Ini</option>
                <option value="7d">7 Hari Terakhir</option>
                <option value="30d">30 Hari Terakhir</option>
              </select>

              <div className="relative w-full sm:w-52">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={schema.table.searchPlaceholder || 'Cari data...'}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <button
                type="button"
                onClick={() => openAddDataModal()}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Data</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-950 border-b border-zinc-800 text-[10px] font-black uppercase tracking-wider text-zinc-400">
                  {schema.table.columns.map((col) => (
                    <th key={col.key} className="py-3 px-3 whitespace-nowrap">
                      <div>{col.label}</div>
                      {col.formula && (
                        <div className="text-[9px] font-mono text-indigo-400 font-normal">
                          ƒ: {col.formula}
                        </div>
                      )}
                    </th>
                  ))}
                  <th className="py-3 px-3 text-right whitespace-nowrap">Aksi CRUD &amp; Kas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-xs">
                {tableRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={schema.table.columns.length + 1}
                      className="py-8 text-center text-zinc-500"
                    >
                      Belum ada data yang cocok. Klik tombol <strong>+ Tambah Data</strong> untuk mengisi collection <code>{customCollectionName}</code>.
                    </td>
                  </tr>
                ) : (
                  tableRows.slice(0, 25).map((row, idx) => (
                    <tr
                      key={row.id || idx}
                      className="hover:bg-zinc-800/40 transition-colors"
                    >
                      {schema.table.columns.map((col) => (
                        <td key={col.key} className="py-2.5 px-3 whitespace-nowrap text-zinc-200">
                          {formatCellValue(row[col.key], col.type)}
                        </td>
                      ))}
                      <td className="py-2.5 px-3 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-1">
                          {schema.ecosystemImpactButton?.enabled && (
                            <button
                              type="button"
                              onClick={() => handleRowEcosystemImpact(row)}
                              className="px-2 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white text-[10px] font-bold border border-indigo-500/30 transition cursor-pointer flex items-center gap-1"
                              title={schema.ecosystemImpactButton.description}
                            >
                              <Wallet className="w-3 h-3" />
                              <span>
                                {schema.domainPreset === 'tax'
                                  ? 'Bayar Pajak'
                                  : schema.domainPreset === 'kpi'
                                  ? 'Cairkan Bonus'
                                  : 'Catat ke Kas'}
                              </span>
                            </button>
                          )}
                          {!row.isVirtualBridge && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditDataModal(row)}
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-600 text-zinc-300 hover:text-white transition cursor-pointer"
                                title="Edit baris ini"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCrudRecord(row.id)}
                                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-600 text-zinc-400 hover:text-white transition cursor-pointer"
                                title="Hapus baris ini"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Two-Way Ecosystem Write Form (4 cols) */}
        <div className="lg:col-span-4 p-4 sm:p-5 rounded-2xl bg-zinc-900 border border-indigo-500/30 shadow-xl space-y-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-indigo-400 text-xs font-black uppercase tracking-wider">
              <Plus className="w-4 h-4" />
              <span>Two-Way Ecosystem Sync</span>
            </div>
            <h3 className="text-sm font-black text-white">
              {schema.actionForm?.title || 'Form Aksi Sinkronisasi Dua Arah'}
            </h3>
            <p className="text-[11px] text-zinc-400">
              {schema.actionForm?.description ||
                'Input dari form ini langsung mengupdate Firestore, POS, Client PWA, Laporan Kas (/dashboard/laporankas), dan Keuangan.'}
            </p>
          </div>

          <form onSubmit={handleExecuteTwoWayAction} className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                Jenis Aksi Ekosistem (Write Sync)
              </label>
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value as any)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="add_cash_out">Catat Pengeluaran / Pajak / Bonus (Kas Keluar)</option>
                <option value="add_cash_in">Catat Pemasukan Kas Toko (Kas Masuk)</option>
                <option value="restock_product">Tambah Stok Produk / Restock Gudang (Dus)</option>
                <option value="deduct_stock">Kurangi / Penyesuaian Stok Produk (Dus)</option>
                <option value="update_product_price">Ubah Harga Jual Produk (Sync POS &amp; PWA)</option>
                <option value="update_order_status">Update Status Pesanan Client PWA</option>
              </select>
            </div>

            {(actionType === 'restock_product' ||
              actionType === 'deduct_stock' ||
              actionType === 'update_product_price') && (
              <div>
                <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                  Pilih Produk Target
                </label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Stok: {p.stockInUnits ?? 0} Dus)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(actionType === 'restock_product' || actionType === 'deduct_stock') && (
              <div>
                <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                  Jumlah Dus (1 Produk = 1 Dus)
                </label>
                <input
                  type="number"
                  min={1}
                  value={actionQty}
                  onChange={(e) => setActionQty(Math.max(1, Number(e.target.value)))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}

            {(actionType === 'add_cash_in' ||
              actionType === 'add_cash_out' ||
              actionType === 'update_product_price') && (
              <div>
                <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                  Nominal ({currencyMode === 'USD' ? 'IDR - Otomatis Dikonversi ke USD' : 'IDR'})
                </label>
                <input
                  type="number"
                  min={1}
                  value={actionAmount}
                  onChange={(e) => setActionAmount(Math.max(0, Number(e.target.value)))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
                <div className="text-[10px] text-indigo-400 mt-1 font-mono">
                  Nilai Tampil: {formatMoney(actionAmount, currencyMode)}
                </div>
              </div>
            )}

            {actionType === 'update_order_status' && (
              <>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                    Pilih Pesanan Client PWA
                  </label>
                  <select
                    value={selectedOrderId}
                    onChange={(e) => setSelectedOrderId(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    {orders.map((o: any) => (
                      <option key={o.id} value={o.id}>
                        #{String(o.id).slice(0, 8)} — {o.customerName || 'Pelanggan'} ({o.status})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                    Status Baru
                  </label>
                  <select
                    value={actionOrderStatus}
                    onChange={(e) => setActionOrderStatus(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="verified">Terverifikasi</option>
                    <option value="packing">Diproses / Packing</option>
                    <option value="shipped">Dikirim</option>
                    <option value="completed">Selesai (Completed)</option>
                  </select>
                </div>
              </>
            )}

            <div>
              <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                Keterangan / Catatan Audit
              </label>
              <input
                type="text"
                value={actionDescription}
                onChange={(e) => setActionDescription(e.target.value)}
                placeholder="Contoh: Setor PPN Bulan Ini / Cairkan Bonus KPI Kasir..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={submittingAction}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {submittingAction
                  ? 'Menyinkronkan ke Firestore...'
                  : 'Simpan & Sinkronkan ke Ekosistem'}
              </span>
            </button>
          </form>
        </div>
      </div>

      {/* =====================================================================
          AUTO-GENERATED CRUD MODAL ("+ Tambah Data" ke Collection ext_{slug})
         ===================================================================== */}
      {isCrudModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-indigo-500/40 rounded-2xl max-w-xl w-full p-5 sm:p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <Database className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm sm:text-base font-black text-white">
                    {editingRecordId ? 'Edit Data' : '+ Tambah Data Baru'} — {schema.title}
                  </h3>
                  <p className="text-[11px] text-zinc-400 font-mono">
                    Auto-Provisioned Collection: <span className="text-emerald-400">{customCollectionName}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCrudModalOpen(false)}
                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCrudRecord} className="space-y-3.5">
              {/* Quick Fill Helper for Tax Domain */}
              {schema.domainPreset === 'tax' && (
                <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-500/30 flex items-center justify-between gap-2 text-xs">
                  <div>
                    <div className="font-bold text-blue-300">
                      Omzet Bruto POS &amp; PWA Saat Ini (DPP):{' '}
                      {formatMoney(ecosystemMetrics.taxDppOmzet, currencyMode)}
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      PPN 11%: {formatMoney(ecosystemMetrics.taxPpn11, currencyMode)} &bull; PPh UMKM 0.5%: {formatMoney(ecosystemMetrics.taxPph05, currencyMode)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setCrudFormValues((prev) => ({
                        ...prev,
                        dppAmount: ecosystemMetrics.taxDppOmzet,
                      }))
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold shrink-0 cursor-pointer"
                  >
                    Gunakan DPP Live
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[52vh] overflow-y-auto pr-1">
                {resolvedCrudFields.map((field) => (
                  <div
                    key={field.key}
                    className={
                      field.key === 'keterangan' || field.key === 'judulItem'
                        ? 'sm:col-span-2'
                        : ''
                    }
                  >
                    <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                      {field.label} {field.required && <span className="text-rose-400">*</span>}
                    </label>

                    {field.inputType === 'select_options' ? (
                      <select
                        value={crudFormValues[field.key] ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          const next: Record<string, any> = { ...crudFormValues, [field.key]: val };
                          if (field.key === 'jenisPajak') {
                            if (val.includes('0.5')) next.tarifPersen = 0.5;
                            else if (val.includes('10')) next.tarifPersen = 10;
                            else if (val.includes('11')) next.tarifPersen = 11;
                          }
                          setCrudFormValues(next);
                        }}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                      >
                        {(field.options || []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : field.inputType === 'select_product' ? (
                      <select
                        value={crudFormValues[field.key] ?? ''}
                        onChange={(e) =>
                          setCrudFormValues({ ...crudFormValues, [field.key]: e.target.value })
                        }
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                      >
                        <option value="">-- Pilih Produk dari Database --</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.name}>
                            {p.name} ({formatMoney(Number(p.pricePerUnit || 0), currencyMode)})
                          </option>
                        ))}
                      </select>
                    ) : field.inputType === 'select_staff' ? (
                      <select
                        value={crudFormValues[field.key] ?? ''}
                        onChange={(e) =>
                          setCrudFormValues({ ...crudFormValues, [field.key]: e.target.value })
                        }
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                      >
                        <option value="Kasir Utama POS">Kasir Utama POS</option>
                        {staff.map((st: any) => (
                          <option key={st.id} value={st.name || st.email}>
                            {st.name || st.email} ({st.role || 'Staff'})
                          </option>
                        ))}
                      </select>
                    ) : field.inputType === 'select_customer' ? (
                      <select
                        value={crudFormValues[field.key] ?? ''}
                        onChange={(e) =>
                          setCrudFormValues({ ...crudFormValues, [field.key]: e.target.value })
                        }
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                      >
                        <option value="">-- Pilih Pelanggan --</option>
                        {customers.map((c: any) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : field.inputType === 'date' ? (
                      <input
                        type="date"
                        required={field.required}
                        value={crudFormValues[field.key] ?? ''}
                        onChange={(e) =>
                          setCrudFormValues({ ...crudFormValues, [field.key]: e.target.value })
                        }
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                    ) : field.inputType === 'number' ||
                      field.inputType === 'currency' ||
                      field.inputType === 'percent' ? (
                      <div>
                        <input
                          type="number"
                          step="any"
                          required={field.required}
                          value={crudFormValues[field.key] ?? 0}
                          onChange={(e) =>
                            setCrudFormValues({
                              ...crudFormValues,
                              [field.key]: Number(e.target.value),
                            })
                          }
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                        />
                        {field.inputType === 'currency' && (
                          <div className="text-[10px] font-mono text-emerald-400 mt-0.5">
                            Konversi ({currencyMode}):{' '}
                            {formatMoney(Number(crudFormValues[field.key] || 0), currencyMode)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <input
                        type="text"
                        required={field.required}
                        placeholder={field.placeholder || ''}
                        value={crudFormValues[field.key] ?? ''}
                        onChange={(e) =>
                          setCrudFormValues({ ...crudFormValues, [field.key]: e.target.value })
                        }
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                      />
                    )}

                    {field.formulaHint && (
                      <p className="text-[10px] text-zinc-500 mt-0.5">{field.formulaHint}</p>
                    )}
                  </div>
                ))}
              </div>

              {/* Dynamic Formula Real-Time Output Preview inside Modal */}
              <div className="p-3 rounded-xl bg-zinc-950 border border-emerald-500/30 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-emerald-400">
                  <Calculator className="w-3.5 h-3.5" />
                  <span>Hasil Kalkulasi Rumus Otomatis AI (Real-Time):</span>
                </div>
                {schema.domainPreset === 'tax' ? (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-zinc-400 block">Pajak Terutang ({liveModalPreview.tarif}%):</span>
                      <strong className="text-emerald-300 font-black">
                        {formatMoney(liveModalPreview.pajakNominal, currencyMode)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-400 block">Ref PPN (11%):</span>
                      <strong className="text-white font-bold">
                        {formatMoney(liveModalPreview.ppn11, currencyMode)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-400 block">Ref PPh UMKM (0.5%):</span>
                      <strong className="text-white font-bold">
                        {formatMoney(liveModalPreview.pph05, currencyMode)}
                      </strong>
                    </div>
                  </div>
                ) : schema.domainPreset === 'kpi' ? (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-zinc-400 block">Total Realisasi (POS+Input):</span>
                      <strong className="text-white font-bold">
                        {formatMoney(liveModalPreview.totalRealisasiKpi, currencyMode)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-400 block">% Pencapaian KPI:</span>
                      <strong className="text-emerald-300 font-black">
                        {liveModalPreview.kpiPct}%
                      </strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-400 block">Status Kondisional:</span>
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          liveModalPreview.kpiPct >= 100
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {liveModalPreview.kpiPct >= 100 ? 'Tercapai' : 'Belum Tercapai'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">
                      Total Kalkulasi (Kolom A &times; Kolom B):
                    </span>
                    <strong className="text-emerald-300 font-black text-sm">
                      {formatMoney(liveModalPreview.customTotal, currencyMode)}
                    </strong>
                  </div>
                )}
              </div>

              {/* Checkbox to automatically record financial impact to Laporan Kas & FinanceModule */}
              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-indigo-950/25 border border-indigo-500/30 cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncToCashReport}
                  onChange={(e) => setSyncToCashReport(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-700 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="text-xs">
                  <span className="font-bold text-indigo-200 block">
                    {schema.ecosystemImpactButton?.label ||
                      'Catat Otomatis Pengeluaran/Arus Kas ke Laporan Kas (/dashboard/laporankas) & Keuangan'}
                  </span>
                  <span className="text-[10px] text-zinc-400">
                    Menjaga saldo kas toko, Laporan Kas, dan FinanceModule tetap sinkron 100% dengan data di halaman ini.
                  </span>
                </div>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsCrudModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCrud}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black shadow-lg shadow-emerald-600/30 cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingCrud
                    ? 'Menyimpan ke Firestore...'
                    : editingRecordId
                    ? 'Simpan Perubahan Data'
                    : 'Simpan Data ke Firestore'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
