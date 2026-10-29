import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
} from 'firebase/firestore';
import {
  Cpu,
  Wrench,
  Type as TypeIcon,
  Layout,
  Database,
  Code2,
  Upload,
  Trash2,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Search,
  Plus,
  ExternalLink,
  RefreshCw,
  FileCode,
  ShieldCheck,
  Calculator,
  Eye,
  Save,
  History,
  Sliders,
  ArrowRight,
  X,
} from 'lucide-react';
import { db } from '../../firebase';
import { ACTIVE_STORE_ID } from '../../config/store';
import { useAppData } from '../../context/AppDataContext';
import { useLanguage } from '../../context/LanguageContext';
import { useAppNavigation } from '../../router';
import { UITextOverrideRule } from '../../utils/i18nEngine';

export type ArchitectMode =
  | 'bug_fix'
  | 'text_override'
  | 'layout_override'
  | 'schema_formula'
  | 'code_patch';

interface ArchitectModelOption {
  id: string;
  label: string;
  badge: string;
  description: string;
}

const ARCHITECT_MODELS: ArchitectModelOption[] = [
  {
    id: 'gemini-2.5-pro',
    label: 'gemini-2.5-pro (Default — Deep Reasoning & Code/DB Architect)',
    badge: 'DEFAULT PRO',
    description: 'Terbaik untuk perbaikan bug kompleks, audit database lintas koleksi, dan modifikasi logika/kode.',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'gemini-2.5-flash (Fast Execution — UI Text, Layout & Data Sync)',
    badge: 'FAST',
    description: 'Eksekusi cepat untuk perubahan teks/label halaman, modifikasi layout, dan operasi data.',
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'gemini-2.5-flash-lite (Ultra-Low Latency)',
    badge: 'LITE',
    description: 'Ringan dan instan untuk kueri cepat dan perubahan label sederhana.',
  },
  {
    id: 'gemini-2.0-flash',
    label: 'gemini-2.0-flash (Compatible Multimodal Engine)',
    badge: 'COMPAT',
    description: 'Kompatibilitas multimodal untuk pembacaan screenshot & skema tabel.',
  },
];

const TARGET_MODULES = [
  { id: 'Semua Halaman (Global)', label: 'Semua Halaman (Global Ecosystem)', route: 'ALL' },
  { id: 'POS Machine', label: 'POS Machine — Mesin Kasir (/dashboard/pos)', route: '/dashboard/pos' },
  { id: 'Client PWA', label: 'Client PWA — Aplikasi Pelanggan (/client-pwa)', route: '/client-pwa' },
  { id: '/dashboard', label: 'Dashboard Utama & 4 Area Chart (/dashboard)', route: '/dashboard' },
  { id: '/dashboard/orders', label: 'Orders Wharf & Pembayaran (/dashboard/orders)', route: '/dashboard/orders' },
  { id: '/dashboard/transaksi', label: 'Dashboard Transaksi (/transaksi)', route: '/transaksi' },
  { id: '/dashboard/laporankas', label: 'Laporan Penjualan & Kas (/dashboard/laporankas)', route: '/dashboard/laporankas' },
  { id: '/dashboard/myasset', label: 'My Asset & Expired Date (/dashboard/myasset)', route: '/dashboard/myasset' },
  { id: '/dashboard/shift/kasir', label: 'Shift Kasir & Laci Tunai (/dashboard/shift/kasir)', route: '/dashboard/shift/kasir' },
  { id: '/dashboard/produk/tambah', label: 'Form Tambah & Edit Produk (/dashboard/produk/tambah)', route: '/dashboard/produk/tambah' },
  { id: '/dashboard/keuangan/brangkas-toko', label: 'Keuangan & Brangkas (/dashboard/keuangan/brangkas-toko)', route: '/dashboard/keuangan/brangkas-toko' },
];

export const AISystemArchitectModule: React.FC = () => {
  const {
    products,
    transactions,
    orders,
    customers,
    shifts,
    cashLogs,
    formatMoney,
    currency,
  } = useAppData();
  const { tr } = useLanguage();
  const { navigateToPath } = useAppNavigation();

  // Workspace Controls State
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-pro');
  const [targetModule, setTargetModule] = useState<string>('Semua Halaman (Global)');
  const [activeMode, setActiveMode] = useState<ArchitectMode>('bug_fix');
  const [prompt, setPrompt] = useState<string>('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string>('image/png');
  const [imageName, setImageName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Analysis & Execution State
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionPlan, setExecutionPlan] = useState<any | null>(null);
  const [tokenStats, setTokenStats] = useState<{
    tokenIn: number;
    tokenOut: number;
    totalTokens: number;
    latencyMs: number;
    modelUsed: string;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Real-time Firestore Collections for Overrides, Formulas, Backups & Logs
  const [textOverrides, setTextOverrides] = useState<UITextOverrideRule[]>([]);
  const [layoutOverrides, setLayoutOverrides] = useState<any[]>([]);
  const [customFormulas, setCustomFormulas] = useState<any[]>([]);
  const [architectBackups, setArchitectBackups] = useState<any[]>([]);

  // Tab 2: Direct UI Text Override Form
  const [newTextRoute, setNewTextRoute] = useState<string>('ALL');
  const [newSourceText, setNewSourceText] = useState<string>('');
  const [newReplacementId, setNewReplacementId] = useState<string>('');
  const [newReplacementEn, setNewReplacementEn] = useState<string>('');

  // Tab 3: Direct Layout / CSS Override Form
  const [newLayoutRoute, setNewLayoutRoute] = useState<string>('ALL');
  const [newLayoutTitle, setNewLayoutTitle] = useState<string>('');
  const [newLayoutCss, setNewLayoutCss] = useState<string>('');
  const [newHideSelector, setNewHideSelector] = useState<string>('');

  // Tab 4: Schema Field Adder, Formula Builder & Live Document Editor
  const [schemaTargetCol, setSchemaTargetCol] = useState<string>('products');
  const [newFieldName, setNewFieldName] = useState<string>('');
  const [newFieldDefaultValue, setNewFieldDefaultValue] = useState<string>('');
  const [formulaName, setFormulaName] = useState<string>('');
  const [formulaCol, setFormulaCol] = useState<string>('products');
  const [formulaOutputField, setFormulaOutputField] = useState<string>('customMetric');
  const [formulaExpr, setFormulaExpr] = useState<string>('pricePerUnit - costPerUnit');
  const [formulaType, setFormulaType] = useState<'currency' | 'number' | 'percent'>('currency');
  const [explorerCollection, setExplorerCollection] = useState<'products' | 'orders' | 'transactions' | 'customers'>('products');
  const [explorerSearch, setExplorerSearch] = useState<string>('');
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingDocJson, setEditingDocJson] = useState<string>('');

  // Tab 5: Live Code Inspector & File Patcher
  const [availableFiles, setAvailableFiles] = useState<
    Array<{ path: string; label: string; module: string }>
  >([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string>(
    'src/components/modules/OrdersModule.tsx'
  );
  const [inspectStartLine, setInspectStartLine] = useState<number>(1);
  const [inspectEndLine, setInspectEndLine] = useState<number>(180);
  const [inspectedFileData, setInspectedFileData] = useState<{
    filePath: string;
    totalLines: number;
    snippet: string;
    fullContent: string;
  } | null>(null);
  const [loadingFile, setLoadingFile] = useState<boolean>(false);
  const [patchSearchBlock, setPatchSearchBlock] = useState<string>('');
  const [patchReplaceBlock, setPatchReplaceBlock] = useState<string>('');

  // 1. Subscribe to Firestore AI Architect collections
  useEffect(() => {
    const unsubText = onSnapshot(
      collection(db, 'ui_text_overrides'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setTextOverrides(list);
      },
      () => {}
    );

    const unsubLayout = onSnapshot(
      collection(db, 'ui_layout_overrides'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setLayoutOverrides(list);
      },
      () => {}
    );

    const unsubFormulas = onSnapshot(
      collection(db, 'ai_custom_formulas'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setCustomFormulas(list);
      },
      () => {}
    );

    const unsubBackups = onSnapshot(
      collection(db, 'ai_architect_backups'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setArchitectBackups(list.slice(0, 25));
      },
      () => {}
    );

    return () => {
      unsubText();
      unsubLayout();
      unsubFormulas();
      unsubBackups();
    };
  }, []);

  // 2. Load allowed project files list for Code Inspector
  useEffect(() => {
    fetch('/api/ai-architect/files')
      .then((r) => r.json())
      .then((data) => {
        if (data?.success && Array.isArray(data.files)) {
          setAvailableFiles(data.files);
        }
      })
      .catch(() => {});
  }, []);

  // Sync route dropdown when targetModule changes
  useEffect(() => {
    const found = TARGET_MODULES.find((m) => m.id === targetModule);
    if (found) {
      setNewTextRoute(found.route);
      setNewLayoutRoute(found.route);
    }
  }, [targetModule]);

  // 3. Real-Time Ecosystem Diagnostics (Database Doctor Metrics)
  const diagnostics = useMemo(() => {
    // Check transactions missing totalModal, netProfit, paidAmount, or paymentStatus
    const inconsistentTransactions = transactions.filter((t: any) => {
      const hasValidModal = typeof t.totalModal === 'number' && !Number.isNaN(t.totalModal);
      const hasValidPaymentStatus =
        t.paymentStatus === 'paid' || t.paymentStatus === 'partial' || t.paymentStatus === 'unpaid';
      const hasPaidAmount = typeof t.paidAmount === 'number';
      return !hasValidModal || !hasValidPaymentStatus || !hasPaidAmount;
    });

    // Check orders with inconsistent payment fields
    const inconsistentOrders = orders.filter((o: any) => {
      const hasValidStatus =
        o.paymentStatus === 'paid' || o.paymentStatus === 'partial' || o.paymentStatus === 'unpaid';
      const hasRemaining = typeof o.remainingDebt === 'number';
      return !hasValidStatus || !hasRemaining;
    });

    // Check products missing piecesPerCarton or dates
    const productsMissingMetadata = products.filter((p: any) => {
      const ppc = Number(p.piecesPerCarton || p.isiPerDus || 0);
      return ppc <= 0 || !p.productionDate || !p.expiryDate;
    });

    // Calculate total unpaid debt from orders/transactions vs customer records
    const actualUnpaidTotal = orders.reduce((acc: number, o: any) => {
      if (o.status === 'cancelled' || o.status === 'rejected') return acc;
      const rem =
        typeof o.remainingDebt === 'number'
          ? o.remainingDebt
          : o.paymentStatus === 'unpaid'
          ? Number(o.totalAmount || 0)
          : 0;
      return acc + Math.max(0, rem);
    }, 0);

    const totalRevenue = transactions.reduce(
      (acc: number, t: any) =>
        t.status === 'cancelled' || t.status === 'void' ? acc : acc + Number(t.totalAmount || 0),
      0
    );

    return {
      inconsistentTransactionsCount: inconsistentTransactions.length,
      inconsistentOrdersCount: inconsistentOrders.length,
      productsMissingMetadataCount: productsMissingMetadata.length,
      actualUnpaidTotal,
      totalRevenue,
      totalProducts: products.length,
      totalOrders: orders.length,
      totalTransactions: transactions.length,
      isHealthy:
        inconsistentTransactions.length === 0 &&
        inconsistentOrders.length === 0 &&
        productsMissingMetadata.length === 0,
    };
  }, [products, transactions, orders]);

  // Load file snippet when inspecting code
  const handleInspectFile = async (customPath?: string, sLine?: number, eLine?: number) => {
    const targetPath = customPath || selectedFilePath;
    setLoadingFile(true);
    try {
      const res = await fetch('/api/ai-architect/inspect-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: targetPath,
          startLine: sLine ?? inspectStartLine,
          endLine: eLine ?? inspectEndLine,
        }),
      });
      const data = await res.json();
      if (data?.success) {
        setInspectedFileData(data);
      } else {
        setStatusMessage({
          type: 'error',
          text: data?.error || 'Gagal membaca file.',
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Gagal menghubungi server inspector.',
      });
    } finally {
      setLoadingFile(false);
    }
  };

  useEffect(() => {
    if (activeMode === 'code_patch' && !inspectedFileData) {
      void handleInspectFile(selectedFilePath, inspectStartLine, inspectEndLine);
    }
  }, [activeMode]);

  // Handle Screenshot Image Upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageName(file.name);
    setImageMimeType(file.type || 'image/png');
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageBase64(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  // Analyze Prompt & Screenshot with Gemini AI System Architect
  const handleAnalyzeWithAi = async () => {
    setIsAnalyzing(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/ai-architect/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          mode: activeMode,
          targetModule,
          modelId: selectedModel,
          imageBase64,
          imageMimeType,
          ecosystemSnapshot: diagnostics,
          fileContext:
            activeMode === 'code_patch' && inspectedFileData
              ? {
                  filePath: inspectedFileData.filePath,
                  snippet: inspectedFileData.snippet,
                }
              : null,
        }),
      });
      const data = await res.json();
      if (data?.success && data.plan) {
        setExecutionPlan(data.plan);
        if (data.tokenUsage) {
          setTokenStats(data.tokenUsage);
        }
        if (data.plan.codePatch?.searchBlock) {
          setPatchSearchBlock(data.plan.codePatch.searchBlock);
          setPatchReplaceBlock(data.plan.codePatch.replaceBlock || '');
        }
        setStatusMessage({
          type: 'info',
          text: 'Analisis AI System Architect selesai! Tinjau Rencana Eksekusi di bawah lalu klik "Terapkan Perubahan Sekarang".',
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: data?.error || 'Gagal menganalisis instruksi.',
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Koneksi ke AI System Architect gagal.',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Real Database Doctor Auto-Fix Function
  const executeDatabaseDoctorAutoFix = async (fixTypes?: string[]) => {
    setIsExecuting(true);
    setStatusMessage(null);
    try {
      const nowIso = new Date().toISOString();
      const backupPayload: any = {
        type: 'database_doctor',
        title: `Auto-Fix & Sinkronisasi Database (${targetModule})`,
        modelUsed: selectedModel,
        targetModule,
        createdAt: nowIso,
        restored: false,
        previousDocs: {
          products: [] as any[],
          orders: [] as any[],
          transactions: [] as any[],
        },
      };

      let fixedCount = 0;

      // 1. Reconcile Orders & Transactions paymentStatus, paidAmount, remainingDebt, totalModal, netProfit
      const shouldFixOrders =
        !fixTypes ||
        fixTypes.includes('reconcile_orders_payment') ||
        fixTypes.includes('reconcile_transactions');

      if (shouldFixOrders) {
        for (const ord of orders) {
          const rawOrd = ord as any;
          const total = Number(rawOrd.totalAmount || 0);
          const pm = String(rawOrd.paymentMethod || 'Tunai').toLowerCase();
          const isDebtMethod = pm.includes('hutang') || pm.includes('debt') || pm.includes('cod') || pm.includes('tempo');
          const currentStatus = String(rawOrd.paymentStatus || '').toLowerCase();

          let normStatus: 'paid' | 'partial' | 'unpaid' = 'paid';
          if (currentStatus === 'partial' || currentStatus === 'dp') {
            normStatus = 'partial';
          } else if (currentStatus === 'unpaid' || currentStatus === 'hutang' || (isDebtMethod && currentStatus !== 'paid')) {
            normStatus = 'unpaid';
          }

          const paidAmt =
            typeof rawOrd.paidAmount === 'number'
              ? rawOrd.paidAmount
              : normStatus === 'paid'
              ? total
              : 0;
          const remDebt =
            typeof rawOrd.remainingDebt === 'number'
              ? rawOrd.remainingDebt
              : Math.max(0, total - paidAmt);

          if (
            rawOrd.paymentStatus !== normStatus ||
            typeof rawOrd.paidAmount !== 'number' ||
            typeof rawOrd.remainingDebt !== 'number'
          ) {
            backupPayload.previousDocs.orders.push({ id: ord.id, data: { ...rawOrd } });
            const patch = {
              paymentStatus: normStatus,
              paidAmount: paidAmt,
              remainingDebt: remDebt,
              updatedAt: nowIso,
            };
            await setDoc(doc(db, 'orders', ord.id), patch, { merge: true }).catch(() => {});
            await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'orders', ord.id), patch, { merge: true }).catch(() => {});
            await setDoc(doc(db, 'transactions', ord.id), patch, { merge: true }).catch(() => {});
            await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', ord.id), patch, { merge: true }).catch(() => {});
            fixedCount++;
          }
        }

        for (const tx of transactions) {
          const rawTx = tx as any;
          const total = Number(rawTx.totalAmount || 0);
          const calcModal = Array.isArray(rawTx.items)
            ? rawTx.items.reduce(
                (s: number, it: any) =>
                  s + Number(it.costPerUnit || it.costPrice || it.hargaModal || 0) * Number(it.quantityOrdered || it.qty || 1),
                0
              )
            : Number(rawTx.totalModal || 0);
          const modalVal = Number(rawTx.totalModal || calcModal || 0);
          const profitVal =
            typeof rawTx.netProfit === 'number' ? rawTx.netProfit : Math.max(0, total - modalVal);

          if (typeof rawTx.totalModal !== 'number' || typeof rawTx.netProfit !== 'number') {
            backupPayload.previousDocs.transactions.push({ id: tx.id, data: { ...rawTx } });
            const patch = {
              totalModal: modalVal,
              netProfit: profitVal,
              grossProfit: profitVal,
              updatedAt: nowIso,
            };
            await setDoc(doc(db, 'transactions', tx.id), patch, { merge: true }).catch(() => {});
            await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', tx.id), patch, { merge: true }).catch(() => {});
            fixedCount++;
          }
        }
      }

      // 2. Reconcile Products metadata (piecesPerCarton, productionDate, expiryDate)
      const shouldFixProducts =
        !fixTypes || fixTypes.includes('reconcile_stock_and_expiry');

      if (shouldFixProducts) {
        const defaultProdDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const defaultExpDate = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);

        for (const prod of products) {
          const rawProd = prod as any;
          const ppc = Number(rawProd.piecesPerCarton || rawProd.isiPerDus || 0);
          const needsFix = ppc <= 0 || !rawProd.productionDate || !rawProd.expiryDate;
          if (needsFix) {
            backupPayload.previousDocs.products.push({ id: prod.id, data: { ...rawProd } });
            const safePpc = ppc > 0 ? ppc : 24;
            const prodDate = rawProd.productionDate || rawProd.tanggalProduksi || defaultProdDate;
            const expDate = rawProd.expiryDate || rawProd.tanggalKadaluarsa || defaultExpDate;
            const patch = {
              piecesPerCarton: safePpc,
              isiPerDus: safePpc,
              productionDate: prodDate,
              tanggalProduksi: prodDate,
              expiryDate: expDate,
              tanggalKadaluarsa: expDate,
              updatedAt: nowIso,
            };
            await setDoc(doc(db, 'products', prod.id), patch, { merge: true }).catch(() => {});
            await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'products', prod.id), patch, { merge: true }).catch(() => {});
            fixedCount++;
          }
        }
      }

      await addDoc(collection(db, 'ai_architect_backups'), backupPayload);
      await addDoc(collection(db, 'ai_architect_logs'), {
        action: 'DATABASE_DOCTOR_AUTO_FIX',
        targetModule,
        modelUsed: selectedModel,
        fixedRecordsCount: fixedCount,
        createdAt: nowIso,
      });

      setStatusMessage({
        type: 'success',
        text: `Auto-Fix Database berhasil dijalankan! ${fixedCount} dokumen (Transaksi, Orders, & Produk) telah disinkronkan secara real-time dan titik backup rollback telah disimpan.`,
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Gagal menjalankan Auto-Fix Database.',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  // Apply AI Execution Plan (All 5 Capabilities)
  const handleApplyExecutionPlan = async () => {
    if (!executionPlan) return;
    setIsExecuting(true);
    setStatusMessage(null);
    try {
      const nowIso = new Date().toISOString();
      const createdTextOverrideIds: string[] = [];
      const createdLayoutOverrideIds: string[] = [];
      const createdFormulaIds: string[] = [];
      let patchedFileBackup: { filePath: string; previousContent: string } | null = null;

      // 1. Apply Text Overrides
      if (Array.isArray(executionPlan.textOverrides)) {
        for (const to of executionPlan.textOverrides) {
          if (!to.sourceText || !to.replacementId) continue;
          const docRef = await addDoc(collection(db, 'ui_text_overrides'), {
            targetRoute: to.targetRoute || 'ALL',
            sourceText: to.sourceText,
            replacementId: to.replacementId,
            replacementEn: to.replacementEn || to.replacementId,
            description: to.description || 'Dibuat oleh AI System Architect',
            enabled: true,
            createdAt: nowIso,
          });
          createdTextOverrideIds.push(docRef.id);
        }
      }

      // 2. Apply Layout Overrides
      if (Array.isArray(executionPlan.layoutOverrides)) {
        for (const lo of executionPlan.layoutOverrides) {
          if (!lo.cssRules && !lo.hideSelector) continue;
          const docRef = await addDoc(collection(db, 'ui_layout_overrides'), {
            targetRoute: lo.targetRoute || 'ALL',
            title: lo.title || `AI Style Override (${targetModule})`,
            cssRules: lo.cssRules || '',
            hideSelector: lo.hideSelector || '',
            description: lo.description || '',
            enabled: true,
            createdAt: nowIso,
          });
          createdLayoutOverrideIds.push(docRef.id);
        }
      }

      // 3. Apply Custom Formulas
      if (Array.isArray(executionPlan.formulas)) {
        for (const fm of executionPlan.formulas) {
          if (!fm.name || !fm.expression) continue;
          const docRef = await addDoc(collection(db, 'ai_custom_formulas'), {
            name: fm.name,
            targetCollection: fm.targetCollection || 'products',
            outputField: fm.outputField || 'aiMetric',
            expression: fm.expression,
            outputType: fm.outputType || 'currency',
            description: fm.description || '',
            createdAt: nowIso,
          });
          createdFormulaIds.push(docRef.id);
        }
      }

      // 4. Apply Database Fixes
      if (Array.isArray(executionPlan.databaseFixes) && executionPlan.databaseFixes.length > 0) {
        const types = executionPlan.databaseFixes.map((f: any) => f.type);
        await executeDatabaseDoctorAutoFix(types);
      }

      // 5. Apply Code Patch if present and modified
      if (
        executionPlan.codePatch?.filePath &&
        patchSearchBlock &&
        patchReplaceBlock &&
        patchSearchBlock !== patchReplaceBlock
      ) {
        const patchRes = await fetch('/api/ai-architect/apply-file-patch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: executionPlan.codePatch.filePath,
            searchBlock: patchSearchBlock,
            replaceBlock: patchReplaceBlock,
          }),
        });
        const patchData = await patchRes.json();
        if (patchData?.success) {
          patchedFileBackup = {
            filePath: executionPlan.codePatch.filePath,
            previousContent: patchData.previousContent,
          };
        }
      }

      // Save Master Backup Record for 1-Click Rollback
      await addDoc(collection(db, 'ai_architect_backups'), {
        type: 'ai_execution_plan',
        title: executionPlan.summary || `Eksekusi AI (${activeMode} - ${targetModule})`,
        mode: activeMode,
        targetModule,
        modelUsed: selectedModel,
        createdTextOverrideIds,
        createdLayoutOverrideIds,
        createdFormulaIds,
        patchedFileBackup,
        restored: false,
        createdAt: nowIso,
      });

      setStatusMessage({
        type: 'success',
        text: 'Seluruh rencana eksekusi AI berhasil diterapkan secara real-time ke ekosistem! Anda dapat melakukan Rollback kapan saja melalui panel Riwayat & Rollback di bawah.',
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Gagal menerapkan rencana eksekusi AI.',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  // Add Direct UI Text Override Rule
  const handleAddTextOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceText.trim() || !newReplacementId.trim()) return;
    const nowIso = new Date().toISOString();
    try {
      const docRef = await addDoc(collection(db, 'ui_text_overrides'), {
        targetRoute: newTextRoute || 'ALL',
        sourceText: newSourceText.trim(),
        replacementId: newReplacementId.trim(),
        replacementEn: newReplacementEn.trim() || newReplacementId.trim(),
        description: `Ubah "${newSourceText.trim()}" -> "${newReplacementId.trim()}" pada ${newTextRoute}`,
        enabled: true,
        createdAt: nowIso,
      });

      await addDoc(collection(db, 'ai_architect_backups'), {
        type: 'text_override',
        title: `Ubah Teks "${newSourceText.trim()}" -> "${newReplacementId.trim()}"`,
        targetModule: newTextRoute,
        modelUsed: selectedModel,
        createdTextOverrideIds: [docRef.id],
        restored: false,
        createdAt: nowIso,
      });

      setNewSourceText('');
      setNewReplacementId('');
      setNewReplacementEn('');
      setStatusMessage({
        type: 'success',
        text: `Teks "${newSourceText}" berhasil diubah menjadi "${newReplacementId}" secara real-time!`,
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Gagal menyimpan perubahan teks.',
      });
    }
  };

  // Add Direct Layout / CSS Override Rule
  const handleAddLayoutOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLayoutCss.trim() && !newHideSelector.trim()) return;
    const nowIso = new Date().toISOString();
    try {
      const docRef = await addDoc(collection(db, 'ui_layout_overrides'), {
        targetRoute: newLayoutRoute || 'ALL',
        title: newLayoutTitle.trim() || `Modifikasi Tampilan (${newLayoutRoute})`,
        cssRules: newLayoutCss.trim(),
        hideSelector: newHideSelector.trim(),
        enabled: true,
        createdAt: nowIso,
      });

      await addDoc(collection(db, 'ai_architect_backups'), {
        type: 'layout_override',
        title: newLayoutTitle.trim() || `Modifikasi Layout (${newLayoutRoute})`,
        targetModule: newLayoutRoute,
        modelUsed: selectedModel,
        createdLayoutOverrideIds: [docRef.id],
        restored: false,
        createdAt: nowIso,
      });

      setNewLayoutTitle('');
      setNewLayoutCss('');
      setNewHideSelector('');
      setStatusMessage({
        type: 'success',
        text: 'Modifikasi tampilan & CSS berhasil diaktifkan secara live!',
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Gagal menyimpan aturan layout.',
      });
    }
  };

  // Add Bulk Field to Firestore Collection
  const handleAddFieldToCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFieldName.trim()) return;
    setIsExecuting(true);
    const nowIso = new Date().toISOString();
    try {
      const snap = await getDocs(collection(db, schemaTargetCol));
      let count = 0;
      const parsedVal =
        !Number.isNaN(Number(newFieldDefaultValue)) && newFieldDefaultValue.trim() !== ''
          ? Number(newFieldDefaultValue)
          : newFieldDefaultValue;

      for (const d of snap.docs) {
        await setDoc(
          doc(db, schemaTargetCol, d.id),
          { [newFieldName.trim()]: parsedVal, updatedAt: nowIso },
          { merge: true }
        );
        count++;
      }

      setNewFieldName('');
      setNewFieldDefaultValue('');
      setStatusMessage({
        type: 'success',
        text: `Field baru "${newFieldName}" berhasil ditambahkan ke ${count} dokumen di koleksi "${schemaTargetCol}"!`,
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Gagal menambahkan field ke koleksi.',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  // Add Custom Formula
  const handleAddFormula = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formulaName.trim() || !formulaExpr.trim()) return;
    const nowIso = new Date().toISOString();
    try {
      const docRef = await addDoc(collection(db, 'ai_custom_formulas'), {
        name: formulaName.trim(),
        targetCollection: formulaCol,
        outputField: formulaOutputField.trim() || 'customResult',
        expression: formulaExpr.trim(),
        outputType: formulaType,
        createdAt: nowIso,
      });

      await addDoc(collection(db, 'ai_architect_backups'), {
        type: 'custom_formula',
        title: `Rumus Baru: ${formulaName.trim()}`,
        targetModule: formulaCol,
        modelUsed: selectedModel,
        createdFormulaIds: [docRef.id],
        restored: false,
        createdAt: nowIso,
      });

      setFormulaName('');
      setStatusMessage({
        type: 'success',
        text: 'Rumus logika baru berhasil disimpan dan langsung dievaluasi secara real-time!',
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Gagal menyimpan rumus.',
      });
    }
  };

  // Apply File Code Patch Directly
  const handleApplyFilePatchDirect = async () => {
    if (!selectedFilePath || !patchSearchBlock.trim()) return;
    setIsExecuting(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/ai-architect/apply-file-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: selectedFilePath,
          searchBlock: patchSearchBlock,
          replaceBlock: patchReplaceBlock,
        }),
      });
      const data = await res.json();
      if (data?.success) {
        await addDoc(collection(db, 'ai_architect_backups'), {
          type: 'code_patch',
          title: `Live Code Patch: ${selectedFilePath}`,
          targetModule: selectedFilePath,
          modelUsed: selectedModel,
          patchedFileBackup: {
            filePath: selectedFilePath,
            previousContent: data.previousContent,
          },
          restored: false,
          createdAt: new Date().toISOString(),
        });
        await handleInspectFile(selectedFilePath, inspectStartLine, inspectEndLine);
        setStatusMessage({
          type: 'success',
          text: `Kode pada ${selectedFilePath} berhasil diperbarui! Cadangan rollback tersimpan.`,
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: data?.error || 'Gagal menerapkan patch kode.',
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Gagal menghubungi server patch.',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  // 1-Click Rollback Handler
  const handleRollbackBackup = async (backup: any) => {
    setIsExecuting(true);
    setStatusMessage(null);
    try {
      // 1. Delete created text overrides
      if (Array.isArray(backup.createdTextOverrideIds)) {
        for (const id of backup.createdTextOverrideIds) {
          await deleteDoc(doc(db, 'ui_text_overrides', id)).catch(() => {});
        }
      }
      // 2. Delete created layout overrides
      if (Array.isArray(backup.createdLayoutOverrideIds)) {
        for (const id of backup.createdLayoutOverrideIds) {
          await deleteDoc(doc(db, 'ui_layout_overrides', id)).catch(() => {});
        }
      }
      // 3. Delete created formulas
      if (Array.isArray(backup.createdFormulaIds)) {
        for (const id of backup.createdFormulaIds) {
          await deleteDoc(doc(db, 'ai_custom_formulas', id)).catch(() => {});
        }
      }
      // 4. Restore previous Firestore documents if recorded
      if (backup.previousDocs) {
        for (const colName of ['products', 'orders', 'transactions']) {
          const docsList = backup.previousDocs[colName];
          if (Array.isArray(docsList)) {
            for (const item of docsList) {
              if (item?.id && item?.data) {
                await setDoc(doc(db, colName, item.id), item.data, { merge: true }).catch(() => {});
                await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, colName, item.id), item.data, {
                  merge: true,
                }).catch(() => {});
              }
            }
          }
        }
      }
      // 5. Restore patched code file if recorded
      if (backup.patchedFileBackup?.filePath && backup.patchedFileBackup?.previousContent) {
        await fetch('/api/ai-architect/restore-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(backup.patchedFileBackup),
        });
        if (selectedFilePath === backup.patchedFileBackup.filePath) {
          await handleInspectFile(selectedFilePath, inspectStartLine, inspectEndLine);
        }
      }

      await updateDoc(doc(db, 'ai_architect_backups', backup.id), {
        restored: true,
        restoredAt: new Date().toISOString(),
      });

      setStatusMessage({
        type: 'success',
        text: `Rollback berhasil! Perubahan "${backup.title}" telah dikembalikan ke kondisi semula.`,
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Gagal melakukan rollback.',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  // Filtered documents for Live Document Explorer (Tab 4)
  const explorerDocs = useMemo(() => {
    const source =
      explorerCollection === 'products'
        ? products
        : explorerCollection === 'orders'
        ? orders
        : explorerCollection === 'transactions'
        ? transactions
        : customers;
    const q = explorerSearch.trim().toLowerCase();
    return source
      .filter((item: any) => {
        if (!q) return true;
        return JSON.stringify(item).toLowerCase().includes(q);
      })
      .slice(0, 15);
  }, [explorerCollection, products, orders, transactions, customers, explorerSearch]);

  // Save edited document in Live Document Explorer
  const handleSaveEditedDoc = async () => {
    if (!editingDocId || !editingDocJson.trim()) return;
    try {
      const parsed = JSON.parse(editingDocJson);
      const { id: _ignoreId, ...restData } = parsed;
      await setDoc(doc(db, explorerCollection, editingDocId), restData, { merge: true });
      await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, explorerCollection, editingDocId), restData, {
        merge: true,
      }).catch(() => {});
      setEditingDocId(null);
      setStatusMessage({
        type: 'success',
        text: `Dokumen ${explorerCollection}/${editingDocId} berhasil diperbarui secara real-time!`,
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `JSON tidak valid atau gagal menyimpan: ${err?.message || ''}`,
      });
    }
  };

  // Safe evaluator for Custom Formula Preview on sample records
  const evaluateFormulaSample = (expression: string, outputType: string) => {
    const sampleProd = products[0] || {
      pricePerUnit: 55000,
      costPerUnit: 45000,
      stockInUnits: 25,
      piecesPerCarton: 24,
    };
    try {
      const pricePerUnit = Number((sampleProd as any).pricePerUnit || 55000);
      const costPerUnit = Number((sampleProd as any).costPerUnit || 45000);
      const stockInUnits = Number((sampleProd as any).stockInUnits || 25);
      const piecesPerCarton = Number((sampleProd as any).piecesPerCarton || 24);
      const totalRevenue = diagnostics.totalRevenue || 1500000;

      const sanitized = expression
        .replace(/\bpricePerUnit\b/g, String(pricePerUnit))
        .replace(/\bhargaJual\b/g, String(pricePerUnit))
        .replace(/\bcostPerUnit\b/g, String(costPerUnit))
        .replace(/\bhargaModal\b/g, String(costPerUnit))
        .replace(/\bstockInUnits\b/g, String(stockInUnits))
        .replace(/\bstok\b/g, String(stockInUnits))
        .replace(/\bpiecesPerCarton\b/g, String(piecesPerCarton))
        .replace(/\bisiPerDus\b/g, String(piecesPerCarton))
        .replace(/\btotalRevenue\b/g, String(totalRevenue));

      if (/^[0-9+\-*/().\s]+$/.test(sanitized)) {
        // eslint-disable-next-line no-new-func
        const val = Function(`"use strict"; return (${sanitized});`)();
        if (typeof val === 'number' && Number.isFinite(val)) {
          if (outputType === 'currency') return formatMoney(val);
          if (outputType === 'percent') return `${val.toFixed(1)}%`;
          return val.toLocaleString('id-ID');
        }
      }
    } catch {}
    return outputType === 'currency' ? formatMoney(10000) : '100%';
  };

  const selectedTargetRoute =
    TARGET_MODULES.find((m) => m.id === targetModule)?.route || '/dashboard';

  return (
    <div className="space-y-6 text-zinc-100" data-no-translate="true">
      {/* Top Workspace Header */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-zinc-800 pb-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-500/15 border border-purple-500/40 flex items-center justify-center text-purple-400 shrink-0">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  {tr('AI System Architect & Live Editor', 'AI System Architect & Live Editor')}
                </h1>
                <span className="text-xs font-mono uppercase tracking-wider text-purple-300">
                  · OWNER CONTROL CENTER · {currency}
                </span>
              </div>
              <p className="text-sm text-zinc-400 mt-1">
                Pusat kendali AI multimodal untuk mendiagnosa & memperbaiki bug database, mengubah teks/label/kolom halaman, memodifikasi layout CSS, membuat rumus baru, dan menginspeksi kode secara langsung.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {selectedTargetRoute !== 'ALL' && (
              <button
                type="button"
                onClick={() => navigateToPath(selectedTargetRoute)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
                <span>Buka {selectedTargetRoute}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => executeDatabaseDoctorAutoFix()}
              disabled={isExecuting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors shadow-sm"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{isExecuting ? 'Menyinkronkan...' : 'Auto-Fix & Sinkronisasi Database'}</span>
            </button>
          </div>
        </div>

        {/* Model Selector & Target Module Selector */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
              1. Pilihan Model Google AI (@google/genai)
            </label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-purple-500"
            >
              {ARCHITECT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-zinc-500 mt-1">
              {ARCHITECT_MODELS.find((m) => m.id === selectedModel)?.description}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
              2. Target Halaman / Modul Ekosistem
            </label>
            <select
              value={targetModule}
              onChange={(e) => setTargetModule(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
            >
              {TARGET_MODULES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-zinc-500 mt-1">
              Perubahan dapat ditargetkan khusus ke halaman ini atau seluruh ekosistem aplikasi (Global).
            </p>
          </div>
        </div>

        {/* 5 Multi-Capability Mode Tabs */}
        <div className="mt-5 pt-4 border-t border-zinc-800/80">
          <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
            3. Mode Aksi AI System Architect (Multi-Capability Tabs)
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {[
              {
                id: 'bug_fix' as ArchitectMode,
                title: '1. Perbaiki Bug & DB',
                sub: 'Database Doctor & Sync',
                icon: Wrench,
              },
              {
                id: 'text_override' as ArchitectMode,
                title: '2. Ubah Teks & Kolom',
                sub: 'Live UI Text Override',
                icon: TypeIcon,
              },
              {
                id: 'layout_override' as ArchitectMode,
                title: '3. Modifikasi Tampilan',
                sub: 'Live Layout & CSS',
                icon: Layout,
              },
              {
                id: 'schema_formula' as ArchitectMode,
                title: '4. Struktur DB & Rumus',
                sub: 'Schema & Formula Engine',
                icon: Database,
              },
              {
                id: 'code_patch' as ArchitectMode,
                title: '5. Live Code Inspector',
                sub: 'Inspeksi & Patch Kode',
                icon: Code2,
              },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveMode(tab.id)}
                  className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                    isActive
                      ? 'bg-purple-600/15 border-purple-500 text-white shadow-sm'
                      : 'bg-zinc-950/70 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      isActive ? 'text-purple-400' : 'text-zinc-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">{tab.title}</div>
                    <div className="text-[11px] text-zinc-500 truncate mt-0.5">{tab.sub}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Multimodal Prompt & Screenshot Input */}
        <div className="mt-5 bg-zinc-950 border border-zinc-800 rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-xs font-semibold text-zinc-300">
              Instruksi Prompt Natural Language / Lampirkan Screenshot Halaman
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setPrompt(
                    'Audit seluruh transaksi POS dan Orders di database, perbaiki field totalModal, netProfit, paidAmount, remainingDebt, dan sinkronkan dengan Laporan Kas.'
                  )
                }
                className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800"
              >
                Contoh: Perbaiki Bug Transaksi & Kas
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveMode('text_override');
                  setPrompt('Ubah teks "Total Jual" menjadi "Nilai Transaksi" di halaman /dashboard/orders');
                }}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800"
              >
                Contoh: Ubah Label Kolom
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveMode('schema_formula');
                  setPrompt('Buat rumus efisiensi margin bersih ((pricePerUnit - costPerUnit) / pricePerUnit) * 100 pada koleksi products');
                }}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800"
              >
                Contoh: Buat Rumus Baru
              </button>
            </div>
          </div>

          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ketik perintah Anda... (Misal: 'Perbaiki selisih pembayaran hutang di /dashboard/orders', atau 'Ubah teks Total Jual menjadi Nilai Penjualan', atau lampirkan screenshot bagian yang ingin diperbaiki)"
            className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-3">
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleImageUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-medium border border-zinc-800 transition-colors"
              >
                <Upload className="w-3.5 h-3.5 text-purple-400" />
                <span>{imageBase64 ? 'Ganti Screenshot' : 'Upload Screenshot / Gambar'}</span>
              </button>

              {imageBase64 && (
                <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1">
                  <img
                    src={imageBase64}
                    alt="Preview"
                    className="w-7 h-7 object-cover rounded"
                  />
                  <span className="text-xs text-zinc-300 max-w-[140px] truncate">
                    {imageName || 'screenshot.png'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setImageBase64(null);
                      setImageName('');
                    }}
                    className="text-zinc-500 hover:text-rose-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleAnalyzeWithAi}
                disabled={isAnalyzing}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors shadow-sm"
              >
                <Play className="w-3.5 h-3.5" />
                <span>
                  {isAnalyzing
                    ? `Menganalisis dengan ${selectedModel}...`
                    : `Analisis & Susun Eksekusi (${selectedModel})`}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Status Feedback Banner */}
        {statusMessage && (
          <div
            className={`mt-4 p-3.5 rounded-xl border flex items-start justify-between gap-3 text-xs ${
              statusMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                : statusMessage.type === 'error'
                ? 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                : 'bg-cyan-500/10 border-cyan-500/40 text-cyan-200'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              )}
              <span>{statusMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-zinc-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* AI Execution Plan & Impact Preview Card */}
        {executionPlan && (
          <div className="mt-5 bg-zinc-950 border border-purple-500/50 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-purple-400">
                  RENCANA EKSEKUSI AI ARCHITECT · {tokenStats?.modelUsed || selectedModel}
                </div>
                <h3 className="text-base font-bold text-white mt-0.5">{executionPlan.summary}</h3>
                {executionPlan.rootCause && (
                  <p className="text-xs text-zinc-400 mt-1">{executionPlan.rootCause}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleApplyExecutionPlan}
                  disabled={isExecuting}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {isExecuting ? 'Menerapkan...' : 'Terapkan Perubahan Sekarang (Apply Live)'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setExecutionPlan(null)}
                  className="px-3 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 text-xs"
                >
                  Tutup
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {Array.isArray(executionPlan.databaseFixes) &&
                executionPlan.databaseFixes.length > 0 && (
                  <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3">
                    <div className="font-semibold text-emerald-400 mb-1.5">
                      Tindakan Perbaikan & Sinkronisasi Database ({executionPlan.databaseFixes.length})
                    </div>
                    <ul className="space-y-1 text-zinc-300">
                      {executionPlan.databaseFixes.map((df: any, i: number) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-emerald-400">•</span>
                          <span>{df.description}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

              {Array.isArray(executionPlan.textOverrides) &&
                executionPlan.textOverrides.length > 0 && (
                  <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3">
                    <div className="font-semibold text-cyan-400 mb-1.5">
                      Perubahan Teks / Label / Kolom Live ({executionPlan.textOverrides.length})
                    </div>
                    <ul className="space-y-1 text-zinc-300">
                      {executionPlan.textOverrides.map((to: any, i: number) => (
                        <li key={i}>
                          <span className="text-zinc-400">[{to.targetRoute}]</span>{' '}
                          <span className="line-through text-rose-400">{to.sourceText}</span>{' '}
                          <ArrowRight className="inline w-3 h-3 mx-1 text-zinc-500" />
                          <span className="text-emerald-300 font-semibold">{to.replacementId}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

              {Array.isArray(executionPlan.layoutOverrides) &&
                executionPlan.layoutOverrides.length > 0 && (
                  <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3">
                    <div className="font-semibold text-amber-400 mb-1.5">
                      Modifikasi Tampilan & Layout ({executionPlan.layoutOverrides.length})
                    </div>
                    <ul className="space-y-1 text-zinc-300">
                      {executionPlan.layoutOverrides.map((lo: any, i: number) => (
                        <li key={i}>
                          <span className="font-medium text-white">{lo.title}:</span>{' '}
                          <span className="text-zinc-400">{lo.description}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

              {Array.isArray(executionPlan.formulas) && executionPlan.formulas.length > 0 && (
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3">
                  <div className="font-semibold text-purple-400 mb-1.5">
                    Rumus Logika Baru ({executionPlan.formulas.length})
                  </div>
                  <ul className="space-y-1 text-zinc-300">
                    {executionPlan.formulas.map((fm: any, i: number) => (
                      <li key={i}>
                        <span className="font-medium text-white">{fm.name}:</span>{' '}
                        <code className="text-purple-300">{fm.expression}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* ACTIVE CAPABILITY WORKSPACE PANEL                                     */}
      {/* ===================================================================== */}

      {/* TAB 1: DATABASE DOCTOR & AUTO-FIX */}
      {activeMode === 'bug_fix' && (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Wrench className="w-5 h-5 text-emerald-400" />
                <span>Database Doctor & Sinkronisasi Ekosistem Real-Time</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Memeriksa integritas data antara Mesin Kasir POS, Orders Wharf, Produk & Expired Date, Shift Kasir, Laporan Kas, dan Keuangan.
              </p>
            </div>
            <button
              type="button"
              onClick={() => executeDatabaseDoctorAutoFix()}
              disabled={isExecuting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isExecuting ? 'animate-spin' : ''}`} />
              <span>Perbaiki & Sinkronkan Semua Sekarang</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
              <div className="text-xs text-zinc-400">Audit Transaksi POS & PWA</div>
              <div className="text-2xl font-bold text-white mt-1">
                {diagnostics.totalTransactions} Dokumen
              </div>
              <div className="text-xs mt-2 text-zinc-400">
                Perlu Rekonsiliasi HPP/Status:{' '}
                <span
                  className={
                    diagnostics.inconsistentTransactionsCount > 0
                      ? 'text-amber-400 font-semibold'
                      : 'text-emerald-400 font-semibold'
                  }
                >
                  {diagnostics.inconsistentTransactionsCount}
                </span>
              </div>
            </div>

            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
              <div className="text-xs text-zinc-400">Audit Orders & Status Payment</div>
              <div className="text-2xl font-bold text-white mt-1">
                {diagnostics.totalOrders} Pesanan
              </div>
              <div className="text-xs mt-2 text-zinc-400">
                Belum Sinkron Payment/Hutang:{' '}
                <span
                  className={
                    diagnostics.inconsistentOrdersCount > 0
                      ? 'text-amber-400 font-semibold'
                      : 'text-emerald-400 font-semibold'
                  }
                >
                  {diagnostics.inconsistentOrdersCount}
                </span>
              </div>
            </div>

            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
              <div className="text-xs text-zinc-400">Master Produk & Expired Date</div>
              <div className="text-2xl font-bold text-white mt-1">
                {diagnostics.totalProducts} Produk
              </div>
              <div className="text-xs mt-2 text-zinc-400">
                Perlu Melengkapi Isi Dus / Tgl:{' '}
                <span
                  className={
                    diagnostics.productsMissingMetadataCount > 0
                      ? 'text-amber-400 font-semibold'
                      : 'text-emerald-400 font-semibold'
                  }
                >
                  {diagnostics.productsMissingMetadataCount}
                </span>
              </div>
            </div>

            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
              <div className="text-xs text-zinc-400">Total Omzet & Piutang Aktif ({currency})</div>
              <div className="text-xl font-bold text-emerald-400 mt-1">
                {formatMoney(diagnostics.totalRevenue)}
              </div>
              <div className="text-xs mt-2 text-zinc-400">
                Sisa Piutang Pelanggan:{' '}
                <span className="text-amber-400 font-semibold">
                  {formatMoney(diagnostics.actualUnpaidTotal)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: LIVE UI TEXT, LABEL & COLUMN OVERRIDE */}
      {activeMode === 'text_override' && (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 space-y-5">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <TypeIcon className="w-5 h-5 text-cyan-400" />
              <span>Live UI Text, Label, Tombol & Nama Kolom Override</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Ubah teks judul, nama kolom tabel, atau label tombol di halaman mana pun secara instan tanpa harus menyentuh kode sumber. Tersimpan di Firestore <code>ui_text_overrides</code>.
            </p>
          </div>

          <form
            onSubmit={handleAddTextOverride}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 bg-zinc-950 border border-zinc-800 rounded-xl p-4"
          >
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Target Route / Halaman</label>
              <input
                type="text"
                value={newTextRoute}
                onChange={(e) => setNewTextRoute(e.target.value)}
                placeholder="ALL atau /dashboard/orders"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">
                Teks / Kolom Asli di Halaman
              </label>
              <input
                type="text"
                value={newSourceText}
                onChange={(e) => setNewSourceText(e.target.value)}
                placeholder="Contoh: Total Jual"
                required
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">
                Teks Baru (Bahasa Indonesia)
              </label>
              <input
                type="text"
                value={newReplacementId}
                onChange={(e) => setNewReplacementId(e.target.value)}
                placeholder="Contoh: Nilai Penjualan"
                required
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">
                Teks Baru (English - Opsional)
              </label>
              <input
                type="text"
                value={newReplacementEn}
                onChange={(e) => setNewReplacementEn(e.target.value)}
                placeholder="Contoh: Sales Value"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Terapkan Teks Live</span>
              </button>
            </div>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="py-2.5 px-3">Target Halaman</th>
                  <th className="py-2.5 px-3">Teks Asli</th>
                  <th className="py-2.5 px-3">Teks Pengganti (ID)</th>
                  <th className="py-2.5 px-3">Teks Pengganti (EN)</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {textOverrides.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-zinc-500">
                      Belum ada aturan override teks aktif. Tambahkan di atas atau gunakan prompt AI.
                    </td>
                  </tr>
                ) : (
                  textOverrides.map((rule) => (
                    <tr key={rule.id} className="hover:bg-zinc-950/60">
                      <td className="py-2.5 px-3 font-mono text-cyan-400">{rule.targetRoute}</td>
                      <td className="py-2.5 px-3 text-zinc-300">{rule.sourceText}</td>
                      <td className="py-2.5 px-3 font-semibold text-emerald-400">
                        {rule.replacementId}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-300">
                        {rule.replacementEn || rule.replacementId}
                      </td>
                      <td className="py-2.5 px-3">
                        <button
                          type="button"
                          onClick={() =>
                            updateDoc(doc(db, 'ui_text_overrides', rule.id), {
                              enabled: !rule.enabled,
                            })
                          }
                          className={`text-xs font-medium ${
                            rule.enabled !== false ? 'text-emerald-400' : 'text-zinc-500'
                          }`}
                        >
                          {rule.enabled !== false ? 'Aktif' : 'Nonaktif'}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => deleteDoc(doc(db, 'ui_text_overrides', rule.id))}
                          className="text-rose-400 hover:text-rose-300 p-1"
                          title="Hapus Override"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: LIVE LAYOUT & STYLE OVERRIDE */}
      {activeMode === 'layout_override' && (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 space-y-5">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Layout className="w-5 h-5 text-amber-400" />
              <span>Modifikasi Tampilan, Layout, Warna & Visibilitas Komponen</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Terapkan modifikasi CSS langsung atau sembunyikan elemen tertentu berdasarkan selector pada halaman target secara real-time.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setNewLayoutTitle('Aksen Header Tabel Emerald');
                setNewLayoutCss(
                  'table thead th { color: #34d399 !important; border-bottom-color: rgba(16,185,129,0.3) !important; }'
                );
              }}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300"
            >
              Preset: Header Tabel Aksen Emerald
            </button>
            <button
              type="button"
              onClick={() => {
                setNewLayoutTitle('Mode Tabel Padat (Compact High-Density)');
                setNewLayoutCss('table td, table th { padding-top: 6px !important; padding-bottom: 6px !important; }');
              }}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300"
            >
              Preset: Mode Tabel Padat (Compact)
            </button>
          </div>

          <form
            onSubmit={handleAddLayoutOverride}
            className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-zinc-950 border border-zinc-800 rounded-xl p-4"
          >
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Target Route</label>
              <input
                type="text"
                value={newLayoutRoute}
                onChange={(e) => setNewLayoutRoute(e.target.value)}
                placeholder="ALL atau /dashboard/orders"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Judul Modifikasi</label>
              <input
                type="text"
                value={newLayoutTitle}
                onChange={(e) => setNewLayoutTitle(e.target.value)}
                placeholder="Contoh: Aksen Tabel Orders"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">
                CSS Kustom / Override Style
              </label>
              <input
                type="text"
                value={newLayoutCss}
                onChange={(e) => setNewLayoutCss(e.target.value)}
                placeholder="Contoh: table th { color: #38bdf8; }"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white font-mono"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Aktifkan Layout Live</span>
              </button>
            </div>
          </form>

          <div className="space-y-2">
            {layoutOverrides.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between gap-3 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs"
              >
                <div>
                  <div className="font-semibold text-white">
                    {rule.title}{' '}
                    <span className="text-amber-400 font-mono ml-2">[{rule.targetRoute}]</span>
                  </div>
                  <div className="font-mono text-zinc-400 text-[11px] mt-0.5">{rule.cssRules}</div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      updateDoc(doc(db, 'ui_layout_overrides', rule.id), {
                        enabled: !rule.enabled,
                      })
                    }
                    className={rule.enabled !== false ? 'text-emerald-400' : 'text-zinc-500'}
                  >
                    {rule.enabled !== false ? 'Aktif' : 'Nonaktif'}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteDoc(doc(db, 'ui_layout_overrides', rule.id))}
                    className="text-rose-400 hover:text-rose-300"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: DATABASE SCHEMA, FORMULA ENGINE & LIVE DOCUMENT EDITOR */}
      {activeMode === 'schema_formula' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sub-panel A: Bulk Add Field to Collection */}
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-purple-400" />
                <span>Tambah Field Struktur Baru ke Koleksi Firestore</span>
              </h3>
              <form onSubmit={handleAddFieldToCollection} className="space-y-3 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-zinc-400 mb-1">Koleksi Target</label>
                    <select
                      value={schemaTargetCol}
                      onChange={(e) => setSchemaTargetCol(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white"
                    >
                      <option value="products">products (Produk)</option>
                      <option value="orders">orders (Pesanan)</option>
                      <option value="transactions">transactions (Transaksi POS)</option>
                      <option value="customers">customers (Pelanggan)</option>
                      <option value="staff">staff (Staf)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">Nama Field Baru</label>
                    <input
                      type="text"
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      placeholder="Contoh: lokasiRakGudang"
                      required
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">Nilai Default</label>
                    <input
                      type="text"
                      value={newFieldDefaultValue}
                      onChange={(e) => setNewFieldDefaultValue(e.target.value)}
                      placeholder="Contoh: Rak A-01"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isExecuting}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambahkan Field ke Seluruh Dokumen {schemaTargetCol}</span>
                </button>
              </form>
            </div>

            {/* Sub-panel B: Dynamic Formula Engine */}
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Calculator className="w-4 h-4 text-emerald-400" />
                <span>Buat Rumus Logika & Metrik Baru (Support IDR / USD)</span>
              </h3>
              <form onSubmit={handleAddFormula} className="space-y-3 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-zinc-400 mb-1">Nama Rumus</label>
                    <input
                      type="text"
                      value={formulaName}
                      onChange={(e) => setFormulaName(e.target.value)}
                      placeholder="Contoh: Keuntungan per Karton"
                      required
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">Tipe Output</label>
                    <select
                      value={formulaType}
                      onChange={(e) => setFormulaType(e.target.value as any)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white"
                    >
                      <option value="currency">Mata Uang Dinamis (IDR / USD)</option>
                      <option value="percent">Persentase (%)</option>
                      <option value="number">Angka / Kuantitas</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">
                    Ekspresi Rumus (Variabel: pricePerUnit, costPerUnit, stockInUnits, piecesPerCarton, totalRevenue)
                  </label>
                  <input
                    type="text"
                    value={formulaExpr}
                    onChange={(e) => setFormulaExpr(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-emerald-300 font-mono"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">
                    Hasil Simulasi Live:{' '}
                    <strong className="text-emerald-400">
                      {evaluateFormulaSample(formulaExpr, formulaType)}
                    </strong>
                  </span>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Simpan Rumus ke Firestore</span>
                  </button>
                </div>
              </form>

              {customFormulas.length > 0 && (
                <div className="pt-2 border-t border-zinc-800 space-y-1.5 max-h-40 overflow-y-auto">
                  {customFormulas.map((fm) => (
                    <div
                      key={fm.id}
                      className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs"
                    >
                      <div>
                        <span className="font-semibold text-white">{fm.name}: </span>
                        <code className="text-purple-300">{fm.expression}</code>
                        <span className="ml-2 text-emerald-400 font-semibold">
                          = {evaluateFormulaSample(fm.expression, fm.outputType)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteDoc(doc(db, 'ai_custom_formulas', fm.id))}
                        className="text-rose-400 hover:text-rose-300"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sub-panel C: Live Firestore Document Explorer & Inline Editor */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  Live Firestore Document Inspector & Direct Editor
                </h3>
                <p className="text-xs text-zinc-400">
                  Klik dokumen mana pun untuk menginspeksi dan mengedit field JSON-nya secara langsung di Firestore.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={explorerCollection}
                  onChange={(e) => {
                    setExplorerCollection(e.target.value as any);
                    setEditingDocId(null);
                  }}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white"
                >
                  <option value="products">products ({products.length})</option>
                  <option value="orders">orders ({orders.length})</option>
                  <option value="transactions">transactions ({transactions.length})</option>
                  <option value="customers">customers ({customers.length})</option>
                </select>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={explorerSearch}
                    onChange={(e) => setExplorerSearch(e.target.value)}
                    placeholder="Cari dokumen..."
                    className="bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white"
                  />
                </div>
              </div>
            </div>

            {editingDocId ? (
              <div className="bg-zinc-950 border border-purple-500/50 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-purple-300">
                    Mengedit Dokumen: {explorerCollection}/{editingDocId}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveEditedDoc}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                    >
                      Simpan ke Firestore
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingDocId(null)}
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-xs"
                    >
                      Batal
                    </button>
                  </div>
                </div>
                <textarea
                  rows={10}
                  value={editingDocJson}
                  onChange={(e) => setEditingDocJson(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs font-mono text-emerald-300 focus:outline-none"
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {explorerDocs.map((item: any) => (
                  <div
                    key={item.id}
                    className="bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 flex flex-col justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="font-mono text-purple-400 truncate">{item.id}</div>
                      <div className="font-semibold text-white truncate mt-0.5">
                        {item.name || item.customerName || item.orderNumber || 'Record'}
                      </div>
                      <div className="text-zinc-400 mt-1">
                        {typeof item.pricePerUnit === 'number'
                          ? formatMoney(item.pricePerUnit)
                          : typeof item.totalAmount === 'number'
                          ? formatMoney(item.totalAmount)
                          : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingDocId(item.id);
                        setEditingDocJson(JSON.stringify(item, null, 2));
                      }}
                      className="inline-flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800"
                    >
                      <Eye className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Inspeksi & Edit JSON</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: LIVE CODE INSPECTOR & FILE PATCHER */}
      {activeMode === 'code_patch' && (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <FileCode className="w-5 h-5 text-purple-400" />
                <span>Live Code Inspector & Server File Patcher</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Baca kode asli komponen React/TypeScript dari server, analisis bersama Gemini AI, dan terapkan patch kode dengan aman beserta fitur Rollback otomatis.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedFilePath}
                onChange={(e) => {
                  setSelectedFilePath(e.target.value);
                  void handleInspectFile(e.target.value, inspectStartLine, inspectEndLine);
                }}
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white"
              >
                {availableFiles.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.label} ({f.path})
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={inspectStartLine}
                onChange={(e) => setInspectStartLine(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-2 text-xs text-white"
                title="Baris Awal"
              />
              <span className="text-xs text-zinc-500">s/d</span>
              <input
                type="number"
                value={inspectEndLine}
                onChange={(e) => setInspectEndLine(Math.max(1, Number(e.target.value) || 200))}
                className="w-20 bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-2 text-xs text-white"
                title="Baris Akhir"
              />
              <button
                type="button"
                onClick={() => handleInspectFile(selectedFilePath, inspectStartLine, inspectEndLine)}
                disabled={loadingFile}
                className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold"
              >
                {loadingFile ? 'Memuat...' : 'Muat Kode'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Code Viewer */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-mono text-cyan-400">{selectedFilePath}</span>
                {inspectedFileData && (
                  <span>Total: {inspectedFileData.totalLines} baris</span>
                )}
              </div>
              <pre className="text-[11px] font-mono text-zinc-300 bg-zinc-900/90 border border-zinc-800 rounded-lg p-3 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre">
                {inspectedFileData?.snippet || 'Klik "Muat Kode" untuk melihat isi file...'}
              </pre>
            </div>

            {/* Search & Replace Patch Editor */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="text-xs font-semibold text-white">
                Live Code Patch (Search Block & Replace Block)
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Blok Kode Asli yang Dicari (searchBlock)
                </label>
                <textarea
                  rows={5}
                  value={patchSearchBlock}
                  onChange={(e) => setPatchSearchBlock(e.target.value)}
                  placeholder="Salin potongan baris kode dari panel kiri yang ingin diubah..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-xs font-mono text-rose-300"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Blok Kode Pengganti Baru (replaceBlock)
                </label>
                <textarea
                  rows={5}
                  value={patchReplaceBlock}
                  onChange={(e) => setPatchReplaceBlock(e.target.value)}
                  placeholder="Tulis potongan kode pengganti di sini..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-xs font-mono text-emerald-300"
                />
              </div>
              <button
                type="button"
                onClick={handleApplyFilePatchDirect}
                disabled={isExecuting || !patchSearchBlock.trim()}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold"
              >
                <Save className="w-4 h-4" />
                <span>Terapkan Patch Kode ke File & Buat Cadangan Rollback</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* AUDIT LOG & 1-CLICK ROLLBACK CENTER                                   */}
      {/* ===================================================================== */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <History className="w-5 h-5 text-purple-400" />
              <span>Riwayat Eksekusi AI Architect & 1-Click Rollback (Undo)</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Setiap modifikasi data, teks, layout, rumus, atau kode otomatis dicadangkan di Firestore <code>ai_architect_backups</code>.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {architectBackups.length === 0 ? (
            <div className="text-xs text-zinc-500 py-4 text-center bg-zinc-950 border border-zinc-800 rounded-xl">
              Belum ada riwayat perubahan. Setiap perubahan yang Anda terapkan akan muncul di sini lengkap dengan tombol Rollback.
            </div>
          ) : (
            architectBackups.map((bk) => (
              <div
                key={bk.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{bk.title}</span>
                    <span className="text-zinc-500">·</span>
                    <span className="font-mono text-purple-400">
                      {bk.modelUsed || 'gemini-2.5-pro'}
                    </span>
                    <span className="text-zinc-500">·</span>
                    <span className="text-cyan-400">{bk.targetModule || 'Global'}</span>
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    Waktu: {bk.createdAt ? new Date(bk.createdAt).toLocaleString('id-ID') : '-'}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {bk.restored ? (
                    <span className="text-zinc-500 font-medium">Telah Di-Rollback</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRollbackBackup(bk)}
                      disabled={isExecuting}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-rose-600/20 hover:text-rose-300 border border-zinc-700 text-zinc-200 font-medium transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Rollback / Undo</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
